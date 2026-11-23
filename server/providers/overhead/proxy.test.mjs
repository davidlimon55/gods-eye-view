import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouteLimiter, overheadProxy } from './proxy.js';

function fakeFeeds() {
  return {
    catalog: async () => ({ count: 1, body: '{"objects":[]}' }),
    aircraft: { near: async (lat, lon) => ({ at: 1, state: 'MISS', value: { ac: [{ lat, lon }] } }), status: () => ({}) },
    launches: { get: async () => ({ at: 1, state: 'HIT', value: [] }), status: () => ({}) },
    fireballs: { get: async () => ({ at: 1, state: 'HIT', value: [] }), status: () => ({}) },
    routes: { lookup: async (planes) => ({ state: 'MISS', routes: { [planes[0].callsign]: { known: false, reason: 'unknown', seen: planes[0] } } }), status: () => ({}) },
    object: async (id) => ({ found: id === '25544', loaded: true, id }),
    cache: { usage: async () => ({ bytes: 0 }) },
    status: () => [],
  };
}

function install() {
  const handlers = [];
  const plugin = overheadProxy({ feeds: fakeFeeds(), env: {} });
  plugin.configurePreviewServer({
    middlewares: {
      use: (route, handler) => handlers.push(handler ? { route, handler } : { route: '', handler: route }),
    },
  });
  return async (url, { method = 'GET', headers = {} } = {}) => {
    const mount = handlers.find((h) => h.route && url.startsWith(h.route));
    const short = handlers.find((h) => !h.route);
    const result = { status: 0, headers: {}, body: '' };
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
      writeHead(status, head = {}) { result.status = status; for (const [k, v] of Object.entries(head)) result.headers[k.toLowerCase()] = v; this.headersSent = true; },
      end(body = '') { if (!result.status) result.status = this.statusCode; result.body = String(body); },
    };
    const req = { url: mount ? url.slice(mount.route.length) || '/' : url, method, headers: { host: 'localhost:4173', ...headers }, socket: {} };
    let passed = false;
    if (mount) await mount.handler(req, res, () => (passed = true));
    else await short.handler(req, res, () => (passed = true));
    return { ...result, passed };
  };
}

test('routes validate input and refuse other methods and cross-site callers', async () => {
  const request = install();
  assert.equal((await request('/api/overhead/catalog')).status, 200);
  assert.equal((await request('/api/overhead/aircraft?lat=29.6&lon=-98.4')).status, 200);
  assert.equal((await request('/api/overhead/aircraft?lat=999&lon=0')).status, 400);
  assert.equal((await request('/api/overhead/aircraft?lat=29.6')).status, 400);
  assert.equal((await request('/api/overhead/catalog', { method: 'POST' })).status, 405);
  assert.equal((await request('/api/overhead/nope')).status, 404);
  assert.equal((await request('/api/overhead/status', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
});

test('route and catalog lookups take only checked values', async () => {
  const request = install();
  const r = await request('/api/overhead/routes?cs=DAL2009&lat=29.4&lon=-98.5&track=40');
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).route.seen, { callsign: 'DAL2009', lat: 29.4, lon: -98.5, track: 40 });
  assert.equal((await request('/api/overhead/routes?cs=DAL2009&lat=x&lon=1')).status, 400);
  assert.equal((await request('/api/overhead/routes?lat=1&lon=1')).status, 400);
  assert.equal(JSON.parse((await request('/api/overhead/object?id=25544')).body).found, true);
  assert.equal(JSON.parse((await request('/api/overhead/object?id=c37162')).body).id, '37162');
  assert.equal((await request('/api/overhead/object?id=../etc')).status, 400);
});

test('the short links open the light page', async () => {
  const request = install();
  const a = await request('/overhead');
  assert.equal(a.status, 302);
  assert.equal(a.headers.location, '/overhead.html');
  assert.equal((await request('/?view=overhead')).headers.location, '/overhead.html');
  assert.equal((await request('/?view=other')).passed, true);
});

test('each route has a per-minute limit', () => {
  let clock = 0;
  const allow = createRouteLimiter({ catalog: 2 }, () => clock);
  assert.equal(allow('catalog'), true);
  assert.equal(allow('catalog'), true);
  assert.equal(allow('catalog'), false);
  clock += 60000;
  assert.equal(allow('catalog'), true);
});
