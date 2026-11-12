// v0.22.1 every crew alarm that reaches the player goes quietly into Bug reports (the player: "I want every problem card
// regarding crew shortage … added quietly to the bug report. Then when I upload it here, I want you to cross-check them
// again to see if they actually were right or wrong"). Pinned here: the engine keeps a record of each confirmed alarm;
// the filer turns it into a report with the card's words and the game at that minute; the same flight and kind is filed
// once unless its words change; alarms of one game minute share one snapshot; only the newest keep theirs; the export
// carries them and the cross-check (crew/crossCheck.ts) reads them back: CVE166 was WRONG, and is crewed by this version.

import { describe, expect, it } from 'vitest';
import { fmtDateTime } from '../engine/core/time';
import type { GameState } from '../engine/core/types';
import { crewShortCard, escalateShortages } from '../engine/crew';
import { crossCheck, crossPlanLines } from '../engine/crew/crossCheck';
import { confirmAlarm, takeCrewAlarmRecords } from '../engine/crew/selfCheck';
import { fixture } from '../engine/fixtures/compatKit';
import { deserialize, serialize } from '../engine/save';
import {
  addCrewAlarms, addReport, CREW_ALARM_KEEP, CREW_ALARM_SNAPS, crewAlarmHousekeeping, crewAlarmSig, exportFile, exportSelection, isCrewAlarm, makeReport, memoryStore, newCrewAlarms, packSnapshot, parseBugsFile,
  snapshotFor, snapshotText, type BugContext, type BugReport, type BugReportMeta, type CrewAlarmEntry,
} from './bugReports';
import { crewAlarmEntry } from './selfCheckFiler';

/** The player's save as the older build left it (no once-on-load repair): CVE166 red with nobody aboard. */
const raw = (): GameState => {
  const data = JSON.parse(fixture('v022-cve166')) as { state: GameState };
  data.state.stats.sideTripRedo = true;
  data.state.stats.perCrewRedo = true;
  data.state.stats.planRefund = 0;
  return deserialize(JSON.stringify(data));
};
const ctx = (g: GameState): BugContext => ({ version: 'v0.22.1', gameTime: `${fmtDateTime(g.now)} UTC`, gameTimeLocal: '', now: g.now, company: g.company.name, seed: g.seed, screen: { tab: 'map' }, inbox: [], settings: {}, device: { viewport: '1180×820', dpr: 2, ua: 'test' } });
const entry = (over: Partial<CrewAlarmEntry> = {}): CrewAlarmEntry => ({ t: 1000, kind: 'short', flightId: 'f1', no: 'CVE166', leg: 'JED–LGW 4 May 10:15', title: 'CVE166 has no crew', why: 'Nobody is free.', evidence: ['pilots 0 of 2'], verdict: 'confirmed', ...over });

describe('v0.22.1 crew alarms: the engine keeps a record of every alarm that fires', () => {
  it('a confirmed alarm is queued with its flight, kind, title and evidence; taking the records empties the queue', () => {
    const g = raw();
    const f = g.flights.f39l;
    delete f.crewAlert;
    const before = g.selfCheck?.alarms?.length ?? 0;
    const v = confirmAlarm(g, 'short', f, `CREW SHORTAGE: ${f.no} in 4 h`, [], { fix: false });
    expect(v.confirmed).toBe(true);
    const q = g.selfCheck!.alarms!;
    expect(q.length).toBe(before + 1);
    const rec = q[q.length - 1];
    expect(rec).toMatchObject({ t: g.now, kind: 'short', flightId: 'f39l', no: 'CVE166', title: 'CREW SHORTAGE: CVE166 in 4 h' });
    expect(rec.leg).toBe('JED–LGW 4 May 10:15');
    expect(rec.evidence.join(' ')).toMatch(/2 seats empty \(CPT, FO\)/);
    // It survives a save (the UI may file it after a reload) and is taken once.
    const again = deserialize(serialize(g));
    expect(again.selfCheck?.alarms?.length).toBe(before + 1);
    expect(takeCrewAlarmRecords(g).length).toBe(before + 1);
    expect(takeCrewAlarmRecords(g)).toEqual([]);
  });

  it('the ladder files its own alarms the same way (amber, red, the early heads-up)', () => {
    const g = raw();
    for (const f of Object.values(g.flights)) { delete f.crewAlert; delete f.crewEarly; delete f.waitTried; }
    escalateShortages(g, { reroster: false, freeFix: false });
    const recs = takeCrewAlarmRecords(g);
    expect(recs.some((r) => r.flightId === 'f39l' && r.kind === 'short' && /^CREW SHORTAGE: CVE166/.test(r.title))).toBe(true);
  });

  it('the report entry carries the card: what, why, does it hurt, the Inbox line and the evidence', () => {
    const g = raw();
    const f = g.flights.f39l;
    const v = confirmAlarm(g, 'short', f, 'CREW SHORTAGE: CVE166 in 4 h', [], { fix: false });
    const rec = takeCrewAlarmRecords(g).pop()!;
    const a = crewAlarmEntry(g, rec);
    const card = crewShortCard(g, f.id)!;
    expect(a).toMatchObject({ kind: 'short', flightId: 'f39l', no: 'CVE166', verdict: 'confirmed', what: card.what, why: card.why, hurt: card.hurt.text });
    expect(a.evidence).toEqual(v.evidence.slice(0, 8));
    expect(a.why!.length).toBeGreaterThan(20);
  });
});

