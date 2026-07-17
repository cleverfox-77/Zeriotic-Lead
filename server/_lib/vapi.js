import crypto from 'node:crypto';

/**
 * Vapi hosts the live phone call (telephony + STT + LLM + TTS) and calls our
 * webhooks. We create each call with a *transient* assistant so every call
 * carries the lead's context and the caller's trained persona/voice — nothing
 * to keep in sync on Vapi's dashboard.
 *
 * The STT/TTS/LLM components are chosen for Banglish and can each be overridden
 * from Vercel without a deploy via VAPI_TRANSCRIBER_JSON / VAPI_VOICE_JSON /
 * VAPI_MODEL_JSON (raw JSON in the env var).
 */
const VAPI_KEY  = process.env.VAPI_API_KEY;
const PHONE_ID  = process.env.VAPI_PHONE_NUMBER_ID;
const SECRET    = process.env.VAPI_WEBHOOK_SECRET;

export function vapiStatus() {
  return { key: !!VAPI_KEY, phone_number: !!PHONE_ID, webhook_secret: !!SECRET };
}
export function vapiConfigured() { return !!(VAPI_KEY && PHONE_ID && SECRET); }

/** Timing-safe check of the x-vapi-secret header Vapi sends to our endpoints. */
export function verifyVapiSecret(req) {
  if (!SECRET) return false;
  const got = String(req.headers['x-vapi-secret'] || '');
  const a = Buffer.from(got), b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function envJson(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'send_whatsapp_materials',
      description:
        'Send the company portfolio / further details to the lead over WhatsApp. ' +
        'Call this ONLY after the lead asked for materials AND you confirmed which number has WhatsApp. ' +
        'If they confirmed the number you are calling has WhatsApp, omit `number`. ' +
        'If they gave a different WhatsApp number, pass it in `number`.',
      parameters: {
        type: 'object',
        properties: {
          number: { type: 'string', description: 'Alternate WhatsApp number the lead dictated, if any' },
          note:   { type: 'string', description: 'What the lead asked for, in a few words' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flag_do_not_call',
      description:
        'The lead clearly asked not to be called again. Flags them so no future calls happen. ' +
        'Apologize briefly and end the call after this.',
      parameters: { type: 'object', properties: {} },
    },
  },
];

export function buildAssistant({ systemPrompt, firstMessage, voiceId, serverUrl }) {
  const voice = envJson('VAPI_VOICE_JSON', {
    provider: '11labs',
    voiceId: voiceId || process.env.ELEVENLABS_DEFAULT_VOICE_ID || 'pNInz6obpgDQGcFmaJgB',
    model: process.env.ELEVENLABS_TTS_MODEL || 'eleven_v3',
  });
  // A trained clone always beats the stock default, but an explicit env
  // override (used while tuning Banglish quality) wins over both.
  if (voiceId && !process.env.VAPI_VOICE_JSON) voice.voiceId = voiceId;

  const transcriber = envJson('VAPI_TRANSCRIBER_JSON', {
    provider: 'google', model: 'gemini-2.0-flash', language: 'Multilingual',
  });
  const model = envJson('VAPI_MODEL_JSON', { provider: 'openai', model: 'gpt-4o' });

  return {
    name: 'Zeriotic BDE',
    firstMessage,
    model: {
      ...model,
      temperature: 0.5,
      messages: [{ role: 'system', content: systemPrompt }],
      tools: TOOLS,
    },
    voice,
    transcriber,
    maxDurationSeconds: Number(process.env.AI_CALL_MAX_MINUTES || 8) * 60,
    server: { url: `${serverUrl}/api/vapi-webhook`, secret: SECRET },
    serverMessages: ['end-of-call-report', 'status-update', 'tool-calls'],
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: 'object',
          properties: {
            outcome: {
              type: 'string',
              enum: ['interested', 'callback', 'not_interested', 'unqualified', 'no_answer', 'do_not_call', 'other'],
              description: 'The single best label for how the call ended',
            },
            interest_level: { type: 'number', description: '0 (hostile) to 10 (ready to buy)' },
            positive: { type: 'boolean', description: 'True if this is worth the manager hearing about today' },
            callback_at: { type: 'string', description: 'When they asked to be called back, verbatim, if they did' },
            whatsapp_number: { type: 'string', description: 'WhatsApp number confirmed or dictated by the lead, if any' },
            materials_requested: { type: 'boolean', description: 'True if they asked for portfolio/details' },
            key_points: { type: 'string', description: 'Objections raised, budget hints, decision maker, next step' },
          },
        },
      },
    },
  };
}

/** POST https://api.vapi.ai/call — returns Vapi's call object ({ id, ... }). */
export async function createVapiCall({ assistant, customerNumber, customerName }, fetchImpl = fetch) {
  const r = await fetchImpl('https://api.vapi.ai/call', {
    method: 'POST',
    headers: { Authorization: `Bearer ${VAPI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phoneNumberId: PHONE_ID,
      customer: { number: customerNumber, name: (customerName || '').slice(0, 60) },
      assistant,
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body.message ? (Array.isArray(body.message) ? body.message.join('; ') : body.message) : `HTTP ${r.status}`;
    const err = new Error(`Vapi rejected the call: ${msg}`);
    err.details = { http_status: r.status, body };
    throw err;
  }
  return body;
}
