from fastapi import APIRouter, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from datetime import datetime
import json

from app.models.chat import ChatCreate
from app.db.database import chats
from app.routes.auth import get_current_user
from app.services.chatbot import (
    generate_ai_response,
    stream_ai_response,
    detect_crisis,
)
from app.services.emotion import analyze_emotion

router = APIRouter(prefix="/chat", tags=["Chat"])

# 用户简况里说的「好的回复」才算数，错误兜底不进上下文
_ERROR_PREFIXES = ("⚠️", "抱歉，我")


# ---------------- 上下文读取 ---------------- #

def load_history(email: str, limit: int = 8):
    """从数据库取最近 N 轮对话，作为年糕的记忆。"""
    try:
        rows = list(
            chats.find({"user": email})
            .sort("created_at", -1)
            .limit(limit)
        )
    except Exception as e:
        print("HISTORY LOAD ERROR:", e)
        return []

    rows.reverse()

    cleaned = []
    for r in rows:
        msg = (r.get("message") or "").strip()
        resp = (r.get("response") or "").strip()

        if not msg or not resp:
            continue
        if resp.startswith(_ERROR_PREFIXES):
            continue

        cleaned.append({"message": msg, "response": resp})

    return cleaned


def save_turn(email: str, message: str, response: str):
    """落库一轮对话，并顺带记下这轮用户表达出的情绪。"""
    emotion = analyze_emotion(message)

    try:
        chats.insert_one({
            "user": email,
            "message": message,
            "response": response,
            "emotion": emotion["key"],
            "emotion_label": emotion["label"],
            "emotion_score": emotion["score"],
            "emotion_keywords": emotion["keywords"],
            "created_at": datetime.utcnow(),
        })
    except Exception as e:
        print("DB SAVE ERROR:", e)


# ---------------- SEND MESSAGE (非流式) ---------------- #

@router.post("", summary="Send message (non-stream)")
@router.post("/", include_in_schema=False)
async def chat(req: ChatCreate, user=Depends(get_current_user)):
    try:
        history = load_history(user["email"])

        ai_reply = await generate_ai_response(req.message, history)

        save_turn(user["email"], req.message, ai_reply)

        return {
            "response": ai_reply,
            "crisis": detect_crisis(req.message),
        }

    except Exception as e:
        print("CHAT ERROR:", e)
        raise HTTPException(status_code=500, detail="Chat error")


# ---------------- STREAM CHAT ---------------- #

@router.post("/stream", summary="Stream AI response")
async def chat_stream(
    req: ChatCreate,
    request: Request,
    user=Depends(get_current_user)
):
    print("STREAM START:", user["email"])

    history = load_history(user["email"])
    crisis = detect_crisis(req.message)

    full_text = ""
    disconnected = False

    async def wrapped_stream():
        nonlocal full_text, disconnected

        try:
            async for chunk in stream_ai_response(req.message, history):

                if await request.is_disconnected():
                    print("⚠️ Client disconnected")
                    disconnected = True
                    break

                if not chunk or not isinstance(chunk, str):
                    continue

                full_text += chunk

                # ✅ 统一发 JSON 帧：换行、引号都能安全穿过 SSE
                yield "data: " + json.dumps({"delta": chunk}, ensure_ascii=False) + "\n\n"

                # ✅ 保活注释，防止中间层缓冲
                yield ": keep-alive\n\n"

        except Exception as e:
            print("STREAM ERROR:", e)
            yield "data: " + json.dumps(
                {"delta": "抱歉，我这边出了点小状况，稍后再试一次好吗？"},
                ensure_ascii=False,
            ) + "\n\n"

        finally:
            # ✅ 明确结束帧，附带危机标记
            yield "data: " + json.dumps(
                {"done": True, "crisis": crisis},
                ensure_ascii=False,
            ) + "\n\n"

            if not disconnected and full_text.strip():
                save_turn(user["email"], req.message, full_text)
                print("✅ Chat saved")
            else:
                print("⚠️ Skipped saving (disconnect or empty)")

    return StreamingResponse(
        wrapped_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # nginx 不缓冲
        },
    )


# ---------------- GET HISTORY ---------------- #

@router.get("/history", summary="Get user chat history")
def get_history(user=Depends(get_current_user)):
    try:
        user_chats = list(
            chats.find({"user": user["email"]})
            .sort("created_at", -1)
            .limit(50)
        )

        for chat in user_chats:
            chat["_id"] = str(chat["_id"])

        return user_chats

    except Exception as e:
        print("HISTORY ERROR:", e)
        raise HTTPException(status_code=500, detail="Failed to fetch history")


# ---------------- DEBUG ---------------- #

@router.get("/test")
def test():
    return {"message": "NianGao chat route working"}
