"""
PHQ-9 抑郁自评量表。

量表本身是公开的（Kroenke, Spitzer & Williams, 2001），这里只做中文版
的逐题呈现与计分，不做任何"诊断"。

设计上的几条取舍：

1. **计分完全由本地规则完成，不调用大模型。**
   和情绪周报同理：量表是高频、确定性极强的场景，每一步都能追溯到
   "第几题选了哪个选项"，答辩时经得起追问，也不会因为模型波动而变。

2. **总分相同，第 9 题（自伤念头）单独拎出来看。**
   这一题只要不为 0，无论总分多低都要给出求助提示——这正是量表设计
   的本意，不能被总分稀释。

3. **所有输出都必须带上"不是诊断"的限定。**
   量表是筛查工具，最终判断必须由受过训练的人来做。
"""

# ---------------- 量表内容 ---------------- #

# 指导语对应的时间窗：过去两周
INSTRUCTION = "在过去两周里，你被以下问题困扰的频率有多高？"

OPTIONS = [
    {"value": 0, "label": "完全不会"},
    {"value": 1, "label": "有几天"},
    {"value": 2, "label": "一半以上的时间"},
    {"value": 3, "label": "几乎每天"},
]

ITEMS = [
    {"id": 1, "text": "做事时提不起劲，或者没有兴趣"},
    {"id": 2, "text": "感到心情低落、沮丧或绝望"},
    {"id": 3, "text": "入睡困难、睡不安稳，或者睡得太多"},
    {"id": 4, "text": "觉得疲倦，或者没有活力"},
    {"id": 5, "text": "食欲不振，或者吃得太多"},
    {"id": 6, "text": "觉得自己很糟，或觉得自己很失败，或让自己和家人失望"},
    {"id": 7, "text": "注意力难以集中，比如看东西时总是走神"},
    {"id": 8, "text": "动作或说话慢得别人都能察觉；或者相反，烦躁、坐立不安、动来动去"},
    {"id": 9, "text": "有不如死掉，或者想用某种方式伤害自己的念头"},
]

# 第 9 题的序号，单独用于风险判定
RISK_ITEM_ID = 9

# ---------------- 分级 ---------------- #

# (上限, 等级 key, 中文名, 建议文案)
SEVERITY_TABLE = [
    (
        4,
        "minimal",
        "没有明显困扰",
        "目前看，你的状态还算平稳。维持规律的作息、能说上话的人、"
        "一点让自己放松的小事，就是很好的保护。如果最近有变化，随时可以再来测一次。",
    ),
    (
        9,
        "mild",
        "轻度困扰",
        "有一些压力反应，但还在多数人都会经历的范围内。可以先从作息、"
        "出门走走、把心事说出来这些小事开始。要是两周后没有好转，建议找专业的人聊一次。",
    ),
    (
        14,
        "moderate",
        "中度困扰",
        "这段时间的困扰已经影响到日常生活了。建议尽快预约一次心理咨询，"
        "学校心理中心或医院心理科都可以。这不代表你“有问题”，只是说明现在需要有人帮你一把。",
    ),
    (
        19,
        "moderately_severe",
        "中重度困扰",
        "这个分数提示困扰已经比较明显，并且很可能持续了一段时间。"
        "建议在一周内联系精神科或心理科做一次正式评估，专业的人能给出更准确的判断。",
    ),
    (
        27,
        "severe",
        "重度困扰",
        "这个分数提示你正承受着相当重的负担。请尽快就诊（精神科或心理科都可以），"
        "也请告诉一个你信任的人，让对方这段时间陪着你。你不必一个人扛。",
    ),
]

# 危机兜底文案，第 9 题阳性时追加
RISK_NOTICE = (
    "你提到了想伤害自己的念头。这一题只要不为零，就值得被认真对待——"
    "不管总分是多少。请现在联系一个你信任的人，或拨打全国心理援助热线 "
    "400-161-9995（24 小时），紧急情况请拨 110。"
)

DISCLAIMER = (
    "PHQ-9 是筛查工具，不是诊断。分数只能说明“这段时间可能不太好”，"
    "到底怎么了，需要由受过训练的专业人员来判断。"
)


# ---------------- 计分 ---------------- #

def score_phq9(answers):
    """
    计算 PHQ-9。

    answers: 长度 9 的整数列表，每项 0-3，对应第 1-9 题。

    返回总分、等级、建议文案、是否触发风险提示，以及逐题明细，
    方便前端把"这道题选了 3"直接标出来。
    """
    if not isinstance(answers, (list, tuple)) or len(answers) != len(ITEMS):
        raise ValueError(f"需要 {len(ITEMS)} 个答案，实际收到 {len(answers) if hasattr(answers, '__len__') else '未知'} 个")

    cleaned = []
    for i, a in enumerate(answers):
        if not isinstance(a, int) or a < 0 or a > 3:
            raise ValueError(f"第 {i + 1} 题的答案必须是 0-3 的整数")
        cleaned.append(a)

    total = sum(cleaned)

    severity = None
    for upper, key, label, advice in SEVERITY_TABLE:
        if total <= upper:
            severity = {"key": key, "label": label, "advice": advice}
            break

    # 第 9 题不为 0 就单独报警，不看总分
    risk = cleaned[RISK_ITEM_ID - 1] > 0

    return {
        "total": total,
        "max_total": 27,
        "severity": severity,
        "risk": risk,
        "risk_notice": RISK_NOTICE if risk else None,
        "disclaimer": DISCLAIMER,
        "items": [
            {
                "id": item["id"],
                "text": item["text"],
                "answer": cleaned[idx],
                "answer_label": OPTIONS[cleaned[idx]]["label"],
            }
            for idx, item in enumerate(ITEMS)
        ],
    }


def build_summary_text(result):
    """给周报或对话用的一句话摘要，不含诊断措辞。"""
    severity = result["severity"]
    text = f"最近一次自评总分 {result['total']} 分，属于{severity['label']}。"

    if result["risk"]:
        text += "其中第 9 题不为零，已给出求助提示。"

    return text
