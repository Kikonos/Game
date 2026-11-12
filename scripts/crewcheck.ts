// v0.22.1 the crew-alarm cross-check: for every crew alarm the game filed into Bug reports (a "Bug reports › Export"
// file), loads the game as it stood at that minute and judges, apart from the planner, whether the alarm was right
// (src/engine/crew/crossCheck.ts): a search of ALL crew for a legal way to crew the flight.
//
//   npx tsx scripts/crewcheck.ts <file.blockhours-bugs.json | save.json> [--plans] [--json=out.json]
//
// - a bug export: every crew-alarm record (its own snapshot, or the one it shares with another alarm of the same game
//   minute), then the flights marked short of crew in the export's current save;
// - a plain save file: every flight marked short of crew in it (amber, red or the early heads-up).
// Verdicts: RIGHT (no legal crew existed) / WRONG (a legal crew plan the planner missed: who, how they get there, how
// they get back; `--plans` prints it) / UNSURE. The snapshot is read as it was (this version's load repairs that
// re-roster or refund are switched off for the judging); the last column says what this version's planner does with
// the same game on load ("crewed now" / "still short").

import { readFileSync, writeFileSync } from 'node:fs';
import { fmtDateTime } from '../src/engine/core/time';
import type { GameState } from '../src/engine/core/types';
import { flightCrewStatus } from '../src/engine/crew';
import { crossCheck, crossPlanLines, type CrossResult } from '../src/engine/crew/crossCheck';
import type { AlarmKind } from '../src/engine/crew/selfCheck';
import { deserialize } from '../src/engine/save';
import { BUGS_FORMAT, isCrewAlarm, parseBugsFile, snapshotFor, snapshotText } from '../src/ui/bugReports';

interface Row extends CrossResult {
  /** Game time of the alarm (or of the save). */
  when: string;
  kind: string;
  title: string;
  /** What this version's planner makes of the same game on load. */
  now: string;
  source: string;
}

/** The game as the snapshot left it: the once-on-load repairs of this version (re-roster, refund) do not run. */
function asItWas(text: string): GameState {
  const data = JSON.parse(text) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  data.state.stats.planRefund ??= 0;
  return deserialize(JSON.stringify(data));
}

const short = (g: GameState, id: string): boolean => {
  const f = g.flights[id];
  if (!f || f.status !== 'scheduled') return false;
  const lv = flightCrewStatus(g, id, { live: false }).level;
  return lv === 'missing' || lv === 'illegal';
};

/** What this version's planner does with the same game on load. */
function nowWords(text: string, flightId: string): string {
  try {
    const g = deserialize(text);
    const f = g.flights[flightId];
    if (!f) return 'flight gone';
    if (f.status !== 'scheduled') return f.status;
    return short(g, flightId) ? 'still short' : `crewed now (${f.crewIds.map((id) => g.crew[id]?.last ?? id).join(', ')})`;
  } catch (e) {
    return `load failed: ${(e as Error).message}`;
  }
}

function judgeSave(text: string, source: string, rows: Row[]): void {
  const g = asItWas(text);
  const seen = new Set<string>();
  const marked = Object.values(g.flights)
    .filter((f) => f.status === 'scheduled' && f.kind !== 'deadhead' && (f.crewAlert || f.crewEarly) && short(g, f.id))
    .sort((a, b) => a.std - b.std || (a.id < b.id ? -1 : 1));
  for (const f of marked) {
    // One row per duty (its legs share the alarm).
    const k = f.dutyId ?? f.id;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = crossCheck(g, f.id);
    rows.push({ ...r, when: fmtDateTime(g.now), kind: f.crewAlert ?? 'early', title: `${f.no} marked ${f.crewAlert ?? 'early heads-up'}`, now: nowWords(text, f.id), source });
  }
}

function main(): void {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const plans = process.argv.includes('--plans');
  const jsonOut = process.argv.find((a) => a.startsWith('--json='))?.slice(7);
  const [file] = args;
  if (!file) {
    console.log('usage: crewcheck.ts <file.blockhours-bugs.json | save.json> [--plans] [--json=out.json]');
    process.exit(1);
  }
  const text = readFileSync(file, 'utf8');
  const rows: Row[] = [];
  let head = '';
  if (text.slice(0, 200).includes(`"${BUGS_FORMAT}"`)) {
    const data = parseBugsFile(text);
    const alarms = data.reports.filter((r) => isCrewAlarm(r) && r.alarm);
    head = `${data.app} · exported ${data.exportedAt} · ${data.company ?? '(no game)'} · ${alarms.length} crew alarm record(s) of ${data.reports.length} report(s)`;
    const cache = new Map<string, GameState>();
    for (const r of alarms) {
      const a = r.alarm!;
      const snap = snapshotFor(r, data.reports);
      if (!snap) {
        rows.push({ verdict: 'UNSURE', flightId: a.flightId, no: a.no, leg: a.leg, seats: [], plan: [], why: 'no snapshot kept for this record (only the newest keep one)', tried: 0, refused: {}, when: fmtDateTime(a.t), kind: a.kind, title: a.title, now: '-', source: r.id });
        continue;
      }
      const key = r.snapOf ?? r.id;
      let g = cache.get(key);
      const saveText = snapshotText(snap);
      if (!g) cache.set(key, (g = asItWas(saveText)));
      const res = crossCheck(g, a.flightId, a.kind as AlarmKind);
      rows.push({ ...res, when: fmtDateTime(a.t), kind: a.kind, title: a.title, now: nowWords(saveText, a.flightId), source: r.id });
    }
    if (data.currentSave) judgeSave(data.currentSave, 'current save', rows);
  } else {
    head = `save file ${file}`;
    judgeSave(text, 'save', rows);
  }
  console.log(head);
  if (!rows.length) {
    console.log('no crew alarms to check (no crew-alarm records, and no flight marked short of crew).');
    return;
  }
  const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
  console.log(`\n${pad('verdict', 8)}${pad('game time', 14)}${pad('kind', 9)}${pad('flight', 9)}${pad('leg', 26)}${pad('seats', 12)}${pad('this version', 30)}why`);
  for (const r of rows) console.log(`${pad(r.verdict, 8)}${pad(r.when, 14)}${pad(r.kind, 9)}${pad(r.no, 9)}${pad(r.leg, 26)}${pad(r.seats.join(',') || '-', 12)}${pad(r.now, 30)}${r.why}`);
  if (plans) {
    for (const r of rows) {
      if (!r.plan.length) continue;
      console.log(`\n${r.verdict} ${r.no} ${r.leg} (${r.when}): ${r.title}`);
      for (const l of crossPlanLines(r)) console.log(`  ${l}`);
      const ref = Object.entries(r.refused).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${k}`).join('; ');
      if (ref) console.log(`  others (${r.tried} looked at): ${ref}`);
    }
  }
  const n = (v: string) => rows.filter((r) => r.verdict === v).length;
  console.log(`\nsummary: ${rows.length} alarm(s) checked · RIGHT ${n('RIGHT')} · WRONG ${n('WRONG')} · UNSURE ${n('UNSURE')}`);
  if (jsonOut) {
    writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
    console.log(`rows written to ${jsonOut}`);
  }
}

main();
