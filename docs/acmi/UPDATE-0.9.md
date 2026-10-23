# BLOCK HOURS v0.9 "Experience": design

Plan of record for v0.9, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events allowed, Dubai player, iPad landscape 1180×820 / Safari 1180×750, touch only, calm visuals, 1×/2×/4× only). DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only (side rolls via `sideRng` / `hashUnit`); read APIs pure and added to `core/plumbing.test.ts`; ids via `nextId`;
- money only through `post` / `accrue` / `cashOnly` / `invoice`; flights only through the core helpers;
- `SAVE_VERSION` stays 1; every new field is optional with a `??=` default in its module's `load`, so v0.5.2 … v0.8 saves keep working (new fixture `save-v08.lz.txt`, §13).

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

Calm rules hold: nothing flickers and only aircraft move. Toasts stay rare. Sounds are rate-limited (§S.4). Every new problem gets the four-line card (WHAT · WHY · DOES IT HURT? · WHAT YOU CAN DO). Nothing else is added (§15).

---

## 5. Department heads (F5)

### 5.1 Who they are

| Id | Title | Unlocks when | Salary / month (mid) | Does | Never does |
|---|---|---|---|---|---|
| `opsControl` | Ops Control duty manager | 25 revenue sectors in a row flown with a legal crew (counted from the first contract) | $9K | Answers routine `sickCrew` (call in) and gate `crewShort` decisions where a short delay is the fix, using the player's rules | Sub-charter, cancel, discretion, AOG, airspace, anything over the delay limit |
| `maintPlanner` | Maintenance planner | First C-check completed before it was due | $8K | Books A-checks 3–14 days ahead into maintenance nights and gaps, including line stations on deployment bases; moves a booked A-check when a clash appears; proposes the best C-check slot | Book a C-check, a refit or a check that cancels revenue legs |
| `crewDesk` | Crew scheduling desk | 2 calendar months in a row with ≥ 98 % crew coverage | $14K (two schedulers) | Repairs the roster after disruptions: runs Crew Control fixes on amber flights (auto-fix, deadhead, call-in) within a cost limit; keeps home standby filled; proposes round-up hires | Private jets above the limit, sub-charter, cancel, swaps between contracts |
| `analyst` | Commercial analyst | 5 contracts completed | $9K | Scores every open offer against the fleet and suggests a counter-price | Accept, decline or counter |
| `credit` | Credit controller | The first late government payment collected | $6K | Chases late payers with reminders, answers `latePayment` with Wait or Waive (rule), and asks slow payers for deposits on new charters | Threaten, sell invoices, sue |
| `fleetPlanner` | Fleet & positioning planner | The first widebody joins the fleet | $10K | Proposes ferries home for idle aircraft, pre-positioning before a contract and the fuel-stop and crew-slip plan for long positioning | Sign, buy, lease, sell or ferry above the player's limit |
| `watch` | Watch desk | Reliable reputation reaches 85 | $5K | Runs the player's custom alert and auto-pause rules (§5.6) | Act on anything: it only alerts and pauses |

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
- **Offer card chip** "Analyst 78" and an **OfferModal "Analyst" block**: score pill, verdict ("Take it on CS-TQA: margin about 18 %" / "Counter at $1.24M: they usually accept within 8 % of asking" / "Pass: no aircraft makes money on it"), and **Use $1.24M**, which fills the counter field.

### 5.6 Watch desk rules (custom alerts and auto-pause)
Up to 8 rules, each a row: kind (Seg), value (Stepper), action (**Pause** / **Alert only**), on/off. The kinds:
- **Cash below $X** (default $500K);
- **A flight delayed more than N h** (2);
- **An offer worth more than $X arrives** ($1M);
- **An aircraft idle more than N days** (3);
- **A client drops a level**;
- **A check due in N days with no slot** (10).

