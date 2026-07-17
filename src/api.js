const TOKEN_KEY = 'lead_agent_token';
const NAME_KEY  = 'lead_agent_name';

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const getName  = () => localStorage.getItem(NAME_KEY);
export const setSession = (token, name) => {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(NAME_KEY, name);
};
export const clearSession = () => {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
};

async function req(path, { method = 'GET', body, params } = {}) {
  const url = new URL(path, window.location.origin);
  if (params) Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) url.searchParams.set(k, v); });

  const r = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { clearSession(); window.location.reload(); }
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export const api = {
  login:     (name, password) => req('/api/login', { method: 'POST', body: { name, password } }),
  scan:      payload          => req('/api/scan',  { method: 'POST', body: payload }),
  autocomplete: input         => req('/api/places-autocomplete', { params: { input } }),
  emailReport:  ()            => req('/api/report-email', { method: 'POST' }),
  socials:      place_ids     => req('/api/socials', { method: 'POST', body: { place_ids } }),
  health:       params        => req('/api/health', { params }),
  leads:     params           => req('/api/leads', { params }),
  setStatus: (place_id, status, note) => req('/api/leads', { method: 'PATCH', body: { place_id, status, note } }),
  notes:     place_id         => req('/api/notes', { params: { place_id } }),
  addNote:   (place_id, note, status) => req('/api/notes', { method: 'POST', body: { place_id, note, status } }),
  report:    ()               => req('/api/report'),

  // AI caller
  calls:          params      => req('/api/calls', { params }),
  startCall:      place_id    => req('/api/calls', { method: 'POST', body: { place_id } }),
  testCall:       test_number => req('/api/calls', { method: 'POST', body: { test_number } }),
  voiceGet:       ()          => req('/api/voice'),
  voiceUpload:    (audio, mime) => req('/api/voice', { method: 'POST', body: { audio, mime } }),
  voiceDelete:    ()          => req('/api/voice', { method: 'DELETE' }),
  personas:       ()          => req('/api/persona'),
  savePersona:    body        => req('/api/persona', { method: 'POST', body }),
  improvePersona: ()          => req('/api/persona', { method: 'POST', body: { improve: true } }),
  personaAction:  (id, action) => req('/api/persona', { method: 'PATCH', body: { id, action } }),
};
