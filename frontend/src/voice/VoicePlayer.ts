/**
 * 语音播报 · 播放器（独立模块）
 *
 * 两种引擎，自动选择：
 *   server  —— 后端 edge-tts 合成 mp3（音色接近真人，推荐）
 *   browser —— 浏览器内置 Web Speech API（零依赖，没网/没装 edge-tts 时兜底）
 *
 * 核心能力：
 * 1. 边生成边播：流式 delta 喂进来，凑满一句就合成、就播，不用等全文
 * 2. 预取：正在播第 N 句时，第 N+1 句已经在合成，句间几乎无停顿
 * 3. 打断：用户发新消息 / 关掉开关时立即静音，不会串音
 * 4. 无感降级：服务端 503 或网络断了，自动换浏览器语音继续说
 *
 * 这个文件不依赖 React，也不引用项目里任何其它模块，可以单独用。
 */

import { cleanForSpeech, createSentenceChunker, splitSentences } from "./textChunker";
import type { SentenceChunker } from "./textChunker";

export const DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural";
export const DEFAULT_PRESET = "warm";

/** 配置项：auto 自动探测后端，server 只用后端，browser 只用浏览器 */
export type EnginePreference = "auto" | "server" | "browser";

/** 实际在用的引擎，unknown 表示还没探测出来 */
export type EngineInUse = "server" | "browser" | "unknown";

/** 播放器对外暴露的状态快照 */
export interface VoiceState {
  speaking: boolean;
  engine: EngineInUse;
  error: string | null;
  /** 队列里还剩几句没念 */
  pending: number;
}

export interface VoicePlayerOptions {
  /** 后端地址，如 http://127.0.0.1:8000 */
  apiBase?: string;
  /** 返回 JWT 的函数（后端开启 VOICE_REQUIRE_AUTH 时需要） */
  getToken?: (() => string | null) | null;
  engine?: EnginePreference;
  /** 音色 id，见 /voice/voices */
  voice?: string;
  /** warm | calm | slow | cheerful */
  preset?: string;
  /** 浏览器引擎的语速（0.5 ~ 2） */
  rate?: number;
  onState?: ((state: VoiceState) => void) | null;
}

/** 预取中的那一句音频 */
interface PrefetchEntry {
  text: string;
  promise: Promise<Blob>;
}

// ---------------- 浏览器语音辅助 ---------------- #

let _voices: SpeechSynthesisVoice[] = [];

function loadBrowserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !window.speechSynthesis) return [];
  const list = window.speechSynthesis.getVoices() || [];
  if (list.length) _voices = list;
  return _voices;
}

if (typeof window !== "undefined" && window.speechSynthesis) {
  loadBrowserVoices();
  try {
    window.speechSynthesis.addEventListener("voiceschanged", loadBrowserVoices);
  } catch {
    /* 老浏览器不支持 addEventListener，忽略 */
  }
}

/** 浏览器是否支持本地语音合成 */
export function isBrowserSpeechSupported(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis && typeof SpeechSynthesisUtterance !== "undefined";
}

export function listBrowserVoices(): SpeechSynthesisVoice[] {
  return loadBrowserVoices();
}

// 优先挑中文女声，语气更贴年糕
const VOICE_PREFERENCE: readonly string[] = [
  "xiaoxiao", "晓晓",
  "xiaoyi", "晓伊",
  "huihui", "慧慧",
  "yaoyao", "瑶瑶",
  "tingting", "婷婷",
  "google 普通话",
  "chinese",
];

function pickBrowserVoice(): SpeechSynthesisVoice | null {
  const voices = loadBrowserVoices();
  if (!voices.length) return null;

  const zh = voices.filter((v) => /^zh\b|^zh[-_]/i.test(v.lang || "") || /chinese|普通话|中文/i.test(v.name || ""));
  const pool = zh.length ? zh : voices;

  for (const key of VOICE_PREFERENCE) {
    const hit = pool.find((v) => (v.name || "").toLowerCase().includes(key));
    if (hit) return hit;
  }

  return pool[0] || null;
}

// ---------------- 播放器 ---------------- #

