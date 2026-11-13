"""
年糕 · 工具层（Function Calling）

让模型在"需要事实"的时候自己决定去查，而不是靠猜：
- 用户问「我最近是不是好一点了」→ 查情绪趋势
- 用户问「我上次测试多少分」→ 查 PHQ-9 记录
- 用户说「有什么办法」→ 从 CBT 小知识库里挑一条
- 出现危机表达 → 取求助资源

设计原则：
1. 工具只读，不写库。模型不能通过工具改数据。
2. 每个工具都要有兜底：查不到就返回一句「这次没查到」，绝不抛异常打断对话。
3. 返回给模型的文本要短——工具结果是给模型看的，不是给用户看的。
"""

from datetime import datetime, timedelta

from app.db.database import chats, assessments

LOCAL_OFFSET_HOURS = 8


# ---------------- 工具声明（OpenAI 兼容 schema） ---------------- #

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_emotion_trend",
            "description": (
                "查询用户最近若干天的情绪走势：每日平均分、出现最多的情绪、"
                "以及后半段相比前半段是变轻还是变重。"
                "当用户问『我最近怎么样』『有没有好一点』『这周状态如何』时调用。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "回看天数，3 到 30，默认 7",
                        "minimum": 3,
                        "maximum": 30,
                    }
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_last_phq9",
            "description": (
                "查询用户最近一次 PHQ-9 情绪自评的结果：总分、困扰等级、"
                "第 9 题（自伤念头）是否为 0。"
                "当用户问『我上次测试多少分』『我的自评结果』时调用。"
            ),
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "suggest_exercise",
            "description": (
                "从 CBT（认知行为疗法）自助技巧库里，按话题挑一条具体可执行的小练习。"
                "当用户明确说自己难受、焦虑、失眠、自责、拖延、生气，"
                "并且适合给一个具体方法时调用。返回的是练习步骤，不是诊断。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "topic": {
                        "type": "string",
                        "description": "话题关键词，例如：焦虑、失眠、自责、愤怒、拖延、低落、孤独、反刍",
                    }
                },
                "required": ["topic"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_crisis_resources",
            "description": (
                "获取危机求助资源：24 小时心理援助热线、报警与急救电话、"
                "以及就近可以去的专业机构类型。"
                "当用户表达自伤、自杀、被家暴等紧急情况时调用，配合安抚一起给出。"
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "用户所在城市，可为空；为空时给通用建议",
                    }
                },
                "required": [],
            },
        },
    },
]


# 调用工具时给用户看的一句话（前端据此显示"处理中"状态）
STATUS_TEXT = {
    "get_emotion_trend": "年糕正在翻看你最近的情绪记录…",
    "get_last_phq9": "年糕正在看你的自评记录…",
    "suggest_exercise": "年糕在挑一个适合你的小练习…",
    "get_crisis_resources": "年糕在查求助资源…",
}


# 只有出现这些信号才值得多花一次模型调用去决策，避免每句话都多跑一轮
TRIGGER_WORDS = (
    "最近", "这周", "这几天", "几天", "趋势", "变化", "好点", "好转", "状态",
    "记录", "报告", "周报", "曲线", "自评", "测试", "量表", "多少分",
    "办法", "方法", "练习", "技巧", "试试", "怎么做", "怎么才能", "缓解",
    "热线", "电话", "求助", "医院", "咨询", "心理中心",
    "焦虑", "失眠", "睡不着", "难过", "自责", "生气", "烦", "拖延", "孤独",
    "崩溃", "压力", "慌", "累",
)


def should_use_tools(message: str) -> bool:
    """轻量触发判断：便宜的本地判断，省掉不必要的工具决策调用。"""
    text = (message or "").strip()
    if len(text) < 2:
        return False
    return any(word in text for word in TRIGGER_WORDS)


# ---------------- 工具实现 ---------------- #

def _to_local(dt: datetime) -> datetime:
    return dt + timedelta(hours=LOCAL_OFFSET_HOURS)


def _fmt_day(dt: datetime) -> str:
    return _to_local(dt).strftime("%m-%d")


def _get_emotion_trend(user_email: str, days: int = 7) -> str:
    days = max(3, min(30, int(days or 7)))

    now_local = _to_local(datetime.utcnow())
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days - 1
    )
    start_utc = start_local - timedelta(hours=LOCAL_OFFSET_HOURS)

    rows = list(
        chats.find({"user": user_email, "created_at": {"$gte": start_utc}}).sort(
            "created_at", 1
        )
    )

    if not rows:
        return f"最近 {days} 天没有任何对话记录。"

    buckets = {}
    labels = {}

    for row in rows:
        created = row.get("created_at")
        if not created:
            continue
        score = row.get("emotion_score")
        label = row.get("emotion_label")
        if score is None:
            continue

        key = _fmt_day(created)
        buckets.setdefault(key, []).append(int(score))
        if label:
            labels[label] = labels.get(label, 0) + 1

    if not buckets:
        return f"最近 {days} 天有 {len(rows)} 条记录，但都缺情绪分数。"

    daily_avg = {k: round(sum(v) / len(v)) for k, v in buckets.items()}
    all_scores = [s for v in buckets.values() for s in v]
    avg = round(sum(all_scores) / len(all_scores))

    parts = [
        f"最近 {days} 天共 {len(rows)} 次对话，平均 {avg} 分（0-100，越高越正向）。"
    ]

    if len(daily_avg) >= 2:
        keys = sorted(daily_avg)
        half = len(keys) // 2
        first = sum(daily_avg[k] for k in keys[:half]) / half
        second = sum(daily_avg[k] for k in keys[half:]) / (len(keys) - half)
        if second - first >= 6:
            parts.append("后半段比前半段松了一些。")
        elif first - second >= 6:
            parts.append("后半段比前半段重了一些。")
        else:
            parts.append("前后起伏不大。")

    if labels:
        top = max(labels, key=labels.get)
        parts.append(f"出现最多的情绪是「{top}」。")

    detail = "、".join(f"{k} 约 {daily_avg[k]} 分" for k in sorted(daily_avg))
    parts.append(f"按天：{detail}。")

    return "".join(parts)


