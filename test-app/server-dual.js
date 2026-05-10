const express = require('express');
const path = require('path');
const http = require('http');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/message', (req, res) => {
  res.json({ message: 'Hello from the backend API! Hot Reloaded!' });
});

// First server — main HTTP server
app.listen(PORT, () => {
  console.log(`Main app listening on port ${PORT}`);
});

// Second server — e.g. an admin panel or health check
const adminServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Admin panel');
});
adminServer.listen(4000, () => {
  console.log(`Admin server listening on port ${adminServer.address().port}`);
});
