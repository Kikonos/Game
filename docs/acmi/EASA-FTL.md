# EASA flight time limitations: the BLOCK HOURS reference

Rewritten for v0.7.3 "In-flight Rest & EASA"; the single crew-rules reference (RESEARCH.md §5.1 and UPDATE-0.7.2.md
defer to it). It follows the structure of the player's EASA FTL reference guide (current 22 Oct 2026). Each section
cites the article and ends with a **Game** line: implemented, simplified or not modelled, with the symbol in
`src/engine/crew/rules.ts` unless another file is named. Times are h:mm; the engine works in minutes.

---

## 0. Status and sources

- **Implementing rule:** Regulation (EU) No 965/2012, Annex III (Part-ORO), **Subpart FTL** (ORO.FTL.100–250),
  inserted by **Regulation (EU) No 83/2014**, applicable since 18 Feb 2016. Pilots and cabin crew share it.
- **Certification specifications:** **CS FTL.1**, ED Decision **2014/002/R**, amended by ED Decision **2023/023/R**
  (CS-FTL.1 Issue 1, Amendment 1: night duties and late finishes). Consolidated: EASA Easy Access Rules for Air
  Operations, **Revision 24** (March 2026). AMC/GM and EASA's ORO.FTL FAQ are interpretive.
- **Authority:** the player's guide. Where it and anything else disagree, the guide wins.
- **Operator caveat:** every CS number is a default; an approved IFTSS (ORO.FTL.125) may differ, and the operator's
  OM-A chapter 7 governs the individual crew member. The game plays the CS defaults.
- **Not in force:** the air-taxi / AEMS / single-pilot FTL (Delegated Regulation C(2026) 6142, from 15 Oct 2028).
- **Other regimes:** UAE GCAA (Subpart Q model), UK CAA (2016 rules without the 2023 amendment) and FAA Part 117
  differ. A Dubai base still flies these EASA rules.

**Game:** CS FTL.1 defaults for every company and base (an EU AOC flying ACMI).

---

## 1. Definitions (ORO.FTL.105)

| Term | Meaning | Game |
|---|---|---|
| Acclimatised | Table 1 below: **B** (departure zone), **D** (new zone) or **X** (unknown). | `acclimState` |
| Reference time | Local time at the reporting point, in the zone the crew are acclimatised to. | `referenceTime` |
| WOCL | **02:00–05:59** in the acclimatised zone. | `WOCL` (extension sector caps, split duty) |
| Night duty | Encroaches any part of **02:00–04:59**. Separate from the WOCL. | `NIGHT`, `disruptiveKinds().night` |
| Local night | 8 h between 22:00 and 08:00 local. | `nightsIn` |
| Local day | 24 h from 00:00 local. | `localDaysIn` |
| Disruptive schedule | Early start, late finish or night duty; the authority picks early or late type (ARO.OPS.230). | `FTL_TYPE = 'early'` |
| Duty / FDP | Duty = any task for the operator. FDP = report → on-blocks after the last operated sector. | `Duty.fdp`, `Duty.release` |
| Rest facility | A bunk or seat with leg and foot support suitable for sleeping on board. | `RestFacility` |
| Standby / reserve | Standby: notified availability, no rest in between. Reserve: ≥ 10 h notice. | §10 |
| Augmented flight crew | More than the minimum flight crew, so each pilot can leave the post for in-flight rest. | `Duty.augment` 1 / 2 |
| Rotation | Duties and rest away, from home base until rest at home base again. | `CrewMember.rot` |

**Table 1 (ORO.FTL.105(1)).** Rows: time difference between reference time and the next duty's local time;
columns: time since reporting at reference time.

| Difference | < 48 h | 48:00–71:59 | 72:00–95:59 | 96:00–119:59 | ≥ 120 h |
|---|---|---|---|---|---|
| < 4 h | B | D | D | D | D |
| ≤ 6 h | B | X | D | D | D |
| ≤ 9 h | B | X | X | D | D |
| ≤ 12 h | B | X | X | X | D |

**Game:** implemented (`acclimState`, `referenceTime`; test "acclimatisation (B/X/D)").

---

## 2. Maximum daily FDP (ORO.FTL.205(b), (c); CS FTL.1.205(a))

**Table 2: acclimatised (ORO.FTL.205(b)(1)).** Report at reference time × sectors.

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

−0:30 per sector from the 3rd, floor 9:00; the table ends at 10 sectors.

