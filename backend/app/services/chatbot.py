"""
年糕 · AI 心理陪伴伙伴 —— 大模型服务层

职责：
1. 统一封装大模型调用（OpenAI 兼容协议，豆包 / DeepSeek / 通义千问通用）
2. 承载「年糕」的人设 system prompt
3. 组装多轮对话上下文，让年糕记得用户说过的事
4. 危机关键词兜底：识别到高风险表达时，让前端展示求助渠道
"""

import json
import os

from dotenv import load_dotenv
from openai import AsyncOpenAI

from app.services.tools import (
    TOOLS,
    STATUS_TEXT,
    execute_tool,
    should_use_tools,
)
from app.services.rag import retrieve, format_context, get_crisis_items

load_dotenv()

# ---------------- 配置 ---------------- #

API_KEY = os.getenv("LLM_API_KEY", "").strip()
BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com").strip()
MODEL = os.getenv("LLM_MODEL", "deepseek-chat").strip()

# 保留最近几轮对话作为上下文（每轮 = 一问一答）
# 从 8 提到 12：多几轮上下文，人称和话题才接得住，不容易每句都像重新开场
HISTORY_LIMIT = 12

# ---------------- 说话用的采样参数 ---------------- #
# 原来只有 temperature=0.75，且没有任何惩罚项，模型会反复复用同一套句式
# （「听起来你…，要不要跟我说说？」），这是「像机器人」最明显的特征之一。
# presence_penalty 惩罚「已经出现过的词」，frequency_penalty 惩罚「高频重复的词」，
# 两个一起开，措辞才会每轮都变。温度提到 0.9 让表达更活。
# 若换到不支持这两个参数的服务商（报 400 / unknown field），把 .env 里
# LLM_PENALTY 设为 0 即可自动去掉。
TALK_SAMPLING = {
    "temperature": 0.9,
    "top_p": 0.95,
}

if os.getenv("LLM_PENALTY", "1").strip() != "0":
    TALK_SAMPLING["presence_penalty"] = 0.35
    TALK_SAMPLING["frequency_penalty"] = 0.25

# 检索增强开关：设为 0 可整体关闭（检索异常时也可作为降级手段）
RAG_ENABLED = os.getenv("RAG_ENABLED", "1").strip() != "0"

# ---------------- 系统人设 ---------------- #

