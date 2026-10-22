# BLOCK HOURS: EASA FTL audit against the player's guide

- **Reference:** the player's guide `scratchpad/easa/guide.txt` (Subpart FTL + CS FTL.1, current at 22 Oct 2026; all 1,400 lines read). Section numbers such as "guide §6.2" refer to it.
- **Code audited:** `/home/user/wt/acmi`, HEAD `8ca2728` (WIP checkpoint 2026-10-22T07:32Z). Another build is editing this tree, so line numbers are as read at that commit. Paths below are relative to `/home/user/wt/acmi`.
- **Status key:**
  - **MATCH**: the game value equals the guide.
  - **WRONG**: the game value or wording contradicts the guide.
  - **MISSING**: the guide has the rule and the game does not.
  - **SIMPLIFIED-OK**: the game approximates the rule; acceptable for a game and never more permissive in practice.
  - **N/A**: the game has no matching mechanic, so the rule cannot bite.

---

## 0. Most important findings (read first)

| # | Finding | Status | Where |
|---|---|---|---|
| 1 | **No check that in-flight rest physically fits.** The guide requires ≥ 90 consecutive min per pilot and ≥ 2 consecutive h for the landing pilots, and "if the cruise is too short, no extension". The game grants the augmented FDP whenever a rest class exists. The cabin crew table is used only as an FDP cap; `cabinInflightRest()` is never called by the engine. | MISSING | `duties.ts:43-50`, `rules.ts:122-128`, `rules.ts:101` (unused) |
| 2 | **One rest class per aircraft for pilots and cabin crew.** Real widebodies have a flight crew rest compartment (FCRC) and a cabin crew rest (CCRC/LDMCR, or blocked seats) that can be different classes. CS FTL.1.205(c)(3) uses the *cabin crew's* facility class. | WRONG (model) | `crewRest.ts:17-23`, `types` `Aircraft.crewRest {bunks, seats}` |
| 3 | **"Crew rest seats = last economy row" is not class 3** as the guide defines it (seat reclining ≥ 40° with leg and foot support). Plain economy seats do not qualify. There is also no class 2 (business seats), which is how most charter 767/A330s really rest their crew. | WRONG | `crewRest.ts:1-2,22`, `cabin.ts:244-268`, `glossary.ts:49-50`, UPDATE-0.7.2 §3 / §15 |
| 4 | **Cabin in-flight rest table has an extra 18:01–18:30 row (4:25).** The guide's table ends at 18:00. This makes `cabinFdpCap(1)` 18:30 instead of 18:00. | WRONG per guide | `rules.ts:97`, `rules.ts:108-112`, `ftl.test.ts:301,308,312`, `EASA-FTL.md:154,168` |
| 5 | **Planned extension (+1 h) is missing.** That covers the CS FTL.1.205(b) table, 2× per 7 days, WOCL sector limits and the +2/+2 or +4 h rest. It is the most-used FTL tool in short/medium-haul ACMI and is the alternative to augmenting. | MISSING | doc only: `EASA-FTL.md:91-102` |
| 6 | **Delayed reporting is not modelled.** A pre-report delay is re-measured from the new report time. A delay of under 4 h must keep the max FDP of the *original* report: a 04:30 report delayed to 06:00 gets 13:00 in the game but 11:00 under the guide. | WRONG (more permissive) | `duties.ts:77-78`, `flights.ts:1023-1034`, `roster.ts:510-514` |
| 7 | **Commander's discretion can be applied before report** (Crew Control, gate decision). The guide allows it only for unforeseen circumstances at or after reporting. The texts also say "max 2 h" when augmented crews get 3 h. | WRONG | `control.ts:1289-1300`, `events.ts:368,397`, `control.ts:121`, `glossary.ts:28` |
| 8 | **Time-zone recovery at home (2–5 local nights table) and alternating E/W (3 local nights) are missing.** Only the 14 h away rule is applied. | MISSING | `rules.ts:146-150`; doc admits `EASA-FTL.md:207-209` |
| 9 | **Disruptive transition rule is missing**: a late finish or night duty followed by an early start at base needs 1 local night in between. The consecutive-nights 4-sector cap and the "2 local days twice a month" recovery are also missing. | MISSING | `rules.ts:210-216`, `rules.ts:361-442` |
| 10 | **Contract feasibility uses a flat 13 h unaugmented limit.** It does not check the augmented limit for the aircraft's rest class (for example, class 3 seats allow at most 14/15 h, or 15/16 h with the long-sector bonus). | WRONG | `feasibility.ts:69,495-501` |
| 11 | Split duty, standby and reserve are not modelled. Crew Control "call-in" pulls off-duty crew instead. | MISSING (documented) | `EASA-FTL.md:216-229`, `control.ts:120,877-895` |
| 12 | Article citations in EASA-FTL.md, UPDATE-0.7.2.md and code comments are off in about 10 places: table numbers, ED Decision number, CS paragraph letters, and positioning cited as ORO.FTL.220. | WRONG (docs) | §D |

Everything numeric in Table 2, Table 3, Table 1 thresholds, the augmented 14/15/16 – 15/16/17 table, the long-sector bonus, discretion amounts, cumulative limits, home/away rest, 36 h/168 h/60 h recovery and the local-night definition **matches** the guide.

---

## A. Parameter-by-parameter table

### A1. Basic maximum daily FDP: acclimatised crew (ORO.FTL.205(b)(1), Table 2)

| Rule | Guide value (ref) | Game value (file:line) | Status | Exact correction |
|---|---|---|---|---|
| Report 06:00–13:29, 1–2 sectors | 13:00 (Table 2, guide §5.1) | `[6h, 13h30, 13h]` `rules.ts:56` | MATCH | – |
| 13:30–13:59 / 14:00–14:29 / 14:30–14:59 / 15:00–15:29 | 12:45 / 12:30 / 12:15 / 12:00 | `rules.ts:57` | MATCH | – |
| 15:30–15:59 / 16:00–16:29 / 16:30–16:59 | 11:45 / 11:30 / 11:15 | `rules.ts:58` | MATCH | – |
| 17:00–04:59 (de facto nights) | 11:00 cap | `FDP_OUTSIDE = 11h` `rules.ts:60`; fallback `rules.ts:118` | MATCH | – |
| 05:00–05:14 / 05:15–05:29 / 05:30–05:44 / 05:45–05:59 | 12:00 / 12:15 / 12:30 / 12:45 | `rules.ts:55` | MATCH | – |
| −30 min per sector from the 3rd | ORO.FTL.205(b)(1), guide §5.1 | `SECTOR_STEP = 30` `rules.ts:63`, used `rules.ts:130` | MATCH | – |
| Floor 9:00 | guide §5.1 | `FDP_FLOOR = 9h` `rules.ts:64,130` | MATCH | – |
| Table ends at 10 sectors | Table 2 columns 1–10 | `MAX_SECTORS = 10` `rules.ts:66` is declared but **never enforced** (grep: no other use). 11+ sectors silently get 9:00. | MISSING (minor) | In `partition()` (`duties.ts:341-371`) and `maxFdp`, treat `sectors > MAX_SECTORS` as not plannable (`ok:false`). |
| FDP read at reference time in the acclimatised zone | ORO.FTL.105(2) | `referenceTime()` `rules.ts:203-207`; `syncDuty` `duties.ts:79-81`; plan-time double clock `duties.ts:59-65` | SIMPLIFIED-OK | – |
| Consecutive night duties: FDP computed with ≤ 4 sectors | CS FTL.1.205(a)(1), guide §5.1/§12.4 | not implemented (`EASA-FTL.md:87` "not enforced") | MISSING | When two or more consecutive FDPs encroach 02:00–04:59 (reference tz), refuse more than 4 sectors per FDP in `partition()`. |
| Absolute 16 h ceiling for basic FDP and FDP extended without in-flight rest | EASA FAQ, guide §5.1 | Unaugmented max 13:00 + 2:00 discretion = 15:00 | MATCH (implicit) | Enforce explicitly once extension or split duty is added (§A4, §A12). |
| Code comments name the tables | Table 2 = basic, Table 3 = unknown, Table 4 = FRM; Table 1 = acclimatisation | `rules.ts:51` says "ORO.FTL.205(b)(1) Table 1"; `rules.ts:61` says "(b)(2) Table 2"; also `rules.ts:114,121` | WRONG (cosmetic) | Rename in comments: "Table 2" (basic), "Table 3" (unknown); keep "Table 1" for `acclimState`. |

