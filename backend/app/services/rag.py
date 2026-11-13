"""
年糕 · 检索增强（RAG）

为什么要有这一层：
心理话题里，模型很容易把"听起来对的话"说得很顺，但具体做法（比如 4-7-8 呼吸
到底几秒、CBT-I 的刺激控制怎么做）必须来自可靠来源，不能靠模型即兴生成。
这一层负责在每次对话前，从本地知识库里找出最相关的几条，作为事实依据交给模型。

检索策略（三条，构成混合检索）：
1. 字符级 BM25：中文不分词，用单字 + 双字 n-gram 建索引。
   - 好处是零依赖（不需要 jieba、不需要向量库），部署时不用多装任何东西；
   - 对"睡不着""自责"这类短查询，双字 n-gram 的召回足够。
2. 字段加权：标题和人工标注的 tags 重复计入词频，让"标签命中"比"正文偶然出现"更重要。
3. 同义词扩展：把口语说法映射到知识库用语（"睡不着"→"失眠"），弥补字面不重合。

任何环节出错都返回空列表——检索失败只应该让回答少一点依据，不应该让对话中断。
"""

import json
import math
import re
import threading
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "data" / "knowledge"

# BM25 参数（取值沿用经典默认，语料只有百来条，不需要调）
K1 = 1.5
B = 0.75

# 低于这个分数认为"没有真正相关的内容"，宁可不注入，也不塞无关材料
MIN_SCORE = 8.0

# 只保留接近 top1 分数的条目，避免把"勉强沾边"的也塞进去
RELATIVE_CUTOFF = 0.45

# 单字命中的权重折扣：单字区分度低（"天""不""好"随处可见），
# 双字 n-gram 才是主要信号，所以单字只作为补充
SINGLE_CHAR_WEIGHT = 0.35

# 单条注入 prompt 的字数上限，控制 token 成本
MAX_DOC_CHARS = 160

# 单字功能词，对检索没有区分度
STOPWORDS = {
    "的", "了", "是", "在", "我", "你", "他", "她", "它", "们", "也", "就", "都",
    "和", "与", "吗", "呢", "啊", "呀", "吧", "哦", "嗯", "这", "那", "个", "一",
    "很", "有", "会", "要", "能", "说", "着", "过", "还", "又", "被", "把", "给",
    "让", "好", "吧", "着", "呢", "么", "其", "之", "为", "以", "及", "但", "而",
}

# 口语 → 知识库用语
SYNONYMS = {
    "睡不着": ["失眠", "入睡"],
    "失眠": ["睡不着", "入睡"],
    "焦虑": ["紧张", "心慌", "不安"],
    "慌": ["焦虑", "紧张"],
    "难受": ["低落", "委屈"],
    "抑郁": ["低落", "提不起劲"],
    "低落": ["抑郁", "难过"],
    "生气": ["愤怒", "火大"],
    "烦": ["烦躁", "焦虑"],
    "累": ["疲惫", "耗竭"],
    "想哭": ["眼泪", "委屈"],
    "拖延": ["开不了头", "启动"],
    "考试": ["考前", "成绩"],
    "失恋": ["分手"],
    "孤独": ["孤单", "一个人"],
    "自责": ["内疚", "怪自己"],
    "内耗": ["想太多", "纠结"],
    "自杀": ["不想活", "想死"],
    "自伤": ["伤害自己", "划"],
    "热线": ["求助", "电话"],
    "室友": ["宿舍", "舍友"],
    "父母": ["家人", "爸妈"],
    "面试": ["求职", "工作"],
    "论文": ["写作", "毕业"],
    "手机": ["刷手机", "上瘾"],
    "早八": ["早起", "作息"],
    "暴食": ["吃多", "进食"],
    "体像": ["体重", "身材"],
}

# 中文连续段、英文数字连续段
_SEG = re.compile(r"[\u4e00-\u9fff]+|[a-zA-Z0-9]+")

# 子句切分：用户一句话里常有两个话题（"睡不着，脑子停不下来"），
# 分别检索再合并，比把两段拼在一起打分更准
_CLAUSE = re.compile(r"[，,。；;！!？?\n]+")

_index = None
_lock = threading.Lock()


# ---------------- 分词 ---------------- #

def _tokenize(text: str):
    """中文按字切 unigram + bigram，英文数字整段切。"""
    tokens = []

    for seg in _SEG.findall((text or "").lower()):
        if seg[0].isascii():
            tokens.append(seg)
            continue

        for ch in seg:
            if ch not in STOPWORDS:
                tokens.append(ch)

        for i in range(len(seg) - 1):
            pair = seg[i : i + 2]
            if pair[0] in STOPWORDS and pair[1] in STOPWORDS:
                continue
            tokens.append(pair)

    return tokens


def _expand_query(query: str) -> str:
    """把口语说法展开成知识库可能用的词，最多补 6 个，避免噪声。"""
    extra = []

    for key, values in SYNONYMS.items():
        if key in (query or ""):
            for value in values:
                if value not in extra:
                    extra.append(value)

    if not extra:
        return query

    return query + " " + " ".join(extra[:6])


# ---------------- 建索引 ---------------- #

