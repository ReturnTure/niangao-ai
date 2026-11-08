import { motion } from "framer-motion";

export default function TypingIndicator() {
  return (
    <div className="flex items-start gap-3" role="status" aria-live="polite">
      {/* Avatar */}
      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center text-xs font-bold text-stone-900 shadow-md">
        年
      </div>

      {/* Bubble */}
      <div className="bg-white/10 backdrop-blur-xl border border-white/10 px-4 py-2 rounded-2xl shadow-lg flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="w-2 h-2 bg-stone-300 rounded-full"
            animate={{ y: [0, -6, 0], opacity: [0.4, 1, 0.4] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.2,
            }}
          />
        ))}
      </div>
    </div>
  );
}
