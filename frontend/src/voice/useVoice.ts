/**
 * 语音播报 · React Hook
 *
 * 把 VoicePlayer 包成一个 hook：组件里拿 enabled / toggle / feed 就够了，
 * 不用管引擎选择、队列、打断这些细节。
 *
 *   const voice = useVoice({ apiBase: API_URL });
 *
 *   voice.toggle()                 // 开关
 *   voice.feed(delta)              // 流式段就调一次
 *   voice.flush()                  // 一条回复结束
 *   voice.stop()                   // 打断
 *   voice.speak("要念的文字")       // 整段播报 / 重播
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_PRESET, DEFAULT_VOICE, VoicePlayer } from "./VoicePlayer";
import type { EngineInUse, VoiceState } from "./VoicePlayer";

const LS_ENABLED = "niangao_voice_enabled";
const LS_VOICE = "niangao_voice_id";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下会抛异常，忽略即可 */
  }
}

export interface UseVoiceOptions {
  apiBase?: string;
  getToken?: (() => string | null) | null;
  voice?: string;
  preset?: string;
  /** 传 null 表示读本地记忆的开关状态 */
  enabled?: boolean | null;
}

export interface UseVoiceApi {
  enabled: boolean;
  speaking: boolean;
  engine: EngineInUse;
  error: string | null;
  voice: string;
  enable: () => void;
  disable: () => void;
  toggle: () => void;
  feed: (delta: string) => void;
  flush: () => Promise<void>;
  speak: (text: string) => Promise<void>;
  stop: () => void;
  setVoice: (next: string | null | undefined) => void;
}

export function useVoice({
  apiBase = "",
  getToken = null,
  voice: initialVoice = DEFAULT_VOICE,
  preset = DEFAULT_PRESET,
  enabled: initialEnabled = null,
}: UseVoiceOptions = {}): UseVoiceApi {
  // 默认记住上次的选择：不喜欢开语音的人不用每进一次就关一次
  const [enabled, setEnabledState] = useState<boolean>(() => {
    if (initialEnabled !== null) return initialEnabled;
    return readStorage(LS_ENABLED) === "1";
  });
  const [voice, setVoiceState] = useState<string>(() => readStorage(LS_VOICE) || initialVoice);
  const [speaking, setSpeaking] = useState(false);
  const [engine, setEngine] = useState<EngineInUse>("unknown");
  const [error, setError] = useState<string | null>(null);

  const playerRef = useRef<VoicePlayer | null>(null);
  const enabledRef = useRef<boolean>(enabled);
  const voiceRef = useRef<string>(voice);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    voiceRef.current = voice;
  }, [voice]);

  // ---------------- 播放器 ----------------

  const ensurePlayer = useCallback((): VoicePlayer => {
    if (playerRef.current) return playerRef.current;

    const player = new VoicePlayer({
      apiBase,
      getToken,
      voice: voiceRef.current,
      preset,
      onState: (state: VoiceState) => {
        setSpeaking(!!state.speaking);
        if (state.engine && state.engine !== "unknown") setEngine(state.engine);
        setError(state.error || null);
      },
    });

    playerRef.current = player;
    return player;
  }, [apiBase, getToken, preset]);

  useEffect(() => {
    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [apiBase]);

  // ---------------- 开关 ----------------

  const enable = useCallback((): void => {
    setEnabledState(true);
    enabledRef.current = true;
    writeStorage(LS_ENABLED, "1");
    // 必须在用户点击（手势）之后才会被浏览器允许出声
    ensurePlayer()
      .probe()
      .then((used) => setEngine(used))
      .catch(() => {});
  }, [ensurePlayer]);

  const disable = useCallback((): void => {
    setEnabledState(false);
    enabledRef.current = false;
    writeStorage(LS_ENABLED, "0");
    playerRef.current?.stop();
  }, []);

  const toggle = useCallback((): void => {
    if (enabledRef.current) disable();
    else enable();
  }, [enable, disable]);

  // ---------------- 播报 ----------------

  const feed = useCallback(
    (delta: string): void => {
      if (!enabledRef.current || !delta) return;
      ensurePlayer().feed(delta);
    },
    [ensurePlayer],
  );

  const flush = useCallback((): Promise<void> => {
    if (!enabledRef.current || !playerRef.current) return Promise.resolve();
    return playerRef.current.flush();
  }, []);

  const speak = useCallback(
    (text: string): Promise<void> => {
      if (!enabledRef.current || !text) return Promise.resolve();
      return ensurePlayer().speak(text);
    },
    [ensurePlayer],
  );

  const stop = useCallback((): void => {
    playerRef.current?.stop();
  }, []);

  const setVoice = useCallback((next: string | null | undefined): void => {
    if (!next) return;
    setVoiceState(next);
    writeStorage(LS_VOICE, next);
    playerRef.current?.setVoice(next);
  }, []);

  return {
    enabled,
    speaking,
    engine,
    error,
    voice,
    enable,
    disable,
    toggle,
    feed,
    flush,
    speak,
    stop,
    setVoice,
  };
}

export default useVoice;
