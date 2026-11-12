// v0.22.1 the bot's crew-alarm log (`--alarms` / `--alarms=file`): every crew alarm that reaches the player, as it fires,
// with the leg's kind, what its card says it hurts and the cross-check's verdict on it (src/engine/crew/crossCheck.ts,
// the judge behind scripts/crewcheck.ts: RIGHT, no legal crew existed / WRONG, a legal crew plan the planner missed /
// UNSURE).

import { writeFileSync } from 'node:fs';
import { fmtDateTime } from '../../src/engine/core/time';
import type { CrewAlarmRecord, GameState } from '../../src/engine/core/types';
import { crewShortCard } from '../../src/engine/crew';
import { setAlarmSpy } from '../../src/engine/crew/selfCheck';

export interface AlarmRow {
  t: number;
  kind: string;
  no: string;
  title: string;
  leg: string;
  /** revenue / positioning / ferry (+ purpose). */
  legKind: string;
  /** The card's "does it hurt": level, money, passengers. */
  hurt: string;
  verdict?: string;
  plan?: string;
}

export interface AlarmLog {
  rows: AlarmRow[];
  report(): string[];
  save(file: string): void;
}

export function watchAlarms(opts: { judge?: (g: GameState, rec: CrewAlarmRecord) => { verdict: string; plan?: string } | null } = {}): AlarmLog {
  const rows: AlarmRow[] = [];
  setAlarmSpy((g, rec) => {
    const f = g.flights[rec.flightId];
    const card = f ? crewShortCard(g, f.id) : null;
    const row: AlarmRow = {
      t: rec.t, kind: rec.kind, no: rec.no, title: rec.title, leg: rec.leg,
      legKind: f ? `${f.kind}${f.purpose ? `/${f.purpose}` : ''}${f.contractId ? '' : ' no-contract'}` : '?',
      hurt: card ? `${card.hurt.level} $${Math.round(card.hurt.money)} pax ${card.hurt.pax}` : '-',
    };
    const j = opts.judge?.(g, rec);
    if (j) {
      row.verdict = j.verdict;
      row.plan = j.plan;
    }
    rows.push(row);
  });
  const line = (r: AlarmRow) => `${fmtDateTime(r.t)} ${r.kind.padEnd(8)} ${r.legKind.padEnd(24)} ${r.verdict ? `${r.verdict.padEnd(6)} ` : ''}${r.title} · ${r.leg} · hurt ${r.hurt}${r.plan ? ` · ${r.plan}` : ''}`;
  return {
    rows,
    report() {
      const by = new Map<string, number>();
      for (const r of rows) {
        const k = `${r.kind} ${r.legKind.split('/')[0].split(' ')[0]}`;
        by.set(k, (by.get(k) ?? 0) + 1);
      }
      const out = [`crew alarms: ${rows.length} (${[...by].sort().map(([k, n]) => `${k} ${n}`).join(', ')})`];
      const v = new Map<string, number>();
      for (const r of rows) if (r.verdict) v.set(r.verdict, (v.get(r.verdict) ?? 0) + 1);
      if (v.size) out.push(`cross-check: ${[...v].sort().map(([k, n]) => `${k} ${n}`).join(', ')}`);
      return out;
    },
    save(file) {
      writeFileSync(file, `${rows.map(line).join('\n')}\n`);
    },
  };
}
