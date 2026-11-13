from fastapi import APIRouter, Query

from app.services.rag import retrieve, get_stats, format_context

router = APIRouter(prefix="/rag", tags=["RAG"])


@router.get("/search", summary="检索心理知识库")
def search(
    q: str = Query(..., description="查询内容，例如：睡不着怎么办"),
    top_k: int = Query(3, ge=1, le=10),
):
    """公开接口，方便演示检索效果与排查知识库覆盖情况。"""
    items = retrieve(q, top_k=top_k)

    return {
        "query": q,
        "count": len(items),
        "items": items,
        "context_preview": format_context(items),
    }


@router.get("/stats", summary="知识库索引概况")
def stats():
    return get_stats()