export class VoicePlayer {
  apiBase: string;
  getToken: () => string | null;
  enginePref: EnginePreference;
  voice: string;
  preset: string;
  rate: number;
  onState: ((state: VoiceState) => void) | null;

  chunker: SentenceChunker;
  queue: string[];

  /** 每次打断 +1，用来丢弃过期的异步结果 */
  session: number;
  /** 当前播放循环的编号，0 表示空闲 */
  loopId: number;
  loopSeq: number;
  speaking: boolean;

  /** null = 还没探测 */
  serverAvailable: boolean | null;
  engineInUse: EngineInUse;
  error: string | null;

  private _probePromise: Promise<"server" | "browser"> | null;
  private _prefetch: PrefetchEntry | null;
  private _audio: HTMLAudioElement | null;
  private _audioUrl: string | null;
  private _resolvePlay: ((ok: boolean) => void) | null;
  private _resolveSpeak: ((ok: boolean) => void) | null;
  private _idleWaiters: Array<() => void>;

  constructor({
    apiBase = "",
    getToken = null,
    engine = "auto",
    voice = DEFAULT_VOICE,
    preset = DEFAULT_PRESET,
    rate = 1,
    onState = null,
  }: VoicePlayerOptions = {}) {
    this.apiBase = String(apiBase || "").replace(/\/+$/, "");
    this.getToken =
      getToken ||
      (() => {
        try {
          return localStorage.getItem("token");
        } catch {
          return null;
        }
      });

    this.enginePref = engine;
    this.voice = voice;
    this.preset = preset;
    this.rate = rate;
    this.onState = onState;

    this.chunker = createSentenceChunker();
    this.queue = [];

    this.session = 0;
    this.loopId = 0;
    this.loopSeq = 0;
    this.speaking = false;

    this.serverAvailable = null;
    this.engineInUse = engine === "browser" ? "browser" : "unknown";
    this.error = null;

    this._probePromise = null;
    this._prefetch = null;
    this._audio = null;
    this._audioUrl = null;
    this._resolvePlay = null;
    this._resolveSpeak = null;
    this._idleWaiters = [];
  }

  // ---------------- 配置 ----------------

  setVoice(voice: string | null | undefined): void {
    if (!voice || voice === this.voice) return;
    this.voice = voice;
    this._prefetch = null; // 音色变了，预取作废
  }

  setPreset(preset: string | null | undefined): void {
    if (!preset || preset === this.preset) return;
    this.preset = preset;
    this._prefetch = null;
  }

  setRate(rate: number): void {
    const v = Number(rate);
    if (Number.isFinite(v) && v > 0.4 && v < 2.5) this.rate = v;
  }

  getState(): VoiceState {
    return {
      speaking: this.speaking,
      engine: this.engineInUse,
      error: this.error,
      pending: this.queue.length,
    };
  }

  private _emit(patch: Partial<VoiceState>): void {
    if (!this.onState) return;
    try {
      this.onState({ ...this.getState(), ...patch });
    } catch {
      /* 回调里的异常不能影响播放 */
    }
  }

  // ---------------- 引擎探测 ----------------

  /** 探测后端是否可用，返回 "server" | "browser"。结果会缓存。 */
  async probe(): Promise<"server" | "browser"> {
    if (this.enginePref === "browser") {
      this.engineInUse = "browser";
      this._emit({});
      return "browser";
    }

    if (this.serverAvailable !== null) return this.engineInUse === "server" ? "server" : "browser";
    if (this._probePromise) return this._probePromise;

    this._probePromise = (async (): Promise<"server" | "browser"> => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);

        const res = await fetch(`${this.apiBase}/voice/health`, { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = (await res.json()) as { available?: boolean };
        this.serverAvailable = !!data.available;
      } catch {
        // 后端没起 / 没装 edge-tts / 超时：静默降级，不打扰用户
        this.serverAvailable = false;
      }

      this.engineInUse = this.serverAvailable ? "server" : "browser";
      this._emit({ engine: this.engineInUse });
      return this.engineInUse === "server" ? "server" : "browser";
    })();