**Table 3: unknown state, X (ORO.FTL.205(b)(2)).** 1–2: 11:00 · 3: 10:30 · 4: 10:00 · 5: 9:30 · 6–8: 9:00.
**Table 4** (X with an approved FRM, (b)(3)): 12:00 → 9:00; not used.

**Cabin crew (ORO.FTL.205(c)).** Their maximum is the flight crew's, from the flight crew's report, extended by the
reporting difference (≤ 1 h); it never lets them finish later than the pilots' maximum.

**Consecutive night duties (CS FTL.1.205(a)(1)):** at most 4 sectors per duty (with the 17:00–04:59 row: ≤ 10:00).

**16 h ceiling (EASA FAQ):** applies to basic FDPs and FDPs extended without in-flight rest.

**Game:**
- `FDP_BANDS`, `FDP_OUTSIDE` (11:00), `SECTOR_STEP`, `FDP_FLOOR`, `MAX_SECTORS` (10: `maxFdp` returns 0 above,
  `partition` refuses), `FDP_UNKNOWN`, `baseFdp`, `maxFdp`.
- Cabin crew report `BAL.v072.ftl.cabinEarlyMin` (15 min) earlier on widebodies; per duty `Duty.cabinEarly` is 0
  when the pilots' augmented limit plus that would pass the cabin crew's table (§4).
- `NIGHT_MAX_SECTORS` 4: the planner never builds a night duty with more; `evalSegs` flags a second consecutive one
  (`'nightSectors'`). Simplified-safe: applied to every night duty.

---

## 3. Planned extension (ORO.FTL.205(d); CS FTL.1.205(b))

Up to +1:00 **without in-flight rest**, at most **twice in any 7 consecutive days per crew member**, acclimatised
crew only, planned in advance. Rest: +2 h before and after, or **+4 h after**. Never combined with in-flight rest or
split duty (ORO.FTL.205(d)(4)). Sectors: **5** if the WOCL is not encroached, **4** if by ≤ 2 h, **2** if by more.

| Report | 1–2 | 3 | 4 | 5 |
|---|---|---|---|---|
| 06:00–06:14 | — | — | — | — |
| 06:15–06:29 | 13:15 | 12:45 | 12:15 | 11:45 |
| 06:30–06:44 | 13:30 | 13:00 | 12:30 | 12:00 |
| 06:45–06:59 | 13:45 | 13:15 | 12:45 | 12:15 |
| 07:00–13:29 | 14:00 | 13:30 | 13:00 | 12:30 |
| 13:30–13:59 | 13:45 | 13:15 | 12:45 | — |
| 14:00–14:29 | 13:30 | 13:00 | 12:30 | — |
| 14:30–14:59 | 13:15 | 12:45 | 12:15 | — |
| 15:00–15:29 | 13:00 | 12:30 | 12:00 | — |
| 15:30–15:59 | 12:45 | — | — | — |
| 16:00–16:29 | 12:30 | — | — | — |
| 16:30–16:59 | 12:15 | — | — | — |
| 17:00–17:29 | 12:00 | — | — | — |
| 17:30–17:59 | 11:45 | — | — | — |
| 18:00–18:29 | 11:30 | — | — | — |
| 18:30–18:59 | 11:15 | — | — | — |
| 19:00–06:14 | — | — | — | — |

"—" = not allowed; 6 or more sectors: never.

**Game:** implemented. `EXT_TABLE`, `extSectorCap`, `woclMinutes`, `extFdp`; `pickPlan` tries `ext` after `basic`
and `split`, for a single unit, at planning only (`syncDuty` keeps or drops it, never adds it). `Duty.ext`,
`Duty.basicFdp`; `minRest({ extended })` +4 h; `evalSegs` `'ext7d'` (> 2 in 7 days, per crew member).

---

## 4. In-flight rest and augmented crew (ORO.FTL.205(e); CS FTL.1.205(c))

**Classes ((c)(1)):**
- **Class 1:** a bunk or other flat or near-flat surface (≥ 80° back angle from the vertical), separate from the
  flight deck and the cabin, with light control and isolation from noise.
- **Class 2:** a cabin seat reclining ≥ 45°, pitch ≥ 55 in (137.5 cm), width ≥ 20 in (50 cm), leg and foot support,
  separated from passengers by at least a curtain, reasonably free from disturbance.
- **Class 3:** a seat in the cabin or flight deck reclining ≥ 40°, leg and foot support, at least a curtain from
  passengers, not next to a seat occupied by passengers.
