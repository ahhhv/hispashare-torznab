'use strict';

// ---------------------------------------------------------------------------
// ed2k ↔ magnet (formato exacto de aMuTorrent, server/lib/linkConverter.js)
// ---------------------------------------------------------------------------

const ED2K_RE = /ed2k:\/\/\|file\|([^|]*)\|(\d+)\|([a-fA-F0-9]{32})\|/i;

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s; // un «%» suelto: se deja el nombre tal cual, igual que aMuTorrent
  }
}

// Devuelve { filename, size, hash } o null.
function parseEd2k(link) {
  const m = ED2K_RE.exec(String(link || ''));
  if (!m) return null;
  return { filename: safeDecode(m[1]), size: Number(m[2]), hash: m[3].toLowerCase() };
}

// magnet:?xt=urn:btih:<hash_ed2k + "00000000">&dn=<nombre>&xl=<tamaño>
function ed2kToMagnet(link) {
  const p = parseEd2k(link);
  if (!p) return null;
  const magnetHash = p.hash + '00000000';
  // aMuTorrent decodifica dn dos veces (URLSearchParams.get + decodeURIComponent).
  // Un «%» literal en el nombre rompería la segunda decodificación, así que solo
  // en ese caso se codifica dos veces (%25 → %2525). Sin «%» el formato es idéntico.
  const dn = encodeURIComponent(p.filename).replace(/%25/g, '%2525');
  return {
    magnet: `magnet:?xt=urn:btih:${magnetHash}&dn=${dn}&xl=${p.size}`,
    magnetHash,
    ...p,
  };
}

// ---------------------------------------------------------------------------
// Temporada / capítulo a partir del nombre de archivo
// ---------------------------------------------------------------------------

// Devuelve { season, episodes: [n...] } , { season, pack: true } o null.
function parseEpisode(filename) {
  const name = String(filename || '').replace(/\.[a-z0-9]{2,4}$/i, ''); // sin extensión

  // S02E01, S02E01E02, S02E01-E02, S02E01-02
  let m = /\bS(\d{1,2})[ ._-]?E(\d{1,3})(?:(?:[ ._-]?E|-)(\d{1,3}))?(?!\d)/i.exec(name);
  if (m) return episodeResult(m[1], m[2], m[3]);

  // 2x01, 2x01-02, 2x01-2x02, 2x01 al 02 (no confunde 1920x1080)
  // (el guion del rango va pegado: «2x01 - 23 de enero» no es un rango)
  m = /(?:^|[^0-9a-z])(\d{1,2})x(\d{2,3})(?:(?:-|\s+al\s+|\s*&\s*)(?:\d{1,2}x)?(\d{2,3}))?(?!\d)/i.exec(name);
  if (m) return episodeResult(m[1], m[2], m[3]);

  // Solo temporada: «Temporada 2», «Temp. 2», «Season 2», «T2», «S02»
  m = /\b(?:temporada|temp\.?|season)\s*(\d{1,2})\b/i.exec(name) ||
      /(?:^|[\s._-])T(\d{1,2})(?=$|[\s._-])/.exec(name) ||
      /(?:^|[\s._-])S(\d{1,2})(?=$|[\s._-])/i.exec(name);
  if (m) return { season: Number(m[1]), pack: true };

  return null;
}

function episodeResult(s, e1, e2) {
  const season = Number(s);
  const first = Number(e1);
  const last = e2 !== undefined ? Number(e2) : first;
  const episodes = [];
  if (last > first && last - first < 50) {
    for (let e = first; e <= last; e++) episodes.push(e);
  } else {
    episodes.push(first);
  }
  return { season, episodes };
}

// ---------------------------------------------------------------------------
// release_info, códecs e idiomas
// ---------------------------------------------------------------------------

function parseResolution(text) {
  const t = String(text || '');
  const m = /\b(2160|1080|720|576|480)[pi]\b/i.exec(t);
  if (m) return `${m[1]}p`;
  if (/\b(4k|uhd)\b/i.test(t) || /micro4k/i.test(t)) return '2160p';
  return null;
}

// Fuentes estándar que Sonarr/Radarr reconocen.
const STANDARD_SOURCES = [
  [/\b(bd|bluray|blu-ray)?[ .-]?remux\b/i, 'BluRay.REMUX'],
  [/\bweb[ .-]?dl\b/i, 'WEB-DL'],
  [/\bweb[ .-]?rip\b/i, 'WEBRip'],
  [/\b(bd|br)[ .-]?rip\b/i, 'BDRip'],
  [/\b(blu-?ray|bdmv)\b/i, 'BluRay'],
  [/\bhdtv\b/i, 'HDTV'],
  [/\bdvd[ .-]?rip\b/i, 'DVDRip'],
  [/\bdvd\b/i, 'DVD'],
  [/\bweb\b/i, 'WEB-DL'],
];

// Fichas que no son fuente (resolución, HDR, profundidad de color...)
const NON_SOURCE = /^(\d{3,4}[pi]|4k|uhd|hdr\d*\+?|dv|dovi|dolby|vision|sdr|hlg|\d+[ -]?bits?|imax|remastered|extended|proper|repack|x26[45]|h\.?26[45]|hevc|avc)$/i;

