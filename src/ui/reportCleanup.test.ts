// v0.23.1 the player: "Build a feature that auto-deletes fixed bugs when I open the game." Pinned here: the reports the
// version installed lists as fixed go when the game opens (the player's own others stay); the records the game filed
// itself (crew alarms, self-checks) by an older version go; a record without an id gets a stable one from its content;
// and (the export kept a snapshot for only 12 of 60 crew alarms) every crew alarm keeps one, as the changes since the
// record before, rebuilt character for character, also after records it was built on are deleted.

import { describe, expect, it } from 'vitest';
import { FIXED_REPORTS } from '../data/fixedReports';
import { CURRENT } from '../data/whatsNew';
import { fmtDateTime } from '../engine/core/time';
import type { GameState } from '../engine/core/types';
import { fixture } from '../engine/fixtures/compatKit';
import { deserialize, serialize } from '../engine/save';
import {
  addCrewAlarms, cleanReportsOnOpen, clearedTitle, dropReports, exportReady, memoryStore, openCleanup, resetSnapChain, SELF_CHECK_EXPECTED, snapshotTextFor, stableReportId, storedSnapshotText,
  type BugContext, type BugReport, type BugReportMeta, type CrewAlarmEntry, type ReportStore,
} from './bugReports';
import { applyJson, diffJson } from './snapDelta';

const ctx = (version: string, gameTime = '1 Jun 08:00 UTC'): BugContext => ({ version, gameTime, gameTimeLocal: '', company: 'Chevron', seed: 1, screen: { tab: 'map' }, inbox: [], settings: {}, device: { viewport: '1180×788', dpr: 2, ua: 'test' } });
const rep = (id: string | undefined, over: Partial<BugReport> = {}): BugReport => ({ id: id as string, createdAt: 1000, title: 'Bug report', what: 'Something odd', expected: '', context: ctx(CURRENT.version), size: 0, snapshot: '', ...over });
const entry = (over: Partial<CrewAlarmEntry> = {}): CrewAlarmEntry => ({ t: 1000, kind: 'short', flightId: 'f1', no: 'CVE166', leg: 'JED–LGW 4 May 10:15', title: 'CVE166 has no crew', why: 'Nobody is free.', evidence: [], verdict: 'confirmed', ...over });

describe('v0.23.1 snapshot changes are lossless', () => {
  const round = (a: unknown, b: unknown) => JSON.stringify(applyJson(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(diffJson(a, b) ?? null)) ?? undefined));
  it('objects (keys added, changed, deleted; number keys), arrays (items before, after, changed, dropped), kinds changed', () => {
    const a = { s: 'x', n: 1, o: { k: [1, 2, 3], 10: 'a', 2: 'b', z: { deep: true } }, arr: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }], gone: 5, t: [1] };
    const b = { s: 'y', n: 1, o: { k: [0, 1, 2, 3, 4], 10: 'a', 2: 'c', 5: 'new', z: { deep: false }, w: null }, arr: [{ id: 0 }, { id: 1 }, { id: 2.5 }, { id: 3 }], t: { now: 'object' }, add: [] };
    expect(round(a, b)).toBe(JSON.stringify(b));
    expect(diffJson(a, JSON.parse(JSON.stringify(a)))).toBeUndefined();
    // A changed key order is kept (the whole object is replaced).
    expect(round({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe('{"b":2,"a":1}');
  });

  it('a real game a few hours on: the very same save text, from a small part of it', () => {
    const g = deserialize(fixture('v022-cve166'));
    const t1 = serialize(g, 'bug');
    g.now += 180;
    g.messages.unshift({ ...g.messages[0], id: 'mNew', t: g.now, title: 'New line' });
    const f = Object.values(g.flights)[0];
    f.delay = (f.delay ?? 0) + 25;
    const t2 = serialize(g, 'bug');
    const d = diffJson(JSON.parse(t1), JSON.parse(t2));
    expect(JSON.stringify(applyJson(JSON.parse(t1), d))).toBe(t2);
    expect(JSON.stringify(d).length).toBeLessThan(t2.length / 50);
  });
});