- **v0.7.4 game rule, curtained economy seats:** the player's operators used these; the game treats them as class 3
  rest. (The strict EASA definition asks for ≥ 40° recline with leg and foot support, which a standard economy seat
  does not have.)

**Flight crew ((c)(2)(i)/(ii), (c)(4)):**

| Augmentation | Class 3 | Class 2 | Class 1 |
|---|---|---|---|
| +1 pilot | 14:00 | 15:00 | 16:00 |
| +2 pilots | 15:00 | 16:00 | 17:00 |
| +1, one sector > 9 h flight time, ≤ 2 sectors | 15:00 | 16:00 | 17:00 |
| +2, one sector > 9 h flight time, ≤ 2 sectors | 16:00 | 17:00 | 18:00 |

Conditions ((c)(1), (5)–(7)): at most **3 sectors**; each pilot **90 consecutive minutes** of rest, the **landing
pilots 2 consecutive hours** (EASA FAQ: if the cruise is too short for this, no extension); rest in cruise, placed
for landing-pilot alertness (GM); time in the facility is FDP; **rest at destination ≥ preceding duty or 14 h**
((c)(6)); no positioning sector to join the crew. The limits do not vary with report time or WOCL.

**Cabin crew ((c)(3)):** minimum in-flight rest each, by their extended FDP.

| Extended FDP | Class 1 | Class 2 | Class 3 |
|---|---|---|---|
| up to 14:30 | 1:30 | 1:30 | 1:30 |
| 14:31–15:00 | 1:45 | 2:00 | 2:20 |
| 15:01–15:30 | 2:00 | 2:20 | 2:40 |
| 15:31–16:00 | 2:15 | 2:40 | 3:00 |
| 16:01–16:30 | 2:35 | 3:00 | not allowed |
| 16:31–17:00 | 3:00 | 3:25 | not allowed |
| 17:01–17:30 | 3:25 | not allowed | not allowed |
| 17:31–18:00 | 3:50 | not allowed | not allowed |

The table ends at 18:00 and does not by itself authorise an 18 h FDP. UK CAA CAP 1265: the operator must show the
cruise gives every cabin crew member the band's rest, given facilities, numbers and service.

**Game:**
- Two facilities per airframe (`restOf` → `effectiveRest`): what is **fitted** (`Aircraft.rest = { fc, cc }`) and
  the curtained seats of the **current cabin**, the better per side (a fitted facility wins a tie). Fitted: pilots'
  bunks (`fcrc`, class 1) with overhead or lower-deck cabin crew bunks (`ccrc`, `ldmcr`, class 1), or crew rest
  recliners (`recliners`, class 2 since v0.7.4). Seats (v0.7.4, `seatRest`): **every aircraft** has curtained economy
  seats (`ySeats`, class 3; narrowbodies too); a cabin with 4+ business seats has curtained business seats (`jSeats`,
  class 2). The seats are not a facility and not a capacity loss: they stay in the seat total and are blocked only on
  legs where someone rests in them. A refit to two-class turns business-seat rest on; to all-economy, off.
- **Bunks come as a pair (v0.7.4):** pilot bunks and cabin crew bunks always together (one roll per airframe,
  `TypeRest.bunkShare`; one combined refit with a C-check; `fittedRest` pairs an old save's single kind with the
  type's default). **The 767-300ER never has bunks** (the player's experience overrides the audit's 0.25 / 0.15
  shares); the game's 767s rest crew in curtained business or economy seats.
- Migrations: v0.7.2 saves (`migrateRest`): bunks → class 1 both sides, v0.7.2 rest seats → recliners. v0.7.3 saves
  (`loadRest074`, once per airframe, `Aircraft.restV` 2): seat entries dropped (they follow the cabin), recliners
  class 2, bunks paired, a 767's game-given bunks removed with an inbox note; its open augmented duties are re-planned
  (a trip already under way keeps its crew as rostered). Duties crewed within 72 h of loading a v0.7.2 save keep
  their plan (`Duty.legacyRest`).
- `AUG_FDP`, `AUG_BONUS`, `AUG_BONUS_FT` (9:00 flight time = block − `TAXI_ALLOWANCE`), `AUG_MAX_SECTORS`, `FDP_CAP`
  18:00, `augLimitOf`. Augmentation needs the `augmented` approval and both facilities (v0.7.4: every aircraft has
  them, at worst class 3 seats: a narrowbody can fly 14 h with 3 pilots / 15 h with 4 where the cruise allows the
  90 / 120 min rest). The fleet card shows the longest day short: '13 h · up to 17 h' (`longestDay().text`; the
  extension, who rests where and the approval in `detail`).
