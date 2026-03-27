const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.post('/signup', async (req, res) => {
  try {
    const { email, password, business_name, business_type, phone, city } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash, business_name, business_type, phone, city) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, plan',
      [email, password_hash, business_name, business_type, phone, city]
    );
    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, plan: user.plan }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ token, user: { id: user.id, email: user.email, plan: user.plan } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const result = await pool.query(
      'SELECT id, email, password_hash, plan, business_name, business_type, phone, city FROM users WHERE email = $1',
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user.id, plan: user.plan }, process.env.JWT_SECRET, { expiresIn: '30d' });
    res.json({
      token,
      user: {
        id: user.id, email: user.email, plan: user.plan,
        business_name: user.business_name, business_type: user.business_type,
        phone: user.phone, city: user.city
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/profile', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, plan, business_name, business_type, phone, city, created_at FROM users WHERE id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

router.put('/profile', authenticate, async (req, res) => {
  try {
    const { business_name, business_type, phone, city } = req.body;
    const result = await pool.query(
      'UPDATE users SET business_name = $1, business_type = $2, phone = $3, city = $4, updated_at = NOW() WHERE id = $5 RETURNING id, email, plan, business_name, business_type, phone, city',
      [business_name, business_type, phone, city, req.userId]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update profile error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

router.get('/google-login', (req, res) => {
  const { google } = require('googleapis');
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI.replace('/google/callback', '/google-login/callback')
  );
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/userinfo.email', 'https://www.googleapis.com/auth/userinfo.profile'],
    prompt: 'consent'
  });
  res.json({ url });
});

router.get('/google-login/callback', async (req, res) => {
  try {
    const { google } = require('googleapis');
    const { code } = req.query;
    if (!code) return res.redirect(process.env.FRONTEND_URL + '/app.html?auth=error');

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI.replace('/google/callback', '/google-login/callback')
    );
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data } = await oauth2.userinfo.get();

    let user = await pool.query('SELECT id, email, plan, business_name, business_type, phone, city FROM users WHERE email = $1', [data.email]);

    if (user.rows.length === 0) {
      const bcrypt = require('bcryptjs');
      const randomPass = require('crypto').randomBytes(16).toString('hex');
      const hash = await bcrypt.hash(randomPass, 10);
      user = await pool.query(
        'INSERT INTO users (email, password_hash, business_name, google_token, google_refresh_token) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, plan, business_name, business_type, phone, city',
        [data.email, hash, data.name || '', tokens.access_token, tokens.refresh_token]
      );
    } else {
      await pool.query(
        'UPDATE users SET google_token = $1, google_refresh_token = COALESCE($2, google_refresh_token), updated_at = NOW() WHERE email = $3',
        [tokens.access_token, tokens.refresh_token, data.email]
      );
    }

    const u = user.rows[0];
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ userId: u.id, plan: u.plan }, process.env.JWT_SECRET, { expiresIn: '30d' });

    const userData = encodeURIComponent(JSON.stringify({ id: u.id, email: u.email, plan: u.plan, business_name: u.business_name, business_type: u.business_type, phone: u.phone, city: u.city }));
    res.redirect(process.env.FRONTEND_URL + '/app.html?auth=success&token=' + token + '&user=' + userData);
  } catch (err) {
    console.error('Google login error:', err);
    res.redirect(process.env.FRONTEND_URL + '/app.html?auth=error');
  }
});

module.exports = router;
