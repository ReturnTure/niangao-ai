"""情绪周报。

按本地日期（UTC+8）聚合最近 N 天的对话情绪，给出每日均分、主情绪分布与趋势。
旧数据没有 emotion 字段时会现场补算，保证历史记录也能进图。
"""

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends

from app.db.database import chats
from app.routes.auth import get_current_user
from app.services.emotion import analyze_emotion

router = APIRouter(prefix="/report", tags=["Report"])

LOCAL_OFFSET_HOURS = 8  # 面向国内用户，按 UTC+8 切分日期


def _to_local(dt: datetime) -> datetime:
    return dt + timedelta(hours=LOCAL_OFFSET_HOURS)


def _trend_text(trend: str) -> str:
    return {
        "up": "后半段比前半段松了一些",
        "down": "后半段比前半段重了一些",
        "flat": "起伏不大",
    }[trend]


def build_insight(
    total_turns: int,
    avg_score: Optional[int],
    dominant: Optional[str],
    trend: str,
    days: int,
) -> str:
    """用模板 + 数据拼一句人话。

    不调用大模型：周报是随时可打开的高频页面，没必要每次都烧 token，
    而且模板句的措辞可控，不会说出不合适的建议。
    """
    if total_turns == 0:
        return f"这 {days} 天还没有对话记录。想说话的时候来这儿聊聊，年糕都在。"

    if total_turns <= 2:
        return (
            f"这 {days} 天你来了 {total_turns} 次，记录还少，看不出走势。"
            "多聊几次，曲线才有意义。"
        )

    mood = f"平均 {avg_score} 分"
    if avg_score is not None and avg_score >= 60:
        mood = f"整体情绪偏正向（平均 {avg_score} 分）"
    elif avg_score is not None and avg_score >= 45:
        mood = f"整体算平稳（平均 {avg_score} 分）"
    elif avg_score is not None:
        mood = f"整体偏低沉（平均 {avg_score} 分）"

    parts = [f"这 {days} 天你来了 {total_turns} 次，{mood}。"]

    if trend != "flat":
        parts.append(f"{ _trend_text(trend) }。")

    if dominant and dominant != "平静":
        parts.append(f"出现最多的是「{dominant}」。")

    parts.append("这些只是词频统计，不是诊断——你真实的感受，比曲线准。")
    return "".join(parts)


@router.get("/weekly", summary="最近 N 天的情绪周报")
def weekly(days: int = 7, user=Depends(get_current_user)):
    days = max(3, min(30, int(days)))

    # 以本地今天的 0 点为界，往前推 days-1 天
    now_local = _to_local(datetime.utcnow())
    start_local = now_local.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(
        days=days - 1
    )
    start_utc = start_local - timedelta(hours=LOCAL_OFFSET_HOURS)

    rows = list(
        chats.find({"user": user["email"], "created_at": {"$gte": start_utc}}).sort(
            "created_at", 1
        )
    )

    # 先建好每天的空桶，没有对话的日子也要留在曲线上
    buckets = {}
    for i in range(days):
        key = (start_local + timedelta(days=i)).strftime("%Y-%m-%d")
        buckets[key] = {"scores": [], "count": 0, "labels": {}}

    for row in rows:
        created = row.get("created_at")
        if not created:
            continue

        score = row.get("emotion_score")
        label = row.get("emotion_label")
        if score is None or label is None:  # 兼容改造前的历史数据
            result = analyze_emotion(row.get("message") or "")
            score, label = result["score"], result["label"]

        key = _to_local(created).strftime("%Y-%m-%d")
        bucket = buckets.get(key)
        if not bucket:
            continue

        bucket["scores"].append(int(score))
        bucket["count"] += 1
        bucket["labels"][label] = bucket["labels"].get(label, 0) + 1

    timeline = []
    distribution = {}

    for key in sorted(buckets):
        bucket = buckets[key]
        avg = round(sum(bucket["scores"]) / len(bucket["scores"])) if bucket["scores"] else None
        top = max(bucket["labels"], key=bucket["labels"].get) if bucket["labels"] else None

        timeline.append(
            {"date": key, "score": avg, "count": bucket["count"], "label": top}
        )

        for name, num in bucket["labels"].items():
            distribution[name] = distribution.get(name, 0) + num

    valid = [item["score"] for item in timeline if item["score"] is not None]
    avg_score = round(sum(valid) / len(valid)) if valid else None
    total_turns = sum(item["count"] for item in timeline)
    dominant = max(distribution, key=distribution.get) if distribution else None

    # 趋势：把有数据的日子分成前后两半比均值
    trend = "flat"
    if len(valid) >= 4:
        half = len(valid) // 2
        first = sum(valid[:half]) / half
        second = sum(valid[half:]) / (len(valid) - half)
        if second - first >= 6:
            trend = "up"
        elif first - second >= 6:
            trend = "down"

    return {
        "days": days,
        "timeline": timeline,
        "summary": {
            "avg_score": avg_score,
            "total_turns": total_turns,
            "dominant": dominant,
            "trend": trend,
            "trend_text": _trend_text(trend),
        },
        "distribution": [
            {"label": name, "count": num}
            for name, num in sorted(distribution.items(), key=lambda x: -x[1])
        ],
        "insight": build_insight(total_turns, avg_score, dominant, trend, days),
    }
