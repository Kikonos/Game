# CONTRAIL — Airline Empire

A PC-paced airline management game for the browser. Start with a single hub in one region, lease your
first turboprop, and grow region by region, then continent by continent, into a global airline.

- **Real aircraft:** 35 types, from the ATR 42 to the A380, 777-9 and Boom Overture, with realistic range,
  speed, fuel burn, prices and seating limits. Out-of-production types (747, A380, 757, CRJ…) are only
  on the used and lease markets.
- **Real seating:** each cabin is built from real seat products (slimline economy, premium economy,
  recliners, lie-flat, business suites, first suites), with real pitch and seats per row, cabin length
  and exit limits. You can see the result as a seat map.
- **Real world:** 353 airports in 27 regions on 7 continents, a gravity-model demand engine with seasons,
  economic cycles, city trends, rival airlines and hub-and-spoke connecting traffic.
- **Living market:** fuel shocks, recessions, strikes, storms, fare wars and decisions to make. Real
  scheduled events (FIFA World Cup 2026 & 2030, LA 2028 Olympics, Hajj, Lunar New Year…) drive demand.
- **Progression:** 10 airline levels, 28 goals, region and continent traffic rights, a long-haul
  certificate, extra hubs with lounges, maintenance bases and connection centres, and world rankings.
- **Offline:** an installable PWA. Everything, including the world map and fonts, is bundled and
  precached, and saves live in the browser (compressed) with export and import to a file.

## Playing

| Key | Action |
| --- | --- |
| `Space` | Pause / resume |
| `1`–`4` | Game speed (1×, 2×, 4×, 10×) |
| `Esc` | Menu (save, load, export, settings, handbook) |

At 2× speed a game month takes about a minute, so a 1–2 hour session covers roughly 5–8 years:
enough to go from a couple of turboprops to a continental carrier with long-haul ambitions.

Fast-forward never changes the outcome (every day simulates the same at any speed), but autopilot
does not pay. Each January wages, airport charges and maintenance rates rise while market fares only
partly follow, and fares you set by hand stay put until you re-price; ageing aircraft cost more to keep
flying; and rivals answer routes that earn well above normal with extra flights or fare wars. An
airline left alone drifts towards break-even within a few years. Experience comes from growth — new
destinations, regions and aircraft, monthly passenger and profit records, goals — not from flying the
same schedule. As a guide, a careful player runs about 10–15 aircraft after the first year and earns the
long-haul certificate (level 5) in years 3–4; a cautious start with two narrowbodies on good routes makes
a single-digit margin. With **Slow down for alerts** (Settings, on by default) the clock drops back to 1×
when a rival moves in on your route, cash runs low, an aircraft is delivered or left idle, a route keeps
losing money or a big event starts on your network.

## Development

```bash
npm install
npm run dev        # local dev server
npm run build      # typecheck + production build (dist/, with service worker)
npm run preview    # serve the production build
npm test           # engine unit tests (vitest)
npm run balance -- MAD 8 normal   # headless bot plays 8 years from Madrid and prints a pacing report
npx tsx scripts/scenarios.ts MAD 7 normal   # beginner, naive-mistake and idle-airline balance scenarios
```

### Project layout

```
src/
  data/       airports, regions, countries, aircraft catalog, seat products, flavour text
  engine/     pure TypeScript simulation (no DOM): demand, economics, cabins, events,
              progression, player actions, save/load — fully unit-testable
  ui/         React UI: store (game loop & state), map, components, screens
  styles/     design tokens and screen styles
scripts/      balance bot and data sanity checks
```

The engine is deterministic for a given seed (the RNG state lives in the save), which keeps
save/load exact and makes balance testing reproducible.

### Deploying

`.github/workflows/deploy.yml` builds the game and publishes it to GitHub Pages on every push to
`main`. Enable it once in the repository settings under **Pages → Source: GitHub Actions**.
The build uses relative paths, so it also works from any static host or sub-folder.
