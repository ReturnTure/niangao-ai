import { motion } from "framer-motion";
import bgUrl from "../assets/bg-niangao.png";

/**
 * 全局背景层。
 *
 * 铺一张水彩插画（奶油底 + 绿植 + 坐在草地上的小年糕），
 * 上面盖一层很淡的暖白蒙版，把画面压柔，保证前面的文字看得清。
 * 纯装饰，不接收指针事件，也不会遮挡任何内容。
 */
export default function Backdrop() {
  return (
    <div
      className="pointer-events-none absolute inset-0 overflow-hidden"
      aria-hidden="true"
    >
      {/* 插画背景 */}
      <div
        className="absolute inset-0 bg-cover bg-[center_42%]"
        style={{ backgroundImage: `url(${bgUrl})` }}
      />

      {/* 柔化蒙版 */}
      <div className="absolute inset-0 bg-[#fffdf6]/20" />

      {/* 上下两端再收一收，让内容从画面里浮出来 */}
      <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#fffdf6]/55 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#fffdf6]/55 to-transparent" />

      {/* 极缓的暖光呼吸，给静态插画加一点活着的感觉 */}
      <motion.div
        className="absolute -top-32 left-1/4 w-[32rem] h-[32rem] rounded-full blur-[100px]"
        style={{
          background: "radial-gradient(circle, rgba(253,230,138,0.35), transparent 70%)",
        }}
        animate={{ scale: [1, 1.15, 1], opacity: [0.45, 0.8, 0.45] }}
        transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}
