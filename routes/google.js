const express = require('express');
const { google } = require('googleapis');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

router.get('/connect', authenticate, (req, res) => {
  const oauth2Client = getOAuth2Client();
  const scopes = [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/analytics.readonly'
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
    state: String(req.userId)
  });
  res.json({ url });
});

router.get('/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state;
    if (!code || !userId) {
      return res.redirect(process.env.FRONTEND_URL + '?google=error');
    }
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    await pool.query(
      'UPDATE users SET google_token = $1, google_refresh_token = $2, updated_at = NOW() WHERE id = $3',
      [tokens.access_token, tokens.refresh_token, userId]
    );
    res.redirect(process.env.FRONTEND_URL + '?google=success');
  } catch (err) {
    console.error('Google callback error:', err);
    res.redirect(process.env.FRONTEND_URL + '?google=error');
  }
});

router.get('/analytics', authenticate, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT google_token, google_refresh_token FROM users WHERE id = $1',
      [req.userId]
    );
    const user = userResult.rows[0];
    if (!user.google_token) {
      return res.status(400).json({ error: 'Google not connected' });
    }
    const oauth2Client = getOAuth2Client();
    oauth2Client.setCredentials({
      access_token: user.google_token,
      refresh_token: user.google_refresh_token
    });
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await pool.query(
          'UPDATE users SET google_token = $1, updated_at = NOW() WHERE id = $2',
          [tokens.access_token, req.userId]
        );
      }
    });
    const analyticsData = google.analyticsdata({ version: 'v1beta', auth: oauth2Client });
    const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth: oauth2Client });
    const accounts = await analyticsAdmin.accountSummaries.list();
    const properties = accounts.data.accountSummaries?.[0]?.propertySummaries || [];
    if (properties.length === 0) {
      return res.json({ error: 'No GA4 properties found' });
    }
    const propertyId = properties[0].property.split('/')[1];
    const report = await analyticsData.properties.runReport({
      property: 'properties/' + propertyId,
      requestBody: {
        dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
        metrics: [
          { name: 'activeUsers' },
          { name: 'sessions' },
          { name: 'screenPageViews' }
        ],
        dimensions: [{ name: 'date' }],
        orderBys: [{ dimension: { dimensionName: 'date' } }]
      }
    });
    res.json({
      propertyId,
      propertyName: properties[0].displayName,
      rows: report.data.rows || []
    });
  } catch (err) {
    console.error('Analytics error:', err);
    if (err.code === 401) {
      return res.status(401).json({ error: 'Google session expired. Please reconnect.' });
    }
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

router.delete('/disconnect', authenticate, async (req, res) => {
  try {
    await pool.query(
      'UPDATE users SET google_token = NULL, google_refresh_token = NULL, updated_at = NOW() WHERE id = $1',
      [req.userId]
    );
    res.json({ message: 'Google disconnected' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

module.exports = router;
