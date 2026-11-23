/**
 * Optional "tonight's sky" email for the Over My House feature. OFF unless
 * OMH_ALERTS_ENABLED=1 and a mail provider, sender, recipients and home
 * location are all set in the environment. No secret lives in code.
 */
import {
  buildCatalog,
  passesBetween,
  starlinkTrains,
  localPosition,
} from '../../../src/overhead/sky.js';
import { nextDarkWindow } from '../../../src/overhead/astro.js';
import { compassPoint } from '../../../src/overhead/compass.js';
import { directionWord as dirWord } from '../../../src/overhead/words.js';
import { validLatitude, validLongitude } from './sources.js';

const EMAIL_RE = /^[^\s@<>",;]{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,24}$/;
const MAIL_HOSTS = Object.freeze({
  resend: 'api.resend.com',
  postmark: 'api.postmarkapp.com',
});

/** Read and check the alert settings; `problems` lists what is missing. */
export function alertConfig(env = process.env) {
  const enabled =
    env.OMH_ALERTS_ENABLED === '1' || env.OMH_ALERTS_ENABLED === 'true';
  const provider = String(env.OMH_ALERT_PROVIDER || '').toLowerCase();
  const key =
    provider === 'resend'
      ? env.OMH_RESEND_API_KEY
      : provider === 'postmark'
        ? env.OMH_POSTMARK_SERVER_TOKEN
        : '';
  const from = String(env.OMH_ALERT_FROM || '').trim();
  const to = String(env.OMH_ALERT_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 10);
  const lat = validLatitude(env.OMH_HOME_LAT);
  const lon = validLongitude(env.OMH_HOME_LON);
  const hour =
    Number.isInteger(Number(env.OMH_ALERT_HOUR)) &&
    Number(env.OMH_ALERT_HOUR) >= 0 &&
    Number(env.OMH_ALERT_HOUR) <= 23
      ? Number(env.OMH_ALERT_HOUR)
      : 16;
  const timeZone = validTimeZone(env.OMH_ALERT_TZ) ?? 'America/Chicago';
  const publicUrl = safePublicUrl(env.OMH_PUBLIC_URL);
  const minMag =
    Number.isFinite(Number(env.OMH_ALERT_MIN_MAG)) &&
    env.OMH_ALERT_MIN_MAG !== '' &&
    env.OMH_ALERT_MIN_MAG !== undefined
      ? Number(env.OMH_ALERT_MIN_MAG)
      : 3;
  const problems = [];
  if (!MAIL_HOSTS[provider])
    problems.push('OMH_ALERT_PROVIDER must be resend or postmark');
  if (!key) problems.push('mail API key is not set');
  if (!emailAddress(from))
    problems.push('OMH_ALERT_FROM is not a valid address');
  if (!to.length || !to.every(EMAIL_RE.test.bind(EMAIL_RE)))
    problems.push('OMH_ALERT_TO needs one or more valid addresses');
  if (lat === null || lon === null)
    problems.push('OMH_HOME_LAT and OMH_HOME_LON must be set');
  return {
    enabled,
    ready: enabled && problems.length === 0,
    dryRun: env.OMH_ALERT_DRY_RUN === '1',
    sendQuiet: env.OMH_ALERT_SEND_QUIET === '1',
    provider,
    key,
    from,
    to,
    home: lat === null || lon === null ? null : { lat, lon },
    hour,
    timeZone,
    publicUrl,
    minMag,
    problems,
  };
}

/** The bare address inside "Name <a@b.c>" or the value itself, if valid. */
function emailAddress(value) {
  const match = /<([^<>]+)>\s*$/.exec(value);
  const address = (match ? match[1] : value).trim();
  return EMAIL_RE.test(address) ? address : null;
}

function validTimeZone(value) {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: String(value) });
    return String(value);
  } catch {
    return null;
  }
}

function safePublicUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

const KIND_WORDS = Object.freeze({
  station: 'space station',
  starlink: 'Starlink satellite',
  payload: 'satellite',
  rocket: 'old rocket stage',
  debris: 'piece of space junk',
  classified: 'secret satellite (tracked by hobbyists)',
  analyst: 'unnamed object',
});

function brightWords(mag) {
  if (mag <= 0) return 'very bright';
  if (mag <= 1.5) return 'bright';
  if (mag <= 3) return 'easy to see';
  return 'faint';
}

