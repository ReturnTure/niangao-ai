import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import StickerArt from "./art";
import { stickerMeta, type StickerId } from "./catalog";

export interface StickerBubbleProps {
  id: StickerId;
}

/**
 * 一条"表情消息"
 *
 * 和文字气泡刻意做得不一样：
 * - 没有底色、没有边框，图直接浮在页面上（表情包本身是一张图，不该再套个框）
 * - 出现时有一个轻微的回弹 + 倾斜纠正，像真的被"贴"上来
 * - 点一下能放大看，Esc 关闭 —— 小尺寸下有些细节看不见，用户会想凑近看
 *
 * 左侧留出 pl-10，和机器人头像的位置对齐，视觉上仍属于"年糕这一侧"。
 */
export default function StickerBubble({ id }: StickerBubbleProps) {
  const meta = stickerMeta(id);
  const [zoom, setZoom] = useState(false);

  // 放大时按 Esc 关闭，避免只能点遮罩
  useEffect(() => {
    if (!zoom) return;

    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setZoom(false);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  return (
    <>
      <motion.div
        initial={{ opacity: 0, scale: 0.35, rotate: -12, y: 10 }}
        animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 21 }}
        className="flex justify-start pl-10 mb-3"
      >
        <button
          type="button"
          onClick={() => setZoom(true)}
          aria-label={`年糕发来一张表情：${meta.title}。${meta.caption}`}
          title={meta.caption}
          className="group relative rounded-2xl p-1 transition-colors hover:bg-amber-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70"
        >
          <motion.div
            whileHover={{ scale: 1.06, rotate: -2 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: "spring", stiffness: 400, damping: 18 }}
          >
            <StickerArt id={id} size={104} />
          </motion.div>

          <span
            className="pointer-events-none absolute -bottom-1 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-stone-800/80 px-2 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          >
            {meta.title}
          </span>
        </button>
      </motion.div>

      {/* 放大预览 */}
      <AnimatePresence>
        {zoom && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-stone-900/45 backdrop-blur-sm px-6"
            onClick={() => setZoom(false)}
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 24 }}
              className="rounded-3xl bg-white/95 p-4 shadow-xl shadow-stone-900/20"
            >
              <StickerArt id={id} size={240} />
            </motion.div>
            <p className="text-xs text-white/90">{meta.caption}</p>
            <p className="text-[10px] text-white/50">点击任意处或按 Esc 关闭</p>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
