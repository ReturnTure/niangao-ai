from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import auth, chat
from app.db.database import create_indexes

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

# ---------------- STARTUP ---------------- #


@app.on_event("startup")
def startup():
    create_indexes()
    print("🚀 年糕后端服务已启动")


# ---------------- ROOT ---------------- #


@app.get("/")
def root():
    return {"message": "年糕 API 运行中", "docs": "/docs"}
