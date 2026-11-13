/**
 * 语音输入 · 音频编码工具（纯函数，可单测）
 *
 * Vosk 只吃 16kHz / 16bit / 单声道 PCM，而浏览器的 AudioContext
 * 在不同机器上可能是 44.1k 或 48k，所以录完要重采样 + 打包成 WAV。
 */

/** 均值下采样：把 48k 压到 16k，比直接抽点干净，不会有高频混叠那么刺耳 */
export function downsample(samples: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (!samples || !samples.length) return new Float32Array(0);
  if (!srcRate || !dstRate || srcRate === dstRate) return samples;

  const ratio = srcRate / dstRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(length);

  let pos = 0;
  for (let i = 0; i < length; i++) {
    const next = Math.min(samples.length, Math.round((i + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let j = pos; j < next; j++) {
      sum += samples[j];
      count++;
    }
    out[i] = count ? sum / count : 0;
    pos = next;
  }

  return out;
}

/** 把多个 AudioBuffer 段落拼成一整段 */
export function mergeFloat32(chunks: Float32Array[]): Float32Array {
  if (!chunks || !chunks.length) return new Float32Array(0);

  let total = 0;
  for (const c of chunks) total += c.length;

  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function writeString(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Float32 样本 → 16bit PCM 的 WAV 文件（ArrayBuffer）。
 * 44 字节标准头，单声道，采样率由调用方给定。
 */
export function encodeWav16(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深

  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return buffer;
}

/** 便于直接发给后端：ArrayBuffer → Blob */
export function wavBlob(samples: Float32Array, sampleRate = 16000): Blob {
  return new Blob([encodeWav16(samples, sampleRate)], { type: "audio/wav" });
}
