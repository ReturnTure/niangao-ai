/**
 * SSE 增量解析器
 *
 * 后端按 `data: {"delta":"..."}\n\n` 的 JSON 帧下发，这里负责：
 * - 跨 chunk 拼接（网络分包可能把一帧切成两半）
 * - 跳过 `: ` 开头的保活注释
 * - 兼容非 JSON 的纯文本帧
 */
export function createSSEParser() {
  let buffer = "";

  /**
   * 传入一段原始文本，返回本次可解析出的完整事件数组
   * @param {string} text
   * @returns {Array<object>}
   */
  function consume(text) {
    buffer += text;

    // SSE 以空行分隔事件块，最后一段可能不完整，留到下次
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() || "";

    const events = [];

    for (const block of blocks) {
      const trimmed = block.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith(":")) continue; // keep-alive

      const dataLines = trimmed
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());

      if (!dataLines.length) continue;

      const raw = dataLines.join("\n");

      if (raw === "[DONE]") {
        events.push({ done: true });
        continue;
      }

      try {
        events.push(JSON.parse(raw));
      } catch {
        // 后端历史版本或第三方兼容实现可能直接发纯文本
        events.push({ delta: raw });
      }
    }

    return events;
  }

  return { consume };
}
