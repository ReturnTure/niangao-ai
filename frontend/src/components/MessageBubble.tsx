import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import type { MessageRole } from "../types";

/* ---------------- UTIL ---------------- */

function formatTime(iso?: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

// 结构化回复的识别关键词（中文心理咨询场景下极少触发，保留以兼容知识性问答）
const HEADINGS: readonly string[] = [
  "title",
  "overview",
  "definition",
  "key points",
  "key characteristics",
  "core functions",
  "details",
  "example",
  "summary",
];

/* ---------------- TYPE DETECTION ---------------- */

type MessageLayout = "paragraph" | "structured" | "list";

function detectType(text = ""): MessageLayout {
  if (!text) return "paragraph";

  const lower = text.toLowerCase();

  if (HEADINGS.some((h) => lower.includes(h))) {
    return "structured";
  }

  if (text.includes("•")) return "list";

  return "paragraph";
}

/* ---------------- STRUCTURED VIEW ---------------- */

interface StructuredViewProps {
  text?: string;
}

function StructuredView({ text = "" }: StructuredViewProps) {
  const lines = text.split("\n");

  const sections: Record<string, string[]> = {};
  let current: string | null = null;

  lines.forEach((line) => {
    const t = line.trim();
    if (!t) return;

    const normalized = t.replace(":", "").toLowerCase();

    if (HEADINGS.includes(normalized)) {
      current = normalized;
      sections[current] = [];
      return;
    }

    if (current) sections[current].push(t);
  });

  return (
    <div className="space-y-2 text-sm">
      {sections["title"] && (
        <h3 className="text-base font-semibold text-stone-800">
          {sections["title"].join(" ")}
        </h3>
      )}

      {(sections["overview"] || sections["definition"]) && (
        <p className="text-stone-600 leading-relaxed">
          {(sections["overview"] || sections["definition"]).join(" ")}
        </p>
      )}

      {["key points", "key characteristics", "core functions", "details"].map(
        (key) =>
          sections[key] && (
            <ul key={key} className="list-disc ml-5 space-y-1 text-stone-700">
              {sections[key].map((l, i) => (
                <li key={i}>{l.replace(/^•\s?/, "")}</li>
              ))}
            </ul>
          ),
      )}

      {sections["example"] && (
        <div className="bg-stone-100 border border-stone-200 rounded-lg p-2 text-xs font-mono text-stone-600 whitespace-pre-wrap">
          {sections["example"].join("\n")}
        </div>
      )}

      {sections["summary"] && (
        <p className="text-stone-500 italic text-xs border-t border-stone-200 pt-2">
          {sections["summary"].join(" ")}
        </p>
      )}
    </div>
  );
}

/* ---------------- AVATARS ---------------- */

function BotAvatar() {
  return (
    <div className="relative w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center shadow-md shadow-amber-900/30 shrink-0 mt-0.5">
      <span className="text-stone-900 text-xs font-bold">年</span>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-white/85 border border-stone-300/80 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-stone-500 text-xs">我</span>
    </div>
  );
}

/* ---------------- COPY BUTTON ---------------- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text.replace(/▋$/, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默失败 */
    }
  }, [text]);

  return (
    <button
      onClick={copy}
      title={copied ? "已复制" : "复制"}
      className={`p-1 rounded transition ${
        copied
          ? "text-emerald-400"
          : "text-stone-400 hover:text-stone-600 hover:bg-stone-100"
      }`}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

/* ---------------- EMOTION TAG ---------------- */

const EMOTION_STYLE: Record<string, string> = {
  积极: "text-amber-700 bg-amber-100/90 border-amber-300",
  平静: "text-stone-500 bg-stone-100/90 border-stone-300",
  焦虑: "text-sky-700 bg-sky-100/90 border-sky-300",
  低落: "text-slate-600 bg-slate-100/90 border-slate-300",
  愤怒: "text-rose-700 bg-rose-100/90 border-rose-300",
};

function EmotionTag({ label }: { label: string }) {
  const style = EMOTION_STYLE[label] ?? "text-stone-500 bg-stone-100/90 border-stone-300";

  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className={`px-1.5 py-0.5 rounded-full border text-[10px] ${style}`}
      title="年糕从这句话里读到的情绪"
    >
      {label}
    </motion.span>
  );
}

