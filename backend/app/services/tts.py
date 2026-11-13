"""
年糕 · 语音播报服务（独立模块，不改动 chatbot.py / chat.py）

职责：
1. 文本清洗：把带 Markdown、表情、链接的回复洗成「适合念出来」的口语文本
2. 分句：流式回复是一小段一小段吐字的，按标点切成句子才能边生成边播
3. 合成：调用 edge-tts（微软 Edge 在线语音，免费、无需 API Key）生成 mp3
4. 缓存：同一句话只合成一次，重播 / 多端复用都走磁盘缓存

设计原则：
- 本文件不 import 项目内任何模块，可单独跑通（见 backend/scripts/tts_selftest.py）
- edge-tts 是可选依赖：没装时 tts_available() 返回 False，
  上层（前端）自动降级到浏览器内置语音，不会让功能整体挂掉
"""

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from typing import AsyncIterator, Dict, List, Optional, Tuple

# ---------------- 配置 ---------------- #

DEFAULT_VOICE = os.getenv("TTS_VOICE", "zh-CN-XiaoxiaoNeural").strip()
DEFAULT_PRESET = os.getenv("TTS_PRESET", "warm").strip()

# 单次合成的文本上限，防止被当成免费转码接口刷
MAX_TEXT_LEN = int(os.getenv("TTS_MAX_TEXT_LEN", "1200"))

CACHE_ENABLED = os.getenv("TTS_CACHE", "1").strip() != "0"
CACHE_MAX_FILES = int(os.getenv("TTS_CACHE_MAX_FILES", "400"))

# backend/.cache/tts —— 放在 backend 下，已在 .gitignore 里被忽略
CACHE_DIR = Path(
    os.getenv("TTS_CACHE_DIR")
    or (Path(__file__).resolve().parents[2] / ".cache" / "tts")
)

# 年糕的声音：默认用晓晓（温柔女声），最贴「软软暖暖」的人设
VOICES: List[Dict[str, str]] = [
    {
        "id": "zh-CN-XiaoxiaoNeural",
        "name": "晓晓",
        "gender": "女",
        "desc": "温柔、亲切，年糕默认的声音",
        "default": "1",
    },
    {
        "id": "zh-CN-XiaoyiNeural",
        "name": "晓伊",
        "gender": "女",
        "desc": "年轻活泼，像同龄朋友",
    },
    {
        "id": "zh-CN-YunxiNeural",
        "name": "云希",
        "gender": "男",
        "desc": "清朗温和，适合男生版年糕",
    },
    {
        "id": "zh-CN-YunjianNeural",
        "name": "云健",
        "gender": "男",
        "desc": "沉稳偏低，适合深夜电台感",
    },
    {
        "id": "zh-CN-liaoning-XiaobeiNeural",
        "name": "晓北",
        "gender": "女",
        "desc": "东北口音，亲人感强",
    },
    {
        "id": "zh-CN-shaanxi-XiaoniNeural",
        "name": "晓妮",
        "gender": "女",
        "desc": "陕西口音，接地气",
    },
]

# 语速 / 音高预设。心理陪伴场景默认偏慢一点，听着不催促
PRESETS: Dict[str, Dict[str, str]] = {
    "warm": {"rate": "-4%", "pitch": "+0Hz", "label": "温柔（默认）"},
    "calm": {"rate": "-10%", "pitch": "-2Hz", "label": "平静 · 适合睡前"},
    "slow": {"rate": "-18%", "pitch": "+0Hz", "label": "慢速 · 便于听清"},
    "cheerful": {"rate": "+6%", "pitch": "+3Hz", "label": "轻快 · 适合鼓励"},
}


class TTSError(RuntimeError):
    """合成失败（未装依赖、网络不通、文本为空等），上层据此降级。"""


# ---------------- 文本清洗 ---------------- #

