import { admitSameSiteKeyless } from '../common/same-site.js';
import { createOverheadFeeds } from './feeds.js';
import { validLatitude, validLongitude } from './sources.js';
import { alertConfig, startAlertScheduler } from './alerts.js';
import { folderBytes } from './diskCache.js';
import path from 'node:path';

/** Requests per minute each route accepts from all callers together. */
const ROUTE_LIMITS = Object.freeze({
  catalog: 30,
  aircraft: 90,
  routes: 60,
  object: 120,
  launches: 60,
  fireballs: 60,
  status: 60,
});

/** A fixed-window limiter (one minute). */
export function createRouteLimiter(
  limits = ROUTE_LIMITS,
  now = () => Date.now(),
) {
  const windows = new Map();
  return (route) => {
    const minute = Math.floor(now() / 60000);
    const current = windows.get(route);
    if (!current || current.minute !== minute) {
      windows.set(route, { minute, count: 1 });
      return true;
    }
    current.count += 1;
    return current.count <= (limits[route] ?? 30);
  };
}

function sendJson(res, status, body, extra = {}) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

/**
 * Vite plugin for the Over My House feature:
 *
 *  GET /api/overhead/catalog    satellites, rocket bodies, debris (CelesTrak)
 *                               + hobbyist-tracked classified objects (McCants)
 *  GET /api/overhead/aircraft?lat=..&lon=..   aircraft within ~50 km (adsb.lol)
 *  GET /api/overhead/routes?cs=..&lat=..&lon=..&track=..   one plane's
 *                               route, from where to where (adsb.lol, cached)
 *  GET /api/overhead/object?id=25544   catalog facts for one object
 *                               (CelesTrak SATCAT, downloaded once a day)
 *  GET /api/overhead/launches   launches from 3 h ago to 36 h ahead (LL2)
 *  GET /api/overhead/fireballs  located fireballs, last 180 days (NASA/JPL CNEOS)
 *  GET /api/overhead/status     feed health, cache size and email-alert state
 *
 * And the short links `/overhead` and `/?view=overhead`, which redirect to
 * the light `/overhead.html` page.
 */
export function overheadProxy({
  feeds = createOverheadFeeds(),
  env = process.env,
} = {}) {
  const allow = createRouteLimiter();
  let alerts = null;

  const handler = async (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const route = url.pathname.replace(/^\/+|\/+$/g, '');
    if (!Object.hasOwn(ROUTE_LIMITS, route)) {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }
    if (admitSameSiteKeyless(req, res)) return;
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method Not Allowed' }, { Allow: 'GET' });
      return;
    }
    if (!allow(route)) {
      sendJson(
        res,
        429,
        { error: 'Too many requests' },
        { 'Retry-After': '60' },
      );
      return;
    }
    try {
      if (route === 'catalog') {
        const merged = await feeds.catalog();
        sendJson(
          res,
          merged.count ? 200 : 502,
          merged.count ? merged.body : { error: 'No satellite data yet' },
          {
            'Cache-Control': merged.count ? 'private, max-age=900' : 'no-store',
          },
        );
        return;
      }
      if (route === 'aircraft') {
        const lat = validLatitude(url.searchParams.get('lat'));
        const lon = validLongitude(url.searchParams.get('lon'));
        if (lat === null || lon === null) {
          sendJson(res, 400, { error: 'lat and lon are required numbers' });
          return;
        }
        const result = await feeds.aircraft.near(lat, lon);
        sendJson(res, 200, {
          at: result.at || null,
          state: result.state,
          ac: result.value?.ac ?? [],
        });
        return;
      }
      if (route === 'routes') {
        const lat = validLatitude(url.searchParams.get('lat'));
        const lon = validLongitude(url.searchParams.get('lon'));
        const callsign = url.searchParams.get('cs');
        if (lat === null || lon === null || !callsign) {
          sendJson(res, 400, { error: 'cs, lat and lon are required' });
          return;
        }
        const track = Number(url.searchParams.get('track'));
        const result = await feeds.routes.lookup([
          {
            callsign,
            lat,
            lon,
            track: Number.isFinite(track) ? track : undefined,
          },
        ]);
        const first = Object.values(result.routes)[0] ?? {
          known: false,
          reason: 'unknown',
        };
        sendJson(res, 200, { state: result.state, route: first });
        return;
      }
      if (route === 'object') {
        const id = String(url.searchParams.get('id') || '').replace(/^c/, '');
        if (!/^\d{1,9}$/.test(id)) {
          sendJson(res, 400, { error: 'id must be a catalog number' });
          return;
        }
        sendJson(res, 200, await feeds.object(id), {
          'Cache-Control': 'private, max-age=3600',
        });
        return;
      }
      if (route === 'launches' || route === 'fireballs') {
        const result = await feeds[route].get();
        sendJson(
          res,
          200,
          {
            at: result.at || null,
            state: result.state,
            items: result.value ?? [],
          },
          {
            'Cache-Control': result.value ? 'private, max-age=600' : 'no-store',
          },
        );
        return;
      }
      if (route === 'status') {
        sendJson(res, 200, {
          feeds: feeds.status(),
          cache: await feeds.cache.usage(),
          sharedCacheBytes: await folderBytes(
            path.join(process.cwd(), '.gev-cache'),
          ),
          alerts: alerts?.state() ?? { enabled: false },
        });
        return;
      }
    } catch {
      console.warn(`[over-my-house] ${route} request failed`);
      sendJson(res, 500, { error: 'Over My House request failed' });
      return;
    }
    if (typeof next === 'function') next();
  };

  // Short links: /overhead and /?view=overhead open the light page.
  const shortLink = (req, res, next) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const isShort =
      url.pathname === '/overhead' ||
      url.pathname === '/overhead/' ||
      (url.pathname === '/' && url.searchParams.get('view') === 'overhead');
    if (!isShort || req.method !== 'GET') return next();
    res.writeHead(302, {
      Location: '/overhead.html',
      'Cache-Control': 'no-store',
    });
    res.end();
  };

  const install = (server) => {
    server.middlewares.use(shortLink);
    server.middlewares.use('/api/overhead', handler);
  };

  return {
    name: 'over-my-house',
    configureServer(server) {
      install(server);
      alerts = startAlertScheduler({ feeds, config: alertConfig(env) });
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}
