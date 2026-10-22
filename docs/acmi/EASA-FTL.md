# EASA flight time limitations: the BLOCK HOURS reference

Written for v0.7.2 "Crew Rules & Fleet" and kept as the reference for every later crew update. It restates the rules
by article from **Regulation (EU) No 965/2012, Annex III (Part-ORO), Subpart FTL** as amended by **Regulation (EU)
No 83/2014**, and the certification specifications **CS FTL.1** (ED Decision 2014/024/R). RESEARCH.md §5.1 holds the
same numbers in the order the game first used them; this file is the one to cite. Each section ends with a **Game**
line: what `src/engine/crew/rules.ts` implements, simplifies or leaves out. Times are h:mm; the engine works in
minutes at 15-minute resolution. Where a number is an estimate rather than the regulation it says "est.".

Scope: commercial air transport by aeroplane, scheduled and charter (ACMI included). The same Subpart applies to
**flight crew and cabin crew** unless an article says otherwise (cabin crew FDP, ORO.FTL.205(c); cabin in-flight rest,
CS FTL.1.205(c)). The FAA's Part 117 is not modelled.

---

## 1. Definitions (ORO.FTL.105)

| Term | Meaning | Game |
|---|---|---|
| **Duty** | Any task for the operator, including positioning, standby with duty, training, office work. | Every `Seg` (duty, pos) counts towards the duty windows. |
| **FDP** (flight duty period) | From report for a duty that includes a sector until on-blocks at the end of the last sector as an operating crew member. | `Duty.fdp` = report → last on-blocks; `Duty.release` adds post-flight duty. |
| **Reference time** | Local time at the place the crew member is acclimatised to (where the report time is read in the FDP tables). | `referenceTime()` |
| **Acclimatised** | Table 1 of ORO.FTL.105(1): state **B** (still on the departure time zone), **D** (acclimatised to the new place) or **X** (unknown state). | `acclimState()` |
| **WOCL** | Window of circadian low, 02:00–05:59 in the time zone the crew is acclimatised to. | `isDisruptive()` (night duty) |
| **Local night** | 8 hours between 22:00 and 08:00 local. | `nightsIn()` |
| **Disruptive schedule** | Early start (05:00–05:59), late finish (23:00–01:59), night duty (encroaching 02:00–04:59 in any part). The "late type" variants (early 05:00–06:59, late 00:00–01:59) are an operator choice. | `isDisruptive()` uses the early-type bands. |
| **Sector** | One flight between take-off and landing, as an operating crew member. | `Duty.sectors` |
| **Positioning** | Transferring a non-operating crew member at the operator's request (our airline tickets, "deadheads"). | Ticket segs (`kind: 'pos'`). |
| **Augmented crew** | More than the minimum flight crew so that each pilot can leave the controls for in-flight rest. | `Duty.augment` 1 (3 pilots) or 2 (4 pilots). |
| **Rest period** | A continuous, uninterrupted and defined period after a duty. | `Seg.rest` |

**Acclimatisation (ORO.FTL.105(1), Table 1).** Rows: time difference between the reference time and local time
where the next duty starts; columns: time elapsed since reporting at the reference time.

| Time difference | < 48 h | 48:00–71:59 | 72:00–95:59 | 96:00–119:59 | ≥ 120 h |
|---|---|---|---|---|---|
| < 4 h | B | D | D | D | D |
| ≤ 6 h | B | X | D | D | D |
| ≤ 9 h | B | X | X | D | D |
| ≤ 12 h | B | X | X | X | D |

Game: implemented as written (`acclimState`, pinned in `ftl.test.ts` "acclimatisation (B/X/D)").

---

## 2. Maximum daily FDP (ORO.FTL.205(b), (c))