def _build_index():
    docs = []
    file_count = 0

    for path in sorted(KNOWLEDGE_DIR.glob("*.json")):
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"RAG LOAD ERROR [{path.name}]:", repr(e))
            continue

        if not isinstance(rows, list):
            continue

        file_count += 1

        for row in rows:
            if not isinstance(row, dict) or not row.get("content"):
                continue

            # 标题与标签重复计入，等于给它们更高的权重
            weighted = " ".join([
                row.get("title", ""),
                row.get("title", ""),
                " ".join(row.get("tags", []) or []),
                " ".join(row.get("tags", []) or []),
                row.get("content", ""),
            ])

            tokens = _tokenize(weighted)

            docs.append({
                "doc": row,
                "tokens": tokens,
                "len": len(tokens) or 1,
            })

    if not docs:
        return {"docs": [], "idf": {}, "tf": [], "avg_len": 0, "files": 0}

    # 文档频率
    df = {}
    for item in docs:
        for token in set(item["tokens"]):
            df[token] = df.get(token, 0) + 1

    total = len(docs)
    idf = {
        token: math.log((total - freq + 0.5) / (freq + 0.5) + 1)
        for token, freq in df.items()
    }

    # 词频
    tf_list = []
    for item in docs:
        tf = {}
        for token in item["tokens"]:
            tf[token] = tf.get(token, 0) + 1
        tf_list.append(tf)

    avg_len = sum(item["len"] for item in docs) / total

    return {
        "docs": docs,
        "idf": idf,
        "tf": tf_list,
        "avg_len": avg_len,
        "files": file_count,
    }


def _ensure_index():
    global _index

    if _index is not None:
        return _index

    with _lock:
        if _index is None:
            _index = _build_index()

    return _index


# ---------------- 检索 ---------------- #

def retrieve(query: str, top_k: int = 3, min_score: float = MIN_SCORE):
    """返回最相关的若干条知识卡片；没有相关内容时返回空列表。"""
    try:
        if not query or len(query.strip()) < 2:
            return []

        index = _ensure_index()
        if not index["docs"]:
            return []

        # 按标点切成子句，每个子句代表一个独立意图
        clauses = [
            part.strip()
            for part in _CLAUSE.split(query.strip())
            if len(part.strip()) >= 2
        ] or [query.strip()]

        clause_tokens = [_tokenize(_expand_query(c)) for c in clauses]
        clause_tokens = [t for t in clause_tokens if t]
        if not clause_tokens:
            return []

        idf = index["idf"]
        avg_len = index["avg_len"] or 1

        scored = []

        for i, item in enumerate(index["docs"]):
            tf_map = index["tf"][i]
            doc_len = item["len"]

            # 一条文档只要在一个子句上得分高，就算与这个意图相关；
            # 取最大值而不是累加，避免长句里的话题互相稀释
            best = 0.0

            for tokens in clause_tokens:
                score = 0.0

                for token in tokens:
                    freq = tf_map.get(token)
                    if not freq:
                        continue

                    weight = idf.get(token, 0.0)

                    # 单字区分度低，降权；双字 n-gram 是主要依据
                    if len(token) == 1:
                        weight *= SINGLE_CHAR_WEIGHT

                    denom = freq + K1 * (1 - B + B * doc_len / avg_len)
                    score += weight * freq * (K1 + 1) / denom

                if score > best:
                    best = score

            if best > 0:
                scored.append((best, i))

        if not scored:
            return []

        scored.sort(key=lambda x: -x[0])

        # 相对门槛：跟着 top1 走，这样既切掉勉强沾边的，
        # 又不会因为话题冷门就一条都不给
        best = scored[0][0]
        relative_floor = best * RELATIVE_CUTOFF

        results = []
        seen_titles = set()

        for score, i in scored:
            if score < min_score or score < relative_floor:
                break

            doc = index["docs"][i]["doc"]
            title = doc.get("title", "")

            # 同一标题只留一条，避免知识库里近似条目占满 top_k
            if title in seen_titles:
                continue
            seen_titles.add(title)

            results.append({
                "id": doc.get("id", ""),
                "title": title,
                "content": doc.get("content", ""),
                "tags": doc.get("tags", []),
                "source": doc.get("source", ""),
                "score": round(score, 2),
            })

            if len(results) >= top_k:
                break

        return results

    except Exception as e:
        # 检索失败不影响对话，只是这次少给了依据
        print("RAG RETRIEVE ERROR:", repr(e))
        return []


# 危机场景不能让阈值挡掉，这两条固定兜底
CRISIS_IDS = ("cr-01", "cr-04")


def get_crisis_items():
    """不经过打分，直接返回危机求助卡片。"""
    try:
        index = _ensure_index()
        out = []

        for item in index["docs"]:
            doc = item["doc"]
            if doc.get("id") in CRISIS_IDS:
                out.append({
                    "id": doc.get("id", ""),
                    "title": doc.get("title", ""),
                    "content": doc.get("content", ""),
                    "tags": doc.get("tags", []),
                    "source": doc.get("source", ""),
                    "score": 0.0,
                })

        return out

    except Exception as e:
        print("RAG CRISIS ERROR:", repr(e))
        return []


def format_context(items):
    """把检索结果拼成给模型看的参考资料块。"""
    if not items:
        return ""

    lines = ["【以下是与当前话题相关的资料，供你参考事实，不要照抄原文】"]

    for n, item in enumerate(items[:3], start=1):
        content = item["content"]
        if len(content) > MAX_DOC_CHARS:
            content = content[:MAX_DOC_CHARS] + "…"

        source = item.get("source", "")
        suffix = f"（来源：{source}）" if source else ""
        lines.append(f"{n}. {item['title']}{suffix}：{content}")

    lines.append("回应时用你自己的话，不要罗列资料，也不要把它当作诊断结论。")

    return "\n".join(lines)


def get_stats():
    """给 /rag/stats 用的索引概况，方便演示时说明知识库规模。"""
    index = _ensure_index()

    return {
        "documents": len(index["docs"]),
        "files": index["files"],
        "vocabulary": len(index["idf"]),
        "avg_length": round(index["avg_len"], 1),
    }