describe('v0.22.1 crew alarms in Bug reports: quiet, deduped, small', () => {
  it('the same flight and kind once, unless its words or evidence change; never twice in a batch', () => {
    const a = entry();
    expect(newCrewAlarms([], [a, entry()])).toEqual([a]);
    const stored: BugReportMeta[] = [{ id: 'b1', createdAt: 1, title: 't', what: '', expected: '', context: {} as BugContext, size: 0, auto: 'crew-alarm', alarm: a }];
    expect(newCrewAlarms(stored, [entry()])).toEqual([]);
    // The hours left in a red title are not new words; another kind, other evidence or another why are.
    expect(crewAlarmSig(entry({ title: 'CREW SHORTAGE: CVE166 in 12 h' }))).toBe(crewAlarmSig(entry({ title: 'CREW SHORTAGE: CVE166 in 4 h' })));
    expect(newCrewAlarms(stored, [entry({ kind: 'early' })]).length).toBe(1);
    expect(newCrewAlarms(stored, [entry({ evidence: ['pilots 1 of 2'] })]).length).toBe(1);
    expect(newCrewAlarms(stored, [entry({ why: 'Their rest ends too late.' })]).length).toBe(1);
    expect(newCrewAlarms(stored, [entry({ flightId: 'f2' })]).length).toBe(1);
    // The player's own report about the same flight never counts.
    expect(newCrewAlarms([{ ...stored[0], auto: undefined }], [entry()]).length).toBe(1);
  });

  it('alarms of one game minute share one snapshot; a later minute gets its own; the player\'s reports are untouched', async () => {
    const g = raw();
    const store = memoryStore();
    const mine = makeReport(g, { title: 'My report', what: 'x', expected: 'y' }, ctx(g), 5);
    await addReport(mine, store);
    let packs = 0;
    const snap = () => { packs++; return packSnapshot(serialize(g, 'bug')); };
    const gt = (t: number) => fmtDateTime(t);
    const first = await addCrewAlarms([entry({ t: g.now }), entry({ t: g.now, flightId: 'f2', no: 'CVE162' })], () => ctx(g), snap, gt, store, 10);
    expect(first.length).toBe(2);
    expect(packs).toBe(1);
    expect(first[0].size).toBeGreaterThan(0);
    expect(first[1]).toMatchObject({ size: 0, snapshot: '', snapOf: first[0].id, auto: 'crew-alarm' });
    expect(first[0].title).toBe('Crew alarm: CVE166 has no crew');
    expect(first[0].what).toMatch(/Why: Nobody is free\./);
    // The same minute again (another ladder run): the stored snapshot is reused, nothing new is compressed.
    const same = await addCrewAlarms([entry({ t: g.now, flightId: 'f3', no: 'CVE170' })], () => ctx(g), snap, gt, store, 20);
    expect(same[0].snapOf).toBe(first[0].id);
    expect(packs).toBe(1);
    // A repeat is not filed; a later minute carries its own snapshot.
    expect(await addCrewAlarms([entry({ t: g.now })], () => ctx(g), snap, gt, store, 30)).toEqual([]);
    const later = await addCrewAlarms([entry({ t: g.now + 60, kind: 'hours', title: 'CVE166: crew out of hours' })], () => ctx(g), snap, gt, store, 40);
    expect(later[0].size).toBeGreaterThan(0);
    expect(packs).toBe(2);
    const list = await store.list();
    expect(list.filter(isCrewAlarm).length).toBe(4);
    expect(list.filter((r) => !isCrewAlarm(r)).map((r) => r.id)).toEqual([mine.id]);
    // The snapshot a sharing record is replayed from.
    const full = (await Promise.all(list.map((r) => store.get(r.id)))) as BugReport[];
    const shared = full.find((r) => r.id === first[1].id)!;
    expect(snapshotFor(shared, full)).toBe(first[0].snapshot);
    expect(deserialize(snapshotText(snapshotFor(shared, full))).flights.f39l.no).toBe('CVE166');
  });

  it('only the newest keep a snapshot, and at most 60 records stay; the player\'s reports never go', () => {
    const list: BugReportMeta[] = [];
    for (let i = 0; i < CREW_ALARM_KEEP + 15; i++) list.push({ id: `a${i}`, createdAt: i, title: 't', what: '', expected: '', context: {} as BugContext, size: 80_000, auto: 'crew-alarm', alarm: entry({ flightId: `f${i}` }) });
    list.push({ id: 'mine', createdAt: 0, title: 'mine', what: '', expected: '', context: {} as BugContext, size: 900_000 });
    const hk = crewAlarmHousekeeping(list);
    // The 15 oldest records go.
    expect(hk.remove.sort()).toEqual(Array.from({ length: 15 }, (_, i) => `a${i}`).sort());
    // Of the 60 kept, the newest 12 keep their snapshot.
    expect(hk.strip.length).toBe(CREW_ALARM_KEEP - CREW_ALARM_SNAPS);
    expect(hk.strip).not.toContain(`a${CREW_ALARM_KEEP + 14}`);
    expect(hk.strip).toContain('a15');
    expect([...hk.remove, ...hk.strip]).not.toContain('mine');
    // Big snapshots (a large game): the character budget cuts sooner, but three always stay.
    const big = list.filter(isCrewAlarm).slice(-10).map((r) => ({ ...r, size: 700_000 }));
    expect(crewAlarmHousekeeping(big).strip.length).toBe(7);
  });

  it('the export carries them with the rest and marks them sent; the file stays small', async () => {
    const g = raw();
    const store = memoryStore();
    const snap = () => packSnapshot(serialize(g, 'bug'));
    for (let i = 0; i < 20; i++) await addCrewAlarms([entry({ t: g.now + i * 60, flightId: `f${i}`, no: `CVE${100 + i}` })], () => ctx(g), snap, (t) => fmtDateTime(t), store, 100 + i);
    const list = await store.list();
    expect(list.length).toBe(20);
    expect(list.filter((r) => r.size > 0).length).toBe(CREW_ALARM_SNAPS);
    const { take } = exportSelection(list, false);
    expect(take.length).toBe(20);
    const full = (await Promise.all(take.map((r) => store.get(r.id)))) as BugReport[];
    const file = exportFile(full, g, new Date(0));
    const back = parseBugsFile(file);
    expect(back.reports.filter((r) => isCrewAlarm(r) && r.alarm).length).toBe(20);
    // 20 records, 12 snapshots and the current save: a few MB at most on a game of this size (0.5 MB a save).
    const bytes = Buffer.byteLength(file, 'utf8');
    expect(bytes).toBeLessThan(6 * 1024 * 1024);
  });
});