function escapeHtml(text) {
  return String(text).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
}

/**
 * Write tonight's heads-up: bright passes, the space stations, Starlink
 * trains and launches near enough to maybe see.
 * @returns {{subject: string, text: string, html: string, hasContent: boolean, items: number}}
 */
export function composeDigest({
  catalogPayload,
  launches = [],
  home,
  nowMs = Date.now(),
  timeZone = 'America/Chicago',
  publicUrl = null,
  minMag = 3,
}) {
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  });
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const dark = nextDarkWindow(home.lat, home.lon, nowMs, {
    threshold: -6,
    hours: 30,
  });
  const lines = [];
  const htmlItems = [];
  let items = 0;
  const link = publicUrl ? `${publicUrl}/overhead.html` : null;

  if (dark) {
    const catalog = buildCatalog(catalogPayload);
    const passes = passesBetween(catalog, home, dark.start, dark.end, {
      maxStdMag: 5,
    });
    const notable = passes
      .filter((p) => p.kind === 'station' || (p.bestMag ?? 99) <= minMag)
      .filter((p) => p.maxEl >= 20)
      .slice(0, 12);
    const trains = starlinkTrains(passes);
    lines.push(
      `Dark enough from ${time.format(dark.start)} to ${time.format(dark.end)}.`,
    );
    if (notable.length) {
      lines.push('', 'Bright things passing over:');
      for (const p of notable) {
        const line = `- ${time.format(p.start)}: ${p.name} (${KIND_WORDS[p.kind] ?? 'satellite'}), ${brightWords(p.bestMag)}. Rises in the ${dirWord(p.startDir)}, highest ${p.maxEl}° up in the ${dirWord(p.maxDir)}, leaves in the ${dirWord(p.endDir)}.`;
        lines.push(line);
        htmlItems.push(escapeHtml(line.slice(2)));
        items += 1;
      }
    }
    if (trains.length) {
      lines.push('', 'Starlink trains (a line of moving dots):');
      for (const tr of trains.slice(0, 4)) {
        const line = `- ${time.format(tr.start)}: about ${tr.count} Starlink satellites in a row, from the ${dirWord(tr.startDir)} toward the ${dirWord(tr.endDir)}.`;
        lines.push(line);
        htmlItems.push(escapeHtml(line.slice(2)));
        items += 1;
      }
    }
  } else {
    lines.push('The sky does not get dark tonight at this place.');
  }

  const nearLaunches = launches
    .filter((l) => {
      const net = Date.parse(l.net);
      return (
        Number.isFinite(net) &&
        net > nowMs - 3600000 &&
        net < nowMs + 30 * 3600000
      );
    })
    .map((l) => ({
      ...l,
      where:
        Number.isFinite(l.lat) && Number.isFinite(l.lon)
          ? localPosition(home, l.lat, l.lon, 100)
          : null,
    }))
    .filter((l) => l.where && l.where.groundKm <= 1800);
  if (nearLaunches.length) {
    lines.push(
      '',
      'Rocket launches you might see (low in the sky, if the weather is clear):',
    );
    for (const l of nearLaunches.slice(0, 4)) {
      const line = `- ${time.format(Date.parse(l.net))}: ${l.name} from ${l.location || l.pad}, about ${Math.round(l.where.groundKm)} km to the ${dirWord(compassPoint(l.where.az))}. Times can change.`;
      lines.push(line);
      htmlItems.push(escapeHtml(line.slice(2)));
      items += 1;
    }
  }

  if (!items)
    lines.push(
      '',
      'Nothing very bright is expected tonight. Check the app if you see something.',
    );
  if (link) lines.push('', `See what is above you right now: ${link}`);
  lines.push(
    '',
    'Times are estimates. Clouds and city lights can hide faint objects.',
  );
  const subject = items
    ? `Tonight's sky: ${items} thing${items === 1 ? '' : 's'} to look for (${day.format(nowMs)})`
    : `Tonight's sky: a quiet night (${day.format(nowMs)})`;
  const text = lines.join('\n');
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.5;color:#111">
<h1 style="font-size:24px">${escapeHtml(subject)}</h1>
${dark ? `<p>${escapeHtml(lines[0])}</p>` : ''}
${htmlItems.length ? `<ul>${htmlItems.map((i) => `<li style="margin-bottom:10px">${i}</li>`).join('')}</ul>` : '<p>Nothing very bright is expected tonight.</p>'}
${link ? `<p><a href="${escapeHtml(link)}" target="_blank" rel="noopener" style="display:inline-block;padding:14px 20px;background:#0b5;color:#fff;border-radius:10px;text-decoration:none;font-size:20px">See what is above you right now</a></p>` : ''}
<p style="color:#444;font-size:16px">Times are estimates. Clouds and city lights can hide faint objects.</p>
</body></html>`;
  return { subject, text, html, hasContent: items > 0, items };
}

/** Send one message through the configured provider (never logs the key). */
export async function sendDigest(
  config,
  digest,
  { fetchImpl = globalThis.fetch } = {},
) {
  if (config.dryRun) {
    console.log(
      `[over-my-house] dry run: would email ${config.to.length} recipient(s): ${digest.subject}`,
    );
    return { sent: false, dryRun: true };
  }
  const host = MAIL_HOSTS[config.provider];
  if (!host) throw new Error('mail provider not allowed');
  const request =
    config.provider === 'resend'
      ? {
          url: `https://${host}/emails`,
          headers: {
            Authorization: `Bearer ${config.key}`,
            'Content-Type': 'application/json',
          },
          body: {
            from: config.from,
            to: config.to,
            subject: digest.subject,
            html: digest.html,
            text: digest.text,
          },
        }
      : {
          url: `https://${host}/email`,
          headers: {
            'X-Postmark-Server-Token': config.key,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: {
            From: config.from,
            To: config.to.join(','),
            Subject: digest.subject,
            HtmlBody: digest.html,
            TextBody: digest.text,
            MessageStream: 'outbound',
          },
        };
  const response = await fetchImpl(request.url, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  void response.body?.cancel().catch(() => {});
  if (!response.ok)
    throw new Error(`mail provider answered HTTP ${response.status}`);
  return { sent: true };
}

/** The calendar date (YYYY-MM-DD) and hour at a time in a zone. */
export function localDateHour(ms, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
  };
}

