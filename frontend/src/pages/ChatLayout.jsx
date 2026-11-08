import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";

import Sidebar from "../components/Sidebar";
import ChatWindow from "../components/ChatWindow";
import Backdrop from "../components/Backdrop";

export default function ChatLayout() {
  const [chat, setChat] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate = useNavigate();

  // 路由保护
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      navigate("/auth");
    }
  }, [navigate]);

  // 恢复本地对话
  useEffect(() => {
    const saved = localStorage.getItem("chat_history");
    if (saved) {
      try {
        setChat(JSON.parse(saved));
      } catch {
        setChat([]);
      }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("chat_history", JSON.stringify(chat));
  }, [chat]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex h-screen bg-stone-950 text-white overflow-hidden"
    >
      <Backdrop variant="chat" />
      {/* 移动端顶栏 */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-stone-950 border-b border-white/10">
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
          bg-stone-950/95 backdrop-blur-xl border-r border-white/10
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
