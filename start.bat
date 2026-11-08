@echo off
chcp 65001 >nul
echo ===============================
echo   年糕 · AI 心理陪伴伙伴
echo ===============================

:: ---------- 后端 ----------
echo [1/2] 启动后端...

cd backend

IF EXIST venv (
    call venv\Scripts\activate
) ELSE (
    echo 未找到虚拟环境，正在创建...
    python -m venv venv
    call venv\Scripts\activate
    pip install -r requirements.txt
)

IF NOT EXIST .env (
    echo 未找到 .env，已从 .env.example 复制，请先填写数据库和模型密钥
    copy .env.example .env
)

:: 注意：入口模块是 app.main，不是 main
start cmd /k "uvicorn app.main:app --reload"

cd ..

:: ---------- 前端 ----------
echo [2/2] 启动前端...

cd frontend

IF NOT EXIST node_modules (
    echo 正在安装前端依赖...
    call npm install
)

start cmd /k "npm run dev"

cd ..

echo ===============================
echo 后端 http://127.0.0.1:8000/docs
echo 前端 http://localhost:5173
echo ===============================
pause