The engine checks them hourly (`ops/heads.ts`). The first time a rule triggers for a given subject, it posts one message ("**Your rule: cash below $500K**" — "Cash is $468K after the Condor lease payment.") and either requests `requestPause('rule')` or only alerts (cue `ruleAlert`). It never fires again for the same subject until the condition clears. Mistake: the alert comes up to 1 h late (never missed).

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
| tech | `noOverdue` · A year without an overdue check | 365 days, no check overdue |
| commercial | `fiveFlown` · Five flown | 5 contracts completed → **analyst** |
| commercial | `paidInTheEnd` · They paid in the end | the first late government payment collected → **credit control** |
| commercial | `partner` · Partners | a client reaches Partner |
| commercial | `firstCall` · First call | signed an offer a rival was bidding on |
| commercial | `hajj` · Hajj airlift | a Hajj contract completed |
| commercial | `homeSafe` · Bring them home | an evacuation or repatriation completed |
| commercial | `blueIce` · Blue ice | a landing on an Antarctic ice runway |
| fleet | `widebody` · Widebody | the first widebody joins → **fleet planner** |
| fleet | `queen` · Queen of the Skies | a 747-400 revenue sector flown |
| company | `reliable` · Reliable | Reliable reputation reaches 85 → **watch desk** |
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
- **crewPeople / crewBoard / crewPlan**: "People: limits as fuel gauges." · "Roster board: drag to swap; red is illegal, amber tight." · "Planning: crew sets per type, and Round up hires exactly what completes them."
- **fleet**: "Each card shows the checks, the cabin, the crew rest and the longest legal day. The Market tab sells and leases aircraft: few at a time, long lead times."
- **finance**: "Revenue lands as legs fly; governments pay late. The forecast line is cash, not profit."
- **company / team**: "Reputation, approvals and policies." · "Department heads are earned, not bought: each takes routine work off your desk, makes the odd mistake, and can be switched off."
- **inbox**: "Decisions sit on top. Each problem has a four-line card: what, why, does it hurt, what you can do."
- **crewControl**: "Every way to crew this flight, cheapest and quickest first. The bar shows how late the nearest crew would land."

---

## S. Aviation sound set (UI `src/ui/sound.ts`; cues from ENGINE)

### S.1 How events reach sound
- ENGINE emits **cues**: runtime-only, never saved, collected like pause requests (`core/cues.ts`: `cue(c)`, `takeCues()`, isolated in previews by `isolatePauses`). `pushMessage` and `pushDecision` emit a cue derived from the message (`cueOfMessage`, one table in `core/cues.ts`). Non-message events call `cue()` directly (departure, arrival, a new offer, offer lapsing). The bot and tests ignore cues.
- The UI store calls `takeCues()` after every `advanceTo` and after every action, then `sound.event(cue)`. UI-only events (tap, toggle, error, pause, resume, speed) call `sound.event()` directly.
- **One table** maps each event to exactly one sound: `SOUND_OF: Record<SoundEvent, SoundId>` in `src/ui/sound.ts`. The table below is that table and is its documentation; keep them identical.

### S.2 The sounds
All are synthesised with WebAudio. Bells are sine partials 1× (1.0), 2× (0.18, decaying twice as fast) and 3× (0.06, three times as fast), plus a 1× triangle (0.08) and a second voice detuned by +2 cents. The attack is 4 ms, followed by an exponential decay (τ 0.45 s high / 0.6 s low, −60 dB by about 1.8 s). A shared room reverb (a `ConvolverNode` with a generated 1.2 s stereo noise impulse, wet 0.12) is built once. The chain is: per-category `GainNode` → master gain → `DynamicsCompressor` (−18 dB, ratio 3) → destination. There are no square or saw waves and nothing harsh.

