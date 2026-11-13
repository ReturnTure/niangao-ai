/**
 * 语音播报 · 文本清洗与分句（纯函数，无副作用）
 *
 * 为什么需要它：
 * 1. 年糕的回复里会有 **粗体**、表情、列表符号、链接，这些东西念出来是噪音
 * 2. 流式回复是一小段一小段来的，必须按标点切成句子才能「边生成边播报」，
 *    否则要等整段生成完才开口，用户会觉得卡住了
 *
 * 规则与后端 app/services/tts.py 保持一致，这样服务端合成和浏览器语音
 * 念出来的内容不会有差别。
 */

const CODE_BLOCK = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`]*)`/g;
const MD_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const MD_LINK = /\[([^\]]+)\]\([^)]*\)/g;
const URL_RE = /https?:\/\/\S+|www\.\S+/g;
const HTML_TAG = /<[^>]{1,40}>/g;
const BULLET = /^[ \t]*(?:[-+*•]|\d+[.)、])[ \t]+/gm;
const MD_MARKS = /[*_~`#>|]+/g;
// 表情、变体选择符、国旗；零宽连接符单独清，避免字符类里出现连写
const EMOJI = /[\p{Extended_Pictographic}\uFE0F]|\p{Regional_Indicator}|\p{Emoji_Modifier}/gu;
const ZWJ = /\u200D/g;

const SENT_END = "。！？!?…；;\n";
const SOFT_CUT = "，、,：: \n";

/** 分句参数：太短的碎片合并，太长的句子再切 */
export interface ChunkOptions {
  minLen?: number;
  maxLen?: number;
}

/** 流式分句器：喂 delta，吐出「已经说完」的句子 */
export interface SentenceChunker {
  feed(delta: string): string[];
  flush(): string[];
  reset(): void;
}

/**
 * 把模型回复洗成适合朗读的文本。
 * 保留标点 —— 标点决定 TTS 的停顿和语调，删了会变成机器人念经。
 */
export function cleanForSpeech(raw: string | null | undefined): string {
  if (!raw) return "";

  let s = String(raw);
  s = s.replace(CODE_BLOCK, " ");
  s = s.replace(MD_IMAGE, " ");
  s = s.replace(MD_LINK, "$1");
  s = s.replace(URL_RE, " ");
  s = s.replace(HTML_TAG, " ");
  s = s.replace(INLINE_CODE, "$1");
  s = s.replace(BULLET, "");
  s = s.replace(MD_MARKS, "");
  s = s.replace(EMOJI, "");
  s = s.replace(ZWJ, "");
  s = s.replace(/[ \t]+([。！？，、；：!?,;:）】」》])/g, "$1");
  s = s.replace(/[ \t\u3000]+/g, " ");
  s = s.replace(/\n{2,}/g, "\n");

  return s.trim();
}

function softCut(text: string, limit: number): number {
  for (let i = Math.min(limit, text.length) - 1; i > Math.floor(limit / 3); i--) {
    if (SOFT_CUT.includes(text[i])) return i + 1;
  }
  return limit;
}

/**
 * 整段文本切句：短句合并、长句再切。
 * @returns 每项是一段可以直接合成的文本
 */
export function splitSentences(text: string, options: ChunkOptions = {}): string[] {
  const { minLen = 8, maxLen = 70 } = options;
  if (!text || !text.trim()) return [];

  const raw: string[] = [];
  let buf = "";

  for (const ch of text) {
    buf += ch;
    if (SENT_END.includes(ch)) {
      if (buf.trim()) raw.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) raw.push(buf.trim());

  // 合并太短的碎片，避免「嗯。」单独成一句、听起来一顿一顿的
  const merged: string[] = [];
  let carry = "";

  for (const piece of raw) {
    if (carry && !/[。！？!?…；;，、,]$/.test(carry)) {
      carry += "，";
    }
    carry += piece;
    if (carry.length >= minLen) {
      merged.push(carry);
      carry = "";
    }
  }
  if (carry) {
    if (merged.length) merged[merged.length - 1] += carry;
    else merged.push(carry);
  }

  // 一句话超过 maxLen 就再切，太长浏览器语音会被截断，服务端也慢
  const out: string[] = [];
  for (let piece of merged) {
    while (piece.length > maxLen) {
      const cut = softCut(piece, maxLen);
      out.push(piece.slice(0, cut).trim());
      piece = piece.slice(cut).trim();
    }
    if (piece) out.push(piece);
  }

  return out.filter(Boolean);
}

/**
 * 流式分句器：喂 delta，吐出「已经说完」的句子。
 *
 *   const chunker = createSentenceChunker();
 *   chunker.feed("听起来你")   // → []
 *   chunker.feed("很累了。")    // → ["听起来你很累了。"]
 *   chunker.flush()             // → 剩余不足一句的尾巴
 */
export function createSentenceChunker(options: ChunkOptions = {}): SentenceChunker {
  const { minLen = 4, maxLen = 70 } = options;
  let buf = "";
  let pending = "";

  function findEnd(): number {
    for (let i = 0; i < buf.length; i++) {
      if (SENT_END.includes(buf[i])) return i;
    }
    return -1;
  }

  return {
    feed(delta: string): string[] {
      if (!delta) return [];

      buf += delta;
      const out: string[] = [];

      // 逐个找句末标点，切出完整句
      let idx = findEnd();

      while (idx >= 0) {
        const piece = buf.slice(0, idx + 1).trim();
        buf = buf.slice(idx + 1);

        if (piece) {
          const text = pending + piece;
          if (text.length < minLen) {
            pending = text;
          } else {
            pending = "";
            out.push(text);
          }
        }

        idx = findEnd();
      }

      // 一直没标点也要能开口，不能憋到最后
      while (buf.length > maxLen) {
        const cut = softCut(buf, maxLen);
        const text = (pending + buf.slice(0, cut)).trim();
        buf = buf.slice(cut);
        pending = "";
        if (text) out.push(text);
      }

      return out;
    },

    flush(): string[] {
      const rest = (pending + buf).trim();
      pending = "";
      buf = "";
      return rest ? [rest] : [];
    },

    reset(): void {
      pending = "";
      buf = "";
    },
  };
}