### A2. Unknown acclimatisation and Table 1 (ORO.FTL.205(b)(2)/(3), ORO.FTL.105(1))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Table 3, unknown state "X", 1–2 sectors | 11:00 → 10:30 / 10:00 / 9:30 / 9:00 (3–8 sectors) | `FDP_UNKNOWN = 11h` `rules.ts:62`; step/floor `rules.ts:129-130` | MATCH | – |
| Table 4, unknown state with approved FRM | 12:00 → 11:30 / 11:00 / 10:30 / 10:00 / 9:30 / 9:00 | not present | MISSING (optional) | Only with an "FRM" company approval: `FDP_UNKNOWN_FRM = 12h`. Otherwise leave out (correct without FRM). |
| Table 1: < 4 h difference | B < 48 h, then D | `acclimState` `rules.ts:181-183` (`deltaH < 4 → 48`) | MATCH | – |
| ≤ 6 h | B < 48, X 48–71:59, D ≥ 72 | `rules.ts:182` | MATCH | – |
| ≤ 9 h | B, X, X, D ≥ 96 | `rules.ts:182` | MATCH | – |
| ≤ 12 h | B, X, X, X, D ≥ 120 | `rules.ts:182` | MATCH | – |
| Elapsed time is measured since reporting at reference time; the difference is between reference time and where the next duty starts | ORO.FTL.105(1), GM1–3 | `referenceTime(p.base, dep, min(p.start, report), report)` `duties.ts:79`, `timeline.ts:166` | SIMPLIFIED-OK | Reference is always the home base clock. Not modelled: "moving on while X stays X" and "use the greatest difference" (GM). Acceptable. |
| X crew: augmented limits independent of acclimatisation | guide §6.2 "do not vary with report time or WOCL" | `maxFdp` augmented branch ignores `acclimatised` `rules.ts:123-127` | MATCH | – |

### A3. Cabin crew FDP and early reporting (ORO.FTL.205(c))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Cabin crew FDP extended by the reporting difference, max 1:00 | ORO.FTL.205(c) | `BAL.v072.ftl.cabinEarlyMin = {narrow: 0, wide: 15}` `balance.ts:268`; `cabinEarlyOf` `timeline.ts:138-141` | MATCH (≤ 1 h) | Optionally narrowbody 15 (many operators report cabin crew 15 min earlier). Clamp any future value to ≤ 60. |
| Max FDP still based on the flight crew's report | ORO.FTL.205(c), guide §7 Example 4 | `dutySegs` FDP and max both `+ early` `timeline.ts:395-398`; `virtualSeg` `duties.ts:649-652` | MATCH | – |
| Earlier report never allows a later finish | guide §7 | finish = the pilots' on-blocks | MATCH | – |
| On an augmented duty the cabin crew FDP must stay inside the CS FTL.1.205(c)(3) table | guide §6.3 | `Math.min(FDP_CAP, fdp, cabinFdpCap(cls) − cabinEarly)` `rules.ts:127` | SIMPLIFIED (see A7) | Better: when the cap binds, **set the cabin early report to 0 for that duty** (common practice on long sectors) instead of cutting the pilots' limit; only then cap. |

### A4. Planned extension without in-flight rest (ORO.FTL.205(d), CS FTL.1.205(b))

Nothing is simulated: `EASA-FTL.md:91-102` and `UPDATE-0.7.2.md:180,590`. Every row below is **MISSING**. The guide makes it central for short/medium-haul ACMI.

| Rule | Guide value | Game | Status | Correction (implement in `rules.ts` + `pickAugment` as option "ext" before augmentation) |
|---|---|---|---|---|
| Amount | up to +1:00 (ORO.FTL.205(d)) | – | MISSING | Add `EXT_TABLE` (below), not "basic + 60" (the 06:15–06:59 rows are only +0:15/+0:30/+0:45). |
| Frequency | max 2× in any 7 consecutive days **per crew member** (EASA FAQ) | – | MISSING | Add `Seg.ext: boolean`. In `evalSegs` (`rules.ts:361`), count `ext` segs in a rolling 7 days per crew: more than 2 is illegal (new IssueCode `'ext7d'`). |
| Acclimatised only | guide §6.1 | – | MISSING | Not when `ref.state === 'X'`. |
| No extension for reports 19:00–06:14 | CS FTL.1.205(b) | – | MISSING | Table rows below. |
| Sector limits by WOCL encroachment | 5 sectors if WOCL (02:00–05:59) not encroached; 4 if encroached ≤ 2 h; 2 if > 2 h | – | MISSING | Compute the encroachment of [report, last on-blocks] on 02:00–05:59 (reference tz). |
| Extension table (CS FTL.1.205(b)), max FDP for 1–2 / 3 / 4 / 5 sectors | 06:00–06:14 none · 06:15–06:29 13:15/12:45/12:15/11:45 · 06:30–06:44 13:30/13:00/12:30/12:00 · 06:45–06:59 13:45/13:15/12:45/12:15 · 07:00–13:29 14:00/13:30/13:00/12:30 · 13:30–13:59 13:45/13:15/12:45/– · 14:00–14:29 13:30/13:00/12:30/– · 14:30–14:59 13:15/12:45/12:15/– · 15:00–15:29 13:00/12:30/12:00/– · 15:30–15:59 12:45/–/–/– · 16:00–16:29 12:30 · 16:30–16:59 12:15 · 17:00–17:29 12:00 · 17:30–17:59 11:45 · 18:00–18:29 11:30 · 18:30–18:59 11:15 (1–2 sectors only from 15:30) · 19:00–06:14 none | – | MISSING | `EXT_TABLE: [from, to, s12, s3, s4, s5 \| null][]` exactly as listed. |
| Compensating rest | +2 h pre **and** +2 h post, or +4 h post (ORO.FTL.205(d)(1)); consecutive extended FDPs get the extra rest consecutively | – | MISSING | Simplest: `Seg.rest += 4h` after an extended FDP (post option). `minRest` gains `extended?: boolean`. |
| Not combinable with in-flight rest or split duty in the same duty period | ORO.FTL.205(d)(4) | – | MISSING | `pickAugment`: options `{0, ext, aug1, aug2}` are mutually exclusive. |
| Must be planned in advance (not on the day) | guide §6.1 | – | MISSING | Only `partition()`/`planAircraft` may set `d.ext`; `syncDuty` keeps it, never adds it after report. |
| Discretion base after an extension = basic FDP | GM1 ORO.FTL.205(f)(1)(i) | – | N/A now | When `d.ext`: discretion limit = `basic + 2h` (not `extended + 2h`). Store `d.basicFdp`. |
| Cabin crew | same rule per individual (guide §7) | – | MISSING | The cabin crew count their own 2-in-7. |

### A5. Augmented flight crew (ORO.FTL.205(e), CS FTL.1.205(c))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| +1 pilot: class 3 / 2 / 1 | 14:00 / 15:00 / 16:00 (c)(2)(i) | `AUG_FDP[1] = {1:16h, 2:15h, 3:14h}` `rules.ts:70` | MATCH | – |
| +2 pilots: class 3 / 2 / 1 | 15:00 / 16:00 / 17:00 (c)(2)(ii) | `AUG_FDP[2]` `rules.ts:71` | MATCH | – |
| Long-sector bonus | +1:00 if one sector has > 9 h **continuous flight time** and ≤ 2 sectors ((c)(4)) | `AUG_BONUS = 60`, `AUG_BONUS_FT = 9h` `rules.ts:74-75`; test `sectors ≤ 2 && longestBlock − 20 > 540` `rules.ts:125` | MATCH / SIMPLIFIED-OK | Flight time is block − `TAXI_ALLOWANCE` 20 min (`rules.ts:79`). Fine. |
| Max sectors with augmentation | 3 ((c)(1)) | `AUG_MAX_SECTORS = 3` `rules.ts:76,123`; `duties.ts:44` | MATCH | – |
| Overall cap | 18:00 (4 pilots, class 1, bonus) | `FDP_CAP = 18h` `rules.ts:77` | MATCH | – |
| Minimum in-flight rest: 90 consecutive min each pilot; **2 consecutive h for the landing pilots** | (c)(1), guide §6.2 | **not checked** | MISSING | Add `restPlan()` (§C2). In `pickAugment` (`duties.ts:43-50`) an option is valid only when `restPlan(...).ok`. |
| "If the cruise is too short for this, no extension" | EASA FAQ, guide §6.2 | not checked: a 3-sector 14 h augmented day with 3 h cruises is accepted | MISSING | Same `restPlan()`: rest only in cruise (after top of climb, before top of descent). Sequential slots per facility place. |
| Rest allocated to optimise landing-pilot alertness | GM, guide §6.2 | – | MISSING (presentation) | In `restPlan`, landing pilots rest last (ending ≥ 30 min before top of descent). |
| Time in rest facility counts as FDP and as duty | GM1 ORO.FTL.105(17) | FDP = report → last on-blocks `duties.ts:36` | MATCH | – |
| Rest at destination after augmented FDP ≥ duty or 14 h | CS FTL.1.205(c)(6), guide §6.2 / §12.1 | `minRest`: `if (!atHome && (augmented \|\| tz ≥ 4)) base = 14h` `rules.ts:148` (home: 12 h) | WRONG (minor) | Apply 14 h after an augmented FDP **wherever the destination is**: `if (i.augmented \|\| (!i.atHome && i.tzShift >= 4)) base = 14 * H`. Rarely binds (duty is usually > 14 h). |
| No positioning sector to join the operating crew on the same flight | guide §6.2 | relief pilot travels as crew | MATCH (by design) | – |
| Approval gate | (game) | `canAugment` needs company approval `'augmented'` `duties.ts:52` | game rule | – |
| Complement | (game) | +1 = CPT FO CRP, +2 = 2 CPT 2 FO `perf.ts:181` | SIMPLIFIED-OK | A CRP cannot be a landing pilot. Then the CPT/FO who land need the 2 h, which `restPlan` must use. |

