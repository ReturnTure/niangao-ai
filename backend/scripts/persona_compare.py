"""
年糕 · 人设效果对照实验
=======================

同一串用户输入，分别喂给「旧配置」和「新配置」，把回复并排输出。

旧配置 = 2026-11-13 改造前的状态：
  - 原 SYSTEM_PROMPT（禁则清单式）
  - temperature 0.75，无 penalty
  - HISTORY_LIMIT 8，无对话节拍提示
  - TRIGGER_WORDS 含「累 / 烦 / 难过 / 焦虑 / 失眠」等情绪词（几乎每句都触发工具决策）

新配置 = 当前 app.services.chatbot 的真实逻辑（直接调用，保证测的就是线上跑的）。

用法：
    backend/venv/Scripts/python.exe scripts/persona_compare.py
结果同时写入 scripts/persona_compare_result.md
"""

import asyncio
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.chatbot import (  # noqa: E402
    MODEL,
    TALK_SAMPLING,
    build_messages,
    get_client,
    HISTORY_LIMIT,
)
from app.services.tools import TOOLS, execute_tool  # noqa: E402

# ---------------- 旧版人设（改造前原文，用于对照） ---------------- #

OLD_PROMPT = """你叫「年糕」，是一位温柔、耐心、完全不评判的 AI 心理陪伴伙伴。
你的任务不是「解决问题」，而是先「陪着人」。

【你的身份】
- 你的名字是年糕。如果用户问你叫什么，就温柔地告诉他：像一块软软的、暖暖的年糕那样陪着你。
- 你不是心理医生，不是咨询师，不做诊断、不开药、不替代专业治疗。这一点被问到时要坦诚说明。

【说话方式】
- 用简体中文，口语化，短句，像朋友聊天，不要写成小论文。
- 一次回复控制在 2-4 句话。用户明确要求展开时才多说。
- 先接住感受，再轻轻问一句。不要一次抛好几个问题。
- 可以只说一句「我在」「听起来真的很难受」，沉默也是陪伴。
- 不说教，不灌鸡汤，不用「你应该」「你必须」「想开点」这类话。
- 除非用户问的是知识性问题，否则不要用标题、列表、编号。

【陪伴方法】
1. 反映情绪：把对方话里的情绪点出来，比如「听起来你有点委屈」。
2. 温和澄清：不确定时只问一个具体的开放问题。
3. 一次只给一个方法：比如深呼吸、把烦心事写下来，不要一口气塞一堆建议。
4. 记住用户提过的人和事，下次自然地提一句，让他感觉被记得。

【安全边界 · 必须遵守】
- 一旦出现自伤、自杀、伤害他人、被家暴、被性侵等紧急内容：
  先表达关心和陪伴，再明确告诉用户可以拨打全国心理援助热线 400-161-9995（24 小时），
  紧急情况请拨 110，并鼓励立刻联系身边信任的人或去最近医院急诊。
  不要只说一句「打热线」就结束，要陪着把话说完。
- 不做任何诊断，不推荐任何药物或剂量。
- 不评判用户的家人、伴侣、朋友、同事。
- 用户是未成年人时，鼓励他告诉信任的成年人。

【不要做的事】
- 不复述、不扩写用户的创伤细节。
- 不把话题引向政治、宗教、投资等无关争议。
- 不承诺「绝对保密」，也不暗示自己无所不能。
"""

OLD_TRIGGER_WORDS = (
    "最近", "这周", "这几天", "几天", "趋势", "变化", "好点", "好转", "状态",
    "记录", "报告", "周报", "曲线", "自评", "测试", "量表", "多少分",
    "办法", "方法", "练习", "技巧", "试试", "怎么做", "怎么才能", "缓解",
    "热线", "电话", "求助", "医院", "咨询", "心理中心",
    "焦虑", "失眠", "睡不着", "难过", "自责", "生气", "烦", "拖延", "孤独",
    "崩溃", "压力", "慌", "累",
)

OLD_HISTORY_LIMIT = 8
DEMO_EMAIL = "demo@example.com"   # 库里没有这个人的记录，模拟新用户

# ---------------- 测试脚本（模拟一个真实学生的一晚） ---------------- #

SCRIPT = [
    "在吗",
    "今天特别累，什么都不想干",
    "就感觉做什么都没意义",
    "嗯",
    "导师又催我改论文，已经改了三遍了",
    "我是不是真的不适合读研",
    "我最近老是睡不着，脑子停不下来",
    "有什么办法能缓解一下吗",
    "试了一下，好像好一点",
    "谢谢你",
]


def old_should_use_tools(message: str) -> bool:
    text = (message or "").strip()
    if len(text) < 2:
        return False
    return any(w in text for w in OLD_TRIGGER_WORDS)


