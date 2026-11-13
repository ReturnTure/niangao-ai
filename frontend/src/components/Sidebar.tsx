import { MessageSquarePlus, LogOut, Sparkles, BarChart3, ClipboardList } from "lucide-react";
import { motion } from "framer-motion";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import type { ChatHistory, ChatSession } from "../types";

const STORAGE_KEY = "chat_sessions";

/** 从 localStorage 恢复会话列表；坏数据一律回落为空数组 */
function readChats(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return (raw ? JSON.parse(raw) : []) as ChatSession[];
  } catch {
    return [];
  }
}

export interface SidebarProps {
  /** 切换当前对话：把某个会话的消息数组交给 ChatLayout */
  setCurrentChat: (messages: ChatHistory) => void;
  closeSidebar?: () => void;
}

export default function Sidebar({ setCurrentChat, closeSidebar }: SidebarProps) {
  // 初始值在 useState 初始化函数里读一次，不再用 effect 回写，
  // 避免挂载后立刻触发一次多余渲染
  const [chats, setChats] = useState<ChatSession[]>(readChats);
  const [activeId, setActiveId] = useState<number | null>(null);
  const navigate = useNavigate();

  const saveChats = (updated: ChatSession[]): void => {
    setChats(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleNewChat = (): void => {
    const newChat: ChatSession = {
      id: Date.now(),
      title: "新的对话",
      messages: [],
      createdAt: new Date().toISOString(),
    };

    const updated = [newChat, ...chats];
    saveChats(updated);

    setActiveId(newChat.id);
    setCurrentChat(newChat.messages);
    closeSidebar?.();
  };

  const handleSelectChat = (chat: ChatSession): void => {
    setActiveId(chat.id);
    setCurrentChat(chat.messages);
    closeSidebar?.();
  };

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post("/auth/logout");
    } catch (e) {
      console.error("Logout error:", e);
    } finally {
      localStorage.clear();
      closeSidebar?.();
      navigate("/auth");
    }
  };

  return (
    <div className="w-full h-full flex flex-col text-stone-800">
      <div className="px-4 py-5 border-b border-stone-200/70 flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-amber-300 to-orange-400 flex items-center justify-center">
          <Sparkles size={13} className="text-stone-900" />
        </div>
        <span className="text-sm font-semibold">年糕</span>
        <span className="text-[10px] text-stone-500 mt-0.5">心理陪伴</span>
      </div>

      <div className="px-3 pt-4 pb-2">
        <motion.button
          whileTap={{ scale: 0.96 }}
          whileHover={{ scale: 1.02 }}
          onClick={handleNewChat}
          className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-amber-500 to-orange-500 py-2.5 rounded-xl text-sm text-white"
        >
          <MessageSquarePlus size={15} />
          新的对话
        </motion.button>

        <button
          onClick={() => {
            closeSidebar?.();
            navigate("/report");
          }}
          className="w-full flex items-center justify-center gap-2 mt-2 py-2.5 rounded-xl text-sm text-stone-600 bg-white/85 hover:bg-amber-50 hover:border-amber-300 border border-stone-300/70 transition"
        >
          <BarChart3 size={15} className="text-amber-500" />
          情绪周报
        </button>

        <button
          onClick={() => {
            closeSidebar?.();
            navigate("/assessment");
          }}
          className="w-full flex items-center justify-center gap-2 mt-2 py-2.5 rounded-xl text-sm text-stone-600 bg-white/85 hover:bg-amber-50 hover:border-amber-300 border border-stone-300/70 transition"
        >
          <ClipboardList size={15} className="text-amber-500" />
          情绪自评
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2">
        {chats.length === 0 ? (
          <p className="text-xs text-stone-500 px-2">还没有对话记录</p>
        ) : (
          chats.map((c) => (
            <button
              key={c.id}
              onClick={() => handleSelectChat(c)}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeId === c.id
                  ? "bg-amber-100/90 text-amber-900 border border-amber-300/70"
                  : "hover:bg-white/80 text-stone-600 border border-transparent"
              }`}
            >
              <p className="text-sm truncate">{c.title}</p>
            </button>
          ))
        )}
      </div>

      <div className="px-3 py-4 border-t border-stone-200/70">
        <p className="text-[10px] text-stone-400 text-center mb-3 leading-relaxed">
          年糕是 AI 陪伴工具
          <br />
          不能替代专业心理治疗
        </p>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-stone-500 hover:text-red-500 transition"
        >
          <LogOut size={14} />
          退出登录
        </button>
      </div>
    </div>
  );
}