- **The rest plan** (`crew/restPlan.ts planRest`, `restPlan`): pilots placed backwards from the last leg (landing
  pilots 120 min last, others 90), turns inside `[std + 40, sta − 70]`; cabin crew in groups with **half the crew
  working** (game rule after CAP 1265), inside `[std + 105, sta − 70]`; up to 2 extra cabin crew when the groups
  don't fit (`Duty.restExtra`). Failure codes `noFacility`, `sectors`, `tooShort`, `cabinClass`, `cabinFit`.
  Seat facilities are blocked from sale only on legs where someone rests in them (`restSeatsBlocked`).
- `CABIN_REST`, `cabinInflightRest`, `cabinFdpCap` (class 1 18:00, 2 17:00, 3 16:00). C2: the cabin crew report with
  the pilots when the early report would pass their table; only then is the limit capped.
- `minRest({ augmented })` 14 h wherever the crew rest (home too).

---

## 5. Commander's discretion (ORO.FTL.205(f))

Only for unforeseen circumstances **at or after report**. The maximum from (b), (e) or ORO.FTL.220 may grow by up
to **2 h, or 3 h with an augmented crew**; after a planned extension the base is the **basic** FDP (GM1
ORO.FTL.205(f)(1)(i)). The rest after may be reduced, **never below 10 h**. Over 1 h: a report to the authority within
28 days ((f)(5)), non-punitive. AMC: exceptional; avoid at home base and hubs where standby crew should exist.

**Game:** `DISCRETION = { basic: 120, augmented: 180, minRest: 600 }`. `applyDiscretion` refuses before report
(`DISCRETION_BEFORE_REPORT`); base = `basicFdp` after an extension, the augmented or split maximum otherwise. The game
never reduces rest. Over 1 h at release: one inbox note "Discretion report filed" naming the authority
(`data/flavor.ts AUTHORITY`), `Stats.discretionReports`.

---

## 6. Delayed reporting (ORO.FTL.205(g); CS FTL.1.205(d))

| Situation | Max FDP from | FDP counts from |
|---|---|---|
| One notification, delay < 4 h | the original report | the delayed report |
| One notification, delay ≥ 4 h | the more limiting of original and delayed | the delayed report |
| Second notification | as above | 1 h after it, or the delayed time if earlier |
| Delay ≥ 10 h, crew undisturbed | the delay is rest: a new FDP | the delayed report |

**Game:** `Duty.notified` (the report the crew were told); a change ≥ 18 h before it re-publishes the roster
(`BAL.v073.delayed.republishH`). `syncDuty` applies the three rows; one info message when it bites,
`Stats.delayedReports`. Second notification: not modelled.

---

## 7. Cumulative limits (ORO.FTL.210)

Duty **60 h / 7 days, 110 h / 14, 190 h / 28**. Flight time **100 h / 28 days, 900 h / calendar year, 1,000 h / 12
consecutive calendar months**. What counts as duty: post-flight duty; positioning 100 % (ORO.FTL.215); airport
standby 100 %; other standby **25 %** (CS FTL.1.225(b)(3)); reserve 0 (CS FTL.1.230); in-flight rest 100 % (GM1
ORO.FTL.105(17)). Flight time counts operated sectors only.

**Game:** `LIMITS.duty7d / duty14d / duty28d / block28d / blockYear / block12m`; `windowsAt` multiplies each seg by
`Seg.share` (home standby 0.25). `CrewMember.blockMonths` feeds the 12-month limit.

---

## 8. Positioning (ORO.FTL.215)

Positioning after report and before operating is FDP but not a sector; all positioning is duty; positioning after the
last operated sector is duty, not FDP.

**Game:** implemented: tickets out are FDP, not sectors; tickets home are duty (`posSeg`, `planHome`).

---

## 9. Split duty (ORO.FTL.220; CS FTL.1.220)

A break of **≥ 3 consecutive hours** on the ground, net of post/pre-flight duty and travel (≥ 30 min in total), adds
**up to 50 % of the break** to the ORO.FTL.205(b) maximum. Accommodation always; **suitable accommodation** for a
break ≥ 6 h or one touching the WOCL, otherwise break time beyond 6 h or inside the WOCL does not count. Not with
in-flight rest, a planned extension or after reduced rest. The break counts in full as FDP.

