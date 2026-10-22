// v0.7.3 "Day length X of Y · Why Y?" (UPDATE-0.7.3.md §2.6 item 5, §7): the plain-language reasons behind a duty's
// limit (report band, sectors, acclimatisation, rest facilities, the cabin crew's table, extension, split duty,
// standby, delayed report, discretion) and the player's "Fly it with 4 pilots".

import { AIRPORT_BY_CODE } from '../../data/airports';
import { BAL } from '../core/balance';
import { typeOf } from '../core/perf';
import { DAY } from '../core/time';
import type { AcRest, ActionResult, GameState } from '../core/types';
import { modeOf, refreshPairing, type PlanMode } from './duties';
import { crewName } from './generate';
import { cabinBand, restOf, restPlan } from './restPlan';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import { AUG_FDP, augLimitOf, cabinFdpCap, cabinInflightRest, extFdp, longSector, maxFdp, referenceTime, woclMinutes } from './rules';
import { crewCount, segsOf, touchCrew } from './timeline';

export interface FdpWhy {
  fdp: number;
  limit: number;
  mode: PlanMode;
  /** 'Day length 15:20 of 16:00'. */
  title: string;
  /** 'Why 16:00? 3 pilots with bunks (class 1) allow 16 h. With business seats it would be 15 h; with no rest, 13 h.' */
  why: string;
  /** 'Cabin crew: 15:35 day (report 15 min earlier) → each needs 2:15 rest (band 15:31–16:00, class 1).' */
  cabin: string | null;
  /** Report band / sectors / acclimatisation; extension, split, standby, delayed report, discretion lines; the article last. */
  notes: string[];
  /** No rest 13:00 · Extension — · 3 pilots 16:00 · 4 pilots 17:00. */
  options: { label: string; max: number | null }[];
}

const hm = (m: number) => `${Math.floor(Math.max(0, m) / 60)}:${String(Math.round(Math.max(0, m) % 60)).padStart(2, '0')}`;
const hrs = (m: number) => (m % 60 ? hm(m) : `${m / 60} h`);
const kindWord = (r: AcRest['fc']) => (!r ? 'no rest' : r.kind === 'jSeats' ? 'business seats' : r.kind === 'ySeats' ? 'economy seats' : r.kind === 'recliners' ? 'recliners' : 'bunks');

