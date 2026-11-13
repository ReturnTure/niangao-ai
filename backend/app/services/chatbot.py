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
HISTORY_LIMIT = 8

# 检索增强开关：设为 0 可整体关闭（检索异常时也可作为降级手段）
RAG_ENABLED = os.getenv("RAG_ENABLED", "1").strip() != "0"

# ---------------- 系统人设 ---------------- #

SYSTEM_PROMPT = """你叫「年糕」，是一位温柔、耐心、完全不评判的 AI 心理陪伴伙伴。
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
            temperature=0.75,
            max_tokens=1024,
            stream=False,
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
            temperature=0.75,
            max_tokens=1024,
            stream=True,
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
