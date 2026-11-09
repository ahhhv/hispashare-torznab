'use strict';

const P = require('./parse');
const log = require('./log');

const CAT = {
  MOVIES: 2000, MOVIES_HD: 2040, MOVIES_UHD: 2045,
  TV: 5000, TV_HD: 5040, TV_UHD: 5045,
};

const NON_VIDEO_EXT = /\.(srt|sub|idx|ass|ssa|vtt|nfo|txt|jpe?g|png|gif|url|sfv|md5|par2)$/i;

function pad2(n) {
  return String(n).padStart(2, '0');
}

function imdbDigits(imdbId) {
  const m = /^tt(\d+)$/i.exec(String(imdbId || ''));
  return m ? m[1] : null;
}

// ¿Es serie? series → sí; movie → no; documentary/null → sí si algún archivo
// tiene número de capítulo; music → se descarta (null).
function titleKind(title) {
  const type = title.type;
  if (type === 'music') return null;
  if (type === 'series') return 'tv';
  if (type === 'movie') return 'movie';
  for (const r of title.releases || []) {
    for (const l of r.elinks || []) {
      const ed = P.parseEd2k(l);
      const ep = ed && P.parseEpisode(ed.filename);
      if (ep && ep.episodes) return 'tv';
    }
  }
  return 'movie';
}

function categoriesFor(kind, resolution) {
  const parent = kind === 'tv' ? CAT.TV : CAT.MOVIES;
  if (resolution === '2160p') return [parent, kind === 'tv' ? CAT.TV_UHD : CAT.MOVIES_UHD];
  if (resolution === '1080p' || resolution === '720p') return [parent, kind === 'tv' ? CAT.TV_HD : CAT.MOVIES_HD];
  return [parent];
}

// Construye un título de release al estilo «escena»:
//   Original.Title.S02E01.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare
//   Original.Title.2025.2160p.WEBRip.Micro4K.HDR10+.x265.AAC.SPANISH.ENGLISH-HispaShare
function buildReleaseTitle(parts) {
  const seg = [P.sceneName(parts.name) || 'Unknown'];
  if (parts.kind === 'episode') {
    seg.push(`S${pad2(parts.season)}` + parts.episodes.map((e) => `E${pad2(e)}`).join(''));
  } else if (parts.kind === 'season') {
    seg.push(`S${pad2(parts.season)}`);
  } else if (parts.kind === 'complete') {
    seg.push('Complete');
  } else if (parts.year) {
    seg.push(String(parts.year));
  }
  if (parts.part) seg.push(`Part${parts.part}`);
  for (const t of [parts.resolution, parts.source, parts.tag, ...(parts.hdr || []), parts.vcodec, parts.acodec, ...(parts.langs || [])]) {
    if (t) seg.push(t);
  }
  return seg.join('.').replace(/\.{2,}/g, '.') + `-${parts.group}`;
}

// Convierte un título de Hispashare en resultados (uno por elink).
function itemsFromTitle(title, cfg) {
  const kind = titleKind(title);
  if (!kind) return [];
  const name = (title.original_title || '').trim() || (title.title || '').trim();
  const imdb = imdbDigits(title.imdb_id);
  const items = [];

  // Temporadas que ya tienen capítulos numerados en este título: un archivo
  // sin número de esas temporadas (making of, especial...) no es un pack.
  const seasonsWithEpisodes = new Set();
  if (kind === 'tv') {
    for (const r of title.releases || []) {
      for (const link of r.elinks || []) {
        const ed = P.parseEd2k(link);
        const ep = ed && P.parseEpisode(ed.filename);
        if (ep && ep.episodes) seasonsWithEpisodes.add(ep.season);
      }
    }
  }

  for (const rel of title.releases || []) {
    const links = (rel.elinks || []).map(P.ed2kToMagnet).filter(Boolean)
      .filter((l) => !NON_VIDEO_EXT.test(l.filename));
    const multiPartMovie = kind === 'movie' && links.length > 1;

    links.forEach((l, idx) => {
      const resolution = P.parseResolution(rel.release_info) || P.parseResolution(l.filename);
      let { source, tag } = P.parseSource(rel.release_info, cfg.sourceMap);
      if (!source && !tag) ({ source } = P.parseSource(l.filename, {}));
      const vcodec = P.normalizeVideoCodec(rel.codec_video) ||
        (/x265|h\.?265|hevc/i.test(l.filename) ? 'x265' : /x264|h\.?264|avc/i.test(l.filename) ? 'x264' : null);

      const parts = {
        name,
        resolution,
        source,
        tag,
        hdr: P.parseHdr(rel.release_info),
        vcodec,
        acodec: P.normalizeAudioCodec(rel.codec_audio),
        langs: P.parseLanguages(rel.language),
        group: cfg.releaseGroup,
      };

      let season = null;
      let episodes = null;
      if (kind === 'tv') {
        const ep = P.parseEpisode(l.filename);
        if (ep && ep.episodes) {
          parts.kind = 'episode';
          season = ep.season;
          episodes = ep.episodes;
        } else if (ep && ep.pack && seasonsWithEpisodes.has(ep.season)) {
          log.debug(`Título ${title.id}: «${l.filename}» parece un extra de la temporada ${ep.season}; se omite`);
          return;
        } else if (ep && ep.pack) {
          parts.kind = 'season';
          season = ep.season;
        } else {
          parts.kind = 'complete';
        }
        parts.season = season;
        parts.episodes = episodes;
      } else {
        parts.kind = 'movie';
        parts.year = title.production_year;
        if (multiPartMovie) parts.part = idx + 1;
      }

      const pub = Date.parse(rel.date || title.updated_at);
      items.push({
        title: buildReleaseTitle(parts),
        fileName: l.filename,
        guid: l.magnetHash,
        magnet: l.magnet,
        size: l.size,
        pubDate: Number.isFinite(pub) ? new Date(pub) : new Date(0),
        categories: categoriesFor(kind, resolution),
        kind: parts.kind,
        mediaKind: kind,
        season,
        episodes,
        imdb,
        imdbId: imdb ? `tt${imdb}` : null,
        titleId: title.id,
        year: title.production_year,
        comments: `${cfg.siteUrl}/?view=title&id=${title.id}`,
        description: `${title.title || name} — ${l.filename}`,
      });
    });

    if ((rel.elinks || []).length && !links.length) {
      log.debug(`Título ${title.id}: release sin enlaces ed2k válidos`);
    }
  }
  return items;
}

module.exports = { CAT, itemsFromTitle, buildReleaseTitle, titleKind, categoriesFor, imdbDigits };