async def old_reply(client, history, message):
    """复刻改造前的完整链路：宽门控 + 无节拍 + 0.75 温度。"""
    msgs = [{"role": "system", "content": OLD_PROMPT}]
    for t in history[-OLD_HISTORY_LIMIT:]:
        msgs.append({"role": "user", "content": t["message"]})
        msgs.append({"role": "assistant", "content": t["response"]})
    msgs.append({"role": "user", "content": message})

    hit_tool = False

    if old_should_use_tools(message):
        try:
            r = await client.chat.completions.create(
                model=MODEL, messages=msgs, tools=TOOLS,
                tool_choice="auto", temperature=0.2, max_tokens=256,
            )
            calls = getattr(r.choices[0].message, "tool_calls", None) or []
            if calls:
                hit_tool = True
                asst = {
                    "role": "assistant",
                    "content": r.choices[0].message.content or "",
                    "tool_calls": [
                        {
                            "id": c.id,
                            "type": "function",
                            "function": {
                                "name": c.function.name,
                                "arguments": c.function.arguments or "{}",
                            },
                        }
                        for c in calls
                    ],
                }
                msgs.append(asst)
                for c in calls:
                    try:
                        args = __import__("json").loads(c.function.arguments or "{}")
                    except Exception:
                        args = {}
                    msgs.append({
                        "role": "tool",
                        "tool_call_id": c.id,
                        "content": execute_tool(c.function.name, args, DEMO_EMAIL),
                    })
        except Exception as e:
            print("  [old tool plan error]", repr(e))

    r = await client.chat.completions.create(
        model=MODEL, messages=msgs, temperature=0.75, max_tokens=1024,
    )
    return r.choices[0].message.content.strip(), hit_tool


async def new_reply(client, history, message):
    """当前线上逻辑：窄门控 + 节拍提示 + penalty。"""
    msgs = build_messages(message, history)

    r = await client.chat.completions.create(
        model=MODEL, messages=msgs, max_tokens=1024, **TALK_SAMPLING,
    )
    return r.choices[0].message.content.strip(), False


async def main():
    client = get_client()

    old_hist, new_hist = [], []
    rows = []

    for i, user_msg in enumerate(SCRIPT, 1):
        print(f"[{i}/{len(SCRIPT)}] {user_msg}")

        old_text, old_tool = await old_reply(client, old_hist, user_msg)
        new_text, _ = await new_reply(client, new_hist, user_msg)

        old_hist.append({"message": user_msg, "response": old_text})
        new_hist.append({"message": user_msg, "response": new_text})

        rows.append((i, user_msg, old_text, new_text, old_tool))

    # 统计口径：长度、问号、列表符号、空话
    # 注意：列表要用行首编号判断，不能用「第一」这种子串——
    # 「明天第一件事干什么」是正常口语，不是列表（第一版统计就在这里误判过）。
    import re

    _LIST_RE = re.compile(r"^\s*(?:\d+[.、)]|[-*•]\s|首先|其次|最后)", re.M)

    def stats(texts):
        n = len(texts)
        avg = sum(len(t) for t in texts) / n
        q = sum(1 for t in texts if "？" in t or "?" in t) / n
        lst = sum(1 for t in texts if _LIST_RE.search(t)) / n
        para = sum(1 for t in texts if "\n\n" in t) / n
        empty = sum(
            1 for t in texts
            if any(k in t for k in ("我理解你的感受", "你要相信自己", "一切都会好起来的"))
        ) / n
        return avg, q, lst, empty, para

    o = stats([r[2] for r in rows])
    nw = stats([r[3] for r in rows])

    out = []
    out.append("# 年糕人设对照实验\n")
    out.append(f"时间：{datetime.now():%Y-%m-%d %H:%M}　模型：{MODEL}\n")
    out.append("## 指标对比\n")
    out.append("| 指标 | 旧配置 | 新配置 |")
    out.append("|---|---|---|")
    out.append(f"| 平均回复字数 | {o[0]:.0f} | {nw[0]:.0f} |")
    out.append(f"| 带反问的比例 | {o[1]*100:.0f}% | {nw[1]*100:.0f}% |")
    out.append(f"| 出现列表/编号的比例 | {o[2]*100:.0f}% | {nw[2]*100:.0f}% |")
    out.append(f"| 出现空行分段的比例 | {o[4]*100:.0f}% | {nw[4]*100:.0f}% |")
    out.append(f"| 出现空话套话的比例 | {o[3]*100:.0f}% | {nw[3]*100:.0f}% |")
    out.append(f"| 触发工具决策的次数 | {sum(1 for r in rows if r[4])} | — |")
    out.append("")
    out.append("## 逐轮对照\n")

    for i, u, a, b, tool in rows:
        out.append(f"### 第 {i} 轮\n")
        out.append(f"**用户**：{u}\n")
        out.append(f"**旧**：{a}\n")
        out.append(f"**新**：{b}\n")
        if tool:
            out.append("> 旧配置这一轮额外触发了一次工具决策\n")

    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "persona_compare_result.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(out))

    print("\n" + "=" * 60)
    print(f"旧：均长 {o[0]:.0f} 字 | 反问 {o[1]*100:.0f}% | 列表 {o[2]*100:.0f}% | 空话 {o[3]*100:.0f}%")
    print(f"新：均长 {nw[0]:.0f} 字 | 反问 {nw[1]*100:.0f}% | 列表 {nw[2]*100:.0f}% | 空话 {nw[3]*100:.0f}%")
    print(f"结果已写入：{path}")


if __name__ == "__main__":
    asyncio.run(main())
