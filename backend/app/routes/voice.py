"""
年糕 · 语音播报路由（独立模块）

挂载方式（改 main.py 两行，不改 chat.py / chatbot.py）：

    from app.routes import auth, chat, report, assessment, rag, voice
    app.include_router(voice.router)

接口一览：
    GET  /voice/health        合成引擎是否可用 + 音色/预设清单（前端据此决定用服务端还是浏览器语音）
    GET  /voice/voices        音色列表
    GET  /voice/preview       试听一句（浏览器直接打开就能听）
    POST /voice/tts           文本 → mp3 音频流（前端逐句请求，边到边播）
    POST /voice/split         文本 → 句子数组（调试分句效果）
    GET  /voice/asr/health    离线识别是否可用（vosk 是否装好、模型在不在）
    POST /voice/asr           WAV/PCM → 中文文本（录音结束后整段识别）
    WS   /voice/asr/ws        边录边识别（流式，预留）

鉴权：/voice/health 与 /voice/voices、/voice/preview 保持公开（不消耗合成额度，前端未登录也要能探测引擎、
浏览器也能直接试听）；/voice/tts、/voice/split、/voice/asr 默认要求登录，避免接口被当成免费转码服务刷。
如需彻底放开（仅限本地调试），设环境变量 VOICE_REQUIRE_AUTH=0。
"""

import os

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
)
from fastapi.responses import Response, StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.models.voice import SplitRequest, TTSRequest
from app.services import asr as asr_service
from app.services import tts as tts_service

# ---------------- 可选鉴权 ---------------- #

VOICE_REQUIRE_AUTH = os.getenv("VOICE_REQUIRE_AUTH", "1").strip() == "1"

_auth = []
if VOICE_REQUIRE_AUTH:  # pragma: no cover - 仅在开启时导入，避免模块耦合
    from app.routes.auth import get_current_user

    _auth = [Depends(get_current_user)]

router = APIRouter(prefix="/voice", tags=["Voice"])


# ---------------- 健康检查 / 能力探测 ---------------- #

@router.get("/health", summary="语音合成是否可用")
def health():
    available, reason = tts_service.tts_available()

    return {
        "available": available,
        "engine": "edge-tts" if available else None,
        "reason": reason,
        # 服务端不可用时，前端自动改用浏览器内置语音（Web Speech API）
        "fallback": None if available else "browser",
        "default_voice": tts_service.DEFAULT_VOICE,
        "default_preset": tts_service.DEFAULT_PRESET,
        "presets": tts_service.PRESETS,
        "voices": tts_service.VOICES,
        "cache": tts_service.cache_stats(),
        "require_auth": VOICE_REQUIRE_AUTH,
    }


@router.get("/voices", summary="可用音色")
def voices():
    available, reason = tts_service.tts_available()

    return {
        "available": available,
        "reason": reason,
        "default": tts_service.DEFAULT_VOICE,
        "voices": tts_service.VOICES,
        "presets": tts_service.PRESETS,
    }


# ---------------- 试听 ---------------- #

@router.get("/preview", summary="试听一句（浏览器直接打开即可）")
async def preview(
    voice: str = Query(default=None, description="音色 id，留空用默认"),
    preset: str = Query(default=None, description="warm/calm/slow/cheerful"),
    text: str = Query(default="你好呀，我是年糕。今天过得还好吗？", max_length=200),
):
    available, reason = tts_service.tts_available()
    if not available:
        raise HTTPException(status_code=503, detail={"reason": reason, "fallback": "browser"})

    try:
        audio = await tts_service.synthesize_bytes(text, voice=voice, preset=preset)
    except tts_service.TTSError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "Content-Disposition": 'inline; filename="niangao-preview.mp3"',
        },
    )


# ---------------- 合成（流式） ---------------- #

@router.post("/tts", summary="文本转语音，返回 mp3 流", dependencies=_auth)
async def text_to_speech(req: TTSRequest):
    available, reason = tts_service.tts_available()
    if not available:
        # 503 而不是 500：前端看到 fallback=browser 就切浏览器语音，
        # 功能照常可用，不弹错误
        raise HTTPException(status_code=503, detail={"reason": reason, "fallback": "browser"})

    speech = tts_service.clean_for_speech(req.text)
    if not speech:
        raise HTTPException(status_code=400, detail="文本清洗后为空，没有可播报的内容")

    async def audio_stream():
        try:
            async for chunk in tts_service.iter_audio(
                speech,
                voice=req.voice,
                preset=req.preset,
                rate=req.rate,
                pitch=req.pitch,
            ):
                if chunk:
                    yield chunk
        except tts_service.TTSError as e:
            print("TTS ERROR:", e)
        except Exception as e:  # 网络抖动 / 被限流，响应头已发出，只能中断
            print("TTS STREAM ERROR:", repr(e))

    return StreamingResponse(
        audio_stream(),
        media_type="audio/mpeg",
        headers={
            "Cache-Control": "no-store",
            "X-TTS-Engine": "edge-tts",
            "X-TTS-Voice": tts_service.resolve_voice(req.voice),
        },
    )


