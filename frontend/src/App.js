import { useEffect, useState } from "react";

function App() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch(`${process.env.REACT_APP_API_URL}/`)
      .then((res) => res.json())
      .then((data) => setMessage(data.message))
      .catch((err) => {
        console.error("Backend error:", err);
        setMessage("Failed to load from backend.");
      });
  }, []);

  return <h1>{message || "Loading..."}</h1>;
}

export default App;
