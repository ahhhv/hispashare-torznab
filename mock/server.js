'use strict';

// Servidor simulado de la API de Hispashare (según hispashare-api.json).
//   MOCK_PORT        puerto (8099)
//   MOCK_TOKEN       token válido (test-token)
//   MOCK_PAGE_SIZE   títulos por página (20, como la API real)
//   MOCK_RATE_LIMIT  peticiones permitidas antes de devolver 429 (1000)
//   MOCK_RETRY_AFTER segundos de Retry-After en el 429 (4)
// GET /_stats devuelve el número de peticiones autenticadas recibidas.

const http = require('node:http');
const { titles } = require('./data');

function createMockServer(opts = {}) {
  const token = opts.token ?? process.env.MOCK_TOKEN ?? 'test-token';
  const pageSize = Number(opts.pageSize ?? process.env.MOCK_PAGE_SIZE ?? 20);
  const state = {
    limit: Number(opts.rateLimit ?? process.env.MOCK_RATE_LIMIT ?? 1000),
    retryAfter: Number(opts.retryAfter ?? process.env.MOCK_RETRY_AFTER ?? 4),
    requests: 0,
    paths: [],
  };

  const json = (res, status, body, extra = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json', ...extra });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('OK');
    }
    if (url.pathname === '/_stats') return json(res, 200, { requests: state.requests, paths: state.paths });

    if (req.headers.authorization !== `Bearer ${token}`) return json(res, 401, { error: 'A valid API token is required.' });

    state.requests++;
    state.paths.push(url.pathname + url.search);
    const remaining = Math.max(0, state.limit - state.requests);
    const rl = { 'RateLimit-Limit': String(state.limit), 'RateLimit-Remaining': String(remaining) };
    if (state.requests > state.limit) {
      return json(res, 429, { error: 'Rate limit exceeded' }, { ...rl, 'Retry-After': String(state.retryAfter) });
    }

    let m;
    if ((m = /^\/titles\/imdb\/([^/]+)$/.exec(url.pathname))) {
      const id = decodeURIComponent(m[1]);
      if (!/^tt\d+$/.test(id)) return json(res, 400, { error: 'The IMDb ID must use the format tt followed by digits.' });
      return json(res, 200, { data: titles.filter((t) => t.imdb_id === id) }, rl);
    }

    if (url.pathname === '/titles') {
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const sortBy = url.searchParams.get('sort_by') || 'updated_at';
      const order = url.searchParams.get('sort_order') || 'desc';
      if (!['updated_at', 'production_year'].includes(sortBy) || !['asc', 'desc'].includes(order)) {
        return json(res, 400, { error: 'Invalid sorting parameter.' });
      }
      let list = titles.filter((t) => !q || t.title.toLowerCase().includes(q) || t.original_title.toLowerCase().includes(q));
      list = [...list].sort((a, b) => {
        const va = sortBy === 'updated_at' ? Date.parse(a.updated_at) : a.production_year;
        const vb = sortBy === 'updated_at' ? Date.parse(b.updated_at) : b.production_year;
        return order === 'asc' ? va - vb || a.id - b.id : vb - va || b.id - a.id;
      });
      let offset = 0;
      const cursor = url.searchParams.get('cursor');
      if (cursor) {
        try {
          offset = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString()).offset;
        } catch {
          return json(res, 400, { error: 'Invalid cursor.' });
        }
      }
      const data = list.slice(offset, offset + pageSize);
      const hasMore = offset + pageSize < list.length;
      const next = hasMore ? Buffer.from(JSON.stringify({ offset: offset + pageSize })).toString('base64url') + '.signature' : null;
      return json(res, 200, { data, next_cursor: next, has_more: hasMore }, rl);
    }

    json(res, 404, { error: 'Not found' });
  });
  server.state = state;
  return server;
}

if (require.main === module) {
  const port = Number(process.env.MOCK_PORT || 8099);
  createMockServer().listen(port, () => console.log(`Mock de la API de Hispashare en http://localhost:${port}`));
}

module.exports = { createMockServer };