| SoundId | Category | What it is |
|---|---|---|
| `tap` | ui | soft click: 1.6 kHz sine 25 ms plus a 6 ms filtered-noise tick, gain 0.04 |
| `toggle` | ui | two ticks 40 ms apart (rising for on, falling for off) |
| `error` | ui | low soft "dunk": 196 Hz triangle, 120 ms |
| `high` | chimes | single soft bell, A5 880 Hz |
| `low` | chimes | single soft bell like the seat-belt ding, D5 587 Hz, slower decay |
| `ding` | chimes | cockpit-style single ding, D6 1175 Hz, short decay (0.35 s) |
| `highLow` | chimes | the classic bing-bong: 880 Hz then F5 698 Hz, 0.55 s apart |
| `highLowSoft` | chimes | the same at −6 dB, 0.7 s apart, longer decay |
| `double` | alerts | `highLow` twice, 0.25 s between pairs (≈ 2.2 s) |
| `triple` | alerts | `highLow` three times (≈ 3.3 s) |
| `alarm` | alerts | the urgent alarm, master-caution style: 3 bursts, each 3 pulses of a C6 + G6 dyad (1047 + 1568 Hz, sine + triangle, low-pass 3.2 kHz), 110 ms on / 70 ms off, 0.6 s between bursts; ≈ 2.3 s total, never looped |
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
| `cashNegative` | cash below zero, the rescue decision | `triple` |
| `evacuation` | an urgent evacuation or repatriation request | `triple` |
| `clientCollapse` | a client drops to Unhappy | `triple` |
| `crewShortage` | CREW SHORTAGE (red stage, 12 h) | `alarm` |
| `crewOutOfHours` | CREW OUT OF HOURS (red stage, or found at departure) | `alarm` |
| `achievement` · `ladder` | an achievement or a ladder step | `achievement` |
| `headUnlocked` · `headHired` | a department head unlocked or hired | `flourish` |

The urgent alarm is used **only** for `crewShortage` and `crewOutOfHours`.