/** v0.7.3 why a duty's limit is what it is (pilots, cabin crew, the options it had). Pure. */
export function fdpWhy(g: GameState, dutyId: string): FdpWhy | null {
  const d = g.duties[dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) return null;
  const ac = p.aircraftId ? g.fleet[p.aircraftId] : undefined;
  const typeId = ac?.typeId ?? 'a320ceo';
  const rest = restOf(g, p.aircraftId);
  const mode = modeOf(d);
  const limit = d.maxFdp + (d.discretion ?? 0);
  const dep = g.flights[d.flightIds[0]]?.from ?? d.restAt;
  const ref = referenceTime(p.base, dep, Math.min(p.start, d.report), d.report);
  const acclim = ref.state !== 'X';
  let longest = 0;
  for (const id of d.flightIds) longest = Math.max(longest, g.flights[id]?.block ?? 0);
  const long = longSector(d.sectors, longest);
  const basic = d.basicFdp ?? maxFdp({ reportLocal: ref.reportLocal, sectors: d.sectors, acclimatised: acclim, augment: 0, restClass: null, longestBlock: longest });
  const ext = acclim ? extFdp(ref.reportLocal, d.sectors, woclMinutes(ref.tz, d.report, d.release)) : null;
  const both = !!rest.fc && !!rest.cc && g.company.approvals.includes('augmented');
  const a1 = both && d.sectors <= 3 ? augLimitOf(rest.fc!.cls, rest.cc!.cls, 1, long, 0).max : null;
  const a2 = both && d.sectors <= 3 ? augLimitOf(rest.fc!.cls, rest.cc!.cls, 2, long, 0).max : null;
  const local = hm(ref.reportLocal);
  const sec = `${d.sectors} sector${d.sectors > 1 ? 's' : ''}`;
  let why: string;
  if ((mode === 'aug1' || mode === 'aug2') && rest.fc) {
    const n = mode === 'aug1' ? 3 : 4;
    const a = mode === 'aug1' ? 1 : 2;
    const fc = rest.fc;
    const pilots = Math.min(18 * 60, AUG_FDP[a][fc.cls] + (long ? 60 : 0));
    const alt = Math.min(18 * 60, AUG_FDP[a][fc.cls === 1 ? 2 : 1] + (long ? 60 : 0));
    const capped = d.maxFdp < pilots;
    why = `Why ${hm(d.maxFdp)}? ${n} pilots with ${kindWord(fc)} (class ${fc.cls}) allow ${hrs(pilots)}${long ? ' (1 h more for one long sector)' : ''}.`
      + (capped ? ` The cabin crew's ${kindWord(rest.cc)} (class ${rest.cc?.cls}) cap it at ${hrs(d.maxFdp)}.` : '')
      + ` With ${fc.cls === 1 ? 'business seats' : 'bunks'} it would be ${hrs(alt)}; with no rest, ${hm(basic)}.`;
  } else if (mode === 'split' && d.split) {
    why = `Why ${hm(d.maxFdp)}? A split duty: a ${hm(d.split.net + BAL.v073.split.excludeMin)} wait at ${AIRPORT_BY_CODE[d.split.at]?.city ?? d.split.at} (${hm(d.split.net)} net) adds ${hm(d.maxFdp - basic)} to the ${hm(basic)} day.`;
  } else if (mode === 'ext') {
    why = `Why ${hm(d.maxFdp)}? A planned extension of the ${hm(basic)} day (${local} report, ${sec}). Rest after +4 h.`;
  } else {
    why = `Why ${hm(d.maxFdp)}? A ${local} report with ${sec} allows ${hm(basic)}${acclim ? '' : ' (not yet used to the local time: the shorter table)'}.`
      + (a1 ? ` With 3 pilots and in-flight rest it would be ${hrs(a1)}.` : '');
  }
  // Cabin crew.
  let cabin: string | null = null;
  const typeEarly = BAL.v072.ftl.cabinEarlyMin[typeOf(typeId).body];
  const early = d.cabinEarly ?? typeEarly;
  if (d.augment > 0 && rest.cc) {
    const cfdp = d.fdp + early;
    const need = cabinInflightRest(cfdp, rest.cc.cls);
    const rep = early ? `report ${early} min earlier` : typeEarly ? 'they report with the pilots, so their rest table allows the day' : 'they report with the pilots';
    cabin = need !== null
      ? `Cabin crew: ${hm(cfdp)} day (${rep}) → each needs ${hm(need)} rest (band ${cabinBand(cfdp)}, class ${rest.cc.cls}).`
      : `Cabin crew: a ${hm(cfdp)} day is more than class ${rest.cc.cls} rest allows (${hm(cabinFdpCap(rest.cc.cls))}).`;
  } else if (early) cabin = `Cabin crew: ${hm(d.fdp + early)} day (report ${early} min earlier); no in-flight rest needed.`;
  // Notes.
  const notes: string[] = [`Report ${local} ${ref.tz === dep ? 'local' : `${ref.tz} time`}, ${sec}${acclim ? '' : ', unknown acclimatisation (Table 3)'}.`];
  if (d.ext) {
    const pilots = p.slots.filter((s) => s.crewId && (s.role === 'CPT' || s.role === 'FO')).map((s) => g.crew[s.crewId!]);
    for (const c of pilots.slice(0, 2)) {
      if (!c) continue;
      const n = segsOf(g, c).filter((s) => s.ext && s.start > d.report - 7 * DAY && s.start <= d.report).length;
      notes.push(`Planned extension: ${n} of ${BAL.v073.ext.perWeek} this week for ${c.role === 'CPT' ? 'Capt. ' : ''}${crewName(c)}.`);
    }
  }
  if (d.split) notes.push(`Split duty at ${AIRPORT_BY_CODE[d.split.at]?.city ?? d.split.at}: ${d.split.room === 'hotel' ? 'a hotel day room' : 'the airport crew room'}.`);
  if (d.notified !== undefined && d.notified < d.report) notes.push(`Delayed report: told ${hm(d.notified % DAY)} UTC, now ${hm(d.report % DAY)} UTC${d.report - d.notified < 4 * 60 ? ': the limit stays that of the original report' : ''}.`);
  const sby = p.slots.map((s) => (s.crewId ? g.crew[s.crewId] : undefined)).find((c) => c?.standby?.some((w) => w.calledAt !== undefined && w.from <= d.report && w.to + 12 * 60 > d.report));
  if (sby) notes.push(`${crewName(sby)} was called from home standby: their own day may be shorter.`);
  if (d.discretion) notes.push(`Commander's discretion: +${hm(d.discretion)} on the day.`);
  if (d.legacyRest) notes.push('Planned before the in-flight rest rules: kept as rostered.');
  notes.push(d.augment > 0 ? 'EASA CS FTL.1.205(c)' : d.ext ? 'EASA CS FTL.1.205(b)' : d.split ? 'EASA CS FTL.1.220' : 'EASA ORO.FTL.205(b)');
  const options = [
    { label: 'No rest', max: basic },
    { label: 'Extension', max: ext },
    { label: '3 pilots', max: a1 },
    { label: '4 pilots', max: a2 },
  ];
  return { fdp: d.fdp, limit, mode, title: `Day length ${hm(d.fdp)} of ${hm(limit)}`, why, cabin, notes, options };
}

