const express = require('express');
const pool = require('../db');
const authenticate = require('../middleware/auth');
const router = express.Router();

// Get business profile
router.get('/', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM business_profiles WHERE user_id = $1',
      [req.userId]
    );
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Get profile error:', err);
    res.status(500).json({ error: 'Failed to fetch business profile' });
  }
});

// Save/update business profile (manual)
router.post('/', authenticate, async (req, res) => {
  try {
    const { services, pricing, business_hours, address, about, usp,
            target_customers, languages, current_offers, faqs, website_url } = req.body;

    const existing = await pool.query('SELECT id FROM business_profiles WHERE user_id = $1', [req.userId]);

    if (existing.rows.length > 0) {
      const result = await pool.query(
        `UPDATE business_profiles SET services = $1, pricing = $2, business_hours = $3,
         address = $4, about = $5, usp = $6, target_customers = $7, languages = $8,
         current_offers = $9, faqs = $10, website_url = $11, updated_at = NOW()
         WHERE user_id = $12 RETURNING *`,
        [services, pricing, business_hours, address, about, usp,
         target_customers, languages, current_offers, faqs, website_url, req.userId]
      );
      res.json(result.rows[0]);
    } else {
      const result = await pool.query(
        `INSERT INTO business_profiles (user_id, services, pricing, business_hours, address,
         about, usp, target_customers, languages, current_offers, faqs, website_url, training_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual') RETURNING *`,
        [req.userId, services, pricing, business_hours, address, about, usp,
         target_customers, languages, current_offers, faqs, website_url]
      );
      res.status(201).json(result.rows[0]);
    }
  } catch (err) {
    console.error('Save profile error:', err);
    res.status(500).json({ error: 'Failed to save business profile' });
  }
});