| Net break | 3:00 | 4:00 | 5:00 | 6:00 | 8:00 (suitable accommodation) |
|---|---|---|---|---|---|
| FDP increase | +1:30 | +2:00 | +2:30 | +3:00 | +4:00 |

**Game:** implemented for a single unit: net = ground time − 60 min (`BAL.v073.split.excludeMin`); `splitFdp` adds
half the net in 15-minute steps, ceiling 16:00. Hotel day room from 6 h net or when the break touches the WOCL,
else the airport crew room (costs to `hotels` at release). `Duty.split`, `Stats.splits`.

---

## 10. Standby and reserve (ORO.FTL.225, 230; CS FTL.1.225, 1.230)

**Airport standby ((a)):** 100 % duty; the FDP is reduced by standby beyond 4 h; standby + FDP ≤ 16 h.
**Other (home) standby ((b)):** at most 16 h; 25 % counts as duty; called within the first 6 h the FDP counts from
report; called later, the max FDP is reduced by standby beyond 6 h (**8 h** with in-flight rest or split duty);
standby between 23:00 and 07:00 does not count until contacted; procedures keep standby + FDP within **18 h awake**.
**Reserve (CS FTL.1.230):** ≥ 10 h notice, an 8 h no-contact period, not duty.

**Game:** home standby is rostered daily: per rating family 1 CPT, 1 FO, 1 PUR, 1 CC at home base 06:00–18:00 local,
2 days ahead, keeping 8 free days a month (`crew/standby.ts dailyStandby`, `CrewMember.standby`). A called crew
member's own max FDP shrinks (`standbyCut`) and the awake cap applies (woken 1 h before, `standbyAwakeOk`,
`'standby'`). Crew Control calls standby crew first, no overtime. Airport standby: `standbyCut('airport', …)` tested,
not rostered. Reserve: not modelled.

---

## 11. Rest (ORO.FTL.235; CS FTL.1.235)

| Case | Minimum | Article |
|---|---|---|
| Home base | ≥ preceding duty or 12 h | ORO.FTL.235(a) |
| Away | ≥ preceding duty or 10 h, incl. 8 h sleep opportunity | ORO.FTL.235(b) |
| After a planned extension | +4 h after (or +2 h before and after) | ORO.FTL.205(d) |
| After an augmented FDP | ≥ preceding duty or 14 h | CS FTL.1.205(c)(6) |
| Away after an FDP ≥ 4 h time difference | ≥ preceding duty or 14 h | CS FTL.1.235(b)(3)(ii) |
| After discretion | never below 10 h | ORO.FTL.205(f) |

**Reduced rest** (CS FTL.1.235(c)): FRM only; not used.

**Recurrent extended recovery rest (ORO.FTL.235(d)):** ≥ **36 h including 2 local nights**, ≤ **168 h** between the
end of one and the start of the next; **twice every month it is 2 local days**.

**Disruptive schedules (CS FTL.1.235(a)):** early type: early start 05:00–05:59, late finish 23:00–01:59; late type:
05:00–06:59 and 00:00–01:59; night duty both. A **late finish or night duty followed by an early start at home
base** needs **1 local night** in the rest between (an FDP, or a standby leading to one). **4 or more** disruptive
duties between recovery rests → the next one is **60 h**. Appropriate FRM for night duties > 10 h and late finishes,
and the three night subtypes (2023/023/R): operator processes.

**Time zones (CS FTL.1.235(b)(3)(i)):** after a rotation with ≥ 4 h difference, local nights at home base, by the
largest difference and time since the rotation's first report:

| Max difference | < 48 h | 48:00–71:59 | 72:00–95:59 | ≥ 96 h |
|---|---|---|---|---|
| ≤ 6 h | 2 | 2 | 3 | 3 |
| ≤ 9 h | 2 | 3 | 3 | 4 |
| ≤ 12 h | 2 | 3 | 4 | 5 |

Alternating east–west and west–east rotations: **3 local nights** at home between them ((b)(4)).

**Game:**
- `minRest({ dutyMin, atHome, augmented, tzShift, extended })`.
- `LIMITS.recovery` 36 h + 2 local nights, `recoveryEvery` 168 h, `recoveryLong` 60 h after `disruptiveMax` 4.
- 2 local days: `twoDayCredits` (whole 00:00–24:00 days at base, by month), `CrewMember.twoDays` (logged at report,
  key 0 = first month tracked), `evalSegs` `'twoDays'` at the first work of a later month; months before the load
  month are never checked.
- `FTL_TYPE = 'early'` for every base (Portugal is not in the guide's list; early type is the stricter for late
  finishes). `disruptiveKinds`, `'lateEarly'`.
