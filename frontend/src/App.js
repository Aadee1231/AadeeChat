// src/App.js
import { useEffect, useState, useRef } from "react";
import axios from "axios";
import "./App.css";

// Default to localhost if env is missing
const API = process.env.REACT_APP_API_URL || "http://localhost:8000";

export default function App() {
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

// autoscroll ref
    const messagesRef = useRef(null);

    const scrollMessagesToBottom = () => {
    if (messagesRef.current) {
        messagesRef.current.scrollTo({
        top: messagesRef.current.scrollHeight,
        behavior: "smooth"
        });
    }
    };

    useEffect(() => {
    scrollMessagesToBottom();
    }, [messages]);

  // Load chats on start
  useEffect(() => {
    fetchChats().catch(console.error);
  }, []);

  async function fetchChats() {
    const res = await axios.get(`${API}/chats`);
    setChats(res.data || []);
    if (!activeChatId && res.data?.length) {
      await selectChat(res.data[0].id);
    }
  }

  async function selectChat(chatId) {
    setActiveChatId(chatId);
    const res = await axios.get(`${API}/chats/${chatId}/messages`);
    setMessages(res.data || []);
  }

  async function deleteChat(chatId) {
    const ok = window.confirm("Delete this chat? This can't be undone.");
    if (!ok) return;

    await axios.delete(`${API}/chats/${chatId}`);

    setChats(prev => {
      const next = prev.filter(c => c.id !== chatId);
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
    const res = await axios.post(`${API}/chats`, {
    });
    const chat = res.data;
    setChats((prev) => [chat, ...prev]);
    await selectChat(chat.id);
    return chat; // so handleSend can use it immediately
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

    // optimistic UI for user message
    setMessages((prev) => [...prev, { chat_id: chatId, role: "user", content: trimmed }]);
    setInput("");

    try {
      const res = await axios.post(`${API}/chats/${chatId}/messages`, { message: trimmed });
      const botReply = res.data.response || "";
      setMessages((prev) => [...prev, { chat_id: chatId, role: "assistant", content: botReply }]);
      fetchChats().catch(() => {}); // refresh sidebar timestamps
    } catch (err) {
      console.error("API ERROR:", err.response?.data || err.message);
      setMessages((prev) => [...prev, { role: "assistant", content: "Oops! Something went wrong." }]);
    }
  }

  return (
    <div className="app-wrap">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>AadeeChat</h2>
          <button onClick={createNewChat}>+ New Chat</button>
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
                {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : ""}
                {" "}
                {c.updated_at ? new Date(c.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
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
            .filter(m => m.role !== "system")
            .map((m, idx) => (
                <div
                key={idx}
                className={`bubble ${m.role === "user" ? "user" : (m.role || "assistant")}`}
                >
                {m.content}
                </div>
            ))}
            {!messages.length && <div className="placeholder">Say hi to start the conversation.</div>}
        </div>

        <form onSubmit={handleSend} className="input-form">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message…"
          />
          <button type="submit">Send</button>
        </form>
      </main>
    </div>
  );
}
