import { useId } from "react";
import type { ReactNode } from "react";
import { stickerMeta, type StickerId } from "./catalog";

/**
 * 表情包形象层
 *
 * 全部用 SVG 画，理由和 NiangaoSprite 一致：透明背景、缩放不糊、离线可用，
 * 也不用为 8 张小图额外发 8 个请求。身体轮廓直接沿用主形象的贝塞尔曲线，
 * 保证"聊天里的年糕"和"空状态里的年糕"是同一只，不会像两个画师拼起来的。
 *
 * 两条硬约束（都是渲染成图逐个看出来的）：
 * 1. 道具不能压在五官上。缩到 104px 时，压在嘴上的爱心会变成一块红疙瘩。
 * 2. 手和手臂必须有描边。身体是奶油色，手再用奶油色就整个糊掉、看不见了。
 *
 * 想换成 AI 插画版（PNG/WebP）时，只要把 StickerArt 换成 <img>，
 * 其余决策与渲染代码一行都不用动。
 */

const INK = "#4A3A2C";
const BLUSH = "#F2A88E";

/** 手臂：深一档的底色 + 浅色内芯，等于给手臂描了个边，缩到 100px 也分得清 */
function Arm({ d }: { d: string }) {
  return (
    <>
      <path d={d} stroke="#E2C79B" strokeWidth="13" strokeLinecap="round" fill="none" />
      <path d={d} stroke="#FBEFD9" strokeWidth="8.5" strokeLinecap="round" fill="none" />
    </>
  );
}

const BODY =
  "M100 52C141 52 168 80 168 114C168 148 138 166 100 166C62 166 32 148 32 114C32 80 59 52 100 52Z";

/* ---------------- 五官 ---------------- */

function EyesDot() {
  return (
    <>
      <circle cx="77" cy="112" r="6.4" fill={INK} />
      <circle cx="123" cy="112" r="6.4" fill={INK} />
      <circle cx="79.4" cy="109.4" r="2.1" fill="#fff" opacity="0.92" />
      <circle cx="125.4" cy="109.4" r="2.1" fill="#fff" opacity="0.92" />
    </>
  );
}

function EyesHappy() {
  return (
    <>
      <path d="M68 114 Q77 104 86 114" stroke={INK} strokeWidth="4.2" strokeLinecap="round" fill="none" />
      <path d="M114 114 Q123 104 132 114" stroke={INK} strokeWidth="4.2" strokeLinecap="round" fill="none" />
    </>
  );
}

function EyesClosed() {
  return (
    <>
      <path d="M68 113 Q77 120 86 113" stroke={INK} strokeWidth="3.6" strokeLinecap="round" fill="none" />
      <path d="M114 113 Q123 120 132 113" stroke={INK} strokeWidth="3.6" strokeLinecap="round" fill="none" />
    </>
  );
}

function MouthSmile() {
  return (
    <path d="M90 129 Q100 138 110 129" stroke={INK} strokeWidth="2.8" strokeLinecap="round" fill="none" />
  );
}

function MouthOpen() {
  return <path d="M91 128 Q100 143 109 128 Q100 133 91 128 Z" fill={INK} />;
}

function MouthO() {
  return <ellipse cx="100" cy="132" rx="4.2" ry="4.8" fill={INK} />;
}

/** 微微上扬但眼里没光的笑 —— 用来陪难过，不用来庆祝 */
function MouthSoft() {
  return (
    <path d="M92 131 Q100 135 108 131" stroke={INK} strokeWidth="2.6" strokeLinecap="round" fill="none" />
  );
}

function Blush({ id }: { id: string }) {
  return (
    <>
      <ellipse cx="60" cy="127" rx="19" ry="12" fill={`url(#${id})`} />
      <ellipse cx="140" cy="127" rx="19" ry="12" fill={`url(#${id})`} />
    </>
  );
}

/* ---------------- 道具 ---------------- */

function Heart({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <path
        d="M0 22 C-11 13 -18 6 -18 -2 C-18 -9 -13 -13 -8 -13 C-3 -13 0 -10 0 -6 C0 -10 3 -13 8 -13 C13 -13 18 -9 18 -2 C18 6 11 13 0 22 Z"
        fill="#F2857F"
        stroke="#E06C67"
        strokeWidth="1.6"
      />
      <ellipse cx="-6.5" cy="-4" rx="4" ry="2.6" fill="#fff" opacity="0.5" />
    </g>
  );
}

