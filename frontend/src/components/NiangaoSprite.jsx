/**
 * 年糕的形象。
 *
 * 参考项目背景插画里那只坐在草地上的小团子：奶油色圆身、头顶两片叶子、
 * 深棕色的圆眼睛、淡橘腮红、一个很浅的笑。
 *
 * 全部用 SVG 画，不依赖位图：放大不糊，也方便后面按情绪换表情
 * （眼睛、嘴、腮红各自成组，将来直接对这几组做动画即可）。
 */
export default function NiangaoSprite({ size = 96 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="年糕"
    >
      <defs>
        {/* 身体：左上受光，右下略暗，让平面形状有点体积 */}
        <radialGradient id="ngBody" cx="34%" cy="28%" r="78%">
          <stop offset="0%" stopColor="#FFFEFA" />
          <stop offset="58%" stopColor="#FDF8EC" />
          <stop offset="100%" stopColor="#F1E5CE" />
        </radialGradient>

        <linearGradient id="ngLeaf" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#AFCD9F" />
          <stop offset="100%" stopColor="#7DA26E" />
        </linearGradient>

        <radialGradient id="ngShadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#786F62" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#786F62" stopOpacity="0" />
        </radialGradient>

        {/* 腮红用径向渐变收边，避免硬邦邦的一块橘色贴片 */}
        <radialGradient id="ngBlush" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F2A88E" stopOpacity="0.72" />
          <stop offset="55%" stopColor="#F2A88E" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#F2A88E" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 落地的阴影，让团子看起来是坐着而不是飘着 */}
      <ellipse cx="100" cy="172" rx="56" ry="11" fill="url(#ngShadow)" />

      {/* 身体：比正圆更扁一点，底部稳，才像"坐下来"的团子 */}
      <path
        d="M100 52
           C141 52 168 80 168 114
           C168 148 138 166 100 166
           C62 166 32 148 32 114
           C32 80 59 52 100 52 Z"
        fill="url(#ngBody)"
      />

      {/* 叶柄 */}
      <path
        d="M100 54 C100 46 100 42 100 38"
        stroke="#8CAE7C"
        strokeWidth="3.2"
        strokeLinecap="round"
      />

      {/* 两片叶子：向外张开，叶子要比眼睛更显眼，不然缩小后看不见 */}
      <path
        d="M97 44 C82 40 62 32 50 18 C64 10 84 22 97 38 Z"
        fill="url(#ngLeaf)"
      />
      <path
        d="M103 44 C118 40 138 32 150 18 C136 10 116 22 103 38 Z"
        fill="url(#ngLeaf)"
      />

      {/* 腮红 */}
      <ellipse cx="60" cy="127" rx="19" ry="12" fill="url(#ngBlush)" />
      <ellipse cx="140" cy="127" rx="19" ry="12" fill="url(#ngBlush)" />

      {/* 眼睛：深棕圆点 + 一点高光 */}
      <circle cx="77" cy="112" r="6.2" fill="#4A3A2C" />
      <circle cx="123" cy="112" r="6.2" fill="#4A3A2C" />
      <circle cx="79.4" cy="109.6" r="2" fill="#FFFFFF" opacity="0.92" />
      <circle cx="125.4" cy="109.6" r="2" fill="#FFFFFF" opacity="0.92" />

      {/* 嘴：一条很浅的弧，不笑开，保持克制 */}
      <path
        d="M90 130 Q100 139 110 130"
        stroke="#4A3A2C"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