def _get_last_phq9(user_email: str) -> str:
    row = assessments.find_one({"user": user_email}, sort=[("created_at", -1)])

    if not row:
        return "用户还没有做过 PHQ-9 自评。"

    created = row.get("created_at")
    when = _to_local(created).strftime("%Y-%m-%d") if isinstance(created, datetime) else "时间未知"
    total = row.get("total")
    label = row.get("severity_label") or "未知等级"
    risk = row.get("risk", False)

    answers = row.get("answers") or []
    item9 = answers[8] if len(answers) >= 9 else None

    text = f"最近一次自评是 {when}，总分 {total}（{label}）。"
    if item9:
        text += f"第 9 题（自伤念头）得分为 {item9}，已触发过风险提示。"
    elif risk:
        text += "第 9 题不为零，曾触发风险提示。"
    else:
        text += "第 9 题为 0。"

    return text


# CBT 自助技巧库：按话题给一条，步骤不超过三步（和"一次只给一个方法"一致）
EXERCISES = [
    {
        "title": "4-7-8 呼吸",
        "keywords": ("焦虑", "紧张", "慌", "心跳", "喘不过气", "不安", "压力"),
        "steps": "吸气 4 秒，屏住 7 秒，呼气 8 秒，做四轮。呼气比吸气长，身体会自动往下走。",
    },
    {
        "title": "担忧时间窗",
        "keywords": ("担心", "胡思乱想", "反刍", "想太多", "停不下来"),
        "steps": "把担心的事写在纸上，然后告诉自己「今晚 8 点专门想 15 分钟」。到点再想，其余时间先放下。",
    },
    {
        "title": "睡眠的床只做两件事",
        "keywords": ("失眠", "睡不着", "熬夜", "睡不好", "醒了"),
        "steps": "床只用来睡觉。躺下 20 分钟还醒着就起来，去客厅做点无聊的事，困了再回床。",
    },
    {
        "title": "三栏记录",
        "keywords": ("自责", "没用", "失败", "讨厌自己", "都是我"),
        "steps": "写三栏：刚才发生了什么／我脑子里说了什么／支持和不支持这句话的证据各一条。",
    },
    {
        "title": "五分钟启动",
        "keywords": ("拖延", "提不起劲", "不想动", "做不下去", "开不了头"),
        "steps": "只承诺做五分钟，时间到了可以停。多数时候开始之后就会继续。",
    },
    {
        "title": "六秒暂停",
        "keywords": ("生气", "愤怒", "想骂人", "火大", "吵架", "烦"),
        "steps": "先数六秒再回应。这六秒里把想说的话在心里说一遍，但不发出去。",
    },
    {
        "title": "我句式",
        "keywords": ("吵架", "关系", "家人", "室友", "同事", "委屈", "误解"),
        "steps": "把「你怎么总是……」换成「我听到……的时候，会觉得……，我希望……」。",
    },
    {
        "title": "行为激活：一件小事",
        "keywords": ("低落", "没意思", "开心不起来", "麻木", "什么都不想"),
        "steps": "选一件五分钟内能完成、且以前会让你稍微好受的事，今天只做这一件。",
    },
    {
        "title": "概率检验",
        "keywords": ("万一", "肯定会", "一定完蛋", "来不及", "考砸", "灾难"),
        "steps": "写下最坏结果，再写「它真的发生的概率」和「真发生了我会怎么处理」。",
    },
    {
        "title": "微连接",
        "keywords": ("孤独", "没人", "一个人", "没人懂", "孤单"),
        "steps": "今天给一个人发一条不需要回复的消息，比如「想到你了，最近怎么样」。",
    },
]


def _suggest_exercise(topic: str) -> str:
    text = (topic or "").strip()

    if not text:
        return "没有指定话题，暂时不推荐练习。"

    matched = None
    for item in EXERCISES:
        if any(word in text for word in item["keywords"]):
            matched = item
            break

    if not matched:
        matched = EXERCISES[0]

    return f"练习「{matched['title']}」：{matched['steps']}"


def _get_crisis_resources(city: str = "") -> str:
    text = (
        "24 小时全国心理援助热线 400-161-9995；"
        "如果现在有具体的危险，打 110 或 120。"
    )

    if city:
        text += f"在{city}可以去当地精神卫生中心，或三甲医院的心理科／精神科。"
    else:
        text += "就近去当地精神卫生中心或三甲医院心理科／精神科。"

    text += "在校学生也可以直接联系学校心理咨询中心，通常免费。"
    return text


def execute_tool(name: str, args: dict, user_email: str) -> str:
    """执行一个工具调用。任何异常都收敛成一句兜底文本，绝不打断对话。"""
    try:
        args = args or {}

        if name == "get_emotion_trend":
            return _get_emotion_trend(user_email, args.get("days", 7))

        if name == "get_last_phq9":
            return _get_last_phq9(user_email)

        if name == "suggest_exercise":
            return _suggest_exercise(args.get("topic", ""))

        if name == "get_crisis_resources":
            return _get_crisis_resources(args.get("city", ""))

        return "（没有这个工具）"

    except Exception as e:
        print(f"TOOL ERROR [{name}]:", repr(e))
        return "（这次没能查到记录，先用对话里说过的情况来回应，不要编造数字）"
