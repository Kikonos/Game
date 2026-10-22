# BLOCK HOURS v0.7.2 "Crew Rules & Fleet": design

Plan of record for v0.7.2, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events, Dubai player, iPad landscape 1180×820 / Safari 1180×750, calm visuals, 1×/2×/4× only). RESEARCH.md supplies the numbers; this update adds **docs/acmi/EASA-FTL.md** as the crew-rules reference for every later crew update. DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only; read APIs pure (added to `core/plumbing.test.ts`); ids via `nextId`;
- money only through the ledger helpers; flights only through the core helpers;
- `SAVE_VERSION` stays 1, `??=` defaults in each module's `load`, so v0.5.2, v0.6, v0.7 and v0.7.1 saves keep working.

The player (a former ACMI flight attendant: euroAtlantic 767/777, Getjet/Airhub A320/A330) agreed this list (stages 1–3). Player fixes F1–F8 are built first; then features 1–8. Nothing else is added (§15). Every new problem gets the v0.7.1 four-line card (WHAT · WHY · DOES IT HURT? · WHAT YOU CAN DO) and glossary terms (§9).

| # | Feature | One line |
|---|---|---|
| F1 | Hotel dot | The white station dot stays while any of our crew is still there. |
| F2 | Market alerts | Toggles move to Fleet → Market; a new offer shows as a chip in the top bar warning area. |
| F3 | Sub-charter hurts | Reliability −0.3 to −1 per sub-chartered leg, rising with how much was handed over in 90 days; shown on the chips and card. |
| F4 | Contract names | Real-flavoured, varied titles per archetype; the weekday goes to the details; no repeats for a client. |
| F5 | Cabin crew join in a week | PUR/CC hires join in ~7 days (pilots unchanged). |
| F6 | Refits start now | At home base, from the next free window today; earliest slots first; a plain "why later". |
| F7 | Up Next compact | ≤ 5 rows in a departures-board grid, no legend, collapsible. |
| F8 | Top bar ops strip | Warnings first, then Airborne · Next · On time today · Crew, dropped by priority when narrow. |
| 1 | EASA FTL | Research doc EASA-FTL.md; `crew/rules.ts` matches its tables; tests pin them; regression-safe. |
| 2 | Captain as FO | Only when no FO is free; labelled 'CPT (as FO)'; pay stays; morale hit after twice a month. |
| 3 | Crew rest | Per-airframe bunks (class 1) or none; without bunks, 'Crew rest seats' (last economy row, class 3) blocked only when a duty needs in-flight rest. |
| 4 | PUR and CC | CSD and SCC removed; 1 PUR + CC (2 PUR on two-deck types); saves migrate. |
| 5 | Multi-type cabin hires | Tick boxes for up to 3 types; price and joining time scale with the count. |
| 6 | Sell / return early | Sell owned aircraft at a market value; return leases early for a fee; "Which one?" suggests the least used. |
| 7 | C-check hubs | C-checks at real MROs by type with ferries and crew deadheads, all booked and costed; A-checks unchanged. |
| 8 | What's new | A v0.7.2 entry in player words. |

Calm rules hold: nothing flickers, only aircraft move; top-bar text changes at most once per clock step (`CLOCK_STEP`, 10–30 game minutes); one message per event.

---

## F1. Hotel dot stays while crew are at the station (MAP; ENGINE read)

**Today.** `mapAirports` draws white 'served' dots for our aircraft's airports and their next 48 h of legs; `cmAps` adds airline-leg ends for the current hour only. Crew resting at a hotel, waiting for a ticket, or between duties of a tour are invisible once their duty's legs leave the 48 h window.

**Rule.** An airport is a crew station while **any** crew member has `loc === code`, `loc !== base` (their own base), and `status` not in `'joining'`. It keeps its white dot (state `'served'`, as today) until the last one leaves (`loc` changes when their ticket or duty takes them away). The label shows only when selected or already labelled (no new labels).

**ENGINE read (pure, `crew/index.ts`):**
```ts
/** v0.7.2 crew away from their base by airport (the hotel dots, the ops strip). Cached per crewRev. */
export function crewAway(g: GameState): { at: Map<string, string[]>; onDuty: number; atHotels: number };
```
`onDuty` = crew with `status === 'onDuty'`; `atHotels` = crew away from base and not on duty.

**MAP.** `mapAirports(g)` adds every `crewAway(g).at` key not already present as `{ code, hub: false, label: false }`. The airport panel's "Crew in hotel" list (already filters the same way) gains a count of pilots / cabin crew. Test (`mapLogic.test.ts`): a crew member resting at FUE after the aircraft left keeps FUE in `mapAirports`; it drops when their `loc` becomes LIS.

---

## F2. Market alerts move to Fleet → Market; offer chip in the top bar (UI)

