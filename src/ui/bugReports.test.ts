// v0.16.1 bug reports: the store, the context capture, the export file and a snapshot that loads again.

import { describe, expect, it } from 'vitest';
import { fixtureGame } from '../engine/crew/fixtures';
import { demoFlights } from '../engine/dev';
import { deserialize } from '../engine/save';
import {
  addReport, BUGS_FORMAT, captureContext, entitySummary, exportFile, exportFileName, loadSnapshot, makeReport, memoryStore, parseBugsFile, snapshotOf, snapshotText, storageNote, summaryText, WARN_REPORTS,
} from './bugReports';

const env = { tab: 'schedule', view: 'day', modal: 'sheet', settings: { sound: true }, device: { kind: 'ipad', form: 'tablet', input: 'touch', standalone: true }, viewport: { w: 1180, h: 820, dpr: 2 }, ua: 'test' };

describe('v0.16.1 bug reports', () => {
  it('captures the context: game time UTC and local, version, screen, the flight and its state, the Inbox, device', () => {
    const g = fixtureGame(5);
    demoFlights(g);
    const f = Object.values(g.flights).find((x) => x.status === 'scheduled' && x.aircraftId)!;
    const c = captureContext(g, { ...env, sel: { kind: 'flight', id: f.id } });
    expect(c.version).toMatch(/^v0\.\d/);
    expect(c.gameTime).toMatch(/UTC$/);
    expect(c.gameTimeLocal).toContain(g.company.homeBase);
    expect(c.screen).toEqual({ tab: 'schedule', view: 'day', modal: 'sheet', sel: { kind: 'flight', id: f.id } });
    expect(c.entity?.label).toBe(`Flight ${f.no}`);
    expect(c.entity?.lines[0]).toContain(`${f.from}–${f.to}`);
    expect(c.entity?.lines.some((l) => l.startsWith('Crew:'))).toBe(true);
    expect(c.inbox.length).toBeLessThanOrEqual(12);
    expect(c.device.viewport).toBe('1180×820');
    expect(c.device.standalone).toBe(true);
    // A card's subject pre-fills over the selection, and the dialog the link was in is kept.
    const ac = Object.values(g.fleet)[0];
    const c2 = captureContext(g, { ...env, sel: { kind: 'flight', id: f.id } }, { ref: { kind: 'aircraft', id: ac.id }, modal: 'crewControl' });
    expect(c2.entity?.label).toBe(ac.reg);
    expect(c2.screen.modal).toBe('crewControl');
    for (const kind of ['crew', 'contract', 'client', 'offer'] as const) {
      const id = kind === 'crew' ? Object.keys(g.crew)[0] : kind === 'contract' ? Object.keys(g.contracts)[0] : kind === 'client' ? Object.keys(g.clients)[0] : Object.keys(g.offers)[0];
      if (id) expect(entitySummary(g, { kind, id })?.lines.length).toBeGreaterThan(0);
    }
  });

  it('a snapshot is a compressed save that loads again at the same minute', () => {
    const g = fixtureGame(5);
    const s = snapshotOf(g);
    expect(s.startsWith('lz1:')).toBe(true);
    expect(s.length).toBeLessThan(JSON.stringify(g).length);
    const h = loadSnapshot(s);
    expect(h.now).toBe(g.now);
    expect(Object.keys(h.flights).length).toBe(Object.keys(g.flights).length);
    expect(deserialize(snapshotText(s)).company.name).toBe(g.company.name);
  });

  it('the store keeps reports newest first, deletes one, and warns once there are many', async () => {
    const g = fixtureGame(5);
    const store = memoryStore();
    const ctx = captureContext(g, env);
    const a = makeReport(g, { title: ' First ', what: 'x', expected: 'y' }, ctx, 1000);
    const b = makeReport(g, { title: '', what: '', expected: '' }, ctx, 2000);
    await addReport(a, store);
    const list = await addReport(b, store);
    expect(list.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(list[1].title).toBe('First');
    expect(list[0].title).toBe('Bug report');
    expect(list[0].size).toBe(b.snapshot.length);
    expect('snapshot' in list[0]).toBe(false);
    expect(storageNote(list)).toBeNull();
    expect(storageNote(Array.from({ length: WARN_REPORTS }, () => list[0]))).toMatch(/^30 reports, about \d+ MB on this device/);
    await store.remove(a.id);
    expect((await store.list()).map((r) => r.id)).toEqual([b.id]);
    expect((await store.get(b.id))?.snapshot).toBe(b.snapshot);
    expect(await store.get(a.id)).toBeNull();
  });

  it('the export file holds every report with its snapshot and the current save; the loader reads it back', () => {
    const g = fixtureGame(5);
    const ctx = captureContext(g, env);
    const a = makeReport(g, { title: 'A', what: 'w', expected: 'e' }, ctx, 2000);
    const b = makeReport(g, { title: 'B', what: '', expected: '' }, ctx, 1000);
    const text = exportFile([a, b], g, new Date('2026-11-05T10:00:00Z'));
    const file = parseBugsFile(text);
    expect(file.format).toBe(BUGS_FORMAT);
    expect(file.exportedAt).toBe('2026-11-05T10:00:00.000Z');
    expect(file.company).toBe(g.company.name);
    expect(file.reports.map((r) => r.title)).toEqual(['B', 'A']);
    expect(deserialize(file.currentSave!).now).toBe(g.now);
    expect(loadSnapshot(file.reports[0].snapshot).now).toBe(g.now);
    expect(() => parseBugsFile(JSON.stringify({ format: 'blockhours-save' }))).toThrow(/not a BLOCK HOURS bug report export/);
    expect(exportFileName('Blue Airlines', new Date('2026-11-05T10:00:00Z'))).toBe('blue-airlines-bugreports-2026-11-05.blockhours-bugs.json');
    expect(exportFileName(null, new Date('2026-11-05T10:00:00Z'))).toBe('blockhours-bugreports-2026-11-05.blockhours-bugs.json');
    // Without a game running the file still carries the reports.
    expect(parseBugsFile(exportFile([a], null)).currentSave).toBeNull();
    const txt = summaryText([a, b]);
    expect(txt.startsWith('# B\n')).toBe(true);
    expect(txt).toContain('What happened: w');
    expect(txt).toContain('Screen: schedule › day · dialog sheet');
  });
});
