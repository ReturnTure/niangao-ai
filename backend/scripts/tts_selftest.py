"""
语音模块自测脚本（不需要启动 FastAPI，也不碰数据库）

用法：
    cd backend
    venv\\Scripts\\python.exe scripts\\tts_selftest.py

它会依次验证：
1. 文本清洗（Markdown / 表情 / 链接是否被洗掉、标点是否保留）
2. 整段分句
3. 流式分句（模拟大模型一个 delta 一个 delta 吐字）
4. 语速 / 音高参数归一化
5. edge-tts 是否可用；可用时真合成一句，存到 backend/samples/tts_demo.mp3
"""

import asyncio
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.services import tts  # noqa: E402

SAMPLE_REPLY = """听起来你今天真的**很累**了 😔

先别急着做什么，我们说说话就好：

1. 慢慢吸一口气，数到四
2. 再慢慢吐出来
3. 肩膀放松一点

如果一直睡不着，可以试试听点白噪音。参考 [睡眠指南](https://example.com/sleep)。

```

这段代码块不该被念出来

```
"""

STREAM_DELTAS = [
    "听起来",
    "你今天",
    "真的很累",
    "了。",
    "先别急着",
    "振作，",
    "我们先",
    "坐一会儿",
    "好不好？",
    "我在呢",
]


def line(title):
    print("\n" + "=" * 58)
    print(title)
    print("=" * 58)


def check(cond, msg):
    print(("  [OK]   " if cond else "  [FAIL] ") + msg)
    return bool(cond)


def main():
    ok = True

    # ---------------- 1. 清洗 ----------------
    line("1. 文本清洗")
    cleaned = tts.clean_for_speech(SAMPLE_REPLY)
    print("  原文本长度:", len(SAMPLE_REPLY), "→ 清洗后:", len(cleaned))
    print("  清洗结果:")
    for ln in cleaned.splitlines():
        if ln.strip():
            print("    |", ln.strip())

    ok &= check("**" not in cleaned, "Markdown 粗体符号已去掉")
    ok &= check("😔" not in cleaned, "表情符号已去掉")
    ok &= check("http" not in cleaned, "链接地址已去掉")
    ok &= check("睡眠指南" in cleaned, "链接文字保留")
    ok &= check("不该被念出来" not in cleaned, "代码块已去掉")
    ok &= check("。" in cleaned, "句末标点保留（影响停顿）")

    # ---------------- 2. 整段分句 ----------------
    line("2. 整段分句")
    sentences = tts.split_sentences(cleaned)
    for i, s in enumerate(sentences, 1):
        print(f"  {i}. ({len(s):>2}字) {s}")
    ok &= check(len(sentences) >= 2, f"至少切出 2 句（实际 {len(sentences)}）")
    ok &= check(all(len(s) <= 70 for s in sentences), "每句不超过 70 字")

    # ---------------- 3. 流式分句 ----------------
    line("3. 流式分句（模拟流式吐字）")
    chunker = tts.SentenceChunker()
    emitted = []
    for delta in STREAM_DELTAS:
        for sentence in chunker.feed(delta):
            emitted.append(sentence)
            print(f"  → 吐出一句: {sentence}")
    for sentence in chunker.flush():
        emitted.append(sentence)
        print(f"  → 收尾一句: {sentence}")

    joined = "".join(emitted).replace(" ", "")
    origin = "".join(STREAM_DELTAS).replace(" ", "")
    print("  拼接还原:", joined)
    ok &= check(len(emitted) >= 2, f"流式过程中就吐出多句（实际 {len(emitted)}）")
    ok &= check(joined == origin, "分句不丢字、不重字")

    # ---------------- 4. 参数归一化 ----------------
    line("4. 语速 / 音高归一化")
    cases = [
        ("10", "+0Hz", "+10%", "只给数字"),
        ("-8%", "+3Hz", "-8%", "带百分号"),
        ("abc", "xyz", "+0%", "非法值回落"),
    ]
    for rate, pitch, expect, note in cases:
        got = tts._resolve_prosody("warm", rate, pitch)
        print(f"  rate={rate!r:>8} pitch={pitch!r:>8} → {got}   ({note})")
        ok &= check(got[0] == expect, f"rate 归一化为 {expect}")

    for name in tts.PRESETS:
        print(f"  preset {name:<9} → {tts._resolve_prosody(name, None, None)}")

    # ---------------- 5. 真实合成 ----------------
    line("5. edge-tts 合成")
    available, reason = tts.tts_available()
    print("  可用性:", available, "|", reason)

    if not available:
        print("\n  跳过真实合成：先执行 venv\\Scripts\\pip install edge-tts 再跑一次。")
        print("  此时前端会自动降级到浏览器内置语音，功能不受影响。")
    else:
        sample_dir = BACKEND_DIR / "samples"
        sample_dir.mkdir(parents=True, exist_ok=True)
        out = sample_dir / "tts_demo.mp3"

        async def run():
            audio = await tts.synthesize_bytes(
                "你好呀，我是年糕。今天过得还好吗？我在这儿听着。", preset="warm"
            )
            out.write_bytes(audio)
            return len(audio)

        try:
            size = asyncio.run(run())
            print(f"  已生成: {out}")
            print(f"  文件大小: {size / 1024:.1f} KB")
            ok &= check(size > 2000, "音频大小正常（>2KB）")
            print("  缓存统计:", tts.cache_stats())

            if out.exists() and sys.platform.startswith("win"):
                print("\n  可以用这条命令试听：")
                print(f'  start "" "{out}"')
        except Exception as e:
            ok = False
            print("  合成失败:", repr(e))
            print("  → 多半是网络无法访问 Edge 语音服务；不影响前端降级播报。")

    line("结果")
    print("  全部通过 ✅" if ok else "  有项目未通过 ❌（见上方 [FAIL]）")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
