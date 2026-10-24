# BLOCK HOURS v0.9 "Experience": design

Plan of record for v0.9, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events allowed, Dubai player, iPad landscape 1180×820 / Safari 1180×750, touch only, calm visuals, 1×/2×/4× only). DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only (side rolls via `sideRng` / `hashUnit`); read APIs pure and added to `core/plumbing.test.ts`; ids via `nextId`;
- money only through `post` / `accrue` / `cashOnly` / `invoice`; flights only through the core helpers;
- `SAVE_VERSION` stays 1; every new field is optional with a `??=` default in its module's `load`, so v0.5.2 … v0.8 saves keep working (new fixture `save-v08.lz.txt`, §13).

The player's words (23 Oct, latest): *"Crew has way too many off days, should be mostly standbys including out of base. Learn EASA roster planning guidelines and plan accordingly."* (§R; ENGINE builds it first after step 0.)

The player's words (23 Oct): *"I won't have time to play v0.8, so those new features show in the next version pop-up."* · *"On 'longest day' don't count up to captain's discretion: it's only discussed near the end of the duty as an emergency and can't be agreed before or when signing a contract."* · *"A new alert for this: 'crew out of hours' when a pilot or flight attendant has reached their legal limits."* · *"Lots of typical aviation sounds: high chimes, low chimes, high-low (new contract), double high-low (medium emergency), triple high-low (serious emergency)… calm sounds for calm situations and urgent sounds for urgent situations."* Answers: one urgent alarm shared by crew shortage and crew out of hours; yes to crew slips at fuel stops; yes to the What's new catch-up.

Agreed list (stages 1–3 done):

