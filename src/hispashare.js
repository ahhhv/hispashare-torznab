'use strict';

const log = require('./log');
const { TtlCache } = require('./cache');

class RateLimitError extends Error {
  constructor(retryAfter) {
    super(`Límite de peticiones de Hispashare agotado; reintentar en ${retryAfter} s`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
  }
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// Cliente de la API de Hispashare con:
//  - caché en memoria (fresca y «rancia» para cuando hay 429),
//  - deduplicación de peticiones simultáneas iguales,
//  - bloqueo hasta que pase Retry-After (sin reintentos en bucle),
//  - registro de RateLimit-Remaining.
class HispashareClient {
  constructor(cfg, { fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
    this.cfg = cfg;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new TtlCache({ maxEntries: 1000, now });
    this.inflight = new Map();
    this.blockedUntil = 0;
    this.lastRateLimit = { limit: null, remaining: null };
  }

  retryAfterSeconds() {
    return Math.max(1, Math.ceil((this.blockedUntil - this.now()) / 1000));
  }

  async _fetchJson(path) {
    if (this.now() < this.blockedUntil) throw new RateLimitError(this.retryAfterSeconds());

    const url = this.cfg.apiUrl + path;
    log.debug(`API GET ${path}`);
    let res;
    try {
      res = await this.fetch(url, {
        headers: {
          Authorization: `Bearer ${this.cfg.token}`,
          Accept: 'application/json',
          'User-Agent': 'hispashare-torznab/1.0',
        },
        signal: AbortSignal.timeout(this.cfg.requestTimeout * 1000),
      });
    } catch (err) {
      throw new ApiError(`No se pudo contactar con la API de Hispashare: ${err.message}`, 502);
    }

    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');
    if (remaining !== null) {
      this.lastRateLimit = { limit: limit !== null ? Number(limit) : null, remaining: Number(remaining) };
      const low = limit !== null && Number(remaining) <= Math.max(5, Number(limit) * 0.1);
      log[low ? 'warn' : 'info'](`API ${path.split('?')[0]} → ${res.status}; RateLimit-Remaining=${remaining}${limit !== null ? `/${limit}` : ''}`);
    } else {
      log.info(`API ${path.split('?')[0]} → ${res.status}`);
    }

    if (res.status === 429) {
      const ra = Number.parseInt(res.headers.get('retry-after') || '', 10);
      const wait = Number.isFinite(ra) && ra > 0 ? ra : this.cfg.defaultRetryAfter;
      this.blockedUntil = this.now() + wait * 1000;
      log.warn(`Hispashare devolvió 429; no se harán más peticiones durante ${wait} s`);
      throw new RateLimitError(wait);
    }
    if (res.status === 401) throw new ApiError('Token de Hispashare inválido o ausente (401)', 401);
    if (!res.ok) throw new ApiError(`La API de Hispashare respondió ${res.status}`, res.status);

    try {
      return await res.json();
    } catch {
      throw new ApiError('Respuesta JSON no válida de la API de Hispashare', 502);
    }
  }

  // Petición con caché. Si la API está limitada y hay copia caducada, se usa.
  async _cached(path, ttl) {
    const fresh = this.cache.get(path);
    if (fresh !== undefined) {
      log.debug(`caché: ${path}`);
      return fresh;
    }
    if (this.inflight.has(path)) return this.inflight.get(path);

    const p = (async () => {
      try {
        const data = await this._fetchJson(path);
        this.cache.set(path, data, ttl);
        return data;
      } catch (err) {
        const stale = this.cache.getStale(path);
        if (err instanceof RateLimitError && stale !== undefined) {
          log.warn(`Sirviendo caché caducada para ${path.split('?')[0]} por límite de peticiones`);
          return stale;
        }
        throw err;
      } finally {
        this.inflight.delete(path);
      }
    })();
    this.inflight.set(path, p);
    return p;
  }

  // Recorre /titles hasta maxPages páginas. Si una página posterior a la
  // primera falla por límite, devuelve lo que ya tenga.
  async listTitles({ q = '', maxPages = this.cfg.maxPages, ttl = this.cfg.cacheTtl } = {}) {
    const titles = [];
    let cursor = null;
    for (let page = 0; page < maxPages; page++) {
      const params = new URLSearchParams({ sort_by: 'updated_at', sort_order: 'desc' });
      if (q) params.set('q', q);
      if (cursor) params.set('cursor', cursor);
      let body;
      try {
        body = await this._cached(`/titles?${params}`, ttl);
      } catch (err) {
        if (page > 0 && err instanceof RateLimitError) {
          log.warn(`Paginación cortada en la página ${page + 1} por límite de peticiones`);
          break;
        }
        throw err;
      }
      titles.push(...(Array.isArray(body?.data) ? body.data : []));
      if (!body?.has_more || !body?.next_cursor) break;
      cursor = body.next_cursor;
    }
    return titles;
  }

  async titlesByImdb(imdbId, ttl = this.cfg.cacheTtl) {
    const body = await this._cached(`/titles/imdb/${encodeURIComponent(imdbId)}`, ttl);
    return Array.isArray(body?.data) ? body.data : [];
  }
}

module.exports = { HispashareClient, RateLimitError, ApiError };