**ORO.FTL.205(b)(1) Table 2: acclimatised crew members** (the game's code calls it Table 1: the first FDP table).
Start of FDP at reference time × sectors.

| Report | 1–2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|
| 06:00–13:29 | 13:00 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 |
| 13:30–13:59 | 12:45 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 |
| 14:00–14:29 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 |
| 14:30–14:59 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 | 9:00 |
| 15:00–15:29 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 | 9:00 |
| 15:30–15:59 | 11:45 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 | 9:00 | 9:00 |
| 16:00–16:29 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 | 9:00 | 9:00 |
| 16:30–16:59 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 | 9:00 | 9:00 | 9:00 |
| 17:00–04:59 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 | 9:00 | 9:00 | 9:00 |
| 05:00–05:14 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 | 9:00 |
| 05:15–05:29 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 | 9:00 |
| 05:30–05:44 | 12:30 | 12:00 | 11:30 | 11:00 | 10:30 | 10:00 | 9:30 | 9:00 | 9:00 |
| 05:45–05:59 | 12:45 | 12:15 | 11:45 | 11:15 | 10:45 | 10:15 | 9:45 | 9:15 | 9:00 |

Every cell equals the 1–2 sector value less 0:30 per sector above 2, never below 9:00. The table stops at 10 sectors.

**ORO.FTL.205(b)(2) Table 3: unknown state of acclimatisation (X).** 1–2: 11:00 · 3: 10:30 · 4: 10:00 · 5: 9:30 ·
6: 9:00 · 7: 9:00 · 8: 9:00. (Table 4, the same under an approved fatigue risk management scheme, starts at 12:00;
not used.)

**ORO.FTL.205(c) cabin crew.** The maximum daily FDP of cabin crew is the flight crew's, **extended by the
difference in reporting time** between cabin crew and flight crew, as long as the difference does not exceed 1 hour.
Cabin crew FDP counts from their own (earlier) report.

**Consecutive nights (ORO.FTL.205(e)).** FDPs encroaching the WOCL: at most 4 sectors (est. in the game's planner:
long rotations rarely meet it).

**Game:**
- `FDP_BANDS` (13 report bands → 1–2 sector FDP), `FDP_OUTSIDE` 11:00 (17:00–04:59), `SECTOR_STEP` 0:30,
  `FDP_FLOOR` 9:00, `MAX_SECTORS` 10, `FDP_UNKNOWN` 11:00 (state X). `baseFdp()`, `maxFdp()`.
- Cabin crew: `BAL.v072.ftl.cabinEarlyMin` = 0 on narrowbodies, **15 min on widebodies**. Their duty seg starts
  15 min before the pilots' report; FDP and max FDP both grow by 15 (`timeline.ts cabinEarly`), so FDP legality is
  the pilots'; their duty, rest after and the cumulative windows grow by 15. The ticket home after a long duty is
  planned on the cabin crew's longer day (`planHome(…, early)`).
- Night sector limit: not enforced (the game's contract patterns never plan 5+ WOCL sectors).

---

## 3. Planned extension (ORO.FTL.205(d), CS FTL.1.205(a))

+1:00 without in-flight rest, at most **twice in any 7 consecutive days**; not for reports 19:00–06:14 (the WOCL
rule). Rest before and after grows by 2 h each, or by 4 h after. Sectors: ≤ 5 when the WOCL is not encroached, ≤ 4
when encroached ≤ 2 h, ≤ 2 when encroached more. Planned in advance, never decided on the day.

| Report | 06:15 | 06:30 | 06:45 | 07:00–13:29 | 13:30 | 14:00 | 14:30 | 15:00 | 15:30 | 16:00 | 16:30 | 17:00 | 17:30 | 18:00 | 18:30–18:59 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1–2 sectors | 13:15 | 13:30 | 13:45 | 14:00 | 13:45 | 13:30 | 13:15 | 13:00 | 12:45 | 12:30 | 12:15 | 12:00 | 11:45 | 11:30 | 11:15 |

**Game: documented, not simulated.** The roster never plans extensions; an over-long day is a Crew Control problem
(commander's discretion, swap, sub-charter).

---

## 4. Commander's discretion (ORO.FTL.205(f))

In unforeseen circumstances on the day, the commander may extend the FDP by up to **2:00**, or **3:00 with an
augmented crew**. Sectors after the WOCL may be limited; the following rest may be reduced but **never below 10 h**.
Use over 1 h is reported to the authority (and every use is logged for fatigue risk management).

**Game:** `DISCRETION = { basic: 120, augmented: 180, minRest: 600 }`; offered only by Crew Control on a duty already
over its limit (`crew/control.ts`, `applyDiscretion`). Costs morale and fatigue; once per duty.

---

## 5. In-flight rest and augmented crew (CS FTL.1.205(b), (c))

**Rest facility classes (CS FTL.1.205(b)):**
- **Class 1:** a bunk or other surface allowing a flat sleeping position, separated from the flight deck and the
  passenger cabin, with control of light and noise (the crew rest compartment: overhead on the 777/787, lower deck
  on the A330/A340/A350).
- **Class 2:** a seat in the cabin reclining at least 45° to the vertical, pitch ≥ 55 in (137.5 cm), width ≥ 20 in
  (50 cm), leg and foot support, separated from passengers by at least a curtain giving darkness and some sound
  mitigation.
- **Class 3:** a seat in the cabin or flight deck reclining at least **40°**, with leg and foot support, separated
  from passengers by at least a curtain, not next to a seat occupied by passengers.

**Augmented flight crew FDP (CS FTL.1.205(c)(1)):**

| Flight crew | Class 1 | Class 2 | Class 3 |
|---|---|---|---|
| 3 pilots (+1) | 16:00 | 15:00 | 14:00 |
| 4 pilots (+2) | 17:00 | 16:00 | 15:00 |

- **+1:00** when the FDP has at most 2 sectors and one of them exceeds **9 h of continuous flight time**.
- At most **3 sectors** with augmentation. Absolute maximum **18:00**.
- Minimum in-flight rest: **2 consecutive hours** for the pilots at the controls for landing, **90 minutes** for each
  other pilot.
- Minimum rest at destination: at least the preceding duty or **14 h**, whichever is longer.

**Cabin crew minimum in-flight rest (CS FTL.1.205(c), the cabin crew table)** by the cabin crew's extended FDP:

| Extended FDP up to | Class 1 | Class 2 | Class 3 |
|---|---|---|---|
| 14:30 | 1:30 | 1:30 | 1:30 |
| 15:00 | 1:45 | 2:00 | 2:20 |
| 15:30 | 2:00 | 2:20 | 2:40 |
| 16:00 | 2:15 | 2:40 | 3:00 |
| 16:30 | 2:35 | 3:00 | not allowed |
| 17:00 | 3:00 | 3:25 | not allowed |
| 17:30 | 3:25 | not allowed | not allowed |
| 18:00 | 3:50 | not allowed | not allowed |
| 18:30 | 4:25 | not allowed | not allowed |

So a long duty needs 1–2 extra cabin crew to keep the service running while colleagues rest (est.).

**Game:**
- `AUG_FDP`, `AUG_BONUS` (+1:00), `AUG_BONUS_FT` (9:00, block less `TAXI_ALLOWANCE` 20 min), `AUG_MAX_SECTORS` 3,
  `FDP_CAP` 18:00; more than 3 sectors falls back to the basic table.
- v0.7.2 rest per **airframe**, not per type: `Aircraft.crewRest = { bunks, seats }`. Bunks are class 1. Without
  bunks the player may fit **crew rest seats**: the last economy row behind a curtain, class 3 (`restClassAt`).
  These seats are sold unless the duty needs in-flight rest (`restSeatsBlocked`, `sellableSeats`). Class 2 is kept
  in the tables for completeness; no aircraft offers it in v0.7.2.
- `CABIN_REST` and `cabinInflightRest(fdp, cls)` (null = not allowed). `complement()` adds cabin crew for rest on
  class 2/3 facilities (+1 above 14:30, +2 above 16:00, est.). An augmented FDP is capped so the cabin crew (reporting
  15 min earlier on widebodies) stay inside their table: `maxFdp` takes `cabinFdpCap(cls) − cabinEarly` (class 1
  18:30, class 2 17:00, class 3 16:00). Only 4 pilots on class 3 with the +1:00 bonus feel it: 16:00 → 15:45 (tested).
- Rest after an augmented duty away: 14 h (`minRest`).

---

## 6. Cumulative limits (ORO.FTL.210)

- **Duty:** 60 h in any 7 consecutive days; 110 h in any 14; 190 h in any 28 (spread as evenly as practicable).
- **Flight time (block):** 100 h in any 28 consecutive days; **900 h in any calendar year**; **1,000 h in any 12
  consecutive calendar months**.
- Post-flight duty counts as duty.

**Game:** `LIMITS.duty7d / duty14d / duty28d / block28d / blockYear / block12m`. The 12-month limit (v0.7.2) reads
`CrewMember.blockMonths` (block minutes by calendar month, the last 12 kept, written at duty release); old saves
start empty, so only the 900 h calendar-year check bites until a year of history exists.

---

## 7. Rest (ORO.FTL.235, CS FTL.1.235)

- **(a) At home base:** at least as long as the preceding duty, or **12 h**, whichever is greater.
- **(b) Away from home base:** at least as long as the preceding duty, or **10 h**, whichever is greater; it includes
  an **8 h sleep opportunity** besides travel and physiological needs.
- **(d) Recurrent extended recovery rest:** at least **36 h including 2 local nights**, never more than **168 h**
  between the end of one and the start of the next; **twice a month** it is extended to **2 local days**.
- **CS FTL.1.235(b) disruptive schedules:** 4 or more early/late/night duties between two recovery rests extend
  the next to **60 h** (est. wording; the game uses it as written in RESEARCH F9).
- **CS FTL.1.235(a) time-zone differences:** after rotations with ≥ 4 h difference, local nights at home base:

| Max time difference | < 48 h | 48–71 h | 72–95 h | ≥ 96 h |
|---|---|---|---|---|
| ≤ 6 h | 2 | 2 | 3 | 3 |
| ≤ 9 h | 2 | 3 | 3 | 4 |
| ≤ 12 h | 2 | 3 | 4 | 5 |

Away after a ≥ 4 h time-zone shift, the rest is at least 14 h (CS FTL.1.235(a)(2), as the game applies it).

**Game:** `minRest()` (home 12 h, away 10 h, 14 h away after augmentation or a ≥ 4 h shift, longer duty wins);
`LIMITS.recovery` 36 h with 2 local nights, `recoveryEvery` 168 h, `recoveryLong` 60 h after 4 disruptive duties.
The twice-monthly 2 local days are **documented, not enforced**: the roster's work block (at most 6 days on, then
2 off) already gives them. The time-zone table is applied through the 14 h away rule and the recovery check, not
cell by cell.

**Days off (not Subpart FTL):** at least 7 days free of all duty per calendar month and 96 a year come from the
aviation working-time directive (Council Directive 2000/79/EC, Annex, clause 9), not from ORO.FTL. The roster plans
them (`daysOffInMonth`).

---

## 8. Split duty, standby and reserve: documented, not simulated

- **Split duty (CS FTL.1.220):** a ground break of ≥ 3 consecutive hours (excluding 30 min of post/pre-flight
  duty) extends the FDP by **50 % of the break**; accommodation is needed when the break is ≥ 6 h or touches the
  WOCL; not combined with in-flight rest.
- **Airport standby (ORO.FTL.225, CS FTL.1.225(a)):** counts 100 % as duty; an FDP assigned from it is reduced by
  the standby time beyond 4 h; standby + FDP ≤ 16 h.
- **Other standby (CS FTL.1.225(b)):** at most 16 h; 25 % counts as duty; the FDP is reduced by standby beyond 6 h
  (8 h with augmentation or split duty); at most 18 h awake.
- **Reserve (CS FTL.1.230):** notified at least 10 h ahead, with an 8 h protected sleep window; not duty.
- **Positioning (ORO.FTL.220):** always duty; positioning before an operating sector is FDP but **not a sector**.

**Game:** positioning is implemented (tickets out are FDP, not sectors; tickets home are duty). Split duty, standby
and reserve are not in v0.7.2: a missing crew member is replaced by someone off duty (Crew Control), not standby.

---

## 9. How BLOCK HOURS applies it

| Rule | Article | `crew/rules.ts` (or file) | Test (`crew/ftl.test.ts` unless noted) |
|---|---|---|---|
| FDP acclimatised, by report band and sectors | ORO.FTL.205(b)(1) | `FDP_BANDS`, `FDP_OUTSIDE`, `SECTOR_STEP`, `FDP_FLOOR`, `MAX_SECTORS`, `baseFdp`, `maxFdp` | "EASA FDP table (ORO.FTL.205(b)(1))" |
| FDP unknown state | ORO.FTL.205(b)(2) | `FDP_UNKNOWN` | "unknown state (ORO.FTL.205(b)(2))" |
| Cabin crew FDP from their earlier report | ORO.FTL.205(c) | `BAL.v072.ftl.cabinEarlyMin`, `timeline.ts cabinEarly` | "cabin crew report 15 min earlier on widebodies" |
| Planned extension | ORO.FTL.205(d) | not simulated | — |
| Commander's discretion | ORO.FTL.205(f) | `DISCRETION` | "discretion constants" |
| Augmented FDP | CS FTL.1.205(c) | `AUG_FDP`, `AUG_BONUS`, `AUG_BONUS_FT`, `AUG_MAX_SECTORS`, `FDP_CAP` | "maxFdp F3 (augmented)" |
| Rest facility per airframe | CS FTL.1.205(b) | `crewRest.ts restClassAt`, `restSeatsBlocked`, `sellableSeats` | `crew/crewRest.test.ts` |
| Cabin crew in-flight rest | CS FTL.1.205(c) | `CABIN_REST`, `cabinInflightRest`, `cabinFdpCap` | "cabin crew in-flight rest table" |
| Cumulative duty and block | ORO.FTL.210 | `LIMITS` | "limits table", "enforces …", "1,000 h in 12 months" |
| Rest home/away/augmented | ORO.FTL.235(a)(b) | `minRest` | "minRest F8" |
| Extended recovery | ORO.FTL.235(d) | `LIMITS.recovery`, `recoveryEvery`, `recoveryLong` | "needs a 36 h recovery …", "extends recovery to 60 h …" |
| Acclimatisation | ORO.FTL.105(1) | `acclimState`, `referenceTime` | "acclimatisation (B/X/D)" |
| Disruptive duties, local nights | ORO.FTL.105 | `isDisruptive`, `nightsIn` | "disruptive duties and local nights" |
| Split duty, standby, reserve | CS FTL.1.220/225/230 | not simulated | — |

Ranks (v0.7.2): cabin crew are **PUR** (purser, the senior cabin crew member, ORO.CC.200) and **CC**. Every crew has
exactly one PUR; two-deck types (A380, 747) carry a second as deputy. CSD and SCC from earlier versions were merged
into PUR when a save loads.