| # | Feature | One line |
|---|---|---|
| 5 | Department heads (unlockable automation) | Seven hires earned through achievements. Each has a salary and a skill, makes the odd mistake, can be overridden or switched off, and never takes the big decisions. |
| 14 | Achievements, sound, tutorial hints | An achievement gallery on the Company screen with calm toasts, the aviation sound set (S) and gentle first-time hints per screen. |
| S | Aviation sound set | WebAudio cabin and cockpit chimes with fixed meanings, one urgent alarm, rate-limited, with per-category settings and a test list. |
| T | Crew out of hours | Its own alert, card, icon and pause, separate from crew shortage. It uses the urgent alarm. |
| U | Commander's discretion is never planned | An audit and a guard so discretion only appears after report, for an unforeseen delay. The Longest-day popover says so. |
| V | Language pass | Remove repetition and filler game-wide without losing information (before/after list in §V). |
| W | Crew slip at a fuel stop | Long one-way flights with a tech stop split the duty: a fresh crew flies in by airline and takes over. Priced in, planned, drawn. |
| X | What's new catch-up | The first v0.9 launch shows v0.9, v0.8 and v0.7.4 once, even if v0.8 was already seen. |
| Y | v0.8 follow-ups | Re-check the in-flight rest plan at departure; 747-400 jumbo loads; bot speed. |
| R | Roster planning like a real EASA operator | Days off are only the legal and contractual minimum (8–10 a month in 2–3-day blocks, 4 weeks' leave), published 14 days ahead and protected. Every other non-flying day is standby: at home, at the hotel on detachments and night-stops, at the airport at busy bases, or reserve. Crew Control calls standby first. |

Calm rules hold: nothing flickers and only aircraft move. Toasts stay rare. Sounds are rate-limited (§S.4). Every new problem gets the four-line card (WHAT · WHY · DOES IT HURT? · WHAT YOU CAN DO). Nothing else is added (§15).

---

## 5. Department heads (F5)

### 5.1 Who they are

| Id | Title | Unlocks when | Salary / month (mid) | Does | Never does |
|---|---|---|---|---|---|
| `opsControl` | Ops Control duty manager | 25 revenue sectors in a row flown with a legal crew (counted from the first contract) | $9K | Answers routine `sickCrew` (call in) and gate `crewShort` decisions where a short delay is the fix, using the player's rules | Sub-charter, cancel, discretion, AOG, airspace, anything over the delay limit |
| `maintPlanner` | Maintenance planner | First C-check completed before it was due | $8K | Books A-checks 3–14 days ahead into maintenance nights and gaps, including line stations on deployment bases; moves a booked A-check when a clash appears; proposes the best C-check slot | Book a C-check, a refit or a check that cancels revenue legs |
| `crewDesk` | Crew scheduling desk | 2 closed calendar months in a row with ≥ 98 % crew coverage and at least one revenue sector (round 4: the agreed plain count, no 100-sector bar) | $14K (two schedulers) | Repairs the roster after disruptions: runs Crew Control fixes on amber flights (auto-fix, deadhead, call-in) within a cost limit; keeps home standby filled; proposes round-up hires | Private jets above the limit, sub-charter, cancel, swaps between contracts |
| `analyst` | Commercial analyst | 5 contracts completed (round 4: every completed contract counts, `g.stats.contractsDone`) | $9K | Scores every open offer against the fleet and suggests a counter-price | Accept, decline or counter |
| `credit` | Credit controller | The first late government payment collected | $6K | Chases late payers with reminders, answers `latePayment` with Wait or Waive (rule), and asks slow payers for deposits on new charters | Threaten, sell invoices, sue |
| `fleetPlanner` | Fleet & positioning planner | The first widebody joins the fleet | $10K | Proposes ferries home for idle aircraft, pre-positioning before a contract and the fuel-stop and crew-slip plan for long positioning | Sign, buy, lease, sell or ferry above the player's limit |
| `watch` | Watch desk | Reliable reputation 90 or more held 30 days (§5.7 pacing; `BAL.v09.heads.unlock.reliable` / `reliableDays`) | $5K | Runs the player's custom alert and auto-pause rules (§5.6) | Take any action: it only alerts and pauses |

Big decisions always stay with the player: which contracts, which aircraft, crises (AOG, airspace, uninsurable, rescue, cancellations, sub-charters).

### 5.2 Data (ENGINE `ops/heads.ts` load; types in `core/types.ts`)
```ts
export type HeadId = 'opsControl' | 'maintPlanner' | 'crewDesk' | 'analyst' | 'credit' | 'fleetPlanner' | 'watch';
export interface HeadCandidate { name: string; years: number; skill: number; salary: number; blurb: string }
export interface HeadLogLine { t: Minute; kind: 'done' | 'mistake' | 'proposal' | 'overridden'; text: string; ref?: Ref }
export interface HeadProposal { id: string; t: Minute; kind: 'ferryHome' | 'position' | 'cSlot' | 'hire'; text: string; cost: number; expires: Minute; ref?: Ref; data: Record<string, string | number> }
export interface AlertRule { id: string; kind: 'cashBelow' | 'delayOver' | 'offerOver' | 'idleOver' | 'clientDown' | 'checkDue'; value: number; action: 'pause' | 'alert'; on: boolean }
export interface HeadRules {
  maxDelayMin?: 60 | 120 | 180; standbyFirst?: boolean;             // opsControl (defaults 120, true)
  fixMax?: number; jetMax?: number; autoHire?: boolean;             // crewDesk (8_000, 0, false)
  waiveTrusted?: boolean; depositSlow?: boolean;                    // credit (true, true)
  autoFerryMax?: number;                                            // fleetPlanner (0 = proposals only)
  alerts?: AlertRule[];                                             // watch (max 8)
}
export interface Head {
  id: HeadId;
  unlockedAt: Minute | null;
  candidates?: HeadCandidate[];                                     // rolled at unlock (3), kept until one is hired
  hired: { name: string; skill: number; salary: number; since: Minute } | null;
  on: boolean;
  rules: HeadRules;
  proposals: HeadProposal[];
  log: HeadLogLine[];                                               // last 12
  handled: number; mistakes: number; overridden: number;
}
// GameState (v0.9): heads?: Record<HeadId, Head>   load ??= all locked, default rules, empty logs
```
**Old saves.** On the first daily tick after load, unlock conditions are evaluated. Anything already earned unlocks with one combined message ("Three department heads are available: you earned them before v0.9") and one celebration card listing them. They are never hired automatically.

### 5.3 Rules (numbers in `BAL.v09.heads`)
- **Candidates at unlock** (3, named from `data/names.ts`, side stream): junior skill 0.55–0.65 at salary × 0.7; mid 0.70–0.80 × 1.0; senior 0.85–0.92 × 1.45. Hiring is immediate; the candidates stay on offer until one is hired. Fire: one confirm, one month's salary in severance, and the head can be hired again from fresh candidates after 30 days.
- **Skill** grows +0.02 every 90 days employed (cap 0.95).
- **Salary**: monthly, ledger cat `salaries` (line "Department heads"), via the existing month-end salary run.
- **Mistakes**: each handled item rolls `chance = (1 − skill) × 0.35` (junior ≈ 13 %, senior ≈ 4 %) on the engine RNG. A mistake is the second-best legal choice, never an illegal or big one, and is logged in plain words. Examples:
  - Ops Control delays TP1234 by 1:20 when standby could have taken it;
  - the planner books an A-check 15 % early (that interval share is lost, about $4–9K);
  - the crew desk buys a $1,900 ticket where a standby was free;
  - the analyst's margin estimate is off by up to ±(1 − skill) × 15 % (deterministic `hashUnit(offerId + hiredSince)`, shown honestly in the log after the contract ends: "Ana overestimated the Condor margin by 9 %");
  - credit control chases a Trusted client too early (relation −2);
  - the fleet planner proposes a stop 5–10 % costlier than the best.
- **How they act.** A hook in `core/messages.ts` (`setDecisionHook`, the `setShortHook` pattern) lets `heads.ts` take a decision the moment it is posted, when the right head is hired and on and the rule allows. In that case there is no pause and no dialog: the head applies the option and posts **one quiet message** (`cat` of the decision, `topic: 'head'`, `ref` to the flight or receivable, `cue: 'headDone'`): "**Ops Control called in Rita Costa for TP1234** — Sick call: Ana Silva. Rita is on home standby at LIS, no delay." Overriding means tapping **Change** in that message, which opens Crew Control (or the decision's own screen). Any fix the player applies to the same flight or receivable within 2 h counts as `overridden`.
- **Proposals** (fleet planner, maintenance planner C-slot, crew desk hires) never pause. One message per proposal with `ref: {kind: 'head', id}`; the Team view lists them with Accept / Dismiss; they expire after 72 h (C-slot: 14 days).
- **Per head.**
  - **Ops Control.** `sickCrew` → `callIn` when a legal replacement exists and ready ≤ report + `maxDelayMin`; else it leaves the decision to the player. A gate `crewShort` → `delay` when a legal crew is ready within `maxDelayMin` and the delay costs no penalty (wet: none; charter: < 3 h).
  - **Maintenance planner.** Runs after `planChecks`. It books an A-check when it is ≥ 75 % used, or due within 14 days, into the best gap: maintenance night > base hangar > deployment base line station (a line A-check at an outstation costs +20 %). If a booked A-check now clashes, it moves it (`maintMove`) to the nearest legal slot. When a C-check is due within 120 days, one `cSlot` proposal with `suggest` for the CheckModal.
  - **Crew desk.** Hourly, on amber flights (crew alert stage, §T), it applies the cheapest Crew Control fix among `autoFix | deadhead | callIn` (and `jet` ≤ `jetMax`) with cost ≤ `fixMax`. Once a month, a `hire` proposal from Crew Planning round-up when short of complete sets (or it hires up to 4 people a month when `autoHire`).
  - **Credit.** Reminders at due + 3 d and due + 10 d; each raises the chance the receivable pays within 7 days by `0.15 + 0.25 × skill` (rolled once per reminder). `latePayment` → `waive` for Trusted+ when `waiveTrusted`, else `wait`. With `depositSlow`, charters signed with clients whose `payReliability` < 0.8 take a 30 % deposit (governments: 20 %, instead of 0).
  - **Fleet planner.** Daily: an aircraft idle ≥ 48 h away from home with nothing in the next 72 h → `ferryHome` proposal (cost from `ferryCost`; "or leave it at JED: 2 open offers fit there"). Before a contract start with positioning: `position` proposal to fly the day before when the same-day plan leaves < 1 h of crew FDP margin. It auto-accepts when the cost ≤ `autoFerryMax`. New action `ferryAircraft(g, aircraftId, to)` through `planPositioning` (kind `ferry`, fuel stops as legs).
  - **Watch desk.** §5.6.

### 5.4 Unlock moments
On unlock: message "**You've earned an Ops Control duty manager**" (`topic: 'head'`, `cue: 'headUnlocked'`) and the celebration card (`{kind: 'headUnlocked', id}`, queued like ladder steps, never over another dialog). Card at 1180×820: a header with the head's icon and title, one line on what earned it ("25 sectors in a row, all with legal crews"), three candidate cards side by side (name, years, a skill bar, salary, a one-line blurb, **Hire** 44 px) and **Not now**.

### 5.5 UI: Company › Team (new view)
Company tabs become **Overview · Team · Clients · Rivals · Achievements** (`nav.view`).
- **Left list** (460 px): 7 rows of 64 px each: icon, title, then either the person (name, skill %, salary) with an on/off pill, or "Locked" with the unlock line and a thin progress bar ("18 of 25 sectors"), or "Available: choose a candidate".
- **Right pane**: the person, skill bar, salary, **On/Off** toggle, **Rules** (the head's `HeadRules` as `Seg`/`Stepper`/`Toggle` rows, 44 px), "Does" and "Never does" lines, **Proposals** (Accept / Dismiss), **Recent** (12 log lines; mistakes amber, overrides grey) and footer counters "Handled 41 · mistakes 3 · overridden 2". Fire is a small text button with a confirm.
- **Offer card chip** "Analyst 78" (50 + margin %, so 99 needs a 49 % margin; round 4 fix: ×2 saturated at 25 %) and an **OfferModal "Analyst" block**: score pill, verdict ("Take it on CS-TQA: margin about 18 %" / "Counter at $1.24M: they usually accept within 8 % of asking" / "Pass: no aircraft makes money on it"), and **Use $1.24M**, which fills the counter field.

### 5.6 Watch desk rules (custom alerts and auto-pause)
Up to 8 rules, each a row: kind (Seg), value (Stepper), action (**Pause** / **Alert only**), on/off. The kinds:
- **Cash below $X** (default $500K);
- **A flight delayed more than N h** (2);
- **An offer worth more than $X arrives** ($1M);
- **An aircraft idle more than N days** (3);
- **A client drops a level**;
- **A check due in N days with no slot** (10).

The engine checks them hourly (`ops/heads.ts`). The first time a rule triggers for a given subject, it posts one message ("**Your rule: cash below $500K**" — "Cash is $468K after the Condor lease payment.") and either requests `requestPause('rule')` or only alerts (cue `ruleAlert`). It never fires again for the same subject until the condition clears. Mistake: the alert comes up to 1 h late (never missed).

### 5.8 Round 4 (audit): the heads as built
Every unlock threshold is read from `BAL.v09.heads.unlock` (25 legal sectors; 2 closed months at ≥ 98 % with ≥ 1 revenue sector; 5 contracts; Reliable 90 held 30 days). `loadAchievements` creates `stats.v09` before the backfill (the Reliable clock starts at load) and seeds the overdue-check clock. `defaultRules` reads `BAL.v09.heads.ops/desk`.
- **Ops Control.** *Standby first* (on by default): a sick call is answered only with a replacement from a standby window or a free crew member whose published days off are untouched (no day-off swap, §R.5: that ask is the player's); otherwise the decision stays with the player. Off: every sick call comes to the player; the head still holds at the gate. The ticket mistake is rolled only when it is real: the replacement was not on standby although someone of that role was; it costs the smaller of $1,200 and the crew desk's fix limit. A gate hold is taken only while no penalty or relation hit is due: never ≥ 3 h late (VIP ≥ 30 min) on any contract kind.
- **Credit control.** Its note carries `ref: {kind: 'receivable'}` (`latePaymentDecision` sets it); the Inbox **Change** action asks the decision again (`reopenLatePayment`, `data.player: true`, never taken by a head) and the player's choice within 2 h counts as overridden (`setReceivableHook`). Head notes on a flight get the same Change action into Crew Control.
- **Maintenance planner.** A clashing A-check is cancelled only after a replacement slot was found on a copy; with none it stays booked (the check waits for the inbound leg) and one warning per booking carries the clash card. A line A-check away from home costs +20 % (`maint.outstation`, charged by `planA`). The C-check slot proposal survives Accept (the UI opens the check planner on that slot, `suggest`/`after`) until a C-check is booked; the daily pass drops it then.
- **Fleet planner.** `position` proposals: a contract's first revenue leg within three days whose same-day positioning (landing within 12 h before it) leaves the crew under `fleet.marginMin` (60 min) of FDP, or that no one crew can fly with the first duty (`dutyNeed`), is proposed as positioning the day before, arriving `arriveBeforeMin` (12 h) ahead of the leg: `ferryAircraft(g, ac, from, arriveBy, contractId)` replaces the contract's later same-day legs with billable positioning through `planPositioning` (tried on a copy first). Fuel stops are legs ("via IST"); a positioning too long for one crew carries the crew-change text from `bestSlip` (§W). Auto-run under `autoFerryMax`, else a proposal that expires before the ferry's day. Dismissals (any head) are remembered per subject for `dismissDays` (14) or until the situation changes (a ferry-home subject includes the station): "Dismissed until 12 Nov: …" on the log.
- **Analyst.** At signing the contract records `analyst: {name, pct, est}` (the shown margin and the planner's own for that aircraft); when it ends the log says "Winter sun: margin 18.2 % (Ana said 20.1 %)" and, from ±5 % relative error, the mistake "Ana overestimated the Condor margin: said 20.1 %, it was 18.2 %" (counted, no inbox message).
- **Watch desk.** A subject held back an hour (the mistake roll) that clears before the next pass needs no alert, but the miss is counted and logged. Alert rule ids come from `nextId(g, 'ar')` (the UI passes `id: ''`).
- **Heavy check, on time** is judged at induction (`MaintenanceEvent.onTime`, set in `onMaintStart`; `onMaintEnd` counts from it), not at release.

### 5.7 Balance intent
The early game has no heads, so the player struggles first. Expected unlocks (bot seeds 1–6): Ops Control by day 30, crew desk by day 120, analyst by day 150, credit by day 240, fleet planner with the first widebody (day 150–300), maintenance planner with the first C-check (often year 2), watch desk late in year 1 or in year 2. All seven together cost about $61K a month: below 4 % of a year-2 monthly revenue. They take away roughly half of the routine decisions, never the interesting ones.

---

## 14. Achievements and first-time hints (F14; sound in §S)

### 14.1 Achievements (data ENGINE `data/achievements.ts`, checks `ops/achievements.ts`, daily and after relevant events)
```ts
export type AchievementId = string;   // ids below
export interface AchievementDef { id: string; title: string; text: string; group: 'ops' | 'crew' | 'tech' | 'commercial' | 'fleet' | 'company'; icon: string /* lucide name */; head?: HeadId }
// GameState (v0.9): achievements?: Record<string, Minute>   load ??= {} then a silent backfill (one summary message, no toasts)
// Stats (v0.9): v09?: StatsV09 (§10)
```
| Group | Id · title | Earned when |
|---|---|---|
| ops | `cleanSheet` · Clean sheet | 25 revenue sectors in a row with a legal crew → **Ops Control** |
| ops | `clockwork` · Like clockwork | a month with ≥ 95 % on-time departures (≥ 40 departures) |
| ops | `outstationFix` · Fixed it away from home | the first AOG away from base resolved without a sub-charter |
| ops | `ninetyClean` · Ninety days, nothing cancelled | 90 days without a leg cancelled by us |
| crew | `fullCover` · Every seat filled | 2 months in a row with ≥ 98 % crew coverage → **crew desk** |
| crew | `bunkTime` · Bunk time | the first augmented duty flown with a legal rest plan |
| crew | `slipCrew` · Fresh crew at the fuel stop | the first crew slip at a tech stop (§W) |
| crew | `standby` · Saved by standby | 5 standby call-ins |
| crew | `goodPlace` · A good place to work | company morale ≥ 75 at a month end |
| tech | `cOnTime` · Heavy check, on time | the first C-check completed before due → **maintenance planner** |
| tech | `noOverdue` · A year without an overdue check | 365 days, no check overdue (round 4: the clock starts at the first revenue departure, or at load for an older save, like `lastCancel`; a grounding resets it) |
| commercial | `fiveFlown` · Five flown | 5 contracts completed → **analyst** |
| commercial | `paidInTheEnd` · They paid in the end | the first late government payment collected → **credit control** |
| commercial | `partner` · Partners | a client reaches Partner |
| commercial | `firstCall` · First call | signed an offer a rival was bidding on |
| commercial | `hajj` · Hajj airlift | a Hajj contract completed |
| commercial | `homeSafe` · Bring them home | an evacuation or repatriation completed |
| commercial | `blueIce` · Blue ice | a landing on an Antarctic ice runway |
| fleet | `widebody` · Widebody | the first widebody joins → **fleet planner** |
| fleet | `queen` · Queen of the Skies | a 747-400 revenue sector flown |
| company | `reliable` · Reliable | Reliable reputation 90 or more held 30 days (`BAL.v09.heads.unlock`) → **watch desk** |
| company | `cleanRecord` · Clean record | Clean reputation ≥ 80 |
| company | `inTheBlack` · In the black | a calendar year with a positive net result |
| company | `rainyDay` · Rainy-day fund | $5M cash at a month end |

Goals and ladder steps stay as they are (the Ladder). Achievements are a separate gallery.

**Unlock** posts one message (`cat: 'goal'`, `topic: 'achievement'`, `cue: 'achievement'`) and a calm toast (trophy icon, title and text, 4 s; no confetti). When an achievement unlocks a head, the head's card (§5.4) follows instead of a second toast.

**Company › Achievements** (UI): six group headings, tiles in 4 columns (≈ 268 × 96 px): icon, title, one line, then the date earned or a thin progress bar ("3 of 5 contracts"). Unearned tiles are dimmed but readable. There are no secret ones. The head line "14 of 24".

### 14.2 First-time hints per screen (UI `src/ui/screenHints.ts`)
One gentle card per screen the first time it opens, placed under the screen header at the top right (360 px, static, no animation), with **Got it** (hides it for this session) and **Don't show again** (saved). Settings › Plain language › "First-time hints: Show again" resets both the problem hints (`hintsSeen`) and the screen hints (`screenHintsSeen`). The voice is for an ACMI insider, with no "Welcome!" and no explaining what a flight attendant does:
- **map**: "Live ops. Tap an aircraft for its duty, crew and next legs; pins are open offers. Amber and red strips at the top are what needs you."
- **contracts**: "Offers come with an expiry and a rival may take them first. Wet offers pay per block hour against an MGH; charters are all-in and you pay the fuel. The light on each card is the planner's verdict for your best aircraft."
- **offer**: "Pick the aircraft, read the red and amber lines, then accept, counter or let it go. A counter costs time: urgent clients answer in hours, others in a day or two."
- **schedule**: "One row per aircraft. Hatched is positioning, striped is maintenance, faint is idle. Tap a block for its sheet; drag a trip onto another row to swap aircraft."
- **crewPeople / crewBoard / crewPlan**: "People: limits as fuel gauges." · "Roster board: OFF days are published 14 days ahead and protected; SBY, ASBY and RES are your standby pool. Drag to swap; red is illegal." · "Planning: crew sets per type, and Round up hires exactly what completes them."
- **fleet**: "Each card shows the checks, the cabin, the crew rest and the longest legal day. The Market tab sells and leases aircraft: few at a time, long lead times."
- **finance**: "Revenue lands as legs fly; governments pay late. The forecast line is cash, not profit."
- **company / team**: "Reputation, approvals and policies." · "Department heads are earned, not bought: each takes routine work off your desk, makes the odd mistake, and can be switched off."
- **inbox**: "Decisions sit on top. Each problem has a four-line card: what, why, does it hurt, what you can do."
- **crewControl**: "Every way to crew this flight, cheapest and quickest first. The bar shows how late the nearest crew would land."

---

## S. Aviation sound set (UI `src/ui/sound.ts`; cues from ENGINE)

### S.1 How events reach sound
- ENGINE emits **cues**: runtime-only, never saved, collected like pause requests (`core/cues.ts`: `cue(c)`, `takeCues()`, isolated in previews by `isolatePauses`). `pushMessage` and `pushDecision` emit a cue derived from the message (`cueOfMessage`, one table in `core/cues.ts`). Non-message events call `cue()` directly (departure, arrival, a new offer, offer lapsing). The bot and tests ignore cues.
- The UI store calls `takeCues()` after every `advanceTo` and after every action, then `sound.event(cue)`. UI-only events (`UiEvent`: tap, toggle, toggleOff, error, pause, resume; the speed buttons send toggle) call `sound.event()` directly.
- **One table** maps each event to exactly one sound: `SOUND_OF: Record<SoundEvent, SoundId>` in `src/ui/sound.ts`. The table below is that table and is its documentation; keep them identical.

### S.2 The sounds
All are synthesised with WebAudio. Bells are sine partials 1× (1.0), 2× (0.18, decaying twice as fast) and 3× (0.06, three times as fast), plus a 1× triangle (0.08) and a second voice detuned by +2 cents. The attack is 4 ms, followed by an exponential decay to −60 dB in 1.8 s (high) / 2.3 s (low). A shared room reverb (a `ConvolverNode` with a generated 1.2 s stereo noise impulse, wet 0.12) is built once. The chain is: per-category `GainNode` → master gain → `DynamicsCompressor` (−18 dB, ratio 3) → destination. There are no square or saw waves and nothing harsh.

| SoundId | Category | What it is |
|---|---|---|
| `tap` | ui | soft click: 1.6 kHz sine 25 ms plus a 6 ms filtered-noise tick, gain 0.04 |
| `toggle` | ui | two ticks 40 ms apart (rising for on, falling for off) |
| `error` | ui | low soft "dunk": 196 Hz triangle, 120 ms |
| `high` | chimes | single soft bell, A5 880 Hz |
| `low` | chimes | single soft bell like the seat-belt ding, D5 587 Hz, slower decay |
| `ding` | chimes | cockpit-style single ding, D6 1175 Hz, softer (0.16) with a 1.0 s decay |
| `highLow` | chimes | the classic bing-bong: 880 Hz then F5 698 Hz, 0.55 s apart |
| `highLowSoft` | chimes | the same at −6 dB, 0.7 s apart, longer decay |
| `double` | alerts | `highLow` twice, the pairs 1 s apart (≈ 2.2 s) |
| `triple` | alerts | `highLow` three times (≈ 3.3 s) |
| `alarm` | alerts | the urgent alarm, master-caution style: 3 bursts, each 3 pulses of a C6 + G6 dyad (1047 + 1568 Hz, sine + triangle, low-pass 3.2 kHz), 110 ms on / 70 ms off, about 0.5 s between bursts; ≈ 2.6 s total, never looped |
| `achievement` | chimes | warm ascending three-note chime C5–E5–G5, 0.16 s apart, the last held with a soft octave |
| `flourish` | chimes | pleasant flourish: G4–C5–E5–G5–C6 arpeggio, 0.09 s apart, softer, with a light triangle shimmer |
| `ambCabin` | ambience | cabin hum: brown noise low-passed at 180 Hz plus two sines at 98/101 Hz (slow beat), gain 0.05 |
| `ambTerminal` | ambience | terminal air: pink noise band-passed 300–1,500 Hz with a 0.05 Hz level drift, gain 0.04 |

### S.3 Event → sound (fixed meanings; `SoundEvent` = engine `Cue` ∪ UI events)

| Event (`SoundEvent`) | When | Sound |
|---|---|---|
| `tap` | any button, tab, chip | `tap` |
| `toggle` | toggles, segmented controls, speed buttons | `toggle` |
| `error` | an action refused (`store.act` error toast) | `error` |
| `pause` · `resume` | the player pauses or resumes; an auto-pause | `low` |
| `flightDep` · `flightArr` | our flight departs / lands (only with **Flight chimes** on; off by default) | `low` |
| `message` | a new routine inbox message (info/good) | `high` |
| `crewJoined` | a hire joins, training done, an aircraft delivered | `high` |
| `paymentIn` · `monthEnd` | a receivable paid, the month closed | `high` |
| `headDone` | a department head handled something | `high` |
| `decision` | a calm decision waits (change request, fee, lease notice, proposal) | `ding` |
| `offerNew` | a new contract offer arrives | `highLow` |
| `contractSigned` | we signed, or the client accepted our counter | `highLowSoft` |
| `aog` | an AOG | `double` |
| `delayPenalty` | a delay of 60 min or more with a penalty risk (charter `perDelay`, VIP) | `double` |
| `sickCall` | a sick call with no replacement yet | `double` |
| `latePayer` | a receivable is late (decision) | `double` |
| `offerLapsing` | an offer the player opened has < 6 h left (once per offer) | `double` |
| `worldEventOurs` | a world event touches our flights | `double` |
| `crewAmber` | a crew shortage or out-of-hours flight at the amber stage (48 h) | `double` |
| `ruleAlert` | a watch-desk rule fired | `double` |
| `cancelRisk` | a flight about to be cancelled (gate crew decision, uninsurable, a hold over 6 h) | `triple` |
| `airspaceActive` | airspace closed on a flight that is scheduled or airborne | `triple` |
| `cashNegative` | the day cash crosses below zero (with its four-line card; round 4 fix: the only cash card while cash is below zero, the fortnightly "Cash runs out" warning waits for cash to recover), and the rescue decision | `triple` |
| `evacuation` | an urgent evacuation or repatriation request | `triple` |
| `clientCollapse` | a client drops to Unhappy | `triple` |
| `crewShortage` | CREW SHORTAGE (red stage, 12 h) | `alarm` |
| `crewOutOfHours` | CREW OUT OF HOURS (red stage, or found at departure) | `alarm` |
| `achievement` · `ladder` | an achievement or a ladder step | `achievement` |
| `headUnlocked` · `headHired` | a department head unlocked or hired | `flourish` |

The urgent alarm is used **only** for `crewShortage` and `crewOutOfHours`.

### S.4 Rate limit and merge
- Chimes and alerts go through a 900 ms merge window that starts at the first request. When it closes, the highest-priority sound plays **once**. Priority: `alarm` 100 > `triple` 90 > `double` 80 > `achievement` 70 > `flourish` 65 > `highLow` 60 > `highLowSoft` 55 > `ding` 45 > `high` 40 > `low` 30.
- Cross-sound window (v0.9 round 4, the player's call): for **4 s** after any sound plays, only a request that outranks it plays; the rest are dropped (one meaning at a time, never a burst). After the window a lower-priority alert plays as usual (an AOG `double` 5 s after a crew `alarm` is heard).
- Cooldown per sound for a **repeat of the same sound**: `alarm` 20 s (a second flight's red inside 20 s is merged: the urgent alarm never sounds twice inside 20 s), `triple` 10 s, `double` 6 s, `highLow` 3 s, `ding`/`high` 2.5 s, `low` 2 s.
- UI sounds play at once (not merged), at most one per 50 ms, and are muted while an alert sound plays.
- At 4×, with five arrivals and an offer in one second, only one `highLow` plays.

### S.5 Settings, unlock, platform
- `Settings` (UI store, `load` merges defaults): `sound` (master, default **true**), `volume` (default 0.6 for new installs; kept for old ones), `soundCats: { alerts: true; chimes: true; flights: false; ui: true }`, `ambience: 'off' | 'cabin' | 'terminal'` (default `'off'`). Category gains: alerts 1.0, chimes 0.8, ui 0.5, ambience 0.25.
- **Settings › Sound** section (replaces the two rows): Master on/off, Volume slider, toggles **Alerts** (emergencies and the urgent alarm), **Chimes** (messages, offers, achievements), **Flight chimes** (every departure and landing), **UI clicks**, and a **Ambience** Seg (Off · Cabin · Terminal). **Test sounds** opens a list (inside the settings modal, scrolling): one 56 px row per SoundId with its meaning ("Triple high-low: serious, e.g. airspace closed on an active flight") and a ▶ button.
- **iOS/Safari**: a `pointerdown` or `keydown` anywhere (capture; the listener stays, so a later tap wakes a context iOS suspended or interrupted) creates or resumes the `AudioContext` and plays a one-sample silent buffer. Set `navigator.audioSession.type = 'ambient'` when available (Safari 16.4+), so the ringer switch mutes the game and the player's music keeps playing. Suspend the context when the page is hidden and resume it when visible. Nothing plays before that first tap. While the context is asleep (a call, Siri, another app's audio: WebKit's `interrupted`) nothing is rendered on its frozen clock; at most the highest-priority request is kept and plays once at the next tap, so a minute-long interruption never ends in a burst of stacked chimes (round 4).
- Previews and dry runs on copies of the state (Crew Control's nine previews, the delay search, a head's trial, roster-board verdicts) run inside `isolatePauses`, which mutes `cue()` and keeps pending pauses: a delay the player only looked at never chimes or stops the clock (round 4).
- Ambience fades in over 2 s on the game screen and out on the title screen or when switched off.

---

## T. Crew out of hours (ENGINE crew + problems; UI; MAP banner)

### T.1 What it is
**Crew shortage** is a seat with nobody to fill it. **Crew out of hours** is a named pilot or cabin crew member rostered on the flight who has reached a legal limit. The limits (`OohLimit`, from `crew/rules.ts LIMITS` and the FTL checks):
- `fdp`: the day would run over its FDP limit;
- `duty7d` 60 h · `duty14d` 110 h · `duty28d` 190 h · `block28d` 100 h · `blockYear` 900 h · `block12m` 1,000 h;
- `rest`: minimum rest not met;
- `recovery`: no 36 h weekly rest;
- `inflightRest`: the in-flight rest plan no longer works (§Y.1);
- `daysOff` (§R): the month's days off would fall below 7.

### T.2 Data and detection
```ts
export type OohLimit = 'fdp' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'block12m' | 'rest' | 'recovery' | 'inflightRest' | 'daysOff';
// PairingSlot (v0.9): ooh?: { crewId: string; limit: OohLimit; over: number /* min */; at: Minute }   // set when guardDuty / the roster takes a crew member off for a limit; cleared when the seat is legally refilled
// Duty (v0.9): plannedFdp?: number   // §U
// ProblemKind += 'crewHours'; Message.topic += 'crewHours' | 'achievement' | 'head'; PauseReason += 'crewHours' | 'rule'
```
- `crewAlertKind(g, flightId): 'short' | 'hours' | null` (pure). It returns `'hours'` when any rostered crew member's root reason is `fdp | rest | hours | recovery`, when the duty's FDP is over the limit, when a slot carries `ooh`, or when the rest plan failed at departure. It returns `'short'` for other missing or illegal cases (wrong place, busy, sick, not rated, nobody free), and `null` when the flight is fine. **Hours wins** when both apply, because it names a person.
- The warning ladder (`escalate` in `crew/control.ts`) is unchanged in timing: amber inside 48 h, red inside 12 h. It is split by kind:
  - red `'short'` → message topic `crewRed`, title "CREW SHORTAGE: TP1234 in 6 h", pause `crewShortage`, cue `crewShortage`;
  - red `'hours'` → topic `crewHours`, title "**CREW OUT OF HOURS: TP1234 in 6 h**", pause `crewHours`, cue `crewOutOfHours`;
  - amber, either kind → cue `crewAmber`, title "TP1234: crew out of hours" or "TP1234 has no crew".
- `shortFlights(g)` rows gain `kind: 'short' | 'hours'`. `Stats.v09.oohRed` and `oohAmber` count them.

### T.3 The card (`problems/crew.ts crewHoursCard`, `problemFor` kind `crewHours`)
| Line | Text |
|---|---|
| WHAT | "Ana Silva (purser) is out of hours for TP1234" (two people: "Ana Silva and 1 other …") |
| WHY | which limit, by how much, in words: "Her 28-day flying would reach 101:20 (limit 100 h)." · "The day would run 14:25 after the 1:40 delay; the limit is 13:00." · "Her rest ends 03:10, after the 02:30 report." |
| DOES IT HURT? | the shortage card's money/pax/delay hurt ("Yes: 180 passengers wait; $38K if cancelled") |
| WHAT YOU CAN DO | the real fixes, cheapest first: "Replace her: Rita Costa is on standby at LIS · Delay 2:10 for her rest · Sub-charter · Cancel" |

Gauges: the limit's gauge from `crewGauges`. Terms: `fdp`, `rest`, `blockHours`, `recovery` and `outOfHours` (new glossary term). `discretion` is a term **only** when §U allows it.

### T.4 UI
- **Icon** `TimerOff` (lucide) for crew out of hours everywhere (inbox row, OpsStrip, card header, Crew Control title). Crew shortage keeps `UserX`/`Users`.
- **OpsStrip**: a new item `crewHours` ("Out of hours · 2", red at the red stage), next to `crewShort`; `fitStrip` keeps both before any other item.
- **Pause badge**: "Crew out of hours"; tap → Crew Control for the soonest such flight.
- **Settings**: a toggle row "Pause for crew out of hours" (default on) under the crew-shortage toggle.
- **Inbox**: filter chip "Crew" covers both kinds; the row shows the icon and the red banner like crew shortage.
- **Crew Control** (`CrewControlModal`): the title reads "Crew out of hours · TP1234". Under it sits a one-line strip naming the person, the limit and the gauge. The fixes are the same as for a shortage (§U for discretion).

### T.5 MAP
The aircraft panel banner (MapPanels, v0.7.1 crew banner) reads `crewAlertKind`: "Crew out of hours · Ana Silva (28-day hours)" with `TimerOff`, or the shortage text as today. There is no new map glyph.

---

## U. Commander's discretion is never planned (EASA ORO.FTL.205(f))

### U.1 Audit (done for this doc; ENGINE confirms with tests)
| Place | Today | v0.9 |
|---|---|---|
| Longest day (`restPlan.longestDay`: fleet card, market, refit preview, popover) | the limit is the augmented limit (3/4 pilots resting on board), not discretion; the popover doesn't say so | the text is unchanged; **`detail` rewritten** (§U.2); test: `best` ≤ `augLimit` max and never includes `DISCRETION` |
| Contract feasibility and pricing (`feasibility.ts`, `restNeed`, `ulrNeed`, `pricing.ts`) | no discretion | a test asserts it |
| Roster planner (`duties.ts planAircraft`, `slipUnits`, `partition`) | no discretion; `maxFdp + discretion` only on duties where it was applied | a test asserts it |
| Trip moves (`tripMove.ts`) | no discretion | a test asserts it |
| Offer generation (`offers.ts crewCanFly`) | no discretion | a test asserts it (with slips, §W) |
| `restPlan` | no discretion | a test asserts it |
| Change requests (`events.ts` retime: "Crew duty X of Y") | `lim` includes discretion only if already applied | keep; the text never suggests discretion |
| Gate holds (`flights.ts fdpOver`) | applies discretion automatically once reported | **only when unforeseen** (§U.3) |
| Crew Control `discretion` fix, the `crewShort` gate decision | offered after report, any cause | **only after report and unforeseen** (§U.3) |
| `crewShortCard` terms | pushes `discretion` for planned FDP problems | the `discretion` term only when §U.3 allows |

### U.2 Longest-day popover (ENGINE `longestDay().detail`, glossary `longestDay`)
- Card line unchanged: "13 h · up to 17 h".
- `detail`: "**13 h with 2 pilots** (14 h as a planned extension, twice a week per crew). **Up to 17 h with 4 pilots** who take turns to rest on board (pilots in bunks, cabin crew in curtained seats). Captain's discretion is never part of this: it is only for surprises on the day, after the crew has reported." (Without the approval: "Days over 13 h need the Augmented crew approval.")
- Glossary `longestDay` (short): "The longest day this aircraft can be planned for: 2 pilots, or 3–4 pilots who take turns to rest on board. Captain's discretion is never planned."
- Glossary `discretion` (short): "On the day only: after the crew has reported, if something unforeseen happens, the captain may extend the day by up to 2 h (3 h with an augmented crew). Never planned, never in a contract."

### U.3 When discretion is offered (ENGINE `crew/roster.ts`)
```ts
export function discretionCheck(g: GameState, dutyId: string): { ok: boolean; why: string; addMin: number };   // pure
```
- `Duty.plannedFdp` is set in `onDutyReport`: the FDP from report to the last leg's **scheduled** arrival at that moment (`??=` for old saves: computed at the next check from current std/sta minus known delays).
- `ok` only when all of these hold:
  1. `d.report <= g.now`;
  2. no seat is empty;
  3. discretion was not used yet;
  4. `plannedFdp ≤ maxFdp` (the day was legal when they reported: the overrun is unforeseen);
  5. the overrun is ≤ `discretionMax`.
- The plain reasons when it is not offered:
  - "Only after the crew has reported. For a planned day: a fresh crew, a delay or more pilots."
  - "The day was already too long when they reported: that's planning, not an emergency."
  - "Seats are empty: discretion doesn't crew a flight."
  - "Already used on this duty."
  - "Over by 3:10: more than discretion allows."
- Used by `applyDiscretion` (refuses with `why`), `crewControl` (the `discretion` row is shown greyed with `why`; never the default), `crewShortDecision` (`canDisc`) and `fdpOver`. Gate holds apply it only when `ok`; otherwise the duty is illegal and becomes **crew out of hours** (§T).
- `Stats.v09.discretionUsed` and `discretionRefused`. Bot target: 0 uses with `plannedFdp > maxFdp`.

---

## V. Language pass (all lanes, their own files)

### V.1 Rules
1. Say each thing once: name the client once, a number once with its unit, and never repeat what the screen shows right above.
2. Lead with the subject. Use no filler ("as it stands", "please note", "in order to", "currently", "simply", "at this time").
3. Use insider-correct words: block hours, MGH, positioning, deadhead, FDP, slip crew, tech stop, AOG, sub-charter.
4. Keep the four-line card; WHAT ≤ 60 characters.
5. Never lose information: if a word goes, its meaning must already be on screen.

Scope:
- ENGINE: problem cards, inbox messages, feasibility lines, offer blurbs and titles, glossary, What's new, Crew Planning verdict (`crew/sets.ts`), check lines;
- UI: screen labels, tooltips, toasts, modal copy;
- MAP: panel copy.

### V.2 Root fixes
- **Offer titles never contain the client name** (`contracts/flavor.ts` title templates). The client is shown separately and `jobName` adds it once. This fixes "Corendon's Winter sun to Corfu for Corendon". Round 4: the templates themselves are clientless ("Extra capacity at Hamburg", "AOG cover: an A320 at Hamburg", "Winter sun to Corfu"; no title starts with a bare verb); `clientless()` stays for titles saved by older versions.
- **Crew Planning verdict** keeps only what the tiles above don't show.

### V.3 Before / after (lanes append rows here: append-only, re-read before editing)
| Where | Before | After |
|---|---|---|
| offer card (`offerFitCard`) | "You can't fly Corendon's Winter sun to Corfu for Corendon as it stands" | "Corendon · Winter sun to Corfu: not flyable yet" |
| offer card amber | "Corendon's Winter sun to Corfu needs care" | "Corendon · Winter sun to Corfu: check before signing" |
| Crew Planning verdict | "A320 family: 4 aircraft · 5 sets each = 20 sets needed · you have 18 complete · short 2 CPT, 1 PUR, 2 CC" | "Short: 2 CPT, 1 PUR, 2 CC" |
| Crew Planning verdict (complete) | "A320 family: 4 aircraft · 5 sets each = 20 sets needed · you have 22 complete (2 spare)" | "Complete · 2 spare" |
| red crew message | "CREW SHORTAGE: TP1234 in 6 h" + "… Hurts: … Open Crew Control to fix it." | title kept; body "{why} {hurt}." (the button opens Crew Control) |
| glossary hint `offerFit` | "An offer you cannot fly as it stands" | "An offer you can't fly yet" |
| roster legend (§R) | "Dashed: home standby 06:00–18:00, on call without overtime" | foot legend "SBY home" · "SBY + station: hotel" · "ASBY airport" · "RES reserve" (`BOARD_LEGEND`; the popover below explains each) |
| Crew Control `callIn` blurb (§R) | "Someone off duty at the airport comes in: overtime pay, a morale hit." | "Standby first, no overtime. A day off costs overtime and morale." |
| Crew Control standby row (§R) | "Rita Costa · LIS · On home standby since 06:00 LIS" + "No overtime · standby beyond 6 h shortens the day" | "Rita Costa · Home standby (early) · ready in 1:30" + chip "No overtime" |
| Longest-day popover | "13 h with 2 pilots … Up to 17 h with 4 pilots …" with no word on discretion | the same plus "Captain's discretion is never part of this: it is only for surprises on the day, after the crew has reported." (§U.2; glossary `longestDay` ends "Captain's discretion is never planned.") |
| offer titles (ENGINE `flavor.clientless`) | "Winter sun to Corfu for Corendon" · "TUI's summer wet lease, Lisbon" | "Winter sun to Corfu" · "Summer wet lease, Lisbon" (the client is shown on its own) |
| job name (ENGINE `jobName`) | "Azul Brazilian Airlines' São Paulo base" | "Azul Brazilian Airlines · São Paulo base" |
| dry lease offer title (ENGINE) | "Dry lease: A321neo to Wizz Air" | "Dry lease: A321neo" |
| jumbo charter price (ENGINE `fmtPrice`) | "$1,240,000" | "$1,240,000 plus fuel at cost" |
| crew desk "Does" (ENGINE `data/heads.ts`) | "Keeps home standby filled" | "Re-plans standby and days off after disruptions" |
| amber crew message, out of hours (ENGINE §T) | "Crew short: TP1234 …" | "TP1234: crew out of hours" (a missing seat keeps "crew short") |
| achievement `standby` (ENGINE) | "5 standby call-ins" | "25 standby call-outs" |
| map aircraft panel, livery (MAP) | "In Corendon colours for Winter sun to Corfu for Corendon" | "In Corendon colours for Winter sun to Corfu" |
| map offer panel title / airport offers / event "Work it created" (MAP) | "Winter sun to Corfu for Corendon" (client also on the next line) | "Winter sun to Corfu" (client once: its own row, or "Corendon · Winter sun to Corfu" in a list) |
| map aircraft panel, no legs (MAP) | "Nothing scheduled. Idle aircraft earn nothing: check the market." | "Nothing scheduled. Check the market." |
| map airline-leg panel (MAP) | "Travelling as passengers to Lisbon (LIS) via DXB." under "Deadhead · Emirates" | "To Lisbon (LIS), via DXB." |
| map hotel list with standby (MAP §R.9) | (new) | aside "3 on standby", "SBY" tag per person, footer "6 pilots · 12 cabin crew in all" (the title already says hotel) |
| map crew alert (MAP §T.5) | "CREW SHORTAGE" for every crew alert | "CREW OUT OF HOURS" banner + "Crew out of hours · Ana Silva (28-day hours)"; chips "OUT OF HRS 05:00" / "OUT OF HOURS" |
| crew card (UI) | "Days off so far this month 18" (every unrostered day counted) and no minimum | row removed; one month line under the 14-day strip: "**May:** days off 4 of 7 minimum · standby 2 · flying 7 · leave 0" |
| crew strip, empty (UI) | "Nothing rostered in the next 14 days: only rest and days off." | "Nothing rostered in the next 14 days." (the strip shows the rest) |
| roster legend popover (UI §R) | "Dashed: home standby 06:00–18:00, on call without overtime" · "Day off" | one row per code: "SBY E / SBY L: home standby, early 05–17 or late 12–24" · "SBY DUB: hotel standby at that station" · "ASBY: airport standby, ready at once" · "RES: reserve, at least 10 h notice" · "OFF … a lock means a change costs morale" |
| day-off confirm (UI §R.5) | (new; engine text "Takes Ana's day off Tue 4 Nov; it moves to Thu 13 Nov (morale −6)" under "Take Ana Silva's day off?") | title "Take Ana Silva's day off on Tue 4 Nov?", body "It moves to Thu 13 Nov. Morale −6." |
| Crew Planning intro (UI) | "Each aircraft needs about 5 full crews (crew sets) to fly every day with days off, leave and sickness. …" | `SETS_WHY` ("5 sets per aircraft: each person has 8–10 days off a month in 2–3-day blocks and 4 weeks' leave; every other day is flying or standby.") + the limiting-role line |
| Crew Control, a fix not available (UI) | the reason in the row head and again in the open row ("Seats are empty: … flight..") | once, in the row head |
| Crew Control standby candidate (UI §R.4) | "Rita Costa" + chip "Standby since 06:00" | "Rita Costa" + chips "Home standby (early)" · "No overtime", then "ready in 1:30" |
| Settings (UI §S.5, §T.4) | "Sound effects · Synthesised UI sounds" · "Pause for crew shortages · A flight in the next 48 h has no legal crew" | a Sound section (master, volume, Alerts, Chimes, Flight chimes, UI clicks, Ambience, Test sounds) · "Pause for crew shortages · A seat in the next 12 h has nobody to fill it" + "Pause for crew out of hours · A pilot or cabin crew member has reached a legal limit" |
| analyst block (UI §5.5) | (new) | "Analyst · Inès Dubois 78" + the verdict line; "Use $1.24M" only with a counter verdict |
| heads backfill message (ENGINE `heads.ts`) | "A department head is available: Watch desk" + "You earned it before v0.9: Watch desk. Choose a candidate on Company › Team." | body "Earned before v0.9. Choose a candidate on Company › Team." (several: the list in the body only) |
| watch desk unlock card (`data/heads.ts` never[0]) | "Never: act on anything: it only alerts and pauses." | "Never: take any action (it only alerts and pauses)." |
| Team rules pane, analyst (UI) | "No settings: it works to the fleet's own plan." | "No settings: it scores every open offer and suggests a counter." |
| Team rules, Standby first (UI) | "Call standby crew before delaying" | "Sick calls: calls in standby or free crew, never from a day off. Off: sick calls come to you" |
| Crew Control sub-charter message (ENGINE `control.ts`) | "TP1234 crewed: Sub-charter" | "TP1234 sub-chartered: Sub-charter" |
| OfferModal aircraft row, a type that can't fly the route (UI) | "Runways fine (shortest 9,999 m)" · "No ETOPS needed" under the range / runway no | hidden (the no says it) |
| jumbo load (glossary, chip tip, What's new) | "only a 777-300ER or a 747-400 takes it in one go" · "All economy, 420 seats or more: a 777-300ER or 747-400 job" · "747-400s get jumbo loads (420+ seats) with fuel at cost, so a well-chosen Hajj or troop job pays" | "only a 777-300ER, a 747-400 or an A380 takes it in one go" · "420 seats or more in any cabin: a 777-300ER, 747-400 or A380 job" · "Jumbo loads (420+ seats) for the 747-400 and other 450-seat jets, and charters with fuel billed at cost, so a well-chosen Hajj, troop or UN job pays" |
| glossary `fuelAtCost` | "Common on government and Hajj charters." (a Hajj airlift is wet: the fuel is the client's anyway) | "Common on government and military charters." |
| offer dialog, crew change (UI + `offerRestLine`) | said up to five times: chip, "15:30 is too long for one crew · crew change at IST", the row head, the open check and "Fuel stops: IST (crew change)" | chip + "Longest day 15:30 · crew change at IST" + the check row (the row head hides it while the row is open); "Fuel stops: IST" |
| feasibility rest line, two slips / a slip beside a 4-pilot day (ENGINE `restNeed`) | "Crew change at PNH (fresh crew flies in)" (the second stop and the other day's warning lost) | "Crew change at PNH and OTP (fresh crews fly in)"; detail ends "Another day: Business seats (class 2) → needs a 4th pilot …" |
| slip detail and chip on a wet lease (ENGINE `slipDetail`, UI `v09Chips`) | "Tickets and hotel about $21K, priced in." | "The client pays the tickets and hotel (about $21K)." |
| feasibility crew line on a slip job (ENGINE `crewAvailability` `extraSets`) | "Needs 2 crew sets, 6 free" (the second crew in the air not counted) | "Needs 3 crew sets, 6 free" |
| repeat business (ENGINE `missions.ts`) | "Repeat business from TUI" + "TUI liked Summer programme Hamburg–Palma and asks again: Summer programme Hamburg–Palma (May), from 3 May." | title kept; body "They liked Summer programme Hamburg–Palma and ask for it again from 3 May." (" as {new title}" only when the title differs) |
| Hajj blurb (ENGINE `missions.ts`) | "Saudia: Hajj 1448 airlift LIS–JED/MED for about 450 pilgrims a flight. In: …" (the title and the client again) | "About 450 pilgrims a flight. In: …; home: …" |
| glossary `airportStandby` / `homeStandby` | "after 4 h the next day gets shorter" · "called after 6 h, the day gets shorter" | "called after 4 h, the day that follows is cut by the standby beyond 4 h" · "called after 6 h, the day is cut by the standby beyond 6 h" |
| days-off rule, one phrase (glossary `daysOff`, What's new, `SETS_WHY`) | "We plan 8–10, in blocks of 2–3 days that are also the weekly 36 h recovery rest" · "8–10 a month in 2–3-day blocks, 4 weeks' leave a year" · "8–10 days off a month and 4 weeks' leave" | "8–10 days off a month in 2–3-day blocks (one block a week is the 36 h rest) and 4 weeks' leave" (`SETS_WHY` without the bracket) |
| What's new v0.9 | no word on the catch-up | "What's new catches up: the first start after an update also shows the notes of the versions you skipped, once." |

---

## W. Crew slip at a fuel stop (ENGINE crew + contracts; UI; MAP)

### W.1 Rule
On a one-way sector with tech stops whose chain no single crew can fly (`dutyNeed(...).mode === 'none'`, even with 3–4 pilots and this aircraft's rest), the duty may split at a tech stop:
- a fresh crew flies to the stop by airline (deadhead), rests in a hotel (minimum rest before report, `minRest` away from base) and takes over;
- the first crew rests at the stop and flies home by airline (or continues as passengers when that is cheaper).

Examples: Madrid→Singapore on an A330 via IST (MAD–IST 4:10 / IST–SIN 10:40, change at IST); Dili→Lisbon on an A320 via PNH and OTP (change at OTP).

```ts
// crew/slip.ts (pure)
export interface SlipPlan { at: string; cutIndex: number; first: DutyNeed; second: DutyNeed; crewN: number; tickets: number /* $ */; hotelNights: number; text: string }
export function bestSlip(g: GameState, typeId: string, rest: AcRest, chain: ChainShape): SlipPlan | null;
```
- `bestSlip` tries each tech stop as the cut and keeps the cut where both halves are flyable. Round 4: the second half is judged on the stricter of the stop's and the home clock (`dutyNeed(…, { stricter: true })` → `planAugment`), as the roster judges a crew less than 48 h away (FTL state B); `crewN` is `complement()` of the second half (its pilots, the purser, cabin crew, the policy extra cabin crew and the rest plan's), the hotel at the policy tier (`SlipPlan.hotelNight`), so the chip's cost and the booked costs agree. It ranks cuts by the fewest pilots needed (basic > ext > aug1 > aug2), then the most FDP margin, then the cheapest tickets (`ticketPrice` from the nearest deadhead origin: home base, or the deployment base). At most **one slip per sector**: if no single cut works → `null` (the chain stays impossible).
- **Roster**: `duties.ts slipUnits` uses `bestSlip`'s cut instead of cutting at every sector boundary, so planning and pricing agree. The deadheads and hotel come from the existing deadhead/rest code. The new duty records the stop (`Duty.slipAt?: string`).
- **Feasibility** (`restNeed`): a chain with mode `none` and a `SlipPlan` gives a line at level `warn`: "**Crew change at IST (fresh crew flies in)**", detail "A second crew flies to Istanbul by airline the day before and rests; it takes over IST–SIN. The first crew rests in Istanbul and flies home. Tickets and hotel about $21K, priced in." Round 4: every slipping stop is named ("Crew change at PNH and OTP (fresh crews fly in)"), the worst non-slipping chain keeps its own 4-pilot / extra-cabin warning in the detail ("Another day: …"), and on a wet lease the detail and the chip end "The client pays the tickets and hotel (about $21K)."
- **Pricing** (`offers.ts` draft costs): each slip adds `2 × crewN` one-way tickets (`tickets`), `crewN × 1` room nights (2 when the slip crew must wait for a second rest), and per diem for the extra crew-days by role (`SlipPlan.perDiem`); round 4 fix: when the first crew's half plus the ticket home would run past 13 h (`planHome` books them a hotel), their room nights and per diem are in the estimate too, so the chip and the booked costs agree. Charter prices include it; on wet contracts the client pays the tickets and hotels, as today.
- **Offer generation**: `crewCanFly` accepts a chain with a `SlipPlan`, so the v0.8 "no impossible offers" rule counts a slip as a valid plan. `ContractOffer.slip?: { at: string[]; cost: number }` drives the card chip "Crew change at IST".
- **Crew planning**: sets needed for the contract +1 per slipping sector in flight at the same time (`crewAvailability` gets `extraSets`; round 4: `restNeed` counts the most slipping chains overlapping in time and `feasibility` passes it, so the crew line reads "Needs 3 crew sets" on a one-way slip job that sized at 2). The 60-day Planning view (`sets.ts`) is unchanged: it counts contracts of 30 days or more, and one slip would not justify a sixth set.
- `Stats.v09.slips` counts slip duties flown. The achievement `slipCrew` goes to the first one.

### W.2 Glossary (`slipCrew`)
"**Crew change at a fuel stop (slip crew).** When a flight is too long for one crew even with rest on board, a second crew flies to the fuel stop as passengers, sleeps in a hotel and takes over. The first crew rests there and goes home by airline. It costs tickets and a hotel, and it makes the flight legal."

### W.3 UI
- Offer card chip "Crew change at IST".
- OfferModal: the feasibility line above (with `<Term id="slipCrew">`). The schedule list marks the stop with "crew change".
- DutyModal / BlockSheet: the duty header shows "Takes over at IST from …" / "Hands over at IST to …"; deadhead rows as today.
- Roster board: unchanged (the two duties already show; the second starts with its deadhead).

### W.4 MAP
- With the aircraft selected, its slip crews' deadheads are drawn in the existing deadhead style but at selected weight, plus a small static **crew-change mark** (two arrows, 44 px hit area) at the stop on the route. Tap → panel "Crew change at Istanbul · fresh crew from Madrid on TK1858 (lands 18:40, rests 13 h) · the first crew flies home on TK1859".
- Reads `slipsOfAircraft(g, aircraftId, from, to)`.

---

## X. What's new catch-up (ENGINE data; UI)
- `data/whatsNew.ts`: new top entry **v0.9 "Experience"** (§9). New pure function:
```ts
/** v0.9 catch-up: on the first v0.9 launch every entry newer than v0.7.3 (v0.9, v0.8, v0.7.4), newest first, even if v0.8 was seen; afterwards unseenEntries. A fresh install ('' seen) gets CURRENT only. */
export function whatsNewToShow(seen: string, catchUpDone: boolean): WhatsNewEntry[];
```
  It returns `CURRENT` alone for `seen === ''`. When `!catchUpDone`, it returns the entries newer than `min(seen, 'v0.7.3')`, so a v0.7.2 player sees everything since. Otherwise it returns `unseenEntries(seen)`.
- UI `Settings.whatsNewCatchUp: string` (default `''`, `load` merge). `Title.tsx` opens the pop-up when `whatsNewToShow(...)` is non-empty. On close, `seenWhatsNew = CURRENT.version` and `whatsNewCatchUp = 'v0.9'`. `WhatsNewModal` renders the list it is given (it already does several versions).

---

## Y. Follow-ups from the v0.8 release

### Y.1 Rest plan re-checked at departure (ENGINE `ops/flights.ts`, `crew/roster.ts`)
- Today `restDelayHook` stops at report (`d.report <= g.now → false`). New: in the departure state machine, before `depart`, for the first leg of an augmented duty (or any leg that starts an in-flight rest), re-run `restPlanForFlight` with the actual off-block time.
- If it is not OK, the fixes run in this order:
  1. **re-plan the turns** (`planRest` with the current times and any extra cabin crew on board);
  2. if the cabin crew's FDP overrun is the only problem and `discretionCheck` is ok → discretion applies (unforeseen, after report) with the usual note; round 4 fix: the whole allowance is stored (one increase, ORO.FTL.205(f)(1)(i): 2 h, 3 h augmented, capped by the cabin rest class), so a second hold inside it is still covered; a refusal names the rest class when that is the cap;
  3. else the flight is **held** and becomes **crew out of hours** with limit `inflightRest`: red at once, alarm, pause `crewHours`, and a Crew Control gate decision (fresh crew / delay to the next legal plan / sub-charter / cancel).
- Round 4 fix (the gate clock): an FDP overrun at the gate grows with every minute on the ground, so `crewProblem` posts the decision at once (no `crewWaitMin` wait) and the decision's overrun, the discretion chip and the applied discretion read the day as it stands now (`liveDay`: from the crew's effective report to the last on-blocks if it left this minute), never the FDP written at an earlier attempt. A whole fresh crew taking the seats at the gate reports at their own check-in for the held departure (`freshReport`, slot `from`), with the Table 2 limit at that report: `fdpOver`, Crew Control's "fresh crew" rows (`fullWhy`, `heldOoh`) and the timeline all judge that day, not the hours the first crew waited; a replacement placed inside a running standby window is a call-out now.
- No departure with an impossible rest plan: the bot target stays "0 duties flown with an impossible rest plan".
- Test: an augmented 777 duty where a 2:30 delay after report makes the cabin crew rest impossible → re-plan fails → out-of-hours alert, flight held, never departs illegally.

### Y.2 747-400 economics (ENGINE `missions.ts`, `offers.ts`, `pricing.ts`)
- Today the bot loses about 20 % on general work with a 747. The cause: offers are priced on the cheapest reference type that fits (a 767/A330 rate of $6.4–7.2K a block hour) while the 747 costs $3K maintenance a block hour, $90K insurance a month and 13 cabin crew.
- **Jumbo loads.** Hajj, troop and UN rotations, evacuation, repatriation and full charters (sports fans, pilgrimages) generate 420–480 passengers (`minSeats`, any cabin with the seats) in 20 % of their widebody offers. That rises to 35 % when our fleet has a 747 idle in the window (gap-fit), and to 0 % when neither we nor a rival operates a 400-seat type. With `minSeats ≥ 420`, `referenceType` resolves to a 400-seat type (777-300ER or 747-400; an A380 counts as a jumbo type too), so the rate is about $10–11K a block hour.
- **Fuel at cost** on jumbo charters: `Product.fuelAtCost?: true` bills fuel after flying at the actual burn of the aircraft that flew (government and military charters work this way; a Hajj airlift is a wet lease, so its fuel is the client's anyway and the offer never carries the term). The price shows "plus fuel at cost". Ledger: `otherRevenue` "Fuel re-billed".
- No change to the 747's costs or to general offers: on 300-seat work it stays a poor choice.
- Targets (tests and bot):
  - a 747-400 on a 450-pax Hajj offer estimates ≥ +15 % margin;
  - the same aircraft on a 300-seat A330-referenced season base ≤ +3 %;
  - a bot with a 747 picks jumbo loads for it and ends the year with the 747's contribution ≥ 0;
  - the share of jumbo-load offers stays ≤ 12 % of widebody offers.
- Chip "Jumbo load" (the seats chip beside it carries the count; round 4.2: the count was said twice). Achievement `queen`.

### Y.3 Bot runtime
Today: seed 1 runs in 28.9 s (target 12 s). Profile with `node --cpu-prof` through `tsx` and fix only the cheap hot spots, for example:
- `feasibility` per open offer × aircraft at each 6 h step (cache per offer per day: `quick` first, full only for the best two);
- `idleWindows` (memoise per day and fleet revision);
- `crewChains` / `dutyNeed` repeated per offer (memoise by chain key).

Report before and after per seed. The hard limit is ≤ 20 s with the v0.9 systems.

---

## R. Roster planning like a real EASA operator (ENGINE crew; UI roster board, Crew, Crew Planning; MAP hotel panel)

### R.1 Why, and the rules it follows
Today `dailyStandby` puts 1 CPT, 1 FO, 1 PUR and 1 CC per rating family on home standby for the next 2 days, and every day without work shows as **Day off**. Crews sit at home most of the month, and the 7-days-a-month rule is not checked at all (only standby keeps 8 free). A real crew-planning department plans the minimum days off first, publishes them 14 days ahead, and puts everyone else who is not flying on standby or reserve. Sources: the player's guide (`.handover/updates/EASA-guide-2026-10.txt` §§3, 10, 11.3–11.4, 12.3), written up with citations in **EASA-FTL.md §16 "Roster planning"** (written with this design):

| Rule | Value | Source |
|---|---|---|
| Roster published | 14 days ahead | AMC1 ORO.FTL.110(a) |
| Cumulative duty | 60 h / 7 d, 110 h / 14 d, 190 h / 28 d | ORO.FTL.210(a) |
| Flight time | 100 h / 28 d, 900 h / calendar year, 1,000 h / 12 months | ORO.FTL.210(b) |
| Airport standby | 100 % duty; FDP cut by standby beyond 4 h; standby + FDP ≤ 16 h; rest after if not called | ORO.FTL.225, CS FTL.1.225(a) |
| Other standby (home, hotel) | ≤ 16 h; 25 % duty; FDP cut beyond 6 h (8 h augmented/split); for standby starting 23:00–07:00 that period is not counted until contacted (round 4 fix: a window from midday called late at night counts in full); standby + FDP ≤ 18 h awake; rest after | CS FTL.1.225(b) |
| Reserve | rostered; not duty for ORO.FTL.210/235; ≥ 10 h notice; 8 h no-contact period; never rest, never recovery | ORO.FTL.230, CS FTL.1.230, GM1 ORO.FTL.230(a) |
| Recurrent extended recovery rest | ≥ 36 h incl. 2 local nights, ≤ 168 h apart; 2 local days twice a month | ORO.FTL.235(d) |
| Days free of duty | ≥ 7 per calendar month, ≥ 96 per year, free of all duty **and standby**, notified in advance; a single day off = 1 day + 2 local nights | Directive 2000/79/EC Annex cl. 9; guide def. (23) |
| Annual leave | 4 weeks paid | Directive 2000/79/EC Annex cl. 3 |
| Standby at bases and hubs | standby/reserve crew should be available there, so discretion is avoided | AMC1 ORO.FTL.205(f) |

**Game definition of a day off:** a local calendar day at the place the crew member is, free of all duty, standby and reserve from 00:00 to 06:00 the next morning (which keeps both local nights free). Days are counted in the home base's time zone, as `twoDayCredits` already does.

### R.2 Data (ENGINE; types in `core/types.ts`, load defaults in `crew/index.ts load`)
```ts
export type StandbyKind = 'home' | 'hotel' | 'airport' | 'reserve';
// CrewMember.standby[] entries (v0.9, all optional; absent = v0.7.3 home standby at base):
//   kind?: StandbyKind; at?: string /* station, absent = base */; shift?: 'E' | 'L'
// CrewMember (v0.9):
//   off?: number[];                      // base-local day indices rostered OFF, ascending; pruned 40 days back
//   offMonths?: Record<MonthKey, number>; // days off counted at each month end (last 13: the 96-a-year check)
//   leaveYear?: number;                   // last calendar year whose annual leave is planned
// CrewMember.blocks[] entries: annual?: true   // planned annual leave (why 'leave')
// GameState (v0.9): dayPlan?: { from: Minute; publishedTo: Minute }
//   from: the first base-local midnight the v0.9 rules plan; publishedTo: end of the last published day
// MoraleDriver += 'standby' | 'daysOff';  OohLimit += 'daysOff';  IssueCode (crew/rules.ts) += 'daysOff'
// Stats.v09.roster?: { offDays; sbyHome; sbyHotel; asby; res; leaveDays; callOuts; offBroken; offBreaches; maxRecGapH }
```
**Old saves (load).** `g.dayPlan ??= { from: firstBaseMidnight(now + 14 d), publishedTo: that same minute }`. Already published days (before `from`) stay as they are: their free days still show as days off and the old 2-day home standby keeps running for them only. From `from` on, the v0.9 planner plans each day as it enters the published window. Annual leave for the rest of the year is planned at load (pro rata, never inside the published window). One info message: "**Roster planning changed** — From 7 Nov, days off are planned (8–10 a month, a 2-day block every week, 4 weeks' leave a year) and other free days are standby. The roster published up to 6 Nov stays as it is." New games: `from` = the start day; the first 14 days are planned at start.

### R.3 The daily plan (`crew/dayPlan.ts`, new; runs in `crew/index.ts daily`)
Order each day: `planLeave` (1 Dec for next year, on load, and for each hire after 90 days' service) → **`planOffDays`** for the day D entering the published window (today + 13) → `autoRoster` (unchanged; now sees OFF days as blocked) → **`planStandby`** for every unpublished day up to D → `publishedTo` moves to the end of D. All picks are deterministic (crew id order, `hashUnit` for ties); no RNG.

**1. Annual leave (`planLeave`).** 28 calendar days a year in 4 blocks, weighted to the ACMI low season: Q1 10 days, Q2 4, Q3 4, Q4 10 (RESEARCH §5.3 counts leave at about 8 % of crew; RESEARCH §9 notes ACMI winters are quiet). For each block, the start day is the one in the quarter (after the published window) with the fewest same family-and-role crew already on leave and the fewest signed reports of that family, ties by `hashUnit(crewId + year + q)`. Cap: at most `max(1, ceil(10 %))` of a family-and-role group on leave on any day. Leave is a `blocks` entry `{ why: 'leave', annual: true }`, so availability, status and the calendar already handle it. A partial first year gets only the quarters left. Leave never moves by itself.

**2. Days off (`planOffDays`, day D, each crew member).** Days off come in **blocks of 2 or 3 whole days**, so each block is also the 36 h / 2-night recovery rest, and two blocks a month give the 2 local days twice a month. Work days are days with any duty, travel, standby, reserve or training. Leave and sickness reset the count.
- **Must:** OFF from D when one of these holds:
  - D is the 7th work day in a row (the company 6-on block, which also keeps the 168 h recovery);
  - the month cannot otherwise reach 8 (`minMonth`): the days off still missing are at least the free days left in the month;
  - fewer than 2 blocks of 2 days this month, and only enough days left for them.
- **Due:** OFF from D after 5 work days in a row, or when the month's days off are behind the pace for 9 (`targetMonth`). A due block is deferred one day when it would leave that family-and-role at that station below D's known reports + 1 standby. It is never deferred twice.
- **Length:** 2 days, or 3 when the month is behind the pace for 9; never more than 10 a month (`maxMonth`) unless nothing else is possible (a joiner, a long stay of sickness).
- Only days with no duty or ticket already planned can become OFF (deployment tours are crewed up to `rotationWeeks` ahead). A must-block that finds D taken goes on the first 2 free days after it. `tours` themselves are built so a month keeps ≥ 7 free days (`duties.ts`, next to the `longestWorkBlock` check).
- Days off at a deployment or downroute are taken at the hotel (`OFF DUB`); the v0.6 `offAway` morale applies as today.
- **Result:** about 4 blocks and 9 days off a month (≈ 108 a year, above 96), never below 7.

**3. Flying.** `autoRoster` / `fillAll` as today. `evalSegs` gets the OFF days through `TimelineCtx.off`. A fresh duty, ticket or standby on a planned OFF day is the issue `'daysOff'`:
- **illegal** when the month would fall below 7 days off ("Days off in November would fall to 6 (minimum 7)") or the year's count can no longer reach 96;
- **tight** otherwise ("Day off Tue 4 Nov (published)").

`acceptable()` refuses any `'daysOff'` issue, so the auto-roster, re-plans, the auto-fix and department heads never take a day off. Only the player does (R.5).

**4. Standby (`planStandby`).** Every crew member who is free on D (not OFF, leave, sick, training or joining) and has no duty or ticket covering the day gets one standby window. Where they are at 06:00 local decides the kind:

| Kind | Where and when | Window | Counts as duty | Called out |
|---|---|---|---|---|
| **Home standby** `home` (SBY) | at home base | early **05:00–17:00** (`E`) or late **12:00–24:00** (`L`), 12 h (≤ 16 h rule) | 25 % | report 90 min after the call; FDP cut beyond 6 h (8 h augmented/split); 18 h awake (woken 1 h before the window) |
| **Hotel standby** `hotel` (SBY DUB) | at a deployment station or a night-stop/waiting station away from base | 06:00–18:00 station local, after the rest from the last duty | 25 % | report 45 min after the call; same cuts |
| **Airport standby** `airport` (ASBY) | at home base or a deployment station with ≥ 2 of our departures 05:00–12:00 local that day, counted station-wide over every family (round 4; round 3 asked ≥ 3 of one family 05:00–10:00 and never occurred in a year) | first departure − 90 min, 4 h (the cabin seat from the station's first, a pilot's from their family's first) | 100 % | at once (20 min); FDP cut beyond 4 h; standby + FDP ≤ 16 h |
| **Reserve** `reserve` (RES) | home base, when a standby would make the 7/14/28-day duty tight (≥ 95 %) or break a rest | 24 h, no contact 22:00–06:00 | 0 % | only for a report ≥ 10 h after the call; FDP from report |

- **Early or late:** split by D's reports of that family at that station (05:00–11:59 vs 12:00–23:59), filling the shift with the lower share of crew per report. A crew member keeps the same shift through a work block (GM CS FTL.1.205(a)(2): blocks of identical duties) unless the late→early rule would bite.
- **Airport standby:** 1 CPT and 1 FO per family with a departure in the wave, 1 cabin crew per station (a purser counts as the cabin seat, round 3), taken from the early shift (round 4).
- **Window clipping:** the window starts after the rest from the previous duty, and it ends early enough for the full ORO.FTL.235 rest before the next planned report (`minRest` of the standby length: 12 h at home, ≥ 10 h away). A window clipped below 4 h is not rostered; that day is rest.
- **Legality:** each window is checked with `evalSegs`, with its share (home/hotel 0.25, airport 1, reserve 0). An illegal standby becomes reserve; an illegal reserve is not rostered, and the day shows "Rest (limits)".
- **Out-of-base standby costs nothing new:** hotel and per diem accrue as already modelled for detachments and night-stops.
- **Changes:** planned work replaces standby (`dropStandby`, unchanged). A window running or starting within 12 h counts as a call-out (`callIfOnStandby`, unchanged). A standby not called is followed by rest (`standbySeg.rest`); unused reserve is neither rest nor recovery.

**5. Publication.** `publishedTo` = end of today + 13. Days off inside it are protected (R.5). Standby, reserve and airport standby windows may change at any time; that is their purpose. Days beyond it show "Not rostered yet", except the second and third day of an OFF block planned at D.

### R.4 Crew Control and the auto-fix use the pool first
`dutyCandidates` (`rosterActions.ts`) marks candidates with `standby: { from; kind; at; readyMin }`, and `seatCandidates` (`control.ts`) sorts the call-in list:
1. airport standby at the departure (20 min);
2. hotel or home standby at the departure (45/90 min);
3. reserve at the departure (only for reports ≥ 10 h away);
4. off duty on a rest day (overtime and `callInMorale`, as today);
5. last, someone on a published day off, through R.5 (confirm, overtime, −6 morale instead of `callInMorale`).

"Fly someone in" lists standby crew elsewhere first: their window closes at the ticket's check-in and counts as a call-out. The roster's own re-plans after disruptions (`rerosterFrom`, the auto-fix) already prefer free crew, who are now standby crew. Since standby costs no overtime, the cheapest-first fix order makes standby call-outs the normal fix. The heads' Ops Control and crew desk inherit this (they apply these fixes).

**Candidate labels** (engine strings, Crew Control rows):
- "Rita Costa · LIS · Airport standby until 10:30 · ready in 20 min"
- "· Home standby (early) · ready in 1:30"
- "· Hotel standby at DUB · ready in 45 min"
- "· Reserve · from 19:10 (10 h notice)"
- "· Day off: called in · $310 overtime, morale −6"

Chips: "No overtime" + the kind.

### R.5 Protected days off
- **Board move.** A board move, swap or Crew Control call that puts work on a published OFF day needs a confirm. `dropTargets` gives the target `offBreak: "Takes her day off Tue 4 Nov (morale −6)"`, level amber. `moveDuty(…, { takeOff: true })` applies it; without `takeOff` it refuses with that text.
- **On confirm:**
  - morale −6 (`daysOff` driver);
  - `Stats.v09.roster.offBroken` +1;
  - the planner moves the day off to the first free unpublished day in the same month (to the next month when none is left);
  - a toast: "Ana Silva works Tue 4 Nov; her day off moves to Thu 13 Nov."
- **Illegal break.** A break that leaves the month below 7 is illegal (red), as other red moves.
- **Unpublished OFF days** (beyond `publishedTo`) move freely, with no morale cost.
- **Swap by agreement (round 3, R.15.2).** The roster itself never breaks a published day off, but for short-notice work nobody else can take it may ask a crew member to swap one: the day moves inside its month (the count is kept), morale −3, `Stats.v09.roster.offSwaps` +1. Not a break: no −6, not counted in `offBroken`.

### R.6 Morale and pay (`crew/morale.ts`, `BAL.v09.roster.morale`)
- **Pay.** Salaries are monthly and the game has no duty pay, so standby is paid by the salary. Overtime only for call-ins on a day off. Per diem and hotels as already modelled.
- **`standby` driver:** −0.2 a day from the 4th standby day in a row without a call-out (bored at home or in a hotel), shown as "Long standby runs".
- **`daysOff` driver** at month end:
  - +0.5 per day off above 9 (cap +1.5);
  - −1.5 per day below 8;
  - the −6 shock for a broken day off.
- Sized against the existing drivers (`offAway` −0.5 a day, call-in −4) so that a normal month nets about zero.

### R.7 Crew planning (`crew/sets.ts`)
- **5 sets per aircraft stays** (RESEARCH §5.3: 5–6 sets for a year-round narrowbody; the 1.20 factor covers leave ≈ 8 %, sickness and standby).
- **The arithmetic:** a crew member has ≈ 30.4 − 9 off − 2.3 leave − ≈ 1 sick/training ≈ 18 work days a month. Five sets give ≈ 90 crew-days per seat per aircraft against 30–45 flying days, so the rest is standby. That is the "mostly standby" pattern the player asked for.
- **`staffing()` / `familyNeeds`** already count crew on leave as `away` (still on the books), so no formula changes.
- **Planning view one-liner** (new export `SETS_WHY`): "5 sets per aircraft: each person has 8–10 days off a month in 2–3-day blocks and 4 weeks' leave; every other day is flying or standby."

### R.8 UI (roster board, Crew screen, Crew Planning, Crew Control)
**Board codes and colours** (`rosterBoardLogic.ts`, `RosterBoard.tsx`, styles). Calm, static, colour plus text (never colour alone):

| Code | Meaning | Style |
|---|---|---|
| `OFF` / `OFF DUB` | planned day off (at the hotel when away) | soft sage fill, solid |
| `SBY E` / `SBY L` | home standby, early/late | blue dashed outline |
| `SBY DUB` | hotel standby at a station | amber dashed outline, station code |
| `ASBY` | airport standby | light blue fill |
| `RES` | reserve | grey dotted outline |
| `LEAVE` | annual leave | lavender fill |
| (empty, faint) | not rostered yet (beyond the published roster) | none |

A called-out window keeps its code up to the call, then the duty. The **published line**: a 1 px vertical rule at `publishedTo`, with "Published to 6 Nov" in the date header. Protected OFF cells carry a small lock glyph (decorative, static).
- **Legend** (replaces the "Dashed: home standby 06:00–18:00" row): six swatches with "OFF day off · SBY home · SBY + station: hotel · ASBY airport · RES reserve · LEAVE" (`BOARD_LEGEND`; the popover explains the early/late windows).
- **Month zoom:** each row gets an 88 px summary column at the right, "9 · S11 · F8" (days off · standby · flying), red when days off < 7. Tap → a popover with `crewMonth().line`.
- **Drop confirm:** a drop on an `offBreak` target opens the existing confirm: "Take Ana Silva's day off on Tue 4 Nov? It moves to Thu 13 Nov. Morale −6." → **Take the day** / **Cancel**.
- **Crew screen** (`Crew.tsx`, `crewLogic.ts`):
  - the "Next 14 days" strip uses the same codes and colours (`CalKey` += `asby` | `res` | `sbyHotel`; `standby` = home);
  - under it, one line from `crewMonth`: "**November:** days off 9 of 7 minimum · standby 11 · flying 8 · leave 0";
  - tap an OFF block: "Day off (published): protected. Changing it costs morale.".
- **Crew Planning** (`CrewPlan.tsx`): the `SETS_WHY` line under the page title, once.
- **Crew Control:** rows and chips from the engine labels (R.4). No layout change.
- **First-time hint `crewBoard`** (§14.2) becomes: "Roster board: OFF days are published 14 days ahead and protected; SBY, ASBY and RES are your standby pool. Drag to swap; red is illegal."

### R.9 MAP
The station panel's "Crew in hotel" list (`MapPanels.tsx`) tags people on hotel standby now with a small "SBY" pill (`standbyNow`). The section aside reads "6 at the hotel · 3 on standby". There is no new map glyph and nothing moves.

### R.10 Glossary, inbox, What's new (ENGINE data)
**Glossary.**
- `standby` (rewritten): "On call for the day: at home, at the hotel away from base, or at the airport. Called out, the crew report within the response time. Home and hotel standby count 25 % towards the duty limits, airport standby in full."
- `airportStandby`: "Standby at the airport, ready at once. It counts in full as duty; called after 4 h, the day that follows is cut by the standby beyond 4 h; standby plus flying stays within 16 h." (round 4 wording; `homeStandby` likewise "called after 6 h, the day is cut by the standby beyond 6 h")
- `reserve`: "Rostered availability with at least 10 h notice. It is not duty and not rest, so it never counts as a day off."
- `daysOff`: "At least 7 days a month and 96 a year free of all duty and standby, published in advance (EU Directive 2000/79/EC). We plan 8–10 days off a month in 2–3-day blocks (one block a week is the 36 h rest) and 4 weeks' leave." (round 4: the one phrase What's new and `SETS_WHY` share)
- `publishedRoster`: "The next 14 days of the roster, as the crew see it. Days off in it are protected."

**Inbox.**
- The old-save message (R.2).
- 1 Dec: "**Annual leave for 2027 is planned**" — "28 days each, mostly in winter; at most 1 in 10 of a crew group away at once."

That is all: no new problem cards. A seat a protected day off leaves empty is a CREW SHORTAGE. A crew member pushed below 7 days off by a disruption is CREW OUT OF HOURS with limit `daysOff`; its §T card WHY reads "Her November days off would fall to 6 (minimum 7)."

**Achievement change.** `standby` "Saved by standby" goes from 5 to **25** call-outs (the pool is larger now). **Head text.** The crew desk's "Keeps home standby filled" becomes "Re-plans standby and days off after disruptions".

### R.11 Balance (`BAL.v09.roster`)
```ts
roster: {
  publishDays: 14,
  off: { legalMonth: 7, minMonth: 8, targetMonth: 9, maxMonth: 10, yearMin: 96, block: [2, 3] as [number, number], dueAfter: 5, mustAfter: 6, morningFree: 360 },   // round 4: 360 (was 0: a 05:00 standby the morning after a day off)
  leave: { days: 28, quarters: [10, 4, 4, 10] as number[], maxShare: 0.1, afterServiceDays: 90 },
  home: { early: [300, 1020] as [number, number], late: [720, 1440] as [number, number], maxH: 16, minH: 4, readyMin: 90 },
  hotel: { from: 360, to: 1080, readyMin: 45 },
  airport: { minWave: 2, waveFrom: 180, waveEnd: 720, leadMin: 90, hours: 4, readyMin: 20, per: { CPT: 1, FO: 1, CC: 1 } as Record<string, number> },   // round 3: minWave 6 → 3; PUR counts as CC; round 4: 2, station-wide until 12:00; round 5: from 03:00
  earlyCover: { slackMin: 15 },   // round 5: standby that reaches the station's first report (R.18.2)
  reserve: { noticeMin: 600, quiet: [1320, 360] as [number, number], tightShare: 0.95 },
  share: { home: 0.25, hotel: 0.25, airport: 1, reserve: 0 },
  morale: { runFrom: 4, runDay: -0.2, above: 9, aboveEach: 0.5, aboveMax: 1.5, below: 8, belowEach: -1.5, broken: -6 },
  swap: { morale: -3, minMorale: 50, everyDays: 14, noticeH: 12, horizonH: 72 },   // round 3 (R.15.2)
},
```
Round 3 also has one constant outside `BAL`: `OFF_SHARE = 0.3` in `crew/dayPlan.ts` (the day-off stagger, R.15.1).
`BAL.v073.standby` stays for days before `dayPlan.from`.

### R.12 Bot
- No new decisions: the planner runs inside the engine, and `crewControlPolicy` already picks the cheapest fix (standby, no overtime).
- The bot never breaks a published day off.
- **Printed line:** `roster: days off/crew-month 9.1 (min 7, <7: 0) · leave 2.3 · standby 46% of days (home 34 · hotel 8 · airport 2 · reserve 2) · call-outs 212 (64% of crew fixes) · max recovery gap 150 h · offBroken 0`. Round 3 adds `· moved N · swapped N · crew-days home/hotel/airport/reserve a/b/c/d` (R.15.8).
- **Targets** (seeds 1–6):
  - 0 crew-months below 7 days off, and ≥ 96 a year pro rata;
  - recovery gap ≤ 168 h for everyone;
  - average days off 8.5–10;
  - standby + reserve ≥ 85 % of the days that are not flying, travel, off, leave, sick or training;
  - standby call-outs ≥ 50 % of crew fixes;
  - ≤ 0.3 % uncovered (unchanged); morale band unchanged ±3 points;
  - runtime within §Y.3.

### R.13 Tests (`crew/dayPlan.test.ts`, plus `saveCompat09.test.ts`)
1. **Legal minimums:** a 120-day run with 4 A320s and a DUB wet deployment (`devRoster`). No crew member ever has < 7 days off in a calendar month, < 96 a year pro rata, or a gap > 168 h between recovery rests (36 h, 2 local nights). Each month has ≥ 2 blocks of 2 local days.
2. **Unassigned days are standby, not off:** inside the published window, every whole local day of an available crew member is duty, travel, planned OFF, standby (any kind), leave, sick, training or "Rest (limits)". Planned OFF ≤ 10 a month except joiners. No unplanned "Day off" block from `dayPlan.from` on.
3. **Out-of-base standby at detachments:** DUB tour crew have hotel standby windows `at: 'DUB'` on their non-flying, non-OFF days. A sick call at DUB → Crew Control's first call-in candidate is one of them, "ready in 45 min", with no overtime.
4. **Standby counts towards duty:** `windowsAt` 7/14/28 d with one window of each kind: home 12 h → 3 h, hotel 12 h → 3 h, airport 4 h → 4 h, reserve → 0.
5. **Call-outs respect the reductions:**
   - home called at hour 8 → max FDP −2 h (−0 with augmentation until 8 h);
   - airport at hour 5 → −1 h, and standby + FDP ≤ 16 h;
   - awake cap 18 h;
   - reserve refused for a report < 10 h away;
   - 23:00–07:00 not counted before contact (only for standby starting in that period, CS FTL.1.225(b)(5)).
6. **Rest after standby:** a window not called is followed by 12 h rest at home before the next report.
7. **Annual leave:** 28 days a year, Q1/Q4 weighted, ≤ 10 % of a family-and-role group at once, never inside the published window at planning time.
8. **Protected days off:**
   - `dropTargets` gives `offBreak` on a published OFF day;
   - `moveDuty` refuses without `takeOff`;
   - with it: morale −6 and the day off is re-planned in the month;
   - a break to 6 in a month is illegal;
   - `autoRoster` and the auto-fix never use an OFF day.
9. **Migration:** a v0.8 save keeps its published days (free days still read "Day off", the old 2-day standby) and plans from `dayPlan.from`. 60 days later rules 1–2 hold. Serialise and reload are equal.
10. **Purity** (`plumbing.test.ts`): `crewMonth`, `isOff`, `offBreak`, `standbyNow`, `publishedTo`.

**UI shots:**
- `roster-board-standby` (14-day view showing OFF, SBY E/L, SBY DUB, ASBY, RES and LEAVE, plus the published line);
- `roster-board-month-summary`;
- `roster-offbreak-confirm`;
- `crew-person-month`;
- `crew-control-standby-kinds`;
- `crewplan-sets-why`;
- `map-hotel-standby`.

### R.14 Signatures (ENGINE → UI/MAP)
```ts
// crew/dayPlan.ts
export function dayIndex(base: string, t: Minute): number;                          // base-local day
export function publishedTo(g: GameState): Minute;
export function isOff(g: GameState, crewId: string, t: Minute): boolean;
export interface OffBreak { day: Minute; protected: boolean; legal: boolean; text: string; morale: number; movesTo: Minute | null }
export function offBreak(g: GameState, crewId: string, from: Minute, to: Minute): OffBreak | null;
export interface CrewMonthView { key: MonthKey; label: string; off: number; offMin: 7; offTarget: [number, number];
  standby: { home: number; hotel: number; airport: number; reserve: number }; flying: number; leave: number; other: number; line: string }
export function crewMonth(g: GameState, crewId: string, t: Minute): CrewMonthView;
export function standbyNow(g: GameState, crewId: string): { kind: StandbyKind; at: string; to: Minute } | null;
export function planLeave(g: GameState, year: number, crewIds?: string[]): void;    // engine-internal + dev
export function planOffDays(g: GameState): void; export function planStandby(g: GameState): void;  // daily (crew/index.ts)
// crew/calendar.ts: CalBlock += sby?: StandbyKind; shift?: 'E' | 'L'; protected?: true; planned?: boolean (OFF planned vs legacy free)
//   labels: 'Day off' · 'Home standby' · 'Hotel standby' · 'Airport standby' · 'Reserve' · 'Leave' · 'Rest (limits)'; `at` = station
// crew/board.ts: DropTarget += offBreak?: string; moveDuty(g, dutyId, from, to, scope, opts: { force?: boolean; takeOff?: boolean })
// crew/rosterActions.ts: DutyCandidate.standby += kind: StandbyKind; at: string; readyMin: number
// crew/sets.ts: export const SETS_WHY: string
// dev: devRoster(g): string   // 4 A320s + a DUB wet deployment, 20 days run; returns a crew id on the DUB tour
```

### R.15 Readiness round 3: coverage, runtime, determinism
Found with the bot's new `--whyheld` census (for every crew alert, every rated crew member for the missing seat by
cause: legal, standby kind, day off, busy, rest, place, FDP, joining; plus the share of each family-and-role group
off per day and the morning-bank histogram) and `--from=<save.json>` (play on from a `--dump`).

**R.15.1 Days off staggered (`crew/dayPlan.ts planDay`).** Root cause: due blocks were capped per group, but a
deferred one became a must a day or two later, and musts are uncapped, so a group went off together a few days on
(40–60 % of a group off on its worst days; the flights held for crew sat on those days). Now the needs are sorted
musts first, then by the longest work run and the furthest behind the month's pace; a due block goes only while
its group has fewer than `OFF_SHARE` = 30 % (the 9-in-30 average) off on every day of the block (D, D+1, D+2); a
3-day block shortens to 2 when only that fits; an early block (a day before due) only when the crew due over the next
two days would not fit. Musts always go (the 7th work day, the month's minimum). Test: the group share off on any
day stays below 50 %, its 90th percentile at most 31 %.

**R.15.2 Day-off swap by agreement (`offSwappable`, `roster.ts offFallback`, `BAL.v09.roster.swap`).** Root cause:
once the 14-day window was published, short-notice work (a sick call, a tour that grew, a late re-plan) found every
free crew member of the group on a protected day, and nobody could take it. A real crew-control desk phones and
asks. The roster now picks, in order: crew who need no change; then a day off not published yet that its month can
spare (moved, no cost); last, a published day off when the crew member agrees to swap it: work reporting within
72 h, morale ≥ 50, not asked in the last 14 days, the day off not starting within 12 h, every month touched keeping
its days off on free days of its own. The swap moves the day inside its month (the count is kept), morale −3,
`Stats.v09.roster.offSwaps` +1. It is not a break (R.5: −6, the player's confirm), and the player never sees a
prompt. Bot seeds 1–6 and the widebody runs: 220–390 swaps a year for 80–180 crew (one per crew member every few
months), company morale 62–66 at the end of the year.

**R.15.3 Ticket home after a late release (`roster.ts rebookHomeForRecovery`, first in `recheckAfterRelease`).**
Root cause: a duty released late shortens the free time before the loose ticket home behind it; after 4 disruptive
duties the recovery needs 60 h, and a 70 min delay left 59 h 40 m, so the next rest no longer counted and the gap
between recovery rests reached 217–221 h (seeds 7 and 9; HEAD has it on seed 9). A loose ticket belongs to no duty,
so no re-check re-planned it. Now, for a duty released within the last 12 h, each ticket after it that would end past
the 168 h is rebooked after the recovery (the crew wait at the hotel, as `sendHome` plans one). Test in
`roster.test.ts`.

**R.15.4 Empty legs.**
- `relinkPositioning` is a no-op when the legs it would plan equal the scheduled ones (from, to, times and contract,
  as a multiset; GRU–LIS / LIS–GRU pairs included). It used to delete and recreate them, which dropped their crews,
  re-ran the roster and, each step, tripped its own safety net. Tests in `schedule.test.ts`.
- Crew Control never offers (or applies) a jet for an empty positioning leg whose crew would land after its
  departure: the schedule re-plans empty legs itself. Seed 5 ping-ponged a jet delay against the re-plan (109 red
  alarms).

**R.15.5 Client lateness (`ops/events.ts`).** A client's own retime, or its move of a trip by a day, now sets the
leg's `lateOk` to what the client asked. Before, the lateness cap read the client's own change as our delay and
dropped the legs (test in `events.test.ts`).

**R.15.6 Airport standby and reserve: thresholds.**
- Airport standby: `airport.minWave` 6 → 3 departures of a family 05:00–10:00 at the station; one captain, one first
  officer and one cabin crew (a purser counts as the cabin seat; purser and cabin crew were counted apart, which
  posted two). On bot seeds 1–6 the LIS morning bank never holds 3 departures of a family (the histogram tops out at
  2), so none is posted, which is what a real operator with two or three narrowbodies would do. The rule is
  covered by a unit test (3 departures → captain, first officer and cabin crew windows from the first departure −
  90 min, 4 h).
- Reserve stays where a standby would make the 7/14/28-day duty tight (≥ 95 %, `reserve.tightShare`). With the
  planned days off few crew get that close: 0–1 crew-days a year on seeds 1–6. Lowering either threshold just to
  make the counters move would post standby nobody needs.

**R.15.7 Determinism.** The bot's crew-control memo now lives only within one step (same revision and minute), and
its delay search runs by the clock (every other step until the last 4 h), so the policy is a pure function of the
game and a reloaded save decides alike. An acquired aircraft gets its fitted rest and `restV: 2` like a new one
(the day-200 save → reload differed). `--det` is identical at day 90 and day 200 + 2h17.

**R.15.8 Runtime and the bot.**
- Engine, each checked to give the same bot output, seed by seed: `segsOf` cached per crew member (revision, time,
  standby and log); `dutySegs` returns its cached list when nothing changed; uncalled standby segs cached per
  standby list; the roster no longer plans crew that `planCrew` would refuse at once (still resting at report, on
  leave, sick, in training or joining during the trip); `planCrew` merges two sorted timelines linearly instead of
  sorting them; no closures in the hottest paths.
- Bot: `--whyheld`, `--from`; the `roster:` line adds `moved N · swapped N · crew-days home/hotel/airport/reserve`.

**R.15.9 Result (bot, 365 days, one run at a time; before = 874de67, after = round 3).**

| Run | Margin | Uncovered | Red | Summer BH/ac | Days off | Standby crew-days home/hotel/airport/reserve | Swaps | Runtime |
|---|---|---|---|---|---|---|---|---|
| 1 | 4.0 → 0.6 % | 0.55 → 0.07 % | 19 → 7 | 166 → 166 | 8.5 → 8.4 | 8711/1514/0/1 | 233 | 36.3 → 19.1 s |
| 2 | 1.0 → 4.0 % | 0.15 → 0.31 % | 14 → 19 | 173 → 155 | 8.2 → 8.4 | 7983/2129/0/1 | 260 | 33.9 → 25.6 s |
| 3 | 1.4 → 4.1 % | 0.53 → 0.20 % | 24 → 11 | 166 → 166 | 8.3 → 8.3 | 8735/1487/0/0 | 242 | 45.0 → 21.7 s |
| 4 | 0.4 → −2.2 % | 0.64 → 0.06 % | 28 → 8 | 155 → 159 | 8.2 → 8.3 | 9803/1467/0/1 | 277 | 35.6 → 29.2 s |
| 5 | −10.1 → −5.1 % | 0.37 → 0.36 % | 28 → 12 | 171 → 165 | 8.3 → 8.4 | 11252/1729/0/0 | 280 | 36.9 → 29.0 s |
| 6 | −4.7 → 3.0 % | 0.14 → 0.00 % | 10 → 8 | 150 → 128 | 8.4 → 8.4 | 9775/1235/0/1 | 224 | 28.8 → 26.6 s |
| 1 --wide --aug | −6.4 → 0.4 % | 0.25 → 0.07 % | 122 → 11 | 162 → 156 | 8.2 → 8.4 | 9022/1355/0/8 | 222 | 73.6 → 20.7 s |
| 1 --wide --aug --b744 | −27.7 → −17.4 % | 0.89 → 0.52 % | 161 → 21 | 145 → 157 | 8.3 → 8.3 | 14128/2751/0/0 | 386 | 74.1 → 52.3 s |

Every run: 0 illegal duties, 0 discretion planned, 0 crew-months under 7 days off, recovery gap ≤ 168 h. Before, the
B744 run tripped the relink safety net and went insolvent; after, it does neither. `--det` (seed 1): two runs and
both save → reload points identical.

Still open after round 3:
- **Coverage per seed.** Seed 2 (19 red, 0.31 %), seed 5 (0.36 %) and the B744 run (21 red, 0.52 %) miss
  "≤ 0.3 % and ≤ 12 red"; on seeds 7–12 the reds are 9–38. What is left is capacity and reach (crew busy on other
  trips, joining hires, rest, at another station), and a seed's
  outcome swings with any change to the roster.
- **Runtime.** 19–29 s on seeds 1–6, 21 s and 52 s on the widebody runs: about 40 % faster, still over 20 s on
  seeds 2, 4, 5, 6 and the B744 run. The profile is flat (the daily crew plan about a third, Crew Control's delay
  and jet searches on state copies about a sixth, the rest spread thin); the next step is a per-crew timeline
  revision so a change to one crew member no longer invalidates every cached timeline.
- **Summer BH per aircraft (128–166, target 180).** Not the roster: offers in summer are lost to "aircraft busy"
  and positioning, crew shortages refuse 3–9 offers a year, and a first-year Newcomer fills its aircraft with 30–45
  day bases (MGH 160) and gaps between them. v0.8 had 164–182. The target looks unreachable for a first year with
  this offer flow; it is a commercial question for the next update.
- **Average days off 8.3–8.4** (target 8.5–10): the stagger and the swaps keep crew working; every month stays
  ≥ 7 and the year above 96.

### R.16 Round 4 (audit): the roster rules as written

**R.16.1 A day off runs to 06:00 (`morningFree` 0 → 360).** The planner was putting a 05:00 home standby the morning
after every block of days off, and a report before 06:00 did not take the day off before it (the second local night
was 22:00–05:00, 7 h: not a night). Now `offDaysHit`, `busyDays`, `clearDays` and `planStandby` all keep the morning:
the early window after a day off opens at 06:00, a 05:00 report takes the day off before, and `topUpOffs` clears the
window of the morning after like `planDay` (it only dropped the day's own). Two knock-on fixes the rule exposed:
- **Deployment tours (`duties.ts chainer`).** The crewed-tour check (`setCrewOkHook`) moved days off as a side
  effect for every set it was asked about, not only the set picked; it is pure now (0 no, 1 with a day off moved, 2
  as rostered) and the move is made by `setCrewTakeHook` once the set is picked, a set needing no change first. An
  early report (before 06:00) goes first to a crewed set that worked the day before, so the set coming off its days
  off starts on the later wave (the sizing of a deployment and its 6-on/2-off model are unchanged: counting the eve
  as a work day there made the sets refuse duties, which then flew as trips from base). Without this, a 06:00 wave
  every day pushed a set's days off along the month and the planner stacked 10 catch-up days at the end of it.
- **No block stacks behind a planned one (`offNeed`).** A must that found D taken went on the first free days after
  it, and each following day (its run still ≥ 6) added another block right behind: a planned block within the next
  10 days now answers the run and the pace.

**R.16.2 Reserve's no-contact period (`standby.ts reserveContact`).** `BAL.v09.roster.reserve.quiet` (22:00–06:00
station-local) is applied: a reserve crew member is not called in it, the call waits for 06:00 and the 10 h run from
there (`standbyFor`; Crew Control's line "Reserve · from 16:00 (10 h notice)" says so). Calendar text unchanged.

**R.16.3 Call-out cuts (`rules.ts standbyView`, `timeline.ts addStandby`).** The placement check now passes the call
time (`ctx.now`) to `standbyCut`, so the check and the placed duty agree (an early window from 05:00, called 06:00
for 13:30: 1:30 off the FDP in both; before, the check gave 0:30 and the placed duty 1:30, an out-of-hours alert the
planner caused). A hotel standby's 23:00–07:00 exclusion runs on the station's clock (`w.at`), not the base's. A duty
called from airport standby carries rest for the standby and the duty together (`asbyRest`: 4 h + 10 h → 14 h).

**R.16.4 The 96 a year (`dayPlan.ts yearView`, `yearOffs`).** `yearMin` is read: `monthFloorIssue` refuses work that
would leave the calendar year unable to reach 96 free days pro rata (closed months from `offMonths`, planned days off,
leave and sickness, and the free days the planner has not reached yet; cheap bound first, the day-by-day count only
near the year's end) with "Days off in 2027 would fall to 93 (minimum 96)". Pro rata runs from the first month
`dayPlanMonth` records (wholly after the hire and the first planned day). The December close counts
`Stats.v09.roster.years` / `yearsLow`; `crewMonth().line` reads "… · 84 of 96 this year · …" (`year`, `yearMin`). The bot
prints `years <96: a of b` and targets 0.

Not applied: pro-rating the 7-day floor by training days (the player's call: days off are not pro-rated by training).

**R.16.5 Results (bot, 365 days, `--whyheld`; before = the round 3 table, after = this round).** Every run: 0 illegal
duties, 0 planned discretion, recovery gap ≤ 168 h, no standby window before 06:00 after a day off (test).

| Seed | uncovered | red | days off/crew-month | crew-months < 7 | crew-years < 96 pro rata | runtime |
|---|---|---|---|---|---|---|
| 1 | 0.20 → 0.36 % | 7 → 23 | 8.4 → 8.1 | 0 → 14 of 822 | 4 of 98 | 19 → 37 s |
| 2 | 0.31 → 0.37 % | 19 → 18 | 8.4 → 8.2 | 0 → 6 of 850 | 0 of 95 | 26 → 38 s |
| 3 | 0.20 → 0.30 % | 11 → 16 | 8.3 → 8.1 | 0 → 6 of 892 | 1 of 92 | 22 → 29 s |
| 4 | 0.06 → 0.40 % | 8 → 25 | 8.3 → 8.1 | 0 → 5 of 659 | 0 of 60 | 29 → 32 s |
| 5 | 0.36 → 0.46 % | 12 → 15 | 8.4 → 8.2 | 0 → 0 of 748 | 0 of 72 | 29 → 24 s |
| 6 | 0.00 → 0.17 % | 8 → 18 | 8.4 → 8.2 | 0 → 4 of 801 | 0 of 92 | 27 → 29 s |
| 1 --wide --aug --b744 | 0.52 → 3.82 % | 21 → 66 | 8.3 → 8.2 | 0 → 2 of 904 | 2 of 148 | 52 → 172 s |

The two tables are not the same games: any roster change moves the RNG draws, so each seed signs other contracts
(seed 6 flies 1,710 legs against 1,797; the B744 run signs its 747 on day 160 for a GRU base instead of day 103 for
MLA, runs out of cash and cancels 145 legs). On a fixed schedule the roster is as good as before: a deterministic
probe (`devRoster` seeds 11–13 played 30 days with the engine's own crew control) gives the same held departures and
red alerts before and after (1/2/2, 0/0/0, 0/2/2), fewer days off moved by tours (50/46/71 against 43/52/81) and the
same swaps. The seed-to-seed spread (round 3 saw 9–38 reds on seeds 7–12) is wider than the round 3 table suggested.

Open after round 4 (all from the rule itself, not its code):
- **Crew-months under 7 (0.5–1.7 %).** Every case is a crew member on a deployment with a wave reporting before
  06:00 local every day (RIX 05:00, the GRU 747 base): with a day off running to 06:00, the eve of every such duty
  is no longer a free day, so once a tour has taken a block (`fillPairing`'s fallback when nobody else can crew the
  set) the month has no two free days left and the planner's singles fall one short. The tour's later duties are not
  known when the month's free days are counted (`monthFloorIssue`, `topUpOffs` count days beyond the planned horizon
  as free). The proper fix is the design's own: the eve duty of a month that cannot reach 7 gets the `daysOff`
  out-of-hours mark and is re-crewed through Crew Control (`guardDuty`), as any other limit; built in fix r2 (R.16.6).
- **Small groups off together.** All crew of a small family-and-role group (a single 747's 10–15 pilots) run their
  standby and flying in lockstep, so their 7th-day musts (uncapped by the stagger) land on the same day; with fewer
  days fitting a block the B744 run shows days with the whole group off (`--whyheld` "off share" max 1.00). The
  stagger's early blocks need to start at run 3–4 for groups under ten.
- **Coverage** as round 3 left it (capacity and reach at outstations), plus the 747 run above. Runtime: R.17.

### R.16.6 Round 4 fix r2: tour crews plan like everyone else; the days-off floor on rostered work

**Tour crews no longer aim at the cap.** Fix r1 had crew on a deployment tour plan towards 10 days off with their block
a day sooner; it doubled the shortages. Seed 1 with only that change taken out: uncovered 0.73 → 0.25 %, red 33 → 10,
crew-months under 7 7 → 3 (airport standby at a station-wide wave, the other fix r1 roster change, made no difference
on that seed; the old per-family wave of 3 until 10:00 gave 0.31 % / 15). `offNeed` is one rule again.

**The floor on rostered work (`dayPlan.ts eveFloorIssue`, `check.ts planCrewRaw` with `existing`).** A month that can
no longer reach its 7 (planned days off plus every free day left, standby days included: `topUpOffs` turns those into
days off) gets one back through the first duty of the trip reporting before 06:00 whose eve is free of all other
work: that duty carries the `daysOff` issue ("Days off in November would fall to 6 (minimum 7)"), the daily re-check
(`recheckSoon` → `rerosterFrom`) splits that duty off alone (the crew keep the rest of the tour: a second split at the
next duty), takes the crew member off it and marks the seat (§T.2 `slot.ooh`, `markOoh`, shared with `guardDuty`), so
the alert reads "Crew out of hours: X would fall below 7 days off this month" with the usual fixes; the roster refills
the seat (the other set's crew on a free day, else a ticket from base), and `topUpOffs` makes the freed eve the day off
the same morning (whenever the mark fires the planner has reached the month's end, so its cheap pre-check passes).
Not for the first duty of a longer trip (the crew would come off the whole trip: its positioning is the eve's work)
and only for an eve from tomorrow on. Tests: `dayPlan.test` (the pure check, four variants), `legalityGuard.test`
(a 05:00 HAM wave: the duty split off alone, the seat, the rest of the tour kept, the eve a day off).

**Why it is partial.** The shortfall is only knowable once the month's duties are built (14 days ahead), so a month
missing two days can get one back (the FRA set of seed 3: free-but-not-off days on the 7th, 15th and 23rd, the mark
reaches the 23rd), an eve already today cannot move, and a late call-out from standby on the eve of the next month's
first early duty leaves the month as it was. In the bot the mark fires about once a year (seed 3 `--whyheld`: one,
refilled at once). Tried and dropped: a chainer rule giving a set coming to an early report off free days enough of
them for its days off ((F − 1)/(W + F) ≥ 7/30: 6 on need 4 free). It is the honest model of a daily 05:00 wave under
the 06:00 rule, but it cuts a set's capacity by a fifth, an existing deployment adds at most one set, and the rest flew
as trips from base: seeds 1–3 went to 40/40/53 red. The sizing (`chainDeployment`: ⌈peak × 8/6⌉ sets, one more while
chaining can't cover the days) would have to follow the rule, with the bot's hiring behind it: a later round.

**Results (bot, 365 days, one run at a time; this code).** Any roster change moves the RNG draws, so these are other
games than R.16.5's and than each other's variants (seed 1 alone: 0.73 % / 33 red as fix r1 left it, 0.25 % / 10 with
the tour cap taken out, 0.48 % / 20 with the floor mark as well: the seed-to-seed spread is wider than any one change).

| Seed | uncovered | red / amber | crew-months < 7 | crew-years < 96 | runtime | margin ex approvals |
|---|---|---|---|---|---|---|
| 1 | 0.74 % | 34 / 36 | 0 of 809 | 3 of 93 | 40.7 s | −4.7 % |
| 2 | 0.17 % | 18 / 15 | 4 of 910 | 0 of 108 | 27.7 s | −9.5 % |
| 3 | 0.13 % | 16 / 12 | 0 of 788 | 0 of 79 | 21.8 s | 4.6 % |
| 4 | 0.41 % | 43 / 59 | 0 of 809 | 1 of 102 | 60.8 s | 0.9 % |
| 5 | 0.48 % | 29 / 25 | 1 of 791 | 2 of 96 | 29.0 s | −3.8 % |
| 6 | 0.23 % | 10 / 15 | 4 of 786 | 1 of 90 | 24.1 s | 4.1 % |
| 7 | 0.17 % | 17 / 13 | 0 of 746 | 0 of 73 | 21.5 s | 4.1 % |
| 8 | 0.35 % | 28 / 24 | 0 of 659 | 0 of 60 | 26.3 s | −8.4 % |
| 9 | 0.45 % | 33 / 45 | 0 of 793 | 0 of 94 | 45.4 s | −1.2 % |
| 10 | 0.17 % | 10 / 10 | 0 of 763 | 1 of 83 | 21.8 s | 1.9 % |
| 11 | 0.07 % | 11 / 8 | 0 of 692 | 0 of 68 | 17.7 s | −0.3 % |
| 12 | 0.00 % | 11 / 13 | 3 of 981 | 1 of 104 | 23.2 s | −0.9 % |

| 1 --wide --aug | 0.07 % | 9 / 7 | 0 of 695 | 0 of 64 | 19.3 s | 0.8 % |

Over the twelve: uncovered 0.30 % (8 seeds under the 0.3 %), 21 red a year (4 seeds at 12 or under), crew-months under
7 12 of 9,618 (0.12 %; 0 on eight seeds), every run 0 illegal duties and recovery gap ≤ 168 h; the wide/aug run passes
every target. Open: the coverage at deployment stations (the red count follows the shortages at the bases' early
waves: seeds 1, 4 and 9), the runtime (R.17.7) and the structural answer to a daily early wave (the sizing above). A
shortage-heavy game can still take minutes (seed 9 with the floor mark off, an experiment: over 10 minutes in the
re-roster's tour probes and the ladder's looks; with the mark that seed runs 45 s): a cap on re-rosters of a tour nobody
can crew is the next runtime step.

### R.17 Round 4 (runtime): per-crew timelines, cached plans, one seg shape
The round 3 profile was flat after its pre-filters; what was left was the number of times the same timeline and the
same plan were built again. Every change below gives identical bot output (the summaries of seeds 1–6 and the two
widebody runs, the day-364 state of seed 2 byte for byte, and `--det`).

**R.17.1 Per-crew timeline memo (`timeline.ts segsOf`, `walk`, `sameDeps`).** A crew member's cached timeline no
longer dies with the global crew or flight revision. The build records everything it read, in reading order, as a
flat dependency list (the pairings and their duties, each duty's cached seg list by identity, the tickets with
their status and times, the standby calls, the base) and, when a revision moved, the same walk reads them again and
compares: a few object and scalar comparisons instead of a rebuild. One walk function does both the build and the
check, so the list cannot drift from the build. The game minute only matters to the 28-day standby cut: an entry
carries the minutes for which the same windows are in (`nowLo`/`nowHi`). The cached list itself is returned
(callers filter, merge or copy; none sorts it in place), and `dutySegs` keeps its list identity across a duty's
block updates. Seed 2: 274k reads, 178k hits (was 67k); misses are real changes (a standby list replaced, a ticket
bought).

**R.17.2 planCrew memo (`check.ts planCrew`).** The read APIs ask the same question many times in one step (the
ladder's re-checks, Crew Control's candidate lists, a re-roster's re-checks after a fix): per state, revision and
minute, keyed by pairing identity (splitTourGap's probes share an id), crew member, mode, the base's cache entry and
the crew member's own inputs (the scalars `ctxOf` and the day-off checks read, and the identities of their small
objects), so a field changed in place without a bump is still seen (`deadheadOut.test`). A derived base or a jet
ride is planned afresh. Plans are shared read-only, as their segs already were. Seed 2: 34k of 214k calls.

**R.17.3 One hidden class for every seg (`rules.ts mkSeg`).** Segs were built by six literals with conditional
spreads (a dozen shapes), so every field read in `evalSegs`, `windowsAt`, `standbyView`, the merges and the walk
was megamorphic. All segs now come from one constructor with every field in one order; an absent optional field
reads `undefined` as before, nothing lists a seg's keys. The single biggest win (evalSegs self time 3.3 → 1.3 s).

**R.17.4 Smaller.** `previewCopy` deep-copies the save data itself (plain objects, arrays, primitives; key order
and undefined kept) at a third of `structuredClone`'s cost; `standbyView` returns the timeline unchanged when no
window changes and allocates its tables only when one does; `dutyBlock` and `joinedAt` allocate nothing; `block12m`
reads its 12 keys directly; `planCrew` builds one context for its evaluations; `fillAll` and `rerosterFrom` bump
the revision only when they changed something (every change inside them makes its own bump).

**R.17.5 Tried and dropped.** A crew-independent lower bound on the cumulative windows of a trip's own duties (skip
the candidate loop when the trip alone breaks 7/14/28 days for anyone): never true on seed 2 (tours carry their
days off); the 'duty7d' refusals come from each crew member's own week. Per-crew *revisions* at the touch sites
(bumping only the crew a change names): the global flight revision moves at every departure, so the fast path would
still need a per-aircraft flight revision in core; the dependency check (R.17.1) does the same job at a few
microseconds, so the touch sites stay as they are.

**R.17.6 Result (bot, 365 days, one run at a time; before = e5c81f0 after the alerts and roster lanes, same
machine).**

| Run | before | after | |
|---|---|---|---|
| 1 | 36.3 s | 31.6 s | −13 % |
| 2 | 37.2 s | 33.6 s (30.3 s alone) | −10 to −19 % |
| 3 | 29.6 s | 26.0 s | −12 % |
| 4 | 31.5 s | 27.1 s | −14 % |
| 5 | 27.7 s | 22.0 s | −21 % |
| 6 | 31.4 s | 26.2 s | −17 % |
| 1 --wide --aug | 56.3 s | 50.0 s | −11 % |
| 1 --wide --aug --b744 | 165.5 s | 130.9 s | −21 % (the insolvent game of R.16.5) |

Every summary line identical to before (only the runtime figures move); `--det` seeds 1 and 2: two runs and both
save → reload points identical. Still over the 20 s limit on every seed (timing noise on this machine is ± 3 s
between batches).

Where the time goes after this round (seed 2, 30 s, `--cpu-prof`): `planCrew` 9 s (180k evaluations: the
auto-roster's candidate loop 36k, `splitTourGap` 38k, re-checks of assigned crew 70k, Crew Control's candidates
15k; each one an `evalSegs` over the merged timeline), the previews on state copies 7 s (the bot's delay and swap
searches: `delayPlan` 4.4 s, `previewOf` 4 s; cold caches in every copy), the timeline cache 4.7 s (builds and
checks), the daily planner 3.6 s, the tour chainer's crew check 1.8 s, garbage collection 2 s, the bot's own
bookkeeping 1 s. The 20 s limit needs the next structural step, not another cache: fewer candidate evaluations
(`splitTourGap` probes every later duty against the whole pool every run; the re-roster re-checks every pairing of
the aircraft twice) and preview copies that reuse the live caches.

**R.17.7 Round 4 fix r2.** `rerosterFrom` re-checks each crewed pairing with the full timeline first (the step's cached
plans: `recheckSoon` and the ladder asked the same question) and asks the prior-only view (a filtered base: never
cached) only for a pairing the full check found illegal; a trip clean on the whole timeline is clean on part of it.
One case a year ran the other way (seed 1: a loose ticket out starting after the trip's start carried the crew
member to the station; prior-only read "At LIS, not DUS" and released them, the final full check was clean): the
full view is the truer one, so that release no longer happens. Tried and dropped: `splitTourGap` probing by halving
over the later duties (⌈log₂ n⌉ + 1 probes of the pool instead of n, on the reading that a crew member legal from duty
k is legal from k + 1). Seed 1 played identically with it, but the reading is not a rule (a ticket out can fit before
one report and not the next), a later split than the first that fits leaves more of a tour uncovered, and the probes
were under 3 % of the time. Kept instead: the probe for "the tour from duty k on" is one object per tour and k within
a step (`probeOf`), so `planCrew`'s memo answers it when the same tour is re-rostered again in that step (the ladder's
tick, every Crew Control look of the bot, a flight change): a tour nobody can crew no longer costs its whole pool at
every look. A shortage-heavy game (seed 9 with the floor mark off) ran over 19 minutes in those probes before this.

### R.18 Round 5: the regression bisected and its root causes

**R.18.1 What the bisect found, and what it did not.** Bisecting 159dce4..e8e7f54 on seeds 1 and 4 laid the red
shortages at the door of `morningFree` 360 (7d0b3e6) and the eve-floor mark (de3f49d), and a `--seatlog` of the bot
(every required seat that goes from crewed to empty, every new trip born empty, every crew member found illegal on a
duty within 3 days, every contract signed with its lead) then showed what those reds were made of:
- about half came from work the bot signed at 0.1–1.5 days' notice (AOG covers at ARN, ZAG, RUH, FRA, SOF; evacuations
  and repatriations) that no crew could reach: the engine's crew check counts heads, not reach, and the same pattern
  sits in the round 3 runs (seed 4's 8 reds at 159dce4 were the same ARN cover and the same AMM–EBL evacuation);
- deployment seats went red 2–5 days out with the crew member "available": the daily re-check had found them
  **on leave** (`statusIssues`) on a tour that had grown past a leave block between two of its duties, and attributed
  the block to the trip's first duty, so the crew member came off the whole tour;
- a tour's early duties (05:00 waves at DUS, RUH, HAM) with the set returning from days off: with the eve rule the
  day off before is taken (`crewTake` moves it), the month's free singles sit on the eve of the next early duty, and the
  month ends at 5 or 6: the crew-months under 7;
- the eve-floor mark itself fired once a year (seed 1) and emptied a seat 1–3 days out; it was not the regression's
  carrier (the bisect's E3 run was a different game, not a different mechanism);
- the crew-years under 96 were hires counted for 2–4 months at exactly 8 a month of need, one month at 7.
One correctness bug outside the roster surfaced with the new trajectories: a crew-wait delay of a day over the next
day's base waves rippled only along the legs the aircraft could follow by location, left the shuttle's legs overlapping
the base's and flew a leg with its crew in Lisbon (the crew audit).

**R.18.2 Fixes (engine).**
- **Sizing counts the eve (`duties.ts chainer`, sizing trial only).** The virtual-set trial counts the eve of a report
  before 06:00 as a worked day of the set and gives such a duty first to the set that worked the eve (as the real
  chaining does for crewed sets), so an early-only programme is sized one set larger and a mixed one (HAM–PMI 06:00 +
  12:30: 3 sets) is not. The real chaining keeps the plain day count (round 4: counting the eve there made the sets
  refuse duties, which then flew as trips from base).
- **The early cover (`dayPlan.ts rawWindow`, `BAL.v09.roster.earlyCover`).** A station whose day's first report comes
  before the default window plus the response time can reach it (07:00 station-local) gets, per role, one home or
  hotel standby per seat reporting that early, starting response time + 15 min before that report, the window its
  usual 12 h; starting between 23:00 and 07:00 the night is not counted towards the call-out cut until contacted
  (CS FTL.1.225(b)(5)). After a day off the window still opens at 06:00 and a crew member still resting keeps the
  default window (`planStandby` clips it), so a day's cover can fall short of the seats, never over them. The airport
  wave window counts departures from 03:00 (`airport.waveFrom`; it started at 05:00 and the 04:00 banks never formed
  one).
- **The floors planned ahead (`dayPlan.ts minFor`, `yearPaceMin`, `legalFor`).** A month's planner minimum (8) is
  raised, to the cap at most, when the calendar year's 96 pro rata is behind its pace (what is still needed after the
  closed months, planned days off, leave and sickness, spread over the months left); December's *legal* floor is what
  the year still needs, so a hire counted for two months (16 needed) with a 7 in November must hold 9 in December and
  `monthFloorIssue` refuses work that would leave fewer. `yearPaceMin` is cached on its inputs' identities (offNeed asks
  for every crew member and day; a new game's init had doubled in time without it).
- **The eve floor mark on the duty furthest ahead (`eveFloorIssue`).** Of the qualifying duties (not the trip's first,
  the eve free, from tomorrow on) the one furthest ahead in the month is marked: its seat has ten days to be re-crewed
  where the first one had one or two.
- **Days off in runs of at most 3 (`offRunOver`, `planDay`, `topUpOffs`, `replacementDay`).** A block, a top-up day or
  a replacement day joins no run of days off longer than `off.block[1]`; a must that fits nowhere else, and the legal 7,
  may (the floor is law, the cap a preference). Leave is a block, not days off, so it is untouched.
- **A crewed tour never grows onto leave, sickness, training or a joining period (`roster.ts crewOkHook`)**, and a block
  between two duties of a tour falls on the first duty *after* it (`check.ts statusIssues`), so the daily re-check splits
  the tour there and re-crews that part while the duties before it fly; `planLeave` never puts leave inside a tour's
  span. (A guard refusing any duty whose tour would span a block was tried first: it sent the duties after every
  mid-tour leave to base as trips and doubled the reds on seed 4.)
- **An aircraft is never scheduled in two places (`ops/flights.ts settleOverlaps`).** After every delay ripple (the
  three branches of `delayChain0` and `ripple`), any scheduled leg still departing before the one before it has landed
  and turned moves behind it in departure order, so duties read from the flights stay in time order and report before
  their first departure.

**R.18.3 Fixes (bot).** Short-notice work (inside two days) is signed only when the roster crews its first two days:
the offer is signed on a copy of the game first (`previewCopy`, the engine rosters at signing) and passed over when a
required seat of a trip reporting within two days of the start is left empty (the crew desk checks the crewing before
the sales desk says yes). A widebody flies widebody work (the body asked for, 220+ seats, or the fleet's reading of the
job); general work goes to it only with a week's notice and one such job at a time. A widebody lease is signed only for a
job the airline signs in the same breath (lease and contract back to back, tried on a copy first); a lease on an open
offer that lapsed before delivery had parked a 747 at $400K a month. The crew-control line and the red target say how
many reds were out-of-hours; `--seatlog` is the diagnostic above.

**R.18.4 Tests.** `dayPlan.test` (the year's pace: a two-month hire, a whole year with leave, a month the year does not
count; the run cap and the planner keeping every run within it; the early cover's windows, one per early seat and
role, never over; the eve floor mark on the later of two qualifying duties), `legalityGuard.test` (the R.16.6 scenario
with the duty furthest ahead), `roster.test` (a tour crew member's leave: no duty on it is theirs, no tour of theirs
spans it, the HAM–PMI sizing unchanged at 3 and 4 sets), `flights.test` (a day's crew wait over another programme's legs
leaves no two legs overlapping and every duty in time order), `heads.test` (the analyst judged against each estimate).

**R.18.5 Results.** Bot, 365 days, one run at a time, this code (a4f09b7 + docs); before = round 3 (159dce4, §R.15.9 and the bisect's own
runs of seeds 1 and 4) and round 4.2 (e8e7f54, the ready-2 logs). Every run: 0 illegal duties, 0 planned discretion,
recovery gap ≤ 168 h, 0 crew-months under 7, 0 crew-years under 96 pro rata; every seed solvent and both wide runs
solvent. Red counts say how many of the reds were crew out of hours (the §T kind), as the bot now reports them.

| run | uncovered r3 → r4.2 → **r5** | red r3 → r4.2 → **r5** | runtime r3 → r4.2 → **r5** | margin r3 → r4.2 → **r5** | months < 7 (r4.2 → r5) | years < 96 (r4.2 → r5) | legs r5 |
|---|---|---|---|---|---|---|---|
| 1 | 0.07 → 0.74 → **0.16 %** | 7 → 34 → **10** (3 ooh) | 17 → 39 → **27 s** | −2.9 → −4.7 → **+1.9 %** | 0 → 0 | 3 → 0 | 1698 |
| 2 | 0.31 → 0.17 → **0.00 %** | 19 → 18 → **2** (0) | 26 → 27 → **21 s** | 4.0 → −9.5 → **+6.3 %** | 4 → 0 | 0 → 0 | 1897 |
| 3 | 0.20 → 0.13 → **0.48 %** | 11 → 16 → **22** (9) | 22 → 20 → **24 s** | 4.1 → 4.6 → **−6.0 %** | 0 → 0 | 0 → 0 | 1120 |
| 4 | 0.06 → 0.41 → **0.11 %** | 8 → 43 → **12** (2) | 25 → 59 → **24 s** | −2.2 → 0.9 → **+3.7 %** | 0 → 0 | 1 → 0 | 1669 |
| 5 | 0.36 → 0.48 → **0.07 %** | 12 → 29 → **24** (3) | 29 → 30 → **27 s** | −5.1 → −3.8 → **−3.4 %** | 1 → 0 | 2 → 0 | 1430 |
| 6 | 0.00 → 0.23 → **0.00 %** | 8 → 10 → **5** (1) | 27 → 29 → **16 s** | 3.0 → 4.1 → **−7.3 %** | 4 → 0 | 1 → 0 | 1194 |
| 1 --wide --aug | 0.07 → 0.07 → **0.22 %** | 11 → 9 → **11** (1) | 21 → 26 → **21 s** | 0.4 → 0.8 → **−5.6 %** | 0 → 0 | 0 → 0 | 1259 |
| 1 --wide --aug --b744 | 0.52 → 1.90 → **0.35 %** | 21 → 44 → **30** (6) | 52 → 83 → **45 s** | −17.4 → insolvent → **−15.9 %, solvent** | 0 → 0 | 2 → 0 | 1594 |

Over seeds 1–6: uncovered 0.14 % (five seeds at or under 0.3 %; round 4.2 had three), 12.5 red a year (four seeds at
12 or under; round 4.2 had one), every legal target green on every run, the 747 run solvent again with its lease
signed for a job in hand (a MAD season base, day 137). Seeds 3 and 5 keep 22 and 24 reds: `--whyheld` on seed 3 shows
ad hoc trips the two A320s and 69 crew cannot reach (free pursers in Lisbon for a Riyadh or Casablanca report, a
captain short of rest by 7 h, two FDPs pushed over their limit by a retime) and three AOG covers the preview passed
whose first duty then lost its rest to a delay: capacity and reach, not the roster rules. Margins: three runs sit
1–2 points under the −5 % line (seeds 3 and 6, the wide run), on revenue not cost: seed 6 leased a narrowbody out
for the winter ($1.2M of lease income, 1,194 legs against 1,645) and seed 3 signed 15 % less flying; salaries fell on
both. The trajectories are other games than round 4.2's (any roster change moves the draws), so the seed-to-seed
spread is wider than any one change.

**Runtime.** 16–27 s on seeds 1–6 (21 s and 45 s on the wide runs), against 17–29 s at round 3 and 20–59 s at round
4.2; per leg, seed 1 runs 16 ms against 12 ms at 159dce4 and 24 ms at round 4.2. The profile of seed 1 (24.6 s, `--cpu-prof`)
is flat: `planCrew` 5.1 s (21 %: the auto-roster's candidate loop 2.3 s, the daily re-check of every crewed trip 1.2 s,
re-rosters 3.8 s with their re-checks), the bot's Crew Control previews on state copies 4.0 s (`delayPlan` 2.1 s,
`previewOf` 0.9 s), the daily planner 3.0 s (`planStandby` 1.5, `planOffDays` 1.2), `planAircraft` 2.1 s (the tour chainer
1.5), garbage collection 1.5 s; `splitTourGap` is 0.06 s (the round 4 probes are gone). A memo of clean pairings for
the daily re-check (keyed on the duties' versions, the seats and each crew member's cached timeline) was tried and
dropped: 18 % hits, under half a second, and a pairing's label left to an older check. The next step is structural
(fewer candidate evaluations per empty seat), as R.17.6 said; the 20 s line is not met and the bot's own previews are
a sixth of what is left.


### R.19 v0.9.1 "Tuning"

**Speed (identical output).** The crew timeline memo has two layers: the work (log, duties, tickets: the round 4
dependency walk) and the standby overlay keyed on the work entry, the standby list, its calls and the 28-day cut, so a
standby change no longer rebuilds the walk. `rerosterFrom` keeps a trip's check when a value signature of everything
`recheckPairing` reads (the trip, its duties as `dutySegs` keys them, each leg's and ticket's times, status, version and
riders, each crew member's `crewKey`/`crewIds`, their timeline entry and their other trips' spans) is unchanged since
the check, and writes the kept result back (a prior-only check in between rewrites `p.legality`: the first version of
this skip missed that and moved seed 3). Seeds 1 and 3 ran output-identical to v0.9 with it; `--det` identical. The bot's
delay search stops at its 6 h cap.

**Crew coverage (rules kept, planning changed).**
- A trip runs at most 6 days from its first report to a duty's release without a recovery rest (36 h, 2 local nights)
  inside it (`duties.ts buildTrips`, `TRIP_SPAN`); a longer ad hoc programme away from base is crewed in two parts, the
  crew changing at the station. Seed 3's 8-day, 6-duty trip from Lisbon could not be flown by any one crew and stayed
  empty to the day (4 red alerts).
- A duty not yet reported keeps 2 h in hand on the 168 h between recoveries (was 1 h; a last duty 1 h 50 late ran a
  crew to 169 h).
- The days-off floor on rostered work: when no early duty has a free eve (`eveFloorIssue`), the duty furthest ahead whose
  own day (to 06:00 the morning after) is free of other work carries the issue (`dayFloorIssue`). `monthFloorIssue` now
  weighs the month's last day too when the work takes one of its days off, and a Crew Control swap never moves someone
  the move would leave under the floor (seed 6: a swap on 31 January took a purser's last two days off). `topUpOffs`
  trusts the month's unplanned days as room only while more than two weeks of them are left (busy ones are no room:
  seed 4 closed a month at 6 when a tour filled its last unplanned days and a free planned day was never given back).
- Before the crew report, a leg out of or into an airport still closed at its departure moves to 3 h after the
  reopening (`setClosedWaitHook`): seed 5's Goma positioning crew had sat 29 h "on duty" through hourly holds, went home
  at the reopening, and the aircraft then raised 18 red alerts in three days.
- Positioning out of a station where the aircraft has stood idle waits for a ticket from base to reach it whenever the
  earliest slot is inside a ticket's reach (`schedule.ts crewFree`; it only did so when that slot was already past).
- The offer card's crew line warns in plain words when a job inside two days starts from a station nobody of the family
  is at and the first airline seat lands too late: "No crew can reach Dubai before the … report" (`crewReachSoon`).

**Bot.** No narrowbody lease-out from a fleet of two (seeds 3 and 6 leased one, then both on seed 3, for the winter with
the crew of two aircraft on the payroll).

**Music (§S).** `ui/music.ts`: pads on Imaj7–vi7–IVmaj7–Vsus and two cousins at 64 bpm, sparse electric-piano notes with
a soft echo, key and progression drawn every few cycles (UI randomness only); scheduled 4 s ahead from a 1 s timer.
Its own category, switch and volume (`settings.music`, `musicVolume`, on at 0.35 by default; old settings get the
defaults), under the master switch and volume; it dips under every chime and alert and fades out (1.5 s) before the
context sleeps when the app is hidden, back in over a few seconds. Test sounds has a Music row.

---

## 9. What's new v0.9 "Experience" (ENGINE `data/whatsNew.ts`, player words)
Features:
1. Department heads: earn them by flying well, then hire one. An Ops Control duty manager, a maintenance planner, a crew scheduling desk, a commercial analyst, credit control, a fleet planner and a watch desk for your own alerts. Each takes routine work off your desk, makes the odd mistake, and never decides the big things.
2. Achievements: 24 milestones on the Company screen, with a quiet note when you earn one.
3. Sound: real cabin chimes. A high chime for news, a low chime for calm moments, the high-low bing-bong for a new contract, double for a problem that needs you soon, triple for a serious one, and one urgent alarm for crew shortage and crew out of hours. Settings has a volume, categories and a test list.
4. Crew out of hours: its own alert when a pilot or flight attendant reaches a legal limit, naming who, which limit and by how much, with the fixes.
5. Crew change at a fuel stop: a long one-way flight can now split with a fresh crew flown in to the tech stop, priced into the offer and planned by the roster.
6. First-time hints on each screen, written for people who know the job.
7. Roster planning like a real EASA operator: crews get 8–10 days off a month in 2–3-day blocks (one block a week is the 36 h rest) and 4 weeks' leave, published 14 days ahead and protected. Every other free day is standby: at home, at the hotel on a detachment or night-stop, at the airport at busy bases, or reserve. Crew Control calls standby first.

Improvements:
- Captain's discretion is never planned: it only appears after the crew has reported, for something unforeseen, and the longest day says so.
- Shorter, plainer texts across the game.
- A delay after the crew has reported now re-checks the in-flight rest at departure.
- Jumbo loads (420+ seats) for the 747-400 and other 450-seat jets, and charters with fuel billed at cost, so a well-chosen Hajj, troop or UN job pays.
- What's new catches up: the first start after an update also shows the notes of the versions you skipped, once.

---

## 10. Data model (ENGINE lands first: one additive edit of `core/types.ts`)
All fields optional unless the type is new; load defaults in brackets.
- `HeadId`, `Head`, `HeadCandidate`, `HeadLogLine`, `HeadProposal`, `HeadRules`, `AlertRule`; `GameState.heads` [all locked].
- `GameState.achievements` [{} + silent backfill].
- `OohLimit`; `PairingSlot.ooh`; `Duty.plannedFdp` [computed lazily], `Duty.slipAt`.
- `ContractOffer.slip`, `ContractOffer.jumbo`; `Product` (charter) `fuelAtCost`.
- `ProblemKind` += `'crewHours'`; `Message.topic` += `'crewHours' | 'achievement' | 'head'`; `Ref.kind` += `'head'`.
- `PauseReason` += `'crewHours' | 'rule'` (`PAUSE_ORDER`: aog, decision, urgentOffer, crewHours, crewShortage, rule, contractStart, monthEnd, marketOffer).
- `Stats.v09?: { legalStreak: number; cover: Record<number, [number, number]> /* MonthKey → [departures, held for crew] */; slips: number; oohRed: number; oohAmber: number; discretionUsed: number; discretionRefused: number; headHandled: number; headMistakes: number; jumboLoads: number; lateGovPaid: number; cOnTime: number }` [zeros; `cover` from `uncovered`/`departures` of the current month].
- `core/cues.ts` (runtime only): `Cue` union = the engine events of §S.3.
- §R: `StandbyKind`; `CrewMember.standby[]` += `kind`, `at`, `shift`; `CrewMember.off`, `offMonths`, `leaveYear`; `blocks[]` += `annual`; `GameState.dayPlan` [old saves: first base midnight ≥ now + 14 d; new games: start]; `MoraleDriver` += `'standby' | 'daysOff'`; `OohLimit` += `'daysOff'`; `Stats.v09.roster` [zeros]. `IssueCode` += `'daysOff'` lives in `crew/rules.ts`.
- `data`: `achievements.ts`, `heads.ts` (`HEAD_DEFS`: title, icon, does[], never[], unlockText, salary), `glossary.ts` (+ `outOfHours`, `slipCrew`, `departmentHead`, `jumboLoad`, `fuelAtCost`; rewrites `longestDay`, `discretion`; §R: `airportStandby`, `reserve`, `daysOff`, `publishedRoster`, rewrites `standby`), `whatsNew.ts`.

## 11. Balance (`core/balance.ts`, new block `v09`)
```ts
v09: {
  heads: {
    salary: { opsControl: 9_000, maintPlanner: 8_000, crewDesk: 14_000, analyst: 9_000, credit: 6_000, fleetPlanner: 10_000, watch: 5_000 },
    tiers: [[0.55, 0.65, 0.7], [0.7, 0.8, 1], [0.85, 0.92, 1.45]], growth: 0.02, growthDays: 90, cap: 0.95, mistake: 0.35,
    unlock: { legalSectors: 25, cover: 0.98, coverMonths: 2, contracts: 5, reliable: 85 },
    ops: { maxDelayMin: 120 }, maint: { aAt: 0.75, aDays: 14, outstation: 0.2, cDays: 120 }, desk: { fixMax: 8_000 },
    credit: { remind: [3, 10], base: 0.15, perSkill: 0.25, deposit: 0.3, govDeposit: 0.2, slow: 0.8 },
    fleet: { idleH: 48, freeH: 72, marginMin: 60 }, proposalH: 72, severanceMonths: 1, rehireDays: 30,
  },
  slip: { maxPerSector: 1, roomNights: 1 },
  jumbo: { pax: [420, 480], share: 0.2, shareIdle: 0.35, capShare: 0.12 },
  offerLapseH: 6, delayPenaltyMin: 60, holdCancelRiskH: 6,
  roster: { /* §R.11 */ },
}
```

## 12. Interfaces between lanes (final signatures; ENGINE ships stubs first)
```ts
// core/cues.ts
export type Cue = 'message' | 'crewJoined' | 'paymentIn' | 'monthEnd' | 'headDone' | 'decision' | 'offerNew' | 'contractSigned' | 'flightDep' | 'flightArr'
  | 'aog' | 'delayPenalty' | 'sickCall' | 'latePayer' | 'offerLapsing' | 'worldEventOurs' | 'crewAmber' | 'ruleAlert'
  | 'cancelRisk' | 'airspaceActive' | 'cashNegative' | 'evacuation' | 'clientCollapse' | 'crewShortage' | 'crewOutOfHours'
  | 'achievement' | 'ladder' | 'headUnlocked' | 'headHired';
export function cue(c: Cue): void; export function takeCues(): Cue[];     // isolatePauses also isolates cues
// ops/heads.ts
export interface HeadView { id: HeadId; title: string; icon: string; unlocked: boolean; unlockText: string; progress: { label: string; have: number; need: number } | null;
  person: { name: string; skill: number; salary: number; since: Minute } | null; candidates: HeadCandidate[]; on: boolean; rules: HeadRules;
  does: string[]; never: string[]; proposals: HeadProposal[]; log: HeadLogLine[]; handled: number; mistakes: number; overridden: number }
export function headsView(g: GameState): HeadView[]; export function headView(g: GameState, id: HeadId): HeadView;
export function hireHead(g: GameState, id: HeadId, candidate: number): ActionResult;
export function fireHead(g: GameState, id: HeadId): ActionResult;
export function setHeadOn(g: GameState, id: HeadId, on: boolean): ActionResult;
export function setHeadRules(g: GameState, id: HeadId, rules: Partial<HeadRules>): ActionResult;
export function acceptProposal(g: GameState, id: HeadId, proposalId: string): ActionResult;
export function dismissProposal(g: GameState, id: HeadId, proposalId: string): ActionResult;
export interface AnalystView { name: string; skill: number; score: number; verdict: 'take' | 'counter' | 'pass'; aircraftId: string | null; marginPct: number; counter: number | null; lines: string[] }
export function analystView(g: GameState, offerId: string): AnalystView | null;   // null unless hired and on
export function ferryAircraft(g: GameState, aircraftId: string, to: string): ActionResult<{ flightIds: string[]; cost: number }>;
// ops/achievements.ts
export interface AchievementView { id: string; title: string; text: string; icon: string; group: AchievementDef['group']; at: Minute | null; progress: { have: number; need: number; label: string } | null; head?: HeadId }
export function achievementsView(g: GameState): AchievementView[];
// crew (crew/control.ts, crew/slip.ts, crew/roster.ts)
export type CrewAlertKind = 'short' | 'hours';
export function crewAlertKind(g: GameState, flightId: string): CrewAlertKind | null;
export interface OohInfo { crewId: string; name: string; role: Role; limit: OohLimit; limitText: string; value: number; max: number; overMin: number }
export function outOfHours(g: GameState, flightId: string): OohInfo[];
export function shortFlights(g: GameState): { flightId: string; stage: 'amber' | 'red'; hoursLeft: number; kind: CrewAlertKind }[];
export function discretionCheck(g: GameState, dutyId: string): { ok: boolean; why: string; addMin: number };
export interface SlipView { flightId: string; at: string; atName: string; inCrew: { names: string[]; ticketIds: string[]; arrives: Minute | null }; outCrew: { names: string[]; ticketIds: string[]; leaves: Minute | null }; text: string }
export function slipOfFlight(g: GameState, flightId: string): SlipView | null;
export function slipsOfAircraft(g: GameState, aircraftId: string, from: Minute, to: Minute): SlipView[];
// problems: crewHoursCard via problemFor(g, {kind: 'crewHours', ref: {kind: 'flight', id}})
// data/whatsNew.ts
export function whatsNewToShow(seen: string, catchUpDone: boolean): WhatsNewEntry[];
// dev (engine/dev.ts), each returns the id to open
export function devUnlockHead(g: GameState, id: HeadId): HeadId;
export function devAchievement(g: GameState, id: string): string;
export function devCrewHours(g: GameState, limit?: OohLimit): string;       // flight id, red stage
export function devSlipOffer(g: GameState, route?: 'MAD-SIN' | 'DIL-LIS'): string;   // offer id
export function devJumbo(g: GameState): string;                              // offer id (adds a 747 if none)
export function devRestAtDeparture(g: GameState): string;                    // flight id (§Y.1 scenario)
```
**UI store additions** (`src/ui/store.ts`, additive): `Settings` += `soundCats`, `ambience`, `screenHintsSeen: string[]`, `whatsNewCatchUp: string`; `autoPause` += `crewHours: true`, `rule: true`. `ModalSpec` += `{kind: 'headUnlocked'; id: HeadId}`. Company `nav.view` += `'team' | 'achievements'`. Inbox deep link for `head` refs → Company › Team with the head selected. Dev helpers: `dev.head(id)`, `dev.achievement(id)`, `dev.crewHours(limit?)`, `dev.slip(route?)`, `dev.jumbo()`, `dev.restAtDeparture()`, `dev.sound(id)`.
**§R signatures** are in §R.14 (`crewMonth`, `offBreak`, `isOff`, `standbyNow`, `publishedTo`, `SETS_WHY`, `CalBlock.sby/shift/protected/planned`, `DropTarget.offBreak`, `moveDuty(…, { takeOff })`, `DutyCandidate.standby.kind/at/readyMin`). UI dev helper: `dev.roster()` (→ `devRoster`, opens the roster board on the DUB tour crew).
**MAP reads** `crewAlertKind`, `outOfHours`, `slipsOfAircraft`, `slipOfFlight`, `standbyNow`. MAP exports nothing new to UI.

## 13. Bot (`scripts/acmi-bot.ts`, ENGINE)
New rules:
- **Heads**: hire the mid candidate when unlocked and cash ≥ $1M (else the junior); rules stay at their defaults; accept `ferryHome` proposals under $60K and `cSlot` proposals; never fire anyone.
- **Crew out of hours**: handled like shortages in `crewControlPolicy`. Discretion only through `discretionCheck`.
- **Slips**: accept slip offers by margin like any offer.
- **747**: prefer jumbo loads for an idle 747; never sign general work with it below a +5 % estimated margin.
- **Speed**: §Y.3.
- **Roster (§R.12)**: nothing to decide (the planner is in the engine); never breaks a published day off; prints the `roster:` line.
- **Printed** (new line): `v0.9: heads unlocked opsControl d18 maintPlanner – crewDesk d96 … · hired N · handled N (mistakes N, overridden 0) · achievements N/24 · slips N (offers N) · out of hours red N amber N · discretion used N (planned 0) refused N · jumbo loads N (747 margin X %) · runtime s`.
- **Targets** (seeds 1–6, one at a time, 365 days):
  - every v0.8 hard target (0 illegal duties, 0 impossible rest plans flown, ≤ 0.3 % uncovered, margin band, morale and resignations);
  - **0 discretion uses with `plannedFdp > maxFdp` and 0 before report**;
  - ≥ 3 heads unlocked on every seed and ≥ 5 on 3 seeds;
  - heads take ≥ 40 % of the routine decisions;
  - achievements 6–14 per seed;
  - ≥ 1 slip offer seen on every seed with a widebody;
  - runtime ≤ 20 s (goal 12 s);
  - §R.12: 0 crew-months below 7 days off, recovery gap ≤ 168 h, average days off 8.5–10, standby + reserve ≥ 85 % of the remaining free days, call-outs ≥ 50 % of crew fixes.

## 14. Tests and acceptance

**ENGINE tests**
- `ops/heads.test.ts`:
  - every unlock condition at its threshold, plus the old-save backfill with one message;
  - candidates (deterministic per seed, 3 tiers in their bands);
  - hire, fire, severance and rehire after 30 days;
  - salary on the month statement;
  - Ops Control takes a `sickCrew` (call-in) and a short gate delay, but never an over-limit delay, sub-charter or cancel;
  - the decision hook posts no decision or pause when it acts;
  - the mistake rate over 2,000 rolls is (1 − skill) × 0.35 ± 2 %;
  - the maintenance planner books into a maintenance night, moves on a clash and never books a C-check;
  - crew desk fixes amber flights within `fixMax`;
  - credit reminders raise the pay chance, and waive applies for Trusted+;
  - fleet planner `ferryHome` proposal, accept → `ferryAircraft`;
  - watch rules fire once per subject and pause with `rule`;
  - `analystView` is pure and deterministic, with its counter within the `counterOdds` 60 % band.
- `ops/achievements.test.ts`: each achievement triggers once with its message; the backfill is silent; progress values.
- `crew/outOfHours.test.ts`:
  - `crewAlertKind` for a 28-day block overrun (hours), a missing seat (short), both together (hours) and a wrong-place crew (short);
  - the red stage posts `crewHours` + pause `crewHours` + cue `crewOutOfHours`;
  - the shortage path is unchanged;
  - card lines name who, which limit and by how much;
  - `ooh` is set on guard-removal and cleared on refill.
- `crew/discretion.test.ts`:
  - `discretionCheck` is refused before report, refused with `plannedFdp > maxFdp`, ok for a gate hold after a legal report, and refused over `discretionMax`;
  - Crew Control shows the row greyed with the reason;
  - `fdpOver` never applies it to a planned overrun;
  - **planning never counts it**: `longestDay`, `restNeed`, `ulrNeed`, `crewCanFly`, `planAircraft` and `tripMove` give identical results with `DISCRETION` monkey-patched to 10 h.
- `crew/slip.test.ts`:
  - MAD–SIN on an A330 via IST and DIL–LIS on an A320 via PNH+OTP give a `SlipPlan` at the expected stop;
  - feasibility shows "Crew change at IST (fresh crew flies in)" at level warn;
  - the price includes tickets and hotel;
  - `crewCanFly` true;
  - the roster cuts the duty at the same stop, deadheads the slip crew in with legal rest and sends the first crew home;
  - 0 illegal duties over the contract;
  - a chain needing 2 slips stays impossible.
- `ops/flights.test.ts` (Y.1): the departure re-check scenario.
- `contracts/missions.test.ts` (Y.2): jumbo share; reference rate ≥ $10K/BH at 420+ pax; fuel at cost billed at the actual burn; the 747 margin targets.
- `data/whatsNew.test.ts`: `whatsNewToShow('v0.8', false)` → [v0.9, v0.8, v0.7.4]; `('v0.8', true)` → [v0.9] until seen, then []; `('', false)` → [v0.9]; `('v0.7.2', false)` → everything since v0.7.2.
- `core/cues.test.ts`: messages map to the §S.3 cues; previews (`isolatePauses`) emit none; cues are not saved.
- `saveCompat09.test.ts`: v0.5.2 … v0.7.3 fixtures **and a new `save-v08.lz.txt`** (dumped before any v0.9 engine change with `npx tsx scripts/acmi-bot.ts 3 240 --wide --dump=240,<scratch>/v08.json`, then `LZString.compressToBase64`) load with every §10 default; heads locked or backfilled with one message; 60 days run with 0 illegal duties; serialise/reload equal.
- `crew/dayPlan.test.ts` (§R.13): legal minimums, unassigned days are standby, hotel standby at detachments, standby in the 7/14/28-day sums, call-out reductions, rest after standby, annual leave, protected days off, migration.
- `core/plumbing.test.ts` purity: `crewMonth`, `isOff`, `offBreak`, `standbyNow`, `publishedTo`, `headsView`, `headView`, `analystView`, `achievementsView`, `crewAlertKind`, `outOfHours`, `discretionCheck`, `bestSlip`, `slipOfFlight`, `slipsOfAircraft`, `whatsNewToShow`, `longestDay`.

**UI acceptance** (`scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch). New shots:
- `company-team`, `company-team-locked`, `head-unlocked-card`, `company-achievements`, `achievement-toast`;
- `offer-analyst`, `offer-slip`, `offer-jumbo`;
- `crew-control-out-of-hours`, `crew-control-discretion-greyed`;
- `inbox-crew-hours`, `opsstrip-hours`, `settings-sound`, `settings-test-sounds`;
- `screen-hint-contracts`, `whats-new-catchup`, `fleet-longest-day-popover`, `crewplan-verdict`;
- §R: `roster-board-standby`, `roster-board-month-summary`, `roster-offbreak-confirm`, `crew-person-month`, `crew-control-standby-kinds`, `crewplan-sets-why`, `map-hotel-standby`.

Checks:
- no horizontal overflow; every tappable element ≥ 44 px;
- nothing animates except aircraft (hints, toasts and cards appear without motion beyond the existing 150 ms fade);
- with sound on at 4× for 60 s of a busy dev game (`dev.fleet(10)`), a log of played sounds shows no two chimes inside 900 ms and the alarm at most once per 20 s;
- the first tap unlocks audio in Playwright WebKit (and nothing plays before it);
- `whatsNew` on a `seenWhatsNew: 'v0.8'` profile shows three versions once, then never again.

**MAP acceptance**: on `dev.slip()` signed and rostered, selecting the aircraft shows the slip crew's deadhead and the static crew-change mark at IST; the panel text reads as in §W.4. On `dev.crewHours()` the aircraft panel banner reads "Crew out of hours · …". Frame cost is unchanged (< 1 ms with 10 aircraft).

## 15. Not in v0.9 (keep it simple)
- No new contract types and no new aircraft types.
- Heads are never hired automatically, never fired by events, and never sign, buy or decide crises.
- No head for HR/morale, chief pilot or cabin.
- No scenarios.
- No voice clips or audio files; no music.
- No sound for map pans.
- No achievements with money rewards.
- No tutorial walkthroughs or arrows (hints only).
- No changes to FTL limits beyond the discretion guard.
- No second slip per sector; no slip on round trips (the far-end slip already exists).
- §R: no crew bidding or requests, no player-editable leave, no standby pay or duty pay (salaries stay monthly), no change to FTL limits, no new problem card (shortage and out of hours cover it), no rotation pattern settings.

## 16. Order of work inside each lane
1. **ENGINE step 0**:
   - dump `save-v08.lz.txt` before any change;
   - §10 types and §11 BAL;
   - `core/cues.ts` with `takeCues`;
   - stubs for every §12 export (views return locked heads, `[]` or `null`; `crewAlertKind` maps `missing → 'short'`, `illegal → 'hours'`; `whatsNewToShow` real);
   - tsc/vitest/build green.

   UI and MAP start against the stubs.
2. **ENGINE** (§R first: it is the player's latest request and changes every crew screen):
   0. §R roster planning (`dayPlan.ts`, rules `'daysOff'`, standby kinds, Crew Control order, calendar/board fields, leave, morale, migration, `dayPlan.test.ts`), then a bot run on seeds 1–3 before going on;
   1. §U discretion guard + audit tests;
   2. §T out of hours + card;
   3. §Y.1 departure re-check;
   4. §W slips (feasibility, pricing, offers, roster);
   5. cues at every source (§S.3);
   6. §14 achievements;
   7. §5 heads (hook, each head, proposals, watch rules, analyst);
   8. §Y.2 jumbo loads;
   9. glossary, What's new, §V engine strings;
   10. dev helpers;
   11. bot (§13, §Y.3 speed) last, then seeds 1–6 and the save fixture.
3. **UI**:
   0. §R roster board codes/colours/legend/published line/month column/off-break confirm, Crew strip + month line, CrewPlan `SETS_WHY` (against the §R.14 stubs);
   1. store additions (settings merge, cue pump, audio unlock, catch-up);
   2. `sound.ts` (bank, table, merge, cooldowns, ambience);
   3. Settings › Sound + Test sounds + the new pause toggle;
   4. Crew Control out-of-hours header and the greyed discretion reason;
   5. OpsStrip, pause badge, Inbox icon;
   6. Company › Team + HeadUnlocked card + Achievements + toast;
   7. OfferModal analyst/slip/jumbo + chips;
   8. Duty/BlockSheet slip lines;
   9. screen hints;
   10. Crew Planning verdict and §V UI strings;
   11. WhatsNew catch-up;
   12. shots.
4. **MAP**: crew-alert banner kind → hotel standby tags (§R.9) → slip marks and selected deadheads → panel copy (§V).
5. Merge order: ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green. The bot runs seeds 1–6 one at a time.

## 17. File ownership

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**`. New: `crew/dayPlan.ts` + `dayPlan.test.ts` (§R), `core/cues.ts`, `ops/heads.ts`, `ops/achievements.ts`, `crew/slip.ts`, `crew/outOfHours.ts` (or inside `control.ts`), their tests, `fixtures/save-v08.lz.txt`, `saveCompat09.test.ts`. Edits: `core/{messages,pause}.ts`, `crew/{roster,control,duties,restPlan,index,hr,sets,standby,calendar,board,rules,timeline,check,rosterActions,morale}.ts`, `contracts/{feasibility,offers,missions,pricing,flavor,plan}.ts`, `ops/{flights,events,maintenance,finance,index}.ts`, `problems/{crew,commercial,index}.ts`, `engine/dev.ts`. `src/data/**`: new `achievements.ts`, `heads.ts`; `glossary.ts`, `whatsNew.ts` (+ test), `names.ts`. `scripts/acmi-bot.ts`. Shared, minimal, additive, first: `core/types.ts` (§10), `core/balance.ts` (§11). May append rows to §V.3 of this doc; updates the "Game:" lines of `docs/acmi/EASA-FTL.md` §§10, 12, 16 when §R is built. | §R engine, §5 engine, §14.1, §T, §U, §W engine, §X data, §Y, cues, bot, saves |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`. `sound.ts` (rewrite), `store.ts` (additive §12), `game/{Modals,Toasts}.tsx`, `shell/{Shell,OpsStrip,opsStripLogic}.ts(x)`, `screens/{Company,Contracts,CrewPlan,Crew,crewLogic,RosterBoard,rosterBoardLogic,Fleet,Inbox,Title,…}.ts(x)`, new `screens/{Team,Achievements}.tsx`, new `screenHints.ts` + `components/ScreenHint.tsx`, `modals/{CrewControlModal,OfferModal,DutyModal,BlockSheet,WhatsNewModal}.tsx`, new `modals/HeadUnlockedModal.tsx`, `components/RestLines.tsx`. `src/styles/**` except map styles: new `styles/acmi/v09.css` imported from `styles/acmi/index.css`. `scripts/ipad-shots.cjs` (new shots). May append rows to §V.3. | §R.8 UI, §5.4–5.6 UI, §14 UI, §S, §T.4, §U UI, §W.3, §X UI, shots |
| **MAP** | `src/ui/map/**`: `MapPanels.tsx` (crew-alert banner kind, slip panel, hotel standby tags §R.9), `LiveLayers.tsx` (selected slip deadheads, crew-change mark), `mapLogic.ts` (+ test: slip mark placement); `src/styles/acmi/map.css`. | §R.9, §T.5, §W.4, map copy for §V |

Interfaces between lanes are §12 only. UI never reads `g.heads`, `g.achievements`, slot `ooh`, `CrewMember.off` or `g.dayPlan` directly (use the views). MAP never decides alert kinds itself (`crewAlertKind` only). Cues flow only ENGINE → `takeCues()` → `sound.event()`; the engine never imports UI.