describe('v0.22.1 the cross-check reads an alarm back: was it right?', () => {
  it('CVE166 was WRONG: a captain and a first officer at Jeddah could fly it and be back for their tour', () => {
    const g = raw();
    const before = JSON.stringify(g);
    const r = crossCheck(g, 'f39l', 'short');
    expect(r.verdict).toBe('WRONG');
    expect(r.seats).toEqual(['CPT', 'FO']);
    expect(r.plan.map((s) => s.role)).toEqual(['CPT', 'FO']);
    for (const s of r.plan) {
      expect(s.at).toBe('JED');
      expect(s.out).toBe('');
      expect(s.back).toMatch(/^back to JED on LGW–JED /);
      expect(g.crew[s.crewId].loc).toBe('JED');
    }
    expect(crossPlanLines(r)[0]).toMatch(/^CPT .+, at JED; back to JED on LGW–JED/);
    // The game itself is not touched by the check.
    expect(g.flights.f39l.crewIds).toEqual([]);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('with every Jeddah pilot sick it would have been RIGHT; this version crews the flight on load', () => {
    const g = raw();
    for (const c of Object.values(g.crew)) if (c.loc === 'JED' && (c.role === 'CPT' || c.role === 'FO')) c.blocks = [...(c.blocks ?? []), { from: g.now - 60, to: g.now + 3 * 1440, why: 'sick' }];
    const r = crossCheck(g, 'f39l', 'short');
    expect(r.verdict).toBe('RIGHT');
    expect(r.why).toMatch(/no legal crew for 2 of 2 seats/);
    const now = deserialize(fixture('v022-cve166'));
    expect(now.flights.f39l.crewIds.length).toBe(2);
    expect(crossCheck(now, 'f39l').verdict).toBe('UNSURE');
  });
});
