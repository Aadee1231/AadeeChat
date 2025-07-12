import { useState } from "react";
import axios from "axios";
import "./App.css";

function App() {
  const [messages, setMessages] = useState([
    { sender: "assistant", text: "Hi! Ask me anything." },
  ]);
  const [input, setInput] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!input.trim()) return;

    // Add user message to chat
    const newMessages = [...messages, { sender: "user", text: input }];
    setMessages(newMessages);
    setInput("");

    console.log("API URL:", process.env.REACT_APP_API_URL);


    try {
      // Send to backend /chat endpoint
      const res = await axios.post(
        `${process.env.REACT_APP_API_URL}/chat`,
        { message: input }
      );
      const botReply = res.data.response;

      setMessages((prev) => [...prev, { sender: "assistant", text: botReply }]);
    } catch (err) {
      console.error("API ERROR:", err.response?.data || err.message);
      setMessages((prev) => [
        ...prev,
        { sender: "assistant", text: "Oops! Something went wrong." },
      ]);
    }
  };

  return (
    <div className="chat-container">
      <h1>AadeeChat</h1>
      <div className="messages">
        {messages.map((m, idx) => (
          <div key={idx} className={`bubble ${m.sender}`}>
            {m.text}
          </div>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="input-form">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type your message..."
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}

export default App;
