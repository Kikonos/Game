// Alarm self-check (crew/selfCheck.ts): crew alarms the check withheld are filed into Bug reports with a snapshot, quietly
// (no chime, no pause, no toast), so the player can export them with the rest. One report per batch of records.

import { takeSelfCheckRecords } from '../engine/crew/selfCheck';
import { fmtDateTime } from '../engine/core/time';
import type { GameState, SelfCheckRecord } from '../engine/core/types';
import { addReport, makeReport } from './bugReports';
import { contextNow } from './modals/BugReportModals';

/** The words of a self-check report (title, what, expected). Pure. */
export function selfCheckWords(recs: readonly SelfCheckRecord[]): { title: string; what: string; expected: string } {
  const first = recs[0];
  return {
    title: `Self-check: ${first.title}${recs.length > 1 ? ` (+${recs.length - 1} more)` : ''}`,
    what: recs.map((r) => `${fmtDateTime(r.t)} UTC · ${r.title} — withheld: ${r.why}.${r.evidence.length ? ` ${r.evidence.join('; ')}.` : ''}`).join('\n'),
    expected: 'Filed by the game: this crew alarm did not chime or pause because an independent check disagreed with it.',
  };
}

/** Takes the withheld records from the game and files them (fire and forget; a storage error is only logged). */
export function fileSelfChecks(g: GameState): void {
  const recs = takeSelfCheckRecords(g);
  if (!recs.length) return;
  try {
    const ref = recs[0].flightId && g.flights[recs[0].flightId] ? { kind: 'flight' as const, id: recs[0].flightId } : undefined;
    const r = makeReport(g, selfCheckWords(recs), contextNow(g, ref ? { ref } : undefined));
    addReport(r).catch((e) => console.warn('[self-check] could not file the report', e));
  } catch (e) {
    console.warn('[self-check] could not file the report', e);
  }
}
