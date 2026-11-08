"""情绪识别：规则词典 + 加权打分。

设计取舍
--------
1. 不调用大模型做分类：零成本、零延迟，也不占用对话的 token 额度。
2. 判定逻辑完全可解释——每个标签都能回溯到命中了哪些词，
   答辩时能逐条讲清楚，而"模型输出的一个标签"讲不清。
3. 断网或模型额度耗尽时依然工作，周报不会因为接口失败而空白。

输出
----
{
    "key": "low" | "anxious" | "anger" | "positive" | "calm",
    "label": "低落" ...,
    "score": 0-100,        # 越高越正向，用于画趋势折线
    "intensity": 0.0-1.0,  # 情绪强度，用于 UI 上色
    "keywords": [...],     # 命中的词，便于排查与展示
}
"""

from typing import Dict, List, Tuple

# ---------------- 词典 ---------------- #
# 权重 1-4：1 表示语气较轻，4 表示强烈。

LEXICON: Dict[str, Dict[str, int]] = {
    "low": {
        "难过": 3, "伤心": 3, "想哭": 3, "哭了": 2, "失落": 2, "空虚": 2,
        "孤单": 2, "孤独": 2, "委屈": 2, "没意思": 2, "没意义": 3, "没希望": 3,
        "绝望": 4, "撑不住": 3, "受不了": 3, "好累": 2, "心累": 3, "很累": 2,
        "讨厌自己": 3, "没用": 2, "低落": 2, "郁闷": 2, "难受": 2, "压抑": 2,
        "崩溃": 3, "提不起劲": 2, "麻木": 2, "走不出来": 2, "自责": 2,
    },
    "anxious": {
        "焦虑": 3, "紧张": 2, "睡不着": 3, "失眠": 3, "担心": 2, "害怕": 2,
        "心慌": 3, "慌": 2, "压力": 2, "压力大": 3, "喘不过气": 3, "心跳快": 2,
        "不安": 2, "胡思乱想": 2, "来不及": 2, "忐忑": 2, "坐不住": 2,
        "怕": 2, "熬": 1, "熬夜": 1,
    },
    "anger": {
        "生气": 3, "愤怒": 3, "气死": 3, "好烦": 3, "烦": 2, "烦躁": 2,
        "讨厌": 2, "恨": 3, "吵架": 2, "不公平": 2, "凭什么": 2, "憋屈": 2,
        "恼火": 3, "想骂人": 2, "无语": 1,
    },
    "positive": {
        "开心": 3, "高兴": 3, "好多了": 3, "舒服": 2, "放松": 2, "谢谢": 1,
        "感谢": 1, "有希望": 3, "进步": 2, "成功": 2, "顺利": 2, "满足": 2,
        "轻松": 2, "踏实": 2, "被理解": 2, "好一点": 2, "希望": 1, "期待": 2,
    },
}

# 否定词只保留真正起否定作用的单字。
# 刻意排除「别」：它大量出现在「特别」「区别」「别人」里，会把正向词误判成否定。
NEGATIONS = ("不", "没", "未", "无")

# 出现这些表达时，无论词表命中多少，都把分数压到低位——
# 避免一条很重的求助只被打出「中等偏下」的分。
CRISIS_HINTS = (
    "不想活", "想死", "自杀", "活不下去", "结束生命", "自残",
    "割腕", "轻生", "想消失", "死了算了",
)

# 否定词只在同一小句内有效：跨过标点就不再算否定，
# 否则「睡不着，心慌」里的「不」会被算到「心慌」头上。
PUNCTUATION = "，。、！？；：,.!?;:()（）「」《》 \t\n"

LABELS: Dict[str, str] = {
    "low": "低落",
    "anxious": "焦虑",
    "anger": "愤怒",
    "positive": "积极",
    "calm": "平静",
}

# 每个权重点换成多少分（基础分 50 为平静）
POINT_VALUE = 2.5


def _is_negated(text: str, index: int) -> bool:
    """判断情绪词前面是否紧邻否定词，如「不开心」「没那么难受」。"""
    window = text[max(0, index - 3):index]

    if any(mark in window for mark in PUNCTUATION):
        return False

    return any(word in window for word in NEGATIONS)


def _scan(text: str, dim: str) -> List[Tuple[int, str, int]]:
    """在一个维度里扫描命中词。

    按词长从长到短匹配并占用字符，避免「好烦」命中后「烦」再重复计一次。
    """
    hits: List[Tuple[int, str, int]] = []
    occupied = [False] * len(text)

    for word, weight in sorted(LEXICON[dim].items(), key=lambda kv: -len(kv[0])):
        start = 0
        while True:
            index = text.find(word, start)
            if index < 0:
                break

            if any(occupied[index:index + len(word)]):
                start = index + 1
                continue

            for i in range(index, index + len(word)):
                occupied[i] = True

            hits.append((index, word, weight))
            start = index + len(word)

    return hits


def _calm_result() -> dict:
    return {
        "key": "calm",
        "label": LABELS["calm"],
        "score": 50,
        "intensity": 0.0,
        "keywords": [],
    }


def analyze_emotion(text: str) -> dict:
    """对一段用户输入做情绪分析。"""
    text = (text or "").strip()
    if not text:
        return _calm_result()

    hits = {dim: _scan(text, dim) for dim in LEXICON}

    raw = {dim: sum(weight for _, _, weight in hits[dim]) for dim in LEXICON}

    # 极性：正向词算加分，负向词算减分，否定则反转
    polarity = {dim: 0 for dim in LEXICON}
    for dim in LEXICON:
        sign = 1 if dim == "positive" else -1
        for index, word, weight in hits[dim]:
            value = sign * weight
            if _is_negated(text, index):
                value = -value
            polarity[dim] += value

    score = int(max(0, min(100, 50 + sum(polarity.values()) * POINT_VALUE)))

    keywords = [
        ("否定:" if _is_negated(text, index) else "") + word
        for dim in LEXICON
        for index, word, _ in hits[dim]
    ]

    crisis_hit = any(hint in text for hint in CRISIS_HINTS)

    if crisis_hit:
        key = "low"
        score = min(score, 18)
    elif polarity["positive"] < 0:
        # 「不开心」这类否定正向词，本质是低落
        key = "low"
    elif raw["positive"] > 0 and score >= 55:
        key = "positive"
    else:
        negative_dims = ("low", "anxious", "anger")
        top = max(negative_dims, key=lambda d: raw[d])
        key = top if raw[top] > 0 else "calm"

    intensity = round(min(1.0, abs(score - 50) / 50), 2)

    return {
        "key": key,
        "label": LABELS[key],
        "score": score,
        "intensity": intensity,
        "keywords": keywords[:6],
    }


def emotion_series_label(score: int) -> str:
    """把分数换成一句人话，供周报使用。"""
    if score >= 72:
        return "整体向上"
    if score >= 58:
        return "稍有起伏"
    if score >= 42:
        return "比较平稳"
    if score >= 28:
        return "偏低"
    return "比较低落"
