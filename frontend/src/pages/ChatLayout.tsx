import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import Backdrop from "../components/Backdrop";
import type { ChatHistory } from "../types";

/** 从 localStorage 恢复对话；坏数据回落为空对话 */
function readChatHistory(): ChatHistory {
  const saved = localStorage.getItem("chat_history");
  if (!saved) return [];
  try {
    return JSON.parse(saved) as ChatHistory;
  } catch {
    return [];
  }
}

export default function ChatLayout() {
  // 同理：初始值直接由初始化函数给出，不在 effect 里回写
  const [chat, setChat] = useState<ChatHistory>(readChatHistory);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate = useNavigate();

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/auth");
    }
  }, [navigate]);

  useEffect(() => {
    localStorage.setItem("chat_history", JSON.stringify(chat));
  }, [chat]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex h-screen text-stone-800 overflow-hidden"
    >
      <Backdrop />
      {/* 移动端顶栏 */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-white/80 backdrop-blur-lg border-b border-stone-200/70">
        <button onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
          <Menu />
        </button>
        <span className="text-sm font-semibold">年糕</span>
      </div>

      {/* 遮罩 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* 侧边栏 */}
      <div
        className={`
          fixed md:static z-40 md:z-20
          h-full w-64
          bg-white/45 backdrop-blur-2xl border-r border-stone-200/60
          transform transition-transform duration-300
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
          md:translate-x-0
        `}
      >
        <Sidebar
          setCurrentChat={setChat}
          closeSidebar={() => setSidebarOpen(false)}
        />
      </div>

      {/* 对话区 */}
      <div className="relative z-10 flex-1 flex flex-col pt-14 md:pt-0 min-h-0">
        <ChatWindow chat={chat} setChat={setChat} />
      </div>
    </motion.div>
  );
}
