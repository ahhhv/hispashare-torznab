'use strict';

// Pruebas de extremo a extremo contra el servidor simulado de la API.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockServer } = require('../mock/server');
const { createServer } = require('../src/server');
const { HispashareClient } = require('../src/hispashare');
const config = require('../src/config');
const log = require('../src/log');

log.setLevel('silent');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

// Comprobación mínima de XML bien formado: etiquetas equilibradas y sin «&» sueltos.
function assertWellFormed(xml) {
  const body = xml.replace(/<\?xml[^>]*\?>/, '');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;)/.test(body), 'hay un & sin escapar');
  const stack = [];
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w:.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(\/?)>/g)) {
    const [, close, name, , self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), name, `cierre inesperado </${name}>`);
    else stack.push(name);
  }
  assert.deepEqual(stack, [], 'etiquetas sin cerrar');
}

const titles = (xml) => [...xml.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]).slice(1);
const attrs = (xml, name) => [...xml.matchAll(new RegExp(`name="${name}" value="([^"]*)"`, 'g'))].map((m) => m[1]);

async function setup(mockOpts = {}, envExtra = {}) {
  const mock = createMockServer({ token: 'tok', ...mockOpts });
  const mockPort = await listen(mock);
  const cfg = config.load({
    HISPASHARE_TOKEN: 'tok', HISPASHARE_API_URL: `http://127.0.0.1:${mockPort}`, TORZNAB_APIKEY: 'secret', ...envExtra,
  });
  const client = new HispashareClient(cfg);
  const server = createServer(cfg, { client });
  const port = await listen(server);
  const get = async (qs) => {
    const r = await fetch(`http://127.0.0.1:${port}/api?apikey=secret&${qs}`);
    return { status: r.status, headers: r.headers, xml: await r.text() };
  };
  return { mock, server, client, get, close: () => { mock.close(); server.close(); } };
}

test('caps', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { status, xml } = await s.get('t=caps');
  assert.equal(status, 200);
  assertWellFormed(xml);
  assert.match(xml, /<tv-search available="yes" supportedParams="q,season,ep,imdbid"\/>/);
  assert.match(xml, /<movie-search available="yes" supportedParams="q,imdbid"\/>/);
  for (const id of [2000, 2040, 2045, 5000, 5040, 5045]) assert.match(xml, new RegExp(`id="${id}"`));
});

test('apikey incorrecta → error 100', async (t) => {
  const s = await setup();
  t.after(s.close);
  const r = await fetch(s.server.address().port ? `http://127.0.0.1:${s.server.address().port}/api?t=caps&apikey=mal` : '');
  assert.equal(r.status, 401);
  assert.match(await r.text(), /code="100"/);
});

test('tvsearch con imdbid, season y ep', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { xml } = await s.get('t=tvsearch&imdbid=tt9900001&season=2&ep=1');
  assertWellFormed(xml);
  assert.deepEqual(titles(xml), ['El.instituto.S02E01.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare']);
  assert.deepEqual(attrs(xml, 'imdb'), ['9900001']);
  assert.deepEqual(attrs(xml, 'imdbid'), ['tt9900001']);
  assert.deepEqual(attrs(xml, 'category'), ['5000', '5040']);
  assert.deepEqual(attrs(xml, 'seeders'), ['10']);
  assert.match(xml, /<pubDate>Sun, 01 Nov 2026 20:00:00 GMT<\/pubDate>/);
  assert.match(xml, /<comments>https:\/\/www\.hispashare\.org\/\?view=title&amp;id=50001<\/comments>/);
  assert.match(xml, /<link>magnet:\?xt=urn:btih:[0-9a-f]{32}00000000&amp;dn=El%20instituto%202x01%20Ajuste%20de%20cuentas\.mkv&amp;xl=1503238553<\/link>/);
});

test('tvsearch multicapítulo: el ep 8 está en el archivo 2x07-08', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { xml } = await s.get('t=tvsearch&imdbid=9900001&season=2&ep=8');
  assert.deepEqual(titles(xml), ['El.instituto.S02E07E08.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare']);
});

test('tvsearch por temporada: capítulos sí, extras no; pack de temporada 1', async (t) => {
  const s = await setup();
  t.after(s.close);
  const s2 = titles((await s.get('t=tvsearch&imdbid=tt9900001&season=2')).xml);
  assert.equal(s2.length, 7);
  assert.ok(s2.every((x) => /S02E\d\d/.test(x)), 'el «Making of» no debe salir como pack');
  const s1 = titles((await s.get('t=tvsearch&imdbid=tt9900001&season=1')).xml);
  assert.deepEqual(s1, ['El.instituto.S01.1080p.WEBRip.MicroHD.x265.AC3.5.1.SPANISH-HispaShare']);
});

test('tvsearch por texto (sin imdbid) y búsqueda libre «2x01»', async (t) => {
  const s = await setup();
  t.after(s.close);
  const a = titles((await s.get('t=tvsearch&q=northern%20lighthouse&season=1&ep=3')).xml);
  assert.deepEqual(a, ['Northern.Lighthouse.S01E03.2160p.WEBRip.HDR10+.x265.DDP.SPANISH.ENGLISH-HispaShare']);
  const b = titles((await s.get('t=tvsearch&q=Faro%20del%20Norte')).xml);
  assert.equal(b.length, 1, 'el título en castellano también encuentra la serie');
  const c = titles((await s.get('t=search&q=el%20instituto%202x03')).xml);
  assert.deepEqual(c, ['El.instituto.S02E03.1080p.WEB-DL.x264.AAC.SPANISH-HispaShare']);
  const d = titles((await s.get('t=search&q=el%20instituto')).xml);
  assert.ok(d.includes('El.instituto.Complete.1080p.WEBRip.MicroHD.x265.AC3.5.1.SPANISH-HispaShare'), 'el especial sale en la búsqueda de texto');
});

