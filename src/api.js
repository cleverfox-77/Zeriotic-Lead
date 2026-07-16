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
  leads:     params           => req('/api/leads', { params }),
  setStatus: (place_id, status, note) => req('/api/leads', { method: 'PATCH', body: { place_id, status, note } }),
  notes:     place_id         => req('/api/notes', { params: { place_id } }),
  addNote:   (place_id, note, status) => req('/api/notes', { method: 'POST', body: { place_id, note, status } }),
  report:    ()               => req('/api/report'),
};
