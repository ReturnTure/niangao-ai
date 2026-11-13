"""
语音识别自测脚本（不需要启动 FastAPI，也不碰数据库）

用法：
    cd backend
    venv\\Scripts\\python.exe scripts\\asr_selftest.py
    venv\\Scripts\\python.exe scripts\\asr_selftest.py --tts          # 用 edge-tts 造一句中文再说给自己听
    venv\\Scripts\\python.exe scripts\\asr_selftest.py --wav demo.wav  # 识别指定音频

验证内容：
1. 文本整理（Vosk 输出的「你 好 呀」拼回正常中文）
2. WAV 解析与重采样（16k 单声道 / 44.1k 立体声都收）
3. vosk 与模型是否就绪
4. 真识别（有模型时）：把「你好，我是年糕」念出来再识别回来
"""

import argparse
import array
import io
import sys
import time
import wave
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.services import asr  # noqa: E402


def line(title):
    print("\n" + "=" * 58)
    print(title)
    print("=" * 58)


def check(cond, msg):
    print(("  [OK]   " if cond else "  [FAIL] ") + msg)
    return bool(cond)


def make_wav(samples: array.array, rate: int, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(samples.tobytes())
    return buf.getvalue()


def sine(rate: int, seconds: float, freq: int = 440) -> array.array:
    import math

    n = int(rate * seconds)
    out = array.array("h", [0]) * n
    for i in range(n):
        out[i] = int(12000 * math.sin(2 * math.pi * freq * i / rate))
    return out


def synth_chinese_mp3(text: str) -> bytes:
    import asyncio

    from app.services import tts

    return asyncio.run(tts.synthesize_bytes(text, preset="warm"))


def mp3_to_pcm(mp3: bytes):
    """测试专用：借 miniaudio 把 mp3 解成 16k 单声道 PCM（生产链路不需要它）"""
    import miniaudio

    decoded = miniaudio.decode(
        mp3,
        output_format=miniaudio.SampleFormat.SIGNED16,
        nchannels=1,
        sample_rate=16000,
    )
    return array.array("h", decoded.samples).tobytes()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--wav", help="要识别的音频文件（wav/mp3）")
    parser.add_argument("--tts", action="store_true", help="用 edge-tts 造一句中文来识别")
    args = parser.parse_args()

    ok = True

    # ---------------- 1. 文本整理 ----------------
    line("1. 文本整理")
    cases = [
        ("你 好 呀 我 是 年 糕", "你好呀我是年糕"),
        ("我 最 近 压 力 很 大 。", "我最近压力很大。"),
        ("  ", ""),
    ]
    for raw, expect in cases:
        got = asr.tidy_text(raw)
        print(f"  {raw!r:>34} → {got!r}")
        ok &= check(got == expect, f"期望 {expect!r}")

    # ---------------- 2. 音频解析 ----------------
    line("2. WAV 解析 / 重采样")
    pcm16k = asr.prepare_pcm(make_wav(sine(16000, 1.0), 16000))
    ok &= check(len(pcm16k) == 32000, f"16k 单声道 1 秒 = 32000 字节（实际 {len(pcm16k)}）")

    stereo = array.array("h")
    for s in sine(44100, 1.0):
        stereo.append(s)
        stereo.append(s)
    pcm44k = asr.prepare_pcm(make_wav(stereo, 44100, channels=2))
    ok &= check(abs(len(pcm44k) - 32000) < 400, f"44.1k 立体声重采样到 16k 单声道（实际 {len(pcm44k)} 字节）")

    try:
        asr.prepare_pcm(b"\x00\x01" * 100, assume_rate=16000)
        ok &= check(True, "裸 PCM（无 WAV 头）也能处理")
    except Exception as e:
        ok &= check(False, f"裸 PCM 处理失败：{e}")

    try:
        asr.prepare_pcm(b"not a wav at all")
        ok &= check(True, "垃圾数据不会崩")
    except asr.ASRError:
        ok &= check(True, "垃圾数据被明确拒绝（ASRError）")

    # ---------------- 3. 引擎状态 ----------------
    line("3. vosk / 模型状态")
    available, reason = asr.asr_available()
    print("  可用:", available, "|", reason)
    print("  模型:", asr.model_info())
    ok &= check(available or "模型" in reason or "vosk" in reason, "状态说明有助于排查")

    # ---------------- 4. 真识别 ----------------
    line("4. 真实识别")
    audio_bytes = None
    label = ""

    if args.wav:
        data = Path(args.wav).read_bytes()
        if args.wav.lower().endswith(".mp3"):
            audio_bytes = mp3_to_pcm(data)
            label = Path(args.wav).name + "（mp3→16k pcm）"
        else:
            audio_bytes = data
            label = Path(args.wav).name
    elif args.tts:
        try:
            mp3 = synth_chinese_mp3("你好，我是年糕。今天过得还好吗？")
            audio_bytes = mp3_to_pcm(mp3)
            label = "edge-tts 合成语音"
        except Exception as e:
            print("  合成失败，跳过：", repr(e))

    if not available:
        print("  跳过：模型没就绪。把 vosk-model-small-cn-0.22 解压到 backend/models/ 再跑。")
    elif not audio_bytes:
        print("  跳过：没给音频。用 --tts 或 --wav 指定一段。")
    else:
        try:
            start = time.time()
            result = asr.recognize(audio_bytes, assume_rate=16000)
            print(f"  音频来源: {label}")
            print(f"  识别文本: {result['text']!r}")
            print(f"  音频时长: {result['duration']}s | 识别耗时: {result['ms']}ms")
            ok &= check(bool(result["text"]), "识别出了非空文本（内容对不对要人耳判断）")
        except Exception as e:
            ok = False
            print("  识别失败:", repr(e))

    line("结果")
    print("  全部通过 ✅" if ok else "  有项目未通过 ❌（见上方 [FAIL]）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
