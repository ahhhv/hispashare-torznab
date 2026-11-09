'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/parse');
const { buildReleaseTitle, itemsFromTitle } = require('../src/release');
const { parseQuery, normalizeImdb } = require('../src/search');
const config = require('../src/config');

test('capítulos con formato NxNN', () => {
  assert.deepEqual(P.parseEpisode('El instituto 2x01 Ajuste de cuentas.mkv'), { season: 2, episodes: [1] });
  assert.deepEqual(P.parseEpisode('Serie 1x105 Capítulo largo.avi'), { season: 1, episodes: [105] });
  assert.deepEqual(P.parseEpisode('Serie 2x07-08 Final.mkv'), { season: 2, episodes: [7, 8] });
  assert.deepEqual(P.parseEpisode('Serie 2x07-2x08 Final.mkv'), { season: 2, episodes: [7, 8] });
  assert.deepEqual(P.parseEpisode('Serie 10X03.mkv'), { season: 10, episodes: [3] });
});

test('«2x01 - 23 de enero» no es un rango', () => {
  assert.deepEqual(P.parseEpisode('Serie 2x01 - 23 de enero.mkv'), { season: 2, episodes: [1] });
});

test('capítulos con formato SxxEyy', () => {
  assert.deepEqual(P.parseEpisode('Show.S02E01.1080p.mkv'), { season: 2, episodes: [1] });
  assert.deepEqual(P.parseEpisode('Show S1E5.mkv'), { season: 1, episodes: [5] });
  assert.deepEqual(P.parseEpisode('Show.S03E01E02.mkv'), { season: 3, episodes: [1, 2] });
  assert.deepEqual(P.parseEpisode('Show.S03E01-E03.mkv'), { season: 3, episodes: [1, 2, 3] });
});

test('la resolución 1920x1080 no se confunde con un capítulo', () => {
  assert.equal(P.parseEpisode('Pelicula 1920x1080.mkv'), null);
  assert.equal(P.parseEpisode('Pelicula x264 5.1.mkv'), null);
});

test('archivos sin capítulo: temporada o nada', () => {
  assert.deepEqual(P.parseEpisode('El instituto Temporada 2.mkv'), { season: 2, pack: true });
  assert.deepEqual(P.parseEpisode('El instituto Temp. 3 completa.mkv'), { season: 3, pack: true });
  assert.deepEqual(P.parseEpisode('El instituto T4.mkv'), { season: 4, pack: true });
  assert.deepEqual(P.parseEpisode('Show S05 Complete.mkv'), { season: 5, pack: true });
  assert.equal(P.parseEpisode('El instituto Especial Navidad.mkv'), null);
});

test('resolución, fuente (con SOURCE_MAP) y HDR', () => {
  const map = config.parseSourceMap('Micro4K:WEBRip,MicroHD:WEBRip');
  assert.equal(P.parseResolution('Micro4K 2160p HDR10+'), '2160p');
  assert.equal(P.parseResolution('MicroHD'), null);
  assert.equal(P.parseResolution('Micro4K'), '2160p');
  assert.deepEqual(P.parseSource('WEBRip 1080p', map), { source: 'WEBRip', tag: null });
  assert.deepEqual(P.parseSource('WEB-DL 720p', map), { source: 'WEB-DL', tag: null });
  assert.deepEqual(P.parseSource('BDRemux 1080p', map), { source: 'BluRay.REMUX', tag: null });
  assert.deepEqual(P.parseSource('Micro4K 2160p HDR10+', map), { source: 'WEBRip', tag: 'Micro4K' });
  assert.deepEqual(P.parseSource('MicroHD 1080p', config.parseSourceMap('MicroHD:BluRay')), { source: 'BluRay', tag: 'MicroHD' });
  assert.deepEqual(P.parseSource('Raro 1080p', map), { source: null, tag: 'Raro' });
  assert.deepEqual(P.parseHdr('Micro4K 2160p HDR10+ DV 10bits'), ['HDR10+', 'DV', '10bit']);
});