    return this._probePromise;
  }

  // ---------------- 对外接口 ----------------

  /** 喂流式文字：年糕每吐一小段就调一次 */
  feed(delta: string | null | undefined): void {
    if (!delta) return;

    const sentences = this.chunker.feed(String(delta));
    if (!sentences.length) return;

    const clean = sentences.map(cleanForSpeech).filter(Boolean);
    this._enqueue(clean);
  }

  /** 流结束：把不足一句的尾巴也念掉，返回「全部播完」的 Promise */
  async flush(): Promise<void> {
    const rest = this.chunker.flush().map(cleanForSpeech).filter(Boolean);
    this._enqueue(rest);
    await this._whenIdle();
  }

  /** 一次性播报整段文字（比如点「重播」按钮） */
  async speak(text: string): Promise<void> {
    const clean = cleanForSpeech(text);
    if (!clean) return;
    this._enqueue(splitSentences(clean));
    await this._whenIdle();
  }

  /** 立即停止并清空队列（打断） */
  stop(): void {
    this.session += 1;
    this.loopId = 0;
    this.queue = [];
    this.chunker.reset();
    this._prefetch = null;

    // 正在播的 mp3
    if (this._audio) {
      try {
        this._audio.pause();
      } catch {
        /* ignore */
      }
      this._audio = null;
    }
    if (this._resolvePlay) {
      this._resolvePlay(false);
      this._resolvePlay = null;
    }
    if (this._audioUrl) {
      URL.revokeObjectURL(this._audioUrl);
      this._audioUrl = null;
    }

    // 正在念的浏览器语音
    if (this._resolveSpeak) {
      this._resolveSpeak(false);
      this._resolveSpeak = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }

    this.speaking = false;
    this._emit({ speaking: false });
    this._resolveIdle();
  }

  destroy(): void {
    this.stop();
    this.onState = null;
  }

  // ---------------- 队列驱动 ----------------

  private _enqueue(list: string[]): void {
    if (!list || !list.length) return;
    for (const item of list) {
      if (item) this.queue.push(item);
    }
    this._kick();
  }

  private _kick(): void {
    if (this.loopId) return; // 已经在跑了
    if (!this.queue.length) {
      this._resolveIdle();
      return;
    }

    const loopId = ++this.loopSeq;
    this.loopId = loopId;

    const session = this.session;
    this.speaking = true;
    this._emit({ speaking: true });

    void (async () => {
      try {
        await this.probe();

        while (this.queue.length && this.session === session) {
          const text = this.queue.shift();
          if (text === undefined) break;

          if (this.engineInUse === "server") {
            // 先把「马上要念的这句」请求出去，再预取下一句；
            // 顺序反过来会让第一句排在第二句后面合成，开头就卡一下
            const pending = this._audioFor(text);
            this._prefetchNext();

            const blob = await pending;
            if (this.session !== session) break;

            if (blob) {
              const played = await this._playBlob(blob);
              if (this.session !== session) break;
              if (played) continue;
              // 自动播放被拦截 / 解码失败 → 这句改用浏览器语音
            }
          }

          if (this.session !== session) break;
          await this._speakBrowser(text);
        }
      } catch (e) {
        console.warn("[voice] 播报中断:", e);
      } finally {
        if (this.loopId === loopId) {
          this.loopId = 0;
          this.speaking = false;
          this._emit({ speaking: false });
          this._resolveIdle();
        }
      }
    })();
  }

  private _prefetchNext(): void {
    if (this.engineInUse !== "server") return;

    const next = this.queue[0];
    if (!next) return;
    if (this._prefetch && this._prefetch.text === next) return;

    const promise = this._fetchAudio(next);
    // 预取失败时这一句可能已经用不上了（比如已降级到浏览器语音），
    // 先挂一个空 catch 标记「已处理」，真正要播时 await 仍然能拿到错误
    promise.catch(() => {});

    this._prefetch = { text: next, promise };
  }

  private async _audioFor(text: string): Promise<Blob | null> {
    const prefetched = this._prefetch && this._prefetch.text === text ? this._prefetch.promise : null;
    if (prefetched) this._prefetch = null;

    try {
      return await (prefetched || this._fetchAudio(text));
    } catch (e) {
      // 合成失败：降级到浏览器语音，后续句子也不再试服务端
      console.warn("[voice] 服务端合成失败，改用浏览器语音:", (e as Error)?.message || e);
      this.serverAvailable = false;
      this.engineInUse = "browser";
      this._prefetch = null;
      this._emit({ engine: "browser" });
      return null;
    }
  }

  private async _fetchAudio(text: string): Promise<Blob> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const token = this.getToken ? this.getToken() : null;
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${this.apiBase}/voice/tts`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text, voice: this.voice, preset: this.preset }),
    });

    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

    const blob = await res.blob();
    if (!blob || !blob.size) throw new Error("TTS 返回空音频");

    return blob;
  }

  /** 播放一段 mp3，返回是否真的播完（false = 被拦截或解码失败） */
  private _playBlob(blob: Blob): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const url = URL.createObjectURL(blob);
      this._audioUrl = url;

      const audio = new Audio(url);
      audio.preload = "auto";
      this._audio = audio;

      let settled = false;
      let guard: ReturnType<typeof setTimeout> | null = null;

      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        if (guard) clearTimeout(guard);
        this._resolvePlay = null;
        audio.onended = null;
        audio.onerror = null;
        resolve(ok);
      };

      this._resolvePlay = finish;
      audio.onended = () => finish(true);
      audio.onerror = () => finish(false);

      // 兜底：个别浏览器 onended 不触发，别让队列永远卡在这一句
      audio.onloadedmetadata = () => {
        const ms = Number.isFinite(audio.duration) ? audio.duration * 1000 + 3000 : 15000;
        guard = setTimeout(() => finish(true), Math.max(3000, ms));
      };

      const played = audio.play();
      if (played && typeof played.catch === "function") {
        // 浏览器自动播放限制：没能播出去就如实返回 false，交给浏览器语音兜底
        played.catch(() => {
          this.error = "浏览器拦截了自动播放，已改用本地语音";
          this._emit({ error: this.error });
          finish(false);
        });
      }
    });
  }

  private _speakBrowser(text: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (!isBrowserSpeechSupported()) {
        resolve(false);
        return;
      }

      const synth = window.speechSynthesis;
      const utter = new SpeechSynthesisUtterance(text);

      utter.lang = "zh-CN";
      utter.rate = this.rate;
      utter.pitch = 1;
      utter.volume = 1;

      const v = pickBrowserVoice();
      if (v) utter.voice = v;

      let settled = false;
      let started = false;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      let hardStop: ReturnType<typeof setTimeout> | null = null;

      const finish = (ok = false): void => {
        if (settled) return;
        settled = true;
        if (watchdog) clearTimeout(watchdog);
        if (hardStop) clearTimeout(hardStop);
        this._resolveSpeak = null;
        resolve(ok);
      };

      this._resolveSpeak = finish;

      utter.onstart = () => {
        started = true;
      };
      utter.onend = () => finish(true);
      utter.onerror = () => finish(false);

      // 自动播放被拦时 speechSynthesis 既不报错也不开口，会一直挂着。
      // 2.5 秒还没开始就说，认为是没被允许出声，直接放行队列。
      watchdog = setTimeout(() => {
        // 有的浏览器不派发 onstart，用 speaking / pending 再确认一次
        if (started || synth.speaking || synth.pending) return;
        this.error = "浏览器拦截了自动播放，点一下喇叭再试";
        this._emit({ error: this.error });
        try {
          synth.cancel();
        } catch {
          /* ignore */
        }
        finish(false);
      }, 2500);

      // 兜底：某些 Chrome 版本长句不触发 onend
      const estimate = Math.max(3000, (text.length * 260) / Math.max(0.5, this.rate) + 4000);
      hardStop = setTimeout(() => finish(false), estimate);

      try {
        synth.resume(); // Chrome 上被 cancel 后需要 resume 才会继续
        synth.speak(utter);
      } catch {
        finish();
      }
    });
  }

  // ---------------- 空闲等待 ----------------

  private _whenIdle(): Promise<void> {
    if (!this.loopId && !this.queue.length) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this._idleWaiters.push(() => resolve());
    });
  }

  private _resolveIdle(): void {
    const waiters = this._idleWaiters;
    this._idleWaiters = [];
    for (const fn of waiters) fn();
  }
}

export default VoicePlayer;
