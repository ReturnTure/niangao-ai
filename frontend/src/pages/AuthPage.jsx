import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSearchParams, useNavigate } from "react-router-dom";
import Login from "./Login";
import Backdrop from "../components/Backdrop";
import Register from "./Register";

export default function AuthPage({ setToken }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const getModeFromURL = () => {
    const m = searchParams.get("mode");
    return m === "register" ? "register" : "login";
  };

  const [mode, setMode] = useState(getModeFromURL);

  useEffect(() => {
    const current = new URLSearchParams(window.location.search).get("mode");

    if (current !== mode) {
      setSearchParams({ mode }, { replace: true });
    }
  }, [mode, setSearchParams]);

  useEffect(() => {
    const urlMode = getModeFromURL();
    if (urlMode !== mode) {
      setMode(urlMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (token) {
      navigate("/chat", { replace: true });
    }
  }, [navigate]);

  const switchMode = (nextMode) => {
    if (nextMode !== mode) {
      setMode(nextMode);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center overflow-hidden px-4">
      <Backdrop />

      <div className="relative z-10 w-full max-w-[420px]">
        {/* 品牌区 */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-8"
        >
          <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center shadow-lg shadow-amber-500/20 mb-4">
            <span className="text-stone-900 font-bold text-xl">年</span>
          </div>
          <h1 className="text-2xl font-semibold text-stone-800 tracking-wide">
            年糕
          </h1>
          <p className="text-stone-500 text-xs mt-2 tracking-widest">
            一 个 愿 意 慢 慢 听 你 说 话 的 AI 伙 伴
          </p>
        </motion.div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="relative z-10 w-full p-8 rounded-2xl bg-white/80 backdrop-blur-xl border border-stone-200/80 shadow-[0_10px_40px_rgba(120,113,108,0.18)]"
        >
          {/* Tabs */}
          <div className="flex mb-6 border-b border-stone-200/80">
            <button
              onClick={() => switchMode("login")}
              className={`flex-1 py-2 text-sm font-medium transition ${
                mode === "login"
                  ? "text-amber-700 border-b-2 border-amber-400"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              登录
            </button>

            <button
              onClick={() => switchMode("register")}
              className={`flex-1 py-2 text-sm font-medium transition ${
                mode === "register"
                  ? "text-amber-700 border-b-2 border-amber-400"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              注册
            </button>
          </div>

          {/* Forms */}
          <AnimatePresence mode="wait">
            {mode === "login" ? (
              <motion.div
                key="login"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 30 }}
              >
                <Login
                  setToken={setToken}
                  switchToRegister={() => switchMode("register")}
                />
              </motion.div>
            ) : (
              <motion.div
                key="register"
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
              >
                <Register switchToLogin={() => switchMode("login")} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <p className="text-center text-[11px] text-stone-500 mt-6 leading-relaxed">
          年糕是 AI 心理陪伴工具，不提供诊断与治疗
          <br />
          如有紧急情况请拨打 400-161-9995 或 110
        </p>
      </div>
    </div>
  );
}
