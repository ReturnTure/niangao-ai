"""
年糕 · 离线语音识别（Vosk 中文小模型，独立模块）

职责：
1. 加载本地 Vosk 模型（不联网、不上传音频，隐私友好 —— 心理陪伴场景这点很重要）
2. WAV / 裸 PCM 字节 → 中文文本
3. 提供流式识别会话 StreamSession，供 WebSocket 逐块喂音频

依赖：
    pip install vosk
模型（约 42MB，解压后放到 backend/models/）：
    https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip

设计原则：
- 与 tts.py 一样不 import 项目内其它模块，可单独跑通
- 没装 vosk / 没放模型时 asr_available() 返回 False，接口回 503，
  前端隐藏麦克风按钮并给出提示，不影响文字聊天与语音播报
"""

from __future__ import annotations

import array
import io
import json
import os
import re
import threading
import time
import wave
from pathlib import Path
from typing import Dict, Optional, Tuple

# ---------------- 配置 ---------------- #

SAMPLE_RATE = 16000  # Vosk 中文模型固定 16k

MAX_AUDIO_BYTES = int(os.getenv("ASR_MAX_BYTES", str(10 * 1024 * 1024)))

MODELS_DIR = Path(
    os.getenv("VOSK_MODELS_DIR") or (Path(__file__).resolve().parents[2] / "models")
)

# 显式指定则优先；否则自动在 models/ 下找第一个像样的模型目录
_MODEL_DIR_ENV = os.getenv("VOSK_MODEL_DIR", "").strip()


class ASRError(RuntimeError):
    """识别失败（未装依赖、缺模型、音频格式不对等）。"""


# ---------------- 模型定位 / 加载 ---------------- #

def _looks_like_model(path: Path) -> bool:
    """Vosk 模型目录的特征：conf/ 与 am/ 子目录。"""
    try:
        return path.is_dir() and (path / "conf").is_dir() and (path / "am").is_dir()
    except OSError:
        return False


def find_model_dir() -> Optional[Path]:
    if _MODEL_DIR_ENV:
        p = Path(_MODEL_DIR_ENV)
        return p if _looks_like_model(p) else None

    if not MODELS_DIR.is_dir():
        return None

    # 常见的解压层级：models/vosk-model-small-cn-0.22/
    for child in sorted(MODELS_DIR.iterdir()):
        if _looks_like_model(child):
            return child

    return None


_model = None
_model_dir: Optional[Path] = None
_load_lock = threading.Lock()
_load_error = ""
_last_used = 0.0


def _load_vosk():
    try:
        import vosk  # noqa: F401

        return vosk
    except Exception as e:
        raise ASRError(f"vosk 未安装：{e}（执行 pip install vosk 后重启服务）") from e


def get_model():
    """懒加载模型。首次约 1 秒，之后常驻内存（约 100~200MB）。"""
    global _model, _model_dir, _load_error

    if _model is not None:
        return _model

    with _load_lock:
        if _model is not None:
            return _model

        vosk = _load_vosk()
        vosk.SetLogLevel(-1)  # 关掉 Kaldi 那一大段日志

        path = find_model_dir()
        if path is None:
            _load_error = (
                f"未找到 Vosk 模型：把 vosk-model-small-cn-0.22 解压到 {MODELS_DIR}，"
                "或用环境变量 VOSK_MODEL_DIR 指定目录"
            )
            raise ASRError(_load_error)

        start = time.time()
        try:
            _model = vosk.Model(str(path))
        except Exception as e:
            _load_error = f"Vosk 模型加载失败：{e}"
            raise ASRError(_load_error) from e

        _model_dir = path
        _load_error = ""
        print(f"🎙️  Vosk 中文模型已加载：{path.name}（{time.time() - start:.1f}s）")

        return _model


def asr_available() -> Tuple[bool, str]:
    """返回 (是否可用, 说明)。前端用 /voice/asr/health 探测。"""
    if os.getenv("ASR_ENABLED", "1").strip() == "0":
        return False, "ASR_ENABLED=0，语音识别已关闭"

    try:
        _load_vosk()
    except ASRError as e:
        return False, str(e)

    path = find_model_dir()
    if path is None:
        return False, _load_error or f"未找到 Vosk 模型（{MODELS_DIR}）"

    return True, "vosk"


def model_info() -> Dict[str, object]:
    path = _model_dir or find_model_dir()
    return {
        "engine": "vosk",
        "model": path.name if path else None,
        "sample_rate": SAMPLE_RATE,
        "loaded": _model is not None,
    }


# ---------------- 音频预处理 ---------------- #

