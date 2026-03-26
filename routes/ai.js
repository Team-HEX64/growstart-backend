const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.post('/generate', authenticate, async (req, res) => {
  try {
    const { system, messages, max_tokens, tool } = req.body;
    const userResult = await pool.query(
      'SELECT api_key_encrypted FROM users WHERE id = $1',
      [req.userId]
    );
    const apiKey = userResult.rows[0]?.api_key_encrypted;
    if (!apiKey) {
      return res.status(400).json({ error: 'No API key set. Go to Settings to add your Anthropic API key.' });
    }
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 1024,
        system: system || '',
        messages: messages || []
      })
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'AI request failed' });
    }
    const tokensUsed = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);
    await pool.query(
      'INSERT INTO ai_usage (user_id, tool, tokens_used) VALUES ($1, $2, $3)',
      [req.userId, tool || 'general', tokensUsed]
    );
    res.json(data);
  } catch (err) {
    console.error('AI generate error:', err);
    res.status(500).json({ error: 'AI generation failed' });
  }
});

router.post('/key', authenticate, async (req, res) => {
  try {
    const { api_key } = req.body;
    if (!api_key) {
      return res.status(400).json({ error: 'API key is required' });
    }
    await pool.query(
      'UPDATE users SET api_key_encrypted = $1, updated_at = NOW() WHERE id = $2',
      [api_key, req.userId]
    );
    res.json({ message: 'API key saved' });
  } catch (err) {
    console.error('Save API key error:', err);
    res.status(500).json({ error: 'Failed to save API key' });
  }
});

router.get('/usage', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT tool, COUNT(*) as calls, SUM(tokens_used) as total_tokens FROM ai_usage WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY tool ORDER BY calls DESC",
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('AI usage error:', err);
    res.status(500).json({ error: 'Failed to fetch usage' });
  }
});

module.exports = router;
