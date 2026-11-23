# Over My House

Over My House answers two questions for one place, usually your home:

- **What is in my sky right now?** Every tracked satellite, space station,
  Starlink, old rocket stage, piece of space junk, hobbyist-tracked secret
  satellite, nearby plane, planet, the Moon and the bright stars, placed on a
  sky chart and in plain-word lists ("low in the north-west, moving east,
  bright").
- **What was that?** You say when you looked, which way, how high, which way it
  moved, how bright it was and whether it blinked. The page ranks everything
  that could have been there and says why.

It also lists tonight's passes, Starlink "trains" (a line of moving dots from
one launch) and launches that might be visible, and can send a daily email
heads-up.

## Opening it

| Link | What it does |
| --- | --- |
| `/overhead.html` | The light page: no 3D globe, loads fast on a phone. Installable (it has its own web manifest and icons). |
| `/overhead` | Short link, redirects (302) to `/overhead.html`. |
| `/?view=overhead` | Same redirect; the main app also skips the welcome launcher for this link. |

Inside the main app the same panel is available as the `over-my-house`
application view (`src/ui/views/OverMyHouseView.vue`).

Your place comes from the browser's location (asked once) or a place you
type; it is kept in this browser only (`src/overhead/settings.js`). Until one
is set, the page uses downtown San Antonio, TX and says so. A text-size
control (Small / Normal / Large / Extra large, 18px base) and a microphone
button (the browser's Web Speech API, hidden where unsupported) are on the
page. The page
is `noindex`, because it shows the visitor's own location. To look up planes
the browser sends only a rounded location (about half a mile).

## Units

Everything people read is in **miles**, with **feet** for plane heights:
plane distance ("41950 ft, 7 mi away"), satellite height ("About 340 mi up"),
how high a pass gets in Tonight, launch and fireball distance, the "What was
that?" reasons and the email heads-up. The maths stays in kilometres; only
the words convert (1 km = 0.621371 mi, `miles()` and `milesWords()` in
`src/overhead/words.js`). Under 10 miles shows one decimal ("6.8"), from 10
up shows whole miles ("340").

## Sky map

The round map (`src/ui/views/panels/overMyHouse/SkyChart.vue`, a canvas) has
the middle straight overhead and the edge at the horizon, north up and east
right. A plain line under it says what the marks are: orange arrows planes,
green and gray dots satellites (gray too dim to see), yellow dots planets.

- **Zoom**: pinch on a phone, the + / − buttons (52px, any device), or the
  mouse wheel once the map has been clicked (Ctrl + wheel and trackpad pinch
  work straight away). Up to 8x. **Reset** goes back to the whole sky. The
  buttons animate for 180 ms, or jump when the device asks for reduced motion.
- **Pan**: drag with one finger or the mouse once zoomed in; two fingers pan
  while pinching. At 1x a one-finger drag scrolls the page as usual
  (`touch-action: pan-y`); zoomed in the map takes every touch
  (`touch-action: none`). Two-finger touches never zoom the whole page.
- Dots, arrows and labels keep their size at any zoom; the N / E / S / W
  letters stay on their side and stick to the map's edge when zoomed.
- **Tapping** picks the nearest thing within about 24px of the finger, rings
  it in white on the map and shows its card. A pinch or drag never counts as
  a tap. The zoom and tap maths is in `src/overhead/skyView.js`.

## How it works

- Server routes (`server/providers/overhead/proxy.js`), all keyless:

  | Route | Data | Cache |
  | --- | --- | --- |
  | `GET /api/overhead/catalog` | Satellites, rocket bodies, debris (CelesTrak) and classified objects (McCants) | 6 h (CelesTrak), 12 h (McCants) |
  | `GET /api/overhead/aircraft?lat=&lon=` | Aircraft within about 31 miles / 50 km (adsb.lol) | 15 s per 0.01° cell (about 0.7 mi) |
  | `GET /api/overhead/launches` | Launches from 3 h ago to 36 h ahead (Launch Library 2) | 1 h |
  | `GET /api/overhead/fireballs` | Located fireballs, last 180 days (NASA/JPL CNEOS) | 12 h |
  | `GET /api/overhead/status` | Feed health, cache size, email-alert state | none |

- Every upstream URL is built from a fixed host allowlist
  (`server/providers/overhead/sources.js`); only validated latitude and
  longitude numbers from the browser reach a URL, redirects are refused, and
  answers are size-capped. Each route has a per-minute request limit.
- Feeds are cached on disk under `.gev-cache/overhead/` with a size budget
  (`OMH_CACHE_MAX_MB`, 5-500 MB). A failed refresh serves the last good copy
  and backs off.
- The browser runs the orbit maths (SGP4 via `satellite.js`) in a worker
  (`src/overhead/worker.js`). `src/overhead/sky.js` and
  `src/overhead/satellites.js` have no DOM or Cesium, so the email job uses the
  same code in Node.

## Data sources, limits and licenses

| Source | Used for | Limits we respect | Terms |
| --- | --- | --- | --- |
| **CelesTrak** GP data (`celestrak.org/NORAD/elements/gp.php`, CSV) | Groups: stations, visual, active (includes Starlink), last-30-days, analyst, decaying, and the Fengyun-1C, Iridium-33 and Cosmos-2251 debris clouds | CelesTrak updates every 2 h and asks for no more than one download per update; we cache 6 h and stop all CelesTrak queries after any non-200 answer | Free public data from CelesTrak (Dr. T.S. Kelso), derived from the US Space Force catalog; credit "CelesTrak" |
| **Mike McCants' classified elements** (`www.mmccants.org/tles/classfd.zip`) | Classified satellites tracked by amateur observers | Fetched at most every 12 h | Hobbyist-published orbital elements; no formal license; credit Mike McCants and the SeeSat-L observers. Positions are estimates and can be old |
| **adsb.lol** (`api.adsb.lol/v2/point/...`) | Aircraft near your place | Keyless use allows about 500 calls a day per address; the server spends at most 300 by default (`OMH_ADSB_DAILY_LIMIT`, max 480) and shares answers between nearby callers | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); credit "adsb.lol contributors" |
| **Launch Library 2** by The Space Devs (`ll.thespacedevs.com/2.3.0/launches/`) | Upcoming and just-flown launches with pad locations | Free tier is 15 calls an hour per address; we use one an hour | Free tier under The Space Devs' terms; credit "Launch Library 2 / The Space Devs" |
| **NASA/JPL CNEOS fireball API** (`ssd-api.jpl.nasa.gov/fireball.api`) | Recent located fireballs (bright meteors) | Fetched at most every 12 h | US government (NASA/JPL) public data; credit "NASA/JPL CNEOS" |