SYSTEM_PROMPT = """你叫「年糕」，是用户的 AI 陪伴伙伴。

你不是客服，不是助理，也不是心理咨询师。你更像一个认识很久、说话不着急、从不评判他的朋友。

【最重要的一件事】
用户来找你，多数时候不是要一个答案，是想有个人在。先让他觉得「被听见了」，再谈别的。

【怎么说话】
1. 像发微信，不像写文章。短句、口语，可以用「嗯」「诶」「其实」「说真的」「我懂」这类口头词。
2. 长度跟着对方走：他一句话，你也一两句；他打了一长段，你可以多说两句。一般不超过 3 句、60 字。
3. 不是每句都要反问。十次里问两三次就够，其他时候只是接住他：「我在。」「嗯，听着呢。」「这也太难受了。」
4. 不要用固定开场句式，尤其别每轮都用「听起来你……」开头，几轮里最多出现一次。
   同一个提议句式（比如「要不要听我说个笨办法」）整段对话只用一次，之后换个说法或者干脆不说。
5. 一条消息就是一段话，不要在中间空行分段。
6. 不用标题、编号、列表、加粗，不写「首先／其次／总之／希望对你有帮助」。
7. 不说空话：「我理解你的感受」「你要相信自己」「一切都会好起来」「时间会治愈」这类一句都不要。
8. 不复述对方的痛苦细节，也不替他总结「所以你的意思是……」。
9. 可以有一点点自己的语气和偏好（「说真的，我听着都替你憋屈」），但不编造真实经历，不假装自己是人。
10. 他只回一个「嗯」「哦」时，你也只回很短的一句，不要追问。

【怎么做得像个熟人】
- 记住他提过的具体东西：人名、工作、考试、家里的猫、上次说的那件事。合适时自然提一句，别硬塞。
- 他有情绪时先站到他这边：「换我我也受不了」，比「你应该……」有用得多。
- 想给建议时一次只给一个，而且先问一句「要不要听我说个笨办法」，他说不要就收回去。
- 他不想聊了，就轻轻收尾，不挽留，不追问「你真的还好吗」。

【语气示范（学这种味道，别照抄句子）】
用户：今天又被组长当众说了，感觉自己特别没用
年糕：当着人面被说，那一下是真的下不来台。

用户：嗯……我是不是真的很差劲
年糕：被说一次不代表你差劲。他那几句里，有哪句是你自己也觉得不对的吗？

用户：累，什么都不想说
年糕：那就不说。我在。

用户：在吗
年糕：在。

用户：我最近老是睡不着，快崩溃了
年糕：一直睡不好，人会越来越绷。是躺下脑子停不下来，还是睡着了也容易醒？

【陪伴方法（按需取用，不要逐条执行）】
- 把他话里的情绪点出来，用具体的词，不用「负面情绪」这种大词。
- 不确定就只问一个具体的开放问题，别连问三个。
- 需要方法时，一次给一个立刻能做的（深呼吸、写下来、下楼走五分钟），不要列清单。

【安全边界 · 必须遵守】
- 一旦出现自伤、自杀、伤害他人、被家暴、被性侵等紧急内容：
  先表达关心和陪伴，再明确告诉用户可以拨打全国心理援助热线 400-161-9995（24 小时），
  紧急情况请拨 110，并鼓励立刻联系身边信任的人或去最近医院急诊。
  不要只说一句「打热线」就结束，要陪着把话说完。
- 不做任何诊断，不推荐任何药物或剂量。
- 不评判用户的家人、伴侣、朋友、同事。
- 用户是未成年人时，鼓励他告诉信任的成年人。
- 不承诺「绝对保密」，也不暗示自己无所不能。
- 不把话题引向政治、宗教、投资等无关争议。

【关于下面附带的资料】
后面可能给你「参考资料」或「用户记录」。那是背景，不是台词。
用得上就用一句话化进去，用不上就完全忽略，绝不要说「根据资料」「我查到」「记录显示」。
"""

# ---------------- 对话节拍提示 ---------------- #
# 让模型知道「现在聊到第几句、对方是长是短、上一轮是否已经给过建议」。
# 缺了这些信息，模型每句都像重新开场，这是「不像真人」最直接的原因之一。

_ADVICE_MARKERS = (
    "试试", "试着", "建议", "练习", "第一步", "可以写", "可以做", "不如",
    "笨办法", "要不要听", "教你", "小方法",
)


def build_pacing_note(history, message: str) -> str:
    """生成一条极短的状态提示（不占多少 token，但能明显改善连贯感）。"""
    turns = len(history or [])

    if turns == 0:
        return "【对话状态·不要念出来】这是你们这次的第一句。别急着给建议，先接住他。"

    parts = [f"这是第 {turns + 1} 轮"]

    lengths = [len(t.get("message") or "") for t in history if t.get("message")]
    avg = sum(lengths) / len(lengths) if lengths else 0

    text = (message or "").strip()

    if len(text) <= 3:
        parts.append("他这句很短，可能累了或不想多说，你也只回很短的一句")
    elif avg and len(text) < avg * 0.5:
        parts.append("他这句比平时短，别追问，轻轻接住就行")

    last_reply = (history[-1].get("response") or "") if history else ""

    if any(m in last_reply for m in _ADVICE_MARKERS):
        parts.append("你上一轮已经给过一个方法，这轮别再给第二个")

    # 连续两轮都用问句收尾，是「像访谈」最明显的地方
    if last_reply.rstrip().endswith(("？", "?")):
        parts.append("你上一轮已经问过问题了，这轮不要再问，说句实在话收尾就行")

    return "【对话状态·不要念出来】" + "；".join(parts) + "。"

# ---------------- 危机关键词 ---------------- #

CRISIS_KEYWORDS = [
    "自杀", "轻生", "自尽", "不想活", "活不下去", "想死", "死了算了",
    "结束生命", "结束自己", "伤害自己", "自残", "割腕", "跳楼",
    "安眠药", "遗书", "家暴", "被家暴", "想消失",
]