// Extract from website URL
router.post('/extract-website', authenticate, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    // Get user's API key for AI extraction
    const userResult = await pool.query('SELECT api_key_encrypted, business_name, business_type FROM users WHERE id = $1', [req.userId]);
    const apiKey = userResult.rows[0]?.api_key_encrypted;
    const bizName = userResult.rows[0]?.business_name || '';
    const bizType = userResult.rows[0]?.business_type || '';

    // Fetch website content
    let pageContent = '';
    try {
      const fetchRes = await fetch(url, {
        headers: { 'User-Agent': 'GrowStart AI Bot/1.0' },
        signal: AbortSignal.timeout(10000)
      });
      const html = await fetchRes.text();
      // Strip HTML tags, keep text
      pageContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 8000);
    } catch (fetchErr) {
      return res.status(400).json({ error: 'Could not fetch website. Please check the URL.' });
    }

    if (!pageContent || pageContent.length < 50) {
      return res.status(400).json({ error: 'Could not extract meaningful content from the website.' });
    }

    // Use AI to extract structured data
    const systemPrompt = `You are a business data extraction expert. Extract business information from website content and return ONLY a JSON object with these fields:
{
  "services": "comma-separated list of services offered",
  "pricing": "service and price pairs, e.g. Haircut - Rs 200, Facial - Rs 500",
  "business_hours": "operating hours, e.g. Mon-Sat 10 AM - 8 PM",
  "address": "full business address",
  "about": "brief description of the business in 2-3 sentences",
  "usp": "unique selling points, what makes this business special",
  "target_customers": "who are the typical customers",
  "languages": "languages the business operates in",
  "current_offers": "any current promotions or discounts mentioned",
  "faqs": "common questions and answers if found"
}
If a field is not found, use an empty string. Return ONLY valid JSON, no markdown.`;

    let extractedData;

    if (apiKey) {
      // Use user's API key
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: systemPrompt,
          messages: [{ role: 'user', content: 'Extract business information from this website content for "' + bizName + '" (' + bizType + '):\n\n' + pageContent }]
        })
      });
      const aiData = await aiRes.json();
      const text = aiData.content?.[0]?.text || '{}';
      try {
        extractedData = JSON.parse(text.replace(/```json|```/g, '').trim());
      } catch (e) {
        extractedData = {};
      }
    } else {
      // Demo extraction — basic pattern matching
      extractedData = {
        services: '',
        pricing: '',
        business_hours: '',
        address: '',
        about: pageContent.substring(0, 200),
        usp: '',
        target_customers: '',
        languages: '',
        current_offers: '',
        faqs: ''
      };

      // Try to find phone numbers
      const phoneMatch = pageContent.match(/(\+91|91)?[\s-]?[6-9]\d{4}[\s-]?\d{5}/);
      // Try to find timing patterns
      const timeMatch = pageContent.match(/\d{1,2}\s*(am|pm|AM|PM)\s*[-–to]+\s*\d{1,2}\s*(am|pm|AM|PM)/);
      if (timeMatch) extractedData.business_hours = timeMatch[0];
    }

    // Save extracted data
    const existing = await pool.query('SELECT id FROM business_profiles WHERE user_id = $1', [req.userId]);

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE business_profiles SET services = COALESCE(NULLIF($1, ''), services),
         pricing = COALESCE(NULLIF($2, ''), pricing), business_hours = COALESCE(NULLIF($3, ''), business_hours),
         address = COALESCE(NULLIF($4, ''), address), about = COALESCE(NULLIF($5, ''), about),
         usp = COALESCE(NULLIF($6, ''), usp), target_customers = COALESCE(NULLIF($7, ''), target_customers),
         languages = COALESCE(NULLIF($8, ''), languages), current_offers = COALESCE(NULLIF($9, ''), current_offers),
         faqs = COALESCE(NULLIF($10, ''), faqs), website_url = $11,
         raw_extracted_data = $12, training_method = 'website', updated_at = NOW()
         WHERE user_id = $13`,
        [extractedData.services, extractedData.pricing, extractedData.business_hours,
         extractedData.address, extractedData.about, extractedData.usp,
         extractedData.target_customers, extractedData.languages,
         extractedData.current_offers, extractedData.faqs, url,
         JSON.stringify(extractedData), req.userId]
      );
    } else {
      await pool.query(
        `INSERT INTO business_profiles (user_id, services, pricing, business_hours, address,
         about, usp, target_customers, languages, current_offers, faqs, website_url,
         raw_extracted_data, training_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'website')`,
        [req.userId, extractedData.services, extractedData.pricing, extractedData.business_hours,
         extractedData.address, extractedData.about, extractedData.usp,
         extractedData.target_customers, extractedData.languages,
         extractedData.current_offers, extractedData.faqs, url,
         JSON.stringify(extractedData)]
      );
    }

    res.json({ extracted: extractedData, message: 'Website data extracted successfully!' });
  } catch (err) {
    console.error('Extract website error:', err);
    res.status(500).json({ error: 'Failed to extract website data' });
  }
});

// Extract from uploaded photo
router.post('/extract-photo', authenticate, async (req, res) => {
  try {
    const { image_base64, image_type } = req.body;
    if (!image_base64) return res.status(400).json({ error: 'Image is required' });

    const userResult = await pool.query('SELECT api_key_encrypted, business_name, business_type FROM users WHERE id = $1', [req.userId]);
    const apiKey = userResult.rows[0]?.api_key_encrypted;
    const bizName = userResult.rows[0]?.business_name || '';
    const bizType = userResult.rows[0]?.business_type || '';

    if (!apiKey) {
      return res.status(400).json({ error: 'API key required for photo extraction. Add your Anthropic API key in Settings.' });
    }

    const systemPrompt = `You are a business data extraction expert. Extract business information from this image (which may be a price list, menu card, business card, brochure, or signboard) and return ONLY a JSON object with these fields:
{
  "services": "comma-separated list of services found",
  "pricing": "service and price pairs found, e.g. Haircut - Rs 200, Facial - Rs 500",
  "business_hours": "operating hours if visible",
  "address": "address if visible",
  "about": "any description or tagline visible",
  "usp": "any unique selling points mentioned",
  "target_customers": "infer from services/pricing who the target is",
  "languages": "languages visible in the image",
  "current_offers": "any offers or discounts visible",
  "faqs": ""
}
If a field is not found in the image, use an empty string. Return ONLY valid JSON.`;

    const mediaType = image_type || 'image/jpeg';

    const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: image_base64 } },
            { type: 'text', text: 'Extract all business information from this image for "' + bizName + '" (' + bizType + '). This may be a price list, menu, business card, brochure, or signboard.' }
          ]
        }]
      })
    });

    const aiData = await aiRes.json();
    const text = aiData.content?.[0]?.text || '{}';
    let extractedData;
    try {
      extractedData = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch (e) {
      extractedData = { about: text.substring(0, 500) };
    }

    // Save extracted data (merge with existing)
    const existing = await pool.query('SELECT id FROM business_profiles WHERE user_id = $1', [req.userId]);

    if (existing.rows.length > 0) {
      await pool.query(
        `UPDATE business_profiles SET services = COALESCE(NULLIF($1, ''), services),
         pricing = COALESCE(NULLIF($2, ''), pricing), business_hours = COALESCE(NULLIF($3, ''), business_hours),
         address = COALESCE(NULLIF($4, ''), address), about = COALESCE(NULLIF($5, ''), about),
         usp = COALESCE(NULLIF($6, ''), usp), target_customers = COALESCE(NULLIF($7, ''), target_customers),
         languages = COALESCE(NULLIF($8, ''), languages), current_offers = COALESCE(NULLIF($9, ''), current_offers),
         faqs = COALESCE(NULLIF($10, ''), faqs),
         raw_extracted_data = $11, training_method = 'photo', updated_at = NOW()
         WHERE user_id = $12`,
        [extractedData.services, extractedData.pricing, extractedData.business_hours,
         extractedData.address, extractedData.about, extractedData.usp,
         extractedData.target_customers, extractedData.languages,
         extractedData.current_offers, extractedData.faqs,
         JSON.stringify(extractedData), req.userId]
      );
    } else {
      await pool.query(
        `INSERT INTO business_profiles (user_id, services, pricing, business_hours, address,
         about, usp, target_customers, languages, current_offers, faqs,
         raw_extracted_data, training_method)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'photo')`,
        [req.userId, extractedData.services, extractedData.pricing, extractedData.business_hours,
         extractedData.address, extractedData.about, extractedData.usp,
         extractedData.target_customers, extractedData.languages,
         extractedData.current_offers, extractedData.faqs,
         JSON.stringify(extractedData)]
      );
    }

    res.json({ extracted: extractedData, message: 'Photo data extracted successfully!' });
  } catch (err) {
    console.error('Extract photo error:', err);
    res.status(500).json({ error: 'Failed to extract photo data' });
  }
});

// Get AI context (used by all AI tools internally)
router.get('/ai-context', authenticate, async (req, res) => {
  try {
    const userResult = await pool.query(
      'SELECT business_name, business_type, phone, city FROM users WHERE id = $1',
      [req.userId]
    );
    const profileResult = await pool.query(
      'SELECT * FROM business_profiles WHERE user_id = $1',
      [req.userId]
    );

    const user = userResult.rows[0] || {};
    const profile = profileResult.rows[0] || {};

    let context = `Business: "${user.business_name || 'My Business'}", a ${user.business_type || 'local business'} in ${user.city || 'India'}.`;

    if (profile.services) context += `\nServices: ${profile.services}`;
    if (profile.pricing) context += `\nPricing: ${profile.pricing}`;
    if (profile.business_hours) context += `\nHours: ${profile.business_hours}`;
    if (profile.address) context += `\nAddress: ${profile.address}`;
    if (profile.about) context += `\nAbout: ${profile.about}`;
    if (profile.usp) context += `\nUSP: ${profile.usp}`;
    if (profile.target_customers) context += `\nTarget Customers: ${profile.target_customers}`;
    if (profile.languages) context += `\nLanguages: ${profile.languages}`;
    if (profile.current_offers) context += `\nCurrent Offers: ${profile.current_offers}`;
    if (profile.faqs) context += `\nFAQs: ${profile.faqs}`;

    res.json({ context });
  } catch (err) {
    console.error('AI context error:', err);
    res.status(500).json({ error: 'Failed to get AI context' });
  }
});

module.exports = router;