describe('v0.23.1 the clean-up when the game opens', () => {
  const fixedId = Object.keys(FIXED_REPORTS)[0];
  it('fixed reports go (named by the player\'s words), unlisted ones stay; older game-filed records go, this version\'s stay', () => {
    const list: BugReportMeta[] = [
      rep(fixedId, { what: 'Crew “?” Info off screen' }),
      rep('mine'),
      rep('alarmOld', { auto: 'crew-alarm', context: ctx('v0.23') }),
      rep('alarmNow', { auto: 'crew-alarm' }),
      rep('selfOld', { title: 'Self-check: XY3060 can\'t fly', expected: SELF_CHECK_EXPECTED, context: ctx('v0.22.1') }),
      rep('selfNow', { auto: 'self-check' }),
      rep('mineOld', { context: ctx('v0.21') }),
    ];
    const c = openCleanup(list, CURRENT.version, 5);
    expect(c.remove.sort()).toEqual([fixedId, 'alarmOld', 'selfOld'].sort());
    expect(c.fixed).toEqual([{ id: fixedId, title: 'Crew “?” Info off screen', version: FIXED_REPORTS[fixedId].version, what: FIXED_REPORTS[fixedId].what, at: 5 }]);
    expect(c.old).toBe(2);
    expect(c.rekey).toEqual([]);
    expect(clearedTitle(3)).toBe('3 fixed bug reports cleared');
    expect(clearedTitle(1)).toBe('1 fixed bug report cleared');
  });

  it('this version\'s own fixes: the player\'s reports seeded in the list are cleared', () => {
    for (const id of ['bmwc20bgx36j', 'bmwcx84rmc1t8', 'bmwcy1l6r5e6w', 'bmwdgjk45aj1h', 'bmwdgkcfg2ur3', 'bmwdgq50o8vuy', 'bmwdorhy4a9hd', 'bmwdolc94ctrb', 'bmwdo5trhi3sl', 'bmwdnxjlp5jo6', 'bmwdnzq5ab7lk', 'bmwdp7pj1ebdw']) {
      expect(FIXED_REPORTS[id]).toBeDefined();
      expect(openCleanup([rep(id)], CURRENT.version).remove).toEqual([id]);
    }
  });

  it('an old store without ids: each record gets a stable id from its content, then the clean-up runs', async () => {
    // A store addressed by id where the records have none (the first id-less record answers `undefined`).
    const rows: BugReport[] = [
      rep(undefined, { createdAt: 1, title: 'First', what: 'a' }),
      rep(undefined, { createdAt: 2, title: 'Second', what: 'b', auto: 'crew-alarm', context: ctx('v0.22') }),
    ];
    const store: ReportStore = {
      list: async () => rows.map(({ snapshot: _s, ...m }) => m),
      get: async (id) => rows.find((r) => r.id === id) ?? null,
      put: async (r) => { const i = rows.findIndex((x) => x.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); },
      remove: async (id) => { const i = rows.findIndex((x) => x.id === id); if (i >= 0) rows.splice(i, 1); },
    };
    const id1 = stableReportId(rows[0]);
    expect(id1).toBe(stableReportId({ createdAt: 1, title: 'First', what: 'a', context: ctx(CURRENT.version) }));
    expect(id1).not.toBe(stableReportId(rows[1]));
    const out = await cleanReportsOnOpen(store, CURRENT.version);
    expect(out).toEqual({ fixed: [], old: 1 });
    expect(rows.map((r) => r.id)).toEqual([id1]);
    // Run again: nothing changes (the id is stable).
    expect(await cleanReportsOnOpen(store, CURRENT.version)).toEqual({ fixed: [], old: 0 });
    expect(rows.map((r) => r.id)).toEqual([id1]);
  });
});

describe('v0.23.1 every crew alarm keeps a snapshot, also when the ones it was built on go', () => {
  const g0 = (): GameState => deserialize(fixture('v022-cve166'));
  const file = async () => {
    resetSnapChain();
    const g = g0();
    const store = memoryStore();
    const texts: string[] = [];
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) {
      g.now += 240;
      g.messages.unshift({ ...g.messages[0], id: `m${i}`, t: g.now, title: `Line ${i}` });
      const text = serialize(g, 'bug');
      const out = await addCrewAlarms([entry({ t: g.now, flightId: `f${i}`, no: `CVE${i}` })], () => ctx(CURRENT.version), () => text, (t) => fmtDateTime(t), store, 100 + i);
      ids.push(out[0].id);
      texts.push(text);
    }
    return { store, texts, ids };
  };
  const all = async (store: ReportStore) => (await Promise.all((await store.list()).map((m) => store.get(m.id)))) as BugReport[];

  it('one whole game, then the changes; deleting the whole one or one in the middle keeps every other exact', async () => {
    const { store, texts, ids } = await file();
    const list = await all(store);
    const byId = new Map(list.map((r) => [r.id, r]));
    expect(byId.get(ids[0])!.snapBase).toBeUndefined();
    for (let i = 1; i < 6; i++) expect(byId.get(ids[i])!.snapBase).toBe(ids[i - 1]);
    const whole = byId.get(ids[0])!.size;
    for (let i = 1; i < 6; i++) expect(byId.get(ids[i])!.size).toBeLessThan(whole / 20);
    // The first (the whole game) and the third go: the second becomes whole, the fourth the changes since the second.
    await dropReports([ids[0], ids[2]], [], store);
    const after = await all(store);
    expect(after.length).toBe(4);
    for (const i of [1, 3, 4, 5]) {
      const r = after.find((x) => x.id === ids[i])!;
      expect(snapshotTextFor(r, after) === texts[i]).toBe(true);
      expect(await storedSnapshotText(ids[i], store) === texts[i]).toBe(true);
    }
    expect(after.find((x) => x.id === ids[1])!.snapBase).toBeUndefined();
    expect(after.find((x) => x.id === ids[3])!.snapBase).toBe(ids[1]);
    // Stripping one keeps its words, and the next is rebuilt from the one before it.
    await dropReports([], [ids[4]], store);
    const s2 = await all(store);
    expect(s2.find((x) => x.id === ids[4])!.size).toBe(0);
    expect(snapshotTextFor(s2.find((x) => x.id === ids[5])!, s2) === texts[5]).toBe(true);
  });

  it('an export of the newest only: a record built on one sent before carries the whole game', async () => {
    const { store, texts, ids } = await file();
    const newest = (await store.get(ids[5]))!;
    expect(newest.snapBase).toBe(ids[4]);
    const ready = await exportReady([newest], store);
    expect(ready[0].snapBase).toBeUndefined();
    expect(snapshotTextFor(ready[0], ready) === texts[5]).toBe(true);
  });
});