/**
 * Check every 10 minutes; once a day, at or after the configured local hour,
 * build and send the digest. The last sent date is kept in the cache so a
 * restart never sends twice.
 */
export function startAlertScheduler({
  feeds,
  config = alertConfig(),
  everyMs = 10 * 60000,
  now = () => Date.now(),
}) {
  if (!config.enabled) return { stop() {}, state: () => ({ enabled: false }) };
  if (!config.ready) {
    console.warn(
      `[over-my-house] email alerts are ON but not set up: ${config.problems.join('; ')}`,
    );
    return {
      stop() {},
      state: () => ({ enabled: true, ready: false, problems: config.problems }),
    };
  }
  let lastSent = null;
  let lastError = null;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const saved =
        lastSent ??
        (await feeds.cache.read('alerts-state'))?.value?.date ??
        null;
      lastSent = saved;
      const { date, hour } = localDateHour(now(), config.timeZone);
      if (hour < config.hour || saved === date) return;
      const catalog = await feeds.catalog();
      const launches = (await feeds.launches.get()).value ?? [];
      const digest = composeDigest({
        catalogPayload: JSON.parse(catalog.body),
        launches,
        home: config.home,
        nowMs: now(),
        timeZone: config.timeZone,
        publicUrl: config.publicUrl,
        minMag: config.minMag,
      });
      if (digest.hasContent || config.sendQuiet)
        await sendDigest(config, digest);
      lastSent = date;
      lastError = null;
      await feeds.cache.write('alerts-state', { at: now(), value: { date } });
    } catch (error) {
      lastError = String(error?.message || 'failed').slice(0, 120);
      console.warn(`[over-my-house] alert failed: ${lastError}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, everyMs);
  timer.unref?.();
  setTimeout(tick, 60000).unref?.();
  return {
    stop: () => clearInterval(timer),
    state: () => ({
      enabled: true,
      ready: true,
      provider: config.provider,
      recipients: config.to.length,
      hour: config.hour,
      timeZone: config.timeZone,
      lastSent,
      lastError,
      dryRun: config.dryRun,
    }),
  };
}