test('movie con imdbid: dos versiones, UHD y HD', async (t) => {
  const s = await setup();
  t.after(s.close);
  const { xml } = await s.get('t=movie&imdbid=tt9900003');
  assertWellFormed(xml);
  assert.deepEqual(titles(xml), [
    'The.Last.Frontier.2025.2160p.WEBRip.Micro4K.HDR10+.DV.10bit.x265.AAC.SPANISH.ENGLISH-HispaShare',
    'The.Last.Frontier.2025.1080p.BDRip.x264.AC3.SPANISH-HispaShare',
  ]);
  assert.deepEqual(attrs(xml, 'category'), ['2000', '2045', '2000', '2040']);
  // el nombre con «ú» viaja codificado en dn
  assert.match(xml, /dn=La%20%C3%BAltima%20frontera%20\(2025\)%20Micro4K\.mkv/);
});

test('movie no devuelve series y tvsearch no devuelve películas', async (t) => {
  const s = await setup();
  t.after(s.close);
  assert.equal(titles((await s.get('t=movie&imdbid=tt9900001')).xml).length, 0);
  assert.equal(titles((await s.get('t=tvsearch&imdbid=tt9900003')).xml).length, 0);
});

test('SOURCE_MAP configurable', async (t) => {
  const s = await setup({}, { SOURCE_MAP: 'Micro4K:BluRay' });
  t.after(s.close);
  const x = titles((await s.get('t=movie&imdbid=tt9900003')).xml);
  assert.equal(x[0], 'The.Last.Frontier.2025.2160p.BluRay.Micro4K.HDR10+.DV.10bit.x265.AAC.SPANISH.ENGLISH-HispaShare');
});

test('RSS: sin parámetros, sin música, sin subtítulos y sin «Complete»', async (t) => {
  const s = await setup();
  t.after(s.close);
  for (const q of ['t=search', 't=tvsearch&cat=5000', 't=movie&cat=2000']) {
    const { xml } = await s.get(q);
    assertWellFormed(xml);
    const tt = titles(xml);
    assert.ok(tt.length > 0, q);
    assert.ok(!tt.some((x) => /Concierto|Complete|\.srt/i.test(x)), q);
  }
  const tv = titles((await s.get('t=tvsearch')).xml);
  assert.ok(tv.every((x) => /S\d\d/.test(x)));
  // ordenado por fecha: lo más reciente primero
  assert.equal(titles((await s.get('t=search')).xml)[0], 'Northern.Lighthouse.S01E03.2160p.WEBRip.HDR10+.x265.DDP.SPANISH.ENGLISH-HispaShare');
});

test('caché: la misma búsqueda no vuelve a llamar a la API', async (t) => {
  const s = await setup();
  t.after(s.close);
  await s.get('t=movie&imdbid=tt9900003');
  await s.get('t=movie&imdbid=tt9900003');
  await s.get('t=search');
  await s.get('t=tvsearch');
  assert.equal(s.mock.state.requests, 2);
});

test('MAX_PAGES limita la paginación', async (t) => {
  const s = await setup({ pageSize: 5 }, { MAX_PAGES: '2', RSS_PAGES: '3' });
  t.after(s.close);
  await s.get('t=search&q=e'); // coincide con muchos títulos
  assert.equal(s.mock.state.requests, 2);
  await s.get('t=search');
  assert.equal(s.mock.state.requests, 5);
  assert.ok(s.mock.state.paths.some((p) => p.includes('cursor=')), 'usa next_cursor');
});

test('429: respeta Retry-After, no reintenta y sirve caché caducada', async (t) => {
  const s = await setup({ rateLimit: 1, retryAfter: 30 }, { CACHE_TTL: '0', RSS_CACHE_TTL: '0' });
  t.after(s.close);

  const first = await s.get('t=movie&imdbid=tt9900003');
  assert.equal(titles(first.xml).length, 2);
  assert.equal(s.mock.state.requests, 1);

  // Caché caducada (TTL 0) + 429 → se sirve la copia caducada
  const second = await s.get('t=movie&imdbid=tt9900003');
  assert.equal(second.status, 200);
  assert.equal(titles(second.xml).length, 2);
  assert.equal(s.mock.state.requests, 2);

  // Durante el bloqueo no se llama a la API; sin caché → 429 con Retry-After
  const third = await s.get('t=tvsearch&imdbid=tt9900001');
  assert.equal(third.status, 429);
  assert.ok(Number(third.headers.get('retry-after')) > 0 && Number(third.headers.get('retry-after')) <= 30);
  assert.match(third.xml, /<error code="900"/);
  // la copia caducada sigue sirviéndose sin tocar la API
  assert.equal((await s.get('t=movie&imdbid=tt9900003')).status, 200);
  assert.equal(s.mock.state.requests, 2, 'no se hacen peticiones mientras dura Retry-After');
});

test('token inválido → error Torznab, sin filtrar el token', async (t) => {
  const s = await setup();
  t.after(s.close);
  s.client.cfg = { ...s.client.cfg, token: 'mal-token' };
  const { xml } = await s.get('t=movie&imdbid=tt9900003');
  assert.match(xml, /<error code="900" description="Token de Hispashare inválido/);
  assert.ok(!xml.includes('mal-token'));
});

test('el log nunca muestra el token', () => {
  log.addSecret('super-token-123');
  assert.equal(log.redact('Bearer super-token-123'), 'Bearer ***');
});
