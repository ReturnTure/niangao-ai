/**
 * 全站共享的数据类型
 *
 * 之前这些结构散在各个 .jsx 里靠约定维持，只要有一处字段拼错就要等运行时才炸。
 * 集中到这里后，ChatWindow / Sidebar / MessageBubble 引用的都是同一份定义。
 */

import type { StickerId } from "./sticker/catalog";

/** 消息是谁说的 */
export type MessageRole = "user" | "bot";

/** 一条对话消息 */
export interface ChatMessage {
  /** 时间戳派生（`${Date.now()}-bot` 之类），用于 React key 与定向更新 */
  id: number | string;
  role: MessageRole;
  text: string;
  /** 系统/网络错误，气泡会变红 */
  isError?: boolean;
  /** 还在流式输出，末尾显示光标 */
  isStreaming?: boolean;
  /** 后端对这一轮判定的情绪标签 */
  emotion?: string;
  /** 本轮回答引用的知识卡片标题 */
  refs?: string[];
  /** 这一条是年糕发的表情包（有值时按贴纸渲染，不看 text） */
  sticker?: StickerId;
  /** ISO 时间串，气泡下方显示 HH:mm */
  timestamp?: string;
}

/** 对话流：整个聊天窗口的状态就是一个消息数组 */
export type ChatHistory = ChatMessage[];

/** 侧边栏里的一条会话存档（存在 localStorage 的 chat_sessions） */
export interface ChatSession {
  id: number;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
}

/**
 * axios 抛出的错误里我们真正用到的部分。
 *
 * catch 到的值是 unknown，直接点 .response 编译器不让；
 * 各页面统一用这个形状做一次窄化，比到处写 any 干净。
 */
export interface ApiErrorLike {
  response?: {
    status?: number;
    /** 后端可能是 {"detail": "..."}、{"detail": [{msg}]} 或 {"message": "..."} */
    data?: {
      detail?: unknown;
      message?: unknown;
    };
  };
}
