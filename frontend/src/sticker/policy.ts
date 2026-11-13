/**
 * 表情包决策引擎
 *
 * 关键问题不是"怎么发一张图"，而是**什么时候不该发**。
 * 心理陪伴场景里，不合时宜的可爱是冒犯：用户说"我不想活了"的时候弹一只比心的年糕，
 * 比不说话伤害大得多。所以这里的规则按"先否决、后挑选"的顺序排：
 *
 *   否决（任一命中就这轮不发）
 *     1. 危机轮 —— 求助卡片已经在页面上了，任何卖萌都在消解它
 *     2. 错误轮 —— 报错文案配表情像在嘲讽
 *     3. 第一轮 —— 刚认识，先让用户确认"对面是认真在听"
 *     4. 冷却中 —— 距上次发表情不足 COOLDOWN_TURNS 轮，避免刷屏成斗图
 *     5. 纯追问 —— 回复很短又只有一句反问，插图会打断对话节奏
 *     6. 无匹配 —— 情绪中立且没有可挂的基调，宁可不发
 *
 *   挑选
 *     先按情绪定"基调池"，再用回复里的关键词收窄，最后用**确定性随机**定一张。
 *     确定性很重要：同一条消息重新渲染、刷新页面、发言稿里截图，结果都必须一致，
 *     否则没法写测试，也没法在答辩时复现"它为什么会发这张图"。
 */

import {
  STICKER_LIST,
  type StickerId,
  type StickerMeta,
  type StickerMood,
} from "./catalog";

/** 后端 emotion.py 的 key；label（"低落" 等）也会被归一化成 key */
export type EmotionKey = "low" | "anxious" | "anger" | "positive" | "calm" | "";

export interface StickerContext {
  /** 本轮用户情绪，可以直接传后端的 label */
  emotion: EmotionKey | string;
  /** 用户这句话 */
  userText: string;
  /** 年糕这句回复（完整正文） */
  botText: string;
  /** 本轮是否命中危机词 */
  crisis?: boolean;
  /** 本轮是否是错误兜底文案 */
  isError?: boolean;
  /** 这是第几轮（从 0 开始） */
  turnIndex: number;
  /** 上一次发表情是第几轮，没发过传 null/undefined */
  lastStickerTurn?: number | null;
  /** 本地小时数 0-23，用于深夜判断；不传则按当前时间取 */
  hour?: number;
  /** 额外随机源，默认取 userText + botText */
  seed?: string;
}

export interface StickerDecision {
  sticker: StickerMeta;
  /** 为什么发这张 —— 写进 console，答辩时能一条条讲 */
  reason: string;
}

/** 两次表情之间至少隔几轮 */
export const COOLDOWN_TURNS = 3;

/** 中文 label → 后端 key */
const LABEL_TO_KEY: Record<string, EmotionKey> = {
  低落: "low",
  焦虑: "anxious",
  愤怒: "anger",
  积极: "positive",
  平静: "calm",
  low: "low",
  anxious: "anxious",
  anger: "anger",
  positive: "positive",
  calm: "calm",
};

const MOODS_BY_EMOTION: Record<Exclude<EmotionKey, "">, StickerMood[]> = {
  low: ["comfort"],
  anxious: ["soothe"],
  // 愤怒**不给 soothe**：对正在气头上的人说"跟我一起深呼吸"是最典型的无效安慰，
  // 容易被听成"你先闭嘴"。这一刻只需要"我在听"和"我陪着你"。
  anger: ["listen", "comfort"],
  positive: ["encourage"],
  // 平静不代表要发表情，只给一个很窄的池子，且下面还有概率闸门
  calm: ["listen"],
};

/**
 * 回复里的关键词比情绪标签更"当下"：用户可能整体是低落的，
 * 但这一句年糕在说"先喝口热水"，配一张递杯子的图才自然。
 */
