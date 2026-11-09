'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const config = require('./config');
const log = require('./log');
const { HispashareClient, RateLimitError, ApiError } = require('./hispashare');
const { Searcher } = require('./search');
const torznab = require('./torznab');

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/xml; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function createServer(cfg, { client = new HispashareClient(cfg) } = {}) {
  const searcher = new Searcher(cfg, client);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('OK');
    }

    // Se acepta /api y cualquier ruta que termine en /api (p. ej. /torznab/api)
    if (!/(^|\/)api\/?$/.test(url.pathname)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found. Usa /api?t=caps');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }

    const params = Object.fromEntries(url.searchParams);
    if (!params.apikey || !safeEqual(params.apikey, cfg.apikey)) {
      log.warn(`Petición con apikey incorrecta desde ${req.socket.remoteAddress}`);
      return send(res, 401, torznab.errorXml(100, 'Incorrect user credentials'));
    }

    const t = String(params.t || 'search').toLowerCase();
    try {
      if (t === 'caps') return send(res, 200, torznab.capsXml());
      if (!['search', 'tvsearch', 'tv-search', 'movie', 'movie-search'].includes(t)) {
        return send(res, 200, torznab.errorXml(202, `No such function (${t})`));
      }
      const { items, total, offset } = await searcher.search(params);
      return send(res, 200, torznab.resultsXml(items, cfg, { total, offset }));
    } catch (err) {
      if (err instanceof RateLimitError) {
        log.warn(err.message);
        return send(res, 429, torznab.errorXml(900, err.message), { 'Retry-After': String(err.retryAfter) });
      }
      if (err instanceof ApiError) {
        log.error(err.message);
        return send(res, 200, torznab.errorXml(900, err.message));
      }
      log.error(`Error inesperado: ${err.stack || err.message}`);
      return send(res, 500, torznab.errorXml(900, 'Internal error'));
    }
  });
}

async function main() {
  const cfg = config.load();
  log.setLevel(cfg.logLevel);
  log.addSecret(cfg.token);
  log.addSecret(cfg.apikey);

  const missing = [];
  if (!cfg.token) missing.push('HISPASHARE_TOKEN');
  if (!cfg.apikey) missing.push('TORZNAB_APIKEY');
  if (missing.length) {
    log.error(`Faltan variables de entorno obligatorias: ${missing.join(', ')}`);
    process.exit(1);
  }

  // /health de Hispashare no requiere token ni consume cuota.
  fetch(`${cfg.apiUrl}/health`, { signal: AbortSignal.timeout(10000) })
    .then(async (r) => log.info(`API de Hispashare (${cfg.apiUrl}) /health → ${r.status} ${(await r.text()).trim().slice(0, 40)}`))
    .catch((e) => log.warn(`No se pudo comprobar ${cfg.apiUrl}/health: ${e.message}`));

  const server = createServer(cfg);
  server.listen(cfg.port, () => {
    log.info(`hispashare-torznab escuchando en :${cfg.port} (Torznab en /api) · caché ${cfg.cacheTtl}s / RSS ${cfg.rssCacheTtl}s · máx. ${cfg.maxPages} páginas`);
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) main();

module.exports = { createServer };
