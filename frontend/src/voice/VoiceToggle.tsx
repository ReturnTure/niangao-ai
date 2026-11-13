/**
 * 语音播报开关按钮（独立组件，样式对齐输入框右侧的发送按钮）
 *
 * 用法：
 *   <VoiceToggle enabled={voice.enabled} speaking={voice.speaking}
 *                engine={voice.engine} onToggle={voice.toggle} />
 */

import { Volume2, VolumeX } from "lucide-react";

import type { EngineInUse } from "./VoicePlayer";

export interface VoiceToggleProps {
  enabled?: boolean;
  speaking?: boolean;
  engine?: EngineInUse;
  onToggle?: () => void;
  className?: string;
}

export default function VoiceToggle({
  enabled = false,
  speaking = false,
  engine = "unknown",
  onToggle,
  className = "",
}: VoiceToggleProps) {
  const engineLabel = engine === "browser" ? "浏览器语音" : engine === "server" ? "年糕的声音" : "语音";

  const title = enabled
    ? speaking
      ? `正在用${engineLabel}播报，点击关闭`
      : `语音播报已开启（${engineLabel}），点击关闭`
    : "开启语音播报";

  return (
    <button
      type="button"
      onClick={onToggle}
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      className={[
        "relative w-11 h-11 flex items-center justify-center rounded-xl border transition",
        enabled
          ? "bg-amber-50 border-amber-400/70 text-amber-700 hover:bg-amber-100 shadow-sm shadow-orange-200/60"
          : "bg-white/80 border-stone-300/80 text-stone-500 hover:text-amber-700 hover:border-amber-400/60",
        className,
      ].join(" ")}
    >
      {/* 正在说话时做一圈呼吸提示，让用户知道声音是从这儿来的 */}
      {enabled && speaking && (
        <span className="pointer-events-none absolute inset-0 rounded-xl border border-amber-400/70 animate-ping" />
      )}

      {enabled ? <Volume2 size={18} strokeWidth={1.8} /> : <VolumeX size={18} strokeWidth={1.8} />}
    </button>
  );
}
