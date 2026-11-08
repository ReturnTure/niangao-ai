import { useState, useMemo, useCallback, useEffect } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import api from "../api/index.js";

export default function Login({ setToken, switchToRegister }) {
  const [data, setData] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const navigate = useNavigate();

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const validationError = useMemo(() => {
    const email = data.email.trim();
    const password = data.password;

    if (!email || !password) return "请填写邮箱和密码";
    if (!emailRegex.test(email)) return "邮箱格式不正确";

    return "";
  }, [data]);

  const extractErrorMessage = (err) => {
    if (!err?.response) return "⚠️ 无法连接到服务器";

    const status = err.response.status;
    const d = err.response.data;

    const raw =
      typeof d?.detail === "string"
        ? d.detail
        : Array.isArray(d?.detail)
          ? d.detail[0]?.msg
          : d?.message;

    const msg = (raw || "").toLowerCase();

    if (
      status === 401 ||
      msg.includes("incorrect") ||
      msg.includes("invalid") ||
      msg.includes("credentials")
    ) {
      return "⚠️ 邮箱或密码不正确";
    }

    return raw || "登录失败";
  };

  const handleLogin = useCallback(async () => {
    if (loading || validationError) {
      setError(validationError);
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await api.post("/auth/login", {
        email: data.email.trim(),
        password: data.password,
      });

      const accessToken = res.data?.access_token;
      const refreshToken = res.data?.refresh_token;

      if (!accessToken || !refreshToken) {
        throw new Error("未收到登录凭证");
      }

      localStorage.setItem("token", accessToken);
      localStorage.setItem("refresh_token", refreshToken);

      setToken(accessToken);

      navigate("/chat", { replace: true });
    } catch (err) {
      console.error("LOGIN ERROR:", err);
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [data, loading, validationError, navigate, setToken]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleLogin();
    }
  };

  const handleChange = (field, value) => {
    setData((prev) => ({ ...prev, [field]: value }));
    if (error) setError("");
  };

  const isDisabled = loading || !!validationError;

  useEffect(() => {
    setError("");
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-semibold text-stone-800 text-center mb-2">
        欢迎回来
      </h2>

      <p className="text-stone-500 text-sm text-center mb-6">
        年糕在这儿等你
      </p>

      {error && (
        <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 border border-red-300/80">
          <p className="text-red-600 text-xs text-center">{error}</p>
        </div>
      )}

      {/* EMAIL */}
      <div className="relative mb-6">
        <label htmlFor="login-email" className="sr-only">
          邮箱
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          value={data.email}
          onChange={(e) => handleChange("email", e.target.value)}
          onKeyDown={onKeyDown}
          placeholder=" "
          autoComplete="email"
          className={`peer w-full px-4 pt-5 pb-2 rounded-xl bg-white/90 border text-stone-800
          ${error ? "border-red-500" : "border-stone-300/80"}
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 transition`}
        />
        <span
          className="absolute left-4 top-2 text-xs text-stone-500
          peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
          peer-focus:top-2 peer-focus:text-xs peer-focus:text-amber-700"
        >
          邮箱
        </span>
      </div>

      {/* PASSWORD */}
      <div className="relative mb-6">
        <label htmlFor="login-password" className="sr-only">
          密码
        </label>
        <input
          id="login-password"
          name="password"
          type={showPassword ? "text" : "password"}
          value={data.password}
          onChange={(e) => handleChange("password", e.target.value)}
          onKeyDown={onKeyDown}
          placeholder=" "
          autoComplete="current-password"
          className={`peer w-full px-4 pt-5 pb-2 pr-12 rounded-xl bg-white/90 border text-stone-800
          ${error ? "border-red-500" : "border-stone-300/80"}
          focus:outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-400/30 transition`}
        />
        <span
          className="absolute left-4 top-2 text-xs text-stone-500
          peer-placeholder-shown:top-4 peer-placeholder-shown:text-sm
          peer-focus:top-2 peer-focus:text-xs peer-focus:text-amber-700"
        >
          密码
        </span>

        <button
          type="button"
          onClick={() => setShowPassword((s) => !s)}
          className="absolute right-3 top-3 text-stone-500 hover:text-stone-800 text-sm"
        >
          {showPassword ? "隐藏" : "显示"}
        </button>
      </div>

      <motion.button
        whileTap={{ scale: 0.96 }}
        whileHover={{ scale: 1.02 }}
        onClick={handleLogin}
        disabled={isDisabled}
        className="w-full py-3 rounded-xl font-semibold text-white
        bg-gradient-to-r from-amber-500 to-orange-500
        hover:from-amber-600 hover:to-orange-600
        shadow-lg shadow-amber-500/20
        disabled:opacity-50"
      >
        {loading ? "登录中……" : "登录"}
      </motion.button>

      <p className="text-stone-500 text-sm text-center mt-6">
        还没有账号？
        <span
          onClick={switchToRegister}
          className="text-amber-700 cursor-pointer hover:underline ml-1"
        >
          去注册
        </span>
      </p>
    </div>
  );
}
