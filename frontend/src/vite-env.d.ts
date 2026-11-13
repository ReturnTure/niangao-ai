/// <reference types="vite/client" />

// 前端用到的环境变量在这里声明，让 import.meta.env 有类型提示。
// 新增变量时补一行，否则 TS 会认为它不存在。
interface ImportMetaEnv {
  /** 后端地址，留空时回落到 http://127.0.0.1:8000 */
  readonly VITE_API_URL_LINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
