import { motion } from "framer-motion";

/**
 * 全局背景层。
 *
 * 深色底 + 几团缓慢呼吸的暖光斑 + 细网格。
 * 纯装饰，不接收指针事件，也不会遮挡任何内容。
 */
export default function Backdrop({ variant = "chat" }) {
  const isReport = variant === "report";

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* 左上暖光 */}
      <div
        className="absolute -top-48 -left-40 w-[34rem] h-[34rem] rounded-full blur-[90px] animate-breathe"
        style={{ background: "radial-gradient(circle, rgba(251,191,36,0.30), transparent 68%)" }}
      />

      {/* 右侧橙光，比左侧慢一点，避免整屏像在同时闪 */}
      <div
        className="absolute top-1/4 -right-40 w-[30rem] h-[30rem] rounded-full blur-[100px] animate-float-slow"
        style={{ background: "radial-gradient(circle, rgba(249,115,22,0.24), transparent 68%)" }}
      />

      {/* 左下一点冷色，和暖色拉开层次 */}
      <div
        className="absolute -bottom-44 -left-24 w-[30rem] h-[24rem] rounded-full blur-[110px]"
        style={{ background: "radial-gradient(circle, rgba(45,212,191,0.12), transparent 70%)" }}
      />

      {/* 底部一抹微光，压住大片黑色 */}
      <div
        className="absolute -bottom-40 left-1/3 w-[36rem] h-[26rem] rounded-full blur-[120px]"
        style={{ background: "radial-gradient(circle, rgba(217,119,6,0.18), transparent 72%)" }}
      />

      {/* 网格纹理 */}
      <div className={`absolute inset-0 bg-grid ${isReport ? "opacity-60" : "opacity-50"}`} />

      {/* 顶部渐隐，让内容从上方自然浮出 */}
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-stone-950 to-transparent" />

      {/* 浮尘：几个小光点，缓慢漂移 */}
      {[
        { left: "18%", top: "22%", size: 4, delay: "0s", duration: "20s" },
        { left: "62%", top: "16%", size: 3, delay: "3s", duration: "26s" },
        { left: "78%", top: "58%", size: 5, delay: "6s", duration: "24s" },
        { left: "34%", top: "72%", size: 3, delay: "9s", duration: "22s" },
      ].map((dot, i) => (
        <motion.span
          key={i}
          className="absolute rounded-full bg-amber-200/25"
          style={{
            left: dot.left,
            top: dot.top,
            width: dot.size,
            height: dot.size,
          }}
          animate={{ y: [0, -22, 0], opacity: [0.15, 0.5, 0.15] }}
          transition={{
            duration: parseFloat(dot.duration),
            delay: parseFloat(dot.delay),
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      ))}
    </div>
  );
}