### S.4 Rate limit and merge
- Chimes and alerts go through a 900 ms merge window that starts at the first request. When it closes, the highest-priority sound plays **once**. Priority: `alarm` 100 > `triple` 90 > `double` 80 > `achievement` 70 > `flourish` 65 > `highLow` 60 > `highLowSoft` 55 > `ding` 45 > `high` 40 > `low` 30.
- Cooldown per sound after it plays: `alarm` 20 s (a second flight's red inside 20 s is merged), `triple` 10 s, `double` 6 s, `highLow` 3 s, `ding`/`high` 2.5 s, `low` 2 s. A request in cooldown is dropped, unless it outranks the sound that played.
- UI sounds play at once (not merged), at most one per 50 ms, and are muted while an alert sound plays.
- At 4×, with five arrivals and an offer in one second, only one `highLow` plays.

### S.5 Settings, unlock, platform
- `Settings` (UI store, `load` merges defaults): `sound` (master, default **true**), `volume` (default 0.6 for new installs; kept for old ones), `soundCats: { alerts: true; chimes: true; flights: false; ui: true }`, `ambience: 'off' | 'cabin' | 'terminal'` (default `'off'`). Category gains: alerts 1.0, chimes 0.8, ui 0.5, ambience 0.25.
- **Settings › Sound** section (replaces the two rows): Master on/off, Volume slider, toggles **Alerts** (emergencies and the urgent alarm), **Chimes** (messages, offers, achievements), **Flight chimes** (every departure and landing), **UI clicks**, and a **Ambience** Seg (Off · Cabin · Terminal). **Test sounds** opens a list (inside the settings modal, scrolling): one 56 px row per SoundId with its meaning ("Triple high-low: serious, e.g. airspace closed on an active flight") and a ▶ button.
- **iOS/Safari**: the first `pointerdown` anywhere (capture, once) creates or resumes the `AudioContext` and plays a one-sample silent buffer. Set `navigator.audioSession.type = 'ambient'` when available (Safari 16.4+), so the ringer switch mutes the game and the player's music keeps playing. Suspend the context when the page is hidden and resume it when visible. Nothing plays before that first tap.
- Ambience fades in over 2 s on the game screen and out on the title screen or when switched off.

---

## T. Crew out of hours (ENGINE crew + problems; UI; MAP banner)

### T.1 What it is
**Crew shortage** is a seat with nobody to fill it. **Crew out of hours** is a named pilot or cabin crew member rostered on the flight who has reached a legal limit. The limits (`OohLimit`, from `crew/rules.ts LIMITS` and the FTL checks):
- `fdp`: the day would run over its FDP limit;
- `duty7d` 60 h · `duty14d` 110 h · `duty28d` 190 h · `block28d` 100 h · `blockYear` 900 h · `block12m` 1,000 h;
- `rest`: minimum rest not met;
- `recovery`: no 36 h weekly rest;
- `inflightRest`: the in-flight rest plan no longer works (§Y.1).

### T.2 Data and detection
```ts
export type OohLimit = 'fdp' | 'duty7d' | 'duty14d' | 'duty28d' | 'block28d' | 'blockYear' | 'block12m' | 'rest' | 'recovery' | 'inflightRest';
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
- **Offer titles never contain the client name** (`contracts/flavor.ts` title templates). The client is shown separately and `jobName` adds it once. This fixes "Corendon's Winter sun to Corfu for Corendon".
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
| Longest-day popover | (§U.2) | (§U.2) |

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
- `bestSlip` tries each tech stop as the cut and keeps the cut where both halves are flyable. It ranks cuts by the fewest pilots needed (basic > ext > aug1 > aug2), then the most FDP margin, then the cheapest tickets (`ticketPrice` from the nearest deadhead origin: home base, or the deployment base). At most **one slip per sector**: if no single cut works → `null` (the chain stays impossible).
- **Roster**: `duties.ts slipUnits` uses `bestSlip`'s cut instead of cutting at every sector boundary, so planning and pricing agree. The deadheads and hotel come from the existing deadhead/rest code. The new duty records the stop (`Duty.slipAt?: string`).
- **Feasibility** (`restNeed`): a chain with mode `none` and a `SlipPlan` gives a line at level `warn`: "**Crew change at IST (fresh crew flies in)**", detail "A second crew flies to Istanbul by airline the day before and rests; it takes over IST–SIN. The first crew rests in Istanbul and flies home. Tickets and hotel about $21K, priced in."
- **Pricing** (`offers.ts` draft costs): each slip adds `2 × crewN` one-way tickets (`tickets`), `crewN × 1` room nights (2 when the slip crew must wait for a second rest), and per diem for the extra crew-days. Charter prices include it; on wet contracts the client pays the tickets and hotels, as today.
- **Offer generation**: `crewCanFly` accepts a chain with a `SlipPlan`, so the v0.8 "no impossible offers" rule counts a slip as a valid plan. `ContractOffer.slip?: { at: string[]; cost: number }` drives the card chip "Crew change at IST".
- **Crew planning**: sets needed for the contract +1 per slipping sector in flight at the same time (`crewAvailability` gets `extraSets`).
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
  2. if the cabin crew's FDP overrun is the only problem and `discretionCheck` is ok → discretion applies (unforeseen, after report) with the usual note;
  3. else the flight is **held** and becomes **crew out of hours** with limit `inflightRest`: red at once, alarm, pause `crewHours`, and a Crew Control gate decision (fresh crew / delay to the next legal plan / sub-charter / cancel).
- No departure with an impossible rest plan: the bot target stays "0 duties flown with an impossible rest plan".
- Test: an augmented 777 duty where a 2:30 delay after report makes the cabin crew rest impossible → re-plan fails → out-of-hours alert, flight held, never departs illegally.

### Y.2 747-400 economics (ENGINE `missions.ts`, `offers.ts`, `pricing.ts`)
- Today the bot loses about 20 % on general work with a 747. The cause: offers are priced on the cheapest reference type that fits (a 767/A330 rate of $6.4–7.2K a block hour) while the 747 costs $3K maintenance a block hour, $90K insurance a month and 13 cabin crew.
- **Jumbo loads.** Hajj, troop and UN rotations, evacuation, repatriation and full charters (sports fans, pilgrimages) generate 420–480 passengers (`minSeats`, all-economy) in 20 % of their widebody offers. That rises to 35 % when our fleet has a 747 idle in the window (gap-fit), and to 0 % when neither we nor a rival operates a 400-seat type. With `minSeats ≥ 420`, `referenceType` resolves to a 400-seat type (777-300ER or 747-400), so the rate is about $10–11K a block hour.
- **Fuel at cost** on jumbo charters: `Product.fuelAtCost?: true` bills fuel after flying at the actual burn of the aircraft that flew (many government and Hajj charters work this way). The price shows "plus fuel at cost". Ledger: `otherRevenue` "Fuel re-billed".
- No change to the 747's costs or to general offers: on 300-seat work it stays a poor choice.
- Targets (tests and bot):
  - a 747-400 on a 450-pax Hajj offer estimates ≥ +15 % margin;
  - the same aircraft on a 300-seat A330-referenced season base ≤ +3 %;
  - a bot with a 747 picks jumbo loads for it and ends the year with the 747's contribution ≥ 0;
  - the share of jumbo-load offers stays ≤ 12 % of widebody offers.
- Chip "Jumbo load · 450 seats". Achievement `queen`.

### Y.3 Bot runtime
Today: seed 1 runs in 28.9 s (target 12 s). Profile with `node --cpu-prof` through `tsx` and fix only the cheap hot spots, for example:
- `feasibility` per open offer × aircraft at each 6 h step (cache per offer per day: `quick` first, full only for the best two);
- `idleWindows` (memoise per day and fleet revision);
- `crewChains` / `dutyNeed` repeated per offer (memoise by chain key).

Report before and after per seed. The hard limit is ≤ 20 s with the v0.9 systems.

---

## 9. What's new v0.9 "Experience" (ENGINE `data/whatsNew.ts`, player words)
Features:
1. Department heads: earn them by flying well, then hire one. An Ops Control duty manager, a maintenance planner, a crew scheduling desk, a commercial analyst, credit control, a fleet planner and a watch desk for your own alerts. Each takes routine work off your desk, makes the odd mistake, and never decides the big things.
2. Achievements: 24 milestones on the Company screen, with a quiet note when you earn one.
3. Sound: real cabin chimes. A high chime for news, a low chime for calm moments, the high-low bing-bong for a new contract, double for a problem that needs you soon, triple for a serious one, and one urgent alarm for crew shortage and crew out of hours. Settings has a volume, categories and a test list.
4. Crew out of hours: its own alert when a pilot or flight attendant reaches a legal limit, naming who, which limit and by how much, with the fixes.
5. Crew change at a fuel stop: a long one-way flight can now split with a fresh crew flown in to the tech stop, priced into the offer and planned by the roster.
6. First-time hints on each screen, written for people who know the job.

Improvements:
- Captain's discretion is never planned: it only appears after the crew has reported, for something unforeseen, and the longest day says so.
- Shorter, plainer texts across the game.
- A delay after the crew has reported now re-checks the in-flight rest at departure.
- 747-400s get jumbo loads (420+ seats) with fuel at cost, so a well-chosen Hajj or troop job pays.

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
- `data`: `achievements.ts`, `heads.ts` (`HEAD_DEFS`: title, icon, does[], never[], unlockText, salary), `glossary.ts` (+ `outOfHours`, `slipCrew`, `departmentHead`, `jumboLoad`, `fuelAtCost`; rewrites `longestDay`, `discretion`), `whatsNew.ts`.

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
**MAP reads** `crewAlertKind`, `outOfHours`, `slipsOfAircraft`, `slipOfFlight`. MAP exports nothing new to UI.

## 13. Bot (`scripts/acmi-bot.ts`, ENGINE)
New rules:
- **Heads**: hire the mid candidate when unlocked and cash ≥ $1M (else the junior); rules stay at their defaults; accept `ferryHome` proposals under $60K and `cSlot` proposals; never fire anyone.
- **Crew out of hours**: handled like shortages in `crewControlPolicy`. Discretion only through `discretionCheck`.
- **Slips**: accept slip offers by margin like any offer.
- **747**: prefer jumbo loads for an idle 747; never sign general work with it below a +5 % estimated margin.
- **Speed**: §Y.3.
- **Printed** (new line): `v0.9: heads unlocked opsControl d18 maintPlanner – crewDesk d96 … · hired N · handled N (mistakes N, overridden 0) · achievements N/24 · slips N (offers N) · out of hours red N amber N · discretion used N (planned 0) refused N · jumbo loads N (747 margin X %) · runtime s`.
- **Targets** (seeds 1–6, one at a time, 365 days):
  - every v0.8 hard target (0 illegal duties, 0 impossible rest plans flown, ≤ 0.3 % uncovered, margin band, morale and resignations);
  - **0 discretion uses with `plannedFdp > maxFdp` and 0 before report**;
  - ≥ 3 heads unlocked on every seed and ≥ 5 on 3 seeds;
  - heads take ≥ 40 % of the routine decisions;
  - achievements 6–14 per seed;
  - ≥ 1 slip offer seen on every seed with a widebody;
  - runtime ≤ 20 s (goal 12 s).

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
- `core/plumbing.test.ts` purity: `headsView`, `headView`, `analystView`, `achievementsView`, `crewAlertKind`, `outOfHours`, `discretionCheck`, `bestSlip`, `slipOfFlight`, `slipsOfAircraft`, `whatsNewToShow`, `longestDay`.

**UI acceptance** (`scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch). New shots:
- `company-team`, `company-team-locked`, `head-unlocked-card`, `company-achievements`, `achievement-toast`;
- `offer-analyst`, `offer-slip`, `offer-jumbo`;
- `crew-control-out-of-hours`, `crew-control-discretion-greyed`;
- `inbox-crew-hours`, `opsstrip-hours`, `settings-sound`, `settings-test-sounds`;
- `screen-hint-contracts`, `whats-new-catchup`, `fleet-longest-day-popover`, `crewplan-verdict`.

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