/**
 * v0.7.3 'Fly it with 4 pilots' (aug 2) or back to the planner's choice (null): the duty's pairing gets the new
 * complement and the roster fills it (the crew already on it stay). Not after report.
 */
export function setDutyAugment(g: GameState, dutyId: string, aug: 2 | null): ActionResult {
  const d = g.duties[dutyId];
  const p = d ? g.pairings[d.pairingId] : undefined;
  if (!d || !p) return { ok: false, error: 'Duty not found' };
  if (d.done || d.report <= g.now) return { ok: false, error: 'The crew have already reported' };
  if (aug === 2) {
    const plan = restPlan(g, d.id, { augment: 2 });
    if (!plan) return { ok: false, error: 'No in-flight rest on this aircraft' };
    // v0.7.3 a duty planned before the rest rules (legacyRest) is re-planned under them: the plan must fit too.
    if (!plan.ok) return { ok: false, error: `${d.legacyRest ? 'Planned before the new rules, and even' : 'Even'} with 4 pilots: ${plan.why ?? 'no rest plan'}` };
    d.forceAug = 2;
  } else delete d.forceAug;
  const legacy = d.legacyRest;
  if (aug === 2) delete d.legacyRest;
  for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
  if (aug === 2 && d.augment !== 2) {
    // The day is over the 4-pilot limit for these facilities: back as it was.
    delete d.forceAug;
    if (legacy) d.legacyRest = legacy;
    for (const id of refreshPairing(g, p)) releaseCrew(g, p, id);
    setFlightsCrew(g, p);
    touchCrew(g);
    return { ok: false, error: `A ${hm(d.fdp)} day is over the 4-pilot limit on this aircraft` };
  }
  setFlightsCrew(g, p);
  touchCrew(g);
  if (p.aircraftId) autoRoster(g, { aircraftIds: [p.aircraftId] });
  return { ok: true, msg: aug === 2 ? `Flies with 4 pilots${crewCount(p) ? '' : ': the roster finds the crew'}` : "Back to the planner's choice" };
}
