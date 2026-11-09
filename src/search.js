'use strict';

const P = require('./parse');
const { itemsFromTitle } = require('./release');
const log = require('./log');

// imdbid puede llegar como «tt0116213», «0116213» o «116213».
function normalizeImdb(raw) {
  const m = /^(?:tt)?(\d{1,10})$/i.exec(String(raw || '').trim());
  if (!m) return null;
  return 'tt' + m[1].padStart(7, '0');
}

function intOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

// Saca de la consulta libre temporada/capítulo («2x01», «S02E01», «S02») y
// año («Película 2025»), y deja el texto limpio.
function parseQuery(q) {
  let text = String(q || '').trim();
  let season = null;
  let ep = null;
  let year = null;

  let m = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(text) || /(?:^|\s)(\d{1,2})x(\d{2,3})\b/i.exec(text);
  if (m) {
    season = Number(m[1]);
    ep = Number(m[2]);
    text = text.replace(m[0], ' ');
  } else if ((m = /(?:^|\s)S(\d{1,2})(?=\s|$)/i.exec(text) || /\b(?:temporada|season)\s+(\d{1,2})\b/i.exec(text))) {
    season = Number(m[1]);
    text = text.replace(m[0], ' ');
  }
  m = /(?:^|\s)\(?((?:19|20)\d{2})\)?\s*$/.exec(text);
  if (m && text.replace(m[0], '').trim()) {
    year = Number(m[1]);
    text = text.replace(m[0], ' ');
  }
  return { text: text.replace(/\s+/g, ' ').trim(), season, ep, year };
}

function titleMatches(title, words) {
  if (!words.length) return true;
  const hay = ` ${P.normalizeText(title.title)} | ${P.normalizeText(title.original_title)} `;
  const hayTitle = ` ${P.normalizeText(title.title)} `;
  const hayOrig = ` ${P.normalizeText(title.original_title)} `;
  // todas las palabras dentro del mismo título (castellano u original)
  return [hayTitle, hayOrig].some((h) => words.every((w) => h.includes(w))) || words.every((w) => hay.includes(w));
}

class Searcher {
  constructor(cfg, client) {
    this.cfg = cfg;
    this.client = client;
  }

  // params: objeto con los parámetros Torznab de la URL.
  async search(params) {
    const t = String(params.t || 'search').toLowerCase();
    const mode = t === 'tvsearch' || t === 'tv-search' ? 'tv' : t === 'movie' || t === 'movie-search' ? 'movie' : 'any';

    const imdbId = params.imdbid ? normalizeImdb(params.imdbid) : null;
    const pq = parseQuery(params.q);
    let season = intOrNull(params.season) ?? pq.season;
    let ep = intOrNull(params.ep) ?? pq.ep;
    // Sonarr usa season=AAAA&ep=MM/DD para series diarias: no aplica aquí.
    if (params.ep && !/^\d+$/.test(String(params.ep))) ep = -1;
    const words = P.normalizeText(pq.text).split(' ').filter(Boolean);
    const isRss = !imdbId && words.length === 0;

    let titles;
    if (imdbId) {
      log.info(`Búsqueda ${t} imdbid=${imdbId}${season != null ? ` season=${season}` : ''}${ep != null ? ` ep=${ep}` : ''}`);
      titles = await this.client.titlesByImdb(imdbId);
    } else if (!isRss) {
      log.info(`Búsqueda ${t} q="${pq.text}"${season != null ? ` season=${season}` : ''}${ep != null ? ` ep=${ep}` : ''}${pq.year ? ` año=${pq.year}` : ''}`);
      titles = await this.client.listTitles({ q: pq.text, maxPages: this.cfg.maxPages, ttl: this.cfg.cacheTtl });
      titles = titles.filter((ti) => titleMatches(ti, words));
    } else {
      log.info(`RSS (${t})`);
      titles = await this.client.listTitles({ q: '', maxPages: this.cfg.rssPages, ttl: this.cfg.rssCacheTtl });
    }

    if (pq.year) {
      titles = titles.filter((ti) => !ti.production_year || Math.abs(ti.production_year - pq.year) <= 1);
    }

    let items = titles.flatMap((ti) => itemsFromTitle(ti, this.cfg));

    if (mode === 'tv') items = items.filter((i) => i.mediaKind === 'tv');
    if (mode === 'movie') items = items.filter((i) => i.mediaKind === 'movie');

    if (ep != null) {
      items = items.filter((i) => i.kind === 'episode' && (season == null || i.season === season) && i.episodes.includes(ep));
    } else if (season != null) {
      items = items.filter((i) => (i.kind === 'episode' || i.kind === 'season') && i.season === season);
    } else if (isRss) {
      // Un archivo sin temporada ni capítulo no debe parecer «serie completa» en el RSS.
      items = items.filter((i) => i.kind !== 'complete');
    }

    const cats = String(params.cat || '').split(',').map((c) => Number.parseInt(c, 10)).filter(Number.isFinite);
    if (cats.length) items = items.filter((i) => i.categories.some((c) => cats.includes(c)));

    // sin duplicados (mismo archivo en dos releases) y lo más reciente primero
    const seen = new Set();
    items = items.filter((i) => (seen.has(i.guid) ? false : seen.add(i.guid)));
    items.sort((a, b) => b.pubDate - a.pubDate);

    const total = items.length;
    const offset = Math.max(0, intOrNull(params.offset) ?? 0);
    const limit = Math.min(100, Math.max(1, intOrNull(params.limit) ?? 100));
    items = items.slice(offset, offset + limit);
    log.info(`→ ${items.length} resultado(s) de ${total}`);
    return { items, total, offset };
  }
}

module.exports = { Searcher, parseQuery, normalizeImdb, titleMatches };
