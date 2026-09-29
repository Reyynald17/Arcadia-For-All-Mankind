require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 8787;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Routes
app.use('/api/auth', require('./routes/auth')(supabase));
app.use('/api/agency', require('./routes/agency')(supabase));
app.use('/api/research', require('./routes/research')(supabase));
app.use('/api/production', require('./routes/production')(supabase));
app.use('/api/launch', require('./routes/launch')(supabase));
app.use('/api/dashboard', require('./routes/dashboard')(supabase));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

app.listen(PORT, () => {
  console.log(`✅ AFM Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV}`);
});

module.exports = app;