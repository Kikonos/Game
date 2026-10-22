# BLOCK HOURS v0.7.3 "In-flight Rest & EASA": design

Plan of record for v0.7.3, written for three lanes that build in parallel: ENGINE, UI and MAP. BRIEF.md "Player decisions" override everything (real names, invented events, Dubai player, iPad landscape 1180×820 / Safari 1180×750, touch only, calm visuals, 1×/2×/4× only). DESIGN.md and BUILD-PLAN.md ground rules hold:
- engine RNG only; read APIs pure (added to `core/plumbing.test.ts`); ids via `nextId`;
- money only through the ledger helpers; flights only through the core helpers;
- `SAVE_VERSION` stays 1, `??=` defaults in each module's `load`, so v0.5.2 … v0.7.2 saves keep working (migrations tested).

**Sources.** The player supplied an EASA FTL reference guide (`notes/.handover/updates/EASA-guide-2026-10.txt`, current 22 Oct 2026; "guide §n" below). **The guide is the authority**: where it and anything else disagree (RESEARCH.md, EASA-FTL.md, UPDATE-0.7.2.md, the code), the guide wins. The read-only audit of the v0.7.2 tree (`notes/.handover/updates/EASA-audit-v0.7.2.md`, "audit §x") lists every parameter as MATCH / WRONG / MISSING; its line numbers are from an earlier commit, so **re-locate before editing**.

The player's words (22 Oct): *"study it and apply it to the game; in-flight rest and the rest classes available on each plane must be a BIG thing; correct any parameters that might be wrong."* Agreed list:

| # | Feature | One line |
|---|---|---|
| 1 | Corrections | Every WRONG parameter and citation fixed; EASA-FTL.md rewritten to match the guide and stays the single reference. |
| 2 | In-flight rest | Separate pilot and cabin crew rest facilities per airframe (class 1/2/3, places); a deterministic rest plan per duty (who rests when, where, how long); seen on the fleet card, market, aircraft art, flight sheet, duty modal, offer modal and roster board; cards, glossary, refits, contracts. |
| 3 | Missing rules | Planned extension, delayed reporting, disruptive schedules (early type), 2 local days twice a month, time-zone recovery, split duty, home standby for the call-in fix; each tested, explained in plain words and respected by the roster. |
| 4 | What's new | A v0.7.3 entry in player words. |

Every new problem gets the v0.7.1 four-line card (WHAT · WHY · DOES IT HURT? · WHAT YOU CAN DO) and glossary terms (§2.8). Calm rules hold: nothing flickers, only aircraft move; the rest timelines are static drawings; top-bar text changes at most once per clock step; one message per event. Nothing else is added (§12).

---

## 1. Corrections (ENGINE; audit §A, §D, Appendix steps 1–2)

### 1.1 Rule changes in code (re-check each against the current tree first)

| # | Rule | Today | v0.7.3 | Where |
|---|---|---|---|---|
| C1 | Cabin crew in-flight rest table (CS FTL.1.205(c)(3)) | an extra 18:01–18:30 row (4:25) | **Table ends at 17:31–18:00 = 3:50.** `cabinFdpCap` → class 1 **18:00**, class 2 **17:00**, class 3 **16:00**. | `crew/rules.ts CABIN_REST`; `ftl.test.ts` (drop the 18:30 row; `cabinInflightRest(18:15, 1) === null`; caps `[1080, 1020, 960]`) |
| C2 | Cabin crew early report vs their table | `maxFdp` cut the pilots' limit by `cabinFdpCap − cabinEarly` | Per duty: **the cabin crew report with the pilots (early 0) when the pilots' augmented limit + the type's early report would exceed the cabin crew's table** for their facility class; only if it still exceeds, the limit is capped. `Duty.cabinEarly` (§5). So 4 pilots + class 1 + one long sector stays **18:00** (cabin crew report with the pilots). | `crew/duties.ts`, `crew/timeline.ts cabinEarly*` |
| C3 | Commander's discretion (ORO.FTL.205(f)) | Crew Control and the gate decision offer it before report; texts say "two hours" | Offered **only when the crew have reported** (`d.report <= g.now`) and the duty is over its limit (unforeseen, at or after report). Before report the option reads disabled: "Only after the crew have reported: for a planned day use a fresh crew, a delay or an augmented crew". Every text: **"up to 2 h (3 h with an augmented crew)"**. Base = the basic FDP after a planned extension (`d.basicFdp + 2 h`), the augmented or split maximum otherwise. Rest after: never reduced (≥ 10 h is respected by construction). Over 1 h → one inbox note "Discretion report filed" (§3.8). | `crew/control.ts` (FIX_DESC, solution f.), `ops/events.ts crewShortDecision`, `data/glossary.ts discretion`, `crew/roster.ts applyDiscretion` |
| C4 | Rest after an augmented FDP (CS FTL.1.205(c)(6)) | 14 h only away | **≥ preceding duty or 14 h wherever the crew rests** (home too). `minRest`: `if (i.augmented \|\| (!i.atHome && i.tzShift >= 4)) base = 14 h`. | `crew/rules.ts minRest` + test |
| C5 | Sectors per FDP | `MAX_SECTORS` declared, never enforced | `partition()` and `maxFdp` refuse more than 10 sectors (`ok:false`). | `crew/duties.ts`, `rules.ts` |
| C6 | Consecutive night duties (CS FTL.1.205(a)(1)) | not enforced | The planner never builds a night duty (encroaching 02:00–04:59 reference time) with more than 4 sectors (simplified-safe: applies to every night duty); `evalSegs` flags a crew member's second consecutive night duty with > 4 sectors (`'nightSectors'`, illegal) for manual assignments. | `duties.ts partition`, `rules.ts evalSegs` |
| C7 | Contract feasibility | flat 13 h unaugmented, any rest class OK | Real `maxFdp` at each long chain's **report time and sectors** (Table 2), then planned extension / split duty, then augmentation **with this airframe's pilot and cabin crew facilities and the rest plan** (§2.9). | `contracts/feasibility.ts`, `contracts/plan.ts` |
| C8 | Rest facility fallback | `restClassAt` returns a hard 1 for a type with any class | Replaced by `restOf(g, id)` (§2.1); the type value is only the migration default. | `crew/crewRest.ts` |
| C9 | "Crew rest seats = last economy row, class 3" | plain economy row counted as class 3 | **A plain economy seat is not a rest facility.** Class 3 = crew rest recliners with leg rests (§2.10). v0.7.2 rest seats migrate to recliners (grandfathered; §2.1). | `crewRest.ts`, `ops/cabin.ts`, glossary |
| C10 | Disruptive schedules | "touches 23:00–06:00" | Kept as **early type** for every base (documented choice, §3.3), split into `early / late / night` kinds. WOCL (02:00–05:59) is a separate constant from night duty (02:00–04:59). | `rules.ts` |

### 1.2 Citations and names (code comments, docs)
- CS FTL.1 = **ED Decision 2014/002/R**, amended by **ED Decision 2023/023/R** (night duties and late finishes; CS-FTL.1 Issue 1, Amendment 1). Never "2014/024/R".
- **Table 1** = acclimatisation (ORO.FTL.105(1)); **Table 2** = basic max FDP, acclimatised (ORO.FTL.205(b)(1)); **Table 3** = unknown state (b)(2); **Table 4** = unknown state with FRM (b)(3), not used. `rules.ts` comments at `FDP_BANDS`, `FDP_UNKNOWN`, `baseFdp`, `maxFdp` renamed accordingly.
- Planned extension = ORO.FTL.205(d) + **CS FTL.1.205(b)** (its table). In-flight rest = ORO.FTL.205(e) + **CS FTL.1.205(c)**: classes and conditions (c)(1), (c)(5)–(7); augmented table (c)(2)(i)/(ii); cabin crew table (c)(3); long-sector bonus (c)(4); destination rest (c)(6). Delayed reporting = ORO.FTL.205(g) + CS FTL.1.205(d). Consecutive nights = CS FTL.1.205(a)(1).
- Disruptive schedules = **CS FTL.1.235(a)**; time zones = **CS FTL.1.235(b)(3)(i)** (home table), (b)(3)(ii) (14 h away), (b)(4) (alternating E/W).
- Positioning = **ORO.FTL.215** (220 is split duty). Days off 7 a month / 96 a year = **Directive 2000/79/EC** (not ORO.FTL.235(e); 235(e)(3) is the home-base-change 72 h recovery).
- Remove "sectors after the WOCL may be limited" from the discretion text.
- `UPDATE-0.7.2.md` gets one errata line under its title: "v0.7.3: several citations and the cabin rest table here were corrected; EASA-FTL.md is the reference." RESEARCH.md §5.1 gets the same one-line note (its F3 table already ends at 18:00).