// Devuelve { tokens: [...] } con la fuente estándar y, si es nombre propio de
// Hispashare (Micro4K, MicroHD...), también la etiqueta original.
function parseSource(releaseInfo, sourceMap = {}) {
  const info = String(releaseInfo || '');
  for (const [re, std] of STANDARD_SOURCES) {
    if (re.test(info)) return { source: std, tag: null };
  }
  const first = info.split(/\s+/).find((w) => w && !NON_SOURCE.test(w));
  if (!first) return { source: null, tag: null };
  const tag = sanitizeToken(first);
  const mapped = sourceMap[first.toLowerCase()];
  return mapped ? { source: mapped, tag } : { source: null, tag };
}

function parseHdr(releaseInfo) {
  const info = String(releaseInfo || '');
  const out = [];
  if (/hdr10\+|hdr10plus/i.test(info)) out.push('HDR10+');
  else if (/hdr10\b/i.test(info)) out.push('HDR10');
  else if (/\bhdr\b/i.test(info)) out.push('HDR');
  if (/\b(dv|dovi)\b|dolby[ .-]?vision/i.test(info)) out.push('DV');
  if (/\b10[ -]?bits?\b/i.test(info)) out.push('10bit');
  return out;
}

function normalizeVideoCodec(codec) {
  const c = String(codec || '').trim();
  if (!c) return null;
  if (/h\.?\s?265|hevc|x265/i.test(c)) return 'x265';
  if (/h\.?\s?264|avc|x264/i.test(c)) return 'x264';
  if (/av1/i.test(c)) return 'AV1';
  if (/xvid/i.test(c)) return 'XviD';
  if (/divx/i.test(c)) return 'DivX';
  if (/vp9/i.test(c)) return 'VP9';
  if (/mpeg-?2/i.test(c)) return 'MPEG2';
  return sanitizeToken(c);
}

function normalizeAudioCodec(codec) {
  const c = String(codec || '').trim();
  if (!c) return null;
  const ch = (/\b([1-7]\.[01])\b/.exec(c) || [])[1];
  let base;
  if (/truehd/i.test(c)) base = /atmos/i.test(c) ? 'TrueHD.Atmos' : 'TrueHD';
  else if (/dts[ .-]?hd[ .-]?ma/i.test(c)) base = 'DTS-HD.MA';
  else if (/dts[ .-]?x\b/i.test(c)) base = 'DTS-X';
  else if (/dts/i.test(c)) base = 'DTS';
  else if (/e-?ac-?3|dd\+|ddp|dolby digital plus/i.test(c)) base = 'DDP';
  else if (/ac-?3|dolby digital|\bdd\b/i.test(c)) base = 'AC3';
  else if (/aac/i.test(c)) base = 'AAC';
  else if (/flac/i.test(c)) base = 'FLAC';
  else if (/opus/i.test(c)) base = 'Opus';
  else if (/mp3/i.test(c)) base = 'MP3';
  else return sanitizeToken(c);
  return ch ? `${base}.${ch}` : base;
}

const LANGS = [
  [/^(spanish|español|espanol|castellano|spa|esp|es)$/i, 'SPANISH'],
  [/^(latino|spanish \(latin america\)|español latino|latin american spanish)$/i, 'LATINO'],
  [/^(english|inglés|ingles|eng|en)$/i, 'ENGLISH'],
  [/^(catalan|catalán|català|cat)$/i, 'CATALAN'],
  [/^(basque|euskera|vasco)$/i, 'BASQUE'],
  [/^(galician|gallego|galego)$/i, 'GALICIAN'],
  [/^(french|francés|frances|fre|fra)$/i, 'FRENCH'],
  [/^(german|alemán|aleman|ger|deu)$/i, 'GERMAN'],
  [/^(italian|italiano|ita)$/i, 'ITALIAN'],
  [/^(portuguese|portugués|portugues|por)$/i, 'PORTUGUESE'],
  [/^(japanese|japonés|japones|jpn)$/i, 'JAPANESE'],
  [/^(korean|coreano|kor)$/i, 'KOREAN'],
  [/^(chinese|chino|chi|zho)$/i, 'CHINESE'],
];

// Lista de idiomas → fichas en mayúsculas. Si solo hay subtítulos → ['SUBS'].
function parseLanguages(list) {
  const audio = [];
  let subs = false;
  for (const raw of Array.isArray(list) ? list : []) {
    const l = String(raw || '').trim();
    if (!l) continue;
    if (/sub|vose|\bvos\b/i.test(l)) {
      subs = true;
      continue;
    }
    const hit = LANGS.find(([re]) => re.test(l));
    const tok = hit ? hit[1] : sanitizeToken(l).toUpperCase();
    if (tok && !audio.includes(tok)) audio.push(tok);
  }
  if (audio.length === 0 && subs) return ['SUBS'];
  return audio;
}

// ---------------------------------------------------------------------------
// Utilidades de texto
// ---------------------------------------------------------------------------

function stripAccents(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sanitizeToken(s) {
  return stripAccents(s).replace(/[^A-Za-z0-9+]+/g, '.').replace(/^\.+|\.+$/g, '');
}

// «La casa de papel: Corea» → «La.casa.de.papel.Corea»
function sceneName(s) {
  return stripAccents(s)
    .replace(/&/g, ' and ')
    .replace(/['’`´]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

// Para comparar títulos: minúsculas, sin acentos ni signos.
function normalizeText(s) {
  return stripAccents(s).toLowerCase().replace(/&/g, ' and ').replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

module.exports = {
  parseEd2k,
  ed2kToMagnet,
  parseEpisode,
  parseResolution,
  parseSource,
  parseHdr,
  normalizeVideoCodec,
  normalizeAudioCodec,
  parseLanguages,
  sceneName,
  normalizeText,
  stripAccents,
  sanitizeToken,
};
