'use strict';

// Datos de ejemplo con la forma del OpenAPI de Hispashare (todo inventado).
const crypto = require('node:crypto');

const hash = (s) => crypto.createHash('md5').update(s).digest('hex').toUpperCase();

// Igual que en Hispashare: el nombre puede venir con %XX.
function elink(name, size, { encode = false } = {}) {
  const n = encode ? encodeURIComponent(name).replace(/%20/g, ' ') : name;
  return `ed2k://|file|${n}|${size}|${hash(name)}|/`;
}

const GB = 1024 ** 3;

const titles = [
  // 1) Serie con temporada 2 completa (8 capítulos) + un archivo «Temporada 2» sin número
  {
    id: 50001,
    imdb_id: 'tt9900001',
    imdb_score: 74,
    title: 'El instituto',
    original_title: 'El instituto',
    synopsis: 'Serie de ejemplo con una temporada completa.',
    directors: ['Directora Ejemplo'],
    production_year: 2024,
    type: 'series',
    cover: 'https://www.hispashare.org/images/titles/50001/cover.jpg',
    updated_at: '2026-11-01T20:00:00Z',
    releases: [
      {
        date: '2026-11-01T20:00:00Z',
        codec_video: 'H.264',
        codec_audio: 'AAC',
        language: ['Spanish'],
        format: 'mkv',
        release_info: 'WEB-DL 1080p',
        size: String(Math.round(8 * 1.4 * GB)),
        elinks: [
          elink('El instituto 2x01 Ajuste de cuentas.mkv', 1503238553, { encode: true }),
          elink('El instituto 2x02 La revelación.mkv', 1503238554, { encode: true }),
          elink('El instituto 2x03 Exámenes.mkv', 1503238555, { encode: true }),
          elink('El instituto 2x04 Fuga.mkv', 1503238556),
          elink('El instituto 2x05 El viaje.mkv', 1503238557),
          elink('El instituto 2x06 Secretos.mkv', 1503238558),
          elink('El instituto 2x07-08 Final de temporada.mkv', 2903238559),
          elink('El instituto 2x01 Ajuste de cuentas.srt', 51234),
        ],
      },
      {
        date: '2026-10-20T18:00:00Z',
        codec_video: 'H.265',
        codec_audio: 'AC3 5.1',
        language: ['Spanish', 'English Subtitles'],
        format: 'mkv',
        release_info: 'MicroHD 1080p',
        size: String(6 * GB),
        elinks: [
          // extra de una temporada que ya tiene capítulos → se omite
          elink('El instituto Temporada 2 Making of.mkv', 734003200),
          // temporada 1 en un solo archivo → pack S01
          elink('El instituto Temporada 1 completa.mkv', 9734003200),
          // sin temporada → «Complete», solo en búsquedas de texto
          elink('El instituto Especial Navidad.mkv', 634003200),
        ],
      },
    ],
  },

  // 2) Serie en emisión: un solo capítulo
  {
    id: 50002,
    imdb_id: 'tt9900002',
    imdb_score: 81,
    title: 'Faro del Norte',
    original_title: 'Northern Lighthouse',
    synopsis: 'Serie de ejemplo en emisión.',
    directors: ['Director Ejemplo'],
    production_year: 2026,
    type: 'series',
    cover: 'https://www.hispashare.org/images/titles/50002/cover.jpg',
    updated_at: '2026-11-08T21:30:00Z',
    releases: [
      {
        date: '2026-11-08T21:30:00Z',
        codec_video: 'HEVC',
        codec_audio: 'E-AC3',
        language: ['Spanish', 'English'],
        format: 'mkv',
        release_info: 'WEBRip 2160p HDR10+',
        size: '3221225472',
        elinks: [elink('Faro del Norte S01E03 La tormenta.mkv', 3221225472)],
      },
    ],
  },

  // 3) Película con dos versiones
  {
    id: 50003,
    imdb_id: 'tt9900003',
    imdb_score: 69,
    title: 'La última frontera',
    original_title: 'The Last Frontier',
    synopsis: 'Película de ejemplo con dos versiones.',
    directors: ['Directora Ejemplo'],
    production_year: 2025,
    type: 'movie',
    cover: 'https://www.hispashare.org/images/titles/50003/cover.jpg',
    updated_at: '2026-11-05T10:00:00Z',
    releases: [
      {
        date: '2026-11-05T10:00:00Z',
        codec_video: 'H.265',
        codec_audio: 'AAC',
        language: ['Spanish', 'English'],
        format: 'mkv',
        release_info: 'Micro4K 2160p HDR10+ DV 10bits',
        size: '8589934592',
        elinks: [elink('La última frontera (2025) Micro4K.mkv', 8589934592, { encode: true })],
      },
      {
        date: '2026-09-12T10:00:00Z',
        codec_video: 'H.264',
        codec_audio: 'AC3',
        language: ['Spanish'],
        format: 'mkv',
        release_info: 'BDRip 1080p',
        size: '2147483648',
        elinks: [elink('La última frontera (2025) BDRip 1080p.mkv', 2147483648, { encode: true })],
      },
    ],
  },

  // 4) Música: debe descartarse
  {
    id: 50004,
    imdb_id: null,
    imdb_score: 0,
    title: 'Concierto de ejemplo',
    original_title: 'Concierto de ejemplo',
    synopsis: '',
    directors: [],
    production_year: 2023,
    type: 'music',
    cover: 'https://www.hispashare.org/images/titles/50004/cover.jpg',
    updated_at: '2026-11-02T10:00:00Z',
    releases: [
      {
        date: '2026-11-02T10:00:00Z', codec_video: '', codec_audio: 'FLAC', language: [], format: 'flac',
        release_info: 'CD', size: '400000000', elinks: [elink('Concierto de ejemplo.flac', 400000000)],
      },
    ],
  },
];

// Relleno para probar la paginación del RSS (títulos sin releases).
for (let i = 1; i <= 25; i++) {
  titles.push({
    id: 51000 + i, imdb_id: null, imdb_score: 50, title: `Relleno ${i}`, original_title: `Filler ${i}`,
    synopsis: '', directors: [], production_year: 2000 + i, type: 'movie',
    cover: '', updated_at: `2026-0${1 + (i % 9)}-01T00:00:00Z`, releases: [],
  });
}

module.exports = { titles, elink, hash };
