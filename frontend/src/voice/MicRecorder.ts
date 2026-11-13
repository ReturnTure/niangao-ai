/**
 * 语音输入 · 麦克风录音器（独立模块，不依赖 React）
 *
 * 做三件事：
 * 1. 拿到麦克风（16k 采样，浏览器不支持就直接用默认采样率，事后再重采样）
 * 2. 边录边算音量，给按钮做「正在听」的呼吸反馈
 * 3. stop() 时吐出 16kHz/16bit/单声道 的 WAV Blob，直接 POST 给后端
 *
 * 之所以不用 MediaRecorder（webm/opus）：Vosk 只认裸 PCM，
 * 而后端解码 webm 需要 ffmpeg。直接在浏览器里拿 PCM，链条最短、最不容易坏。
 */

import { downsample, encodeWav16, mergeFloat32 } from "./wav";

export const TARGET_SAMPLE_RATE = 16000;

// Safari 只有带前缀的 webkitAudioContext，补一个声明让 TS 认
declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

export interface MicRecorderOptions {
  sampleRate?: number;
  /** 每帧音量回调，0~1，给 UI 做呼吸圈 */
  onLevel?: ((level: number) => void) | null;
  onError?: ((error: Error) => void) | null;
}

/** 停止录音后的产物；blob 为 null 表示这段没录到数据 */
export interface RecordedAudio {
  blob: Blob | null;
  seconds: number;
  sampleRate: number;
  /** 实际音频时长（秒），用来判断「是不是说太短了」 */
  duration?: number;
}

export function isMicSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === "function" &&
    typeof window !== "undefined" &&
    !!(window.AudioContext || window.webkitAudioContext)
  );
}

export class MicRecorder {
  targetRate: number;
  onLevel: ((level: number) => void) | null;
  onError: ((error: Error) => void) | null;

  stream: MediaStream | null;
  ctx: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  processor: ScriptProcessorNode | null;
  sink: GainNode | null;
  chunks: Float32Array[];
  recording: boolean;
  startedAt: number;

  constructor({ sampleRate = TARGET_SAMPLE_RATE, onLevel = null, onError = null }: MicRecorderOptions = {}) {
    this.targetRate = sampleRate;
    this.onLevel = onLevel;
    this.onError = onError;

    this.stream = null;
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.sink = null;
    this.chunks = [];
    this.recording = false;
    this.startedAt = 0;
  }

  get sampleRate(): number {
    return this.ctx?.sampleRate || this.targetRate;
  }

  async start(): Promise<void> {
    if (!isMicSupported()) {
      throw new Error("这个浏览器不支持麦克风录音");
    }
    if (this.recording) return;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
    } catch (e) {
      throw new Error(describeMicError(e), { cause: e });
    }

    const AudioCtx = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioCtx) {
      stream.getTracks().forEach((t) => t.stop());
      throw new Error("这个浏览器不支持麦克风录音");
    }

    // 尽量直接开 16k，省掉一次重采样；不支持就退回默认采样率
    let ctx: AudioContext;
    try {
      ctx = new AudioCtx({ sampleRate: this.targetRate });
    } catch {
      ctx = new AudioCtx();
    }

    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        /* 有些浏览器要等用户手势，忽略 */
      }
    }

    this.stream = stream;
    this.ctx = ctx;
    this.chunks = [];

    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (event: AudioProcessingEvent) => {
      const data = event.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      if (this.onLevel) this.onLevel(computeLevel(data));
    };

    // 必须接到 destination 才会持续回调；用一个静音增益节点避免自己听自己
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(processor);
    processor.connect(sink);
    sink.connect(ctx.destination);

    this.source = source;
    this.processor = processor;
    this.sink = sink;

    this.recording = true;
    this.startedAt = Date.now();
  }

  /** 停止录音，返回 WAV Blob 与时长 */
  async stop(): Promise<RecordedAudio | null> {
    if (!this.recording) return null;

    this.recording = false;
    const seconds = Math.max(0, (Date.now() - this.startedAt) / 1000);

    // 必须在 _teardown() 之前取：拆完 this.ctx 就空了，采样率会误判成 16k，
    // 于是 48k 的机器不再重采样，Vosk 拿到 3 倍速的音频，识别全会乱。
    const sourceRate = this.ctx?.sampleRate || this.targetRate;

    this._teardown();

    const merged = mergeFloat32(this.chunks);
    this.chunks = [];

    if (!merged.length) return { blob: null, seconds, sampleRate: this.targetRate };

    const resampled = downsample(merged, sourceRate, this.targetRate);
    const buffer = encodeWav16(resampled, this.targetRate);

    return {
      blob: new Blob([buffer], { type: "audio/wav" }),
      seconds,
      sampleRate: this.targetRate,
      duration: resampled.length / this.targetRate,
    };
  }

  /** 取消：不产出音频，直接释放设备 */
  cancel(): void {
    this.recording = false;
    this.chunks = [];
    this._teardown();
  }

  private _teardown(): void {
    try {
      this.processor?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
    } catch {
      /* ignore */
    }

    if (this.processor) this.processor.onaudioprocess = null;

    try {
      this.stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }

    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }

    this.processor = null;
    this.source = null;
    this.sink = null;
    this.stream = null;
    this.ctx = null;
  }
}

/** 音量归一化到 0~1，给 UI 做反馈（RMS 开方后再压一下） */
function computeLevel(data: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  return Math.min(1, rms * 6);
}

function describeMicError(e: unknown): string {
  const name = (e as DOMException | null)?.name || "";

  if (name === "NotAllowedError" || name === "SecurityError") {
    return "麦克风权限被拒绝了，请在浏览器地址栏允许麦克风后重试";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "没有找到麦克风设备";
  }
  if (name === "NotReadableError") {
    return "麦克风被其它程序占用了（比如会议软件），关掉后再试";
  }
  if (name === "OverconstrainedError") {
    return "麦克风不支持当前录音参数";
  }

  return (e as Error | null)?.message || "打开麦克风失败";
}
