import { MessageSquarePlus, LogOut, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/index.js";

const STORAGE_KEY = "chat_sessions";

export default function Sidebar({ setCurrentChat, closeSidebar }) {
  const [chats, setChats] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
      setChats(saved);
    } catch {
      setChats([]);
    }
  }, []);

  const saveChats = (updated) => {
    setChats(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  };

  const handleNewChat = () => {
    const newChat = {
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

  const handleSelectChat = (chat) => {
    setActiveId(chat.id);
    setCurrentChat(chat.messages);
    closeSidebar?.();
  };

  const handleLogout = async () => {
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
    <div className="w-full h-full flex flex-col text-white">
      <div className="px-4 py-5 border-b border-white/10 flex items-center gap-2.5">
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
                  ? "bg-amber-500/20 text-amber-100"
                  : "hover:bg-white/5 text-stone-300"
              }`}
            >
              <p className="text-sm truncate">{c.title}</p>
            </button>
          ))
        )}
      </div>

      <div className="px-3 py-4 border-t border-white/10">
        <p className="text-[10px] text-stone-600 text-center mb-3 leading-relaxed">
          年糕是 AI 陪伴工具
          <br />
          不能替代专业心理治疗
        </p>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-stone-400 hover:text-red-400 transition"
        >
          <LogOut size={14} />
          退出登录
        </button>
      </div>
    </div>
  );
}