Planets, the Sun, the Moon and the bright stars are computed locally
(`src/overhead/astro.js`, `src/overhead/brightStars.js`); no feed is needed.

## Visibility rules

An object is listed as something you could see when all of these hold:

- It is at least **10° above the horizon** (`MIN_ELEVATION`).
- For satellites, the **Sun is at least 6° below your horizon** (civil dusk,
  `DARK_SUN_ELEVATION`) and the **object itself is in sunlight**.
- Its estimated brightness is **magnitude 4.5 or brighter**
  (`VISIBLE_MAGNITUDE`). Brightness is a rough estimate from object type and
  name, so the page always says "about".

Everything else above the horizon still appears in the full list, marked as
not visible. Tonight's passes step one minute at a time; a pass counts as
visible when at least one of its minutes meets the rules above. Starlink trains
are five or more visible Starlink passes from one launch starting within three
minutes of each other.

## "What was that?" matching

For the time you give (with a window around it), each candidate is scored on:

- **Where**: compass direction (looser near straight up) and height band (low,
  medium, high).
- **Motion**: the direction it moved, or "it stayed still" (planets, stars and
  the Moon fit; satellites and planes do not).
- **Brightness**: bright, medium or faint against the estimated magnitude.
- **Blinking**: blinking points to a plane (or a tumbling rocket stage);
  steady points to a satellite.
- **Could it be seen at all**: a satellite in Earth's shadow or in daylight
  scores near zero.

Planes come from the adsb.lol snapshot nearest that time, and launches near
that time are included. The best match is labelled "very likely", "could be"
or "nothing in our lists fits well", with the reasons in plain words.

## Email heads-up (optional, off by default)

A daily email lists tonight's bright passes, space-station passes, Starlink
trains and launches you might see. The `npm run dev` server schedules it once a
day (`vite preview` serves the routes but does not schedule email). It can
also be run by hand, for example from cron:

```
npm run overhead:alert            # print tonight's email, send nothing
npm run overhead:alert -- --send  # send it now with the OMH_* settings
```

| Variable | Required | Meaning |
| --- | --- | --- |
| `OMH_ALERTS_ENABLED` | yes | `1` or `true` to turn the daily email on |
| `OMH_ALERT_PROVIDER` | yes | `resend` or `postmark` |
| `OMH_RESEND_API_KEY` | with Resend | Resend API key |
| `OMH_POSTMARK_SERVER_TOKEN` | with Postmark | Postmark server token |
| `OMH_ALERT_FROM` | yes | Sender, e.g. `Sky <sky@example.com>` (a verified sender at your provider) |
| `OMH_ALERT_TO` | yes | One or more recipients, comma-separated |
| `OMH_HOME_LAT`, `OMH_HOME_LON` | yes | Your home in decimal degrees |
| `OMH_PUBLIC_URL` | recommended | Your site's `https://` address; the email links to `<origin>/overhead.html` |
| `OMH_ALERT_HOUR` | no | Hour to send, 0-23 (default 16) |
| `OMH_ALERT_TZ` | no | IANA time zone for the hour and the times in the email (default `America/Chicago`) |
| `OMH_ALERT_MIN_MAG` | no | Faintest magnitude worth an email line (default 3) |
| `OMH_ALERT_SEND_QUIET` | no | `1` sends even on a night with nothing to see |
| `OMH_ALERT_DRY_RUN` | no | `1` builds the email and logs it without sending |

Keys stay in the environment (`.env`), never in code. `/api/overhead/status`
shows whether alerts are on and any setting problems, never the key.

## Known gaps

- **Not the full catalog.** CelesTrak's public groups cover active satellites,
  stations, recent launches, decaying objects, analyst objects and the three
  big debris clouds, not every one of the roughly 47,000 tracked pieces. The
  full catalog needs a free Space-Track.org login, which this feature does not
  use yet.
- **English only.** The page and email text are plain English and are not yet
  in the app's translation catalogs.
- Brightness is an estimate; classified-object positions can be days old.
- Aircraft are a ~31-mile (50 km) snapshot and depend on adsb.lol's volunteer receivers
  near you.
