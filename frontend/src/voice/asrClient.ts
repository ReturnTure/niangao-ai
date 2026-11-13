/**
 * 语音输入 · 后端接口客户端
 *
 * 只做两件事：探测识别能力、上传一段 WAV 换回文字。
 * 出错时抛带 code 的 AsrError，方便 UI 决定是「提示一下」还是「直接禁用」。
 */

export type AsrErrorCode = "asr_error" | "health_failed" | "empty_audio" | "unauthorized" | "unavailable" | "too_large" | "failed";

export class AsrError extends Error {
  code: AsrErrorCode;
  status: number;

  constructor(message: string, { code = "asr_error", status = 0 }: { code?: AsrErrorCode; status?: number } = {}) {
    super(message);
    this.name = "AsrError";
    this.code = code;
    this.status = status;
  }
}

/** 后端 /voice/asr 的返回体 */
export interface AsrResult {
  text: string;
  duration: number;
  ms?: number;
  [key: string]: unknown;
}

/** 后端 /voice/asr/health 的返回体 */
export interface AsrHealth {
  available: boolean;
  reason?: string;
  [key: string]: unknown;
}

export type GetToken = (() => string | null) | null | undefined;

export interface TranscribeOptions {
  apiBase?: string;
  getToken?: GetToken;
  signal?: AbortSignal;
}

function readStoredToken(): string | null {
  try {
    return localStorage.getItem("token");
  } catch {
    return null;
  }
}

function authHeaders(getToken: GetToken, extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = typeof getToken === "function" ? getToken() : readStoredToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function trimBase(apiBase: string): string {
  return String(apiBase).replace(/\/+$/, "");
}

/** 后端是否装好了 vosk + 模型 */
export async function fetchAsrHealth(
  apiBase = "",
  { signal }: { signal?: AbortSignal } = {},
): Promise<AsrHealth> {
  const res = await fetch(`${trimBase(apiBase)}/voice/asr/health`, { signal });
  if (!res.ok) throw new AsrError(`健康检查失败 HTTP ${res.status}`, { code: "health_failed", status: res.status });
  return (await res.json()) as AsrHealth;
}

/**
 * 上传一段录音，换回中文文本。
 * @param blob 16kHz/16bit/单声道 WAV
 */
export async function transcribeAudio(blob: Blob, { apiBase = "", getToken = null, signal }: TranscribeOptions = {}): Promise<AsrResult> {
  if (!blob || !blob.size) {
    throw new AsrError("没有录到声音", { code: "empty_audio" });
  }

  const res = await fetch(`${trimBase(apiBase)}/voice/asr`, {
    method: "POST",
    headers: authHeaders(getToken, { "Content-Type": blob.type || "audio/wav" }),
    body: blob,
    signal,
  });

  if (res.status === 401) {
    throw new AsrError("登录已过期，请重新登录后再用语音输入", { code: "unauthorized", status: 401 });
  }

  if (res.status === 503) {
    const detail = (await res.json().catch(() => null)) as { detail?: { reason?: string } } | null;
    throw new AsrError(detail?.detail?.reason || "服务端语音识别不可用", {
      code: "unavailable",
      status: 503,
    });
  }

  if (res.status === 413) {
    throw new AsrError("这段话太长了，一次说短一点好吗？", { code: "too_large", status: 413 });
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new AsrError(detail?.detail || `识别失败 HTTP ${res.status}`, {
      code: "failed",
      status: res.status,
    });
  }

  return (await res.json()) as AsrResult;
}

export default transcribeAudio;