_CODE_BLOCK = re.compile(r"```.*?```", re.S)
_INLINE_CODE = re.compile(r"`([^`]*)`")
_MD_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_URL = re.compile(r"https?://\S+|www\.\S+")
_HTML_TAG = re.compile(r"<[^>]{1,40}>")
_BULLET = re.compile(r"^[ \t]*(?:[-+*•]|\d+[.)、])[ \t]+", re.M)
_MD_MARKS = re.compile(r"[*_~`#>|]+")
_EMOJI = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # 表情、符号、旗帜
    "\U00002190-\U000021FF"  # 箭头
    "\U00002600-\U000027BF"  # 天气、杂项符号、dingbat
    "\U00002B00-\U00002BFF"
    "\U0000FE0F"             # 变体选择符
    "\U0000200D"             # 零宽连接符
    "]+",
    re.UNICODE,
)
_SPACES = re.compile(r"[ \t\u3000]+")
# 表情被删掉后会留下「了 。」这种多余空格，念出来会多一个停顿
_SPACE_BEFORE_PUNCT = re.compile(r"[ \t]+([。！？，、；：!?,;:）】」》])")
_BLANK_LINES = re.compile(r"\n{2,}")


def clean_for_speech(text: str) -> str:
    """把模型回复洗成适合朗读的文本。

    保留标点（标点决定停顿和语调），去掉 Markdown 符号、表情、链接、代码块——
    这些东西念出来是噪音，还容易被 TTS 念成「星号星号」。
    """
    if not text:
        return ""

    s = str(text)
    s = _CODE_BLOCK.sub(" ", s)
    s = _MD_IMAGE.sub(" ", s)
    s = _MD_LINK.sub(r"\1", s)
    s = _URL.sub(" ", s)
    s = _HTML_TAG.sub(" ", s)
    s = _INLINE_CODE.sub(r"\1", s)

    s = _BULLET.sub("", s)
    s = _MD_MARKS.sub("", s)
    s = _EMOJI.sub("", s)

    s = _SPACE_BEFORE_PUNCT.sub(r"\1", s)
    s = _SPACES.sub(" ", s)
    s = _BLANK_LINES.sub("\n", s)

    return s.strip()


# ---------------- 分句 ---------------- #

_SENT_END = "。！？!?…；;"
_SOFT_CUT = "，、,：: \n"


