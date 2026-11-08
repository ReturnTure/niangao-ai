import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { registerUser } from "../api/index.js";

export default function Register({ switchToLogin }) {
  const [data, setData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validationError = useMemo(() => {
    const email = data.email.trim();
    const password = data.password;

    if (!email || !password) return "请填写邮箱和密码";
    if (!emailRegex.test(email)) return "邮箱格式不正确";
    if (password.length < 6) return "密码至少 6 位";

    return "";
  }, [data]);

  const extractErrorMessage = (err) => {
    if (!err?.response) return "⚠️ 无法连接到服务器";

    const d = err.response.data;

    if (Array.isArray(d?.detail)) return d.detail[0]?.msg;
    if (typeof d?.detail === "string") return d.detail;
    if (typeof d?.message === "string") return d.message;

    return "注册失败";
  };

  const handleRegister = async () => {
    if (loading || validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setSuccess("");
    setLoading(true);

    try {
      await registerUser({
        email: data.email.trim(),
        password: data.password,
      });

      setSuccess("账号创建成功，正在跳转登录……");

      setTimeout(() => {
        switchToLogin();
      }, 1200);
    } catch (err) {
      console.error("REGISTER ERROR:", err);

      const msg = extractErrorMessage(err).toLowerCase();

      if (msg.includes("already") || msg.includes("exists")) {
        setError("⚠️ 该账号已存在，正在跳转登录……");
        setTimeout(() => switchToLogin(), 1200);
        return;
      }

      if (!err.response) {
        setError("⚠️ 后端未启动，请先运行 backend");
        return;
      }

      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleRegister();
    }
  };

  const isDisabled = loading || !!validationError;

  return (
    <div>
      <h2 className="text-2xl font-semibold text-stone-100 text-center mb-2">
        创建账号
      </h2>

      <p className="text-stone-400 text-sm text-center mb-6">
        从今天开始，慢慢来
      </p>

      {success && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <p className="text-emerald-400 text-xs text-center">{success}</p>
        </div>
      )}

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20">
          <p className="text-red-400 text-xs text-center">{error}</p>
        </div>
      )}

      {/* EMAIL */}
      <div className="relative mb-6">
        <label htmlFor="register-email" className="sr-only">
          邮箱
        </label>
        <input
          id="register-email"
          name="email"
          type="email"
          value={data.email}
          onChange={(e) => setData({ ...data, email: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder=" "
          className="peer w-full px-4 pt-5 pb-2 rounded-xl bg-white/5 border border-white/10 text-white
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 transition"
        />
        <span
          className="absolute left-4 top-2 text-xs text-stone-400
          peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
          peer-focus:top-2 peer-focus:text-xs peer-focus:text-amber-300"
        >
          邮箱
        </span>
      </div>

      {/* PASSWORD */}
      <div className="relative mb-3">
        <label htmlFor="register-password" className="sr-only">
          密码
        </label>
        <input
          id="register-password"
          name="password"
          type={showPassword ? "text" : "password"}
          value={data.password}
          onChange={(e) => setData({ ...data, password: e.target.value })}
          onKeyDown={onKeyDown}
          placeholder=" "
          className="peer w-full px-4 pt-5 pb-2 pr-12 rounded-xl bg-white/5 border border-white/10 text-white
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 transition"
        />
        <span
          className="absolute left-4 top-2 text-xs text-stone-400
          peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
          peer-focus:top-2 peer-focus:text-xs peer-focus:text-amber-300"
        >
          密码
        </span>

        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-3 top-3 text-stone-400 hover:text-white text-sm"
        >
          {showPassword ? "隐藏" : "显示"}
        </button>
      </div>

      <p className="text-xs text-stone-500 mb-6">密码至少 6 位</p>

      <motion.button
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={handleRegister}
        disabled={isDisabled}
        className="w-full py-3 rounded-xl font-semibold text-white
        bg-gradient-to-r from-amber-500 to-orange-500
        hover:from-amber-600 hover:to-orange-600
        shadow-lg shadow-amber-500/20
        disabled:opacity-50"
      >
        {loading ? "创建中……" : "注册"}
      </motion.button>

      <p className="text-stone-400 text-sm text-center mt-6">
        已经有账号？
        <span
          onClick={switchToLogin}
          className="text-amber-400 cursor-pointer hover:underline ml-1"
        >
          去登录
        </span>
      </p>
    </div>
  );
}
