import { useState, useCallback } from "react";

/* ---------------- UTIL ---------------- */

function formatTime(iso) {
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
const HEADINGS = [
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

function detectType(text = "") {
  if (!text) return "paragraph";

  const lower = text.toLowerCase();

  if (HEADINGS.some((h) => lower.includes(h))) {
    return "structured";
  }

  if (text.includes("•")) return "list";

  return "paragraph";
}

/* ---------------- STRUCTURED VIEW ---------------- */

function StructuredView({ text = "" }) {
  const lines = text.split("\n");

  const sections = {};
  let current = null;

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
        <h3 className="text-base font-semibold text-white">
          {sections["title"].join(" ")}
        </h3>
      )}

      {(sections["overview"] || sections["definition"]) && (
        <p className="text-stone-300 leading-relaxed">
          {(sections["overview"] || sections["definition"]).join(" ")}
        </p>
      )}

      {["key points", "key characteristics", "core functions", "details"].map(
        (key) =>
          sections[key] && (
            <ul key={key} className="list-disc ml-5 space-y-1 text-stone-200">
              {sections[key].map((l, i) => (
                <li key={i}>{l.replace(/^•\s?/, "")}</li>
              ))}
            </ul>
          ),
      )}

      {sections["example"] && (
        <div className="bg-black/30 border border-white/10 rounded-lg p-2 text-xs font-mono text-stone-300 whitespace-pre-wrap">
          {sections["example"].join("\n")}
        </div>
      )}

      {sections["summary"] && (
        <p className="text-stone-400 italic text-xs border-t border-white/10 pt-2">
          {sections["summary"].join(" ")}
        </p>
      )}
    </div>
  );
}

/* ---------------- AVATARS ---------------- */

function BotAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center shadow-md shrink-0 mt-0.5">
      <span className="text-stone-900 text-xs font-bold">年</span>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-7 h-7 rounded-full bg-white/10 border border-white/15 flex items-center justify-center shrink-0 mt-0.5">
      <span className="text-stone-300 text-xs">我</span>
    </div>
  );
}

/* ---------------- COPY BUTTON ---------------- */

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
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
          : "text-stone-500 hover:text-stone-300 hover:bg-white/5"
      }`}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

/* ---------------- MAIN COMPONENT ---------------- */

export default function MessageBubble({
  role,
  text = "",
  timestamp,
  isError,
  isStreaming: propStreaming,
}) {
  const isBot = role === "bot";

  // 只有文本真的带光标符时才裁掉最后一个字符，避免吞字
  const hasCursor = typeof text === "string" && text.endsWith("▋");
  const isStreaming = Boolean(propStreaming) || hasCursor;
  const displayText = hasCursor ? text.slice(0, -1) : text;

  const type = detectType(displayText);

  return (
    <div
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
                  ? "bg-red-500/10 border border-red-500/20 text-red-300"
                  : "bg-white/10 border border-white/10 text-stone-100"
                : "bg-gradient-to-br from-amber-500 to-orange-500 text-white"
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

        <div
          className={`flex items-center gap-1 text-[10px] text-stone-500 ${
            isBot ? "" : "flex-row-reverse"
          }`}
        >
          {timestamp && <span>{formatTime(timestamp)}</span>}

          {displayText && !isError && !isStreaming && (
            <span className="opacity-0 group-hover:opacity-100 transition">
              <CopyButton text={displayText} />
            </span>
          )}
        </div>
      </div>

      {!isBot && <UserAvatar />}
    </div>
  );
}