- `TZ_NIGHTS`, `tzNights`, `TZ_ALTERNATE_NIGHTS`; `CrewMember.rot` / `tzBack`; `'tzRest'`.

---

## 12. Days off (Directive 2000/79/EC) and the work block

At least **7 days free of all duty per calendar month and 96 a year** (Council Directive 2000/79/EC, Annex, clause
9). Not ORO.FTL.235(e) (235(e)(3) is the 72 h recovery after a change of home base).

**Game:** `daysOffInMonth` (`crew/ftl.ts`) plans them. The roster's work block (at most 6 days on, then 2 off;
`longestWorkBlock`) is **company policy, not EASA**.

---

## 13. Records and roster publication (ORO.FTL.245, AMC1 ORO.FTL.110(a))

Records kept 24 months: flight times, duty and FDP start/end, rest and days off, home base, reports on extended FDPs
and reduced rest. Rosters published **14 days** ahead.

**Game:** simplified: `CrewMember.log` keeps the recent duties the rules read (pruned), `blockMonths` 12 months;
`Stats` count extensions, splits, standby calls, delayed and discretion reports. The roster plans as far as the
contracts are signed; a change ≥ 18 h before report is a new roster (§6).

---

## 14. How BLOCK HOURS applies it

Tests in `crew/ftl.test.ts` unless a file is named.

| Rule | Article | Symbol | Test |
|---|---|---|---|
| Acclimatisation | ORO.FTL.105(1) | `acclimState`, `referenceTime` | "acclimatisation (B/X/D)" |
| Table 2 | ORO.FTL.205(b)(1) | `FDP_BANDS`, `baseFdp`, `maxFdp` | "EASA FDP table (ORO.FTL.205(b)(1))" |
| Table 3 | ORO.FTL.205(b)(2) | `FDP_UNKNOWN` | "unknown state (ORO.FTL.205(b)(2))" |
| ≤ 10 sectors (C5) | ORO.FTL.205(b) | `MAX_SECTORS` | "C5: more than 10 sectors is never legal …" |
| Cabin crew earlier report | ORO.FTL.205(c) | `cabinEarly`, `Duty.cabinEarly` | `crewRest.test.ts` "cabin crew report 15 min earlier on widebodies" |
| Consecutive nights ≤ 4 sectors (C6) | CS FTL.1.205(a)(1) | `NIGHT_MAX_SECTORS` | "nightSectors: consecutive night duties …" |
| Planned extension | ORO.FTL.205(d), CS FTL.1.205(b) | `EXT_TABLE`, `extFdp`, `extSectorCap` | "planned extension (…)", "ext7d: …" |
| Augmented FDP | CS FTL.1.205(c)(2), (4) | `AUG_FDP`, `augLimitOf` | "maxFdp F3 (augmented)", "augmented crew (CS FTL.1.205(c)) pinned" |
| Cabin rest table (C1, C2) | CS FTL.1.205(c)(3) | `CABIN_REST`, `cabinFdpCap` | "cabin crew in-flight rest table"; `rules073.test.ts` "C2: …" |
| Facilities, migration (C8, C9) | CS FTL.1.205(c)(1) | `restOf`, `migrateRest`, `rollRest` | `crewRest.test.ts` "v0.7.3 migration …"; `restPlan.test.ts` "market roll …" |
| Rest plan | CS FTL.1.205(c)(1), (3) | `planRest`, `restPlan` | `restPlan.test.ts` "pilots …", "cabin crew …" |
| Seats out of sale | CS FTL.1.205(c)(1) | `restSeatsBlocked` | `restPlan.test.ts` "seats out of sale" |
| Plan order | — | `pickPlan`, `MODE_COST` | `rules073.test.ts` "the plan order …" |
| Rest after augmented (C4) | CS FTL.1.205(c)(6) | `minRest` | "minRest F8" |
| Discretion (C3) | ORO.FTL.205(f) | `DISCRETION`, `applyDiscretion` | "discretion constants …"; `control.test.ts` |
| Delayed reporting | ORO.FTL.205(g), CS FTL.1.205(d) | `syncDuty`, `Duty.notified` | `rules073.test.ts` "delayed reporting …" |
| Cumulative limits | ORO.FTL.210 | `LIMITS`, `windowsAt` | "enforces …", "1,000 h in 12 months …" |
| Positioning | ORO.FTL.215 | `posSeg` | "requires each duty to start where …" |
| Split duty | CS FTL.1.220 | `splitFdp`, `Duty.split` | "split duty (CS FTL.1.220)" |
| Home / airport standby | CS FTL.1.225 | `standbyCut`, `standbyAwakeOk`, `dailyStandby` | "standby (CS FTL.1.225)"; `rules073.test.ts` "home standby …" |
| Minimum rest | ORO.FTL.235(a), (b) | `minRest` | "minRest F8" |
| Recovery 36 h / 168 h / 60 h | ORO.FTL.235(d), CS FTL.1.235(a)(2) | `LIMITS.recovery*` | "needs a 36 h recovery …", "extends recovery to 60 h …" |
| 2 local days twice a month | ORO.FTL.235(d) | `twoDayCredits`, `'twoDays'` | "twoDays: …" |
| Disruptive kinds (C10) | CS FTL.1.235(a) | `FTL_TYPE`, `disruptiveKinds` | "C10: early type disruptive kinds …" |
| Late/night → early | CS FTL.1.235(a)(1) | `'lateEarly'` | "lateEarly: …" |
| Time zones | CS FTL.1.235(b) | `TZ_NIGHTS`, `tzNights`, `'tzRest'` | "time zones (…)", "tzRest: …" |
| Contract feasibility (C7) | ORO.FTL.205 | `restNeed`, `dutyNeed` | `contracts/feasibility.test.ts` "rest: …" |

