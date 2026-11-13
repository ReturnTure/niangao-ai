/**
 * 语音模块出口（播报 + 输入）
 *
 *   import { useVoice, VoiceToggle, useVoiceInput, MicButton } from "../voice";
 */

// 语音播报（TTS）
export {
  VoicePlayer,
  DEFAULT_VOICE,
  DEFAULT_PRESET,
  isBrowserSpeechSupported,
  listBrowserVoices,
} from "./VoicePlayer";
export { useVoice } from "./useVoice";
export { default as VoiceToggle } from "./VoiceToggle";
export { cleanForSpeech, splitSentences, createSentenceChunker } from "./textChunker";

// 语音输入（ASR，离线 Vosk）
export { useVoiceInput } from "./useVoiceInput";
export { default as MicButton } from "./MicButton";
export { MicRecorder, isMicSupported, TARGET_SAMPLE_RATE } from "./MicRecorder";
export { transcribeAudio, fetchAsrHealth, AsrError } from "./asrClient";
export { encodeWav16, downsample, mergeFloat32, wavBlob } from "./wav";

// 类型出口：接入方需要时可以直接 import type
export type { EngineInUse, EnginePreference, VoiceState } from "./VoicePlayer";
export type { UseVoiceApi } from "./useVoice";
export type { UseVoiceInputApi } from "./useVoiceInput";
export type { AsrErrorCode, AsrHealth, AsrResult } from "./asrClient";
export type { MicRecorderOptions, RecordedAudio } from "./MicRecorder";
export type { ChunkOptions, SentenceChunker } from "./textChunker";
export type { MicButtonProps } from "./MicButton";
export type { VoiceToggleProps } from "./VoiceToggle";
