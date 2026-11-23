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
the browser sends only a rounded location (about half a mile); to look up a
tapped plane's route it sends that plane's callsign and the plane's position
rounded to about 7 miles.

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
- **Tapping** picks what is under the finger, within about 24px, including
  the dim gray dots. When several marks sit on one spot, the brightest and
  nearest comes first (marks you can see, planes and planets before gray
  dots, then the one closest to the finger, then the brighter one) and the
  card says "N other objects here" with a **Show the next one** button that
  steps through them. The pick is ringed in white. A pinch or drag never
  counts as a tap. The zoom and tap maths is in `src/overhead/skyView.js`
  (`pointsNear`).
- **Show / hide filters**: big round buttons above the map (48px or more,
  scaling with the text size) for Planes, Satellites (working), Starlink,
  Rocket bodies, Debris, Classified, Not identified, Planets and Moon, and
  Stars, each with how many are up now, plus **All** (on/off) and a one-tap
  **Show all** that appears once anything is hidden. Everything is shown at
  first. They hide marks on the map, from taps, and from the lists under it,
  so "only Not identified" or "only satellites" is two taps. The choice is
  kept in this browser (localStorage, with the other settings).

## What the card says

**A plane** (`planeDetails` in `src/overhead/details.js`):

- Airline and flight number from the callsign's three-letter ICAO prefix
  (`SWA1234` is "Southwest Airlines flight 1234"), from a small built-in
  table of common US and international operators. An unknown prefix shows
  the callsign; an `N…` callsign is a private or small plane; no callsign
  and no registration shows **Not identified** with the reason.
- Route **from → to** as city and airport code, looked up for the tapped
  plane only (see `/api/overhead/routes`). A route that is missing, or that
  does not fit where the plane is and which way it flies, shows
  **Route not known**.
- Plane type in words from the ADS-B type code (`B738` is "Boeing 737-800",
  built-in table; else adsb.lol's description; else the code),
  registration, ground speed in mph, heading as a direction word, and
  climbing / descending / flying level (±300 ft per minute).
- **See it on the adsb.lol map** opens `https://globe.adsb.lol/?icao=<hex>`
  in a new tab (tar1090's documented `?icao=` parameter selects the plane).

**A satellite, rocket stage, piece of junk or unknown object**
(`objectDetails`):

- Name, NORAD catalog number, and what it is in plain words: working
  satellite (SATCAT status +, P, B, S or X), satellite no longer working,
  space station, "Starlink internet satellite (SpaceX)", old rocket stage,
  space junk, "Classified satellite, tracked by amateur observers", or
  **Not identified**.
- Owner country or organisation and launch date and site, from CelesTrak's
  SATCAT (codes turned into words with built-in copies of CelesTrak's
  owner and launch-site tables; an unknown code is shown as the code).
- Height in miles, speed in mph (from the SGP4 velocity, to the nearest
  100), in sunlight or in Earth's shadow, whether you could see it now and
  about how bright, and which way it is moving.
- **More about it (N2YO)** opens `https://www.n2yo.com/satellite/?s=<number>`
  in a new tab. Analyst objects get no link (their numbers are not real
  catalog numbers).

**Not identified** is used, always with a short reason, for: analyst objects
(tracked but not matched to a launch), objects the SATCAT lists with type
unknown, objects with no public name, and objects the SATCAT does not list
(often brand-new launches). It is never blank.

## How it works

- Server routes (`server/providers/overhead/proxy.js`), all keyless:

  | Route | Data | Cache |
  | --- | --- | --- |
  | `GET /api/overhead/catalog` | Satellites, rocket bodies, debris (CelesTrak) and classified objects (McCants) | 6 h (CelesTrak), 12 h (McCants) |
  | `GET /api/overhead/aircraft?lat=&lon=` | Aircraft within about 31 miles / 50 km (adsb.lol) | 15 s per 0.01° cell (about 0.7 mi) |
  | `GET /api/overhead/routes?cs=&lat=&lon=&track=` | One plane's route (adsb.lol routeset, fallback adsb.lol's static VRS route file) | 6 h per callsign when found, 1 h when not found |
  | `GET /api/overhead/object?id=` | Owner, launch date and site, type and status for one catalog number (CelesTrak SATCAT) | SATCAT downloaded at most once a day |
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
| **CelesTrak SATCAT** (`celestrak.org/pub/satcat.csv`, CSV; [format](https://celestrak.org/satcat/satcat-format.php)) | Object type (payload, rocket body, debris, unknown), owner, launch date and site, operational status | The SATCAT updates by hand once or twice a day; we download it at most once every 24 h (6 h wait after a failure), share CelesTrak's stop-after-any-non-200 gate, keep only objects still in orbit (a few MB on disk, inside the 60 MB cache budget) and never keep the raw file | Same as CelesTrak GP data; credit "CelesTrak" |
| **adsb.lol route lookup** (`POST api.adsb.lol/api/0/routeset`) | From / to airports for the tapped plane | Marked `x-quota: free` in adsb.lol's OpenAPI document (not counted in the 500-a-day keyless quota); at most 100 planes per call (we send 1), one call every 2 s at most, 5 min back-off after an error and longer on 429 (`Retry-After`). Plane position sent rounded to 0.1° (about 7 miles) | [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/); credit "adsb.lol contributors". Route data is from Virtual Radar Server's standing data |
| **adsb.lol static route files** (`vrs-standing-data.adsb.lol/routes/<2 letters>/<callsign>.json`) | Fallback when routeset answers empty | At most 120 a hour, one callsign per tap | [Virtual Radar Server standing data](https://github.com/vradarserver/standing-data), CC0 1.0 |
| **Built-in tables** (`src/overhead/details.js`) | Airline names from callsign prefixes, aircraft type names, SATCAT owner and launch-site words | No network | Written for this feature from public ICAO designators and CelesTrak's published code lists |
| **N2YO** (`www.n2yo.com/satellite/?s=`) | "More about it" link only; nothing is fetched | n/a | Link only |
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
- Flight routes come from schedules people collect, not from the plane, so
  they can be wrong or missing (charter, cargo, private and military
  flights usually have none). We hide a route that does not fit where the
  plane is.
- The airline and aircraft tables cover common types only; others show the
  raw code.
- Aircraft are a ~31-mile (50 km) snapshot and depend on adsb.lol's volunteer receivers
  near you.
