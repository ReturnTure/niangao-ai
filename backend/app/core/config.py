import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    # ---- 数据库 ----
    MONGO_URI = os.getenv("MONGO_URI")
    DB_NAME = os.getenv("DB_NAME", "niangao")

    # ---- 鉴权 ----
    JWT_SECRET = os.getenv("JWT_SECRET")
    JWT_REFRESH_SECRET = os.getenv("JWT_REFRESH_SECRET")

    # ---- 大模型（OpenAI 兼容协议）----
    LLM_API_KEY = os.getenv("LLM_API_KEY")
    LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://api.deepseek.com")
    LLM_MODEL = os.getenv("LLM_MODEL", "deepseek-chat")


settings = Settings()

# 启动时必须有值的配置项（大模型 Key 允许后补，缺失时聊天接口会返回明确提示）
required = ["MONGO_URI", "JWT_SECRET", "JWT_REFRESH_SECRET"]

for key in required:
    if not getattr(settings, key):
        raise ValueError(f"Missing env variable: {key}")