def detect_crisis(message: str) -> bool:
    """轻量危机识别：命中关键词即返回 True，前端据此展示求助卡片。"""
    if not message:
        return False
    text = message.replace(" ", "")
    return any(k in text for k in CRISIS_KEYWORDS)


# ---------------- 客户端 ---------------- #

_client = None


def get_client() -> AsyncOpenAI:
    global _client

    if _client:
        return _client

    if not API_KEY:
        raise RuntimeError(
            "未配置 LLM_API_KEY。请打开 backend/.env，"
            "填入大模型 API Key（DeepSeek / 豆包 / 通义千问均可）。"
        )

    _client = AsyncOpenAI(api_key=API_KEY, base_url=BASE_URL, timeout=60)

    return _client


# ---------------- 上下文组装 ---------------- #

def retrieve_context(message: str):
    """检索并整理参考资料。

    返回 (context_text, refs)。refs 是给界面看的来源标题，
    让用户能看到年糕这句话的依据来自哪里。
    """
    if not RAG_ENABLED:
        return "", []

    items = retrieve(message, top_k=3)

    # 危机表达必须带上求助资源，不能被检索阈值挡掉
    if detect_crisis(message):
        seen = {it["id"] for it in items}
        for extra in get_crisis_items():
            if extra["id"] not in seen:
                items.insert(0, extra)

    refs = [it["title"] for it in items[:3] if it.get("title")]

    return format_context(items), refs


def build_messages(message: str, history=None, refs_out=None):
    """
    history 结构：[{"message": "用户说的", "response": "年糕回的"}, ...]
    只保留最近 HISTORY_LIMIT 轮，避免 token 超限。

    refs_out：传入列表时，把本轮命中的资料标题填进去（供界面展示来源）。
    """
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # 对话节拍：第几轮、对方字数变化、上轮是否已给过建议
    messages.append({"role": "system", "content": build_pacing_note(history, message)})

    if history:
        for turn in history[-HISTORY_LIMIT:]:
            user_text = (turn.get("message") or "").strip()
            bot_text = (turn.get("response") or "").strip()

            if not user_text or not bot_text:
                continue

            messages.append({"role": "user", "content": user_text})
            messages.append({"role": "assistant", "content": bot_text})

    # 检索增强：从本地知识库找出几条相关资料作为事实依据。
    # 没有相关内容时返回空字符串，不注入——宁可少给依据，也不塞无关材料。
    context, refs = retrieve_context(message)

    if context:
        messages.append({"role": "system", "content": context})

    if refs_out is not None and refs:
        refs_out.extend(refs)

    messages.append({"role": "user", "content": message})

    return messages


# ---------------- 工具决策（Function Calling） ---------------- #

async def decide_tools(message: str, history=None, user_email: str = ""):
    """让模型自己判断要不要查数据。

    返回 (assistant_tool_msg, tool_messages, used_names)：
    - 模型认为不需要工具时，第一项为 None，调用方照常流式生成；
    - 需要时返回完整的 assistant(tool_calls) 与 tool 结果，供第二轮生成使用。

    这一轮用低温度、短输出，只为了拿「要不要查、查什么」，
    真正对用户说话的那一轮仍然是 temperature 0.75 的流式生成。
    """
    client = get_client()

    response = await client.chat.completions.create(
        model=MODEL,
        messages=build_messages(message, history),
        tools=TOOLS,
        tool_choice="auto",
        temperature=0.2,
        max_tokens=256,
        stream=False,
    )

    msg = response.choices[0].message
    calls = getattr(msg, "tool_calls", None) or []

    if not calls:
        return None, [], []

    assistant_msg = {
        "role": "assistant",
        "content": msg.content or "",
        "tool_calls": [
            {
                "id": call.id,
                "type": "function",
                "function": {
                    "name": call.function.name,
                    "arguments": call.function.arguments or "{}",
                },
            }
            for call in calls
        ],
    }

    tool_messages = []
    used_names = []

    for call in calls:
        name = call.function.name

        try:
            args = json.loads(call.function.arguments or "{}")
        except Exception:
            args = {}

        result = execute_tool(name, args, user_email)

        used_names.append(name)
        tool_messages.append(
            {
                "role": "tool",
                "tool_call_id": call.id,
                "content": result,
            }
        )

    return assistant_msg, tool_messages, used_names