/* ---------------- MAIN COMPONENT ---------------- */

export interface MessageBubbleProps {
  role: MessageRole;
  text?: string;
  timestamp?: string;
  isError?: boolean;
  isStreaming?: boolean;
  /** 后端判定的情绪标签 */
  emotion?: string;
  /** 本轮回答依据的知识卡片标题 */
  refs?: string[];
}

export default function MessageBubble({
  role,
  text = "",
  timestamp,
  isError,
  isStreaming: propStreaming,
  emotion,
  refs,
}: MessageBubbleProps) {
  const isBot = role === "bot";

  // 只有文本真的带光标符时才裁掉最后一个字符，避免吞字
  const hasCursor = typeof text === "string" && text.endsWith("▋");
  const isStreaming = Boolean(propStreaming) || hasCursor;
  const displayText = hasCursor ? text.slice(0, -1) : text;

  const type = detectType(displayText);

  return (
    <motion.div
      initial={{ opacity: 0, x: isBot ? -10 : 10, y: 10 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className={`flex gap-2 group ${isBot ? "justify-start" : "justify-end"} mb-3`}
    >
      {/* Bot Avatar */}
      {isBot && <BotAvatar />}

      <div
        className={`flex flex-col gap-1 max-w-[82%] sm:max-w-[70%] ${
          isBot ? "items-start" : "items-end"
        }`}
      >
        <div
          className={`
            px-3.5 py-2.5 rounded-2xl text-sm break-words leading-relaxed
            ${
              isBot
                ? isError
                  ? "bg-red-50 border border-red-300/70 text-red-600"
                  : "bg-white/90 border border-stone-200/80 text-stone-800 shadow-sm shadow-stone-200/60"
                : "bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-sm shadow-orange-300/50"
            }
          `}
        >
          {!displayText && !isStreaming ? null : type === "structured" ? (
            <StructuredView text={displayText} />
          ) : type === "list" ? (
            <ul className="list-disc ml-5">
              {displayText
                .split("\n")
                .filter((l) => l.startsWith("•"))
                .map((l, i) => (
                  <li key={i}>{l.replace(/^•\s?/, "")}</li>
                ))}
            </ul>
          ) : (
            <p className="whitespace-pre-wrap">{displayText}</p>
          )}

          {isStreaming && (
            <span className="inline-block w-[2px] h-4 bg-amber-400 ml-1 animate-pulse rounded" />
          )}
        </div>

        {/* 依据来源：让用户看到这句话不只是模型「觉得」 */}
        {isBot && refs && refs.length > 0 && !isError && !isStreaming && (
          <div className="flex flex-wrap items-center gap-1 max-w-full">
            <span className="text-[10px] text-stone-400">依据</span>
            {refs.map((r, i) => (
              <span
                key={i}
                className="px-1.5 py-0.5 rounded-full bg-stone-100/80 border border-stone-200/70 text-[10px] text-stone-500"
                title="年糕本轮参考的知识卡片"
              >
                {r}
              </span>
            ))}
          </div>
        )}

        <div
          className={`flex items-center gap-1 text-[10px] text-stone-500 ${
            isBot ? "" : "flex-row-reverse"
          }`}
        >
          {emotion && !isError && <EmotionTag label={emotion} />}

          {timestamp && <span>{formatTime(timestamp)}</span>}

          {displayText && !isError && !isStreaming && (
            <span className="opacity-0 group-hover:opacity-100 transition">
              <CopyButton text={displayText} />
            </span>
          )}
        </div>
      </div>

      {!isBot && <UserAvatar />}
    </motion.div>
  );
}
