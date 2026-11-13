import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

const container = document.getElementById("root");
if (!container) {
  // 缺挂载点时 createRoot 会在内部抛一个很难读的错误，这里先给出明确信息
  throw new Error("找不到 #root 挂载点，检查 index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
