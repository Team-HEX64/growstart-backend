const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

router.get('/', authenticate, async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM bookings WHERE user_id = $1';
    const params = [req.userId];
    if (status) {
      params.push(status);
      query += ' AND status = $' + params.length;
    }
    query += ' ORDER BY date DESC, time DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get bookings error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const { customer_name, phone, service, date, time, lead_id, notes } = req.body;
    if (!customer_name) {
      return res.status(400).json({ error: 'Customer name is required' });
    }
    const result = await pool.query(
      'INSERT INTO bookings (user_id, lead_id, customer_name, phone, service, date, time, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [req.userId, lead_id, customer_name, phone, service, date, time, notes]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create booking error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

router.put('/:id', authenticate, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const result = await pool.query(
      'UPDATE bookings SET status = $1, notes = $2 WHERE id = $3 AND user_id = $4 RETURNING *',
      [status, notes, req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Update booking error:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'DELETE FROM bookings WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json({ message: 'Booking deleted' });
  } catch (err) {
    console.error('Delete booking error:', err);
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

module.exports = router;
