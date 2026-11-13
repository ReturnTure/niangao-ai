# 语音播报 + 离线语音输入 · 接入说明

> 状态：**已接入主程序**。`chatbot.py` / `chat.py` 依然一个字没动，
> 语音完全活在「播放层」和「输入层」，不侵入对话链路。
>
> 语音播报：年糕的回复边生成边念（edge-tts，不可用时降级浏览器语音）
> 语音输入：点麦克风说话，Vosk 中文小模型在本机识别成文字

---

## 一、它做了什么

```
                     ┌──────────────── 语音输入（ASR）────────────────┐
                     │  点麦克风 → AudioContext 取 16k PCM            │
                     │  → 打 WAV → POST /voice/asr → Vosk 离线识别    │
                     │  → 文字落到输入框（音频不出本机、不落库）        │
                     └───────────────────────┬───────────────────────┘
                                             ▼
用户提问 ──► /chat/stream（原有，未改动）──► delta 一段段返回
                                             │
                     ┌───────────────────────┴───────────────────────┐
                     ▼                                               ▼
          喂给前端播放器 voice.feed(delta)                   文字照常渲染
                     │
            按标点切成完整句子
                     │
            ┌────────┴─────────┐
            ▼                  ▼
     后端 edge-tts 合成     浏览器 Web Speech
     （真人质感 mp3）       （零依赖兜底）
            └────────┬─────────┘
                     ▼
           队列播放（下一句提前合成）
```

三个关键设计：

| 能力 | 说明 |
| --- | --- |
| 流式切句 | 收到「听起来你」不出声，收到「很累了。」才合成播放，一句一句接着来 |
| 预取 | 正在播第 1 句时，第 2 句已经在合成，句与句之间几乎没停顿 |
| 打断 | 用户发新消息 / 打开麦克风 / 关掉开关，立刻静音并清空队列，不会串音 |

---

## 二、改了哪些文件

### 主程序接入（6 处）

| 文件 | 改动 |
| --- | --- |
| `backend/app/main.py` | `include_router(voice.router)`；启动时预加载 Vosk 模型并打印语音状态 |
| `backend/app/routes/voice.py` | 新增 ASR 三个接口（你之前改的鉴权策略保持不变） |
| `frontend/src/components/ChatWindow.tsx` | `useVoice` + `useVoiceInput` 两个 Hook，输入框两侧加麦克风与喇叭按钮 |

### 新增文件

后端：

| 文件 | 作用 |
| --- | --- |
| `backend/app/services/tts.py` | 文本清洗、分句、流式分句器、edge-tts 合成、磁盘缓存 |
| `backend/app/services/asr.py` | Vosk 模型加载、WAV 解析、重采样、整段/流式识别、文本整理 |
| `backend/app/routes/voice.py` | `/voice/*` 全部接口 |
| `backend/app/models/voice.py` | 请求模型 |
| `backend/scripts/tts_selftest.py` | 播报自测（不需要起服务） |
| `backend/scripts/asr_selftest.py` | 识别自测（可用 `--tts` 造一句中文说给自己听） |
| `backend/requirements-voice.txt` | 语音可选依赖（edge-tts / vosk） |

前端 `frontend/src/voice/`（全部 TypeScript，`npm run typecheck` 按 strict 检查）：

| 文件 | 作用 |
| --- | --- |
| `VoicePlayer.ts` | 播报核心：双引擎、队列、预取、打断、自动降级、看门狗 |
| `textChunker.ts` | 文本清洗 + 分句 + 流式分句（规则与后端一致） |
| `useVoice.ts` | 播报 Hook |
| `VoiceToggle.tsx` | 喇叭开关按钮 |
| `MicRecorder.ts` | 录音：16kHz PCM、音量回调、WAV 打包 |
| `wav.ts` | 重采样 / WAV 编码（纯函数，可单测） |
| `asrClient.ts` | ASR 接口客户端 + 错误码映射 |
| `useVoiceInput.ts` | 输入 Hook（录音 → 识别 → 回填文字） |
| `MicButton.tsx` | 麦克风按钮（录音呼吸圈 / 识别转圈 / 不可用置灰） |
| `index.ts` | 统一出口（值 + 类型一起导出） |

