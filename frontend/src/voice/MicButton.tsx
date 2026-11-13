/**
 * 语音输入 · 麦克风按钮（独立组件）
 *
 *   <MicButton
 *     recording={mic.recording}
 *     transcribing={mic.transcribing}
 *     level={mic.level}
 *     seconds={mic.seconds}
 *     available={mic.available}
 *     reason={mic.reason}
 *     onToggle={mic.toggle}
 *   />
 *
 * 点一下开始录，再点一下停止并识别（不用按住，手机和电脑都顺手）。
 */

import { Loader2, Mic, MicOff } from "lucide-react";

export interface MicButtonProps {
  recording?: boolean;
  transcribing?: boolean;
  /** 0~1，录音音量，用来画呼吸圈 */
  level?: number;
  seconds?: number;
  /** null 表示还在探测后端能力，此时按钮可点 */
  available?: boolean | null;
  reason?: string;
  onToggle?: () => void;
  className?: string;
}

export default function MicButton({
  recording = false,
  transcribing = false,
  level = 0,
  seconds = 0,
  available = true,
  reason = "",
  onToggle,
  className = "",
}: MicButtonProps) {
  const disabled = transcribing || available === false;

  const title = transcribing
    ? "正在识别…"
    : available === false
      ? reason || "语音输入不可用"
      : recording
        ? `正在听你说话 ${seconds.toFixed(1)}s，点一下结束`
        : "点一下说话（离线识别，音频不出本机）";

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={recording}
      className={[
        "relative w-11 h-11 flex items-center justify-center rounded-xl border transition shrink-0",
        recording
          ? "bg-red-500 border-red-500 text-white shadow-md shadow-red-300/60"
          : available === false
            ? "bg-stone-100 border-stone-200 text-stone-300 cursor-not-allowed"
            : "bg-white/80 border-stone-300/80 text-stone-500 hover:text-amber-700 hover:border-amber-400/60",
        transcribing ? "opacity-70 cursor-wait" : "",
        className,
      ].join(" ")}
    >
      {/* 录音时的音量呼吸圈：说得大声一点，圈就大一点，用户就知道麦克风真的在收 */}
      {recording && (
        <span
          className="pointer-events-none absolute inset-0 rounded-xl border-2 border-red-400/70"
          style={{
            transform: `scale(${1 + Math.min(0.35, level * 0.35)})`,
            opacity: 0.35 + Math.min(0.5, level),
            transition: "transform 120ms ease-out, opacity 120ms ease-out",
          }}
        />
      )}

      {transcribing ? (
        <Loader2 size={18} strokeWidth={1.8} className="animate-spin" />
      ) : available === false ? (
        <MicOff size={18} strokeWidth={1.8} />
      ) : (
        <Mic size={18} strokeWidth={1.8} />
      )}

      {/* 录音时长，超过 10 秒才显示，避免刚开始就闪数字 */}
      {recording && seconds >= 10 && (
        <span className="pointer-events-none absolute -top-1.5 -right-1.5 px-1 rounded-md bg-red-600 text-[10px] leading-4 text-white tabular-nums">
          {Math.floor(seconds)}s
        </span>
      )}
    </button>
  );
}
