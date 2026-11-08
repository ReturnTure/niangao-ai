from fastapi import APIRouter, Depends, HTTPException
from datetime import datetime, timedelta

from app.models.assessment import AssessmentSubmit
from app.db.database import assessments
from app.routes.auth import get_current_user
from app.services.assessment import (
    INSTRUCTION,
    OPTIONS,
    ITEMS,
    score_phq9,
    build_summary_text,
)

router = APIRouter(prefix="/assessment", tags=["Assessment"])

# 和情绪周报一样按北京时间切日期，避免 UTC 把晚上十一点算成第二天
LOCAL_OFFSET_HOURS = 8


# ---------------- 题目 ---------------- #

@router.get("/phq9", summary="获取 PHQ-9 题目")
def get_phq9():
    """题目放在后端，前端不硬编码，将来加 GAD-7 只需在 service 里补一组。"""

    return {
        "type": "phq9",
        "title": "PHQ-9 情绪自评",
        "instruction": INSTRUCTION,
        "options": OPTIONS,
        "items": ITEMS,
        "total_questions": len(ITEMS),
        "disclaimer": (
            "这是一份筛查量表，不是诊断。作答只用于帮你观察自己的状态，"
            "不会被用于任何形式的判断或标签。"
        ),
    }


# ---------------- 提交 ---------------- #

@router.post("/phq9", summary="提交 PHQ-9 作答并计分")
def submit_phq9(req: AssessmentSubmit, user=Depends(get_current_user)):
    try:
        result = score_phq9(req.answers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    now = datetime.utcnow()

    try:
        assessments.insert_one({
            "user": user["email"],
            "type": "phq9",
            "answers": req.answers,
            "total": result["total"],
            "severity_key": result["severity"]["key"],
            "severity_label": result["severity"]["label"],
            "risk": result["risk"],
            "created_at": now,
        })
    except Exception as e:
        # 落库失败不该拦住用户看结果，只打日志
        print("ASSESSMENT SAVE ERROR:", e)

    return {
        **result,
        "summary_text": build_summary_text(result),
        "created_at": now.isoformat(),
    }


# ---------------- 历史 ---------------- #

@router.get("/history", summary="最近几次自评记录")
def get_history(limit: int = 5, user=Depends(get_current_user)):
    limit = max(1, min(limit, 20))

    try:
        rows = list(
            assessments.find({"user": user["email"]})
            .sort("created_at", -1)
            .limit(limit)
        )
    except Exception as e:
        print("ASSESSMENT HISTORY ERROR:", e)
        return {"items": []}

    items = []
    for r in rows:
        created = r.get("created_at")
        if isinstance(created, datetime):
            # 统一按北京时间显示
            created = created + timedelta(hours=LOCAL_OFFSET_HOURS)
            created_str = created.strftime("%Y-%m-%d %H:%M")
        else:
            created_str = ""

        items.append({
            "total": r.get("total"),
            "severity_label": r.get("severity_label"),
            "severity_key": r.get("severity_key"),
            "risk": r.get("risk", False),
            "created_at": created_str,
        })

    return {"items": items, "count": len(items)}
