import { requireAuth } from './_lib/auth.js';

// Proxies Google Places Autocomplete so the location box can suggest places the
// way Google Maps does — without ever exposing the API key to the browser.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAuth(req, res);
  if (!session) return;

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return res.status(500).json({ error: 'GOOGLE_MAPS_API_KEY is not configured on the server' });

  const input = (req.query?.input || '').trim();
  if (input.length < 3) return res.status(200).json({ suggestions: [] });

  try {
    const r = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': 'suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat',
      },
      // No `includedPrimaryTypes`: employees search anything from a city down to
      // a single neighbourhood ("Gulshan 2, Dhaka").
      body: JSON.stringify({ input, languageCode: 'en' }),
    });

    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { msg = (await r.json())?.error?.message || msg; } catch {}
      return res.status(502).json({ error: `Autocomplete: ${msg}` });
    }

    const j = await r.json();
    const suggestions = (j.suggestions || [])
      .map(s => s.placePrediction)
      .filter(Boolean)
      .map(p => ({
        text: p.text?.text || '',
        main: p.structuredFormat?.mainText?.text || p.text?.text || '',
        secondary: p.structuredFormat?.secondaryText?.text || '',
      }))
      .filter(s => s.text);

    // Autocomplete is billed per request; let the browser reuse identical inputs.
    res.setHeader('Cache-Control', 'private, max-age=120');
    return res.status(200).json({ suggestions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
