const express = require('express');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

const PLANS = {
  pro: { amount: 99900, name: 'Pro Plan', description: 'GrowStart AI Pro - Monthly' },
  agency: { amount: 299900, name: 'Agency Plan', description: 'GrowStart AI Agency - Monthly' }
};

router.post('/create-order', authenticate, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!PLANS[plan]) {
      return res.status(400).json({ error: 'Invalid plan. Choose pro or agency.' });
    }
    const order = await razorpay.orders.create({
      amount: PLANS[plan].amount,
      currency: 'INR',
      receipt: 'order_' + req.userId + '_' + Date.now(),
      notes: { userId: String(req.userId), plan }
    });
    await pool.query(
      'INSERT INTO payments (user_id, razorpay_order_id, amount, plan, status) VALUES ($1, $2, $3, $4, $5)',
      [req.userId, order.id, PLANS[plan].amount, plan, 'created']
    );
    res.json({
      orderId: order.id,
      amount: PLANS[plan].amount,
      currency: 'INR',
      keyId: process.env.RAZORPAY_KEY_ID,
      planName: PLANS[plan].name,
      description: PLANS[plan].description
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.post('/verify', authenticate, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' });
    }
    const body = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
      .update(body).digest('hex');
    if (expected !== razorpay_signature) {
      return res.status(400).json({ error: 'Invalid payment signature' });
    }
    const paymentResult = await pool.query(
      'UPDATE payments SET razorpay_payment_id = $1, status = $2 WHERE razorpay_order_id = $3 AND user_id = $4 RETURNING plan',
      [razorpay_payment_id, 'paid', razorpay_order_id, req.userId]
    );
    if (paymentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }
    const plan = paymentResult.rows[0].plan;
    await pool.query(
      'UPDATE users SET plan = $1, updated_at = NOW() WHERE id = $2',
      [plan, req.userId]
    );
    res.json({ message: 'Payment verified', plan });
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: 'Payment verification failed' });
  }
});

router.get('/history', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT razorpay_order_id, razorpay_payment_id, amount, currency, status, plan, created_at FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [req.userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Payment history error:', err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

module.exports = router;