function Sparkle({ x, y, r = 6 }: { x: number; y: number; r?: number }) {
  return (
    <path
      d={`M${x} ${y - r} Q${x + r * 0.22} ${y - r * 0.22} ${x + r} ${y} Q${x + r * 0.22} ${y + r * 0.22} ${x} ${y + r} Q${x - r * 0.22} ${y + r * 0.22} ${x - r} ${y} Q${x - r * 0.22} ${y - r * 0.22} ${x} ${y - r} Z`}
      fill="#F5C36A"
    />
  );
}

function Note({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <ellipse cx="0" cy="14" rx="5.5" ry="4.4" fill="#88A37C" transform="rotate(-18)" />
      <path d="M4.6 13 L4.6 -4" stroke="#88A37C" strokeWidth="3" strokeLinecap="round" />
      <path d="M4.6 -4 C10 -3 13 0 13 4" stroke="#88A37C" strokeWidth="3" strokeLinecap="round" fill="none" />
    </g>
  );
}

/** 从画外伸进来的一只手：掌 + 四根手指压在头顶，指尖要真的碰到头 */
function PatHand() {
  return (
    <g>
      <rect x="50" y="2" width="100" height="40" rx="20" fill="#FBDCC6" stroke="#F0C6A9" strokeWidth="2.6" />
      <rect x="60" y="34" width="17" height="32" rx="8.5" fill="#FBDCC6" stroke="#F0C6A9" strokeWidth="2.4" />
      <rect x="83" y="37" width="17" height="32" rx="8.5" fill="#FBDCC6" stroke="#F0C6A9" strokeWidth="2.4" />
      <rect x="106" y="37" width="17" height="32" rx="8.5" fill="#FBDCC6" stroke="#F0C6A9" strokeWidth="2.4" />
      <rect x="129" y="34" width="17" height="32" rx="8.5" fill="#FBDCC6" stroke="#F0C6A9" strokeWidth="2.4" />
      {/* 被摸头带起的轻微动效 */}
      <path d="M40 26 Q34 18 40 10" stroke="#F0C7AE" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85" />
      <path d="M160 26 Q166 18 160 10" stroke="#F0C7AE" strokeWidth="3" strokeLinecap="round" fill="none" opacity="0.85" />
    </g>
  );
}

/* ---------------- 场景 ---------------- */

interface Scene {
  back?: ReactNode;
  front?: ReactNode;
  /** 五官画在身体之后、道具之前 */
  face: ReactNode;
}

