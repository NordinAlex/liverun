const express = require('express');
const path = require('path');

const app = express();
//const PORT = process.env.PORT || 3000;
const PORT = 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/message', (req, res) => {
  res.json({ message: 'Hello from the backend API! Hot Reloaded!' });
});

app.listen(PORT, () => {
  console.log(`Test app listening on port ${PORT}`);
});
