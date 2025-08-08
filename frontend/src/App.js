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

  // autoscroll
  const messagesRef = useRef(null);
  const scrollMessagesToBottom = () => {
    if (messagesRef.current) {
      messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  };
  useEffect(() => {
    scrollMessagesToBottom();
  }, [messages]);

  // Auth bootstrap + header wiring
  useEffect(() => {
    let unsub = null;

    // initial session
    supabase.auth.getSession().then(({ data }) => {
      const s = data.session || null;
      setSession(s);
      if (s?.access_token) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${s.access_token}`;
        fetchChats().catch(console.error);
      }
    });

    // listen for changes (login/logout/refresh)
    const sub = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.access_token) {
        axios.defaults.headers.common["Authorization"] = `Bearer ${s.access_token}`;
        fetchChats().catch(console.error);
      } else {
        delete axios.defaults.headers.common["Authorization"];
        // clear UI on sign out
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
    if (!activeChatId && list.length) {
      await selectChat(list[0].id);
    }
  }

  async function selectChat(chatId) {
    setActiveChatId(chatId);
    const res = await axios.get(`/chats/${chatId}/messages`);
    setMessages(res.data || []);
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

    // optimistic user bubble
    setMessages((prev) => [...prev, { chat_id: chatId, role: "user", content: trimmed }]);
    setInput("");

    try {
      const res = await axios.post(`/chats/${chatId}/messages`, { message: trimmed });
      const botReply = res.data.response || "";
      setMessages((prev) => [...prev, { chat_id: chatId, role: "assistant", content: botReply }]);
      // refresh chat list timestamps
      fetchChats().catch(() => {});
    } catch (err) {
      console.error("API ERROR:", err.response?.data || err.message);
      setMessages((prev) => [...prev, { role: "assistant", content: "Oops! Something went wrong." }]);
    }
  }

  // 🚪 Gate the UI behind auth
  if (!session) {
    return <AuthScreen />;
  }

  return (
    <div className="app-wrap">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>AadeeChat</h2>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={createNewChat}>+ New Chat</button>
            <button onClick={() => supabase.auth.signOut()}>Sign out</button>
          </div>
        </div>

        <div className="chat-list">
          {chats.map((c) => (
            <div
              key={c.id}
              className={`chat-item ${activeChatId === c.id ? "active" : ""}`}
              onClick={() => selectChat(c.id)}
              title={c.title}
            >
              <div className="chat-title">{c.title}</div>
              <div className="chat-updated">
                {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : ""}{" "}
                {c.updated_at
                  ? new Date(c.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                  : ""}
              </div>

              <button
                className="icon-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteChat(c.id);
                }}
                title="Delete chat"
                aria-label={`Delete chat ${c.title}`}
              >
                🗑
              </button>
            </div>
          ))}
          {!chats.length && <div className="empty">No chats yet. Click “New Chat”.</div>}
        </div>
      </aside>

      <main className="chat-main">
        <div className="messages" ref={messagesRef}>
          {messages
            .filter((m) => m.role !== "system")
            .map((m, idx) => (
              <div key={idx} className={`bubble ${m.role === "user" ? "user" : (m.role || "assistant")}`}>
                {m.role === "assistant" ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ""}</ReactMarkdown>
                ) : (
                  m.content
                )}
              </div>
            ))}
          {!messages.length && <div className="placeholder">Say hi to start the conversation.</div>}
        </div>

        <form onSubmit={handleSend} className="input-form">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Type your message…" />
          <button type="submit">Send</button>
        </form>
      </main>
    </div>
  );
}