test('códecs normalizados', () => {
  assert.equal(P.normalizeVideoCodec('H.264'), 'x264');
  assert.equal(P.normalizeVideoCodec('H.265'), 'x265');
  assert.equal(P.normalizeVideoCodec('HEVC'), 'x265');
  assert.equal(P.normalizeVideoCodec(''), null);
  assert.equal(P.normalizeAudioCodec('AAC'), 'AAC');
  assert.equal(P.normalizeAudioCodec('AC3 5.1'), 'AC3.5.1');
  assert.equal(P.normalizeAudioCodec('E-AC3'), 'DDP');
  assert.equal(P.normalizeAudioCodec('DTS-HD MA 7.1'), 'DTS-HD.MA.7.1');
});

test('idiomas en mayúsculas; solo subtítulos → SUBS', () => {
  assert.deepEqual(P.parseLanguages(['Spanish', 'English']), ['SPANISH', 'ENGLISH']);
  assert.deepEqual(P.parseLanguages(['Español', 'Inglés']), ['SPANISH', 'ENGLISH']);
  assert.deepEqual(P.parseLanguages(['English Subtitles']), ['SUBS']);
  assert.deepEqual(P.parseLanguages(['Spanish', 'English Subtitles']), ['SPANISH']);
  assert.deepEqual(P.parseLanguages([]), []);
});

test('títulos de release', () => {
  const base = { group: 'HispaShare', resolution: '1080p', source: 'WEB-DL', vcodec: 'x264', acodec: 'AAC', langs: ['SPANISH'] };
  assert.equal(
    buildReleaseTitle({ ...base, name: 'Original Title', kind: 'episode', season: 2, episodes: [1] }),
    'Original.Title.S02E01.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare',
  );
  assert.equal(
    buildReleaseTitle({ ...base, name: 'La casa de papel: Corea', kind: 'season', season: 1 }),
    'La.casa.de.papel.Corea.S01.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare',
  );
  assert.equal(
    buildReleaseTitle({
      group: 'HispaShare', name: 'Original Title', kind: 'movie', year: 2025, resolution: '2160p',
      source: 'WEBRip', tag: 'Micro4K', hdr: ['HDR10+'], vcodec: 'x265', acodec: 'AAC', langs: ['SPANISH', 'ENGLISH'],
    }),
    'Original.Title.2025.2160p.WEBRip.Micro4K.HDR10+.x265.AAC.SPANISH.ENGLISH-HispaShare',
  );
  assert.equal(P.sceneName('Ñoños & Cía'), 'Nonos.and.Cia');
});

test('original_title vacío → se usa title', () => {
  const cfg = config.load({});
  const items = itemsFromTitle({
    id: 1, imdb_id: null, title: 'Título en castellano', original_title: '', production_year: 2020, type: 'movie',
    updated_at: '2026-01-01T00:00:00Z',
    releases: [{ date: '2026-01-01T00:00:00Z', codec_video: 'H.264', codec_audio: 'AAC', language: ['Spanish'], format: 'mkv',
      release_info: 'WEBRip 1080p', size: '10', elinks: ['ed2k://|file|a.mkv|10|0123456789ABCDEF0123456789ABCDEF|/'] }],
  }, cfg);
  assert.equal(items[0].title, 'Titulo.en.castellano.2020.1080p.WEBRip.x264.AAC.SPANISH-HispaShare');
});

test('consulta libre: capítulo, temporada y año', () => {
  assert.deepEqual(parseQuery('El instituto 2x01'), { text: 'El instituto', season: 2, ep: 1, year: null });
  assert.deepEqual(parseQuery('El instituto S02E01'), { text: 'El instituto', season: 2, ep: 1, year: null });
  assert.deepEqual(parseQuery('El instituto S02'), { text: 'El instituto', season: 2, ep: null, year: null });
  assert.deepEqual(parseQuery('The Last Frontier 2025'), { text: 'The Last Frontier', season: null, ep: null, year: 2025 });
  assert.deepEqual(parseQuery('1917'), { text: '1917', season: null, ep: null, year: null });
});

test('imdbid normalizado', () => {
  assert.equal(normalizeImdb('tt0116213'), 'tt0116213');
  assert.equal(normalizeImdb('116213'), 'tt0116213');
  assert.equal(normalizeImdb('abc'), null);
});
