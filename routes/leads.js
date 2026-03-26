const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, score } = req.query;
    let query = 'SELECT * FROM leads WHERE user_id = $1';
    const params = [req.userId];
    if (status) {
      params.push(status);
      query += ' AND status = $' + params.length;
    }
    if (score) {
      params.push(score);
      query += ' AND score = $' + params.length;
    }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get leads error:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { name, phone, email, status, score, interested_in, source, notes } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    const result = await pool.query(
      'INSERT INTO leads (user_id, name, phone, email, status, score, interested_in, source, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [req.userId, name, phone, email, status || 'new', score || 'cold', interested_in, source || 'manual', notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create lead error:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { name, phone, email, status, score, interested_in, notes } = req.body;
    const result = await pool.query(
      'UPDATE leads SET name = $1, phone = $2, email = $3, status = $4, score = $5, interested_in = $6, notes = $7, updated_at = NOW() WHERE id = $8 AND user_id = $9 RETURNING *',
      [name, phone, email, status, score, interested_in, notes, req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update lead error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM leads WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    res.json({ message: 'Lead deleted' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