所有对外类型都可直接引用：

```ts
import type { UseVoiceApi, VoiceState, EngineInUse, AsrResult } from "../voice";
```


### 接口一览

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| GET | `/voice/health` | 公开 | 合成引擎状态、音色与语速预设 |
| GET | `/voice/voices` | 公开 | 音色列表 |
| GET | `/voice/preview` | 公开 | 试听一句，浏览器直接打开就能听 |
| POST | `/voice/tts` | 需登录 | `{"text":"一句话"}` → mp3 流 |
| POST | `/voice/split` | 需登录 | 文本 → 句子数组（调分句用） |
| GET | `/voice/asr/health` | 公开 | 识别是否可用（vosk 装没装、模型在不在） |
| POST | `/voice/asr` | 需登录 | WAV/裸 PCM 二进制 → `{"text","duration","ms"}` |
| WS | `/voice/asr/ws?token=` | 需登录 | 边录边识别（预留，前端当前走整段 POST） |

---

## 三、准备模型（本机已就绪）

**这台机器上已经装好了**：`edge-tts 7.3.1`、`vosk`，模型解压在
`backend/models/vosk-model-small-cn-0.22/`（磁盘 66MB），直接跑就行。

换机器 / 重新部署时按下面两步做：

```bash
# 1. 装依赖（可选，不装也能跑，会降级）
cd backend
venv\Scripts\pip install -r requirements-voice.txt

# 2. 下载中文小模型（42MB）并解压到 backend/models/
#    https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip
#    解压后目录应形如：
#    backend/models/vosk-model-small-cn-0.22/  （里面是 am/ conf/ graph/ ivector/）
```

模型目录也可以用环境变量指定：`VOSK_MODEL_DIR=D:\models\vosk-model-small-cn-0.22`。
程序会自动在 `backend/models/` 下找第一个含 `am/` + `conf/` 的目录，所以解压层级差一层也没关系。

---

## 四、自测（不用启动整个项目）

```bash
cd backend

# 播报：清洗 / 分句 / 流式分句 / 参数归一化；装了 edge-tts 会真合成到 samples/tts_demo.mp3
venv\Scripts\python.exe scripts\tts_selftest.py

# 识别：文本整理 / WAV 解析 / 重采样 / 模型状态
venv\Scripts\python.exe scripts\asr_selftest.py

# 识别真效果：让 edge-tts 念一句中文，再让 Vosk 听写回来（需要 miniaudio 解码 mp3）
venv\Scripts\python.exe scripts\asr_selftest.py --tts

# 也可以指定自己的录音
venv\Scripts\python.exe scripts\asr_selftest.py --wav D:\some\voice.wav
```

---

## 五、前端怎么用

输入框从左到右：**文字输入 → 麦克风 → 喇叭 → 发送**

| 操作 | 结果 |
| --- | --- |
| 点麦克风 | 开始录音，按钮变红、外圈随音量缩放；输入框下方提示「正在听你说 x.x 秒」 |
| 再点一次 | 停止录音并上传识别，按钮转圈，提示「年糕正在听写…」 |
| 识别完成 | 文字自动接到输入框末尾，光标回填，可直接改或回车发送（**不自动发送**，避免识别错了话已经发出去） |
| 超过 60 秒 | 自动停止并识别，防止一次传几十兆 |
| 点喇叭 | 打开/关闭播报，状态记在 localStorage，下次进来自动恢复 |

录音开始时如果年糕正在说话，会先静音 —— 否则麦克风会把它自己的声音也录进去。

---

## 六、可调参数

### 环境变量（`backend/.env`，全部可选）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `TTS_ENABLED` | `1` | `0` 关闭服务端合成（前端自动用浏览器语音） |
| `TTS_VOICE` | `zh-CN-XiaoxiaoNeural` | 默认音色：晓晓/晓伊/云希/云健/晓北/晓妮 |
| `TTS_PRESET` | `warm` | 语速音高：`warm` `calm` `slow` `cheerful` |
| `TTS_CACHE` | `1` | 磁盘缓存，同一句话只合成一次 |
| `TTS_MAX_TEXT_LEN` | `1200` | 单次合成字数上限 |
| `ASR_ENABLED` | `1` | `0` 关闭语音识别（前端麦克风变灰） |
| `ASR_MAX_BYTES` | `10485760` | 单次上传音频上限（10MB ≈ 5 分钟 16k/16bit） |
| `VOSK_MODEL_DIR` | 自动探测 | 指定模型目录 |
| `VOICE_REQUIRE_AUTH` | `1` | `/tts`、`/split`、`/asr` 是否要求登录（你已改成默认 1） |