---

## 15. Not modelled

- Table 4 and any FRM-based scheme; reduced rest (CS FTL.1.235(c)).
- Hotel transfer > 30 min adding twice the excess to rest (AMC1 ORO.FTL.235(b)).
- A second notification of a delay (CS FTL.1.205(d)).
- Roster robustness, ORO.FTL.110(j) (33 % of duties over the maximum in a season).
- The three night-duty subtypes and appropriate FRM (CS FTL.1.205(a)(2), (3)).
- Reserve (CS FTL.1.230); airport standby is coded but never rostered. (v0.9 plans both: §16.)
- The 72 h recovery after a change of home base (CS FTL.1.200(b)); crew never change base.
- Subpart Q, the 2028 air-taxi / AEMS rules, UAE GCAA, UK CAA differences, FAA Part 117.

---

## 16. Roster planning (v0.9)

How a crew-planning department builds a roster inside these rules, from the player's guide (§§3, 10, 11.3–11.4,
12.3 and definitions (20), (23), (25)–(27)). The design is UPDATE-0.9.md §R; the "Game" lines describe v0.9 as
designed and are updated by ENGINE when it is built.

**Publication (ORO.FTL.110(a), AMC1).** Rosters are published sufficiently in advance: **14 days**. The operator
must also plan and notify the recurrent extended recovery rest (ORO.FTL.110) and plan FDPs to be achievable.
**Game:** the roster is published to the end of today + 13 (`dayPlan.publishedTo`). Days off inside it are
protected: a change needs the player's confirm and costs morale (−6). The roster itself never breaks one; for
short-notice work nobody else can take (reporting within 72 h) it may **swap** one by agreement, as crew control
asks a crew member on the phone: the day moves inside its month and the count is kept, morale −3, only with morale
≥ 50, at most once in 14 days a person and never for a day off starting within 12 h (`BAL.v09.roster.swap`).

**Days free of duty (Directive 2000/79/EC, Annex, clauses 3 and 9).**
- At least **7 days in each calendar month** and **96 days in each calendar year** free of all duty **and standby**,
  notified in advance.
- A "single day free of duty" is one day and **two local nights** (guide definition (23)).
- **4 weeks** of paid annual leave.

These are social law, not ORO.FTL. ORO.FTL.125 requires a scheme to comply with them. Collective agreements may
give more (Reg. 83/2014 recital (4)).
**Game:**
- A day off is a local day free of all duty, standby and reserve from 00:00 to 06:00 the next morning
  (`BAL.v09.roster.off.morningFree` 360: a report before 06:00 takes the day before, no standby opens before 06:00).
- Days off are planned in blocks of 2–3 days: about 9 a month, never below 7 (illegal: `'daysOff'`), and the
  planner floor of 8 keeps the year above 96; the year is checked too (round 4): work that would leave the calendar
  year unable to reach 96 pro rata is illegal, and the Crew month line shows "x of 96 this year".
