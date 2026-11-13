import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import auth, chat, report, assessment, rag, voice
from app.db.database import create_indexes
from app.services.rag import get_stats
from app.services import asr as asr_service
from app.services import tts as tts_service

app = FastAPI(
    title="年糕 · AI 心理陪伴伙伴 API",
    description="基于大语言模型的心理健康对话与情绪陪伴服务",
    version="1.0.0",
)

# ---------------- CORS ---------------- #

origins = [
    "http://localhost:5173",   # React (Vite) 本地开发
    "http://127.0.0.1:5173",
    "http://localhost:4173",   # Vite preview
    "http://127.0.0.1:4173",
]

# 线上前端域名和本地不一样，用环境变量补进去，
# 这样同一份代码本地和云端都能跑，换域名不用改代码
extra_origins = os.getenv("CORS_ORIGINS", "")
origins += [o.strip() for o in extra_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------- ROUTES ---------------- #

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(report.router)
app.include_router(assessment.router)
app.include_router(rag.router)
app.include_router(voice.router)  # 语音播报 + 离线语音识别

# ---------------- STARTUP ---------------- #


@app.on_event("startup")
def startup():
    create_indexes()

    # 启动时就把知识库索引建好，避免第一次对话时才付建索引的时间
    stats = get_stats()
    print(f"📚 知识库已加载：{stats['documents']} 条，词表 {stats['vocabulary']} 项")

    # 语音合成：只报告状态，edge-tts 不需要预热
    tts_ok, tts_reason = tts_service.tts_available()
    print(f"🔊 语音播报：{'edge-tts 就绪' if tts_ok else tts_reason}")

    # 语音识别：模型加载要一秒多，提前加载，别让用户按住麦克风时才等
    asr_ok, asr_reason = asr_service.asr_available()
    if asr_ok:
        try:
            asr_service.get_model()
            print(f"🎙️  语音识别：Vosk 就绪（{asr_service.find_model_dir()}）")
        except Exception as e:
            print(f"🎙️  语音识别：模型加载失败 {e}")
    else:
        print(f"🎙️  语音识别：{asr_reason}")

    print("🚀 年糕后端服务已启动")


# ---------------- ROOT ---------------- #


@app.get("/")
def root():
    return {"message": "年糕 API 运行中", "docs": "/docs"}
