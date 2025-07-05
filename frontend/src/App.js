import { useEffect, useState } from 'react';
import axios from 'axios';

function App() {
  const [msg, setMsg] = useState("");

  useEffect(() => {
    axios.get(`${process.env.REACT_APP_API_URL}/ping`)
      .then(res => setMsg(res.data.message))
      .catch(err => console.error(err));
  }, []);

  return (
    <div>
      <h1>Backend says: {msg}</h1>
    </div>
  );
}

export default App;
