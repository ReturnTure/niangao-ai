# 年糕 · AI 心理陪伴伙伴

> 一个愿意慢慢听你说话的 AI 伙伴。

## 一、项目简介

「年糕」是一款面向大学生与年轻职场人的 **AI 心理健康陪伴 Web 应用**。它基于大语言模型，提供 7×24 小时的情绪倾诉、共情对话与心理自助引导。

名字取自"像一块软软的、暖暖的年糕那样陪着你"——它不做诊断、不给说教，只在你需要的时候安静地在旁边。

**参赛赛道**：传智杯 · AI Web 网页开发挑战赛
**选题方向**：AI 健康与生活服务

## 二、为什么做这个

我国有超过 3 亿人存在不同程度的心理健康需求，而注册精神科医师与心理治疗师总量不足 5 万，优质心理服务资源高度集中在一二线城市。大量年轻人在情绪低谷时，面临的是"没人可说、不敢说、不知道找谁"的三重困境。

年糕不做"心理医生替代品"，它做的是**求助链路的第一公里**：把"我想说点什么"这个门槛降到最低，并在识别到高风险时明确把人引向专业资源。

## 三、核心功能

| 功能 | 说明 |
| --- | --- |
| 共情对话 | 基于心理咨询人设的 system prompt，先接住情绪再回应，不说教、不灌鸡汤 |
| 流式响应 | SSE 逐字输出，接近真人对话节奏 |
| 多轮记忆 | 自动携带最近 8 轮对话上下文，年糕记得你说过的人和事 |
| 危机识别兜底 | 命中自伤/自杀等关键词时，自动展示全国心理援助热线与求助指引 |
| 情绪识别 | 每轮对话实时打标签（平静 / 积极 / 焦虑 / 低落 / 愤怒），随对话一起落库 |
| 情绪周报 | 按天聚合最近 7 天的情绪曲线与情绪分布，ECharts 可视化，附一句自然语言观察 |
| 情绪自评 | PHQ-9 九题量表，本地规则计分并分五档给建议；第 9 题单独做风险判定，不被总分稀释 |
| 情绪陪伴式开场 | 提供"压力大""睡不着""和家里吵架"等低门槛入口 |
| 账号体系 | JWT 双 Token 鉴权，支持静默续期与登出黑名单 |
| 移动端适配 | 响应式布局，侧边栏在手机端折叠 |

## 四、技术架构

```
┌──────────────────────────────────────────────┐
│  前端  React 19 + Vite + Tailwind CSS v4     │
│        Framer Motion 动效 · ECharts 情绪曲线  │
│        SSE 流式解析                          │
├──────────────────────────────────────────────┤
│  后端  FastAPI + Python 3.13                 │
│        路由分层 · JWT 鉴权 · 上下文组装        │
│        情绪分析 · 周报聚合                    │
├──────────────────────────────────────────────┤
│  AI 层 OpenAI 兼容协议                        │
│        DeepSeek / 豆包 / 通义千问 均可切换     │
├──────────────────────────────────────────────┤
│  数据  MongoDB（用户 · 对话 · 自评记录 · Token 黑名单）│
└──────────────────────────────────────────────┘
```

**关键技术点**

- **人设即产品**：心理陪伴的质量取决于 system prompt 的共情策略，而非模型参数量。项目采用"反映情绪 → 温和澄清 → 一次只给一个方法"的三段式对话策略，并在 prompt 中写明安全边界。
- **流式协议设计**：后端以 JSON 帧（`{"delta": "..."}`）经 SSE 下发，前端按空行切分事件块解析，避免换行符与引号破坏传输。
- **上下文成本控制**：仅携带最近 8 轮对话，且错误兜底内容不会写入上下文，防止污染后续对话。
- **情绪识别不依赖大模型**：采用"规则词典 + 加权打分"而非再调一次模型分类，理由有三——零成本零延迟、不占用对话的 token 额度、判定结果可回溯到具体命中词（答辩或复盘时能讲清"为什么判成焦虑"）。同时处理了否定词跨词误伤（"睡不着，心慌"里的"不"不会算到"心慌"头上）、词表重叠重复计数（"好烦"命中后不再重复计"烦"）等细节，并对危机表达强制压低分数，避免一条很重的求助只被打出"中等偏下"。
- **周报按本地时区切天**：数据库存 UTC，聚合时换算成 UTC+8 再分桶，避免晚间对话被算到第二天；没有对话的日子保留空桶，曲线不会丢点。
- **量表计分同样不走大模型**：PHQ-9 的九题分数由本地规则累加、等级查表映射，每一次结果都能还原到"第几题选了哪个选项"。第 9 题（自伤念头）只要不为零就单独给出求助提示，**不看总分**——这正是量表设计的本意，不能让一个"1 分"的重度求助被总分稀释掉。

## 五、目录结构

```
├── backend/
│   ├── app/
│   │   ├── core/        # 配置、密码与 JWT
│   │   ├── db/          # MongoDB 连接与索引
│   │   ├── models/      # Pydantic 数据模型
│   │   ├── routes/      # auth / chat / report / assessment 路由
│   │   ├── services/    # chatbot 大模型服务、emotion 情绪分析、assessment 量表计分
│   │   └── main.py      # FastAPI 入口
│   ├── requirements.txt
│   ├── .env.example     # 环境变量模板
│   └── .env             # 本地配置（不入库）
├── frontend/
│   ├── src/
│   │   ├── api/         # axios 实例与接口封装
│   │   ├── components/  # ChatWindow / MessageBubble / Sidebar ...
│   │   └── pages/       # AuthPage / ChatLayout / ReportPage / AssessmentPage
│   └── index.html
├── start.bat            # 一键启动脚本
└── render.yaml          # 后端部署配置
```

