// Player bot round (Nov 2026): does the game warn in time that stacked contracts need more crew? For every contract the
// bot signs, the offer's crew line as the dialog showed it (ok, or "Short of crew: … from <date>", and the hire it
// advised); for every crew alarm, what the game's own advice said at that moment: the Planning card (sets short for the
// family), the busy-month forecast (a gap for that month) and the crew desk's open hire proposal, and the line the
// contract was signed with. A report at the end: alarms the advice saw coming vs alarms it did not ("silent").
// Read-only (never acts on the game).

import { DAY, fmtDay, monthKey } from '../../src/engine/core/time';
import { typeOf } from '../../src/engine/core/perf';
import type { CrewAlarmRecord, GameState } from '../../src/engine/core/types';
import type { FeasibilityReport } from '../../src/engine/contracts';
import { crewPlan } from '../../src/engine/crew/sets';
import { peakForecast } from '../../src/engine/crew/forecast';

interface Signed { t: number; start: number; level: string; label: string; short: number; firstShort: number | null; archetype: string }
const signed = new Map<string, Signed>();
interface AlarmNote { t: number; kind: string; no: string; contract: string | null; sign: Signed | null; planShort: boolean; forecast: boolean; desk: boolean; lead: number }
const alarms: AlarmNote[] = [];

/** The offer's crew line at signing (the report the bot signed with). */
export function noteSigned(g: GameState, contractId: string, r: FeasibilityReport, archetype: string): void {
  const c = r.checks.find((x) => x.id === 'crew');
  const short = Object.values(r.crew.byRole).reduce((n, x) => n + (x?.short ?? 0), 0);
  signed.set(contractId, { t: g.now, start: g.contracts[contractId]?.start ?? g.now, level: c?.level ?? '-', label: c?.label ?? '-', short, firstShort: r.crew.firstShort, archetype });
}

/** A crew alarm: the advice standing at that moment for the flight's family and month. */
export function noteAlarm(g: GameState, rec: CrewAlarmRecord): void {
  const f = g.flights[rec.flightId];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  const fam = ac ? typeOf(ac.typeId).family : null;
  const plan = fam ? crewPlan(g).find((p) => p.family === fam) : undefined;
  const mk = f ? monthKey(f.std) : -1;
  const fc = fam ? peakForecast(g).gaps.some((x) => x.family === fam && x.month === mk) : false;
  const desk = !!g.heads?.crewDesk?.proposals?.some((p) => p.kind === 'hire');
  alarms.push({
    t: g.now, kind: rec.kind, no: rec.no, contract: f?.contractId ?? null, sign: f?.contractId ? signed.get(f.contractId) ?? null : null,
    planShort: !!plan && plan.setsComplete < plan.setsNeeded, forecast: fc, desk, lead: f ? (f.std - g.now) / DAY : 0,
  });
}

export function adviceReport(): string[] {
  const out: string[] = [];
  const sv = [...signed.values()];
  const warned = sv.filter((s) => s.level !== 'ok');
  out.push(`advice: ${sv.length} contracts signed, crew line ok ${sv.length - warned.length}, warned ${warned.length} (${warned.slice(0, 6).map((s) => `${s.archetype} "${s.label}"`).join('; ')}${warned.length > 6 ? ' …' : ''})`);
  const rev = alarms.filter((a) => a.kind === 'short' || a.kind === 'early' || a.kind === 'hours');
  const onOk = rev.filter((a) => a.sign && a.sign.level === 'ok');
  const onWarn = rev.filter((a) => a.sign && a.sign.level !== 'ok');
  const seen = (a: AlarmNote) => a.planShort || a.forecast || a.desk || (!!a.sign && a.sign.level !== 'ok');
  const silent = rev.filter((a) => !seen(a));
  out.push(`advice at alarms: ${rev.length} crew alarms on legs; on contracts signed "crew ok" ${onOk.length}, signed with a crew warning ${onWarn.length}, no contract/other ${rev.length - onOk.length - onWarn.length}`);
  out.push(`  at the alarm: Planning card short ${rev.filter((a) => a.planShort).length}, busy-month forecast gap ${rev.filter((a) => a.forecast).length}, crew desk hire proposal open ${rev.filter((a) => a.desk).length}; none of these (silent) ${silent.length}`);
  for (const a of silent.slice(0, 12)) out.push(`    silent ${fmtDay(a.t)} ${a.kind} ${a.no} (${a.lead.toFixed(1)} d ahead)${a.sign ? ` signed ${fmtDay(a.sign.t)} as ${a.sign.archetype}, crew line "${a.sign.label}"` : ''}`);
  return out;
}
