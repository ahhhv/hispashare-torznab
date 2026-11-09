'use strict';

const { CAT } = require('./release');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // caracteres de control no válidos en XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function capsXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server version="1.0" title="Hispashare Torznab" strapline="Hispashare vía API oficial" url="https://www.hispashare.org/"/>
  <limits max="100" default="100"/>
  <searching>
    <search available="yes" supportedParams="q"/>
    <tv-search available="yes" supportedParams="q,season,ep,imdbid"/>
    <movie-search available="yes" supportedParams="q,imdbid"/>
    <music-search available="no" supportedParams="q"/>
    <audio-search available="no" supportedParams="q"/>
    <book-search available="no" supportedParams="q"/>
  </searching>
  <categories>
    <category id="${CAT.MOVIES}" name="Movies">
      <subcat id="${CAT.MOVIES_HD}" name="Movies/HD"/>
      <subcat id="${CAT.MOVIES_UHD}" name="Movies/UHD"/>
    </category>
    <category id="${CAT.TV}" name="TV">
      <subcat id="${CAT.TV_HD}" name="TV/HD"/>
      <subcat id="${CAT.TV_UHD}" name="TV/UHD"/>
    </category>
  </categories>
</caps>
`;
}

function attr(name, value) {
  return `      <torznab:attr name="${name}" value="${esc(value)}"/>`;
}

function itemXml(it, cfg) {
  const lines = [
    '    <item>',
    `      <title>${esc(it.title)}</title>`,
    `      <guid isPermaLink="false">${esc(it.guid)}</guid>`,
    `      <link>${esc(it.magnet)}</link>`,
    `      <comments>${esc(it.comments)}</comments>`,
    `      <pubDate>${it.pubDate.toUTCString()}</pubDate>`,
    `      <size>${it.size}</size>`,
    `      <description>${esc(it.description)}</description>`,
    ...it.categories.map((c) => `      <category>${c}</category>`),
    `      <enclosure url="${esc(it.magnet)}" length="${it.size}" type="application/x-bittorrent"/>`,
    ...it.categories.map((c) => attr('category', c)),
    attr('size', it.size),
    attr('seeders', cfg.fakeSeeders),
    attr('peers', cfg.fakeSeeders),
    attr('grabs', 0),
    attr('downloadvolumefactor', 0),
    attr('uploadvolumefactor', 1),
    attr('magneturl', it.magnet),
    attr('infohash', it.guid),
  ];
  if (it.imdb) {
    lines.push(attr('imdb', it.imdb), attr('imdbid', it.imdbId));
  }
  if (it.season != null) lines.push(attr('season', it.season));
  if (it.episodes && it.episodes.length) lines.push(attr('episode', it.episodes[0]));
  if (it.year && it.mediaKind === 'movie') lines.push(attr('year', it.year));
  lines.push('    </item>');
  return lines.join('\n');
}

function resultsXml(items, cfg, { offset = 0, total = items.length } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>
    <title>Hispashare</title>
    <description>Hispashare (API oficial) para Torznab</description>
    <link>${esc(cfg.siteUrl)}/</link>
    <language>es-es</language>
    <torznab:response offset="${offset}" total="${total}"/>
${items.map((it) => itemXml(it, cfg)).join('\n')}
  </channel>
</rss>
`;
}

// Códigos de error Torznab: 100 apikey incorrecta, 201 función no disponible,
// 900 error desconocido / no disponible.
function errorXml(code, description) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<error code="${code}" description="${esc(description)}"/>\n`;
}

module.exports = { capsXml, resultsXml, errorXml, esc };
