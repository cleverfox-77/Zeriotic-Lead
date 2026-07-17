/**
 * Meta WhatsApp Cloud API. Business-initiated messages (which is what a
 * mid-call portfolio send is) MUST use a pre-approved template — free-form
 * text only works inside a 24h window after the lead messages us first.
 *
 * Expected template shape (create it in Meta Business Manager):
 *   - category: UTILITY (or MARKETING if Meta reclassifies it)
 *   - header: DOCUMENT  → we attach PORTFOLIO_URL
 *   - body: one {{1}} variable → the business name
 * If your template has no body variable, set WHATSAPP_TEMPLATE_BODY_VARS=0.
 */
const TOKEN     = process.env.WHATSAPP_TOKEN;
const PHONE_ID  = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TEMPLATE  = process.env.WHATSAPP_TEMPLATE_NAME;
const LANG      = process.env.WHATSAPP_TEMPLATE_LANG || 'en';
const PORTFOLIO = process.env.PORTFOLIO_URL;
const BODY_VARS = Number(process.env.WHATSAPP_TEMPLATE_BODY_VARS ?? 1);
const GRAPH     = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

export function whatsappStatus() {
  return { token: !!TOKEN, phone_number: !!PHONE_ID, template: !!TEMPLATE, portfolio_url: !!PORTFOLIO };
}
export function whatsappConfigured() { return !!(TOKEN && PHONE_ID && TEMPLATE); }

export function buildPortfolioPayload(toE164, leadName) {
  const components = [];
  if (PORTFOLIO) {
    components.push({
      type: 'header',
      parameters: [{ type: 'document', document: { link: PORTFOLIO, filename: 'Zeriotic-Portfolio.pdf' } }],
    });
  }
  if (BODY_VARS > 0) {
    components.push({ type: 'body', parameters: [{ type: 'text', text: (leadName || 'your business').slice(0, 60) }] });
  }
  return {
    messaging_product: 'whatsapp',
    to: String(toE164).replace(/^\+/, ''), // Graph API wants digits, no plus
    type: 'template',
    template: { name: TEMPLATE, language: { code: LANG }, ...(components.length ? { components } : {}) },
  };
}

export async function sendPortfolio(toE164, leadName, fetchImpl = fetch) {
  if (!whatsappConfigured()) {
    throw new Error('WhatsApp is not configured — set WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_TEMPLATE_NAME.');
  }
  const r = await fetchImpl(`https://graph.facebook.com/${GRAPH}/${PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPortfolioPayload(toE164, leadName)),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body.error?.message || `HTTP ${r.status}`;
    const err = new Error(`WhatsApp send failed: ${msg}`);
    err.details = { http_status: r.status, code: body.error?.code, body };
    throw err;
  }
  return { message_id: body.messages?.[0]?.id || null };
}
