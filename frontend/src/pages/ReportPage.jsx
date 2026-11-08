import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Minus } from "lucide-react";

import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent, MarkLineComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

import api from "../api/index.js";
import Backdrop from "../components/Backdrop";

echarts.use([LineChart, GridComponent, TooltipComponent, MarkLineComponent, CanvasRenderer]);

const LABEL_COLOR = {
  积极: "text-amber-700",
  平静: "text-stone-600",
  焦虑: "text-sky-700",
  低落: "text-slate-600",
  愤怒: "text-rose-600",
};

const BAR_COLOR = {
  积极: "bg-amber-400",
  平静: "bg-stone-400",
  焦虑: "bg-sky-400",
  低落: "bg-slate-400",
  愤怒: "bg-rose-400",
};

// 数字滚动到位，比直接蹦出结果更有"正在计算"的观感
function CountUp({ value, duration = 900 }) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (value === null || value === undefined) return;

    let raf = 0;
    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(value * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{display}</>;
}

function ScoreCard({ title, value, unit, hint, delay = 0 }) {
  const hasValue = value !== null && value !== undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.45, ease: "easeOut" }}
      whileHover={{ y: -2 }}
      className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm shadow-stone-200/50 px-4 py-4 hover:bg-white hover:border-amber-300/70 transition-colors"
    >
      <p className="text-[11px] text-stone-500 mb-1.5">{title}</p>
      <p className="text-2xl font-semibold text-stone-800">
        {hasValue ? <CountUp value={value} /> : "—"}
        {unit && hasValue && (
          <span className="text-xs font-normal text-stone-400 ml-1">{unit}</span>
        )}
      </p>
      {hint && <p className="text-[11px] text-stone-500 mt-1">{hint}</p>}
    </motion.div>
  );
}