- **Settings modal** (`game/Modals.tsx`): remove the "Market alerts" and "Pause on new market offers" rows. Nothing about the market remains in Settings. The settings fields stay (`settings.marketAlerts`, `settings.autoPause.marketOffer`), with the same defaults.
- **Fleet → Market** (`screens/Market.tsx`): a header row above the offer list at 1180 px: `Market alerts [toggle]` · `Pause on new offers [toggle]` (the second greyed with "Needs market alerts on" when the first is off, as today). 44 px targets, one line, no new copy beyond: "Alerts: an Inbox message, a quiet notice and a chip in the top bar."
- **Top bar chip** (`shell/Shell.tsx`, in the ops strip's warning slot, F8): when `marketAlerts` is on and an open offer the player has not opened exists (the existing `unseenOffers` set), show one chip in the warning style: plane icon + `New: A330-200 for lease` (`marketView` text, ≤ 22 chars; '+2' when more). Tap → `navigate('fleet', { view: 'market', sel: { kind: 'market', id } })`, which marks it seen. The chip goes when seen or expired. Tone `info` (the slate badge style), never amber or red.
- The PauseBadge for `marketOffer` keeps working ("Paused · Market offer").

---

## F3. Sub-charter hurts reliability (ENGINE `ops/flights.ts`, `ops/subcharter.ts`; UI chips)

**Why.** A client notices when someone else flies its passengers. Today `subcharterLegs` posts the cost and nothing else.

**Rule (in `subcharterLegs`, the one choke point: player hand-overs, Crew Control, the gate decision and the automatic AOG/crew sub-charter all go through it).** For each revenue leg handed over, in order:

```
n90    = company revenue legs sub-chartered in the last 90 days (stats.subLog, pruned)
sub90  = this contract's sub-chartered legs in the last 90 days (contract.subLegs)
flown90= contract.legsFlown × min(1, 90 d / max(1 d, now − contract.start))
share  = sub90 / max(1, sub90 + flown90)
p      = 0.3 + 0.7 × clamp(max((share − 0.10) / 0.233, (n90 − 4) / 16), 0, 1)     // −0.3 … −1.0 per leg
```
then push the leg into `subLegs`/`subLog` (so the next leg of the same hand-over costs more). Reliability −Σp (rounded to 0.1, at most **−8 per hand-over**), client relation −0.5 per leg (at most −4). So: the first few legs cost −0.3 each; a contract with a third or more of its legs handed over costs −1 per leg; 20 legs a quarter company-wide also reaches −1.

**Pure quote** (`ops/subcharter.ts`, used by every UI that offers a sub-charter):
```ts
export interface SubcharterHit { reliability: number; relation: number; text: string }   // text: 'reliability −2 · the client notices'
export function subcharterHit(g: GameState, flightIds: string[]): SubcharterHit;            // pure
// SubcharterQuote gains: hit: SubcharterHit
```
- Chips: the sub-charter row in Crew Control, the gate decision's sub-charter option and SubcharterModal show `Hurts: reliability −2 · the client notices` (red chip when ≤ −3, amber otherwise). The plain-language card's HURT line appends it: "Yes: $38K to Titan Airways; reliability −2, the client notices."
- Message after a hand-over (existing message) appends: "TUI notices: reliability −2.1."
- Data: `Contract.subLegs?: Minute[]` (std of each leg handed over), `Stats.subLog?: Minute[]`; load `??= []` lazily (read with `?? []`).
- Glossary `subcharter` short text adds: "Clients notice: each leg handed over costs reliability, more when it becomes a habit."

**Balance intent.** The bot sub-charters ~0–15 legs a year; at −0.3 to −0.6 each, reliability ends within ±3 of v0.7.1 runs. Sub-chartering stays the right call against cancelling (cancel costs −1 to −3 per leg plus compensation).

---

## F4. Contract names with flavour (ENGINE `contracts/offers.ts`, `contracts/flavor.ts`)

**Rule.** Titles say what the work is, never the weekday. The weekday, frequency and dates live in the blurb and the offer details ("Every Thursday, 12 rotations, 7 May – 23 Jul"). One title builder per archetype draws from a pool; `Client.lastTitle?: string` stops the same title twice in a row for a client (re-pick up to 4 times, then append the month: "… (June)").

```ts
// contracts/flavor.ts (ENGINE)
export type TitleCtx = { client: string; brand: string; from: string; to: string; fromCity: string; toCity: string; season: Season; month: string; n: number; event?: string };
export type Season = 'winter' | 'ski' | 'easter' | 'summer' | 'autumn' | 'christmas';
export const TITLES: Partial<Record<Archetype, ((x: TitleCtx) => string)[]>>;
export function seasonOf(startUtc: Minute, to: string): Season;   // ski when Dec–Mar and `to` is a ski airport
```
`brand` is the client's short trade name (TUI Deutschland → TUI, Jet2holidays → Jet2, Sunweb, Corendon, Sunclass, Nouvelles Frontières…; table in `flavor.ts`).

**Pools (≥ 8 each; examples, not exhaustive):**
- **tourSeries:** "{brand} summer programme {fromCity}–{toCity}" · "{brand} weekend rotation to {toCity}" · "{brand} {toCity} flights" · "{season} sun to {toCity} for {brand}" · "Half-term charters {fromCity}–{toCity}" · "Easter programme to {toCity}" · "Autumn sun: {toCity}" · "{brand} ski charters {fromCity}–{toCity}" (ski only: SZG, INN, GVA, TRN, CMF, GNB where in `airports.ts`; RESORTS_SKI added) · "Golf season to Faro for {brand}" (FAO) · "{brand} winter sun to the Canaries" (TFS/LPA/FUE/ACE) · "Christmas markets programme {toCity}" · "{brand} long-haul sun to {toCity}" (widebody).
- **seasonBase:** "{client} summer peak at {city}" · "Extra capacity for {client} at {city}" · "{client}'s {season} wet lease, {city}" · "{client} holiday peak cover" · "Base deployment {city} for {client}" · long ones "{client} year-round capacity at {city}".
- **aogCover:** "{client} AOG cover at {city}" · "Rescue capacity for {client}" · "Stand-in aircraft for {client}" · "{client} needs a {type} at {city}".
- **troopRotation / unRotation:** real mission names where the airport fits: MINUSCA (BGF), UNMISS (JUB), MONUSCO (GOM/FIH), UNIFIL (BEY), UNFICYP (LCA), EUFOR Althea (SJJ), KFOR (PRN), Resolute Support-style "contingent rotation" otherwise: "{mission} troop rotation", "{country} contingent rotation to {city}", "Peacekeeper rotation for {mission}".
- **sports:** "{club} away days", "{club} Champions League trip to {city}", "{club} pre-season camp {city}", "{event} team charter" (events table: Six Nations, Euro qualifiers, Davis Cup…), keep today's "away package" for season deals.
- **vip / adhoc / repatriation / hajj / humanitarian:** today's builders stay; add 3–4 variants each so no two consecutive offers from one client match.

**Tests** (`offers.test.ts`): 200 seeds × tourSeries never contain a weekday name in the title; the weekday appears in the blurb; no client gets the same title twice in a row; ski titles only for ski airports in winter; titles ≤ 60 chars.

---

## F5. Cabin crew join in about a week (ENGINE `core/balance.ts`, `crew/hr.ts`; UI text)

`BAL.hireDays` / `hireDaysWide` for `PUR` and `CC`: **7** (jitter ±20% stays → 6–8 days). Pilots unchanged (CPT 60/40, FO and CRP 45/35, rated-pool rules unchanged). Multi-type hires add days (§5). HireModal text: "Cabin crew join in about a week; pilots take 5–9 weeks (notice periods)." Bot: unchanged rules, they simply arrive sooner (sizing may hire later; no change needed).

---

## F6. Cabin refits start straight away, at home base (ENGINE `ops/cabin.ts`; UI `modals/RefitModal.tsx`)

- **Where:** at the **home base** (the player's rule: cabin retrofits happen at home). `refitStations(g, id)` returns `[{ code: homeBase, name: '{Company} hangar, {city}', ferryBlock }]` only; a booking elsewhere in an old save completes as booked.
- **When:** `BAL.refit.leadDays = 0`. The first slot is the next free window **from now** long enough for ferry home (if away) + refit days.
```ts
export interface RefitSlot { start: Minute; end: Minute; ok: boolean; why: string | null }
/** Earliest windows first (n ≤ 6), scanning 26 weeks; why = 'Busy until 14 Nov: flies the TUI summer programme' for the first refused day. Pure. */
export function refitSlots(g: GameState, aircraftId: string, label: string, n?: number): { slots: RefitSlot[]; busyUntil: Minute | null; busyWhy: string | null };
```
- **Modal:** the slot list on top: "Earliest: today 14:00 – 21 Nov (7 days)" as the pre-selected first row, then up to 5 more; the 2-week day grid stays below for a custom day. When the first free day is later than today, one plain line above the list: "Why not sooner? CS-TQB flies the TUI summer programme until 14 Nov." The "Hangar slots open 7 days ahead" line goes.
- **Crew rest seats** (§3) are the same modal's second section for widebodies without bunks.

---

## F7. Up Next more compact (MAP `map/OpsMap.tsx`, `styles/acmi/map.css`)

- At most **5** rows (`upNextRows(g, 5, now)`), panel width 360 px (was ~470), row height 30 px.
- Departures-board grid: 4 columns `time | flight / reg | route | type` with **thin horizontal and vertical divider lines** (1 px, `--line` token at 40%), monospace times, columns `56px 92px 96px 1fr`.
- The type cell keeps its short key (line swatch + word: Operating / Positioning / Ferry / Deadhead / Private jet, the crew count icon, the CREW SHORT chip). **The legend row under the panel is removed**; the "?" colour-legend button moves into the header row ("UP NEXT ·  ? ⌃").
- **Collapsible:** a chevron in the header (44 px target) folds the panel to the header line; the state is a per-viewer convenience in `localStorage` (`bh:upNextCollapsed`, wrapped in try/catch; defaults open).
- Nothing animates: fold/unfold is instant.

---

## F8. Top bar live ops strip (UI `shell/Shell.tsx`, new `shell/OpsStrip.tsx`; ENGINE read)

The empty space between the speed control and cash (~395 px at 1180) holds one calm strip, left to right:

1. **Warnings** (existing kinds, never dropped; a second and third collapse to "+2"):
   - PauseBadge when paused (unchanged; leftmost);
   - **CREW SHORT** `AWQ816 08:34` (red/amber from `shortFlights`) → Crew Control for the soonest;
   - **AOG** `CS-TQA LIS` → the aircraft's problem card;
   - **New aircraft offer** (F2) → the offer.
2. **Facts** as two-line mini blocks (tiny upper label, value below; like the cash block), each a button:
   - `AIRBORNE` `3/5` → Map;
   - `NEXT` `AWQ717 LHR→CGN · 1:20` → Schedule with the flight selected;
   - `ON TIME TODAY` `92%` (revenue legs landed since 00:00 UTC, on time = on blocks ≤ 15 min after scheduled, as `legsOnTime`) → Schedule; hidden while no leg has landed today;
   - `CREW` `14 on duty · 6 at hotels` → Crew.

**Read API (ENGINE, pure, `ops/strip.ts`, exported from `ops/index.ts`):**
```ts
export interface OpsStripFacts {
  airborne: number; fleet: number;                                   // fleet = on the AOC (not delivering/stored/leasedOut)
  next: { flightId: string; no: string; from: string; to: string; dep: Minute; aircraftId: string | null } | null;
  onTime: { landed: number; onTime: number } | null;                 // null before the first landing today
  crewOnDuty: number; crewAtHotels: number;                          // from crewAway (F1)
  aog: { aircraftId: string; reg: string; at: string }[];
}
export function opsStripFacts(g: GameState): OpsStripFacts;
```
**Calm and fit.** The strip re-renders on the clock step only (`Math.floor(clock / CLOCK_STEP[speed])`), never per frame; the countdown in NEXT moves in that step. No scrolling, no ticker, no animation. Fit by priority: a `ResizeObserver` on the strip container and fixed per-item widths (warning 132, NEXT 176, AIRBORNE 78, ON TIME 96, CREW 136, gap 8); drop **CREW → ON TIME → AIRBORNE → NEXT** until it fits; warnings collapse to one chip + count last. At 1180×820 and 1180×750 (same width) warnings + NEXT + AIRBORNE + ON TIME show; CREW shows when no warnings. The compact tier (`compact-acmi`) shows warnings + NEXT only.

---

## 1. EASA FTL: research doc and rules (ENGINE: `docs/acmi/EASA-FTL.md`, `crew/rules.ts`)

### 1.1 The research doc (write first, before code)
`docs/acmi/EASA-FTL.md`, plain markdown, ≤ 400 lines, sections in this order, each citing the article (Regulation (EU) No 965/2012 Annex III Subpart FTL as amended by 83/2014; ED Decision 2014/024/R CS FTL.1), with a "Game" line saying what the engine implements, simplifies or leaves out:
1. Definitions: FDP, duty, reference time, acclimatised (B / X / D), WOCL 02:00–05:59, local night, disruptive schedules, sectors, positioning.
2. **ORO.FTL.205(b) Table 1** (acclimatised: report bands × sectors 1–10) and **Table 2** (unknown state); the cabin crew rule **ORO.FTL.205(c)** (cabin crew FDP counted from their earlier report, extended by the reporting difference up to 1 h, so their limit is the pilots' limit + the difference).
3. **ORO.FTL.205(d)** planned extension (Table 4, +1 h twice in 7 days, WOCL sector limits): documented, **not simulated** (the roster never plans extensions).
4. **ORO.FTL.205(f)** commander's discretion: +2 h, +3 h augmented; rest after may be reduced but never below 10 h.
5. **CS FTL.1.205** in-flight rest: facility classes (class 1 bunk / flat bed separated from cockpit and passengers; class 2 seat ≥ 45° recline, ≥ 55 in pitch, 20 in wide, leg support, separated by a curtain; class 3 seat ≥ 40° recline, leg/foot support, separated by a curtain), augmented FDP table, ≤ 3 sectors, +1 h for one sector > 9 h flight time with ≤ 2 sectors, minimum in-flight rest (2 h landing pilots, 90 min others), rest at destination ≥ max(preceding duty, 14 h); the **cabin crew in-flight rest table** (RESEARCH §5.1 F3).
6. **ORO.FTL.210** cumulative: duty 60 h / 7 d, 110 h / 14 d, 190 h / 28 d; flight time 100 h / 28 d, **900 h per calendar year, 1,000 h per 12 consecutive calendar months**.
7. **ORO.FTL.235** rest: home max(duty, 12 h); away max(duty, 10 h) incl. 8 h sleep opportunity; recurrent extended recovery 36 h incl. 2 local nights, ≤ 168 h apart, increased twice a month to 2 local days; CS FTL.1.235 disruptive schedules (4+ → 60 h), time-zone recovery table.
8. **CS FTL.1.220** split duty (≥ 3 h break, +50%), **ORO.FTL.225 / CS FTL.1.225** standby (airport 100% duty; other standby ≤ 16 h, 25% counts; FDP reduction past 6 h), reserve: documented, **not simulated** in v0.7.2.
9. A "How BLOCK HOURS applies it" table: rule → `rules.ts` symbol → test name.

Numbers: RESEARCH §5.1 already holds the verified tables (F1–F13); EASA-FTL.md restates them by article. Where RESEARCH says "est." the doc says so.

### 1.2 `crew/rules.ts` changes (regression-safe)
Today's code already matches Table 1, Table 2, the augmented table, the rest minima and the cumulative duty/28-day block limits. Changes:

| Change | Detail | Risk |
|---|---|---|
| Export the tables as data | `FDP_BANDS` (report band → 1–2 sector FDP), `SECTOR_STEP = 30`, `FDP_FLOOR = 540`, `MAX_SECTORS = 10`, `AUG_FDP` (`{1: {1: 960, 2: 900, 3: 840}, 2: {1: 1020, 2: 960, 3: 900}}`), `AUG_BONUS = 60`, `AUG_MAX_SECTORS = 3`, `FDP_CAP = 1080`; `baseFdp`/`maxFdp` read them. | none (same values) |
| Discretion constants | `DISCRETION = { basic: 120, augmented: 180, minRest: 600 }`; `crew/control.ts` uses them instead of literals. | none |
| Cabin crew in-flight rest | `CABIN_REST: { upTo: number; c1: number; c2: number | null; c3: number | null }[]` (RESEARCH F3 table) and `cabinInflightRest(fdp, cls): number \| null` (null = not allowed). `complement()` keeps its extra-cabin rule (+1 above 14:30, +2 above 16:00 on class 2/3); feasibility refuses an augmented duty whose FDP needs a cabin class that is "not allowed" (cannot happen with today's pilot limits; asserted by test). | none |
| Cabin crew report earlier | `BAL.v072.ftl.cabinEarlyMin = { narrow: 0, wide: 15 }`. On widebodies cabin crew segs start 15 min before `duty.report`; their FDP and max FDP both grow by 15 (ORO.FTL.205(c)), so FDP legality is unchanged; duty windows and rest after grow by 15. Narrowbody 0 = no change for the bot's A320 year. | small (widebody only) |
| 1,000 h / 12 months | `LIMITS.block12m = 60_000`; `CrewMember.blockMonths?: Record<MonthKey, number>` (written at release, last 12 months kept); `TimelineCtx.block12m?` = logged last 11 months + this month; `evalSegs` checks logged + planned under code `'blockYear'` text "Block 12 months". Absent in old saves = 0 (only the 900 h calendar check bites, as today). | none for old saves |
| Two 2-local-day recoveries a month | documented; not enforced (the roster's 6-on/2-off work block already gives it); EASA-FTL.md says so. | none |

Everything else in `rules.ts` keeps its exact behaviour.

### 1.3 Tests (`crew/ftl.test.ts`, extend)
- Table 1 at every band edge (04:59, 05:00, 05:14, 05:15, 05:45, 05:59, 06:00, 13:29, 13:30, 13:59, 14:00 … 16:59, 17:00) × sectors 1–10 equals the regulation table literal written in the test (not computed).
- Table 2: 11:00, 10:30, 10:00, 9:30, 9:00, 9:00 for 1–2…7 sectors.
- Augmented: 6 cells; +1 h with one 9 h+ sector and ≤ 2 sectors; no bonus at 3 sectors; > 3 sectors falls back to Table 1; 18:00 cap.
- `minRest`: home 12 h, away 10 h, longer duty wins, 14 h after augmented away.
- `LIMITS` literal snapshot; `DISCRETION` literal; `CABIN_REST` rows; `cabinInflightRest(16:15, 3) === null`.
- Cabin early report: a widebody duty's cabin seg starts 15 min earlier with max FDP +15; a narrowbody duty's doesn't.
- Regression: the v0.7.1 fixtures' duty legality is identical before/after (every duty's `legality` and `maxFdp` unchanged on the A320 fixture; widebody fixture differs only by the cabin 15 min).

---

## 2. Captains flying as first officers (ENGINE `core/perf.ts`, `crew/roster.ts`, `crew/rosterActions.ts`, `crew/morale.ts`; UI labels)

- `canFill('FO', 'CPT')` and `canFill('CRP', 'CPT')` → **true**. Never an FO as captain (`canFill('CPT', x)` stays `x === 'CPT'`).
- **Auto-roster:** a captain enters an FO/CRP seat **only when the same-role stream is exhausted** (no acceptable FO for that seat), not through the −50 score merge used for other senior fills (FO→CRP, PUR→CC keep today's merge). Capacity, staffing and `crewAvailability` do **not** spill CPT→FO (planning stays honest: hire FOs).
- **Duty picker** (DutyModal / Crew Control "Fly someone in"): captains appear for an FO seat in their own group headed **"Captain flying as FO"**, after the FOs. `DutyCandidate.asFo?: true`.
- **Pay:** unchanged (salary is per person, not per seat).
- **Morale:** at duty release, a captain who sat in an FO/CRP seat gets `asFoAt.push(report)` (pruned to 30 days); from the **third** time in 30 days, morale −3 each time, driver `'career'`. `Stats.asFo` counts them.
- **Labels:** anywhere a seat is listed (roster board, duty modal, flight sheet, map aircraft panel crew list): `seatLabel(slotRole, crewRole)` → `'CPT (as FO)'` when they differ, otherwise the role. Shared pure helper in `core/perf.ts`:
```ts
export function seatLabel(slot: Role, role: Role): string;   // 'CPT (as FO)', 'PUR (as CC)', 'FO'
```
- **Card** `captainAsFo` (amber): WHAT "Capt. Ana Silva flies AWQ717 as first officer" · WHY "No A320 first officer is free on 14 Nov" · HURT "Not much: her pay stays; her morale drops if it happens more than twice a month (this is the 3rd)" · ACTIONS [Hire first officers → hire modal FO, Adjust crew → duty].

---

## 3. Crew rest compartments and crew rest seats (ENGINE `data/acmiTypes.ts`, `ops/market.ts`, `ops/cabin.ts`, `crew/timeline.ts`, `crew/duties.ts`, `contracts/feasibility.ts`, `ops/company.ts`; UI Fleet/Market/Refit/flight sheet)

### 3.1 Data
`AcmiType` gains `bunkShare: number` (0 never; 1 always fitted) and `yAbreast: number` (economy seats per row). `restClass` keeps meaning "class of a fitted compartment" and becomes **1** for every widebody (767/A330/A340 from 2):

| Type | bunkShare | yAbreast | Note |
|---|---|---|---|
| narrowbodies, 757 | 0 | 6 | never; no rest seats either |
| 767-300ER | 0.3 | 7 | overhead crew rest optional; many charter 767s use seats |
| A330-200 / -300 | 0.4 | 8 | lower-deck crew rest module optional |
| A340-300 | 0.6 | 8 | |
| 777-200ER | 0.85 | 10 | overhead crew rest on most |
| 777-300ER, 777-200LR, 787-9, A350, A350ULR, A380, 747-400 | 1 | 10/10/9/9/9/10/10 | standard |

`Aircraft.crewRest?: { bunks: boolean; seats: number }`: `bunks` = class 1 compartment; `seats` = crew rest seats fitted (the last economy row, curtained, class 3; 0 = none). `AircraftOffer.crewRest?` (same shape) rolled at offer creation with the offer's side RNG (`bunks = r < bunkShare`, `seats = 0`), copied on acquisition.

**Load defaults (fleet module `load`):** `ac.crewRest ??= { bunks: type.body === 'wide' && type.restClass !== null, seats: 0 }`. Old-save widebodies (whose type had class 1 or 2) get bunks: nothing an old save could do becomes illegal. New game / dev fleets: `bunks = bunkShare ≥ 0.5`.

### 3.2 Rules
```ts
// crew/timeline.ts (replaces the type lookup in restClassOf)
export function restClassAt(g: GameState, aircraftId: string | null): 1 | 3 | null;   // bunks → 1; seats > 0 → 3; else null
/** Seats blocked on a flight: crewRest.seats when its duty is augmented (or, unrostered, when its planned FDP needs it). Pure. */
export function restSeatsBlocked(g: GameState, flightId: string): number;
export function sellableSeats(g: GameState, flightId: string): number;               // cabin.total − blocked
```
- FDP with augmentation uses `restClassAt`: bunks → class-1 row (16/17 h, +1 h bonus); rest seats → class-3 row (14/15 h, +1 h). No crew rest → no augmentation (as a type without rest today).
- **Rest seats sell normally** when the duty needs no in-flight rest. When it does, `restSeatsBlocked` seats are taken out of sale for each flight of that duty. If a leg's `pax` exceeds `sellableSeats` (a duty became augmented after a delay or a cabin change), the extra passengers are offloaded once at roster time: `pax` clipped, `BAL.v072.restSeats.offloadPerPax` ($350) each posted to `penalties`, one message with the `restSeats` card.
- **Feasibility** (`contracts/feasibility.ts`): when the plan needs augmented duties, seats checked = `cabin.total − crewRest.seats`; a new check line: "Crew rest seats: 8 seats blocked on the long legs, 301 sellable (needs 300)" (ok/warn/no as the seats check). "Needs an augmented crew and no crew rest" replaces today's type-based text.
- **Ladder** (`ops/company.ts` approval reqs): `augmented` needs a widebody with `restClassAt` 1 or 3; `ulr` needs class 1 (ULR types always have bunks).

### 3.3 Fitting crew rest seats (the cabin configuration)
A widebody without bunks gets a second section in the Refit modal: **"Crew rest seats: block off the last economy row behind a curtain (class 3 rest). The {yAbreast} seats still sell on flights that need no in-flight rest."** Fit / Remove, `BAL.v072.restSeats = { days: 2, cost: 30_000, offloadPerPax: 350 }`, at home base, same `refitSlots` (F6). Booked as a `'refit'` maintenance with `refit: { cabin, restSeats: n }`; at the end `ac.crewRest.seats = n`. Not offered on narrowbodies, aircraft with bunks, or cabins without economy (`y < yAbreast`).

```ts
export function restSeatsQuote(g: GameState, aircraftId: string, fit: boolean, start: Minute): RefitQuote;   // pure; cabin unchanged
export function bookRestSeats(g: GameState, aircraftId: string, fit: boolean, start: Minute): ActionResult<{ maintId: string }>;
```

### 3.4 UI
- Fleet card and Market listing: a row **"Crew rest: bunks"** / **"Crew rest: seats (last row, 8)"** / **"Crew rest: none"** with `<Term id="crewRest">`.
- Flight sheet: "Seats 309 · 301 sellable on this flight (8 blocked for crew rest)" when blocked.
- Offer dialog: the feasibility line above.
- **Card** `restSeats` (amber, red when passengers are offloaded): WHAT "AWQ101 can sell 301 of 309 seats" · WHY "The 14 h duty needs in-flight rest and CS-TQB has no bunks, so the last row is curtained off" · HURT "Yes: 8 passengers offloaded, $2,800" / "Not much: the load is 280" · ACTIONS [Swap aircraft (Schedule), Plan crew rest (refit modal)].

---

## 4. Cabin ranks: PUR and CC (ENGINE `core/types.ts`, `core/perf.ts`, `core/balance.ts`, `crew/*`, `newGame.ts`, step-0 rename; UI wording)

- `Role = 'CPT' | 'FO' | 'CRP' | 'PUR' | 'CC'`. **PUR** = Purser, the senior cabin crew member (SCCM, ORO.CC.200); **CC** = cabin crew.
- **Complement** (`complement()`): exactly **1 PUR** + CC to the cabin number; a **second PUR** (deputy, upper deck) only when `AcmiType.pursers === 2` (A380, 747-400). Today's widebody No. 2 (SCC) becomes a CC seat.
- `canFill('CC', 'PUR')` true (a purser may work a CC position); `canFill('PUR', 'CC')` false.
- **BAL** (keys renamed; values): salary `PUR: [2_500, 2_900]`, `CC: [1_900, 2_100]`; perDiem `PUR: 60, CC: 54`; hireDays/hireDaysWide `PUR: 7, CC: 7`; training kind `'sccm'` (id unchanged) is the "Purser course" and makes the trainee a PUR.
- **New game:** `STARTUP_CREW` `['PUR', 10]` (was SCC) + `['CC', 30]`.
- **Save migration** (`crew` module `load`, idempotent `migrateRanks(g)`):
  - every `crew.role` `'CSD' | 'SCC'` → `'PUR'` (salary, ratings, history kept);
  - every pairing slot: the first cabin senior slot (`CSD`/`SCC`) → `'PUR'`; further senior slots → `'PUR'` when the type has 2 pursers, else `'CC'` (its crew member, a PUR now, still fits: `canFill('CC','PUR')`); `locked`/`extra`/`above` kept;
  - `g.hires[].role`, `decision.data.role` (Crew Control / gate decisions), `stats.ratedHires` keys (pilots only, untouched) and any `Role`-typed field found by grep;
  - message text is left as written (history).
  - Nothing is removed; head counts are unchanged.
- **Wording everywhere:** "Purser (PUR)" / "Cabin crew (CC)"; plurals "pursers", "cabin crew"; glossary `pur`. Docs: DESIGN.md/RESEARCH.md references are updated by the ENGINE lane with a one-line note ("v0.7.2: CSD/SCC merged into PUR").
- **Test** (`saveCompat.test.ts`): the v0.6 fixture (has CSD/SCC) loads → no `CSD`/`SCC` anywhere in `JSON.stringify(g)` roles/slots; crew count and ids equal before/after; every planned widebody pairing has exactly one PUR slot (two on A380); runs 30 days with 0 illegal duties; serialises and reloads equal.

---

## 5. Hiring flight attendants for several types (ENGINE `crew/hr.ts`; UI `modals/HireModal.tsx`, `screens/Crew.tsx`)

```ts
export interface HireRequest { role: Role; family: RatingFamily; base: string; count: number; /** v0.7.2 cabin crew: 1–3 types (family first). */ families?: RatingFamily[] }
// HireOrder gains families?: RatingFamily[]
```
- Pilots: one rating (family) as today; `families` ignored.
- Cabin crew (PUR/CC): `families` 1–3 distinct (the existing 3-type rule); the new crew get `ratings = families`.
- **Price** per head `BAL.hireCost.cabin × (1 + 0.5 × (types − 1))` → $2,000 / $3,000 / $4,000. **Joining** `7 + 3 × (types − 1)` days (jitter ±20%) → ~7 / 10 / 13.
- **HireModal:** role segmented (CPT FO CRP PUR CC). For PUR/CC the type control is a row of **tick boxes** (chips with a check mark, 44 px: "A320 family", "737", "757/767", "A330/A340", "777", "787", "A350", "A380"), fleet families first and pre-ticked for the family passed in; a 4th tick is disabled with "Up to 3 types". Pilots keep the dropdown. The quote line: "3 cabin crew · A320 + A330 · $9,000 · join 21 Nov (about 10 days)".
- **Staffing views:** `StaffingLine` gains `shared?: number` (rated crew counted here who also hold another type in the fleet). The Crew screen's staffing table shows "CC A330: 24 / 30 (8 also on A320)".
- **Bot:** when two or more fleet families are short of cabin crew at the same time, one order with both families; otherwise single-type as today.

---

## 6. Sell owned aircraft, return leases early (ENGINE new `ops/sale.ts`, `ops/leaseReturn.ts`; UI Fleet card, new `modals/SellModal.tsx`, LeaseModal)

### 6.1 Sell (owned)
```ts
export interface SaleQuote {
  ok: boolean; why: string | null;
  price: number; lines: { label: string; amount: number }[];   // 'Market value 2009 A320' … '−C-check life used' … 'Broker 2%'
  buyer: string; closes: Minute; bookValue: number; gain: number;
  blockers: string[];          // 'TUI summer programme: 12 legs after 14 Nov'
}
export function saleQuote(g: GameState, aircraftId: string): SaleQuote;               // pure (buyer and days from hashUnit(id + day))
export function sellAircraft(g: GameState, aircraftId: string, expectPrice?: number): ActionResult<{ closes: Minute }>;
export function cancelSale(g: GameState, aircraftId: string): ActionResult;
```
- **Value** (the v0.7 market model): `valueUsed × ageAdj(age) × index × hoursAdj × cyclesAdj − cLife − cabinAdj`, then −2% broker:
  - `ageAdj` exactly as `makeOffer` (−2%/year past 12, −4%/year past 18, 0.55–1.15);
  - `hoursAdj = clamp(1 − 0.15 × (hours / (age × FHyr) − 1), 0.85, 1.10)`, FHyr 3,000 narrow / 4,500 wide; `cyclesAdj` likewise with 0.10 and 1,500 / 700 cycles a year;
  - `cLife = cUsed × mid(BAL.checkCost.C) × 0.5` (the buyer prices the check coming); `cabinAdj` VIP −8%, others 0;
  - market index (`narrowIndex`/`wideIndex`).
- **Buyer:** a real lessor or airline name (`LESSORS`, `EX_OPERATORS` airlines). **Closes** in 10–20 days (hash). Handover at **home base**: a ferry home (purpose `'sale'`) is booked when it would be elsewhere.
- **Blockers:** any revenue leg or check after `closes − ferry` must be gone first (moved to another aircraft or sub-chartered): `sellAircraft` refuses with the list; the card's actions open the contract's sub-charter modal and the Schedule.
- **Close** (new `SimEventType` `'aircraft.sale'`): `cashOnly(g, bookValue)` + `post(g, 'assetSale', price − bookValue)` (cash moves by exactly the price; the statement shows the gain or loss), `settleDeparture`, aircraft removed, `Stats.sales++`, one message: "CS-TQA sold to AerCap for $11.4M. Handed over at Lisbon; a $1.1M gain over book value." Cancel before close: free ("the buyer walks away"), one message.
- **Card** `sale`: before: WHAT "CS-TQA can't be sold yet" · WHY "12 TUI legs are booked on it after 14 Nov" · HURT "Not yet: nothing lost" · ACTIONS [Sub-charter those legs, Open Schedule]. During: amber info card "CS-TQA goes to AerCap on 14 Nov".

### 6.2 Return early (leased)
```ts
export interface EarlyReturnQuote {
  ok: boolean; why: string | null;
  end: Minute;                  // return check ends (lessor wants 30 days' notice)
  fee: number;                  // early-return fee
  rentSaved: number; returnCosts: ReturnQuote; deposit: number; net: number;   // net = rentSaved + deposit − fee − returnCosts.total
  blockers: string[];
}
export function earlyReturnQuote(g: GameState, aircraftId: string, end?: Minute): EarlyReturnQuote;   // pure
export function returnEarly(g: GameState, aircraftId: string, end: Minute): ActionResult;
```
- Uses the v0.7 lease-return machinery: ferry to the return site + return check ending at `end`; `own.leaseEnd = end`; return costs as `returnQuote` (check, half-life, cabin back, repaint).
- `end ≥ now + BAL.v072.earlyReturn.noticeDays (30)`; default = the first day ≥ that with no signed work from the ferry out on.
- **Fee** = `max(3, 0.5 × monthsLeftAfterEnd) × rentPerMonth` (the lessor re-markets the aircraft), posted to `leaseReturn` when the return check starts; `returning.earlyFee` stores it.
- Not when: under 90 days left (use the normal return), already returning, delivering.

### 6.3 "Which one?" — least used
```ts
/** Aircraft by utilisation over the last 90 days (block hours from bhDays), lowest first. Pure. */
export function leastUsed(g: GameState, kind: 'owned' | 'leased' | 'any'): { aircraftId: string; bh90: number; perDay: number; days: number }[];
```
`Aircraft.bhDays?: [dayIndex, blockMin][]` (written at every arrival, last 90 days). Old saves start empty: `days` = days tracked so far; the card says "since 22 Oct" until 90 days exist.

### 6.4 UI
- Fleet card actions: **Sell…** (owned) / **Return early…** (leased, ≥ 90 days left), next to the existing Lease / Refit buttons. Fleet header: **"Which one?"** button → highlights the least-used aircraft (lease: least-used leased; else any) with a one-line card "CS-TQC flew 41 BH in 90 days (0.5 BH a day): the least used".
- SellModal / the LeaseModal "Return early" tab: the quote lines, the four-line card (blockers as WHY), a confirm button `Sell for $11.4M` / `Return on 30 Nov · fee $480K`.

**Bot:** never sells; returns a lease early only when it is the least used, flew < 1 BH a day for 90 days, has no signed work for the next 60 days, ≥ 6 months left and `net > 0` (at most one a year).

---

## 7. C-checks at real MRO hubs (ENGINE new `data/mro.ts`, `ops/maintenance.ts`; UI `modals/CheckModal.tsx`; MAP shows the ferries/deadheads as today)

### 7.1 Hubs (`src/data/mro.ts`)
```ts
export interface CHub { code: string; name: string; city: string; price: number }   // price × the C-check cost
export const C_HUBS: Record<RatingFamily, CHub[]>;
```
| Family | Hubs (price level) |
|---|---|
| A320 | Lufthansa Technik Sofia, SOF (0.85) · Lufthansa Technik Malta, MLA (0.95) |
| B737 | Aeroplex of Central Europe, Budapest BUD (0.85) · Atlantic Aviation Group, Shannon SNN (0.95) |
| B757/767 | AAR, Miami MIA (0.85; the euroAtlantic practice) · IAI Bedek, Tel Aviv TLV (0.95) |
| A330/340 | Sabena Technics, Bordeaux BOD (0.9) · Lufthansa Technik Malta, MLA (0.95) |
| B777 | Joramco, Amman AMM (0.8) · Turkish Technic, Istanbul IST (0.9) |
| B787 | Turkish Technic, Istanbul IST (0.9) · Etihad Engineering, Abu Dhabi AUH (1.0) |
| A350 / A380 | Lufthansa Technik Philippines, Manila MNL (0.8) · Etihad Engineering, Abu Dhabi AUH (1.0) |
| B747 | Turkish Technic, Istanbul IST (0.9) |

A-checks stay at base / line stations as today; **cabin refits and crew rest seats at home base** (F6).

### 7.2 Booking
```ts
export interface CCheckOption {
  hub: CHub; ok: boolean; why: string | null;
  start: Minute; end: Minute;                    // the check in the hangar
  ferryOut: DeliveryLeg[]; ferryHome: DeliveryLeg[];
  checkCost: number; ferryCost: number;          // fuel + fees both ways (ferryCost())
  crewCost: number;                              // 2 pilots: tickets home + back out, hotels (ferryCrewCost())
  total: number; awayDays: number;               // ferry out → ferry home landed
}
export function cCheckOptions(g: GameState, aircraftId: string, start?: Minute): CCheckOption[];   // pure; per hub, cheapest total first
export function cCheckSlots(g: GameState, aircraftId: string, hub: string, n?: number): Minute[];   // pure; earliest starts whose window holds ferry out + check + ferry home
export function bookCCheck(g: GameState, aircraftId: string, hub: string, start: Minute): ActionResult<{ maintId: string }>;
export function checkLogistics(g: GameState, maintId: string): { ferryOut: Flight[]; ferryHome: Flight[]; tickets: { crewIds: string[]; no: string; from: string; to: string; dep: Minute; cost: number }[] } | null;  // pure
```
- `bookCCheck` = `scheduleCheck(g, id, 'C', start, hub.code, { hub })` (the ferry out exists today: `m.ferryIds`) **plus a ferry home**: `planPositioning(home, …)` departing `end + BAL.v072.cHub.homeAfterMin (180)`, purpose `'check'`, ids in `m.homeIds`. Both ferries are crewed by the auto-roster, which positions the pilots by airline **deadhead** (home after the ferry out; back out before the ferry home) — on the map like any deadhead. Costs post as usual (fuel/fees on the ferries, `deadhead` and `hotels` on tickets, `checks` at the hub price).
- `checkAirportOk('C', at)` → true only at the type family's hubs (and at an existing booking's airport). Old saves: C-checks already booked at base stay valid (no ferry home).
- If the check's end moves, the ferry home is retimed (`retimeFlight`) to `end + homeAfterMin`; if it is cancelled, both ferries go.
- `MaintenanceEvent.hub?: { code; name; price }`, `homeIds?: string[]`; `Flight.purpose` gains `'check' | 'sale'`; `ticketPurpose` names "C-check ferry" tickets ("Home after ferrying CS-TQA to Sofia for its C-check").
- **Messages:** booking: "C-check booked: CS-TQA at Lufthansa Technik Sofia, 3–17 Nov. Ferry out 2 Nov LIS–SOF, home 17 Nov; the pilots fly home and back on airline flights. About $1.32M all in." End: today's message plus "Ferrying home 17 Nov 14:00."
- **Cards:** ferry without crew reuses `ferryUncrewed`; due/overdue reuse `checkDue`/`checkOverdue` with the hub in WHAT YOU CAN DO ("Plan at Sofia").

### 7.3 CheckModal
For a C-check: a hub list first (2 rows per family: name, city, price level as "−15%", ferry block each way, total, away days) — cheapest pre-selected; then the slot list from `cCheckSlots`; the summary: "Ferry out 2 Nov 08:10 LIS→SOF (3:55) · check 3–17 Nov · ferry home 17 Nov 14:00 · 2 pilots: 2 airline tickets home, 2 back (≈ $1,400)". After booking, the modal (reopened on the check) lists `checkLogistics` tickets with flight numbers. A-checks unchanged.

### 7.4 Bot
When a C-check warning arrives: `cCheckOptions` → the cheapest `ok` option whose first slot (`cCheckSlots`) ends before the due date, winter first (existing preference); `bookCCheck`.

**Balance intent.** Hub prices (0.8–0.95) save $120–500K a check; ferries and tickets cost $20–90K and 1–2 days more downtime: margin roughly neutral (bot year margin within band, AOG band unchanged).

---

## 8. What's new (`src/data/whatsNew.ts`, top entry; ENGINE lane as data)
- **version** 'v0.7.2', **name** 'Crew Rules & Fleet'.
- **features:**
  - "Real EASA flight time rules for pilots and cabin crew, written up from the regulation: duty limits by report time and sectors, in-flight rest by rest facility class, rest, and the yearly limits."
  - "Crew rest per aircraft: some widebodies have bunks, some don't. Without bunks you can curtain off the last economy row as crew rest seats; they still sell when nobody needs to rest."
  - "Pursers and cabin crew: CSD and SCC are now simply PUR, one per aircraft (two on the A380)."
  - "Captains can fly as first officers when no first officer is free. They keep their pay, but don't like it more than twice a month."
  - "Hire flight attendants for up to three aircraft types at once; they join in about a week."
  - "Sell owned aircraft and hand leased ones back early. 'Which one?' points at the least used."
  - "C-checks at real maintenance hubs: Sofia, Malta, Miami, Amman, Manila and more. Your pilots ferry the aircraft out, fly home on airline flights and fetch it when it's done."
  - "A live strip in the top bar: warnings first, then aircraft airborne, the next departure, today's on-time and where your crew are."
- **improvements:**
  - "Sub-chartering now costs reliability: clients notice when someone else flies their passengers."
  - "Contracts have real names: TUI summer programmes, Jet2 weekend rotations, ski charters, peacekeeper rotations."
  - "Market alerts live on the Market page; a new offer shows in the top bar."
  - "Cabin refits start as soon as the aircraft is free, at your home base."
  - "Up Next is a compact departures board you can fold away."
  - "The white dot stays on a city while any of your crew are still there."

---

## 9. Plain-language cards and glossary (ENGINE `problems/*`, `data/glossary.ts`; UI renders as v0.7.1)

New `ProblemKind`s (in `core/types.ts`): `'restSeats' | 'captainAsFo' | 'sale'`. Reused: `ferryUncrewed` (check ferries), `checkDue`/`checkOverdue` (hub actions), `leaseReturn` (early return), `refit` (slots). Each new kind has a builder (`problems/crew.ts`: captainAsFo, restSeats; `problems/fleet.ts`: sale), a `HINTS` entry and an Inbox message posted with `postProblem`. New `ProblemAction.open.modal` values: `'sell' | 'cCheck'` (the latter = `check` with `checkKind: 'C'`).

New `TermId`s: `'pur' | 'cabinCrew' | 'crewRest' | 'restClass1' | 'restClass3' | 'restSeats' | 'mro' | 'dryLease' | 'asFo' | 'marketValue' | 'earlyReturn'`:
- pur: "Purser: the senior cabin crew member in charge of the cabin (SCCM). One on every flight."
- crewRest: "A crew rest compartment: bunks hidden above or below the cabin where crew sleep on long flights (class 1 rest)."
- restClass1: "Class 1 rest: a bunk or flat bed away from passengers. Allows the longest duty days."
- restClass3: "Class 3 rest: an economy seat that reclines at least 40°, with a leg rest, behind a curtain."
- restSeats: "The last economy row curtained off for resting crew; sold to passengers when nobody needs to rest."
- mro: "Maintenance, repair and overhaul: the hangar company that does heavy checks."
- dryLease: "Renting an aircraft without crew; we fly it on our licence and hand it back at the end."
- asFo: "A captain sitting in the first officer's seat because no first officer was free. Same pay."
- marketValue, earlyReturn, cabinCrew: one line each in the same voice.

---

## 10. Data model (ENGINE lands first: one additive edit of `core/types.ts`, plus the step-0 Role rename)

```ts
export type Role = 'CPT' | 'FO' | 'CRP' | 'PUR' | 'CC';                       // v0.7.2 (CSD, SCC migrated to PUR in load)

export interface Aircraft { /* … */
  /** v0.7.2 bunks (class 1) and crew rest seats fitted (last economy row, class 3; 0 none). load: ??= by type */
  crewRest?: { bunks: boolean; seats: number };
  /** v0.7.2 daily block minutes [dayIndex, min], last 90 days. */ bhDays?: [number, number][];
  /** v0.7.2 an agreed sale. */ sale?: { buyer: string; price: number; agreed: Minute; closes: Minute; ferryIds?: string[] };
  returning?: { site: string; maintId: string; ferryIds: string[]; quote: number; /** v0.7.2 */ earlyFee?: number };
}
export interface AircraftOffer { /* … */ /** v0.7.2 */ crewRest?: { bunks: boolean; seats: number } }
export interface MaintenanceEvent { /* … */
  refit?: { cabin: Cabin; /** v0.7.2 crew rest seats at the end */ restSeats?: number };
  /** v0.7.2 C-check at an MRO hub; ferry home legs. */ hub?: { code: string; name: string; price: number }; homeIds?: string[];
}
export interface Flight { /* … */ purpose?: 'delivery' | 'return' | 'refit' | 'check' | 'sale' }
export interface Contract { /* … */ /** v0.7.2 std of legs handed to rivals (90-day reliability cost). */ subLegs?: Minute[] }
export interface Client { /* … */ /** v0.7.2 last offer title (no repeats). */ lastTitle?: string }
export interface CrewMember { /* … */
  /** v0.7.2 reports flown in an FO/CRP seat as a captain (30 days). */ asFoAt?: Minute[];
  /** v0.7.2 block minutes per month, last 12 (1,000 h / 12 months). */ blockMonths?: Record<MonthKey, number>;
}
export interface HireOrder { /* … */ /** v0.7.2 cabin crew types */ families?: RatingFamily[] }
export type SimEventType = /* … */ | 'aircraft.sale';
export type ProblemKind = /* … */ | 'restSeats' | 'captainAsFo' | 'sale';
export interface Stats { /* … */ subLog?: Minute[]; sales?: number; earlyReturns?: number; asFo?: number }
```
`AcmiType` (data, ENGINE): `bunkShare: number; yAbreast: number; pursers?: 1 | 2`; `restClass` 1 for every widebody.

**Load defaults:** crew `migrateRanks(g)`; fleet `ac.crewRest ??= …`; everything else optional and read with `??`.

## 11. Balance (`core/balance.ts`, new ENGINE block + renamed role keys)
```ts
// ---------- crew rules & fleet v0.7.2 (ENGINE; UPDATE-0.7.2.md §11) ----------
v072: {
  ftl: { cabinEarlyMin: { narrow: 0, wide: 15 } },
  sub: { base: 0.3, max: 1.0, shareFrom: 0.10, shareSpan: 0.233, nFrom: 4, nSpan: 16, capPerAction: 8, relationPerLeg: 0.5, relationCap: 4, windowDays: 90 },
  cabinHire: { days: 7, extraTypeDays: 3, extraTypeCost: 0.5 },
  asFo: { freePerMonth: 2, morale: -3 },
  restSeats: { days: 2, cost: 30_000, offloadPerPax: 350 },
  sale: { daysMin: 10, daysMax: 20, broker: 0.02, fhYear: [3_000, 4_500], cyclesYear: [1_500, 700], vipAdj: -0.08, cLifeShare: 0.5 },
  earlyReturn: { noticeDays: 30, minLeftDays: 90, feeShare: 0.5, feeMinMonths: 3 },
  cHub: { homeAfterMin: 180 },
},
// refit.leadDays: 0; hireDays/hireDaysWide PUR 7, CC 7; salary/perDiem keys PUR (see §4)
```

## 12. Interfaces between lanes (final signatures; ENGINE ships stubs first)

```ts
// ---- ENGINE exports used by UI/MAP ----
// crew/index.ts
export function crewAway(g: GameState): { at: Map<string, string[]>; onDuty: number; atHotels: number };          // pure (F1, F8)
export interface HireRequest { role: Role; family: RatingFamily; base: string; count: number; families?: RatingFamily[] }
export function hireQuote(g: GameState, r: HireRequest): { cost: number; readyAt: Minute; beyondPool: number; fee: number };  // + multi-type
// StaffingLine gains shared?: number; DutyCandidate gains asFo?: true
// core/perf.ts
export function seatLabel(slot: Role, role: Role): string;
export function canFill(slot: Role, role: Role): boolean;                       // + CPT in FO/CRP, PUR in CC
// crew/timeline.ts (re-exported from crew/index.ts)
export function restClassAt(g: GameState, aircraftId: string | null): 1 | 3 | null;
export function restSeatsBlocked(g: GameState, flightId: string): number;
export function sellableSeats(g: GameState, flightId: string): number;
// crew/rules.ts
export const FDP_BANDS, AUG_FDP, CABIN_REST, DISCRETION, LIMITS; export function cabinInflightRest(fdp: number, cls: 1 | 2 | 3): number | null;
// ops/index.ts
export function opsStripFacts(g: GameState): OpsStripFacts;                     // F8
export function subcharterHit(g: GameState, flightIds: string[]): SubcharterHit; // F3; SubcharterQuote.hit
export function refitSlots(g, aircraftId, label, n?): { slots: RefitSlot[]; busyUntil: Minute | null; busyWhy: string | null };
export function restSeatsQuote(g, aircraftId, fit: boolean, start: Minute): RefitQuote;
export function bookRestSeats(g, aircraftId, fit: boolean, start: Minute): ActionResult<{ maintId: string }>;
export function saleQuote(g, aircraftId): SaleQuote; export function sellAircraft(g, aircraftId, expectPrice?): ActionResult<{ closes: Minute }>; export function cancelSale(g, aircraftId): ActionResult;
export function earlyReturnQuote(g, aircraftId, end?): EarlyReturnQuote; export function returnEarly(g, aircraftId, end: Minute): ActionResult;
export function leastUsed(g, kind: 'owned' | 'leased' | 'any'): { aircraftId: string; bh90: number; perDay: number; days: number }[];
export function cCheckOptions(g, aircraftId, start?): CCheckOption[]; export function cCheckSlots(g, aircraftId, hub: string, n?): Minute[];
export function bookCCheck(g, aircraftId, hub: string, start: Minute): ActionResult<{ maintId: string }>;
export function checkLogistics(g, maintId): { ferryOut: Flight[]; ferryHome: Flight[]; tickets: {…}[] } | null;
// data
export const C_HUBS: Record<RatingFamily, CHub[]>;   // data/mro.ts
export const GLOSSARY / HINTS (+ new ids); WHATS_NEW (v0.7.2 top)
// dev (engine/dev.ts)
export function devRestSeats(g: GameState): string;          // a widebody without bunks, seats fitted, an augmented duty booked; returns its flight id
export function devSaleReady(g: GameState): string;          // an owned aircraft with no work after 10 days; returns its id
```
**UI store additions** (`src/ui/store.ts`, additive): `ModalSpec` `| { kind: 'sell'; aircraftId: string } | { kind: 'lease'; aircraftId: string; tab?: 'renew' | 'early' }` (lease gains `tab`); `CheckModal` spec unchanged (`checkKind: 'C'` shows hubs); `dev.restSeats()`, `dev.saleReady()`, `dev.marketOffer()` (exists). No new settings (Up Next fold is localStorage in MAP).

**MAP lane reads:** `crewAway` (F1 dots), `upNextRows` (its own), `seatLabel` (aircraft panel crew list), `Flight.purpose` `'check' | 'sale'` (labels: "C-check ferry", "Sale ferry" in `PURPOSE_LABEL`), `restSeatsBlocked` (aircraft panel line "8 seats blocked for crew rest" on the current leg).

## 13. Bot (`scripts/acmi-bot.ts`, ENGINE)
Pure in g, run after every step as today. New rules (header comment updated):
- **C-checks** at hubs via `cCheckOptions`/`cCheckSlots`/`bookCCheck` (§7.4).
- **Cabin hires** multi-type when ≥ 2 families short (§5); they arrive in ~7 days.
- **Crew rest seats:** when the company holds `augmented` and a widebody without bunks or seats gets (or would get) a job needing augmentation: `bookRestSeats` in its first slot (once per aircraft).
- **Leases:** early return rule (§6.4); never sells.
- **Captain as FO** happens through the auto-roster; tally `stats.asFo`.
- **Printed** (new soft line): "v0.7.2: sub-chartered legs N (reliability −X), C-checks at hubs [SOF, AMM], ferry+ticket cost $Y, rest seats fitted N, captains as FO N, early returns N, sales N."
- **Targets:** every v0.7.1 target still passes on seeds 1–6 (one at a time): margin −5%…+12%, ≤ 0.3% uncovered, 0 illegal duties, morale 55–75, resignations 4–20%, AOG 1–3 per aircraft-year, < 12 s. New hard target: "C-check ferries: 0 illegal duties"; soft: "reliability within ±5 of start + v0.7.1 drift", "captains as FO ≤ 24 duties a year".

## 14. Tests and acceptance

**ENGINE tests**
- `crew/ftl.test.ts`: §1.3.
- `crew/hr.test.ts`: cabin hire 7 days ±20%; 2 types $3,000/head and ~10 days; 4 types refused; pilots unchanged; `StaffingLine.shared`.
- `crew/roster.test.ts`: an FO seat with no FO free → captain assigned, `seatLabel` 'CPT (as FO)'; with an FO free (even at a worse score) → the FO; never an FO in a CPT seat; the third time in 30 days morale −3, the second no hit.
- `crew/timeline.test.ts` (or ftl): `restClassAt` for bunks/seats/none; an augmented duty on a seats aircraft gets the class-3 limit (14:00 + bonus); `restSeatsBlocked` 0 on an unaugmented duty, `yAbreast` on an augmented one; offload posts `penalties` once.
- `contracts/feasibility.test.ts`: the crew rest seats line (ok / no at the seat margin); no-rest widebody refuses an augmented job.
- `ops/subcharter.test.ts` (new) / `flights.test.ts`: first leg −0.3; a contract with 1/3 sub-chartered → −1 per leg; 20 legs in 90 days company-wide → −1; cap −8 per action; relation −0.5/leg; quote `hit` equals the applied hit; legs older than 90 days stop counting.
- `contracts/offers.test.ts`: F4 title rules.
- `ops/cabin.test.ts`: refit at home base only; first slot starts today when free; `busyWhy` names the commitment; rest-seat refit sets `crewRest.seats`.
- `ops/sale.test.ts` (new): value monotonic in age/hours/cycles/C-life; blockers refuse; close posts cash = price and `assetSale` = price − book; cancel free; ferry home booked when away.
- `ops/leaseReturn.test.ts`: early quote fee = max(3, 0.5 × months) × rent; notice ≥ 30 days; `leastUsed` order from `bhDays`.
- `ops/maintenance.test.ts`: C-check at base refused for new bookings, allowed at hubs; `bookCCheck` creates ferry out + home with purpose `'check'`; roster crews both with deadheads (tickets exist, 0 illegal); end moved → ferry home retimed; cancel removes both; old-save base C-check still runs.
- `ops/strip.test.ts` (new): `opsStripFacts` counts on a fixture.
- `saveCompat.test.ts`: v0.5.2, v0.6, v0.7, v0.7.1 fixtures load; rank migration (§4 test); `crewRest` defaults (old widebodies bunks); 60 days run clean; serialise/reload equal.
- `core/plumbing.test.ts` purity: `crewAway`, `opsStripFacts`, `subcharterHit`, `refitSlots`, `restSeatsQuote`, `saleQuote`, `earlyReturnQuote`, `leastUsed`, `cCheckOptions`, `cCheckSlots`, `checkLogistics`, `restClassAt`, `restSeatsBlocked`, `sellableSeats`, `seatLabel`.
- Bot seeds 1–6, 365 days, one at a time: §13.

**UI acceptance** (`scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch; new shots `topbar-strip`, `topbar-strip-warnings`, `market-toggles`, `hire-multitype`, `refit-earliest`, `refit-rest-seats`, `sell`, `return-early`, `which-one`, `check-hub`, `flight-sheet-rest-seats`, `whats-new-072`):
- Settings has no market rows; Fleet → Market has both toggles; `dev.marketOffer()` shows the top-bar chip; tapping opens the offer and the chip goes.
- The strip shows warnings first, then NEXT/AIRBORNE/ON TIME; nothing overflows or wraps at 1180 px; values change only on the clock step (count renders over 60 s at 4×: ≤ 1 per step); no console errors.
- Hire: tick boxes for PUR/CC, max 3, quote updates; pilots keep the dropdown. No 'CSD'/'SCC' text anywhere in the UI.
- Refit: the first row is today (aircraft free) or carries the "Why not sooner?" line.
- Sell / Return early: quote lines, card, confirm; "Which one?" highlights a card.
- Check modal C: hubs with price levels, ferry times, tickets after booking.
- Every tappable element ≥ 44 px; nothing animates except aircraft.

**MAP acceptance**
- `dev`: crew left resting at FUE keep the white FUE dot after the aircraft leaves; it goes when they fly home.
- Up Next: ≤ 5 rows, grid lines both ways, no legend row, "?" in the header, folds and stays folded after reload; no layout jump at 4×.
- C-check ferry legs and the pilots' deadheads draw like other ferries/deadheads; the aircraft panel names "C-check ferry"; crew list shows 'CPT (as FO)'.

## 15. Not in v0.7.2 (keep it simple)
- No planned FDP extensions, split duty, standby duty or reserve in the engine (documented in EASA-FTL.md only); no FAA rules.
- No class 2 rest option for the player (the table keeps the row); no business-seat crew rest.
- No aircraft sale auctions, no buyer negotiation, no sale-and-leaseback; no part-out.
- No new auto-pause reasons, sounds or settings (the Up Next fold is a per-viewer localStorage convenience).
- No per-hub queues or slot scarcity at MROs; no engine shop visits.
- No new contract archetypes; F4 changes names only.

## 16. File ownership and sequencing

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**` (incl. new `ops/{sale,strip}.ts`, tests), `src/data/**` (new `data/mro.ts`; `acmiTypes.ts`, `market.ts`, `glossary.ts`, `whatsNew.ts`, `naming.ts`), `scripts/acmi-bot.ts`, `docs/acmi/EASA-FTL.md` (new), DESIGN.md/RESEARCH.md rank notes. Shared, minimal and additive, first: `core/types.ts` (§10), `core/balance.ts` (§11). **Step-0 exception:** the mechanical Role rename CSD/SCC → PUR in every file that names them (incl. `src/ui/screens/{screenLogic,rosterBoardLogic,RosterBoard}.ts(x)`, `src/ui/components/problemLogic.ts`, `src/ui/modals/{crewControlLogic,TrainModal}.ts(x)` + tests, `src/ui/map/{MapPanels.tsx,mapLogic.test.ts}`), one atomic change so tsc stays green; afterwards those files go back to their lanes. | F1 `crewAway`, F3, F4, F5, F6 engine, F8 `opsStripFacts`, 1–7 engine, 8 data, §9 cards/glossary, §13 bot, saves |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`: `shell/Shell.tsx` + new `shell/OpsStrip.tsx`, `game/Modals.tsx` (Settings rows out), `screens/{Market,Fleet,Crew,Schedule,RosterBoard,screenLogic}.ts(x)`, `modals/{HireModal,RefitModal,CheckModal,LeaseModal,SubcharterModal,CrewControlModal,DutyModal,BlockSheet,OfferModal}.tsx`, new `modals/SellModal.tsx`, `store.ts` (additive §12), `scripts/ipad-shots.cjs` (new shots). `src/styles/**` except map styles: new `styles/acmi/v072.css` imported from `styles/acmi/index.css`. | F2, F8 strip, F6 modal, 2 labels/picker group, 3 rows/sections, 4 wording polish, 5 tick boxes/staffing, 6 modals/buttons, 7 check modal, §9 rendering |
| **MAP** | `src/ui/map/**` (`OpsMap.tsx`, `mapLogic.ts` + test, `MapPanels.tsx`, `LiveLayers.tsx`), `src/styles/acmi/map.css` | F1 dots, F7 Up Next, purpose labels, panel lines (seatLabel, rest seats) |

**Sequencing**
1. **ENGINE step 0** (before UI/MAP touch role code): §10 types + §11 BAL + the atomic Role rename + `migrateRanks` + stubs for every §12 export (quotes return `ok: false, why: 'v0.7.2 stub'`; reads return empty/zero; `seatLabel` real). tsc/vitest/build green. UI and MAP start on F2/F7/F8 layout meanwhile without touching role literals.
2. **ENGINE order:** EASA-FTL.md (§1.1) → rules.ts + ftl tests (§1.2–1.3) → F5 + §4 complement/BAL → F1 `crewAway` + F8 `opsStripFacts` → F3 → F4 → captain as FO (§2) → crew rest (§3) → F6 refit slots + rest seats → multi-type hires (§5) → C-check hubs (§7) → sale / early return / leastUsed (§6) → cards + glossary + whatsNew (§9, §8) → dev helpers → bot (§13) last; seeds 1–6 and save fixtures.
3. **UI order:** Settings/Market toggles (F2) → OpsStrip (F8) → HireModal (§5) → RefitModal (F6, §3.3) → labels/picker (§2) and wording (§4) → Fleet rows, Sell/Return early/Which one (§3.4, §6) → CheckModal hubs (§7) → sub-charter chips (F3) → shots.
4. **MAP order:** Up Next (F7) → hotel dots (F1) → labels/panel lines.
5. **Merge order:** ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green; the bot runs seeds 1–6 one at a time.
