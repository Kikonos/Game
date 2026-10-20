# BLOCK HOURS

A calm management game for the browser about running a small **ACMI, wet-lease and charter operator**.
You start with two A320s, sixty named crew and three million dollars at a European base, and you sell
block hours: summer deployments for airlines, AOG cover, ad hoc charters, sports teams, tour-operator
series, government repatriation flights and troop rotations.

- **The map is the game.** A full-screen world map where every aircraft flies its real great-circle
  route between its actual departure and arrival times, parks at its airport and sits in the hangar for
  checks. A day/night terminator glides across it; contract offers appear as pins.
- **Contracts.** Offers from real airlines, ministries, agencies, brokers, clubs and tour operators arrive
  with an expiry. For each of your aircraft the planner checks seats, range and fuel stops, runways,
  ETOPS, approvals, positioning, maintenance and crew capacity. Accept, counter or decline; rivals may win.
  Hand legs you can't fly to a rival operator (sub-charter) or cancel and pay the penalty.
- **Schedule.** A Gantt per aircraft over days and weeks: flights in contract colours, positioning,
  maintenance, idle gaps and a today line. Tap a block for times, crew and legality.
- **Crew.** Named captains, first officers, pursers and cabin crew with type ratings, a home base and
  simplified EASA flight-time limits (FDP, rest, 60 h/7 d, 190 h/28 d, 100 h/28 d block, 900 h/year,
  recovery rest). An auto-roster crews every duty; you can review and override it seat by seat, swap crew
  between trips and see illegal choices flagged in red with the reason. Your choices stay locked through
  the rolling re-plan. Hire and train with real lead times.
- **Fleet, finance and company.** A- and C-checks, AOGs with a recovery menu, a scarce aircraft market,
  monthly statements with block-hour billing against the minimum guarantee, receivables (governments pay
  late), reputation, approvals (ETOPS, augmented crews, ULR…), policies and goals.
- **Offline.** An installable PWA; saves live in the browser (compressed) with export and import to a file.

Real company names are used as clients, brokers and rivals in a factual, neutral way. Everything that
happens to them in the game is a routine simulated business outcome.

## Playing

Designed for an iPad in landscape (1180×820 as a home-screen app, 1180×750 in Safari) with touch;
a desktop browser works too.

| Control | Action |
| --- | --- |
| ⏸ / `Space` | Pause or resume |
| 1× 2× 4× / `1`–`3` | Game speed: 1× is one game day per minute, 2× half a minute, 4× fifteen seconds |
| `Esc` | Menu (save, load, export, import, settings) |

Important events stop the clock by themselves (decisions, urgent offers, AOGs, crew shortages; month end
and contract starts are optional) — choose which in **Settings**. Dialogs hold time while they are open.

## Development

```bash
npm install
npm run dev          # local dev server
npm run build        # typecheck + production build (dist/, with service worker)
npm run preview      # serve the production build
npm test             # unit tests (vitest)
npx tsx scripts/acmi-bot.ts 1 365   # headless bot plays a year on seed 1 and prints the monthly table and targets
node scripts/ipad-shots.cjs --url http://localhost:5173/ --out ./ipad-shots   # iPad screenshots + layout lint
```

In the browser console, `__contrail` is the game store; `__contrail.dev` has helpers for testing
(`autoplay(days)`, `offer(archetype)`, `decision()`, `demoFlights(days)`, `fleet(n)`).

### Project layout

```
docs/acmi/    BRIEF (direction), DESIGN (architecture), BUILD-PLAN, RESEARCH (industry facts)
src/
  data/       airports, countries, time zones, aircraft types, names, clients, brokers and rivals
  engine/     deterministic simulation in minutes (no DOM): core, contracts, crew, ops; save/load
  ui/         React UI: store (clock and state), shell, map, screens, modals
  styles/     design tokens, touch layout and screen styles
scripts/      headless bot, iPad screenshot harness
```

The engine is deterministic for a seed: all randomness comes from the RNG in the save, so save/load is
exact and the bot is reproducible.

### Releasing

GitHub Pages serves the `main` branch as it is. The playable build lives in `play/`, and the root
`index.html` forwards `github.io` visitors there. To release: `npm run build`, replace the contents of
`play/` with `dist/`, commit and push to `main`. (`.github/workflows/deploy.yml` can also build and deploy
on demand.)
