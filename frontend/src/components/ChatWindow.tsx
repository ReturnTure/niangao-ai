import { useState, useRef, useEffect, useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import NiangaoSprite from "./NiangaoSprite";
import { API_URL } from "../api/config";
import { createSSEParser } from "../api/sse";
import { useVoice, VoiceToggle, useVoiceInput, MicButton } from "../voice";
import { decideSticker, isStickerId, lastStickerTurnOf, StickerBubble } from "../sticker";
import { motion, AnimatePresence } from "framer-motion";
import type { ChatHistory } from "../types";

const QUICK_STARTS = [
  "我最近压力特别大",
  "晚上总是睡不着",
  "和家里人吵架了，心里堵得慌",
];

export interface ChatWindowProps {
  chat: ChatHistory;
  setChat: Dispatch<SetStateAction<ChatHistory>>;
}

/** 输入框上方那行状态提示 */
interface VoiceStatus {
  text: string;
  tone: string;
}

export default function ChatWindow({ chat, setChat }: ChatWindowProps) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);
  // 工具调用期间的一句话，例如「年糕正在翻看你最近的情绪记录…」
  const [toolStatus, setToolStatus] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // ---------------- 表情包 ----------------

  // 决策要看"上次发表情是第几轮"，而 sendMessage 是个长生命周期的闭包，
  // 直接读 chat 会拿到旧值，所以用 ref 镜像一份最新的会话。
  const chatRef = useRef<ChatHistory>(chat);
  useEffect(() => {
    chatRef.current = chat;
  }, [chat]);

  // 表情比正文晚半秒出现，节奏上像"说完话又贴了张图"。
  // 用 ref 存定时器，用户中途发新消息时要能取消，否则图会贴到下一轮去。
  const stickerTimerRef = useRef<number | null>(null);

  const clearStickerTimer = useCallback((): void => {
    if (stickerTimerRef.current !== null) {
      window.clearTimeout(stickerTimerRef.current);
      stickerTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearStickerTimer, [clearStickerTimer]);

  // ---------------- 语音：播报 + 输入 ----------------

  // 播报：年糕的回答边生成边念（后端 edge-tts，失败自动降级浏览器语音）
  const voice = useVoice({ apiBase: API_URL });
  const { feed: feedSpeech, flush: flushSpeech, stop: stopSpeech } = voice;

  // 识别出的文字接到输入框里，光标自动落回去，用户可以直接改或回车发送
  const handleVoiceText = useCallback((text: string): void => {
    setInput((prev) => {
      const base = prev.trim();
      if (!base) return text;
      const needSpace = !/[，。！？,.!?、]$/.test(base) && !/^[，。！？,.!?、]/.test(text);
      return base + (needSpace ? " " : "") + text;
    });
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, []);

  // 输入：点麦克风录音，松开（再点一次）后由后端 Vosk 离线识别成中文
  const mic = useVoiceInput({ apiBase: API_URL, onText: handleVoiceText });

  // 录音期间不播报，否则麦克风会把年糕自己的声音也录进去
  const micRecordingRef = useRef(false);
  useEffect(() => {
    micRecordingRef.current = mic.recording;
  }, [mic.recording]);

  const handleMicToggle = useCallback((): void => {
    // 说话之前先把年糕的声音停掉，否则麦克风把它的声音也录进去
    if (!mic.recording) stopSpeech();
    mic.toggle();
  }, [mic, stopSpeech]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat, loading]);

  // Auto resize
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }, [input]);

  // Focus input
  useEffect(() => {
    textareaRef.current?.focus();
  }, [loading]);

  const sendMessage = useCallback(
    async (rawText?: string): Promise<void> => {
      const userInput = (rawText ?? input).trim();
      if (!userInput || loading) return;

      // 发新消息 = 打断上一轮播报，避免两段声音叠在一起
      stopSpeech();

      // 上一轮的表情如果还在等定时器，直接取消，别贴到这一轮
      clearStickerTimer();

      // 本轮序号（从 0 开始）与上一次发表情的位置，都按"发送这一刻"的历史算
      const history = chatRef.current;
      const turnIndex = history.filter((m) => m.role === "user").length;
      const lastStickerTurn = lastStickerTurnOf(history);

      const messageId = Date.now();
      const botId = messageId + "-bot";

      setChat((prev) => [
        ...prev,
        { id: messageId + "-user", role: "user", text: userInput },
        { id: botId, role: "bot", text: "", isStreaming: true },
      ]);

      setInput("");
      setLoading(true);

      let botText = "";

      try {
        const token = localStorage.getItem("token");
        const controller = new AbortController();
        controllerRef.current = controller;

        // 统一读取 api 配置，不再硬编码地址
        const apiBase = API_URL.replace(/\/$/, "");

        const res = await fetch(`${apiBase}/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: userInput }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        if (!res.body) throw new Error("No stream received");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSSEParser();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const events = parser.consume(decoder.decode(value, { stream: true }));

          for (const payload of events) {
            // 本轮回答的依据来源（知识库命中的标题）
            if (payload.refs) {
              const refs = payload.refs;
              setChat((prev) =>
                prev.map((msg) =>
                  msg.id === botId ? { ...msg, refs } : msg,
                ),
              );
              continue;
            }

            // 工具调用中的过渡状态（模型在查数据，还没开始说话）
            if (payload.status) {
              setToolStatus(payload.status);
              continue;
            }

            if (payload.delta) {
              // 第一个字到了，状态提示就该消失
              setToolStatus((prev) => (prev ? "" : prev));

              // 边说边念：凑满一句就开口，不用等全文生成完
              if (!micRecordingRef.current) feedSpeech(payload.delta);

              botText += payload.delta;
              setChat((prev) =>
                prev.map((msg) =>
                  msg.id === botId
                    ? { ...msg, text: botText, isStreaming: true }
                    : msg,
                ),
              );
            }

            if (payload.done) {
              if (payload.crisis) setShowCrisis(true);

              // 把本轮情绪挂到用户那条消息上，气泡下方会显示一个小标签
              const emotion = payload.emotion;
              if (emotion) {
                setChat((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId + "-user"
                      ? { ...msg, emotion }
                      : msg,
                  ),
                );
              }

              // 要不要顺手贴一张表情包：先过一遍否决规则，再按情绪挑图
              const decision = decideSticker({
                emotion: emotion ?? "",
                userText: userInput,
                botText,
                crisis: Boolean(payload.crisis),
                turnIndex,
                lastStickerTurn,
              });

              if (decision) {
                console.info(
                  `[sticker] ${decision.sticker.id} ← ${decision.reason}`,
                );

                stickerTimerRef.current = window.setTimeout(() => {
                  stickerTimerRef.current = null;
                  setChat((prev) => [
                    ...prev,
                    {
                      id: `${botId}-sticker`,
                      role: "bot",
                      text: "",
                      sticker: decision.sticker.id,
                    },
                  ]);
                }, 460);
              }
            }
          }
        }

        // 流结束：把最后不足一句的尾巴也念掉
        if (!micRecordingRef.current) void flushSpeech();

        const finalText = botText.trim() ? botText : "我在呢，你再说一句好吗？";

        setChat((prev) =>
          prev.map((msg) =>
            msg.id === botId
              ? { ...msg, text: finalText, isStreaming: false }
              : msg,
          ),
        );
      } catch (err) {
        const e = err as Error;

        // 用户主动打断不算错误
        if (e?.name === "AbortError") {
          if (botText.trim()) {
            setChat((prev) =>
              prev.map((msg) =>
                msg.id === botId
                  ? { ...msg, text: botText, isStreaming: false }
                  : msg,
              ),
            );
          }
          return;
        }

        console.error("STREAM ERROR:", err);

        let errorText = "⚠️ 连接出了点问题，稍后再试试好吗？";
        if (e.message?.includes("401")) {
          errorText = "⚠️ 登录已过期，请重新登录。";
        } else if (e.message?.includes("404")) {
          errorText = "⚠️ 后端服务没启动，请先运行 backend。";
        }

        setChat((prev) =>
          prev.map((msg) =>
            msg.id === botId
              ? { ...msg, text: errorText, isError: true, isStreaming: false }
              : msg,
          ),
        );
      } finally {
        setLoading(false);
        setToolStatus("");
      }
    },
    [input, loading, setChat, stopSpeech, feedSpeech, flushSpeech, clearStickerTimer],
  );

  const stopGeneration = useCallback((): void => {
    controllerRef.current?.abort();
    setLoading(false);
  }, []);

  const isEmpty = chat.length === 0;

  // 输入区上方的一行动态提示：录音中 / 识别中 / 出错 / 一次性的「没听清」
  const voiceStatus: VoiceStatus | null = mic.error
    ? { text: mic.error, tone: "text-red-600" }
    : mic.hint
      ? { text: mic.hint, tone: "text-amber-700" }
      : mic.recording
        ? { text: `正在听你说 ${mic.seconds.toFixed(1)} 秒… 说完再点一下麦克风`, tone: "text-red-500" }
        : mic.transcribing
          ? { text: "年糕正在听写…", tone: "text-amber-700" }
          : voice.enabled && voice.error
            ? { text: voice.error, tone: "text-amber-600" }
            : null;

  return (
    <div className="flex flex-col flex-1 h-screen bg-transparent">
      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto thin-scrollbar px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-5">
          {/* Empty State */}
          <AnimatePresence>
            {isEmpty && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex flex-col items-center justify-center h-[52vh] gap-6 text-center"
              >
                {/* 年糕：呼吸光晕 + 轻微浮动 */}
                <div className="relative">
                  <motion.div
                    className="absolute inset-0 rounded-full bg-amber-400/25 blur-3xl"
                    animate={{ scale: [1, 1.3, 1], opacity: [0.35, 0.7, 0.35] }}
                    transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <motion.div
                    className="absolute -inset-4 rounded-full border border-amber-400/10"
                    animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.15, 0.4] }}
                    transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
                  />
                  <div className="relative">
                    <NiangaoSprite size={104} />
                  </div>
                </div>

                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15, duration: 0.4 }}
                  className="space-y-2"
                >
                  <p className="text-stone-800 text-lg font-medium tracking-wide">
                    你好，我是年糕
                  </p>
                  <p className="text-stone-500 text-sm leading-relaxed max-w-sm">
                    我不评判，也不催你振作。
                    <br />
                    想说什么都可以，我在这儿听着。
                  </p>
                </motion.div>

                {/* 快捷开始 */}
                <div className="flex flex-wrap justify-center gap-2 max-w-md pt-1">
                  {QUICK_STARTS.map((q, i) => (
                    <motion.button
                      key={q}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 + i * 0.08, duration: 0.35 }}
                      whileHover={{ y: -2, scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      onClick={() => sendMessage(q)}
                      className="px-3.5 py-1.5 rounded-full text-xs text-stone-600 bg-white/80 border border-stone-300/70 shadow-sm shadow-stone-200/50 hover:bg-amber-50 hover:border-amber-400/70 hover:text-amber-800 hover:shadow-md transition-colors"
                    >
                      {q}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          {chat.map((msg) => {
            // 表情消息：id 可能存在旧存档里，先校验再渲染，否则会白屏一格
            if (msg.sticker) {
              return isStickerId(msg.sticker) ? (
                <StickerBubble key={msg.id} id={msg.sticker} />
              ) : null;
            }

            return (
              <MessageBubble
                key={msg.id}
                role={msg.role}
                text={msg.text}
                isError={msg.isError}
                isStreaming={msg.isStreaming}
                emotion={msg.emotion}
                refs={msg.refs}
              />
            );
          })}

          {loading && !chat.some((m) => m.isStreaming && m.text) && (
            <TypingIndicator label={toolStatus} />
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Crisis Card */}
      <AnimatePresence>
        {showCrisis && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="px-4"
          >
            <div className="max-w-3xl mx-auto mb-2 px-4 py-3 rounded-xl bg-red-50/90 border border-red-300/70 backdrop-blur-sm">
              <div className="flex items-start gap-2">
                <span className="text-red-500 text-sm">⚠️</span>
                <div className="flex-1 text-xs text-red-700 leading-relaxed">
                  <p className="font-medium mb-1">
                    如果你现在很难受，请让专业的人陪你
                  </p>
                  <p>
                    全国心理援助热线 <span className="font-semibold">400-161-9995</span>（24 小时）
                     · 紧急情况请拨 <span className="font-semibold">110</span>
                  </p>
                  <p className="mt-1 text-red-600/70">
                    也可以联系身边信任的人，或去最近医院的急诊。年糕会一直在这里，但年糕不是医生。
                  </p>
                </div>
                <button
                  onClick={() => setShowCrisis(false)}
                  className="text-red-400 hover:text-red-600 text-xs"
                >
                  ✕
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Area */}
      <div className="relative sticky bottom-0 border-t border-stone-200/70 bg-white/55 backdrop-blur-2xl px-4 py-3">
        {/* 顶部一条暖色细线，和上方内容做视觉分隔 */}
        <div className="absolute inset-x-0 -top-px h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

        <div className="max-w-3xl mx-auto flex items-end gap-2">
          <label htmlFor="chat-textarea" className="sr-only">
            想对年糕说的话
          </label>
          <div className="relative flex-1 group">
            <textarea
              id="chat-textarea"
              name="message"
              ref={textareaRef}
              value={input}
              disabled={loading}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder="想和年糕说点什么……"
              rows={1}
              className="
              w-full resize-none px-4 py-3 rounded-xl
              bg-white/90 border border-stone-300/80
              text-stone-800 text-sm
              focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/60
              focus:shadow-[0_0_24px_-8px_rgba(217,119,6,0.45)]
              placeholder-stone-400
              max-h-[160px] overflow-y-auto thin-scrollbar
              disabled:opacity-60
              transition-shadow
            "
            />
          </div>

          {/* 语音输入：点一下开始说，再点一下识别成文字 */}
          <MicButton
            recording={mic.recording}
            transcribing={mic.transcribing}
            level={mic.level}
            seconds={mic.seconds}
            available={mic.available}
            reason={mic.reason}
            onToggle={handleMicToggle}
          />

          {/* 语音播报开关 */}
          <VoiceToggle
            enabled={voice.enabled}
            speaking={voice.speaking}
            engine={voice.engine}
            onToggle={voice.toggle}
          />

          {loading ? (
            <button
              onClick={stopGeneration}
              title="停止"
              className="w-11 h-11 flex items-center justify-center rounded-xl bg-red-500 hover:bg-red-600 text-white transition"
            >
              ■
            </button>
          ) : (
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim()}
              title="发送"
              className="
              w-11 h-11 flex items-center justify-center rounded-xl
              bg-gradient-to-br from-amber-500 to-orange-500
              text-white shadow-md shadow-orange-300/50
              hover:scale-105 transition
              disabled:opacity-40 disabled:hover:scale-100
            "
            >
              ➤
            </button>
          )}
        </div>

        <div className="mt-2 text-center text-xs space-y-0.5">
          {voiceStatus && <p className={voiceStatus.tone}>{voiceStatus.text}</p>}
          <p className="text-stone-500">
            Enter 发送 · Shift + Enter 换行 · 年糕不能替代专业心理咨询
          </p>
        </div>
      </div>
    </div>
  );
}
