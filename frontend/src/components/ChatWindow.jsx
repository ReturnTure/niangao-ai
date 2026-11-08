import { useState, useRef, useEffect, useCallback } from "react";
import MessageBubble from "./MessageBubble";
import TypingIndicator from "./TypingIndicator";
import { API_URL } from "../api/config";
import { createSSEParser } from "../api/sse";
import { motion, AnimatePresence } from "framer-motion";

const QUICK_STARTS = [
  "我最近压力特别大",
  "晚上总是睡不着",
  "和家里人吵架了，心里堵得慌",
];

export default function ChatWindow({ chat, setChat }) {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCrisis, setShowCrisis] = useState(false);

  const bottomRef = useRef(null);
  const controllerRef = useRef(null);
  const textareaRef = useRef(null);

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
    async (rawText) => {
      const userInput = (rawText ?? input).trim();
      if (!userInput || loading) return;

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
        controllerRef.current = new AbortController();

        // 统一读取 api 配置，不再硬编码地址
        const apiBase = API_URL.replace(/\/$/, "");

        const res = await fetch(`${apiBase}/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ message: userInput }),
          signal: controllerRef.current.signal,
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
            if (payload.delta) {
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
              if (payload.emotion) {
                setChat((prev) =>
                  prev.map((msg) =>
                    msg.id === messageId + "-user"
                      ? { ...msg, emotion: payload.emotion }
                      : msg,
                  ),
                );
              }
            }
          }
        }

        const finalText = botText.trim() ? botText : "我在呢，你再说一句好吗？";

        setChat((prev) =>
          prev.map((msg) =>
            msg.id === botId
              ? { ...msg, text: finalText, isStreaming: false }
              : msg,
          ),
        );
      } catch (err) {
        // 用户主动打断不算错误
        if (err?.name === "AbortError") {
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
        if (err.message?.includes("401")) {
          errorText = "⚠️ 登录已过期，请重新登录。";
        } else if (err.message?.includes("404")) {
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
      }
    },
    [input, loading, setChat],
  );

  const stopGeneration = useCallback(() => {
    controllerRef.current?.abort();
    setLoading(false);
  }, []);

  const isEmpty = chat.length === 0;

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
                  <motion.div
                    className="relative w-16 h-16 bg-gradient-to-br from-amber-300 to-orange-400 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-900/40"
                    animate={{ y: [0, -7, 0] }}
                    transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <span className="text-stone-900 font-bold text-2xl">年</span>
                  </motion.div>
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
          {chat.map((msg) => (
            <MessageBubble
              key={msg.id}
              role={msg.role}
              text={msg.text}
              isError={msg.isError}
              isStreaming={msg.isStreaming}
              emotion={msg.emotion}
            />
          ))}

          {loading && !chat.some((m) => m.isStreaming && m.text) && (
            <TypingIndicator />
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
                    　·　紧急情况请拨 <span className="font-semibold">110</span>
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

        <div className="max-w-3xl mx-auto flex items-end gap-3">
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
                  sendMessage();
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

        <p className="text-center text-xs text-stone-500 mt-2">
          Enter 发送 · Shift + Enter 换行 · 年糕不能替代专业心理咨询
        </p>
      </div>
    </div>
  );
}