- Days off are staggered: at most 30 % of a family-and-role group is off on any day of a due block (`OFF_SHARE`;
  a must block, the 7th work day or the month's minimum, always goes), so a group keeps crew on every day.
- 28 days of annual leave a year, weighted to the winter quarters (10/4/4/10).

**Recurrent extended recovery rest (ORO.FTL.235(d)).**
- At least **36 h including 2 local nights**.
- No more than **168 h** between the end of one and the start of the next.
- **Twice a month** it is increased to **2 local days**.
- It applies to reserve crew too (GM1 CS FTL.1.230(c)). Unused reserve cannot be turned into it afterwards
  (GM1 ORO.FTL.230(a)).

**Game:** every 2–3-day block of days off is a recovery rest. A block is due after 5 work days and a must after 6,
and a month always holds at least two 2-day blocks. The existing `recovery` and `twoDays` checks stay as the guard.

**Standby (ORO.FTL.225; CS FTL.1.225).** Standby is rostered, with start and end notified in advance.
- **Airport standby** (CS FTL.1.225(a)):
  - counts in full as duty;
  - the max FDP is reduced by standby beyond 4 h;
  - standby + FDP ≤ 16 h;
  - followed by ORO.FTL.235 rest when no FDP follows;
  - the operator provides accommodation.
- **Other standby** at home or in suitable accommodation (CS FTL.1.225(b)):
  - at most 16 h;
  - 25 % counts as duty for ORO.FTL.210;
  - called within the first 6 h, the FDP counts from report; later, the max FDP is reduced by standby beyond 6 h
    (8 h with in-flight rest or split duty);
  - 23:00–07:00 does not count towards the reduction until contacted;
  - procedures keep standby + FDP within 18 h awake;
  - rest per ORO.FTL.235 afterwards;
  - reasonable response time.
- AMC1 ORO.FTL.205(f): standby or reserve crew should be available at home base and hubs, so that commander's
  discretion is avoided there.

**Game:**
- Every free day that is not a day off is standby:
  - **home standby** at base: early 05:00–17:00 or late 12:00–24:00, 25 %, ready in 90 min;
  - **hotel standby** at a deployment or night-stop station: 06:00–18:00, 25 %, ready in 45 min;
  - **airport standby** at a base whose family has ≥ 3 of our departures 05:00–10:00 (`airport.minWave`): one
    captain, one first officer and one cabin crew (a purser counts as the cabin seat), 4 h from 90 min before the
    first departure, 100 %, ready in 20 min. A fleet of two or three narrowbodies whose morning bank holds one or
    two departures per family never qualifies (bot seeds 1–6: none), as a real operator would not post airport
    standby for it either.
- The reductions and caps are `standbyCut` and `standbyAwakeOk`. Each window is followed by rest when not called.
- Crew Control calls standby first.

**Reserve (ORO.FTL.230; CS FTL.1.230).**
- Rostered; the scheme sets its maximum length and consecutive days.
- Does not count as duty for ORO.FTL.210 or 235.
- An 8 h no-contact period each day.
- An assignment needs ≥ 10 h notice (GM2; the notice may include the 8 h).
- An FDP counts from report.

**Game:**
- Reserve is used where a standby would make the 7/14/28-day duty tight (≥ 95 %, `reserve.tightShare`): 24 h, no
  contact 22:00–06:00, 0 %. Few crew get that close to the limits (bot seeds 1–6: 0–1 crew-days a year).
- Called only for a report ≥ 10 h ahead; a call that would fall in the no-contact period waits for 06:00 and the 10 h
  run from there (round 4, `standby.ts reserveContact`). It is never rest and never a day off.

**Cumulative limits (ORO.FTL.210)** with standby. Duty: 60 h / 7 d, 110 h / 14 d, 190 h / 28 d (spread as evenly as
practicable). Flight time: 100 h / 28 d, 900 h / calendar year, 1,000 h / 12 calendar months. Airport standby
counts 100 %, other standby 25 %, reserve 0 (§7).
**Game:** `windowsAt` with `Seg.share` per kind: home and hotel 0.25, airport 1, reserve 0.

**Roster quality (guide §12.4, GM1–GM5 CS FTL.1.205(a)(2)).**
- Roster blocks of identical duties.
- At most one transition between disruptive types between recovery rests.
- Avoid long nights straight after a recovery rest.

**Game:** a crew member keeps the same early or late standby shift through a work block. The late→early (1 local
night) and 4-disruptive (60 h) rules stay as checks.

**Not modelled:** crew bids and requests, standby or duty pay (salaries are monthly), the 2,000 h annual working
time (Directive clause 8; far above what the duty limits allow in practice).
