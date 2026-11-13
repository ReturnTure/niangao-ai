/**
 * 语音输入 · React Hook
 *
 * 把「按住说话 → 松开识别 → 文字落到输入框」这一套包起来：
 *
 *   const mic = useVoiceInput({ apiBase: API_URL, onText: (t) => setInput(t) });
 *   <MicButton recording={mic.recording} onToggle={mic.toggle} />
 *
 * 状态含义：
 *   available   null=还在探测，false=后端没装 vosk/模型或浏览器不支持
 *   recording   正在录音（此时按钮变红、有音量反馈）
 *   transcribing 录音结束，等后端识别
 *   hint        一次性提示（「没听清，再说一次好吗？」），4 秒自动消失
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchAsrHealth, transcribeAudio } from "./asrClient";
import type { AsrError } from "./asrClient";
import { isMicSupported, MicRecorder } from "./MicRecorder";

export interface UseVoiceInputOptions {
  apiBase?: string;
  getToken?: (() => string | null) | null;
  onText?: ((text: string) => void) | null;
  /** 单人录音上限，超过自动停止，默认 60 秒 */
  maxSeconds?: number;
}

export interface UseVoiceInputApi {
  supported: boolean;
  /** null=探测中，false=不可用 */
  available: boolean | null;
  reason: string;
  recording: boolean;
  transcribing: boolean;
  seconds: number;
  level: number;
  error: string | null;
  hint: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => void;
  toggle: () => void;
}

/** 与聊天接口一致：token 存在 localStorage 里（后端 ASR 默认要求登录） */
function defaultGetToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

export function useVoiceInput({
  apiBase = "",
  getToken = defaultGetToken,
  onText = null,
  maxSeconds = 60,
}: UseVoiceInputOptions = {}): UseVoiceInputApi {
  const [supported] = useState<boolean>(() => isMicSupported());
  const [available, setAvailable] = useState<boolean | null>(() => (isMicSupported() ? null : false));
  const [reason, setReason] = useState<string>(() =>
    isMicSupported() ? "" : "这个浏览器不支持录音，换 Chrome 或 Edge 试试",
  );
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");

  const recorderRef = useRef<MicRecorder | null>(null);
  const timerRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const startAtRef = useRef(0);
  const stopRef = useRef<(() => void) | null>(null);
  const onTextRef = useRef<((text: string) => void) | null>(onText);
  const maxRef = useRef(maxSeconds);

  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  useEffect(() => {
    maxRef.current = maxSeconds;
  }, [maxSeconds]);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ---------------- 探测后端识别能力 ----------------

  useEffect(() => {
    // 浏览器连录音都不支持时，不用去打扰后端
    if (!isMicSupported()) return undefined;

    let alive = true;

    fetchAsrHealth(apiBase)
      .then((data) => {
        if (!alive) return;
        setAvailable(!!data.available);
        setReason(data.reason || "");
      })
      .catch(() => {
        if (!alive) return;
        setAvailable(false);
        setReason("连不上后端，语音输入暂时用不了");
      });

    return () => {
      alive = false;
    };
  }, [apiBase]);

  // ---------------- 停止录音并识别 ----------------

  const stop = useCallback(async (): Promise<void> => {
    const recorder = recorderRef.current;
    if (!recorder) return;

    recorderRef.current = null;
    clearTimer();

    setRecording(false);
    setLevel(0);

    const result = await recorder.stop();

    if (!result || !result.blob || (result.duration ?? 0) < 0.4) {
      setSeconds(0);
      setHint("刚才太短了，多说两句再松开好吗？");
      return;
    }

    setTranscribing(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await transcribeAudio(result.blob, {
        apiBase,
        getToken,
        signal: controller.signal,
      });

      const text = (data?.text || "").trim();

      if (!text) {
        setHint("没听清，再说一次好吗？");
      } else if (onTextRef.current) {
        onTextRef.current(text);
      }
    } catch (e) {
      const err = e as AsrError;
      if (err?.name === "AbortError") return;

      // 后端明确说不可用，就把按钮关掉，别让用户反复试
      if (err?.code === "unavailable") {
        setAvailable(false);
        setReason(err.message);
      }
      setError(err?.message || "识别失败了，再说一次试试");
    } finally {
      abortRef.current = null;
      setTranscribing(false);
      setSeconds(0);
    }
  }, [apiBase, getToken, clearTimer]);

  // ---------------- 开始录音 ----------------

  const start = useCallback(async (): Promise<void> => {
    if (recording || transcribing) return;

    if (available === false) {
      setError(reason || "语音输入暂不可用");
      return;
    }

    setError(null);
    setHint("");

    const recorder = new MicRecorder({ onLevel: setLevel });
    recorderRef.current = recorder;

    try {
      await recorder.start();
    } catch (e) {
      recorderRef.current = null;
      setLevel(0);
      setError((e as Error)?.message || "打开麦克风失败");
      return;
    }

    setRecording(true);
    setSeconds(0);
    startAtRef.current = Date.now();

    clearTimer();
    timerRef.current = window.setInterval(() => {
      const elapsed = (Date.now() - startAtRef.current) / 1000;
      setSeconds(elapsed);

      // 说太久自动停，避免一次上传几十兆
      if (elapsed >= maxRef.current) {
        stopRef.current?.();
      }
    }, 200);
  }, [available, reason, recording, transcribing, clearTimer]);

  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // ---------------- 取消 ----------------

  const cancel = useCallback((): void => {
    recorderRef.current?.cancel();
    recorderRef.current = null;

    clearTimer();

    abortRef.current?.abort();
    abortRef.current = null;

    setRecording(false);
    setTranscribing(false);
    setLevel(0);
    setSeconds(0);
  }, [clearTimer]);

  const toggle = useCallback((): void => {
    if (recording) void stop();
    else void start();
  }, [recording, start, stop]);

  // 提示 4 秒后自动消失
  useEffect(() => {
    if (!hint) return undefined;
    const timer = window.setTimeout(() => setHint(""), 4000);
    return () => clearTimeout(timer);
  }, [hint]);

  // 卸载时释放麦克风
  useEffect(() => {
    return () => {
      recorderRef.current?.cancel();
      recorderRef.current = null;
      if (timerRef.current !== null) clearInterval(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  return {
    supported,
    available,
    reason,
    recording,
    transcribing,
    seconds,
    level,
    error,
    hint,
    start,
    stop,
    cancel,
    toggle,
  };
}

export default useVoiceInput;