### A6. Rest facility classes (CS FTL.1.205(c))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Class 1 | bunk or flat/near-flat surface, ≥ 80° to vertical, **separate from flight deck and passenger cabin**, light control, noise isolation | `bunks: true → 1` `crewRest.ts:22` | MATCH (definition) | – |
| Class 2 | cabin seat ≥ 45° recline, pitch ≥ 55 in (137.5 cm), width ≥ 20 in (50 cm), leg/foot support, separated by at least a curtain, reasonably free from disturbance | **no class 2 exists** (`restClassAt` returns `1 \| 3 \| null`, `crewRest.ts:17`; UPDATE §15 `:591`) | MISSING | Add class 2 = curtained business (J) seats, or premium (W) seats where pitch ≥ 55 in. Typical business seats on all game widebodies qualify; check the pitch for W. |
| Class 3 | seat in cabin or flight deck ≥ **40°** recline with **leg and foot support**, curtain, not adjacent to an occupied passenger seat | "last economy row behind a curtain" `crewRest.ts:1-2,22`, `cabin.ts:244-247`, `glossary.ts:49-50` | WRONG | A standard economy seat reclines about 20–30° from vertical and has no leg rest, so it does not meet class 3. Either (a) the refit replaces the row with **crew rest recliners with leg rests** (higher cost, see §C5), or (b) rename the current item "curtained economy row: not a rest facility" and refuse augmentation on it. Recommend (a). |
| Separate pilot and cabin facilities | (c)(2) uses the flight crew facility; (c)(3) uses the cabin crew facility | one value for both (`maxFdp` uses `restClass` for the pilots' table **and** `cabinFdpCap(restClass)` `rules.ts:124,127`) | WRONG (model) | Split into `fcClass` and `ccClass` (§B3). `AUG_FDP[aug][fcClass]`; `cabinFdpCap(ccClass)`. |
| Fallback when the airframe has no `crewRest` | – | `ACMI_TYPES[typeId]?.restClass ? 1 : null` `crewRest.ts:21` | SIMPLIFIED (bug-prone) | Return `t.restClass` (not a hard 1). Harmless today because every non-null `restClass` is 1. |

### A7. Cabin crew in-flight rest (CS FTL.1.205(c)(3))

| FDP band (cabin crew FDP) | Guide class 1 / 2 / 3 | Game `CABIN_REST` row | Status |
|---|---|---|---|
| up to 14:30 | 1:30 / 1:30 / 1:30 | `{14h30, 90, 90, 90}` `rules.ts:89` | MATCH |
| 14:31–15:00 | 1:45 / 2:00 / 2:20 | `rules.ts:90` | MATCH |
| 15:01–15:30 | 2:00 / 2:20 / 2:40 | `rules.ts:91` | MATCH |
| 15:31–16:00 | 2:15 / 2:40 / 3:00 | `rules.ts:92` | MATCH |
| 16:01–16:30 | 2:35 / 3:00 / not allowed | `rules.ts:93` | MATCH |
| 16:31–17:00 | 3:00 / 3:25 / not allowed | `rules.ts:94` | MATCH |
| 17:01–17:30 | 3:25 / not allowed / not allowed | `rules.ts:95` | MATCH |
| 17:31–18:00 | 3:50 / not allowed / not allowed | `rules.ts:96` | MATCH |
| **18:01–18:30** | **not in the guide** (table ends at 18:00; guide §0 TL;DR "up to an 18:00 FDP") | `{18h30, 265, null, null}` `rules.ts:97` | **WRONG** |

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Longest cabin FDP per class | class 1 18:00, class 2 17:00, class 3 16:00 | `cabinFdpCap` → 18:30 / 17:00 / 16:00 `rules.ts:108-112` | WRONG (class 1) | Delete `rules.ts:97`. Update `ftl.test.ts:301` (drop `[1110, 265, …]`), `:308` (`cabinInflightRest(18:15, 1)` → `null`), `:312` (→ `[18:00, 17:00, 16:00]`), `EASA-FTL.md:154,168`. Effect: 4 pilots + class 1 + bonus with a 15 min cabin early report goes from 18:00 to 17:45, unless the cabin early report is dropped for that duty (A3). (Some printings of CS FTL.1 are said to carry an 18:30 row. The player's guide is authoritative here.) |
| Each cabin crew member must *receive* the minimum rest; the operator must show the cruise allows it given facilities, crew numbers and service (CAP 1265, guide §6.3) | guide §6.3 | `cabinInflightRest()` `rules.ts:101-105` is **never called** outside tests (grep) | MISSING | Use it in `restPlan()` (§C2) and size cabin crew from it. |
| Which facility class is used | the cabin crew's facility | the aircraft's single class | WRONG (model) | §A6 / §B3. |
| Extra cabin crew for rest | not a regulation; a consequence of the rest plan | `complement()`: `+1 above 14:30, +2 above 16:00` on class 2/3 `perf.ts:183`, using the **pilots'** FDP | SIMPLIFIED | Replace with the cabin rest rotation result from `restPlan()`: extra CC only when the shifts do not fit the cruise. Use the cabin FDP (pilot FDP + early). |
| Extra cabin crew within basic limits need no in-flight rest | guide §7 | augmented duties only | MATCH | – |

### A8. Commander's discretion (ORO.FTL.205(f))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Increase | +2:00, +3:00 augmented | `DISCRETION = {basic: 120, augmented: 180}` `rules.ts:82`; `applyDiscretion` `roster.ts:1086` | MATCH | – |
| Base | the ORO.FTL.205(b) basic FDP even after a planned extension; (e) augmented or 220 split | `d.maxFdp + d.discretion` (`duties.ts:68`) | MATCH today (no extension) | When extension is added: `basic + 2h`, not `ext + 2h` (§A4). |
| Only for unforeseen circumstances **at or after reporting** | guide §8 | auto at the gate only after report: `fdpOver` `flights.ts:640` (`d.report > g.now → false`) | MATCH there | – |
| Same, in Crew Control and the crew-short gate decision | guide §8 | `control.ts:1289-1300` and `events.ts:368` offer discretion with no `d.report <= g.now` test | WRONG | Add `d.report <= g.now` (or the delay arose after report) to both. Before report, offer delayed reporting or a re-roster instead (§A9). |
| Rest after: may be reduced, never below 10 h | ORO.FTL.205(f)(1)(iii) | the game never reduces rest; `DISCRETION.minRest` (`rules.ts:82`) is unused | SIMPLIFIED-OK (conservative) | – |
| Report to the authority within 28 days if > 1 h | ORO.FTL.205(f)(5) | – | MISSING (flavour) | Inbox note "Discretion report filed (> 1 h)" and a `stats.discretionReports` count. |
| Last sector: may continue once airborne | guide §8 | no check after departure | MATCH | – |
| Texts | +3 h augmented | `events.ts:397` "(max 2 h)"; `control.ts:121` "up to two hours"; `glossary.ts:28` "up to 2 hours once" | WRONG (text) | "up to 2 h (3 h with an augmented crew)". |
| Should be avoided at home base and hubs where standby exists | AMC1 ORO.FTL.205(f) | – | N/A | Optional morale/authority finding when used at home base. |

### A9. Delayed reporting (ORO.FTL.205(g), CS FTL.1.205(d))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| One notification, delay < 4 h | max FDP from the **original** report; FDP counts from the delayed report | `syncDuty` re-measures from the new report until crew have reported `duties.ts:77-78`; crew-rest slips `flights.ts:1023-1034`, `roster.ts:510-514` | WRONG (can be more permissive) | Store `Duty.notifiedReport` (the report when crew were last told, e.g. at roster publication or 12 h before). If `report − notifiedReport < 4h`, `max = maxFdp(at notifiedReport)`. |
| Delay ≥ 4 h | more limiting of original and delayed | as above | WRONG | `max = min(maxFdp(orig), maxFdp(delayed))`. |
| Delay ≥ 10 h, crew not disturbed | counts as rest; new FDP | – | MISSING | If `report − notifiedReport ≥ 10h`, re-measure normally. |
| Second notification | FDP starts 1 h after the 2nd notice or at the first delayed time if earlier | – | MISSING (optional) | Can be skipped; note in EASA-FTL.md. |

Example of the current error: report 04:30 local (17:00–04:59 row → 11:00), delayed to 06:00. The game gives 13:00; the guide gives 11:00.

### A10. Cumulative limits (ORO.FTL.210) and what counts

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Duty 7 / 14 / 28 days | 60 / 110 / 190 h | `LIMITS.duty7d/14d/28d` `rules.ts:154-156` | MATCH | – |
| Flight time 28 days | 100 h | `block28d` `rules.ts:157` | MATCH | – |
| Calendar year | 900 h | `blockYear` `rules.ts:158`, check `rules.ts:432` | MATCH | – |
| 12 consecutive calendar months | 1,000 h | `block12m` `rules.ts:160`; `timeline.ts:144-151`; check `rules.ts:433` | MATCH | – |
| Post-flight duty counts as duty | ORO.FTL.210(c) | `release = lastOn + post` `duties.ts:36`, `perf.ts:168-170` (30/45 min) | MATCH | – |
| Positioning counts in full as duty | ORO.FTL.215(b) | `pos` segs counted by `windowsAt` `rules.ts:309-346` | MATCH | – |
| In-flight rest counts in full | GM1 ORO.FTL.105(17) | inside FDP | MATCH | – |
| Airport standby 100 %, other standby 25 %, reserve 0 | ORO.FTL.225(c), CS FTL.1.225(b)(3), CS FTL.1.230(b) | standby/reserve not modelled | N/A | Apply when standby is added (§A13). |
| Flight time only as operating crew | guide §10 | `posSeg.block = 0` `timeline.ts:378` | MATCH | – |
| Spread 190 h "as evenly as practicable" | ORO.FTL.210(a) | – | N/A | – |

### A11. Positioning (ORO.FTL.215)

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Positioning after reporting, before operating = FDP, not a sector | guide §11.1 | merged ticket out `timeline.ts:400-410` (start moves to ticket, `sectors` unchanged, limit from ticket origin) | MATCH | – |
| After the last operating sector = duty, not FDP | guide §11.1 | merged ticket home `timeline.ts:415-418` (end moves, FDP unchanged) | MATCH | – |
| All positioning is duty | guide §11.1 | `pos` segs | MATCH | – |
| Code cites | ORO.FTL.215 | `EASA-FTL.md:226` cites "ORO.FTL.220" | WRONG (doc) | → ORO.FTL.215 (220 is split duty). |

### A12. Split duty (ORO.FTL.220, CS FTL.1.220): **MISSING** (documented only, `EASA-FTL.md:218-220`)

| Rule | Guide value | Correction |
|---|---|---|
| Break | ≥ 3 consecutive h net on the ground | `SPLIT_MIN_BREAK = 180`. |
| Excluded from the break | pre/post-flight duties and travel, min 30 min total | net = ground time − max(30, actual). |
| Increase | up to 50 % of the break added to the (b) max | +1:30 for 3 h … +3:00 for 6 h, +4:00 for 8 h (only with suitable accommodation and no WOCL). |
| Accommodation | needed; *suitable* accommodation if the break is ≥ 6 h or encroaches the WOCL. Otherwise time beyond 6 h or inside the WOCL does not count. | Day room / hotel cost per station. |
| Not with in-flight rest, planned extension, or after reduced rest | (f), ORO.FTL.205(d)(4), ORO.FTL.220(c) | Mutually exclusive option in `pickAugment`. |
| Break counts as FDP | ORO.FTL.220(b) | – |
| 16 h ceiling (FAQ, guide §5.1) | – | cap split FDP at 16:00. |
| Why it matters | Narrowbody ACMI with a long wait at an outstation (e.g. ski charters out and back with a 4–6 h ground stop) | Lets one crew fly instead of slipping. |

### A13. Standby and reserve (ORO.FTL.225/230, CS FTL.1.225/230): **MISSING**

| Rule | Guide value | Game | Correction |
|---|---|---|---|
| Airport standby | 100 % duty; FDP reduced by standby beyond 4 h; standby + FDP ≤ 16 h; accommodation provided | Crew Control "call in" uses off-duty crew `control.ts:120,877-895` | Add rostered airport standby at home base, which removes the need to call in people on days off. |
| Other standby | ≤ 16 h; 25 % counts; FDP reduced by standby beyond 6 h (8 h if augmented or split); 23:00–07:00 does not count towards the reduction until contacted; ≤ 18 h awake (standby + FDP) | – | Home standby with the 6/8 h thresholds and the 18 h awake check. |
| Reserve | ≥ 10 h notice (may include the 8 h no-contact period); 8 h protected; 0 % duty; cannot later become recurrent recovery | – | Optional "reserve days". |
| Calendar placeholder | – | `calendar.ts:19` "'standby' is reserved: the engine has no standby duty yet" | – |

### A14. Rest periods (ORO.FTL.235)

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Home base | ≥ preceding duty or 12 h | `minRest` `rules.ts:147-149` | MATCH | – |
| Away | ≥ preceding duty or 10 h incl. 8 h sleep | `rules.ts:147-149` | MATCH | – |
| Travel to accommodation > 30 min | rest + 2 × (travel − 30 min) (AMC1 ORO.FTL.235(b); guide Example 7) | – | MISSING | Add `hotelTransferMin` per airport (default 20–30). `minRest(away) += 2 × max(0, transfer − 30)`. Big airports (LHR, JFK, CDG, DXB) 45–60 min → +30 to +60 min. |
| Physiological needs | 1 h (within the 10 h) | implicit | MATCH | – |
| Back-to-back at home base with suitable accommodation | away minimum may apply (GM1 ORO.FTL.235(a)(2)) | – | N/A | – |
| Reduced rest | FRM only; min 12/10 h; max 2 between recovery rests | not used | MATCH (by absence) | Do not add without an FRM approval. |
| After extension | +2/+2 or +4 h | – | MISSING with §A4 | – |
| After augmented | ≥ duty or 14 h | `rules.ts:148` | see A5 | – |
| After discretion | never below 10 h | never reduced | SIMPLIFIED-OK | – |
| Helper callers drop the tz/augmented inputs | – | `duties.ts:124` (`tzShift: 0`), `events.ts:275` (`tzShift: 0`), `control.ts:808,1272` | SIMPLIFIED | Pass the real `tzDeltaH` in `splitUnderWay` (`duties.ts:124`), because it decides a crew hotel stop. |

### A15. Recurrent extended recovery rest (ORO.FTL.235(d))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Length | ≥ 36 h incl. 2 local nights | `LIMITS.recovery = 36h` `rules.ts:161`; 2 nights `rules.ts:386`, `rules.ts:453`, `index.ts:82` | MATCH | – |
| Spacing | ≤ 168 h between end of one and start of next | `recoveryEvery = 168h` `rules.ts:164`; check `rules.ts:435` | MATCH | – |
| 2 local days twice every month | ORO.FTL.235(d) | not enforced; `EASA-FTL.md:207-208` says the 6-on/2-off block "already gives them" | MISSING | 6-on/2-off is only applied to trip building and tours (`duties.ts:603,694`), counts report days only (`rules.ts:468-476`) and is not checked in `evalSegs`. Add: per calendar month (home base tz), ≥ 2 recovery rests that each contain 2 whole local days (00:00–24:00 × 2, i.e. ≥ 3 local nights). Issue code `'recovery'`, text "Needs a 2-day weekend twice a month". |
| After 4 or more disruptive duties | next recovery 60 h (CS FTL.1.235(a)(2)) | `recoveryLong = 60h`, `disruptiveMax = 4`, `>=` `rules.ts:163,166,385` | MATCH | – |
| Home base change | first recovery 72 h incl. 3 local nights (CS FTL.1.200(b)) | crews never change base | N/A | – |

### A16. Disruptive schedules, night duty, WOCL (ORO.FTL.105(8),(9),(28), CS FTL.1.235(a), CS FTL.1.205(a))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Early type: early start 05:00–05:59, late finish 23:00–01:59 | ORO.FTL.105(8) | `isDisruptive` = touches local 23:00–06:00 `rules.ts:209-216` | MATCH (early type) | A duty ending exactly at 23:00 is not counted (strict `<`). Negligible. |
| Late type: early 05:00–06:59, late 00:00–01:59 | chosen by the authority (ARO.OPS.230) | not selectable | SIMPLIFIED-OK | Add `company.ftlType: 'early' \| 'late'` (authority of the AOC state; Portugal/LIS is not in the guide's list, so default early). |
| Night duty | encroaches 02:00–04:59 | inside the 23:00–06:00 window | MATCH | – |
| WOCL | 02:00–05:59 | not used anywhere | MISSING | Needed for extension sector limits (§A4) and the night subtypes. |
| Reference zone | acclimatised time zone | `referenceTime(...).tz` `timeline.ts:399`, `duties.ts:647` | MATCH | – |
| Late finish / night duty → early start at home base needs 1 local night in the rest | CS FTL.1.235(a)(1) (applies when the early duty is an FDP or standby leading to an FDP) | – | MISSING | `isDisruptive` → `disruptiveKinds(tz,start,end): {early, late, night}`. In `evalSegs`: if `prev.late \|\| prev.night` and `s.early && s.from === base` and `nightsIn(base, prev.end, s.start) < 1`, raise `'rest'` illegal "Needs a local night before an early start". |
| Consecutive nights | ≤ 4 sectors per night FDP | – | MISSING | see A1. |
| Appropriate FRM for nights > 10 h and late finishes; 3 night subtypes | CS FTL.1.205(a)(2)/(3) (ED 2023/023/R) | – | MISSING (flavour) | Optional: a "fatigue" chip on night FDPs > 10 h. |

### A17. Time-zone compensation (CS FTL.1.235(b))

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Away, after an FDP with ≥ 4 h difference | ≥ duty or 14 h ((b)(3)(ii)) | `rules.ts:148`; difference home↔rest airport `timeline.ts:385`, `duties.ts:654` | MATCH / SIMPLIFIED-OK | – |
| At home after a rotation with max difference ≥ 4 h: local nights | ≤ 6 h: 2/2/3/3 · ≤ 9 h: 2/3/3/4 · ≤ 12 h: 2/3/4/5 (columns < 48, 48–71:59, 72–95:59, ≥ 96 h since first report) ((b)(3)(i)) | not enforced (`EASA-FTL.md:207-209`) | MISSING | `TZ_NIGHTS` table. In `evalSegs`, when a seg starts at base after a rotation whose max `tzDeltaH ≥ 4`, require `nightsIn(base, returnEnd, s.start) ≥ TZ_NIGHTS[row][col]`. Example: LIS–CUN (−5/−6 h) 4-day rotation → 3 local nights at home. |
| Alternating E–W / W–E rotations | ≥ 3 local nights at home between them ((b)(4)) | – | MISSING | Track rotation direction; require 3 nights when it flips. |
| GM: clock stops on return; 3+ FDP rotations use the greatest difference | guide §12.5 | – | MISSING | Part of the same check. |

### A18. Definitions and admin

| Rule | Guide value | Game value | Status | Correction |
|---|---|---|---|---|
| Local night | 8 h within 22:00–08:00 | `nightsIn` `rules.ts:219-226` | MATCH | – |
| Local day | 24 h from 00:00 | – (needed for A15) | MISSING | – |
| Roster published 14 days ahead | AMC1 ORO.FTL.110(a) | `rosterHorizonDays: 14` `balance.ts:11` | MATCH (as horizon) | – |
| > 33 % of duties exceeding max FDP in a season → change the schedule | ORO.FTL.110(j) | – | MISSING (optional) | A seasonal robustness card. |
| Records 24 months | ORO.FTL.245 | log pruned to 28 days, 12 months of block | N/A | – |
| Days off 7 a month / 96 a year | not in the guide (Directive 2000/79/EC, single day free = 1 day + 2 local nights) | `daysOffInMonth` (shown, not enforced) `ftl.ts:79-87`; `EASA-FTL.md:211` cites "ORO.FTL.235(e)" | WRONG (citation) | Cite Directive 2000/79/EC, not ORO.FTL.235(e). |

### A19. The game's own margins and heuristics (not in the guide)

| Item | Game value | Assessment |
|---|---|---|
| "Tight" FDP margin | 30 min `rules.ts:168`, `duties.ts:69` | Fine as a game warning. Keep it measured against the legal max (incl. discretion once applied). |
| "Tight" cumulative share | 95 % `rules.ts:169` | Fine. |
| Roster slack | 60 min `balance.ts:140` | Fine. It is a robustness margin in the spirit of ORO.FTL.110(j). |
| Work block 6 days then 2 off | `rules.ts:171-172` | **Company policy, not EASA.** Label it as such in the UI and docs; it does not replace A15's 2-local-days rule. |
| Feasibility "max unaugmented FDP" | 13 h flat `feasibility.ts:69,495-496` | **WRONG**: use `maxFdp()` at the planned report local time and sectors (9:00–13:00; 14:00 with extension). Also check augmented feasibility against the aircraft's classes: e.g. "15:10 needs 3 pilots + class 1, or 4 pilots + class 2; CS-TQB has class 3 seats only (max 15:00 with 4 pilots, 16:00 with the long-sector bonus)". |
| Partition stop | 19 h (`duties.ts:353`) | Fine (search bound). |
| Same-day ticket home | ≤ 13 h door to door `timeline.ts:353` | Fine (game heuristic; positioning after FDP is duty, not FDP). |
| Trip continuation | ≥ 10 h between duties `duties.ts:603` | Fine. |
| Report/post-flight | 60/30 narrow, 90/45 wide `perf.ts:168-170` | Realistic (OM-defined). |
| Taxi allowance for the bonus | 20 min `rules.ts:79` | Fine. |
| Cabin minimum | 1 per 50 seats `perf.ts:163` (ORO.CC.100) | Not FTL; fine. |

---

## B. Rest facilities per aircraft type

### B1. What the game records today

- **Type level** (`src/data/acmiTypes.ts`): `restClass` (1 on every widebody, null on narrowbodies), `bunkShare` (share of airframes delivered with bunks), `yAbreast`, `cabinTypical`, `cockpitMin`, `pursers`.
- **Airframe level** (`Aircraft.crewRest = { bunks: boolean; seats: number }`):
  - Market roll: `bunks = bunkShare ≥ 1 || chance(bunkShare)`, `seats: 0` (`market.ts:158`).
  - Old-save and start-fleet default: every widebody gets bunks (`crewRest.ts:11-14`, `ops/index.ts:78,91`).
  - Rest seats are fitted by refit: `yAbreast` seats, 2 days, $30k (`balance.ts:276`, `cabin.ts:249-286`).
- **Rule effect:** bunks → class 1 for **both** pilots and cabin crew; seats → class 3 for both; nothing → no augmentation (`crewRest.ts:17-23`, `duties.ts:52`).
- **Gaps:**
  - No separate pilot and cabin facility.
  - No capacity (bunk count): 2 pilot bunks vs 8 cabin bunks changes how long rest takes.
  - No class 2.
  - Narrowbodies and the 757 can never rest crew.
  - "Rest seats" are plain economy seats, which do not meet class 3 (§A6).

| Type (acmiTypes.ts line) | Game: restClass / bunkShare / yAbreast / cabinTypical |
|---|---|
| A320ceo `:91-95` | null / 0 / 6 / 4 |
| 737-800 `:98-102` | null / 0 / 6 / 4 |
| A321ceo `:105-109` | null / 0 / 6 / 5 |
| A321neo (LR) `:112-116` | null / 0 / 6 / 5 |
| 757-200 `:119-123` | null / 0 / 6 / 6 |
| 767-300ER `:126-130` | 1 / 0.3 / 7 / 8 |
| A330-200 `:133-137` | 1 / 0.4 / 8 / 9 |
| A330-300 `:140-144` | 1 / 0.4 / 8 / 10 |
| A340-300 `:147-151` | 1 / 0.6 / 8 / 10 |
| 777-200ER `:154-158` | 1 / 0.85 / 10 / 10 |
| 777-300ER `:161-165` | 1 / 1 / 10 / 12 |
| 787-9 `:168-172` | 1 / 1 / 9 / 9 |
| A350-900 `:175-179` | 1 / 1 / 9 / 10 |
| A350-900ULR `:182-186` | 1 / 1 / 9 / 8 (cockpitMin 4) |
| 777-200LR `:189-193` | 1 / 1 / 10 / 10 (cockpitMin 4) |
| A380-800 `:196-200` | 1 / 1 / 10 / 17, 2 pursers |
| 747-400 `:203-207` | 1 / 1 / 10 / 13, 2 pursers |

### B2. What is realistic per type, with proposed defaults

**How to read this:**
- "FCRC" = flight crew rest compartment (pilots, class 1 bunks, usually 2 bunks plus a seat, near the flight deck).
- "CCRC" = cabin crew rest compartment (class 1 bunks: overhead on Boeing widebodies, lower-deck module on Airbus).
- "Class 2 seats" = curtained business seats (≥ 45°, ≥ 55 in pitch, ≥ 20 in wide; every business seat on the game's two-class widebodies qualifies).
- "Class 3 recliners" = crew rest recliners with leg rests replacing an economy row (a plain economy row does **not** qualify).
- **Shares are estimates** for an ACMI/charter used-aircraft market, built from the manufacturer offerings: CRCs are standard or near-standard on the long-range types and optional (often deleted, especially on ex-regional or charter airframes) on the 767/A330.
- Bunk counts are typical, not exact.

| Type | Real-world rest facilities | Proposed FCRC share (pilots, class 1) | Proposed CCRC share (cabin, class 1; bunks) | Default when not fitted | Reasoning |
|---|---|---|---|---|---|
| A320ceo / 737-800 / A321ceo | None. Sectors ≤ 5–6 h always fit Table 2. | 0 | 0 | none | Economy-only narrowbodies have no seat meeting 40° + leg rest. Augmentation never needed. |
| A321neo (LR) | None as delivered. Sectors to ~8:30 block; FDP usually fits 13:00 (or 14:00 with an extension). | 0 | 0 | none; **refit option: 2 class 3 crew recliners** (est. $80–120k, 3 days) allowing a 3-pilot class 3 day (max 14:00, or 15:00 with one sector > 9 h) | Real LR operators use extension or slip crews. A class 3 recliner pair makes 14 h possible for, e.g., LIS–Caribbean. |
| 757-200 | None as delivered. Transatlantic 757 ops sometimes carried a relief pilot resting in a curtained premium seat (class 2/3). | 0 | 0 | none; refit option: class 3 recliners (as A321LR); in a two-class 757 the J recliners usually miss 55 in pitch → class 3, not 2 | Gives the 757 a niche (14:00 with 3 pilots) without bunks. |
| 767-300ER | No overhead CRC like the 777. Some network-carrier airframes have a crew rest module; most charter/ACMI 767s rest pilots and cabin crew in curtained business seats (class 2) or seats in the last rows. | 0.25 | 0.15 (lower-lobe module, 6 bunks) | Pilots: class 2 J seats (2 blocked J). Cabin: class 2 J/W seats if ≥ 4 J, else class 3 recliners. | Matches the player's euroAtlantic-type 767s: business seats blocked for rest. |
| A330-200 | Optional FCRC (2 bunks, lower deck forward or behind the cockpit) and optional Lower Deck Mobile Crew Rest (LDMCR: removable module in the aft hold, 6–8 bunks, takes cargo positions). Network long-haul airframes usually have them; ex-charter often not. | 0.45 | 0.4 (7 bunks) | class 2 J seats for both | The -200 is the long-range A330. |
| A330-300 | As above but more often regional/high-density without CRC. | 0.35 | 0.3 (7 bunks) | class 2 J seats | – |
| A340-300 | Built for long haul; lower-deck crew rest and FCRC on most. | 0.8 | 0.75 (8 bunks) | class 2 J seats | Raise from 0.6. |
| 777-200ER | Overhead FCRC (fwd, 2 bunks) and overhead CCRC (aft, 6–10 bunks) on most long-haul airframes; some early/regional ones lack them. | 0.9 | 0.85 (8 bunks) | class 2 J seats | Close to today's 0.85. |
| 777-300ER | FCRC and CCRC standard in practice. | 1 | 0.95 (10 bunks) | class 2 J | – |
| 777-200LR | ULR: both standard. | 1 | 1 (8 bunks) | – | – |
| 787-9 | Fwd overhead FCRC (2 bunks) standard; aft overhead CCRC (6 bunks) on almost all long-haul operators. | 1 | 0.9 (6 bunks) | class 2 J | Lower CCRC share for low-cost 787s. |
| A350-900 | FCRC (2 bunks) standard on long-haul; CCRC (aft overhead or lower deck, ~8 bunks) on most. | 1 | 0.9 (8 bunks) | class 2 J | – |
| A350-900ULR | Both, enlarged. | 1 | 1 (8 bunks) | – | – |
| A380-800 | FCRC behind the main-deck cockpit; lower-deck cabin crew rest (12–18 bunks). | 1 | 1 (14 bunks) | – | – |
| 747-400 | Upper-deck FCRC behind the cockpit (2 bunks + seat); aft overhead CCRC (~8–10 bunks) on most. | 1 | 0.9 (10 bunks) | class 2 J | – |

**Notes:**
- Class 2 business seats as the "no-bunk default" is what real charter/ACMI operators do. It costs J revenue on rest flights only, so it fits the game's "seats still sell when nobody rests" idea.
- Old-save default (everything gets bunks, `crewRest.ts:11-14`): keep it for legality, but migrate to `fc: class 1 (2 bunks), cc: class 1 (type default bunks)`.

### B3. Proposed data model (replaces `{bunks, seats}`)

```ts
// core/types.ts
export interface RestFacility { cls: 1 | 2 | 3; kind: 'fcrc' | 'ccrc' | 'ldmcr' | 'jSeats' | 'wSeats' | 'recliners'; places: number }
export interface Aircraft { /* … */ crewRest?: { fc: RestFacility | null; cc: RestFacility | null } }
// data/acmiTypes.ts (per type)
fcrcShare: number; ccrcShare: number; ccrcBunks: number; ccrcKind: 'ccrc' | 'ldmcr';
```

**Migration:**
- `{bunks: true}` → `fc = {1,'fcrc',2}`, `cc = {1, ccrcKind, ccrcBunks}`.
- `{bunks: false, seats: n > 0}` → `fc = cc = {3,'recliners', n}` (flag "needs recliner refit" or grandfather).
- `{bunks: false, seats: 0}` on a two-class widebody → `fc = {2,'jSeats',2}`, `cc = {2,'jSeats', min(J, ⌈N/2⌉)}`.

**Rules:**
- `maxFdp` uses `AUG_FDP[aug][fc.cls]` and `cabinFdpCap(cc.cls)`.
- `restPlan` (§C2) uses `places`.
- Seats blocked on rest flights = `places` of every seat-based facility (J or W or Y).

---

## C. Proposal: in-flight rest as a big, calm, visible feature

Design voice: the player is a non-planner. Every number appears once, with a plain "why" and one button to fix it. Nothing flickers; the views are static.

### C1. The idea in one line

Every widebody shows **who sleeps where, for how long, on every long flight**. The aircraft's rest facilities decide how long a day can be. When a flight doesn't fit, the game says why in one sentence and offers the fix (a 4th pilot, more cabin crew, block business seats, or a refit).

### C2. Engine: `restPlan()` (pure)

```ts
export interface RestSlot { who: string /* crewId or 'P1'..'P4' / 'C1'.. */; role: Role; where: RestFacility['kind']; cls: 1|2|3; sector: string /* flightId */; start: Minute; end: Minute; need: number; landing?: boolean }
export interface RestPlan { ok: boolean; why: string | null; fcClass: 1|2|3|null; ccClass: 1|2|3|null;
  pilots: RestSlot[]; cabin: RestSlot[]; cabinNeed: number /* min each, CS FTL.1.205(c)(3) */;
  blockedSeats: { j: number; w: number; y: number }; extraCabin: number; cruise: { flightId: string; from: Minute; to: Minute }[] }
export function restPlan(g: GameState, dutyId: string, opts?: { augment?: 0|1|2; extraCabin?: number }): RestPlan;
```

**Algorithm (deterministic, cheap):**

1. **Cruise windows per sector:** from takeoff + 30 min (top of climb, after the first service starts) to scheduled on-blocks − 45 min (top of descent + taxi). Rest only in these windows (guide §6.2).
2. **Pilots:**
   - n = 2 + augment. The landing pilots of the last sector need 120 consecutive min; the others need 90 (CS FTL.1.205(c)(1)).
   - `fc.places` pilots rest at once. Fill sequentially, putting the landing pilots last, ending ≥ 30 min before top of descent (GM).
   - If any slot does not fit in one sector's window, the plan is not ok: "the cruise is too short for in-flight rest" (EASA FAQ). The augmentation option is then refused in `pickAugment`.
3. **Cabin crew:**
   - Cabin FDP = pilot FDP + early; `need = cabinInflightRest(cabinFdp, cc.cls)` (null → refused with "class X rest does not allow a hh:mm cabin crew day").
   - Service rule (game assumption based on CAP 1265's "service requirements", not a regulation): at least ⌈N/2⌉ cabin crew stay in the cabin, plus no rest during the first 90 min after takeoff and the last 60 min before landing (meal services).
   - Shifts = ⌈N / min(cc.places, ⌊N/2⌋)⌉; feasible if shifts × need ≤ cruise − services.
   - If not, try `extraCabin` +1, +2 (this replaces `perf.ts:183`). Still not → not ok.
4. **Seats:** blocked J/W/Y = places of seat-based facilities (only on flights of that duty), feeding `sellableSeats` (`crewRest.ts:39-43`).

**Uses:**
- `pickAugment` (`duties.ts:43-50`): options `0 → ext (§A4) → aug1 → aug2`, each valid only if legal **and** `restPlan.ok`.
- `complement()`: `extraCabin` from the plan.
- Contract feasibility (`feasibility.ts:489-512`): the plan for the longest duty.
- Cards, flight sheet and duty modal.

### C3. Where the player sees it

1. **Fleet card and Market listing** (`Fleet.tsx:137-143,190-191`, `Market.tsx:78-79`). Replace the single "Crew rest: bunks" chip with a two-line block:
   - `Pilots rest: bunks (class 1, 2 bunks)` · `Cabin crew rest: lower-deck module (class 1, 7 bunks)`
   - `Longest day: 16 h with 3 pilots · 17 h with 4 (18 h on one long sector)`. Computed from `AUG_FDP` and `cabinFdpCap`, so a no-bunk A330 reads `Longest day: 15 h with 3 pilots (business seats, class 2) · 16 h with 4`.
   - Market: a filter chip "Has bunks"; offers show the rest line next to the price, because bunks are worth money.
2. **Aircraft art** (`components/aircraft/AircraftArt.tsx`): a small static bunk glyph drawn where the compartment really is:
   - over the forward cabin (777/787/A350 FCRC);
   - aft overhead (777/787/747 CCRC);
   - in the aft hold (A330/A340 LDMCR);
   - upper deck (747).
   - Curtained seats show as a tinted seat block in the J cabin. No animation.
3. **Flight sheet** (`BlockSheet.tsx:54-62`): a new section, **In-flight rest**:
   - A thin static bar for the sector: `Takeoff · cruise · top of descent`.
   - Rows `Pilots` / `Cabin crew` with blocks labelled `Capt. Silva 2:00 · bunk · lands`, `FO Costa 2:00 · bunk · lands`, `CRP Reis 1:30 · bunk`.
   - Cabin crew groups: `Group A (4) 2:15 · lower deck`, `Group B (5) 2:15 · lower deck`.
   - One verdict chip: `Rest plan OK` / `Tight: 10 min spare` / `Not possible`.
   - Plus the existing seats line: `Seats 309 · 305 sellable (4 business seats blocked for crew rest)`.
4. **Duty modal** (`DutyModal.tsx:237`): replace `FDP 15:20 of 16:00 · +1 pilot` with three lines:
   - `Day length 15:20 of 16:00`
   - `Why 16:00? 3 pilots with bunks (class 1) allow 16 h. With business seats it would be 15 h; with no rest, 13 h.`
   - `Cabin crew: 15:35 day (report 15 min earlier) → each needs 2:15 rest (band 15:31–16:00, class 1).`
   - Tap opens the same rest bar as the flight sheet.
5. **Contract offer / feasibility** (`OfferModal.tsx:219`, `feasibility.ts`): one line per candidate aircraft, for example:
   - `CS-TQA: bunks → 3 pilots, 16 h limit ✓`
   - `CS-TQB: business seats (class 2) → 4 pilots, 16 h ✓ · 4 business seats blocked on the long legs`
   - `CS-TQC: no rest → ✗ needs crew rest (Refit…)`
6. **Roster board:** the augmented-duty bar gets a small bed icon and "3P" or "4P", so long-haul days stand out.

### C4. Plain-language cards (v0.7.1 four-line format)

- **`restFacility`** (amber):
  - WHAT: "AWQ201 LIS–GRU needs a 4th pilot."
  - WHY: "This A330 has no bunks: business seats are class 2 rest, which allow 15 h with 3 pilots. The day is 15:40."
  - HURT: "A 4th pilot's pay and hotel; 2 more business seats blocked."
  - ACTIONS: [Use CS-TQA (has bunks)] [Plan a crew rest refit] [Accept the 4th pilot].
- **`restTooShort`** (red):
  - WHAT: "No in-flight rest possible on AWQ315."
  - WHY: "The cruise is 3:10; the landing pilots each need 2 hours in a row. Without rest the limit is 13 h; the day is 14:05."
  - ACTIONS: [Fly it with a fresh crew at the fuel stop] [Retime the first leg] [Split into two days].
- **`cabinRest`** (amber):
  - WHAT: "AWQ101 needs 2 more cabin crew."
  - WHY: "On a 16:10 day with class 2 seats, each flight attendant needs 3:00 rest. With 9 crew and half of them in the cabin, the cruise fits only if 11 fly."
  - HURT: "2 × per diem and hotel."
  - ACTIONS: [Accept] [Swap to an aircraft with bunks].
- **`restSeats`**: keep the existing card (`UPDATE-0.7.2.md:273`) but name the class and the seat kind: "4 business seats blocked (class 2 crew rest)".

Glossary additions: `restClass2`, `fcrc` ("pilots' bunk room by the cockpit"), `ccrc`, `ldmcr` ("a bunk module loaded into the cargo hold"), `inflightRest`, `landingPilots`. Fix `glossary.ts:28` (3 h augmented) and `glossary.ts:49-50` (class 3 = recliner with leg rest).

### C5. Refit options (Refit modal, second section; realistic but marked est.)

| Option | Applies to | Class | Time / cost (est.) | Trade-off |
|---|---|---|---|---|
| Curtain off business seats | widebodies with J (and 757/A321 J) | 2 if J pitch ≥ 55 in (all game widebody J), else 3 | 1 day, ~$15k (curtains, placards) | The J seats used are blocked only on rest flights, but J fares are lost then. |
| Crew rest recliners | widebodies; 757/A321LR (2 seats) | 3 | 3–4 days, ~$150–250k widebody / ~$80–120k narrowbody | Replaces the last Y row (yAbreast seats → 4–6 recliners); those still sell as economy on non-rest flights. |
| Lower-deck crew rest module (LDMCR) | A330, A340 (provisioned airframes) | 1 (cabin crew; can host pilots) | 5–7 days at home base if provisioned, ~$0.8–1.2M; not provisioned: 4–6 weeks at an MRO, ~$2M | Takes about 2–3 LD3 cargo positions (−cargo revenue on ACMI cargo-sharing deals; most ACMI is pax-only, so small). Removable (can be sold on). |
| Flight crew rest compartment | 767, A330 | 1 (pilots, 2 bunks) | 3–5 weeks at an MRO (C-check hub, `data/mro.ts`), ~$1.5–2.5M | Best done during a C-check (book together). |
| Overhead crew rest (777/787/A350/747 without one) | those types | 1 | 4–6 weeks at an MRO, ~$2–3M | Rare. Mostly a market choice (buy one with bunks). |

The modal states one line per option: "Opens: 16 h days with 3 pilots (was 15 h)". It uses the existing `refitSlots` (F6) and the C-check hub list for the MRO jobs.

### C6. Contracts, pricing, bot

- Long-haul offers show "Longest day 15:40 · needs 3 pilots + class 1, or 4 pilots + class 2". The client pays the ACMI rate; the augmented crew cost already flows through crew costs.
- ULR offers need class 1 for **both** pilots and cabin crew (`company.ts:215`).
- **Bot:**
  1. For an augmented job without bunks, use J seats (class 2) when J ≥ 4.
  2. Otherwise fit recliners.
  3. Fit an LDMCR on A330/A340 if it flies more than 8 augmented duties a month.
- Tests:
  - `restPlan` pilot 90/120 consecutive fits/doesn't fit (single 12 h sector vs 3 × 3 h sectors);
  - cabin shifts per class;
  - `maxFdp` with split `fcClass`/`ccClass`;
  - `cabinFdpCap` = 18:00/17:00/16:00;
  - feasibility lines;
  - save migration of `{bunks, seats}`.

---

## D. Points in the running v0.7.2 design (and its EASA-FTL.md) that contradict the guide

| # | Where | Says | Guide | Fix |
|---|---|---|---|---|
| 1 | `UPDATE-0.7.2.md:177`, `EASA-FTL.md:5` | CS FTL.1 = "ED Decision 2014/024/R" | ED Decision **2014/002/R**, amended by **ED Decision 2023/023/R** (night duties / late finishes) (guide §1) | Correct both; mention the 2023 amendment. |
| 2 | `UPDATE-0.7.2.md:179,191,205-206`; `rules.ts:51,61` | "ORO.FTL.205(b) Table 1 (acclimatised) and Table 2 (unknown)" | Table 2 = basic, Table 3 = unknown, Table 4 = FRM; Table 1 = acclimatisation (guide §4.1, §5) | Rename. |
| 3 | `UPDATE-0.7.2.md:180` | "ORO.FTL.205(d) planned extension (Table 4, …)" | Extension table = CS FTL.1.205(b); Table 4 is unknown acclimatisation with FRM | Fix the reference. |
| 4 | `UPDATE-0.7.2.md:182` (via RESEARCH F3), `EASA-FTL.md:154`, `rules.ts:97` | cabin table includes 18:30 → 4:25 | Table ends at 17:31–18:00 (3:50) | Drop the row (§A7). |
| 5 | `UPDATE-0.7.2.md:197` | "feasibility refuses an augmented duty whose FDP needs a cabin class that is 'not allowed' (cannot happen with today's pilot limits)" | It can happen: with a 15 min cabin early report, 4 pilots + class 3 + bonus (16:00 → cabin 16:15), 4 pilots + class 2 + bonus (17:00 → 17:15) and, under the guide's table, 4 pilots + class 1 + bonus (18:00 → 18:15) all exceed the cabin table | Reword. Also `EASA-FTL.md:168` ("Only 4 pilots on class 3 … feel it") is wrong: class 2 → 16:45 too, and class 1 → 17:45 after fix #4. |
| 6 | `UPDATE-0.7.2.md:22,244,256,262`, `glossary.ts:49-50`, `crewRest.ts:1-2` | crew rest seats = "the last economy row behind a curtain, class 3" | Class 3 needs ≥ 40° recline **and leg and foot support** (guide §6.2) | Make it recliners with leg rests (§C5), or don't call it class 3. |
| 7 | `UPDATE-0.7.2.md:591` (§15) | "No class 2 rest option … no business-seat crew rest" | Class 2 is defined by the guide and is exactly a curtained business seat | Not a legal contradiction (fewer options is conservative), but it removes the real-world standard for no-bunk widebodies. Add class 2 (§B2, §C5). |
| 8 | `UPDATE-0.7.2.md:233-256` | one rest class per airframe drives both the pilots' table and the cabin crew table | (c)(2) uses the flight crew facility, (c)(3) the cabin crew facility (guide §6.2–6.3) | Split facilities (§B3). |
| 9 | `UPDATE-0.7.2.md:184,200`, `EASA-FTL.md:207-208` | 2 local days twice a month "not enforced: the 6-on/2-off block already gives it" | Required by ORO.FTL.235(d). The 6/2 block is not checked in `evalSegs` and counts report days only | Enforce (§A15). |
| 10 | `UPDATE-0.7.2.md:256`, `EASA-FTL.md:169`, `rules.ts:148` | "rest after an augmented duty **away**: 14 h" | "after an augmented FDP: ≥ duty or 14 h" (rest at destination, guide §6.2/§12.1) | Apply at any destination (§A5). |
| 11 | `EASA-FTL.md:77` | "Consecutive nights (ORO.FTL.205(e)) … at most 4 sectors" | CS FTL.1.205(a)(1): for consecutive night duties the FDP is computed with at most 4 sectors | Fix the reference; enforce (§A1). |
| 12 | `EASA-FTL.md:91` | planned extension "(ORO.FTL.205(d), CS FTL.1.205(a))" | CS FTL.1.205(**b**) | Fix. Add the 3/4/5-sector columns and the "not allowed" cells to the doc's table (`EASA-FTL.md:97-99` lists 1–2 sectors only). |
| 13 | `EASA-FTL.md:109` | discretion: "Sectors after the WOCL may be limited" | Not in the guide's discretion section | Remove. |
| 14 | `EASA-FTL.md:112-113` | discretion "offered only by Crew Control on a duty already over its limit" | Only for unforeseen circumstances at or after reporting (guide §8). The code also offers it before report (`control.ts:1289-1300`, `events.ts:368`) | Restrict to `d.report <= now`. |
| 15 | `EASA-FTL.md:119,129` | rest classes "(CS FTL.1.205(b))"; augmented table "(c)(1)" | classes and augmented FDP are CS FTL.1.205(**c**): table (c)(2)(i)/(ii), bonus (c)(4), conditions (c)(1),(5)–(7), destination rest (c)(6), cabin table (c)(3) | Fix. |
| 16 | `EASA-FTL.md:193` | disruptive schedules "CS FTL.1.235(b)" | CS FTL.1.235(**a**) | Fix. |
| 17 | `EASA-FTL.md:195,203` | time zones "CS FTL.1.235(a)", "14 h … (a)(2)" | CS FTL.1.235(**b**)(3)(i) table; (b)(3)(ii) 14 h; (b)(4) alternating E/W | Fix; also enforce (§A17). |
| 18 | `EASA-FTL.md:211` | days off 7/month, 96/year "(ORO.FTL.235(e))" | not in the guide; that is Directive 2000/79/EC. ORO.FTL.235(e)(3) is the home-base-change recovery (72 h) | Fix the citation. |
| 19 | `EASA-FTL.md:226` | Positioning "(ORO.FTL.220)" | ORO.FTL.**215** (220 = split duty) | Fix. |
| 20 | `EASA-FTL.md:101-102`, `UPDATE-0.7.2.md:590` | "The roster never plans extensions; an over-long day is a Crew Control problem (commander's discretion …)" | Discretion is for unforeseen events on the day; a planned over-long day must be planned as an extension, augmentation or split duty, or not planned at all | Not wrong as a scope cut, but the fallback is wrong: an over-limit plan should be refused at planning, never handed to discretion. Today `partition` already refuses it. Make sure Crew Control's discretion fix (`control.ts:1291`) is not offered for planned duties. |
| 21 | `UPDATE-0.7.2.md:23` / `events.ts:397` / `control.ts:121` / `glossary.ts:28` | discretion "up to two hours" | +3 h with an augmented crew | Text fix. |
| 22 | `EASA-FTL.md:24` | WOCL → `isDisruptive()` (night duty) | WOCL (02:00–05:59) ≠ night duty (02:00–04:59); the WOCL drives the extension sector limits | Keep both concepts separate in code (`WOCL` constant). |

---

## Appendix: suggested order of work (smallest risk first)

1. **Text and doc fixes:**
   - comment table names (`rules.ts:51,61,114,121`);
   - EASA-FTL.md and UPDATE citations (§D 1–4, 11–19, 21–22);
   - glossary `:28`, `:49-50`;
   - `events.ts:397`, `control.ts:121`.
2. **Rules:**
   - drop the 18:30 row and update the tests;
   - discretion only after report;
   - 14 h after any augmented FDP;
   - `MAX_SECTORS` enforced;
   - `restClassAt` fallback (`crewRest.ts:21`).
3. **Feasibility:** `MAX_UNAUGMENTED_FDP` → `maxFdp` at the report time; class-aware augmented check.
4. **Delayed reporting** (`notifiedReport`).
5. **Disruptive kinds** (early/late/night) + the late→early local-night rule + the consecutive-night 4-sector cap + the 2-local-days twice-a-month check + the time-zone local-nights table and E/W rule.
6. **Split pilot/cabin facilities** (§B3) + class 2 + recliners + `restPlan()` + UI (§C).
7. **Planned extension** (§A4), then split duty (§A12), then standby (§A13).
