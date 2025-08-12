// src/App.js
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import "./App.css";
import { supabase } from "./supabase";
import AuthScreen from "./AuthScreen";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// set baseURL once; auth header added after login
axios.defaults.baseURL = process.env.REACT_APP_API_URL;

export default function App() {
  const [session, setSession] = useState(null);
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "dark");
  const [isThinking, setIsThinking] = useState(false);

  // theme
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("theme", theme);
  }, [theme]);

  // autoscroll
  const messagesRef = useRef(null);
  const scrollMessagesToBottom = () => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
    }
  };
  useEffect(() => { scrollMessagesToBottom(); }, [messages]);

  // Auth bootstrap + header wiring
  useEffect(() => {
    let unsub = null;

    supabase.auth.getSession().then(({ data }) => {
      const s = data.session || null;
      setSession(s);
      if (s?.access_token) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${s.access_token}`;
        fetchChats().catch(console.error);
      }
    });

    const sub = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.access_token) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${s.access_token}`;
        fetchChats().catch(console.error);
      } else {
        delete axios.defaults.headers.common["Authorization"];
        setChats([]);
        setActiveChatId(null);
        setMessages([]);
      }
    });

    unsub = sub?.data?.subscription;
    return () => unsub?.unsubscribe();
  }, []);

  // Fetch chats (requires auth)
  async function fetchChats() {
    const res = await axios.get("/chats");
    const list = res.data || [];
    setChats(list);
    if (!activeChatId && list.length) await selectChat(list[0].id);
  }

  async function selectChat(chatId) {
    setActiveChatId(chatId);
    const res = await axios.get(`/chats/${chatId}/messages`);
    setMessages(res.data || []);
    setSidebarOpen(false); // close drawer on mobile
  }

  async function deleteChat(chatId) {
    const ok = window.confirm("Delete this chat? This can't be undone.");
    if (!ok) return;
    await axios.delete(`/chats/${chatId}`);
    setChats((prev) => {
      const next = prev.filter((c) => c.id !== chatId);
      if (activeChatId === chatId) {
        if (next.length) {
          const nextId = next[0].id;
          setActiveChatId(nextId);
          selectChat(nextId);
        } else {
          setActiveChatId(null);
          setMessages([]);
        }
      }
      return next;
    });
  }

  async function createNewChat() {
    const res = await axios.post("/chats", {});
    const chat = res.data;
    setChats((prev) => [chat, ...prev]);
    await selectChat(chat.id);
    return chat;
  }

  async function handleSend(e) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;

    let chatId = activeChatId;
    if (!chatId) {
      const newChat = await createNewChat();
      chatId = newChat.id;
    }

    setMessages((prev) => [...prev, { chat_id: chatId, role: "user", content: trimmed }]);
    setInput("");

    setIsThinking(true);

    try {
      const res = await axios.post(`/chats/${chatId}/messages`, { message: trimmed });
      const botReply = res.data.response || "";
      setMessages((prev) => [...prev, { chat_id: chatId, role: "assistant", content: botReply }]);
      fetchChats().catch(() => {});
      setIsThinking(false);
    } catch (err) {
      console.error("API ERROR:", err.response?.data || err.message);
      setMessages((prev) => [...prev, { role: "assistant", content: "Oops! Something went wrong." }]);
      setIsThinking(false);
    }
  }

  if (!session) return <AuthScreen />;

  return (
    <div className="app-wrap">
      {/* Top bar (mobile) */}
      <header className="topbar">
        <button className="icon-btn ghost" onClick={() => setSidebarOpen(true)} aria-label="Open menu">☰</button>
        <div className="brand">
          <div className="logo-dot" aria-hidden />
          <span>AadeeChat</span>
        </div>
        <div className="topbar-actions">
          <button className="icon-btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">🌓</button>
        </div>
      </header>

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="sidebar-header">
          <div className="brand">
            <div className="logo-dot" aria-hidden />
            <h2>AadeeChat</h2>
          </div>
         <div className="sidebar-actions">
            <button className="btn primary pill" onClick={createNewChat}>+ New Chat</button>
            <button className="btn primary pill" onClick={() => supabase.auth.signOut()}>Sign out</button>
            <button className="icon-btn ghost close" onClick={() => setSidebarOpen(false)} aria-label="Close menu">✕</button>
         </div>
        </div>

        <div className="chat-list">
          {chats.map((c) => (
            <div
              key={c.id}
              className={`chat-item ${activeChatId === c.id ? "active" : ""}`}
              onClick={() => selectChat(c.id)}
              title={c.title}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && selectChat(c.id)}
            >
              <div className="chat-title">{c.title}</div>
              <div className="chat-meta">
                {c.updated_at
                  ? new Date(c.updated_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
                  : ""}
              </div>
              <button
                className="icon-btn trash"
                onClick={(e) => { e.stopPropagation(); deleteChat(c.id); }}
                title="Delete chat" aria-label={`Delete chat ${c.title}`}
              >🗑</button>
            </div>
          ))}
          {!chats.length && <div className="empty">No chats yet. Tap “New Chat”.</div>}
        </div>
      </aside>

      {/* Main */}
      <main className="chat-main">
        <div className="messages" ref={messagesRef}>
          {messages.filter((m) => m.role !== "system").map((m, idx) => (
            <div key={idx} className={`bubble ${m.role === "user" ? "user" : (m.role || "assistant")}`}>
              {m.role === "assistant"
                ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ""}</ReactMarkdown>
                : m.content}
            </div>
          ))}
          
          {isThinking && (
            <div className="bubble assistant thinking-bubble">
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
                <span className="thinking-dot"></span>
            </div>
          )}

          {!messages.length && <div className="placeholder">Say hi to start the conversation.</div>}
        </div>

        <form onSubmit={handleSend} className="input-form">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
            aria-label="Message input"
          />
          <button type="submit" className="btn primary">Send</button>
        </form>
      </main>

      {/* Backdrop for mobile drawer */}
      {sidebarOpen && <div className="backdrop" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}