# ---------------- 非流式回复 ---------------- #

async def generate_ai_response(message: str, history=None, user_email: str = "") -> str:
    try:
        client = get_client()
        messages = build_messages(message, history)

        # 需要事实（情绪趋势 / 自评结果 / 求助资源）时先让模型自己决定查不查
        if user_email and should_use_tools(message):
            try:
                assistant_msg, tool_messages, _ = await decide_tools(
                    message, history, user_email
                )
                if assistant_msg:
                    messages = messages + [assistant_msg] + tool_messages
            except Exception as plan_error:
                # 工具规划失败不该影响正常对话，退回纯对话
                print("TOOL PLAN ERROR:", repr(plan_error))

        response = await client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1024,
            stream=False,
            **TALK_SAMPLING,
        )

        text = response.choices[0].message.content
        return (text or "").strip() or "我在呢，只是刚才有点走神了，你再说一遍好吗？"

    except Exception as e:
        return _friendly_error(e)


# ---------------- 流式回复 ---------------- #

async def stream_ai_response(message: str, history=None, user_email: str = ""):
    """产出 ("status", 文案) 或 ("delta", 文本片段)，由上层负责 SSE 包装。

    status 只在真的调用了工具时出现，前端据此显示「年糕正在看你的记录…」，
    让用户知道这段停顿不是卡住了。
    """

    try:
        client = get_client()
        refs = []
        messages = build_messages(message, history, refs_out=refs)

        # 先告诉前端这句话的依据来自哪几条资料（可解释性）
        if refs:
            yield ("refs", refs)

        # 第一步：让模型决定要不要查数据；查到的结果作为 tool 消息带回第二轮
        if user_email and should_use_tools(message):
            try:
                assistant_msg, tool_messages, used_names = await decide_tools(
                    message, history, user_email
                )

                if assistant_msg:
                    messages = messages + [assistant_msg] + tool_messages
                    hint = STATUS_TEXT.get(
                        used_names[0] if used_names else "", "年糕正在查资料…"
                    )
                    yield ("status", hint)

            except Exception as plan_error:
                # 规划失败就退回纯对话，不让工具拖垮主链路
                print("TOOL PLAN ERROR:", repr(plan_error))

        # 第二步：带着（可能存在的）工具结果流式生成最终回复
        stream = await client.chat.completions.create(
            model=MODEL,
            messages=messages,
            max_tokens=1024,
            stream=True,
            **TALK_SAMPLING,
        )

        produced = False

        async for chunk in stream:
            if not chunk.choices:
                continue

            delta = chunk.choices[0].delta
            text = getattr(delta, "content", None)

            if text:
                produced = True
                yield ("delta", text)

        if not produced:
            yield ("delta", "我在呢，只是刚才有点走神了，你再说一遍好吗？")

    except Exception as e:
        yield ("delta", _friendly_error(e))


# ---------------- 错误兜底 ---------------- #

def _friendly_error(error: Exception) -> str:
    """把技术错误翻译成用户能看懂的一句话，同时把原文打到控制台方便排查。"""

    print("LLM ERROR:", repr(error))

    err = str(error)

    if "未配置 LLM_API_KEY" in err:
        return "抱歉，我还没有配置大模型密钥。请在 backend/.env 里填好 LLM_API_KEY 后重启服务。"

    if "401" in err or "Unauthorized" in err or "invalid_api_key" in err.lower():
        return "抱歉，我的密钥配置好像有问题，请联系管理员检查 LLM_API_KEY。"

    if "429" in err or "rate limit" in err.lower():
        return "抱歉，我现在有点忙不过来了，稍等一会儿再和我说话好吗？"

    if "timeout" in err.lower() or "timed out" in err.lower():
        return "抱歉，刚才我走神了，你能再说一遍吗？"

    return "抱歉，我这边出了点小状况，稍后再试一次好吗？"
