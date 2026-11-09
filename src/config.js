'use strict';

// Configuración leída de variables de entorno. El token de Hispashare solo vive
// en memoria: nunca se escribe en disco ni en los logs.

function int(env, name, def, min = 0) {
  const raw = env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) {
    throw new Error(`${name} debe ser un entero >= ${min} (valor recibido: "${raw}")`);
  }
  return n;
}

// SOURCE_MAP="Micro4K:WEBRip,MicroHD:WEBRip" → { micro4k: 'WEBRip', microhd: 'WEBRip' }
function parseSourceMap(raw) {
  const map = {};
  for (const pair of String(raw || '').split(',')) {
    const [from, to] = pair.split(':').map((s) => (s || '').trim());
    if (from && to) map[from.toLowerCase()] = to;
  }
  return map;
}

function load(env = process.env) {
  return {
    token: env.HISPASHARE_TOKEN || '',
    apiUrl: (env.HISPASHARE_API_URL || 'https://api.hispashare.org').replace(/\/+$/, ''),
    apikey: env.TORZNAB_APIKEY || '',
    port: int(env, 'PORT', 9118, 1),
    cacheTtl: int(env, 'CACHE_TTL', 600),            // segundos, búsquedas
    rssCacheTtl: int(env, 'RSS_CACHE_TTL', 300),     // segundos, RSS
    maxPages: int(env, 'MAX_PAGES', 2, 1),
    rssPages: int(env, 'RSS_PAGES', 1, 1),
    requestTimeout: int(env, 'REQUEST_TIMEOUT', 15, 1),
    defaultRetryAfter: int(env, 'DEFAULT_RETRY_AFTER', 60, 1),
    logLevel: (env.LOG_LEVEL || 'info').toLowerCase(),
    sourceMap: parseSourceMap(env.SOURCE_MAP ?? 'Micro4K:WEBRip,MicroHD:WEBRip'),
    releaseGroup: env.RELEASE_GROUP || 'HispaShare',
    fakeSeeders: int(env, 'FAKE_SEEDERS', 10),
    siteUrl: (env.HISPASHARE_SITE_URL || 'https://www.hispashare.org').replace(/\/+$/, ''),
  };
}

module.exports = { load, parseSourceMap };
