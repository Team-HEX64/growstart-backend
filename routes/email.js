const express = require('express');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

const ses = new SESClient({ region: process.env.SES_REGION || 'ap-south-1' });

async function sendEmail(to, subject, htmlBody) {
  const command = new SendEmailCommand({
    Source: process.env.SES_FROM_EMAIL,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: subject },
      Body: { Html: { Data: htmlBody } }
    }
  });
  return ses.send(command);
}

function welcomeTemplate(name) {
  return '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">' +
    '<div style="text-align:center;padding:20px;background:linear-gradient(135deg,#0f1629,#1a2342);border-radius:12px 12px 0 0">' +
    '<h1 style="color:#fff;margin:0;font-size:24px">GrowStart <span style="color:#22c55e">AI</span></h1></div>' +
    '<div style="padding:30px;background:#fff;border:1px solid #e8ecf1">' +
    '<h2 style="color:#1a1a2e;margin-top:0">Welcome to GrowStart AI! 🎉</h2>' +
    '<p style="color:#444;line-height:1.7">Hi ' + name + ',</p>' +
    '<p style="color:#444;line-height:1.7">Thank you for signing up! Your AI-powered marketing dashboard is ready.</p>' +
    '<p style="color:#444;line-height:1.7">Here\'s what you can do right away:</p>' +
    '<ul style="color:#444;line-height:2">' +
    '<li>✍️ Generate social media content in seconds</li>' +
    '<li>👥 Manage your lead pipeline</li>' +
    '<li>⭐ Create AI-powered review replies</li>' +
    '<li>📱 Build WhatsApp campaigns</li>' +
    '<li>📧 Create email marketing campaigns</li></ul>' +
    '<a href="https://growstart.ai/app.html" style="display:inline-block;padding:14px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-top:10px">Open Dashboard →</a>' +
    '</div>' +
    '<div style="padding:20px;text-align:center;color:#888;font-size:12px;background:#fafbfc;border-radius:0 0 12px 12px;border:1px solid #e8ecf1;border-top:0">' +
    '<p>GrowStart AI — AI-powered marketing for Indian local businesses</p>' +
    '<p><a href="https://growstart.ai/terms.html" style="color:#888">Terms</a> · <a href="https://growstart.ai/privacy.html" style="color:#888">Privacy</a> · <a href="https://growstart.ai/contact.html" style="color:#888">Contact</a></p></div></div>';
}

function paymentTemplate(name, plan, amount) {
  return '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">' +
    '<div style="text-align:center;padding:20px;background:linear-gradient(135deg,#0f1629,#1a2342);border-radius:12px 12px 0 0">' +
    '<h1 style="color:#fff;margin:0;font-size:24px">GrowStart <span style="color:#22c55e">AI</span></h1></div>' +
    '<div style="padding:30px;background:#fff;border:1px solid #e8ecf1">' +
    '<h2 style="color:#1a1a2e;margin-top:0">Payment Confirmed! ✅</h2>' +
    '<p style="color:#444;line-height:1.7">Hi ' + name + ',</p>' +
    '<p style="color:#444;line-height:1.7">Your payment has been processed successfully.</p>' +
    '<div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:16px 0">' +
    '<p style="margin:4px 0;color:#444"><strong>Plan:</strong> ' + plan.toUpperCase() + '</p>' +
    '<p style="margin:4px 0;color:#444"><strong>Amount:</strong> ₹' + amount + '</p>' +
    '<p style="margin:4px 0;color:#444"><strong>Date:</strong> ' + new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) + '</p></div>' +
    '<p style="color:#444;line-height:1.7">Your account has been upgraded. Enjoy all the premium features!</p>' +
    '<a href="https://growstart.ai/app.html" style="display:inline-block;padding:14px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-top:10px">Open Dashboard →</a>' +
    '</div>' +
    '<div style="padding:20px;text-align:center;color:#888;font-size:12px;background:#fafbfc;border-radius:0 0 12px 12px;border:1px solid #e8ecf1;border-top:0">' +
    '<p>GrowStart AI — AI-powered marketing for Indian local businesses</p></div></div>';
}

function bookingTemplate(name, booking) {
  return '<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:20px">' +
    '<div style="text-align:center;padding:20px;background:linear-gradient(135deg,#0f1629,#1a2342);border-radius:12px 12px 0 0">' +
    '<h1 style="color:#fff;margin:0;font-size:24px">GrowStart <span style="color:#22c55e">AI</span></h1></div>' +
    '<div style="padding:30px;background:#fff;border:1px solid #e8ecf1">' +
    '<h2 style="color:#1a1a2e;margin-top:0">Booking Confirmed! 📅</h2>' +
    '<p style="color:#444;line-height:1.7">Hi ' + name + ',</p>' +
    '<p style="color:#444;line-height:1.7">A new booking has been confirmed:</p>' +
    '<div style="background:#f8f9fa;padding:16px;border-radius:8px;margin:16px 0">' +
    '<p style="margin:4px 0;color:#444"><strong>Customer:</strong> ' + (booking.customer_name || '-') + '</p>' +
    '<p style="margin:4px 0;color:#444"><strong>Service:</strong> ' + (booking.service || '-') + '</p>' +
    '<p style="margin:4px 0;color:#444"><strong>Date:</strong> ' + (booking.date || '-') + '</p>' +
    '<p style="margin:4px 0;color:#444"><strong>Time:</strong> ' + (booking.time || '-') + '</p></div>' +
    '<a href="https://growstart.ai/app.html" style="display:inline-block;padding:14px 28px;background:#22c55e;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-top:10px">View in Dashboard →</a>' +
    '</div></div>';
}

router.post('/send-welcome', authenticate, async (req, res) => {
  try {
    const user = await pool.query('SELECT email, business_name FROM users WHERE id = $1', [req.userId]);
    const { email, business_name } = user.rows[0];
    await sendEmail(email, 'Welcome to GrowStart AI! 🎉', welcomeTemplate(business_name || 'there'));
    res.json({ message: 'Welcome email sent' });
  } catch (err) {
    console.error('Welcome email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

router.post('/send-payment-receipt', authenticate, async (req, res) => {
  try {
    const { plan, amount } = req.body;
    const user = await pool.query('SELECT email, business_name FROM users WHERE id = $1', [req.userId]);
    const { email, business_name } = user.rows[0];
    await sendEmail(email, 'Payment Confirmed — GrowStart AI ✅', paymentTemplate(business_name || 'there', plan, amount));
    res.json({ message: 'Receipt sent' });
  } catch (err) {
    console.error('Payment receipt error:', err);
    res.status(500).json({ error: 'Failed to send receipt' });
  }
});

router.post('/send-booking-confirmation', authenticate, async (req, res) => {
  try {
    const { booking } = req.body;
    const user = await pool.query('SELECT email, business_name FROM users WHERE id = $1', [req.userId]);
    const { email, business_name } = user.rows[0];
    await sendEmail(email, 'New Booking Confirmed — GrowStart AI 📅', bookingTemplate(business_name || 'there', booking));
    res.json({ message: 'Booking confirmation sent' });
  } catch (err) {
    console.error('Booking email error:', err);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

module.exports = { router, sendEmail, welcomeTemplate, paymentTemplate };
