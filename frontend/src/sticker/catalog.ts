/**
 * 年糕的表情包 · 目录
 *
 * 这里只放**数据**，不碰 JSX —— 决策逻辑（policy.ts）要能在 node 里直接跑单测，
 * 一旦 import 了 .tsx 就得配 JSX 编译，测试成本立刻变高。画图的部分在 art.tsx。
 *
 * 加一张新表情只需要两步：
 *   1. 在 StickerId 里加一个 id，下面 STICKER_LIST 补一条；
 *   2. art.tsx 的 FACES 里补一组五官与道具。
 * 没画的部分不会白屏 —— StickerArt 有兜底，见 art.tsx。
 */

export type StickerId =
  | "hug"        // 抱抱
  | "pat"        // 摸摸头
  | "listen"     // 我在听
  | "breathe"    // 一起深呼吸
  | "cheer"      // 为你高兴
  | "tea"        // 喝口热的
  | "together"   // 陪你难过
  | "sleep";     // 晚安

/**
 * 情绪基调。决策时先按"这一轮需要什么基调"筛池子，再在池子里挑具体的图，
 * 这样加新图只要挂对基调，不用改决策代码。
 */
export type StickerMood =
  | "comfort"    // 安慰、接住情绪
  | "listen"     // 表示在听、在陪
  | "soothe"     // 降温、放松
  | "encourage"  // 正向反馈
  | "night";     // 深夜时段专用

export interface StickerMeta {
  id: StickerId;
  /** 短名，鼠标悬停显示 */
  title: string;
  /** 这张图在"说"什么。给屏幕阅读器，也顺手当 tooltip 的第二行 */
  caption: string;
  moods: StickerMood[];
}

export const STICKER_LIST: StickerMeta[] = [
  { id: "hug", title: "抱抱", caption: "抱一下，什么都不用说也行", moods: ["comfort"] },
  { id: "pat", title: "摸摸头", caption: "摸摸头，你已经很不容易了", moods: ["comfort"] },
  { id: "listen", title: "我在听", caption: "你慢慢说，我在听", moods: ["listen"] },
  { id: "breathe", title: "一起呼吸", caption: "跟我一起，慢慢吸一口气", moods: ["soothe"] },
  { id: "cheer", title: "为你高兴", caption: "这一刻值得被记住", moods: ["encourage"] },
  { id: "tea", title: "喝口热的", caption: "先喝口热的，把手暖回来", moods: ["soothe", "comfort"] },
  { id: "together", title: "陪你难过", caption: "难过就难过一会儿，我在旁边", moods: ["comfort", "listen"] },
  { id: "sleep", title: "晚安", caption: "今天先到这儿，好好睡一觉", moods: ["night"] },
];

export const STICKER_MAP: Record<StickerId, StickerMeta> = STICKER_LIST.reduce(
  (acc, s) => {
    acc[s.id] = s;
    return acc;
  },
  {} as Record<StickerId, StickerMeta>,
);

const ID_SET = new Set<string>(STICKER_LIST.map((s) => s.id));

/** 从 localStorage / 后端历史里读回来的值必须过一遍，否则一张不存在的 id 会渲染成空白 */
export function isStickerId(value: unknown): value is StickerId {
  return typeof value === "string" && ID_SET.has(value);
}

export function stickerMeta(id: StickerId): StickerMeta {
  return STICKER_MAP[id] ?? STICKER_LIST[0];
}