# ---------------- 分句调试 ---------------- #

@router.post("/split", summary="把整段文本切成播报用的句子", dependencies=_auth)
def split(req: SplitRequest):
    speech = tts_service.clean_for_speech(req.text)
    chunks = tts_service.split_sentences(speech, max_len=req.max_len)

    return {
        "cleaned": speech,
        "count": len(chunks),
        "chunks": chunks,
    }


# ---------------- 语音识别 · 离线（Vosk） ---------------- #

def _ws_token_ok(token: str | None) -> bool:
    """WebSocket 没法带 Authorization 头，token 走查询参数。

    校验逻辑与 HTTP 侧完全一致（同一个 JWT、同一份黑名单）。
    """
    if not VOICE_REQUIRE_AUTH:
        return True
    if not token:
        return False

    try:
        from app.core.security import decode_access_token

        return bool(decode_access_token(token))
    except Exception:
        return False


@router.get("/asr/health", summary="离线语音识别是否可用")
def asr_health():
    available, reason = asr_service.asr_available()

    return {
        "available": available,
        "reason": reason,
        # 识别是纯本地的：音频不出机器，适合心理陪伴这类隐私场景
        "engine": "vosk",
        "offline": True,
        **asr_service.model_info(),
        "max_bytes": asr_service.MAX_AUDIO_BYTES,
        "require_auth": VOICE_REQUIRE_AUTH,
    }


@router.post("/asr", summary="语音转文字（WAV / 裸 PCM，16bit 单声道）", dependencies=_auth)
async def speech_to_text(request: Request, sample_rate: int = Query(default=None, ge=8000, le=48000)):
    available, reason = asr_service.asr_available()
    if not available:
        raise HTTPException(status_code=503, detail={"reason": reason, "fallback": None})

    data = await request.body()

    if not data:
        raise HTTPException(status_code=400, detail="没有收到音频数据")

    if len(data) > asr_service.MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"音频太大（{len(data) // 1024}KB），上限 {asr_service.MAX_AUDIO_BYTES // 1024}KB",
        )

    try:
        # Vosk 推理是同步的 CPU 活儿，丢到线程池，别卡住整个事件循环
        result = await run_in_threadpool(asr_service.recognize, data, sample_rate)
    except asr_service.ASRError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print("ASR ERROR:", repr(e))
        raise HTTPException(status_code=500, detail="语音识别失败，请再说一次")

    return {"engine": "vosk", "offline": True, **result}


@router.websocket("/asr/ws")
async def asr_stream(
    ws: WebSocket,
    token: str | None = Query(default=None),
    sample_rate: int = Query(default=16000, ge=8000, le=48000),
):
    """边录边识别：客户端发 16k/16bit 单声道 PCM 二进制帧，收到 partial/final 结果。

    预留接口 —— 前端当前用的是整段 POST（更稳），需要实时上屏时可以切到这里。
    """
    if not _ws_token_ok(token):
        await ws.close(code=1008)
        return

    available, reason = asr_service.asr_available()
    if not available:
        await ws.close(code=1011, reason=reason[:100])
        return

    await ws.accept()

    try:
        session = asr_service.StreamSession(sample_rate)
    except Exception as e:
        print("ASR WS INIT ERROR:", repr(e))
        await ws.close(code=1011)
        return

    try:
        while True:
            message = await ws.receive()

            if message["type"] == "websocket.disconnect":
                break

            chunk = message.get("bytes")
            if chunk:
                result = await run_in_threadpool(session.feed, chunk)
                await ws.send_json(result)
            else:
                text = await run_in_threadpool(session.finish)
                await ws.send_json({"text": text, "final": True, "done": True})
                break

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print("ASR WS ERROR:", repr(e))
    finally:
        try:
            await ws.close()
        except Exception:
            pass
