// Alarm self-check (crew/selfCheck.ts): crew alarms the check withheld are filed into Bug reports with a snapshot, quietly
// (no chime, no pause, no toast), so the player can export them with the rest. One report per batch of records.

import { takeCrewAlarmRecords, takeSelfCheckRecords } from '../engine/crew/selfCheck';
import { crewShortCard } from '../engine/crew';
import { fmtDateTime } from '../engine/core/time';
import type { CrewAlarmRecord, GameState, SelfCheckRecord } from '../engine/core/types';
import { addCrewAlarms, addReport, makeReport, packSnapshot, type CrewAlarmEntry } from './bugReports';
import { serialize } from '../engine/save';
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

/**
 * v0.22.1 one confirmed crew alarm as the Bug reports keep it: the record, the problem card's words at that moment
 * (what, why, does it hurt) and the Inbox line it posted. Pure.
 */
export function crewAlarmEntry(g: GameState, rec: CrewAlarmRecord): CrewAlarmEntry {
  const card = g.flights[rec.flightId] ? crewShortCard(g, rec.flightId) : null;
  const msg = g.messages.find((m) => m.t === rec.t && m.title === rec.title) ?? g.messages.find((m) => m.t === rec.t && m.ref?.kind === 'flight' && m.ref.id === rec.flightId && m.cat === 'crew');
  return {
    t: rec.t, kind: rec.kind, flightId: rec.flightId, no: rec.no, leg: rec.leg, title: rec.title,
    ...(card ? { what: card.what, why: card.why, hurt: card.hurt.text } : {}),
    ...(msg ? { body: msg.body } : {}),
    evidence: rec.evidence, verdict: 'confirmed',
  };
}

/**
 * v0.22.1 every crew alarm that reached the player goes quietly into Bug reports (no chime, no toast, nothing on
 * screen): the same flight and kind once unless its words change, one snapshot per game minute, the oldest snapshots
 * dropped (bugReports.ts addCrewAlarms). Fire and forget; a storage error is only logged.
 */
export function fileCrewAlarms(g: GameState): void {
  const recs = takeCrewAlarmRecords(g);
  if (!recs.length) return;
  try {
    // Read now, while the game stands at the alarm's minute (the store is asynchronous and the clock runs on): the
    // words, the context and the game as plain save text; the text is compressed only if a new record needs it.
    const batch = recs.map((r) => crewAlarmEntry(g, r));
    const ctx = new Map(batch.map((a) => [a, contextNow(g, g.flights[a.flightId] ? { ref: { kind: 'flight', id: a.flightId } } : undefined)]));
    const text = serialize(g, 'bug');
    let snap: string | null = null;
    addCrewAlarms(batch, (a) => ctx.get(a)!, () => (snap ??= packSnapshot(text)), (t) => fmtDateTime(t)).catch((e) => console.warn('[crew-alarm] could not file the record', e));
  } catch (e) {
    console.warn('[crew-alarm] could not file the record', e);
  }
}