### 前端

```javascript
const voice = useVoice({ apiBase: API_URL, voice: "zh-CN-XiaoyiNeural", preset: "calm" });
const mic = useVoiceInput({ apiBase: API_URL, onText: (t) => setInput(t), maxSeconds: 60 });
```

---

## 七、已知限制

1. **edge-tts 依赖微软在线语音服务**，需要外网；不通时自动降级浏览器语音，不报错。
2. **浏览器语音质量参差**：Windows Chrome/Edge 自带中文语音尚可；部分 Linux 没有中文语音包。
3. **麦克风需要安全上下文**：`localhost` 可以，`http://192.168.x.x` 不行（浏览器限制），
   手机测试要么用 `https`，要么用 `chrome://flags/#unsafely-treat-insecure-origin-as-secure` 临时放行。
4. **Vosk 小模型的能力边界**：安静环境、正常语速、普通话识别较准；方言、口音重、嘈杂环境会掉字；
   **不带标点**（Vosk 中文模型输出纯文本），所以回填到输入框的是「我最近压力很大」而不是「我最近压力很大。」。
5. **识别速度**：服务端 CPU 推理，实测 4.5 秒语音约 1.1 秒出字（比实时快 4 倍），
   模型加载 0.2 秒、常驻内存约 100~200MB。免费云主机（512MB）不建议开识别。
6. **音频不落库**：识别完内存里的 PCM 直接丢，不写磁盘、不进数据库——这是刻意的隐私选择。
7. **`/voice/asr/ws` 是预留接口**：前端目前用整段 POST（更稳），需要边说边上屏时再切过去。

---

## 八、验证记录

| 项目 | 结果 |
| --- | --- |
| 播报自测（清洗/分句/流式分句/参数） | 全部通过 |
| 播报真实合成 | 通过，`backend/samples/tts_demo.mp3`（34.7KB）可直接双击试听 |
| 播报前端逻辑（排队、打断、重播、降级、中途失败） | 全部通过 |
| 识别自测（文本整理、WAV 解析、44.1k 立体声重采样、垃圾数据拒绝） | 全部通过 |
| 识别真实效果 | `你好，我是年糕。今天过得还好吗？` → 识别为 `你好我是年糕今天过得还好吗`（Vosk 不输出标点）；`我最近工作压力特别大，晚上总是睡不着。` → `我最近工作压力特别大晚上总是睡不着` |
| 识别速度 | 4.46 秒音频用 1076~1088ms，接口整体 1.32s（含 HTTP） |
| 识别前端逻辑（WAV 编码头、48k→16k、录音帧合并、503/401 错误映射） | 全部通过 |
| 鉴权边界 | `VOICE_REQUIRE_AUTH=1` 时：无 token 访问 `/voice/asr`、`/voice/tts` 返回 401；`/voice/health`、`/voice/asr/health` 保持 200（前端未登录也能探测） |
| 路由挂载 | `app.openapi()` 中已出现 `/voice/tts`、`/voice/asr` 等 7 个路径 |
| ESLint / vite build | 0 error / 构建成功（2797 modules，462KB gzip 150KB） |
| TypeScript 迁移 | `npm run typecheck`（strict + noUnused*）0 错误；语音 10 个文件全部 `.ts/.tsx` |
| TS 有效性反向验证 | 故意传错参数（`feed(123)`、把 `engine` 赋给 number）能被 tsc 精确报出，说明检查真的在跑 |
| 迁移后行为回归 | 编译产物跑 26 项断言（清洗/分句/流式/WAV 头/重采样/拼接）全部通过 |
| 真机麦克风 | 需要你在浏览器里点一次麦克风确认（我这边没有麦克风设备） |
