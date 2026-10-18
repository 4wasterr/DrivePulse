import { useState, useEffect } from 'react'
import './App.css'

function App() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('http://localhost:5000/api/hello')
      .then((res) => res.json())
      .then((data) => setMessage(data.message))
      .catch((err) => console.error('Error fetching data:', err));
  }, []);

  return (
    <div style={{ textAlign: 'center', marginTop: '50px' }}>
      <h1>Separated Frontend & Backend</h1>
      <p>Server says: <strong>{message || 'Connecting...'}</strong></p>
    </div>
  );
}

export default App;