## 六、快速开始

**环境要求**：Python 3.11+、Node.js 18+、MongoDB（本地或 Atlas 免费集群）

### 1. 后端

```bash
cd backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

copy .env.example .env         # 然后按下一节填写
uvicorn app.main:app --reload
```

后端地址：http://127.0.0.1:8000 ，接口文档：http://127.0.0.1:8000/docs

### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

前端地址：http://localhost:5173

### 3. 一键启动

Windows 下双击 `start.bat`，会自动创建虚拟环境、安装依赖并同时拉起前后端。

## 七、环境变量

复制 `backend/.env.example` 为 `backend/.env`，填写以下项：

| 变量 | 说明 |
| --- | --- |
| `MONGO_URI` | MongoDB 连接串。免费方案：MongoDB Atlas 建集群后获取 |
| `DB_NAME` | 数据库名，默认 `niangao` |
| `JWT_SECRET` | 访问令牌密钥，用 `python -c "import secrets;print(secrets.token_hex(32))"` 生成 |
| `JWT_REFRESH_SECRET` | 刷新令牌密钥，须与上一条不同 |
| `LLM_API_KEY` | 大模型 API Key |
| `LLM_BASE_URL` | 模型服务地址，见下表 |
| `LLM_MODEL` | 模型名 |

**三种模型服务任选其一**（均为 OpenAI 兼容协议，切换只改三行配置）：

| 服务 | `LLM_BASE_URL` | `LLM_MODEL` |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 豆包 / 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` | 方舟控制台创建的推理接入点 ID |
| 通义千问 / 阿里云百炼 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |

前端如需指向远程后端，在 `frontend/.env` 写入 `VITE_API_URL_LINK=https://你的后端域名`。

## 八、接口一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/register` | 注册 |
| POST | `/auth/login` | 登录，返回双 Token |
| POST | `/auth/refresh` | 刷新访问令牌 |
| POST | `/auth/logout` | 登出并加入黑名单 |
| POST | `/chat/stream` | 流式对话（SSE） |
| POST | `/chat` | 非流式对话 |
| GET | `/chat/history` | 获取最近 50 条对话 |
| GET | `/report/weekly?days=7` | 情绪周报：每日均分、情绪分布、趋势与观察文字 |
| GET | `/assessment/phq9` | 获取 PHQ-9 题目、选项与指导语 |
| POST | `/assessment/phq9` | 提交作答，返回总分、五档等级、建议文案与风险提示 |
| GET | `/assessment/history?limit=5` | 最近几次自评记录 |

## 九、安全与伦理设计

1. **不做诊断**：年糕在 prompt 与界面文案中均明确声明自己是 AI 陪伴工具，不替代专业治疗。
2. **危机兜底**：后端对用户输入做关键词识别，命中时前端展示全国心理援助热线 400-161-9995 与 110 报警提示。
3. **隐私最小化**：对话仅存储于自建数据库，不做第三方分析；Token 登出即入黑名单。
4. **未成年人保护**：prompt 中约定遇到未成年用户时鼓励其告知信任的成年人。

## 十、部署

- 后端：Render（`render.yaml` 已配置，需在面板中填入 `MONGO_URI` 与 `LLM_API_KEY`）
- 前端：Vercel / Netlify，构建产物为 `frontend/dist`
- 数据库：MongoDB Atlas 免费集群

部署后请把前端域名加入 `backend/app/main.py` 的 CORS `origins` 列表。

## 十一、团队信息

| 角色 | 姓名 | 分工 |
| --- | --- | --- |
| 队长 / 全栈 | 待填写 | 架构设计、后端开发、AI 人设与对话策略 |
| 前端 | 待填写 | 界面与交互实现 |
| 产品 / 文档 | 待填写 | 需求梳理、测试、演示材料 |

> 提交前请补齐姓名、学校、联系方式。

## 十二、开源致谢

本项目基于 [Balamurugan7845/AI-Chatbot](https://github.com/Balamurugan7845/AI-Chatbot) 的 MIT 许可代码进行二次开发，保留原项目 LICENSE。

在此基础上完成的改造包括：大模型由 Gemini 迁移至 OpenAI 兼容协议、新增心理咨询人设与多轮上下文、新增危机识别兜底、修复流式解析缺陷、改为异步模型调用、补齐原项目缺失的 PyJWT 依赖、整体视觉与中文文案重构。

同时参考了以下心理健康领域开源成果的对话策略：

- MindChat（漫谈）· 华东理工大学 X-D Lab — 心理咨询四个维度的对话框架
- MeChat / SmileChat — 中文心理健康支持对话数据集与策略

## 十三、后续规划

- [x] 情绪日志与情绪周报（ECharts 可视化）
- [x] PHQ-9 标准化心理自评量表（九题 · 五档分级 · 第 9 题单独风险判定）
- [ ] GAD-7 焦虑自评量表
- [ ] 心理知识库 RAG（CBT 自助技巧）
- [ ] 语音输入与朗读