### 1.3 EASA-FTL.md rewritten (ENGINE, first task)
Plain markdown, ≤ 450 lines, the single crew-rules reference, following the guide's structure. Each section cites the article and ends with a **Game** line (implemented / simplified / not modelled). Sections:
0. Status and sources (Reg. (EU) 965/2012 Annex III Subpart FTL as amended by 83/2014; CS FTL.1 ED Decision 2014/002/R + 2023/023/R; Easy Access Rules Rev. 24; the player's guide as the authority; operator IFTSS / OM-A ch. 7 caveat; the 2028 air-taxi rules are not in force; UAE GCAA rules differ and are not modelled).
1. Definitions (ORO.FTL.105): acclimatised (Table 1), reference time, WOCL 02:00–05:59 vs night duty 02:00–04:59, local night, local day, disruptive schedule (early type chosen), FDP, duty, rest facility, standby / reserve, augmented crew, rotation.
2. Max daily FDP: Table 2 (all 13 bands × 1–10 sectors), Table 3, Table 4 (not used), cabin crew ORO.FTL.205(c) (+ reporting difference ≤ 1 h), consecutive nights (≤ 4 sectors), the 16 h ceiling for basic and extended-without-rest FDPs (EASA FAQ).
3. Planned extension: the full CS FTL.1.205(b) table incl. 3/4/5-sector columns and "not allowed" cells; conditions (§3.1).
4. In-flight rest: classes 1/2/3 as the guide words them; augmented table; bonus; conditions incl. 90/120 min and "cruise too short → no extension"; cabin crew table ending 18:00 and the CAP 1265 note; the game's facilities and rest plan (§2).
5. Commander's discretion (at or after report; +2 h / +3 h; basic base after an extension; rest ≥ 10 h; report > 1 h within 28 days).
6. Delayed reporting (CS FTL.1.205(d) table).
7. Cumulative limits (ORO.FTL.210) and what counts (positioning 100 %, airport standby 100 %, other standby 25 %, reserve 0, in-flight rest 100 %).
8. Positioning (ORO.FTL.215).
9. Split duty (CS FTL.1.220 incl. the break → increase table).
10. Standby and reserve (CS FTL.1.225 / 1.230).
11. Rest (ORO.FTL.235): home / away / after extension / after augmented / after discretion; reduced rest (FRM only, not used); recurrent extended recovery (36 h + 2 local nights, ≤ 168 h, 2 local days twice a month); disruptive (CS FTL.1.235(a)); time zones (CS FTL.1.235(b)).
12. Days off (Directive 2000/79/EC) and the company's 6-on/2-off work block (**company policy, not EASA**).
13. Records, roster publication 14 days ahead.
14. "How BLOCK HOURS applies it": rule → article → symbol → test name (every row of this design).
15. Not modelled: Table 4 / FRM, reduced rest, hotel transfer > 30 min (AMC1 ORO.FTL.235(b)), second notification of a delay, ORO.FTL.110(j) robustness, the three night subtypes (appropriate FRM), reserve, Subpart Q / GCAA / FAA.

---

## 2. In-flight rest: a big, visible feature

### 2.1 Data: pilot and cabin crew rest facilities per airframe (ENGINE `data/acmiTypes.ts`, `crew/crewRest.ts`, `ops/market.ts`, `ops/index.ts` load)

```ts
// core/types.ts (v0.7.3)
export type RestKind = 'fcrc' | 'ccrc' | 'ldmcr' | 'jSeats' | 'recliners';
/** One in-flight rest facility (CS FTL.1.205(c)): class, kind and how many crew can rest in it at once. */
export interface RestFacility { cls: 1 | 2 | 3; kind: RestKind; places: number }
/** Pilots' (fc) and cabin crew's (cc) facilities; null = none. Both may be the same seats (jSeats / recliners). */
export interface AcRest { fc: RestFacility | null; cc: RestFacility | null }
// Aircraft: rest?: AcRest   (load: ??= migrateRest(ac)); crewRest? kept, @deprecated v0.7.3 (read once by the migration)
// AircraftOffer: rest?: AcRest (rolled at creation; old open offers: ??= migrateRest)
```

| Kind | Player words | Class | Typical places |
|---|---|---|---|
| `fcrc` | "pilots' bunks by the cockpit" (flight crew rest compartment) | 1 | 2 |
| `ccrc` | "overhead bunks" / on the A380 "lower-deck bunks" (cabin crew rest compartment) | 1 | 6–14 |
| `ldmcr` | "lower-deck crew rest module" (A330/A340 module in the aft hold; the 767's lower-lobe rest) | 1 | 6–8 |
| `jSeats` | "business seats, curtained off" (≥ 45°, ≥ 55 in pitch, ≥ 20 in wide, leg rest, curtain) | 2 | pilots 2; cabin crew min(J − 2, ⌈N/2⌉) |
| `recliners` | "crew rest recliners" (≥ 40°, leg and foot support, curtain, not next to passengers) | 3 | §2.10 |

A plain economy row is **not** a facility (C9). Premium economy seats are not used (pitch < 55 in).

**Per-type data** (`AcmiType.rest`, replaces `bunkShare`; `restClass` stays as "a class 1 compartment exists for this type"). Shares are estimates for the ACMI/charter used market (audit §B2):

| Type | FCRC share (2 bunks) | Cabin crew compartment share · kind · bunks | J curtained share (no compartment) | J class | Recliner refit | LDMCR refit | MRO refit with a C-check |
|---|---|---|---|---|---|---|---|
| A320ceo, 737-800, A321ceo | 0 | 0 | 0 | – | no (sectors fit 13 h) | – | – |
| A321neo (LR), 757-200 | 0 | 0 | 0 | 3 | 1 row → 3 (fc 1, cc 2) | – | – |
| 767-300ER | 0.25 | 0.15 · ldmcr · 6 | 0.7 | 2 | 2 rows → 6 (fc 2, cc 4) | – | FCRC |
| A330-200 | 0.45 | 0.40 · ldmcr · 7 | 0.7 | 2 | 2 rows → 7 (fc 2, cc 5) | yes | FCRC |
| A330-300 | 0.35 | 0.30 · ldmcr · 7 | 0.7 | 2 | 2 rows → 7 | yes | FCRC |
| A340-300 | 0.80 | 0.75 · ldmcr · 8 | 0.7 | 2 | 2 rows → 7 | yes | FCRC |
| 777-200ER | 0.90 | 0.85 · ccrc · 8 | 0.7 | 2 | 2 rows → 9 | – | overhead |
| 777-300ER | 1 | 0.95 · ccrc · 10 | 0.7 | 2 | 2 rows → 9 | – | overhead |
| 777-200LR | 1 | 1 · ccrc · 8 | – | 2 | – | – | – |
| 787-9 | 1 | 0.90 · ccrc · 6 | 0.7 | 2 | 2 rows → 8 | – | overhead |
| A350-900 | 1 | 0.90 · ccrc · 8 | 0.7 | 2 | 2 rows → 8 | – | overhead |
| A350-900ULR | 1 | 1 · ccrc · 8 | – | 2 | – | – | – |
| A380-800 | 1 | 1 · ccrc (lower deck) · 14 | – | 2 | – | – | – |
| 747-400 | 1 (upper deck) | 0.90 · ccrc · 10 | 0.7 | 2 | 2 rows → 9 | – | overhead |

```ts
// data/acmiTypes.ts
export interface TypeRest {
  fcrcShare: number; ccrcShare: number; ccrcKind: 'ccrc' | 'ldmcr'; ccrcPlaces: number;
  /** Share of airframes without a compartment whose business seats come curtained for crew rest. */ jCurtainShare: number;
  jClass: 2 | 3;
  recliners: { rowsLost: number; places: number; fc: number } | null;
  ldmcr: boolean; mro: 'fcrc' | 'overhead' | null;
}
// AcmiType gains rest: TypeRest   (bunkShare removed; the bot and market read rest)
```

**Market roll** (`ops/market.ts makeOffer`, the offer's side RNG, rolled once, copied on acquisition): `fc = chance(fcrcShare) ? {1,'fcrc',2} : null`; `cc = chance(ccrcShare) ? {1, ccrcKind, ccrcPlaces} : null` (independent rolls); then, for a side still null on a cabin with `j ≥ 4`: with `jCurtainShare` it is `{jClass, 'jSeats', places}` (pilots 2; cabin crew `min(j − 2, ⌈cabinTypical/2⌉)`), else null. New-game and dev fleets: the same roll from `hashUnit(id)` (deterministic), widebodies only.

**Migration** (`migrateRest(ac)`, idempotent, in the ops module `load`, also used for `AircraftOffer`):

| v0.7.2 `crewRest` | → `rest` |
|---|---|
| `{bunks: true}` | `fc = {1,'fcrc',2}`, `cc = {1, ccrcKind, ccrcPlaces}` (type defaults; a 767 gets `ldmcr` 6) |
| `{bunks: false, seats: n > 0}` | grandfathered recliners: `fc = {3,'recliners', min(2, n)}`, `cc = {3,'recliners', max(1, n − 2)}`; cabin unchanged |
| `{bunks: false, seats: 0}`, cabin `j ≥ 4` | `fc = {2,'jSeats',2}`, `cc = {2,'jSeats', min(j − 2, ⌈cabinTypical/2⌉)}` |
| `{bunks: false, seats: 0}`, no J | `{ fc: null, cc: null }` |
| absent (older saves, start fleet) | as `defaultCrewRest` today: widebody with a type class → as `{bunks: true}`; else none |

**Grandfathering.** At load, every duty already **crewed** and reporting within 72 h of the load time gets `legacyRest: true`: `syncDuty` keeps its augmentation without the rest-plan check (§2.3) so nothing an old save relies on turns illegal on load. Every later duty is planned under the new rules (the roster re-plans uncrewed pairings as usual). Old saves only gain options (J seats become class 2 where the cabin has J).

**Cabin refits** (v0.7 `bookRefit`): at the end, a side whose facility is `jSeats` is recomputed from the new cabin (all-economy → null; J ≥ 4 → curtained jSeats, part of the refit); recliners lose their row count only via §2.10.

### 2.2 The rest plan (ENGINE new `crew/restPlan.ts`, pure)

```ts
export interface RestLeg { id: string; std: Minute; sta: Minute }   // operated legs of one duty, in order
export type RestSeat = 'CPT' | 'FO' | 'CRP' | 'CPT2' | 'FO2';
export interface RestTurn {
  seat?: RestSeat;               // pilots
  group?: number;                // cabin crew: group index (A, B, C…)
  n: number;                     // crew in this turn (1 pilot; a cabin group's size)
  crewIds: string[];             // filled when rostered (pilot by seat; cabin crew in slot order), else []
  flightId: string; start: Minute; end: Minute;
  need: number;                  // the legal minimum (90 / 120 / the cabin table)
  where: RestKind; cls: 1 | 2 | 3;
  landing?: boolean;             // a landing pilot of the last sector
}
export interface RestPlan {
  ok: boolean;
  code: 'ok' | 'noFacility' | 'sectors' | 'tooShort' | 'cabinClass' | 'cabinFit';
  why: string | null;            // plain words (see below)
  augment: 1 | 2;
  pilots: RestTurn[]; cabin: RestTurn[];
  cabinFdp: number;              // pilots' FDP + this duty's cabinEarly
  cabinNeed: number | null;      // CS FTL.1.205(c)(3) minutes per cabin crew member (null = class not allowed)
  band: string | null;           // '15:31–16:00'
  extraCabin: 0 | 1 | 2;         // cabin crew added so everyone can rest
  blocked: Record<string, number>;   // flightId → seats out of sale (seat-based facilities used on that leg)
  spareMin: number;              // smallest slack of any turn (verdict: ≥ 30 OK, < 30 tight)
  cruise: { flightId: string; from: Minute; to: Minute; cabinFrom: Minute; cabinTo: Minute }[];
}
/** Core, no GameState: the plan for these legs, facilities, augmentation, cabin FDP and cabin crew count. */
export function planRest(legs: RestLeg[], rest: AcRest, augment: 1 | 2, cabinFdp: number, cabinN: number): RestPlan;
/** For a duty (its augment, or opts.augment to try one): names filled from its pairing's slots. null when unaugmented and no opts. */
export function restPlan(g: GameState, dutyId: string, opts?: { augment?: 1 | 2 }): RestPlan | null;
export function restPlanForFlight(g: GameState, flightId: string): RestPlan | null;     // the duty's plan
export function restNow(g: GameState, aircraftId: string, t: Minute): { names: string[]; where: RestKind; until: Minute }[];  // map panel
```

**Algorithm** (deterministic, O(legs × turns); numbers in `BAL.v073.rest`):
1. **Windows per leg.** Cruise = `[std + 40, sta − 40]` (taxi out + climb; descent + taxi in). Pilots may rest in `[std + 40, sta − 70]` (30 min awake before top of descent). Cabin crew may rest in `[std + 105, sta − 70]`: no rest during the first service (90 min after take-off) or the last 60 min (pre-landing service, cabin secured). No rest on a leg shorter than the smallest turn.
2. **Pilots** (CS FTL.1.205(c)(1)). At most 3 sectors (else `sectors`). Pilots = 2 + augment; **landing pilots** = the CPT and FO (or CPT2 and FO2 with 4) who land the last sector; each needs **120 consecutive min**, every other pilot **90**. Pilots resting at once = `min(fc.places, augment)` (two stay at the controls). Turns: 3 pilots → CRP, then FO, then CPT (one at a time); 4 pilots with 2 places → the relief pair (90), then the landing pair (120); 4 pilots with 1 place → 4 single turns. Place the turns **from the last leg backwards** (landing pilots last, ending at the leg's pilot window end, which "optimises landing-pilot alertness", GM); a turn must fit in one leg's window; a turn that fits nowhere → `tooShort`. Then share each leg's spare time evenly over its turns (rounded down to 5 min), so the plan shows real rest lengths (a 12 h sector with 3 pilots: about 3:20 each), not only the minimum. No `fc` → `noFacility`.
3. **Cabin crew** (CS FTL.1.205(c)(3)). `cabinNeed = cabinInflightRest(cabinFdp, cc.cls)`; null → `cabinClass` ("Class 3 recliners allow at most a 16 h cabin crew day; this one is 16:15"). At most `s = min(cc.places, ⌊N/2⌋)` rest at once (**half the cabin crew stay in the cabin**, game rule after CAP 1265's "service requirements"; N includes the purser). Groups `G = ⌈N / s⌉` of near-equal size, one after another, each `cabinNeed` consecutive minutes inside one leg's cabin window, packed from the longest window; spare shared evenly. Not fitting → try `N + 1`, `N + 2` (`extraCabin`); still not → `cabinFit`. No `cc` → `noFacility`.
4. **Seats.** `blocked[flightId]` = places of every `jSeats` / `recliners` facility with a turn on that leg (pilots' and cabin crew's facilities counted once each). Legs without a turn block nothing.
5. **why** texts (plain): `noFacility` "CS-TQB has no rest for the {pilots|cabin crew}"; `sectors` "In-flight rest allows at most 3 sectors; this day has 4"; `tooShort` "The cruise on AWQ315 is 2:10; the landing pilots each need 2 hours in a row"; `cabinClass` as above; `cabinFit` "9 cabin crew with 4 business seats can't all get 2:20 rest in the 6:30 of cruise".

`N` = the legal cabin minimum + the client's required extra (`complement` without optional extras); optional extras ride along and are not needed for the plan.

### 2.3 Planning duties with it (ENGINE `crew/duties.ts`, `core/perf.ts`, `crew/extraSeats.ts`)

`pickAugment` becomes **`pickPlan`**: the first option that is legal, in this order, each tried only when allowed:

| Option | Allowed when | Max FDP |
|---|---|---|
| `basic` | always | Table 2 (acclimatised) or Table 3 (X), −0:30/sector from the 3rd, floor 9:00 |
| `split` | a single unit (§3.6), ≤ 16:00 | basic + 50 % of the net break |
| `ext` | a single unit, planning only, acclimatised, `extAllowed` (§3.1) | the CS FTL.1.205(b) cell |
| `aug1` / `aug2` | `augmented` approval, `fc` and `cc` present, ≤ 3 sectors, **`planRest(...).ok`** (or `legacyRest`) | `AUG_FDP[a][fc.cls]` (+1:00 bonus), capped by the cabin crew table for `cc.cls` (C2), 18:00 |

- `Duty.forceAug = 2` (the player's "fly it with 4 pilots", §2.8) skips `aug1`.
- The partition DP keeps "fewest duties, then least augmentation, then most slack", with the augmentation cost `basic 0 < split 0.25 < ext 0.5 < aug1 1 < aug2 2`. **`split` and `ext` are tried only for a single unit** (`i === j − 1` in `partition`, and in `slipUnits` fits): they rescue a long out-and-back or a long outstation wait; they never merge two units into a longer day.
- `syncDuty` re-measures with the same order, but **never adds `ext` after planning** (keeps it if still legal, drops it otherwise) and never re-plans a reported duty's mode.
- Stored on the duty: `augment`, `ext`, `split`, `basicFdp`, `cabinEarly`, `restExtra` (`plan.extraCabin`), `maxFdp`.
- **Complement:** `complement(typeId, seats, { augment, extraCabin, restCabin })`: `restCabin` = the largest `restExtra` of the pairing's duties. The v0.7.2 rule "+1 above 14:30, +2 above 16:00 on class 2/3" and the `fdp`/`restClass` options go. `pairingSeats`, `legalMinimum`, `morale.ts` and feasibility pass `restCabin`.

### 2.4 "Longest day" and the rest lines (ENGINE `crew/restPlan.ts`, pure)

```ts
export interface LongestDay {
  basic: number;                 // 13:00 (best Table 2 cell)
  ext: number | null;            // 14:00 when the type can plan an extension (narrowbody and widebody alike)
  aug1: number | null; aug2: number | null;            // incl. the cabin crew cap and early-report drop (C2)
  aug1Long: number | null; aug2Long: number | null;    // with the one-long-sector bonus
  capBy: 'pilots' | 'cabin' | null;                     // what limits the longest augmented day
  text: string;                  // see below
}
export function longestDay(g: GameState, rest: AcRest, typeId: string): LongestDay;
export function restText(f: RestFacility | null, side: 'fc' | 'cc'): string;   // 'bunks by the cockpit (class 1, 2 bunks)'
export function restOf(g: GameState, aircraftId: string | null): AcRest;          // airframe, migrated; {null,null} when unknown
```
Texts (exact):
- with both facilities: `Longest day: 16 h with 3 pilots · 17 h with 4 (18 h on one long sector)`;
- cabin crew facility limits it: `Longest day: 16 h with 3 or 4 pilots (the cabin crew's recliners allow 16 h)`;
- missing a side or no approval: `Longest day: 13 h (14 h as a planned extension) · no in-flight rest for the cabin crew` / `… · needs the Augmented crew approval`;
- narrowbody: `Longest day: 13 h (14 h as a planned extension)`.
- `restText`: `bunks by the cockpit (class 1, 2 bunks)`, `overhead bunks (class 1, 8 bunks)`, `lower-deck bunks (class 1, 14 bunks)`, `lower-deck crew rest module (class 1, 7 bunks)`, `business seats, curtained (class 2, 4 seats)`, `crew rest recliners (class 3, 3 seats)`, `none`.

### 2.5 Seats taken out of sale (ENGINE `crew/crewRest.ts`)
`restSeatsBlocked(g, flightId)` = `restPlan(g, f.dutyId)?.blocked[flightId] ?? 0` (augmented duties only); `sellableSeats` unchanged in meaning. The v0.7.2 offload at roster time (`BAL.v072.restSeats.offloadPerPax`) and the `restSeats` card stay; their texts name the seats: "4 business seats blocked (class 2 crew rest)". Feasibility's seat check subtracts the largest `blocked` of the programme's augmented chains.

### 2.6 Where the player sees it (UI unless marked MAP)

1. **Fleet card** (`screens/Fleet.tsx`): the v0.7.2 "Crew rest" row is replaced by three KV rows (every type, narrowbodies too):
   - `Pilots rest` · `bunks by the cockpit (class 1, 2 bunks)` with `<Term id="fcrc">`;
   - `Cabin crew rest` · `business seats, curtained (class 2, 4 seats)` with the matching term;
   - `Longest day` · `16 h with 3 pilots · 17 h with 4 (18 h on one long sector)` (the `text` without "Longest day: ").
   - A `Crew rest…` button beside Refit opens the RefitModal on its crew rest section when `restRefitOptions` has any option.
2. **Market listing** (`screens/Market.tsx`): the "Crew rest" chip becomes two lines under the terms: `Pilots rest: bunks (class 1) · Cabin crew rest: lower-deck module (class 1)` and the longest-day line (tiny, muted). A **"Has bunks"** filter chip in the Market header (44 px, local component state): shows offers with any class 1 facility. AcquireModal shows the same two lines.
3. **Aircraft art** (MAP, `components/aircraft/`): a small **static bunk glyph** where the compartment really is (§2.12), a tinted seat block for curtained business seats, a small seat glyph for recliners. Passed as `rest` to `AircraftArt` on the Fleet card, Market listing and AcquireModal. No animation, no hover state.
4. **Flight sheet** (`modals/BlockSheet.tsx`): a new section **In-flight rest** on any flight of an augmented duty (and, greyed, "No in-flight rest needed: 11:20 of 13:00" on long unaugmented widebody flights):
   - a verdict chip: `Rest plan OK` (good) / `Tight: 10 min spare` (warn) / `Not possible` (bad, with `why`);
   - a calm static timeline (new `components/RestTimeline.tsx`, 100 % width ≈ 380 px in the sheet): one thin bar per leg of the duty from take-off to landing with the cruise band shaded; rows `Pilots` (one row per turn: block + label `Capt. Silva 3:20 · bunk · lands`, `CRP Reis 3:10 · bunk`) and `Cabin crew` (`Group A (4) 2:40 · lower deck`, `Group B (5) 2:40 · lower deck`); times under the bar in UTC and local; 22 px rows; no motion, re-rendered only when the plan changes;
   - the seats line (existing): `Seats 309 · 305 sellable (4 business seats blocked for crew rest)`;
   - unrostered duties show seats (`CPT`, `FO`, `CRP`) instead of names.
5. **Duty modal** (`modals/DutyModal.tsx`): the `FDP x of y` line becomes `Day length 15:20 of 16:00 · Why 16:00?` (a 44 px text button) that expands `fdpWhy` lines (§7): the reason, the alternatives, the cabin crew line, plus extension / split / standby / delay notes. Under it the same `RestTimeline` (collapsed by default, one tap). A **"Fly it with 4 pilots"** toggle when `aug1` is planned or rest is too short (`setDutyAugment`).
6. **Offer modal** (`modals/OfferModal.tsx`): each candidate aircraft's feasibility list has a `rest` line (§2.9) with a `Plan a refit` button when the check carries `action.kind === 'restRefit'` (opens RefitModal `section: 'rest'`, back to the offer). The offer header shows `offerRestLine` under the schedule: `Longest day 15:40 · needs 3 pilots + bunks, or 4 pilots + business seats`.
7. **Roster board** (`screens/RosterBoard.tsx`, `rosterBoardLogic.ts`): augmented duty bars get a small bed icon (lucide `BedDouble`, 12 px) and `3P`/`4P`; extended duties a `+1h` tag; split duties `SPLIT`; standby blocks as a light hatched block labelled `SBY` (calendar kind `standby`). Static.
8. **Crew card** (`screens/Crew.tsx`): the 14-day strip shows `Standby` blocks; nothing else new.
9. **Map aircraft panel** (MAP, `map/MapPanels.tsx`): the "Crew rest: bunks" chip becomes `Rest: pilots bunks · cabin crew business seats`; when airborne on an augmented duty one calm line `Resting: Capt. Silva (bunk) until 14:20` from `restNow`, updated on the clock step only.

### 2.7 Cards (ENGINE `problems/crew.ts` + `problems/index.ts`; UI renders as v0.7.1)

New `ProblemKind`s: `'restFacility' | 'restTooShort' | 'cabinRest'` (`'restSeats'` reworded). Each has a builder, a `HINTS` entry and an Inbox message posted with `postProblem` **once per contract and kind** (restTooShort: once per duty, only inside the 14-day roster horizon).

- **restFacility** (amber), when a duty needs 4 pilots (or extension/split) only because of the facility class:
  - WHAT "AWQ201 LIS–GRU needs a 4th pilot."
  - WHY "CS-TQB has no bunks: its business seats are class 2 rest, which allow 15 h with 3 pilots. The day is 15:40."
  - HURT "A 4th pilot's pay and hotel (about $900 a trip); 2 more business seats blocked."
  - ACTIONS [Use CS-TQA (has bunks) → Schedule with the flight selected] [Plan a crew rest refit → refit modal, rest section] [OK, fly with 4 pilots → dismiss].
- **restTooShort** (red):
  - WHAT "No in-flight rest possible on AWQ315."
  - WHY "The cruise is 3:10; the landing pilots each need 2 hours in a row. Without rest the limit is 13 h; the day is 14:05."
  - HURT "Yes: the roster splits it with a fresh crew at Recife (tickets and a hotel, ~$4K)" / "Yes: no legal crew, 2 legs at risk".
  - ACTIONS [Fly it with 4 pilots → duty modal] (only when 4 pilots fit) [Retime the first leg → Schedule] [Crew Control].
- **cabinRest** (amber):
  - WHAT "AWQ101 needs 2 more cabin crew."
  - WHY "On a 16:10 day with class 2 seats each flight attendant needs 3:00 rest. With 9 crew and half of them in the cabin, the cruise only fits if 11 fly."
  - HURT "2 × per diem and hotel (about $600 a trip)."
  - ACTIONS [Swap to an aircraft with bunks → Schedule] [Plan a lower-deck module → refit modal] [OK → dismiss].
- **restSeats** (kept): "AWQ101 can sell 305 of 309 seats" · "The 15 h day needs in-flight rest; 4 business seats are curtained off as class 2 crew rest" · HURT as v0.7.2 · ACTIONS [Swap aircraft] [Plan crew rest].

Legality reasons for the new rules (§3) reach the existing `crewIllegal` / `crewTight` / `crewRest` cards through `crew/reasons.ts` (ReasonCode mapping in §3) in the same four-line format.

### 2.8 Glossary (ENGINE `data/glossary.ts`)
New `TermId`s and short texts (player voice):
- `restClass2` "Class 2 rest: a business seat that reclines at least 45°, curtained off from passengers."
- `restClass3` (fixed) "Class 3 rest: a crew rest recliner (at least 40°, with a leg rest) behind a curtain, not next to passengers. A normal economy seat doesn't count."
- `fcrc` "The pilots' bunk room by the cockpit (flight crew rest compartment): class 1 rest."
- `ccrc` "The cabin crew's bunks, hidden above the cabin or below it: class 1 rest."
- `ldmcr` "A bunk module loaded into the aft cargo hold for the cabin crew (A330, A340): class 1 rest."
- `recliners` "Crew rest recliners with leg rests in place of the last economy rows: class 3 rest. They sell as economy seats when nobody rests."
- `inflightRest` "Sleep on board: on long days part of the crew rests in turns while the others work."
- `landingPilots` "The two pilots who land the last flight: they need 2 hours' rest in a row, the others 90 minutes."
- `augmented` "A third or fourth pilot so each can rest in flight; allows 14–18 h days depending on the rest facility."
- `extension` "A planned extra hour (up to 14 h), at most twice a week per person, with 4 h more rest after."
- `splitDuty` "A long wait on the ground (3 h or more) adds half of it to the day; a hotel room when it's 6 h or at night."
- `delayedReport` "Crew told to come later before they leave the hotel: under 4 h the day keeps its original limit."
- `homeStandby` "On call at home: 25 % counts as duty; called after 6 h, the day gets shorter."
- `wocl` "02:00–05:59 body-clock time: the hours we're least alert."
- `disruptive` "Early starts (05:00–05:59), late finishes (23:00–01:59) and nights (any time 02:00–04:59)."
- `tzRest` "After a trip 4 or more time zones away: 2–5 local nights at home before the next duty."
- `twoDays` "Twice a month the weekly rest is 2 whole local days."
- `discretion` (fixed) "The captain may extend the crew's day after reporting, if something unforeseen happens: up to 2 h (3 h with an augmented crew)."
- `crewRest` (fixed) "Where crew sleep on long flights: bunks (class 1), business seats (class 2) or recliners (class 3). Pilots and cabin crew have their own."
- `restSeats` (fixed) "Seats curtained off for resting crew on long days; sold to passengers on other flights."
Phrase links (`TERM_PHRASES`) for each.

### 2.9 Contracts, feasibility, pricing (ENGINE `contracts/{plan,feasibility,offers,pricing}.ts`)

- `Programme` gains `chains: ChainShape[]` = the 5 longest operated chains (trip legs between crew-change stations), deduplicated by shape:
```ts
export interface ChainShape { from: string; std: Minute; legs: { std: Minute; sta: Minute }[] }   // UTC, offsets applied
```
- **Feasibility** check `id: 'rest'` (new `CheckId`) per aircraft, from `dutyNeed(g, typeId, rest, chain)` for each chain (worst wins):
```ts
export interface DutyNeed { mode: 'basic' | 'split' | 'ext' | 'aug1' | 'aug2' | 'none'; fdp: number; max: number; plan: RestPlan | null; text: string }
export function dutyNeed(g: GameState, typeId: string, rest: AcRest, chain: ChainShape): DutyNeed;   // pure (crew/duties.ts)
```
  Report = `std − report minutes`, reference = the departure's local time (acclimatised). Lines (exact patterns):
  - `ok` `Longest day 12:40 of 13:00 (2 pilots)`;
  - `ok` `Longest day 13:40: a planned extension (14:00), twice a week per crew`;
  - `ok` `Bunks → 3 pilots, 16 h limit ✓`;
  - `warn` `Business seats (class 2) → needs a 4th pilot: 16 h · 4 business seats blocked on the long legs`;
  - `warn` `Needs 2 more cabin crew for in-flight rest`;
  - `no` `No crew rest → ✗ a 15:40 day needs in-flight rest` with `action: { kind: 'restRefit', option: 'curtainJ' | 'recliners' | 'ldmcr' }` (the cheapest home-base option that makes it legal, if any);
  - `no` `The cruise is too short for in-flight rest (3 legs of 3:10)` (no action);
  - `no` `ULR needs bunks for pilots and cabin crew (class 1)` for offers requiring the `ulr` approval unless `fc.cls === 1 && cc.cls === 1`.
  The v0.7.2 crew line keeps capacity only; its "needs an augmented crew and no crew rest" branch goes (the rest line says it).
- `FeasibilityCheck.action` gains `| { kind: 'restRefit'; option: RestRefitId }`.
- `offerRestLine(g, offerId): string | null` (pure): for long-haul offers (`longestChainMin + report > 13 h` on the smallest fitting widebody type) "Longest day 15:40 · needs 3 pilots + bunks, or 4 pilots + business seats"; `null` otherwise.
- **Estimates:** `estCost` uses the complement with the chain's augmentation and `extraCabin`.
- **Pricing:** wet offers whose longest chain needs augmentation on the type the offer was sized for get `ratePerBH × (1 + BAL.v073.augRate[aug])` (+3 % for 3 pilots, +6 % for 4; heavy-crew ACMI costs more). Charter prices already include crew cost via the estimate.
- **Ladder** (`ops/company.ts`): `augmented` needs a widebody with `fc` and `cc` present; `ulr` needs a ULR type with `fc.cls === 1 && cc.cls === 1`.

### 2.10 Crew rest refits (ENGINE `ops/cabin.ts`, `ops/cHub.ts`, `ops/maintenance.ts`; UI RefitModal, CheckModal)

```ts
export type RestRefitId = 'curtainJ' | 'recliners' | 'removeRecliners' | 'ldmcr' | 'fcrc' | 'overhead';
export interface RestRefitOption {
  id: RestRefitId; label: string; side: 'fc' | 'cc' | 'both'; cls: 1 | 2 | 3;
  where: 'home' | 'cCheck';                // home base (refitSlots) or added to a C-check at an MRO hub
  days: number; cost: number;              // est.; cCheck: extra days on the check
  seats: number;                           // cabin seat change (−8)
  opens: string;                           // 'Opens: 16 h days with 3 pilots (was 15 h)'
  ok: boolean; why: string | null;
}
export function restRefitOptions(g: GameState, aircraftId: string): RestRefitOption[];                         // pure
export function restRefitQuote(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): RefitQuote;   // pure, home options
export function bookRestRefit(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): ActionResult<{ maintId: string }>;
export function addRestToCCheck(g: GameState, maintId: string, id: 'fcrc' | 'overhead' | null): ActionResult;   // toggle on a booked C-check
// cHub: cCheckOptions(g, id, start?, restFit?), cCheckSlots(g, id, hub, n?, restFit?), bookCCheck(g, id, hub, start, opts?: { restFit?: 'fcrc' | 'overhead' })
// v0.7.2 restSeatsQuote / bookRestSeats stay as wrappers for 'recliners' / 'removeRecliners' until the UI switches.
```

| Option | Types | Gives | Where / time / cost (est., `BAL.v073.restRefit`) | Trade-off |
|---|---|---|---|---|
| Curtain off business seats | widebodies with J ≥ 4 and a side without facility | class 2 `jSeats` for the empty side(s) | home, 1 day, $15K | J seats blocked on rest flights only |
| Crew rest recliners | A321neo (LR), 757, widebodies | class 3 `recliners` for the empty side(s) (narrow: fc 1, cc 2) | home, 3 days $100K narrow / 4 days $220K wide | the last row(s) become recliners: narrow −3 seats, wide `rowsLost × yAbreast − places` (767 −8); recliners sell as economy on other flights |
| Remove recliners | aircraft with recliners | seats back | home, 2 days, $30K | – |
| Lower-deck crew rest module | A330, A340 without a cabin crew compartment | cc class 1 `ldmcr` (7–8 bunks) | home, 6 days, $950K (provisioned airframes) | frees business seats; no cargo in the game, so no other cost |
| Flight crew rest compartment | 767, A330, A340 without one | fc class 1 `fcrc` (2 bunks) | **with a C-check** at a v0.7.2 hub, +10 days, $1.9M | best booked with the next C-check |
| Overhead crew rest | 777, 787, A350, 747 without fc or cc | the missing side class 1 | with a C-check, +14 days, $2.6M | rare: buy one with bunks instead |

- `opens` compares `longestDay` before/after plus the cabin crew effect: `Opens: 16 h days with 3 pilots (was 15 h)`, `Opens: cabin crew rest in bunks (2:00 instead of 2:20 on a 15 h day); 4 business seats back on sale`, `Opens: 14 h days with 3 pilots (was 13 h)`.
- Home options book a `'refit'` maintenance with `MaintenanceEvent.restFit: RestRefitId`, using `refitSlots(g, id, 'rest:' + option)`; at the end `ac.rest` changes (and the cabin for recliners). C-check add-ons set `MaintenanceEvent.restFit` on the C-check, lengthen it by `addDays` (the ferry home is retimed as today) and post the cost with the check (`checks` line); fitted at the check's end.
- **RefitModal** (UI): a "Crew rest" section (replaces "Crew rest seats"): today's facilities (two lines + longest day) on top, then one row per option: label, class chip, `days · $cost · seats`, the `opens` line, and `Book…` (home: the slot list as F6) or `Add to the C-check…` (opens CheckModal C with `restFit`). Disabled rows show `why`.
- **CheckModal** C (UI): when `restRefitOptions` has an MRO option, a 44 px tick row "Also fit a flight crew rest compartment (+10 days, ~$1.9M) · Opens: 16 h days with 3 pilots (was 15 h)"; hub totals and slots include it.
- Messages: "Crew rest refit booked: CS-TQB gets a lower-deck crew rest module at Lisbon, 3–9 Dec ($950K). Opens: cabin crew rest in bunks." · end: "CS-TQB's lower-deck crew rest module is fitted." C-check booking message appends "plus a flight crew rest compartment (+10 days, $1.9M)".

### 2.11 Balance intent
- Real constraints cost something: some 3-sector augmented days become illegal (cruise too short) → slip crews or 4 pilots; long days on class 2 seats need a 4th pilot; cabin crew extras appear on class 2/3 facilities. Bunks become worth money on the Market.
- Class 2 business seats as the no-bunk default keep most v0.7.2 widebody jobs flyable (with more crew).
- Target: bot `--wide` seeds keep their v0.7.2 margin band; narrowbody seeds unchanged except §3 rules.

### 2.12 Glyph positions (MAP `components/aircraft/restGlyph.ts`)
```ts
export interface ArtRest { fc: RestKind | null; cc: RestKind | null }
/** Glyph spots in viewBox units for a type: bunk (two short stacked bars), seat block (tinted rectangle on the window line), recliner (small seat). */
export function restGlyphs(typeId: string, rest: ArtRest): { kind: 'bunk' | 'seats' | 'recliner'; x: number; y: number; w: number; h: number }[];
// AircraftArtProps gains rest?: ArtRest (ignored at detail 'simple' below 90 px wide)
```
Positions as fractions of fuselage length from the nose, then mapped through `artMetrics`: FCRC 777/787/A350 0.12 top (overhead), 747 0.14 upper deck, A380 0.10 main deck, 767/A330/A340 0.10 behind the cockpit; CCRC overhead 777 0.78, 787 0.80, A350 0.80, 747 0.82 (top); A380 lower deck 0.70 belly; LDMCR (A330/A340/767) 0.62 belly; business seats block 0.14–0.24 window line; recliners 0.86 window line. Ink `--ink` at 55 %, 1 px stroke scaled; never animated.

---

## 3. The missing rules (ENGINE `crew/rules.ts`, `crew/duties.ts`, `crew/timeline.ts`, `crew/index.ts`, `crew/control.ts`, `crew/calendar.ts`)

All new `evalSegs` checks stay O(segments) (it is the roster's hot path). New `IssueCode`s: `'ext7d' | 'nightSectors' | 'lateEarly' | 'twoDays' | 'tzRest' | 'standby'`. ReasonCode mapping (`crew/reasons.ts`): `ext7d`, `nightSectors`, `standby` → `'fdp'`; `lateEarly`, `tzRest` → `'rest'`; `twoDays` → `'recovery'`.

### 3.1 Planned extension (ORO.FTL.205(d), CS FTL.1.205(b))
```ts
/** [from, to) local reference report time → max FDP for 1–2 / 3 / 4 / 5 sectors; null = not allowed. Outside every row: not allowed. */
export const EXT_TABLE: readonly (readonly [number, number, number | null, number | null, number | null, number | null])[];
export const WOCL = { from: 2 * 60, to: 6 * 60 } as const;    // 02:00–05:59
export function extFdp(reportLocal: number, sectors: number, woclMin: number): number | null;  // table + WOCL sector caps; null = not allowed
```
Rows exactly as the guide: 06:00–06:14 none · 06:15 13:15/12:45/12:15/11:45 · 06:30 13:30/13:00/12:30/12:00 · 06:45 13:45/13:15/12:45/12:15 · 07:00–13:29 14:00/13:30/13:00/12:30 · 13:30 13:45/13:15/12:45/– · 14:00 13:30/13:00/12:30/– · 14:30 13:15/12:45/12:15/– · 15:00 13:00/12:30/12:00/– · 15:30 12:45 · 16:00 12:30 · 16:30 12:15 · 17:00 12:00 · 17:30 11:45 · 18:00 11:30 · 18:30–18:59 11:15 (1–2 sectors only from 15:30) · 19:00–06:14 none · 6+ sectors none.
- **WOCL encroachment** of [report, last on-blocks] on 02:00–05:59 (reference tz): 0 → ≤ 5 sectors; ≤ 2 h → ≤ 4; > 2 h → ≤ 2.
- Acclimatised crew only (state B or D). Planned in advance only (`partition`/`planAircraft`); never with split duty or in-flight rest (`pickPlan` options are exclusive).
- **Per crew member: at most 2 in any 7 consecutive days.** `Seg.ext`, `DutyLogEntry.ext`; `evalSegs`: for each target `ext` seg, the `ext` segs starting in `(s.start − 7 d, s.start]` must be ≤ 2, else `'ext7d'` illegal: "Ana Silva has already flown 2 extended days this week (the rule allows 2 in any 7 days)". Cabin crew count their own.
- **Rest:** the post-flight option, +4 h: `Seg.rest += 240` (and `minRest` gains `extended?: boolean`). Consecutive extended FDPs: each gets its own +4 h.
- Discretion base after an extension = `d.basicFdp` (§1.1 C3); 16 h ceiling never reached (max 14:00).
- UI: roster board `+1h`; duty modal "Planned extension: 13:40 of 14:00 (07:30 report, 2 sectors). Rest after +4 h. 2 of 2 this week for Capt. Silva."

### 3.2 Delayed reporting (ORO.FTL.205(g), CS FTL.1.205(d))
- `Duty.notified` = the report time the crew were told: set when the pairing first gets crew; refreshed to the new report when a change is made ≥ `BAL.v073.delayed.republishH` (18 h) before the notified report (a roster change, not a delay; the v0.6 late-change morale applies as today).
- In `syncDuty` before report (`!reported`), with `delay = d.report − d.notified > 0`:
  - `delay < 4 h`: max FDP from the **notified** report (`maxFdp` at its reference time);
  - `4 h ≤ delay < 10 h`: the **more limiting** of the notified and delayed reports;
  - `delay ≥ 10 h`: the delay counts as rest; normal from the delayed report and `notified = report`.
  - FDP always counts from the delayed report. Earlier reports: normal (no rule).
- Second notification: not modelled (EASA-FTL.md §15).
- Example (test): report 04:30 delayed to 06:00 → limit 11:00 (17:00–04:59 row), not 13:00.
- One info message only when it bites (the duty becomes tight or illegal): "AWQ210's crew were told to report at 04:30 and now report at 06:00: the limit stays 11:00 (the 04:30 band) because the delay is under 4 hours." `Stats.delayedReports++`.

### 3.3 Disruptive schedules and night duties (CS FTL.1.235(a), CS FTL.1.205(a))
- **Type: early type for every home base** (documented choice; Portugal, the default base's state, is not in the guide's list; it is the stricter type for late finishes): early start = duty starts 05:00–05:59; late finish = duty ends 23:00–01:59; night = encroaches any part of 02:00–04:59 (reference tz). `FTL_TYPE = 'early'` constant.
```ts
export function disruptiveKinds(tz: string, start: Minute, end: Minute): { early: boolean; late: boolean; night: boolean };
// isDisruptive = any of the three (unchanged result); Seg gains late?: boolean; night?: boolean; early?: boolean
```
- **Late finish or night duty → early start at home base:** the rest in between must contain **1 local night** (`nightsIn(base, p.end, s.start) ≥ 1`) when `s` is an early start from home base and is an FDP (or the standby leading to one). Else `'lateEarly'` illegal: "She finished late (00:40) and starts early (05:30): the rest must include a whole local night (8 h between 22:00 and 08:00)."
- **4 or more disruptive duties** between recoveries → the next recovery 60 h: exists (`LIMITS.recoveryLong`), unchanged.
- **Consecutive nights ≤ 4 sectors**: C6.
- Appropriate FRM / the three night subtypes (ED Decision 2023/023/R): documented only.

### 3.4 Two local days twice a month (ORO.FTL.235(d))
- A recovery rest "with 2 local days" = a free stretch containing two whole consecutive local days 00:00–24:00 at the base clock (`localDaysIn(base, from, to) ≥ 2`).
- `CrewMember.twoDays?: Record<MonthKey, number>` counts the completed ones per calendar month (written where `noteRecovery` runs). Old saves: absent → the load month counts as satisfied.
- `TimelineCtx.twoDays?` (logged count for the month of `now`); `evalSegs` counts planned qualifying gaps per month; at the first target seg starting in a later month than M, `logged(M) + planned(M) < 2` → `'twoDays'` illegal: "Twice a month crew need a weekend of 2 whole days off; in June Ana Silva had only 1." Months before the load month are never checked.
- The roster's 6-on/2-off work block (company policy, labelled so) normally gives 3–4 a month; the check only bites on dense deployments.

### 3.5 Time-zone recovery (CS FTL.1.235(b))
```ts
/** CS FTL.1.235(b)(3)(i): local nights at home base by the rotation's max time difference (≤ 6, ≤ 9, ≤ 12 h) and hours since its first report (< 48, 48–71:59, 72–95:59, ≥ 96). */
export const TZ_NIGHTS: readonly (readonly [number, number, number, number])[] = [[2, 2, 3, 3], [2, 3, 3, 4], [2, 3, 4, 5]];
export function tzNights(maxDiffH: number, hoursSinceReport: number): number;   // 0 below 4 h
```
- A **rotation** = segs from leaving home base until the crew rests at home base again. Max difference = the largest `tzDeltaH(base, s.at)` over its rests; direction = the sign of that zone's offset vs base (east +, west −).
- On return (`s.at === base`) with max ≥ 4 h: the next seg must start after `tzNights(max, (back − rotStart)/60)` local nights at base, else `'tzRest'` illegal: "Back from a 5-hour time-difference trip of 3 days: 3 local nights at home before the next duty." The elapsed clock stops on return (GM).
- **Alternating directions** (both ≥ 4 h, opposite signs): ≥ 3 local nights at home between them, else `'tzRest'`: "Changing from westbound to eastbound needs 3 local nights at home in between."
- Away after an FDP with ≥ 4 h difference: ≥ duty or 14 h (exists).
- Crew state (logs carry no places): `CrewMember.rot?: { start: Minute; maxTz: number; dir: -1 | 0 | 1 }` (current rotation, updated at each release away, cleared on return) and `CrewMember.tzBack?: { back: Minute; nights: number; dir: -1 | 1 }` (the last ≥ 4 h return). `TimelineCtx` gains both; planned rotations are evaluated from the segs' `at`.
- The planner's trips (`buildTrips`) already end at home; the roster simply finds other crew when the nights aren't there.

### 3.6 Split duty (ORO.FTL.220, CS FTL.1.220)
- For a single unit with a ground time at one airport between two operated legs: `net = (next.std − onBlocks(prev)) − BAL.v073.split.excludeMin (60: 30 min post-flight + 30 min travel and pre-flight; ≥ the 30 min minimum)`. Split when `net ≥ 180`.
- Max FDP = `min(16:00, basic + floor(net / 2 / 15) × 15)` (Table 2/3 with all sectors counted). Examples (test): net 3:00 → +1:30, 4:00 → +2:00, 6:00 → +3:00, 8:00 with a hotel → +4:00.
- Accommodation: `net ≥ 6 h` or the break touches the WOCL → a hotel day room (suitable accommodation; every minute counts); otherwise the airport crew room (accommodation, < 6 h and no WOCL, so nothing is excluded). Costs posted to `hotels` at release: lounge $25, day room $90 per crew member (est.).
- Not with in-flight rest or a planned extension (exclusive options); the game never reduces rest, so "not after reduced rest" holds. The break counts in full as FDP. Discretion base = the split maximum.
- `Duty.split = { at, net, room: 'lounge' | 'hotel', flightId }`. UI: roster board `SPLIT`; duty modal "Split duty: a 4:30 wait at Funchal (4:00 net) adds 2:00 → 14:00. Crew room at the airport." `Stats.splits++`.
- Why it matters: narrowbody out-and-backs with a 4–6 h ground stop (ski charters, Funchal, Cape Verde) fly with one crew instead of a slip crew.

### 3.7 Standby (ORO.FTL.225, CS FTL.1.225) for the call-in fix; reserve (CS FTL.1.230)
**Home standby is rostered, small and automatic** (the v0.7.1 "Call in standby crew" finally means standby):
- Each day at 00:00 home time (the crew `daily` hook), for the next `aheadDays` (2) days, for each rating family with aircraft in the fleet: `perFamily` crew (1 CPT, 1 FO, 1 PUR, 1 CC) are put on **home standby 06:00–18:00 local** at home base (12 h ≤ the 16 h maximum). Chosen among crew at base with no duty or block that day, rested at 06:00, not inside a recovery rest they need, keeping ≥ `minDaysOff` (8) free days in the month, legal with the standby seg (`evalSegs`), lowest 28-day duty first. Stored as `CrewMember.standby?: { from: Minute; to: Minute; calledAt?: Minute }[]` (pruned after the day).
- A later roster duty that day replaces the standby (the slot is dropped; no message).
- **Counting:** a standby seg (`Seg.kind 'sby'`, `share: 0.25`) counts 25 % towards the 7/14/28-day duty windows (`windowsAt` multiplies by `share`); it is not rest and not part of a recovery rest; rest after an uncalled standby = the normal minimum from its end (12 h at home).
- **Called** (Crew Control call-in, auto-fix or the auto-roster picking them): the FDP counts from report; the max FDP for that person is **reduced by standby time beyond 6 h** (8 h if the duty is augmented or split); standby time 23:00–07:00 does not count until contacted (the 06:00–07:00 hour is free); **awake cap**: `fdpEnd − (standby.from − 60) ≤ 18 h` (woke an hour before), else `'standby'` illegal. Implemented per crew member in `dutySegs` (their seg's `maxFdp`), so the duty's own limit is unchanged for the others.
- **Crew Control** (`crew/control.ts` call-in): candidates on standby at the station come first, labelled `On home standby since 06:00`, **no overtime, no morale hit**; then today's behaviour for crew off duty, labelled `Day off: called in` (overtime, morale −4). The change line: "Capt. Reis called from home standby: no overtime; her day may run to 11:30 (standby beyond 6 h shortens it)." `Stats.standbyCalls++`.
- **Airport standby** (100 % duty; FDP reduced by standby beyond 4 h; standby + FDP ≤ 16 h): `standbyCut('airport', …)` implemented and tested in `rules.ts`, **not rostered** (we keep no crew room at the airport); EASA-FTL.md says so.
- **Reserve** (≥ 10 h notice, 8 h protected, not duty): not modelled; documented.
```ts
export function standbyCut(kind: 'home' | 'airport', sbyFrom: Minute, report: Minute, tz: string, augOrSplit: boolean, contacted?: Minute): number;  // minutes off the max FDP
export function standbyAwakeOk(sbyFrom: Minute, fdpEnd: Minute): boolean;
export function onStandby(g: GameState, crewId: string, t: Minute): { from: Minute; to: Minute } | null;   // pure
```
- Calendar: `CalKind 'standby'` is now produced ("Standby 06:00–18:00 at home").
- Balance: standby uses crew who are free that day anyway; ~4 crew a day per family. Expect call-ins to replace some discretion (no longer possible before report) and some delays.

### 3.8 Discretion report (ORO.FTL.205(f)(5)) — flavour, one message
When applied discretion exceeds 1 h at release: "Discretion report filed: AWQ815's crew ran 1:20 over their limit; reported to the authority within 28 days." The authority by AOC state from `data/flavor.ts` `AUTHORITY` (Portugal ANAC, Spain AESA, Malta Transport Malta CAD, Lithuania TKA, Latvia CAA Latvia; else "the authority"). `Stats.discretionReports++`. No penalty.

---

## 4. What's new (`src/data/whatsNew.ts`, top entry; ENGINE lane as data)
- **version** `'v0.7.3'`, **name** `'In-flight Rest & EASA'`.
- **features:**
  - "In-flight rest is now real: every widebody has its own rest for pilots and for cabin crew (bunks, business seats or recliners), and long days only work if everyone can actually sleep on the way."
  - "Tap any long flight to see who rests when, where and for how long: pilots by name, cabin crew in groups, and whether the plan is OK, tight or impossible."
  - "Every aircraft shows its longest possible day: '16 h with 3 pilots · 17 h with 4'. The Market can show only aircraft with bunks."
  - "Crew rest refits: curtain off business seats, fit recliners (also on the A321LR and 757), a lower-deck bunk module on the A330/A340, or a bunk room for the pilots with the next C-check."
  - "Planned extensions (+1 h, twice a week), split duties on long ground waits and home standby crew you can call in without overtime."
  - "The rest rules you know: a local night's sleep before an early start after a late finish, two-day weekends twice a month, and recovery nights at home after trips across time zones."
- **improvements:**
  - "The EASA rules were checked line by line against the current regulation: the cabin crew rest table ends at 18 h, rest after any augmented day is at least 14 h, and the captain's discretion is only for surprises on the day."
  - "Contract checks use the real limit for the report time and each aircraft's rest, and say exactly what a long job needs."
  - "Delays announced before the crew leave the hotel keep the original day limit, as the rules say."
  - "Small fixes: the WHY? dot is easier to read, lists clear the iPad's home bar."

---

## 5. Data model (ENGINE lands first: one additive edit of `core/types.ts`)

```ts
export type RestKind = 'fcrc' | 'ccrc' | 'ldmcr' | 'jSeats' | 'recliners';
export interface RestFacility { cls: 1 | 2 | 3; kind: RestKind; places: number }
export interface AcRest { fc: RestFacility | null; cc: RestFacility | null }
export type RestRefitId = 'curtainJ' | 'recliners' | 'removeRecliners' | 'ldmcr' | 'fcrc' | 'overhead';

export interface Aircraft { /* … */
  /** v0.7.3 pilots' and cabin crew's in-flight rest facilities. load: ??= migrateRest(ac) */ rest?: AcRest;
  /** @deprecated v0.7.3: read `rest` (kept for the migration). */ crewRest?: { bunks: boolean; seats: number };
}
export interface AircraftOffer { /* … */ /** v0.7.3 */ rest?: AcRest }
export interface MaintenanceEvent { /* … */ /** v0.7.3 crew rest refit fitted at the end (home refit or C-check add-on). */ restFit?: RestRefitId }
export interface Duty { /* … */
  /** v0.7.3 planned extension (CS FTL.1.205(b)); set only by the planner. */ ext?: true;
  /** v0.7.3 split duty (CS FTL.1.220). */ split?: { at: string; net: number; room: 'lounge' | 'hotel'; flightId: string };
  /** v0.7.3 Table 2/3 max FDP (discretion base after an extension). */ basicFdp?: number;
  /** v0.7.3 cabin crew report this much before the pilots (absent = type default; 0 when their table would bind). */ cabinEarly?: number;
  /** v0.7.3 extra cabin crew the rest plan needs. */ restExtra?: number;
  /** v0.7.3 report time the crew were told (delayed reporting). */ notified?: Minute;
  /** v0.7.3 the player chose 4 pilots. */ forceAug?: 2;
  /** v0.7.3 crewed at load from an older save within 72 h: augmentation kept without a rest-plan check. */ legacyRest?: true;
}
export interface DutyLogEntry { /* … */ /** v0.7.3 */ ext?: true; early?: boolean; late?: boolean; night?: boolean }
export interface CrewMember { /* … */
  /** v0.7.3 2-local-day recoveries per month. */ twoDays?: Record<MonthKey, number>;
  /** v0.7.3 current rotation away (time zones). */ rot?: { start: Minute; maxTz: number; dir: -1 | 0 | 1 };
  /** v0.7.3 last return from a ≥ 4 h rotation. */ tzBack?: { back: Minute; nights: number; dir: -1 | 1 };
  /** v0.7.3 home standby windows (next days). */ standby?: { from: Minute; to: Minute; calledAt?: Minute }[];
}
export type ProblemKind = /* … */ | 'restFacility' | 'restTooShort' | 'cabinRest';
export interface Stats { /* … */ extensions?: number; splits?: number; standbyCalls?: number; restRefits?: number; delayedReports?: number; discretionReports?: number; restTooShort?: number }
```
`AcmiType.rest: TypeRest` (data, ENGINE); `bunkShare` removed. `Seg` (rules.ts): `kind` gains `'sby'`; `share?`, `ext?`, `early?`, `late?`, `night?`. `IssueCode` gains the six codes. `CheckId` gains `'rest'`. `TermId` gains §2.8 ids.

**Load defaults:** ops `load`: `ac.rest ??= migrateRest(ac)`, open `AircraftOffer.rest ??= migrateRest(o)`, crewed duties within 72 h `legacyRest = true` (only when `rest` was just migrated, i.e. a pre-v0.7.3 save). Crew fields read with `??`. Nothing is renamed; `SAVE_VERSION` stays 1.

## 6. Balance (`core/balance.ts`, new ENGINE block)
```ts
// ---------- in-flight rest & EASA v0.7.3 (ENGINE; UPDATE-0.7.3.md §6) ----------
v073: {
  rest: { tocMin: 40, todMin: 40, wakeMin: 30, cabinAfterTakeoff: 105, cabinBeforeLanding: 70, maxExtraCabin: 2, tightSpare: 30, roundMin: 5 },
  restRefit: {
    curtainJ: { days: 1, cost: 15_000 }, reclinersNarrow: { days: 3, cost: 100_000 }, reclinersWide: { days: 4, cost: 220_000 },
    removeRecliners: { days: 2, cost: 30_000 }, ldmcr: { days: 6, cost: 950_000 }, fcrc: { addDays: 10, cost: 1_900_000 }, overhead: { addDays: 14, cost: 2_600_000 },
  },
  ext: { perWeek: 2, restAfterMin: 240 },
  split: { excludeMin: 60, minNet: 180, hotelFrom: 360, cap: 960, lounge: 25, dayRoom: 90 },
  delayed: { republishH: 18 },
  standby: { fromLocal: 360, hours: 12, perFamily: { CPT: 1, FO: 1, PUR: 1, CC: 1 }, aheadDays: 2, wakeMin: 60, minDaysOff: 8 },
  augRate: { 1: 0.03, 2: 0.06 },
},
```

## 7. Interfaces between lanes (final signatures; ENGINE ships stubs first)

```ts
// ---- ENGINE exports used by UI / MAP ----
// crew/restPlan.ts (re-exported from crew/index.ts)
export function planRest(legs: RestLeg[], rest: AcRest, augment: 1 | 2, cabinFdp: number, cabinN: number): RestPlan;
export function restPlan(g: GameState, dutyId: string, opts?: { augment?: 1 | 2 }): RestPlan | null;          // pure
export function restPlanForFlight(g: GameState, flightId: string): RestPlan | null;                           // pure
export function restNow(g: GameState, aircraftId: string, t: Minute): { names: string[]; where: RestKind; until: Minute }[];  // pure (MAP)
export function restOf(g: GameState, aircraftId: string | null): AcRest;                                      // pure
export function restText(f: RestFacility | null, side: 'fc' | 'cc'): string;
export function longestDay(g: GameState, rest: AcRest, typeId: string): LongestDay;                          // pure
export function restVerdict(p: RestPlan | null): { tone: 'good' | 'warn' | 'bad'; text: string } | null;   // 'Rest plan OK' / 'Tight: 10 min spare' / 'Not possible'
// crew/explain.ts (new)
export interface FdpWhy {
  fdp: number; limit: number; mode: 'basic' | 'split' | 'ext' | 'aug1' | 'aug2';
  title: string;            // 'Day length 15:20 of 16:00'
  why: string;              // 'Why 16:00? 3 pilots with bunks (class 1) allow 16 h. With business seats it would be 15 h; with no rest, 13 h.'
  cabin: string | null;     // 'Cabin crew: 15:35 day (report 15 min earlier) → each needs 2:15 rest (band 15:31–16:00, class 1).'
  notes: string[];          // report band / sectors / acclimatisation; extension, split, standby, delayed report, discretion lines
  options: { label: string; max: number | null }[];   // No rest 13:00 · Extension — · 3 pilots 16:00 · 4 pilots 17:00
}
export function fdpWhy(g: GameState, dutyId: string): FdpWhy | null;                                          // pure
export function setDutyAugment(g: GameState, dutyId: string, aug: 2 | null): ActionResult;                  // 'Fly it with 4 pilots' (re-rosters)
// crew/duties.ts
export function dutyNeed(g: GameState, typeId: string, rest: AcRest, chain: ChainShape): DutyNeed;            // pure
// crew/crewRest.ts (kept)
export function restSeatsBlocked(g: GameState, flightId: string): number; export function sellableSeats(g: GameState, flightId: string): number;
export function restClassAt(g: GameState, aircraftId: string | null): 1 | 2 | 3 | null;   // @deprecated: = restOf(…).fc?.cls ?? null
// crew/rules.ts
export const CABIN_REST, AUG_FDP, EXT_TABLE, TZ_NIGHTS, WOCL, DISCRETION, LIMITS; export const FTL_TYPE = 'early';
export function cabinInflightRest(fdp: number, cls: 1 | 2 | 3): number | null; export function cabinFdpCap(cls: 1 | 2 | 3): number;
export function extFdp(reportLocal: number, sectors: number, woclMin: number): number | null;
export function disruptiveKinds(tz: string, start: Minute, end: Minute): { early: boolean; late: boolean; night: boolean };
export function tzNights(maxDiffH: number, hoursSinceReport: number): number;
export function standbyCut(kind: 'home' | 'airport', sbyFrom: Minute, report: Minute, tz: string, augOrSplit: boolean, contacted?: Minute): number;
// crew/index.ts
export function onStandby(g: GameState, crewId: string, t: Minute): { from: Minute; to: Minute } | null;     // pure
// CalKind 'standby' produced by crew/calendar.ts and rosterBoard blocks; BoardBlock gains aug?: 1 | 2; ext?: boolean; split?: boolean
// DutyCandidate gains standby?: { from: Minute }   (Crew Control call-in label; no overtime)
// contracts
export function offerRestLine(g: GameState, offerId: string): string | null;                                  // pure
// FeasibilityCheck: id 'rest'; action gains { kind: 'restRefit'; option: RestRefitId }
// ops (re-exported from ops/index.ts)
export function restRefitOptions(g: GameState, aircraftId: string): RestRefitOption[];                        // pure
export function restRefitQuote(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): RefitQuote; // pure
export function bookRestRefit(g: GameState, aircraftId: string, id: RestRefitId, start: Minute): ActionResult<{ maintId: string }>;
export function addRestToCCheck(g: GameState, maintId: string, id: 'fcrc' | 'overhead' | null): ActionResult;
export function cCheckOptions(g, aircraftId, start?, restFit?: 'fcrc' | 'overhead'): CCheckOption[];
export function cCheckSlots(g, aircraftId, hub: string, n?, restFit?: 'fcrc' | 'overhead'): Minute[];
export function bookCCheck(g, aircraftId, hub: string, start: Minute, opts?: { restFit?: 'fcrc' | 'overhead' }): ActionResult<{ maintId: string }>;
// data
export interface TypeRest; AcmiType.rest; GLOSSARY / TERM_PHRASES (+ §2.8); HINTS (+ 3 kinds); WHATS_NEW (v0.7.3 top); AUTHORITY (data/flavor.ts)
// dev (engine/dev.ts), each returns the id to open
export function devRestPlan(g: GameState): string;     // A330 with business seats (class 2) + an LIS–GRU augmented duty; flight id
export function devShortCruise(g: GameState): string;  // a 3-sector augmented day with 3 h legs (restTooShort); flight id
export function devExtension(g: GameState): string;    // an A320 13:40 out-and-back planned as an extension; duty id
export function devSplit(g: GameState): string;        // an A320 out-and-back with a 4:30 wait at FNC (split duty); duty id
export function devStandby(g: GameState): string;      // a crew-short flight at base with a CPT on home standby; flight id
```
**UI store additions** (`src/ui/store.ts`, additive): `ModalSpec` refit `rest?: boolean` stays and gains `section?: 'rest'`; check gains `restFit?: 'fcrc' | 'overhead'`; `dev.restPlan()`, `dev.shortCruise()`, `dev.extension()`, `dev.split()`, `dev.standby()` (each opens the sheet / duty modal on the returned id).

**MAP exports used by UI:** `AircraftArtProps.rest?: ArtRest` (`components/aircraft/AircraftArt.tsx`), `ArtRest` and `restGlyphs` (`components/aircraft/restGlyph.ts`). **MAP lane reads:** `restOf`, `restText`, `restNow`, `restSeatsBlocked`.

## 8. Bot (`scripts/acmi-bot.ts`, ENGINE)
Pure in g, run after every step as today; header comment updated. New rules:
- **Offers:** feasibility's `rest` line counts like any check (`no` refuses the aircraft); prefer an aircraft whose rest line is `ok` over `warn` when both fit.
- **Refits** (once per aircraft, holding `augmented`, a signed or open augmented job on that aircraft): no facility and J ≥ 4 → `curtainJ`; else recliners; an A330/A340 flying ≥ 8 augmented duties in the last 30 days with business-seat cabin rest → `ldmcr` (cash ≥ $3M after it); never `overhead`; `fcrc` added to a C-check being booked when the aircraft flew ≥ 8 augmented duties in 30 days on class 2 pilot rest. Replaces the v0.7.2 `restSeats` rule.
- **Crew Control:** order unchanged (auto-fix → fly in → call in → swap → jet → discretion → delay → sub-charter); call-in now takes standby crew first; discretion only appears after report.
- **Rest problems:** on `restTooShort` for a duty with ≥ 4 pilots possible → `setDutyAugment(…, 2)`; else leave it to the roster (slip crew).
- **Seed 2 leftover (optional, cheap):** before sub-chartering a leg of a series (tourSeries / base pattern) with ≥ 8 legs handed over for that contract in 90 days, try swap, then a delay up to `BAL.holdMax`; sub-charter only if cheaper than cancelling.
- **Printed** (new soft line): `v0.7.3: augmented duties N (3P a / 4P b; class 1 x / 2 y / 3 z), rest plans not possible N, extra cabin crew for rest N, extensions N, splits N, standby call-ins N, delayed reports N, rest refits [ids], discretion reports N`.
- **Targets:** every v0.7.2 target still passes on seeds 1–6 (one at a time, 365 days): margin band, ≤ 0.3 % uncovered, **0 illegal duties**, morale 55–75, resignations 4–20 %, AOG 1–3 per aircraft-year, < 12 s. New hard target: "0 duties flown with an impossible rest plan". Soft: "extensions ≤ 2 per crew member in any 7 days (by construction)", "seed 2 sub-chartered legs ≤ v0.7.2 seed 2".

## 9. Tests and acceptance

**ENGINE tests**
- `crew/ftl.test.ts`: C1 (cabin table rows literal; `cabinFdpCap` 18:00/17:00/16:00; 18:15 class 1 null); C4 (`minRest` augmented at home = max(duty, 14 h)); C5 (11 sectors refused); `EXT_TABLE` every row × 1–2/3/4/5 against the guide literal incl. every "not allowed" cell; WOCL caps (0 / ≤ 2 h / > 2 h → 5/4/2); `disruptiveKinds` at 04:59/05:00/05:59/06:00 starts and 22:59/23:00/01:59/02:00 ends; `TZ_NIGHTS` all 12 cells and < 4 h → 0; `standbyCut` home (6 h → 0, 8 h → 2 h, augmented 8 h → 0, 23:00–07:00 not counted) and airport (> 4 h, standby + FDP ≤ 16 h); split increases (3:00 → 1:30 … 8:00 hotel → 4:00, 16 h cap).
- `crew/restPlan.test.ts` (new): single 12 h sector, 3 pilots, FCRC → ok, landing pilots last, each ≥ 120/90 and consecutive, turns inside cruise; 3 × 3:10 sectors, 3 pilots → `tooShort`; same with 4 pilots, 2 places → ok; 4 sectors → `sectors`; cabin: class 2 jSeats 4 places, N = 9, 16:10 → 3:00 each → `extraCabin` 2 when the cruise is 6:30, 0 when it is 9:00; class 3 at 16:15 → `cabinClass`; `blocked` only on legs with turns; no `cc` → `noFacility`; deterministic (same input → same output).
- `crew/duties.test.ts` / `roster.test.ts`: pickPlan order (basic → split → ext → aug1 → aug2); ext and split never merge two units; `forceAug` → 4 pilots; C2: 4 pilots + class 1 + a 12 h sector → 18:00 with `cabinEarly` 0; complement adds `restExtra` cabin crew; ext 2-in-7 (`'ext7d'` on the 3rd); +4 h rest after an extended FDP; `'lateEarly'` (00:40 finish → 05:30 start same night illegal, next day legal); consecutive nights > 4 sectors (`'nightSectors'`); `'twoDays'` (a dense month with one 2-day break illegal at the next month's first duty; the load month never); `'tzRest'` (LIS–CUN 3-day rotation → 3 nights; E then W rotation with 2 nights → illegal); delayed reporting 04:30 → 06:00 keeps 11:00, 4 h+ takes the more limiting, 10 h+ normal; a re-notified change ≥ 18 h ahead is not a delay.
- `crew/control.test.ts`: discretion unavailable before report (reason text), available after report within +2 h / +3 h augmented; call-in prefers a standby captain with no overtime and a reduced limit after 8 h of standby; awake cap refuses a 19 h day; standby counts 25 % in `duty7d`.
- `crew/standby.test.ts` (new): the daily hook puts 1 CPT/FO/PUR/CC per family on 06:00–18:00 standby at base for 2 days ahead, never someone off sick/leave, never breaking a needed recovery or the 8 free days; a roster duty that day replaces it.
- `contracts/feasibility.test.ts`: `rest` lines (bunks ok; class 2 → 4th pilot warn; no facility → no with a refit action; too short → no; ULR without class 1 cabin rest → no); the real Table 2 limit (a 06:00 report 2-sector 12:50 chain ok; a 17:30 report 11:30 chain → extension or no); estCost includes augmented crew.
- `ops/cabin.test.ts` / `maintenance.test.ts`: each refit option's availability per type; `bookRestRefit` changes `rest` (and the cabin for recliners) at the end; C-check add-on extends the check and moves the ferry home; `opens` strings.
- `ops/market.test.ts`: share rolls over 500 offers within ±5 % of the table per type; deterministic per seed.
- `saveCompat.test.ts`: v0.5.2, v0.6, v0.7, v0.7.1 **and a new v0.7.2 fixture** (`src/engine/fixtures/save-v072.lz.txt`, dumped **before any v0.7.3 engine change** with `npx tsx scripts/acmi-bot.ts 3 240 --wide --dump=240,<scratch>/v072.json` (the dump is `serialize` JSON), then `LZString.compressToBase64` into the fixture like the existing ones; if it has no widebody without bunks, add one with `devRestSeats` in the same pre-change tree before dumping) load; `rest` migrated per §2.1 table; **0 duties change legality in the first 72 h after load**; 60 days run with 0 illegal duties; serialise/reload equal.
- `core/plumbing.test.ts` purity: `restPlan`, `restPlanForFlight`, `restNow`, `restOf`, `longestDay`, `fdpWhy`, `dutyNeed`, `offerRestLine`, `restRefitOptions`, `restRefitQuote`, `onStandby`, `restSeatsBlocked`.
- Bot seeds 1–6, 365 days, one at a time, plus `--wide` seeds 1–3: §8.

**UI acceptance** (`scripts/ipad-shots.cjs --standalone`, 1180×820 and 1180×750, touch; new shots `fleet-rest`, `market-rest-filter`, `flight-sheet-rest`, `flight-sheet-rest-tooshort`, `duty-why`, `offer-rest-lines`, `refit-crew-rest`, `check-c-restfit`, `roster-board-aug`, `crew-control-standby`, `whats-new-073`):
- Fleet card shows Pilots rest / Cabin crew rest / Longest day for every aircraft; the Market "Has bunks" chip filters; nothing overflows at 1180 px.
- `dev.restPlan()` opens a flight sheet with the In-flight rest section: verdict chip, the static timeline with named pilots and cabin groups, the blocked-seats line; `dev.shortCruise()` shows "Not possible" with the why and the restTooShort card.
- Duty modal: "Day length … · Why …?" expands the engine lines; "Fly it with 4 pilots" re-rosters.
- Offer modal: each aircraft has its rest line; "Plan a refit" opens the Refit modal's crew rest section and returns to the offer.
- Refit modal crew rest section lists options with class, cost, seats and the "Opens" line; CheckModal C shows the add-on tick when available.
- Roster board shows the bed icon with 3P/4P, `+1h`, `SPLIT` and `SBY` blocks; Crew Control call-in shows "On home standby" first.
- v0.7.2 leftovers: WHY? dot text 12 px on touch; fleet and crew lists end with `padding-bottom: calc(16px + env(safe-area-inset-bottom))`.
- Every tappable ≥ 44 px; nothing animates except aircraft; the rest timelines never move.

**MAP acceptance**
- Fleet card / Market / AcquireModal art shows the static bunk glyph at the right place per type (777: forward and aft overhead; A330 with LDMCR: aft belly; business seats: a tinted block); `detail="simple"` thumbnails under 90 px show none.
- Aircraft panel: the rest chip names both sides; airborne on an augmented duty the "Resting: … until …" line changes only on the clock step.

## 10. Plain-language voice check
Every card, line and glossary text is readable by a former cabin crew member: names a person or a flight, says the number once with its unit, and ends with what to do. No article numbers in player texts (they live in EASA-FTL.md and the duty modal's "Why?" footnote line, e.g. "EASA CS FTL.1.205(c)").

## 11. Order of work inside each lane (smallest risk first, audit Appendix)
1. ENGINE step 0: dump the v0.7.2 save fixture (before any change); §5 types + §6 BAL + data (`TypeRest`), stubs for every §7 export (plans return `null`, options `[]`, texts `''`, `longestDay` real from the old class), tsc/vitest/build green. UI and MAP start against the stubs.
2. ENGINE: EASA-FTL.md rewrite (§1.3) + citations (§1.2) → rules corrections C1, C4, C5, C10 + tests → discretion (C3) → migration + `restOf` + market roll (§2.1) → `planRest` + tests (§2.2) → `pickPlan` + complement + C2 (§2.3) → longest day / texts (§2.4) → seats (§2.5) → feasibility / pricing / ladder (§2.9, C7) → refits (§2.10) → extension (§3.1) → split (§3.6) → delayed reporting (§3.2) → disruptive + nights + two days (§3.3, C6, §3.4) → time zones (§3.5) → standby (§3.7) → cards, glossary, whatsNew, flavour (§2.7, §2.8, §3.8, §4) → dev helpers → bot (§8) last; seeds 1–6 and save fixtures.
3. UI: Fleet rows + Market lines/filter → BlockSheet rest section + RestTimeline → DutyModal why + 4-pilot toggle → OfferModal rest lines → RefitModal crew rest section + CheckModal add-on → RosterBoard icons/tags/SBY → Crew Control standby labels → leftovers → shots.
4. MAP: `AircraftArtProps.rest` (no-op first, so UI can pass it) → glyphs → MapPanels chip and resting line.
5. Merge order ENGINE → UI → MAP; each merge keeps `npx tsc --noEmit`, `npx vitest run`, `npx vite build` green; the bot runs seeds 1–6 one at a time.

## 12. Not in v0.7.3 (keep it simple)
- No reduced rest, no FRM / Table 4, no reserve, no rostered airport standby (rules only), no second delay notification, no hotel-transfer rest (AMC1 ORO.FTL.235(b)), no ORO.FTL.110(j) robustness event, no night-subtype fatigue chips, no UAE GCAA or FAA rules, no 2028 air-taxi rules.
- No passenger-cabin seat map, no cargo revenue for the LDMCR, no sale of removed rest modules, no crew rest refit away from home base other than with a C-check.
- No new settings, auto-pause reasons, sounds or animations.

## 13. File ownership

| Lane | Owns (edit only these) | Delivers |
|---|---|---|
| **ENGINE** | `src/engine/**` (new `crew/restPlan.ts`, `crew/explain.ts`, `crew/standby.ts`, tests, `fixtures/save-v072.lz.txt`), `src/data/**` (`acmiTypes.ts`, `glossary.ts`, `whatsNew.ts`, `flavor.ts`, `market.ts`), `scripts/acmi-bot.ts`, `docs/acmi/EASA-FTL.md` (rewrite), one-line errata in `docs/acmi/UPDATE-0.7.2.md` and `RESEARCH.md` §5.1. Shared, minimal and additive, first: `core/types.ts` (§5), `core/balance.ts` (§6). | §1, §2.1–2.5, §2.7–2.10 engine, §3, §4, §8, saves |
| **UI** | `src/ui/**` except `src/ui/map/**` and `src/ui/components/aircraft/**`: `screens/{Fleet,Market,RosterBoard,rosterBoardLogic,Crew}.ts(x)`, `modals/{BlockSheet,DutyModal,OfferModal,RefitModal,CheckModal,CrewControlModal,AcquireModal}.tsx`, new `components/RestTimeline.tsx`, `components/Why.tsx` (12 px), `store.ts` (additive §7); `src/styles/**` except map styles: new `styles/acmi/v073.css` imported from `styles/acmi/index.css`. Exception as in v0.7.2: `scripts/ipad-shots.cjs` (new shots). | §2.6 items 1, 2, 4–8; §2.10 modals; §3 labels; leftovers; shots |
| **MAP** | `src/ui/map/**` (`MapPanels.tsx`, `mapLogic.ts` + test), `src/styles/acmi/map.css`; **exception for this update:** `src/ui/components/aircraft/**` (new `restGlyph.ts`, the `rest` prop in `AircraftArt.tsx`). | §2.6 items 3, 9; §2.12 |

Interfaces between lanes are §7 only. UI never reads `ac.crewRest` after its switch (use `restOf`); MAP lands the `rest` prop as a no-op before UI passes it.