def _pcm_from_wav(data: bytes) -> Tuple[array.array, int]:
    """解析 WAV，返回 (16bit 单声道样本, 采样率)。"""
    try:
        with wave.open(io.BytesIO(data), "rb") as wf:
            channels = wf.getnchannels()
            width = wf.getsampwidth()
            rate = wf.getframerate()
            frames = wf.readframes(wf.getnframes())
    except Exception as e:
        raise ASRError(f"不是有效的 WAV 音频：{e}") from e

    if width != 2:
        raise ASRError(f"只支持 16bit PCM 音频，收到 {width * 8}bit。请在前端转成 16kHz/16bit/单声道。")

    samples = array.array("h")
    samples.frombytes(frames)

    if channels > 1:
        # 多声道直接取平均混成单声道，立体声在语音识别里没有额外信息
        mono = array.array("h", [0]) * (len(samples) // channels)
        for i in range(len(mono)):
            total = 0
            for c in range(channels):
                total += samples[i * channels + c]
            mono[i] = int(total / channels)
        samples = mono

    return samples, rate


def _resample(samples: array.array, src_rate: int, dst_rate: int) -> array.array:
    """线性插值重采样。够用且不引入 numpy，短语音耗时可以忽略。"""
    if src_rate == dst_rate or not len(samples):
        return samples

    ratio = dst_rate / src_rate
    n_out = max(1, int(len(samples) * ratio))
    out = array.array("h", [0]) * n_out
    last = len(samples) - 1

    for i in range(n_out):
        pos = i / ratio
        i0 = int(pos)
        if i0 >= last:
            out[i] = samples[last]
            continue
        frac = pos - i0
        s0 = samples[i0]
        s1 = samples[i0 + 1]
        out[i] = int(s0 + (s1 - s0) * frac)

    return out


def prepare_pcm(data: bytes, assume_rate: Optional[int] = None) -> bytes:
    """把任意 WAV / 裸 PCM 统一成 16kHz 16bit 单声道 PCM 字节。"""
    if not data:
        raise ASRError("音频为空")

    if data[:4] == b"RIFF":
        samples, rate = _pcm_from_wav(data)
    else:
        rate = assume_rate or SAMPLE_RATE
        samples = array.array("h")
        try:
            samples.frombytes(data[: len(data) // 2 * 2])
        except Exception as e:
            raise ASRError(f"裸 PCM 解析失败：{e}") from e

    if not len(samples):
        raise ASRError("音频为空")

    samples = _resample(samples, rate, SAMPLE_RATE)
    return samples.tobytes()


# ---------------- 文本整理 ---------------- #

_CJK_SPACE = re.compile(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])")
_SPACE_BEFORE_PUNCT = re.compile(r"\s+([。，！？；：、）】」》])")
_SPACES = re.compile(r"\s+")
_TRAIL_PUNCT = re.compile(r"[，、,]+$")


def tidy_text(text: str) -> str:
    """Vosk 中文输出是「你 好 呀」这种按词空格，拼回正常中文。"""
    if not text:
        return ""

    s = _CJK_SPACE.sub("", text.strip())
    s = _SPACE_BEFORE_PUNCT.sub(r"\1", s)
    s = _SPACES.sub(" ", s)
    s = _TRAIL_PUNCT.sub("", s)
    return s.strip()


# ---------------- 一次性识别 ---------------- #

_CHUNK = 4000  # 约 0.125s @16k/16bit


def recognize(data: bytes, assume_rate: Optional[int] = None) -> Dict[str, object]:
    """整段音频识别。返回 {"text", "duration", "ms", "segments"}。"""
    pcm = prepare_pcm(data, assume_rate)

    import vosk

    start = time.time()
    rec = vosk.KaldiRecognizer(get_model(), SAMPLE_RATE)

    parts = []
    for i in range(0, len(pcm), _CHUNK):
        if rec.AcceptWaveform(pcm[i : i + _CHUNK]):
            piece = json.loads(rec.Result()).get("text", "")
            if piece:
                parts.append(piece)

    tail = json.loads(rec.FinalResult()).get("text", "")
    if tail:
        parts.append(tail)

    text = tidy_text(" ".join(parts))

    return {
        "text": text,
        "duration": round(len(pcm) / 2 / SAMPLE_RATE, 2),
        "ms": int((time.time() - start) * 1000),
        "segments": len(parts),
    }


# ---------------- 流式识别（WebSocket 预留） ---------------- #

class StreamSession:
    """逐块喂音频的识别会话。

        session = StreamSession()
        session.feed(chunk)   → {"partial": "...", "final": False}
                             → {"text": "...", "final": True}   遇到停顿自动断句
        session.finish()      → "最后一句"
    """

    def __init__(self, sample_rate: int = SAMPLE_RATE):
        import vosk

        self.rate = sample_rate
        self.rec = vosk.KaldiRecognizer(get_model(), sample_rate)
        self.final_text = ""
        self.started_at = time.time()

    def feed(self, data: bytes) -> Dict[str, object]:
        if not data:
            return {"partial": "", "final": False}

        if self.rec.AcceptWaveform(data):
            text = tidy_text(json.loads(self.rec.Result()).get("text", ""))
            if text:
                self.final_text = (self.final_text + " " + text).strip()
            return {"text": text, "final": True}

        return {
            "partial": tidy_text(json.loads(self.rec.PartialResult()).get("partial", "")),
            "final": False,
        }

    def finish(self) -> str:
        text = tidy_text(json.loads(self.rec.FinalResult()).get("text", ""))
        if text:
            self.final_text = (self.final_text + " " + text).strip()
        return self.final_text