def _soft_cut(text: str, limit: int) -> int:
    """在 limit 之前找最靠后的逗号断开，找不到就硬切。"""
    for i in range(min(limit, len(text)) - 1, max(0, limit // 3), -1):
        if text[i] in _SOFT_CUT:
            return i + 1
    return limit


def split_sentences(text: str, min_len: int = 8, max_len: int = 70) -> List[str]:
    """整段文本切句：短句合并、长句再切，得到一串适合逐句合成的片段。"""
    if not text or not text.strip():
        return []

    raw: List[str] = []
    buf = ""

    for ch in text:
        buf += ch
        if ch in _SENT_END or ch == "\n":
            piece = buf.strip()
            if piece:
                raw.append(piece)
            buf = ""

    if buf.strip():
        raw.append(buf.strip())

    merged: List[str] = []
    carry = ""

    for piece in raw:
        # 合并短句时补一个逗号，否则「再慢慢吐出来」+「肩膀放松一点」
        # 会连成一口气念完，听起来很赶
        if carry and carry[-1] not in "。！？!?…；;，、,":
            carry += "，"
        carry = (carry + piece) if carry else piece
        if len(carry) >= min_len:
            merged.append(carry)
            carry = ""

    if carry:
        if merged:
            merged[-1] += carry
        else:
            merged.append(carry)

    result: List[str] = []
    for piece in merged:
        while len(piece) > max_len:
            cut = _soft_cut(piece, max_len)
            result.append(piece[:cut].strip())
            piece = piece[cut:].strip()
        if piece:
            result.append(piece)

    return [p for p in result if p]


class SentenceChunker:
    """流式分句器：一边吐 delta 一边产出「已经说完」的句子。

    用法（未来把 chat.py 接到语音上的关键）：
        chunker = SentenceChunker()
        async for delta in 模型的流:
            for sentence in chunker.feed(delta):
                await 合成并播放(sentence)
        for sentence in chunker.flush():
            ...
    """

    def __init__(self, min_len: int = 4, max_len: int = 70):
        self.min_len = max(1, min_len)
        self.max_len = max(8, max_len)
        self._buf = ""
        self._pending = ""  # 太短的句子先攒着，凑够再念

    def feed(self, delta: str) -> List[str]:
        if not delta:
            return []

        self._buf += delta
        out: List[str] = []

        while True:
            idx = -1
            for i, ch in enumerate(self._buf):
                if ch in _SENT_END or ch == "\n":
                    idx = i
                    break

            if idx < 0:
                break

            piece = self._buf[: idx + 1].strip()
            self._buf = self._buf[idx + 1 :]

            if not piece:
                continue

            text = self._pending + piece
            if len(text) < self.min_len:
                self._pending = text
                continue

            self._pending = ""
            out.append(text)

        # 长时间没有标点也要能开口，避免憋到最后一句
        while len(self._buf) > self.max_len:
            cut = _soft_cut(self._buf, self.max_len)
            text = self._pending + self._buf[:cut].strip()
            self._buf = self._buf[cut:]
            self._pending = ""
            if text.strip():
                out.append(text.strip())

        return out

    def flush(self) -> List[str]:
        rest = (self._pending + self._buf).strip()
        self._pending = ""
        self._buf = ""
        return [rest] if rest else []

    def reset(self) -> None:
        self._pending = ""
        self._buf = ""


# ---------------- 引擎状态 ---------------- #

_edge_tts = None
_edge_error = ""


def _load_edge():
    """懒加载 edge-tts，没装也不影响主服务启动。"""
    global _edge_tts, _edge_error

    if _edge_tts is not None:
        return _edge_tts

    try:
        import edge_tts  # noqa: F401

        _edge_tts = edge_tts
        return _edge_tts

    except Exception as e:  # ImportError 或环境异常
        _edge_error = f"edge-tts 不可用：{e}"
        return None


def tts_available() -> Tuple[bool, str]:
    """返回 (是否可用, 说明)。前端探测 /voice/health 后决定用哪个引擎。"""
    if os.getenv("TTS_ENABLED", "1").strip() == "0":
        return False, "TTS_ENABLED=0，语音合成已关闭"

    if _load_edge() is None:
        return False, _edge_error + "（执行 pip install edge-tts 后重启服务即可）"

    return True, "edge-tts"


# ---------------- 语速 / 音高 ---------------- #

def _resolve_prosody(
    preset: Optional[str],
    rate: Optional[str] = None,
    pitch: Optional[str] = None,
) -> Tuple[str, str]:
    name = (preset or DEFAULT_PRESET or "warm").strip()
    cfg = PRESETS.get(name, PRESETS["warm"])

    final_rate = (rate or cfg["rate"]).strip()
    final_pitch = (pitch or cfg["pitch"]).strip()

    return _normalize_rate(final_rate), _normalize_pitch(final_pitch)


def _normalize_rate(rate: str) -> str:
    """把 "10" / "10%" / "+10%" 统一成 edge-tts 要的 "+10%"。"""
    r = str(rate).strip().replace("%", "")
    if not r:
        return "+0%"
    try:
        value = int(float(r))
    except ValueError:
        return "+0%"
    value = max(-50, min(100, value))
    return f"{value:+d}%"


def _normalize_pitch(pitch: str) -> str:
    """把 "2" / "2Hz" / "-2Hz" 统一成 "+2Hz"。"""
    p = str(pitch).strip().replace("Hz", "").replace("hz", "")
    if not p:
        return "+0Hz"
    try:
        value = int(float(p))
    except ValueError:
        return "+0Hz"
    value = max(-50, min(50, value))
    return f"{value:+d}Hz"


def resolve_voice(voice: Optional[str]) -> str:
    v = (voice or DEFAULT_VOICE or "").strip()
    valid = {item["id"] for item in VOICES}
    return v if v in valid else DEFAULT_VOICE


# ---------------- 缓存 ---------------- #

def _cache_key(text: str, voice: str, rate: str, pitch: str) -> str:
    raw = f"{voice}|{rate}|{pitch}|{text}".encode("utf-8")
    return hashlib.sha1(raw).hexdigest()


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.mp3"


def _read_cache(key: str) -> Optional[bytes]:
    if not CACHE_ENABLED:
        return None
    path = _cache_path(key)
    try:
        if path.is_file() and path.stat().st_size > 0:
            return path.read_bytes()
    except OSError:
        pass
    return None


def _write_cache(key: str, data: bytes) -> None:
    if not CACHE_ENABLED or not data:
        return
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = _cache_path(key).with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(_cache_path(key))
        _prune_cache()
    except OSError as e:
        print("TTS CACHE WRITE ERROR:", e)


def _prune_cache() -> None:
    """超过上限就按修改时间删掉最旧的一批，防止缓存目录无限膨胀。"""
    try:
        files = sorted(
            (p for p in CACHE_DIR.glob("*.mp3")), key=lambda p: p.stat().st_mtime
        )
    except OSError:
        return

    extra = len(files) - CACHE_MAX_FILES
    for path in files[: max(0, extra)]:
        try:
            path.unlink()
        except OSError:
            pass


# ---------------- 合成 ---------------- #

async def iter_audio(
    text: str,
    voice: Optional[str] = None,
    preset: Optional[str] = None,
    rate: Optional[str] = None,
    pitch: Optional[str] = None,
) -> AsyncIterator[bytes]:
    """逐块产出 mp3 字节流。

    每个句子是独立的 mp3：前端可以拿到第一句就先播，
    不必等整段回复合成完——这是「边生成边播报」能成立的前提。
    """
    speech = clean_for_speech(text)

    if not speech:
        raise TTSError("文本为空，没有可播报的内容")

    if len(speech) > MAX_TEXT_LEN:
        speech = speech[:MAX_TEXT_LEN]

    if _load_edge() is None:
        raise TTSError(_edge_error or "edge-tts 不可用")

    edge_tts = _edge_tts
    final_voice = resolve_voice(voice)
    final_rate, final_pitch = _resolve_prosody(preset, rate, pitch)

    key = _cache_key(speech, final_voice, final_rate, final_pitch)
    cached = _read_cache(key)

    if cached:
        yield cached
        return

    buf = bytearray()

    communicate = edge_tts.Communicate(
        speech,
        final_voice,
        rate=final_rate,
        pitch=final_pitch,
    )

    async for event in communicate.stream():
        if event.get("type") != "audio":
            continue

        data = event.get("data") or b""
        if not data:
            continue

        buf.extend(data)
        yield data

    if buf:
        _write_cache(key, bytes(buf))


async def synthesize_bytes(
    text: str,
    voice: Optional[str] = None,
    preset: Optional[str] = None,
    rate: Optional[str] = None,
    pitch: Optional[str] = None,
) -> bytes:
    """一次拿到完整 mp3（预览、自我测试用）。"""
    chunks: List[bytes] = []
    async for piece in iter_audio(text, voice, preset, rate, pitch):
        chunks.append(piece)
    return b"".join(chunks)


def cache_stats() -> Dict[str, int]:
    try:
        files = list(CACHE_DIR.glob("*.mp3"))
        size = sum(p.stat().st_size for p in files)
    except OSError:
        files, size = [], 0
    return {"files": len(files), "bytes": size}


# ---------------- 便捷入口（给未来接入 chat.py 用） ---------------- #

async def speak_text(text: str, **kwargs) -> bytes:
    """一句话合成完，返回 mp3 字节。异常时抛 TTSError，由调用方决定降级。"""
    try:
        return await synthesize_bytes(text, **kwargs)
    except TTSError:
        raise
    except Exception as e:
        raise TTSError(f"语音合成失败：{e}") from e