export default function ReportPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const chartRef = useRef(null);
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    setError("");
    api
      .get("/report/weekly?days=7")
      .then((res) => setData(res.data))
      .catch(() => setError("周报加载失败，请稍后重试"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  // ---------------- 折线图 ---------------- //
  useEffect(() => {
    if (!data || !chartRef.current) return;

    const chart = echarts.init(chartRef.current, null, { renderer: "canvas" });

    const scores = data.timeline.map((d) => d.score);
    const dates = data.timeline.map((d) => d.date.slice(5));
    const counts = data.timeline.map((d) => d.count);

    chart.setOption({
      backgroundColor: "transparent",
      grid: { left: 8, right: 16, top: 24, bottom: 24, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(255,253,247,0.97)",
        borderColor: "rgba(168,162,158,0.35)",
        textStyle: { color: "#57534e", fontSize: 12 },
        formatter: (params) => {
          const i = params[0].dataIndex;
          const s = scores[i];
          if (s === null) return `${data.timeline[i].date}<br/>这天没有对话`;
          return `${data.timeline[i].date}<br/>情绪分 ${s} · ${counts[i]} 次对话`;
        },
      },
      xAxis: {
        type: "category",
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: "rgba(120,113,108,0.22)" } },
        axisTick: { show: false },
        axisLabel: { color: "#78716c", fontSize: 11 },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        interval: 25,
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(120,113,108,0.12)" } },
        axisLabel: { color: "#a8a29e", fontSize: 11 },
      },
      series: [
        {
          type: "line",
          data: scores,
          smooth: true,
          connectNulls: true,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: { width: 2.5, color: "#f59e0b" },
          itemStyle: { color: "#f59e0b", borderColor: "#fcd34d", borderWidth: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(245,158,11,0.32)" },
              { offset: 1, color: "rgba(245,158,11,0.04)" },
            ]),
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: "rgba(120,113,108,0.45)", type: "dashed", width: 1 },
            label: {
              formatter: "平静线",
              color: "#78716c",
              fontSize: 10,
              position: "insideEndTop",
            },
            data: [{ yAxis: 50 }],
          },
        },
      ],
    });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [data]);

  const summary = data?.summary;
  const total = summary?.total_turns ?? 0;

  const TrendIcon =
    summary?.trend === "up" ? TrendingUp : summary?.trend === "down" ? TrendingDown : Minus;
  const trendColor =
    summary?.trend === "up"
      ? "text-amber-700"
      : summary?.trend === "down"
      ? "text-rose-300"
      : "text-stone-400";

  return (
    <div className="relative min-h-screen text-stone-800 overflow-hidden">
      <Backdrop />

      <div className="relative z-10 max-w-3xl mx-auto px-5 py-6 pb-14">
        {/* 顶部 */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate("/chat")}
            className="flex items-center gap-1.5 text-sm text-stone-600 hover:text-amber-700 transition"
          >
            <ArrowLeft size={16} />
            回到对话
          </button>

          <button
            onClick={load}
            className="p-2 rounded-lg text-stone-400 hover:text-amber-700 hover:bg-white/60 transition"
            aria-label="刷新"
          >
            <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <div className="flex items-center gap-2.5 mb-1.5">
            <span className="w-1 h-5 rounded-full bg-gradient-to-b from-amber-300 to-orange-500" />
            <h1 className="text-xl font-semibold">情绪周报</h1>
          </div>
          <p className="text-xs text-stone-500 mb-6 pl-3.5">
            最近 7 天 · 数据来自你和年糕的对话
          </p>

          {loading && <p className="text-sm text-stone-500">正在生成周报…</p>}

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-300/70 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          )}

          {!loading && !error && data && (
            <>
              {/* 指标卡 */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                <ScoreCard
                  title="平均情绪分"
                  value={summary.avg_score}
                  unit="分"
                  hint="50 为平静线"
                  delay={0.05}
                />
                <ScoreCard title="对话次数" value={total} unit="次" hint="7 天内" delay={0.12} />
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.19, duration: 0.45, ease: "easeOut" }}
                  whileHover={{ y: -2 }}
                  className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm shadow-stone-200/50 px-4 py-4 hover:bg-white hover:border-amber-300/70 transition-colors"
                >
                  <p className="text-[11px] text-stone-500 mb-1.5">主要情绪</p>
                  <p
                    className={`text-2xl font-semibold ${
                      summary.dominant ? LABEL_COLOR[summary.dominant] : "text-stone-800"
                    }`}
                  >
                    {summary.dominant ?? "—"}
                  </p>
                  <p className={`text-[11px] mt-1 flex items-center gap-1 ${trendColor}`}>
                    <TrendIcon size={12} />
                    {summary.trend_text}
                  </p>
                </motion.div>
              </div>

              {/* 曲线 */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.26, duration: 0.5, ease: "easeOut" }}
                className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm shadow-stone-200/50 p-4 mb-5"
              >
                <p className="text-xs text-stone-500 mb-2 px-1">情绪走势</p>
                <div ref={chartRef} style={{ width: "100%", height: 280 }} />
              </motion.div>

              {/* 分布 */}
              {data.distribution.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.34, duration: 0.5, ease: "easeOut" }}
                  className="rounded-2xl bg-white/85 border border-stone-200/80 shadow-sm shadow-stone-200/50 p-4 mb-5"
                >
                  <p className="text-xs text-stone-500 mb-3 px-1">情绪分布</p>
                  <div className="space-y-2.5">
                    {data.distribution.map((item, i) => {
                      const percent = Math.round((item.count / total) * 100);
                      return (
                        <div key={item.label} className="flex items-center gap-3">
                          <span className="text-xs w-10 shrink-0 text-stone-600">
                            {item.label}
                          </span>
                          <div className="flex-1 h-1.5 rounded-full bg-stone-200 overflow-hidden">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${percent}%` }}
                              transition={{
                                delay: 0.45 + i * 0.08,
                                duration: 0.6,
                                ease: "easeOut",
                              }}
                              className={`h-full rounded-full ${
                                BAR_COLOR[item.label] ?? "bg-stone-500"
                              }`}
                            />
                          </div>
                          <span className="text-[11px] text-stone-500 w-8 text-right shrink-0">
                            {item.count} 次
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}

              {/* 小结 */}
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.42, duration: 0.5, ease: "easeOut" }}
                className="relative rounded-2xl bg-amber-50/95 border border-amber-300/70 shadow-sm shadow-amber-200/50 p-4 mb-5 overflow-hidden"
              >
                {/* 左上角一层柔光，让这块"结论"有人味儿一点 */}
                <div className="absolute -top-12 -left-12 w-32 h-32 rounded-full bg-amber-300/30 blur-2xl" />
                <p className="relative text-xs text-amber-700 mb-2">年糕的观察</p>
                <p className="relative text-sm leading-relaxed text-stone-700">
                  {data.insight}
                </p>
              </motion.div>

              {/* 空态引导 */}
              {total === 0 && (
                <button
                  onClick={() => navigate("/chat")}
                  className="w-full py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 text-sm font-medium text-white"
                >
                  去和年糕聊聊
                </button>
              )}
            </>
          )}

          <p className="text-[11px] text-stone-400 leading-relaxed mt-6">
            情绪分由关键词统计得出，用于观察自己的状态起伏，不构成任何心理诊断或医疗建议。
            <br />
            如果你正经历持续的困扰，请联系专业心理工作者，或拨打希望 24 热线 400-161-9995。
          </p>
        </motion.div>
      </div>
    </div>
  );
}
