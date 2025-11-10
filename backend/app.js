// backend/app.js
const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/users', require('./routes/users'));

// Server
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
