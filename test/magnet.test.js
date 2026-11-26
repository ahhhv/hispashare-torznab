'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { parseEd2k, ed2kToMagnet } = require('../src/parse');

// Réplica de convertMagnetToEd2k de aMuTorrent (server/lib/linkConverter.js):
// quita los 8 ceros, decodifica dn y monta el ed2k.
function amutorrentMagnetToEd2k(magnetLink) {
  const params = new URLSearchParams(magnetLink.split('?')[1] || '');
  const m = (params.get('xt') || '').match(/urn:btih:([a-fA-F0-9]{40})/i);
  if (!m) throw new Error('no btih');
  const magnetHash = m[1].toLowerCase();
  if (!magnetHash.endsWith('00000000')) throw new Error('sin relleno ed2k');
  const hash = magnetHash.substring(0, 32);
  const fileName = decodeURIComponent(params.get('dn') || 'unknown');
  const fileSize = params.get('xl') || '0';
  return { ed2kLink: `ed2k://|file|${fileName}|${fileSize}|${hash}|/`, hash, fileName, fileSize: Number(fileSize) };
}

// Réplica fiel de extractFileRefFromMagnet + parseEd2kLink + hashToBtih de Mularr
// (backend/src/controllers/qbittorrentMappings.ts y backend/src/tools/eD2kTools.ts).
function mularrHashToBtih(hash) {
  return crypto.createHash('sha1').update(hash.toLowerCase()).digest('hex');
}

function mularrParseEd2kLink(link) {
  const m = link.match(/^ed2k:\/\/\|file\|([^|]+)\|(\d+)\|([a-fA-F0-9]{32})\|/);
  if (!m) return null;
  return {
    name: decodeURIComponent(m[1]),
    size: parseInt(m[2], 10),
    hash: m[3].toLowerCase(),
  };
}

function mularrExtractFromMagnet(magnet) {
  if (!magnet.startsWith('magnet:?')) return null;
  const query = magnet.substring('magnet:?'.length);
  const params = new URLSearchParams(query);
  const btihMatch = (params.get('xt') || '').match(/urn:btih:([a-fA-F0-9]{40})/i);
  if (!btihMatch) throw new Error('no btih');
  const dn = params.get('dn');
  if (!dn) return null;
  const decoded = decodeURIComponent(dn);
  const ed2k = mularrParseEd2kLink(decoded);
  if (!ed2k) throw new Error(`ed2k inválido en dn: ${decoded}`);
  return {
    btih: btihMatch[1].toLowerCase(),
    ref: decoded,
    hash: ed2k.hash,
    fileName: ed2k.name,
    fileSize: ed2k.size,
  };
}

test('formato exacto del magnet de aMuTorrent', () => {
  const link = 'ed2k://|file|Example.Title.2025.H.264-AAC.mkv|2147483648|0123456789ABCDEF0123456789ABCDEF|/';
  const r = ed2kToMagnet(link);
  assert.equal(
    r.magnet,
    'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef00000000&dn=Example.Title.2025.H.264-AAC.mkv&xl=2147483648',
  );
  assert.equal(r.magnetHash.length, 40);
});

test('ida y vuelta con nombres codificados (%C3%B3) y caracteres especiales', () => {
  const cases = [
    ['El instituto 2x01 Ajuste de cuentas.mkv', false],
    ['El instituto 2x02 La revelación.mkv', true],
    ['Pelí & cula (2025) [x265] #1 + 50%.mkv', false],
    ['Ñandú; ¿qué?=sí.avi', true],
  ];
  for (const [name, encode] of cases) {
    const raw = encode ? encodeURIComponent(name) : name;
    const ed2k = `ed2k://|file|${raw}|123456|ABCDEFABCDEFABCDEFABCDEFABCDEF12|/`;
    const { magnet } = ed2kToMagnet(ed2k);
    const back = amutorrentMagnetToEd2k(magnet);
    assert.equal(back.hash, 'abcdefabcdefabcdefabcdefabcdef12');
    assert.equal(back.fileName, name, `nombre: ${name}`);
    assert.equal(back.fileSize, 123456);
    assert.equal(back.ed2kLink, `ed2k://|file|${name}|123456|abcdefabcdefabcdefabcdefabcdef12|/`);
  }
});

test('nombre con % suelto: se conserva tal cual, como hace aMuTorrent', () => {
  const p = parseEd2k('ed2k://|file|50%OFF Movie.avi|10|0123456789ABCDEF0123456789ABCDEF|/');
  assert.equal(p.filename, '50%OFF Movie.avi');
  const back = amutorrentMagnetToEd2k(ed2kToMagnet('ed2k://|file|50%OFF Movie.avi|10|0123456789ABCDEF0123456789ABCDEF|/').magnet);
  assert.equal(back.fileName, '50%OFF Movie.avi');
});

test('ed2k inválido → null', () => {
  assert.equal(parseEd2k('http://example.com'), null);
  assert.equal(ed2kToMagnet('ed2k://|file|x|10|XYZ|/'), null);
  assert.equal(ed2kToMagnet('ed2k://|file|x|10|XYZ|/', 'mularr'), null);
});

test('formato exacto del magnet de Mularr', () => {
  const link = 'ed2k://|file|Example.Title.2025.H.264-AAC.mkv|2147483648|0123456789ABCDEF0123456789ABCDEF|/';
  const r = ed2kToMagnet(link, 'mularr');
  const expectedBtih = mularrHashToBtih('0123456789abcdef0123456789abcdef');
  assert.equal(r.magnetHash, expectedBtih);
  assert.equal(r.magnetHash.length, 40);
  assert.equal(
    r.magnet,
    `magnet:?xt=urn:btih:${expectedBtih}&dn=${encodeURIComponent(link)}`,
  );
});

test('Mularr: ida y vuelta con nombres codificados, caracteres especiales y %', () => {
  const cases = [
    ['El instituto 2x01 Ajuste de cuentas.mkv', false],
    ['El instituto 2x02 La revelación.mkv', true],
    ['Pelí & cula (2025) [x265] #1 + 50%.mkv', false],
    ['Ñandú; ¿qué?=sí.avi', true],
    ['50%OFF Movie.avi', false],
  ];
  for (const [name, encode] of cases) {
    const raw = encode ? encodeURIComponent(name) : name;
    const ed2k = `ed2k://|file|${raw}|123456|ABCDEFABCDEFABCDEFABCDEFABCDEF12|/`;
    const { magnet, magnetHash } = ed2kToMagnet(ed2k, 'mularr');
    const back = mularrExtractFromMagnet(magnet);
    assert.equal(back.hash, 'abcdefabcdefabcdefabcdefabcdef12');
    assert.equal(back.btih, mularrHashToBtih(back.hash));
    assert.equal(back.btih, magnetHash);
    assert.equal(back.fileName, name, `nombre: ${name}`);
    assert.equal(back.fileSize, 123456);
  }
});

test('cliente de descargas inválido lanza error', () => {
  const link = 'ed2k://|file|a.mkv|10|0123456789ABCDEF0123456789ABCDEF|/';
  assert.throws(() => ed2kToMagnet(link, 'otro'), /no soportado/i);
});
