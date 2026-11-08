import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  AlertTriangle,
  RotateCcw,
  Loader2,
  ClipboardList,
} from "lucide-react";

import api from "../api/index.js";
import Backdrop from "../components/Backdrop";

// 五档结果各配一套颜色：越靠后越需要重视，但都不使用刺眼的纯红
const SEVERITY_STYLE = {
  minimal: {
    badge: "bg-emerald-100 text-emerald-700 border-emerald-200",
    bar: "bg-emerald-400",
  },
  mild: {
    badge: "bg-amber-100 text-amber-700 border-amber-200",
    bar: "bg-amber-400",
  },
  moderate: {
    badge: "bg-orange-100 text-orange-700 border-orange-200",
    bar: "bg-orange-400",
  },
  moderately_severe: {
    badge: "bg-rose-100 text-rose-700 border-rose-200",
    bar: "bg-rose-400",
  },
  severe: {
    badge: "bg-red-100 text-red-700 border-red-200",
    bar: "bg-red-400",
  },
};

const EMPTY_ANSWERS = Array(9).fill(null);

export default function AssessmentPage() {
  const navigate = useNavigate();

  const [paper, setPaper] = useState(null);
  const [answers, setAnswers] = useState(EMPTY_ANSWERS);
  const [result, setResult] = useState(null);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;

    api
      .get("/assessment/phq9")
      .then((res) => {
        if (alive) setPaper(res.data);
      })
      .catch(() => {
        if (alive) setError("题目加载失败，请刷新重试");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const answeredCount = answers.filter((a) => a !== null).length;
  const allAnswered = answeredCount === 9;

  const pick = (index, value) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  };

  const submit = async () => {
    if (!allAnswered || submitting) return;

    setSubmitting(true);
    setError("");

    try {
      const res = await api.post("/assessment/phq9", { answers });
      setResult(res.data);
    } catch (e) {
      setError(
        e?.response?.data?.detail || "提交失败，请稍后再试"
      );
    } finally {
      setSubmitting(false);
    }
  };

  const restart = () => {
    setResult(null);
    setAnswers(EMPTY_ANSWERS);
    setError("");
  };

  return (
    <div className="relative min-h-screen text-stone-800 overflow-hidden">
      <Backdrop />

      <div className="relative z-10 max-w-2xl mx-auto px-5 py-6 pb-16">
        {/* 顶部 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate("/chat")}
            className="flex items-center gap-1.5 text-sm text-stone-600 hover:text-amber-700 transition"
          >
            <ArrowLeft size={16} />
            回到对话
          </button>

          {!result && paper && (
            <span className="text-xs text-stone-500">
              已作答 {answeredCount} / 9
            </span>
          )}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="w-1 h-5 rounded-full bg-gradient-to-b from-amber-300 to-orange-500" />
            <h1 className="text-xl font-semibold">情绪自评</h1>
          </div>
          <p className="text-stone-500 text-xs mb-5 ml-[18px]">
            PHQ-9 · 9 道题，大约 2 分钟
          </p>
        </motion.div>

        {loading && (
          <div className="flex items-center gap-2 text-stone-500 text-sm py-10 justify-center">
            <Loader2 size={16} className="animate-spin" />
            正在准备问卷
          </div>
        )}

        {!loading && !result && paper && (
          <>
            {/* 说明 */}
            <div className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm p-5 mb-5">
              <p className="text-sm text-stone-700 leading-relaxed">
                {paper.instruction}
              </p>
              <p className="text-xs text-stone-500 mt-2.5 leading-relaxed">
                {paper.disclaimer}
              </p>
            </div>

            {/* 进度条 */}
            <div className="mb-5">
              <div className="h-1.5 rounded-full bg-stone-200/80 overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-amber-300 to-orange-400"
                  animate={{ width: `${(answeredCount / 9) * 100}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            </div>

            {/* 题目 */}
            <div className="space-y-3">
              {paper.items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: index * 0.04 }}
                  className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm p-5"
                >
                  <div className="flex gap-3 mb-3">
                    <span className="shrink-0 w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold flex items-center justify-center">
                      {item.id}
                    </span>
                    <p className="text-sm text-stone-800 leading-relaxed">
                      {item.text}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {paper.options.map((opt) => {
                      const active = answers[index] === opt.value;

                      return (
                        <button
                          key={opt.value}
                          onClick={() => pick(index, opt.value)}
                          className={`text-xs py-2.5 px-3 rounded-xl border transition text-left ${
                            active
                              ? "bg-amber-100 border-amber-300 text-amber-800 font-medium"
                              : "bg-white/70 border-stone-200 text-stone-600 hover:border-amber-200 hover:bg-amber-50/60"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ))}
            </div>

            {error && (
              <p className="text-rose-600 text-xs mt-4 text-center">{error}</p>
            )}

            {/* 提交 */}
            <div className="mt-6">
              <button
                onClick={submit}
                disabled={!allAnswered || submitting}
                className={`w-full py-3 rounded-xl font-medium text-sm transition flex items-center justify-center gap-2
                bg-gradient-to-r from-amber-400 to-orange-500 text-white shadow-sm
                hover:from-amber-500 hover:to-orange-600
                disabled:opacity-40 disabled:cursor-not-allowed`}
              >
                {submitting ? (
                  <>
                    <Loader2 size={15} className="animate-spin" />
                    正在计算
                  </>
                ) : allAnswered ? (
                  <>
                    <Check size={15} />
                    查看结果
                  </>
                ) : (
                  "还有题目没有作答"
                )}
              </button>
            </div>
          </>
        )}

        {/* 结果 */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* 分数卡 */}
              <div className="rounded-3xl bg-white/90 border border-stone-200/80 shadow-sm p-7 text-center">
                <p className="text-xs text-stone-500 tracking-widest mb-3">
                  你的总分
                </p>

                <div className="flex items-baseline justify-center gap-1">
                  <span className="text-5xl font-semibold text-stone-800">
                    {result.total}
                  </span>
                  <span className="text-stone-400 text-sm">/ 27</span>
                </div>

                <div
                  className={`inline-block mt-4 px-4 py-1.5 rounded-full border text-sm font-medium ${
                    SEVERITY_STYLE[result.severity.key]?.badge ||
                    "bg-stone-100 text-stone-600 border-stone-200"
                  }`}
                >
                  {result.severity.label}
                </div>

                <div className="h-2 rounded-full bg-stone-200/80 overflow-hidden mt-6">
                  <motion.div
                    className={`h-full rounded-full ${
                      SEVERITY_STYLE[result.severity.key]?.bar || "bg-stone-400"
                    }`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(result.total / 27) * 100}%` }}
                    transition={{ duration: 0.8, delay: 0.2 }}
                  />
                </div>

                <p className="text-sm text-stone-600 leading-relaxed mt-6 text-left">
                  {result.severity.advice}
                </p>
              </div>

              {/* 第 9 题风险提示：比总分的颜色更重 */}
              {result.risk && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.35, delay: 0.25 }}
                  className="mt-4 rounded-2xl bg-rose-50 border border-rose-200 p-5"
                >
                  <div className="flex items-start gap-2.5 mb-2">
                    <AlertTriangle size={16} className="text-rose-600 mt-0.5 shrink-0" />
                    <p className="text-sm font-medium text-rose-800">
                      这一项比分数更要紧
                    </p>
                  </div>
                  <p className="text-xs text-rose-700 leading-relaxed pl-7">
                    {result.risk_notice}
                  </p>
                </motion.div>
              )}

              {/* 免责 */}
              <p className="text-[11px] text-stone-500 leading-relaxed mt-5 px-1">
                {result.disclaimer}
              </p>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={restart}
                  className="flex-1 py-2.5 rounded-xl bg-white/80 border border-stone-200 text-stone-600 text-sm hover:border-amber-300 hover:text-amber-700 transition flex items-center justify-center gap-1.5"
                >
                  <RotateCcw size={14} />
                  再测一次
                </button>

                <button
                  onClick={() => navigate("/report")}
                  className="flex-1 py-2.5 rounded-xl bg-white/80 border border-stone-200 text-stone-600 text-sm hover:border-amber-300 hover:text-amber-700 transition flex items-center justify-center gap-1.5"
                >
                  <ClipboardList size={14} />
                  看情绪周报
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
