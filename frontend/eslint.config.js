import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// 现状（全站 TS 化之后）：src 下只有 .ts/.tsx，下面这条规则匹配不到源码，
// 所以 `npm run lint` 对业务代码是空跑（ESLint 空跑同样返回 0，看着像通过）。
// 这一点已经实测确认过（eslint --format json 只返回 3 个配置文件）。
//
// 为什么补不回 TS 解析：本项目用的是 TypeScript 7（Go 原生实现），
// 实测其 JS 包已不再暴露 createSourceFile / createProgram / createScanner /
// getPreEmitDiagnostics（全部 undefined），而 typescript-eslint 解析 TSX 依赖这些接口，
// 装上也跑不起来（版本 peer 只到 <6.1.0）。
//
// 也试过方案 A（@babel/eslint-parser + @babel/preset-typescript，只做语法层）：
// 实测两轮均失败 —— 只挂 preset 时泛型（useState<T>()）解析报错、interface 成员被
// no-undef 误报；加 isTSX/allExtensions 后 preset 直接不生效，31 个文件全部 Parsing error。
// 该组合在 ESLint 10 + TypeScript 7 下没有可用的稳定配置，已卸载相关依赖，不保留半成品。
//
// 因此当前的分工是：
//   - 类型与作用域、未使用变量：`npm run typecheck`（tsc --noEmit，strict + noUnusedLocals）
//   - react-hooks 的几条规则（effect 里同步 setState、依赖数组漏项）：暂时没有自动化检查，
//     需要人工 review；此前它们在 .tsx 里报过 5 处（Sidebar / AuthPage / ChatLayout / Login / ReportPage）。
// 保留 js/jsx 段：以后若新增脚本类 .js 文件，仍然会被检查。
export default defineConfig([
  // .history 是 VS Code 的本地历史备份，不属于源码
  globalIgnores(['dist', '.history']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
])
