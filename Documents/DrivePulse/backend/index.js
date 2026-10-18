const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS specifically allowing your frontend's URL
app.use(cors({
  origin: 'http://localhost:5173', // Vite's default dev server port
  credentials: true
}));

app.use(express.json());

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello from the separate backend folder!' });
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});