// Bridges our Node-style (req, res) handlers to Next.js App Router route
// handlers (web Request -> Response). Handlers keep their original shape, so
// the same functions run unchanged in tests and in production.
export function adapt(handler) {
  return async function route(request) {
    const url = new URL(request.url);
    const query = Object.fromEntries(url.searchParams);

    let body = {};
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try { body = await request.json(); } catch { body = {}; }
    }

    const req = {
      method: request.method,
      url: url.pathname + url.search,
      query,
      body,
      headers: Object.fromEntries(request.headers),
    };

    let statusCode = 200;
    const headers = {};
    let response = null;

    const res = {
      status(code) { statusCode = code; return res; },
      setHeader(k, v) { headers[k] = v; return res; },
      json(obj) {
        response = new Response(JSON.stringify(obj), {
          status: statusCode,
          headers: { 'content-type': 'application/json', ...headers },
        });
        return res;
      },
      send(text) {
        response = new Response(typeof text === 'string' ? text : JSON.stringify(text), {
          status: statusCode, headers,
        });
        return res;
      },
      end() {
        response = new Response(null, { status: statusCode, headers });
        return res;
      },
    };

    await handler(req, res);
    // A handler that returns without responding is a bug; surface it clearly.
    return response || new Response(JSON.stringify({ error: 'Handler produced no response' }), {
      status: 500, headers: { 'content-type': 'application/json' },
    });
  };
}