function buildScene(id: StickerId): Scene {
  switch (id) {
    case "hug":
      return {
        face: (
          <>
            <EyesHappy />
            <MouthSmile />
          </>
        ),
        front: (
          <>
            {/* 手臂从身体两侧绕到身前，环住爱心 */}
            <Arm d="M44 122 Q44 146 70 152" />
            <Arm d="M156 122 Q156 146 130 152" />
            <Heart x={100} y={153} s={1.08} />
          </>
        ),
      };

    case "pat":
      return {
        back: <PatHand />,
        face: (
          <>
            <EyesClosed />
            <MouthSmile />
          </>
        ),
      };

    case "listen":
      return {
        back: (
          <>
            <path
              d="M38 106 A62 62 0 0 1 162 106"
              stroke="#9FB394"
              strokeWidth="9"
              strokeLinecap="round"
              fill="none"
            />
            {/* 耳罩要露在身体外面，否则被身体盖住等于没戴 */}
            <rect x="16" y="98" width="24" height="34" rx="12" fill="#7F9A73" />
            <rect x="160" y="98" width="24" height="34" rx="12" fill="#7F9A73" />
          </>
        ),
        face: (
          <>
            <EyesDot />
            <MouthSmile />
          </>
        ),
        front: <Note x={172} y={56} />,
      };

    case "breathe":
      return {
        back: (
          <>
            <circle
              cx="100"
              cy="110"
              r="74"
              fill="none"
              stroke="#BFD3B4"
              strokeWidth="2.4"
              strokeDasharray="3 10"
              opacity="0.85"
            />
            <circle
              cx="100"
              cy="110"
              r="86"
              fill="none"
              stroke="#BFD3B4"
              strokeWidth="2"
              strokeDasharray="3 12"
              opacity="0.5"
            />
          </>
        ),
        face: (
          <>
            <EyesClosed />
            <MouthO />
          </>
        ),
        front: (
          // 一片被呼气带动的叶子
          <>
            <path d="M158 96 Q172 96 172 108" stroke="#BFD3B4" strokeWidth="3" strokeLinecap="round" fill="none" />
            <path d="M164 84 Q184 86 184 102" stroke="#CFDEC6" strokeWidth="2.6" strokeLinecap="round" fill="none" />
          </>
        ),
      };

    case "cheer":
      return {
        face: (
          <>
            <EyesHappy />
            <MouthOpen />
          </>
        ),
        front: (
          <>
            <Arm d="M150 128 Q160 118 156 104" />
            <path d="M156 108 L156 34" stroke="#C9A06A" strokeWidth="4.4" strokeLinecap="round" />
            <path d="M158 36 L196 48 L158 60 Z" fill="#F5B942" stroke="#E0A02C" strokeWidth="1.6" />
            <Sparkle x={54} y={62} r={7} />
            <Sparkle x={126} y={26} r={5} />
          </>
        ),
      };

    case "tea":
      return {
        face: (
          <>
            <EyesClosed />
            <MouthSmile />
          </>
        ),
        front: (
          <>
            {/* 杯子放在右下角外侧：热气往上走也不会穿过眼睛和腮红 */}
            <path
              d="M136 138 C132 130 140 126 136 118"
              stroke="#D9CAB2"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M150 136 C146 128 154 124 150 114"
              stroke="#D9CAB2"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M164 138 C160 130 168 126 164 118"
              stroke="#D9CAB2"
              strokeWidth="2.6"
              strokeLinecap="round"
              fill="none"
            />
            <Arm d="M154 136 Q150 150 138 154" />
            <path
              d="M128 142 L170 142 L166 170 Q148 176 132 170 Z"
              fill="#FFFDF6"
              stroke="#E2D3B9"
              strokeWidth="2.2"
            />
            <path d="M129 149 L169 149" stroke="#EFE2CB" strokeWidth="2.4" />
          </>
        ),
      };

    case "together":
      return {
        face: (
          <>
            <EyesDot />
            <MouthSoft />
          </>
        ),
        front: (
          <>
            <path d="M72 118 C68 125 69 131 74 131 C79 131 77 124 72 118 Z" fill="#9CC3DF" />
            <Heart x={150} y={86} s={0.62} />
          </>
        ),
      };

    case "sleep":
    default:
      return {
        face: (
          <>
            <EyesClosed />
            <MouthSoft />
          </>
        ),
        front: (
          <>
            {/* 被子只盖到下巴：盖过鼻子会变成"闷住"，不是安心 */}
            <rect
              x="26"
              y="140"
              width="148"
              height="34"
              rx="14"
              fill="#E3EDF9"
              stroke="#CFDEEC"
              strokeWidth="2"
            />
            <path
              d="M34 150 C58 144 82 142 100 142 C118 142 142 144 166 150"
              stroke="#FFFFFF"
              strokeWidth="3.2"
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M44 160 L156 160"
              stroke="#D3E1F0"
              strokeWidth="2.2"
              strokeDasharray="7 6"
              strokeLinecap="round"
            />
            {/* Zzz：横画得比竖长，缩到 100px 才看得出是字母而不是一道斜线 */}
            <path
              d="M142 50 L160 50 L142 64 L160 64"
              stroke="#A9B8CD"
              strokeWidth="3.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M164 30 L177 30 L164 40 L177 40"
              stroke="#B9C6D8"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <path
              d="M180 14 L188 14 L180 21 L188 21"
              stroke="#C8D3E1"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ),
      };
  }
}

export interface StickerArtProps {
  id: StickerId;
  size?: number;
}

export default function StickerArt({ id, size = 112 }: StickerArtProps) {
  const uid = useId().replace(/:/g, "");
  const bodyId = `st-body-${uid}`;
  const shadowId = `st-shadow-${uid}`;
  const blushId = `st-blush-${uid}`;

  const scene = buildScene(id);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={stickerMeta(id).caption}
    >
      <defs>
        <radialGradient id={bodyId} cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#FFFEFA" />
          <stop offset="58%" stopColor="#FDF8EC" />
          <stop offset="100%" stopColor="#F1E5CE" />
        </radialGradient>
        <radialGradient id={shadowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#786F62" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#786F62" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={blushId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={BLUSH} stopOpacity="0.72" />
          <stop offset="55%" stopColor={BLUSH} stopOpacity="0.4" />
          <stop offset="100%" stopColor={BLUSH} stopOpacity="0" />
        </radialGradient>
      </defs>

      {scene.back}

      <ellipse cx="100" cy="172" rx="56" ry="11" fill={`url(#${shadowId})`} />
      <path d={BODY} fill={`url(#${bodyId})`} />

      {scene.face}
      <Blush id={blushId} />

      {scene.front}
    </svg>
  );
}