## 16. Order of work inside each lane
1. **ENGINE step 0**:
   - dump `save-v08.lz.txt` before any change;
   - §10 types and §11 BAL;
   - `core/cues.ts` with `takeCues`;
   - stubs for every §12 export (views return locked heads, `[]` or `null`; `crewAlertKind` maps `missing → 'short'`, `illegal → 'hours'`; `whatsNewToShow` real);
   - tsc/vitest/build green.

   UI and MAP start against the stubs.
2. **ENGINE**:
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
4. **MAP**: crew-alert banner kind → slip marks and selected deadheads → panel copy (§V).
5. Merge order: ENGINE → UI → MAP. Each merge keeps `npx tsc --noEmit`, `npx vitest run` and `npx vite build` green. The bot runs seeds 1–6 one at a time.

## 17. File ownership

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**`. New: `core/cues.ts`, `ops/heads.ts`, `ops/achievements.ts`, `crew/slip.ts`, `crew/outOfHours.ts` (or inside `control.ts`), their tests, `fixtures/save-v08.lz.txt`, `saveCompat09.test.ts`. Edits: `core/{messages,pause}.ts`, `crew/{roster,control,duties,restPlan,index,hr,sets}.ts`, `contracts/{feasibility,offers,missions,pricing,flavor,plan}.ts`, `ops/{flights,events,maintenance,finance,index}.ts`, `problems/{crew,commercial,index}.ts`, `engine/dev.ts`. `src/data/**`: new `achievements.ts`, `heads.ts`; `glossary.ts`, `whatsNew.ts` (+ test), `names.ts`. `scripts/acmi-bot.ts`. Shared, minimal, additive, first: `core/types.ts` (§10), `core/balance.ts` (§11). May append rows to §V.3 of this doc. | §5 engine, §14.1, §T, §U, §W engine, §X data, §Y, cues, bot, saves |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`. `sound.ts` (rewrite), `store.ts` (additive §12), `game/{Modals,Toasts}.tsx`, `shell/{Shell,OpsStrip,opsStripLogic}.ts(x)`, `screens/{Company,Contracts,CrewPlan,Fleet,Inbox,Title,…}.tsx`, new `screens/{Team,Achievements}.tsx`, new `screenHints.ts` + `components/ScreenHint.tsx`, `modals/{CrewControlModal,OfferModal,DutyModal,BlockSheet,WhatsNewModal}.tsx`, new `modals/HeadUnlockedModal.tsx`, `components/RestLines.tsx`. `src/styles/**` except map styles: new `styles/acmi/v09.css` imported from `styles/acmi/index.css`. `scripts/ipad-shots.cjs` (new shots). May append rows to §V.3. | §5.4–5.6 UI, §14 UI, §S, §T.4, §U UI, §W.3, §X UI, shots |
| **MAP** | `src/ui/map/**`: `MapPanels.tsx` (crew-alert banner kind, slip panel), `LiveLayers.tsx` (selected slip deadheads, crew-change mark), `mapLogic.ts` (+ test: slip mark placement); `src/styles/acmi/map.css`. | §T.5, §W.4, map copy for §V |

Interfaces between lanes are §12 only. UI never reads `g.heads`, `g.achievements` or slot `ooh` directly (use the views). MAP never decides alert kinds itself (`crewAlertKind` only). Cues flow only ENGINE → `takeCues()` → `sound.event()`; the engine never imports UI.