const KEYWORD_PICKS: Array<[RegExp, StickerId]> = [
  [/抱抱|抱一下|心疼|委屈|辛苦你了/, "hug"],
  [/陪你|一起|我在旁边|不走开|不用一个人/, "together"],
  [/慢慢|吸气|呼气|深呼吸|数到|放松一下/, "breathe"],
  [/听你说|说说看|想说|我听着|慢慢讲/, "listen"],
  [/晚安|睡吧|早点睡|去休息|躺一会儿/, "sleep"],
  [/真好|替你高兴|了不起|做到了|很棒|值得/, "cheer"],
  [/喝口水|热水|暖暖|吃点东西|热的东西/, "tea"],
];

export function normalizeEmotion(value: EmotionKey | string): EmotionKey {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  return LABEL_TO_KEY[raw] ?? (LABEL_TO_KEY[raw.toLowerCase()] || "");
}

/** FNV-1a，够散且不需要依赖；用来把文本变成稳定下标 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pickFrom(pool: StickerMeta[], seed: string): StickerMeta {
  return pool[hash(seed) % pool.length];
}

function isNight(hour: number): boolean {
  return hour >= 23 || hour < 6;
}

/** 很短又只有一句反问：这时候插一张图，等于把话头抢走 */
function isShortQuestionOnly(botText: string): boolean {
  const t = botText.trim();
  if (t.length > 26) return false;
  return /[？?]\s*$/.test(t);
}

export function decideSticker(ctx: StickerContext): StickerDecision | null {
  const {
    emotion,
    userText = "",
    botText = "",
    crisis = false,
    isError = false,
    turnIndex,
    lastStickerTurn = null,
    hour,
    seed,
  } = ctx;

  // ---------- 一、否决 ----------
  if (crisis) return null;
  if (isError) return null;
  if (!botText.trim()) return null;
  if (turnIndex < 1) return null;

  if (
    typeof lastStickerTurn === "number" &&
    turnIndex - lastStickerTurn < COOLDOWN_TURNS
  ) {
    return null;
  }

  if (isShortQuestionOnly(botText)) return null;

  // ---------- 二、定基调 ----------
  const key = normalizeEmotion(emotion);
  const hourNow =
    typeof hour === "number" ? hour : new Date().getHours();

  const moods: StickerMood[] = key ? [...MOODS_BY_EMOTION[key]] : [];

  // 深夜优先"晚安"，但也只在情绪不需要安慰时用 —— 深夜说"抱抱"比"晚安"更需要
  if (isNight(hourNow) && (key === "calm" || key === "")) {
    moods.push("night");
  }

  if (moods.length === 0) return null;

  let pool = STICKER_LIST.filter((s) => s.moods.some((m) => moods.includes(m)));
  if (pool.length === 0) return null;

  // ---------- 三、关键词收窄 ----------
  const haystack = `${userText}\n${botText}`;
  let reason = `情绪「${key || "无"}」→ 基调 ${moods.join("/")}`;

  for (const [re, id] of KEYWORD_PICKS) {
    if (!re.test(haystack)) continue;
    const hit = STICKER_LIST.find((s) => s.id === id);
    // 关键词指向的图必须也在当前基调池里，否则会出现"用户很愤怒却发撒花"
    if (hit && pool.some((s) => s.id === hit.id)) {
      pool = [hit];
      reason += `；回复里出现「${re.source.split("|")[0]}」`;
      break;
    }
  }

  // ---------- 四、概率闸门 ----------
  const stableSeed = seed ?? `${userText}|${botText}|${turnIndex}`;

  // 平静是常态，不能每轮都发；命中 3/10 才发，其余保持安静
  if ((key === "calm" || key === "") && hash(stableSeed) % 10 >= 3) {
    return null;
  }

  const sticker = pickFrom(pool, stableSeed);
  return { sticker, reason: `${reason} → ${sticker.title}` };
}

/**
 * 从对话历史里找出"上一次发表情是在第几轮"。
 * 放在这里而不是组件里，是因为它和冷却规则是一件事，得一起测。
 */
export function lastStickerTurnOf(
  history: Array<{ role: string; sticker?: unknown }>,
): number | null {
  let turns = 0;
  let last: number | null = null;

  for (const msg of history) {
    if (msg.role === "user") turns += 1;
    if (msg.sticker) last = turns - 1;
  }

  return last;
}
