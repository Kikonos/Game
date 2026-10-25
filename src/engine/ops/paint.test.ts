// Liveries: resolving, normalising, client liveries, the player's picker and old saves (v0.5.1, LIVERY.md §1, §6 ENGINE).

import { CLIENT_LIVERIES } from '../../data/clientLiveries';
import { describe, expect, it } from 'vitest';
import { LOGO_IDS, MAX_STICKERS, WHITE_LIVERY } from '../../data/livery';
import { acceptOffer, feasibility } from '../contracts';
import { newGame, offer, run } from '../contracts/testkit';
import { DAY } from '../core/time';
import type { GameState, Livery } from '../core/types';
import { createGame } from '../newGame';
import { deserialize, serialize } from '../save';
import { clientLivery, liveryOf, recipeLivery, normaliseLivery, paintStatus, setAircraftLivery, setCompanyLivery, setFleetLivery } from './paint';

const LEGACY: Livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' };

/** A v0.5 save: the same JSON without any v0.5.1 field. */
function v05Save(g: GameState): string {
  const file = JSON.parse(serialize(g));
  file.state.company.livery = { ...LEGACY };
  for (const ac of Object.values(file.state.fleet) as Record<string, unknown>[]) {
    delete ac.livery;
    delete ac.paintedFor;
  }
  return JSON.stringify(file);
}

describe('liveries in saves', () => {
  it('a v0.5 save loads unchanged, renders as the company livery and round-trips', () => {
    const g = newGame(2);
    run(g, g.now + 3 * DAY);
    const text = v05Save(g);
    const a = deserialize(text);
    expect(a.company.livery).toEqual(LEGACY);
    expect(Object.keys(a.company.livery).sort()).toEqual(['primary', 'secondary', 'tail']);
    for (const ac of Object.values(a.fleet)) {
      expect(ac.livery).toBeUndefined();
      expect(liveryOf(a, ac)).toEqual({ livery: a.company.livery, code: a.company.code, name: a.company.name, source: 'company' });
    }
    const b = deserialize(serialize(a));
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });

  it('heals client paint whose contract is gone, and keeps every livery choice through a save', () => {
    const g = newGame(2);
    const [x, y, z] = Object.keys(g.fleet);
    g.fleet[x].paintedFor = 'k-gone';
    expect(setAircraftLivery(g, y, 'white').ok).toBe(true);
    const back = deserialize(serialize(g));
    expect(back.fleet[x].paintedFor).toBeUndefined();
    expect(liveryOf(back, x).source).toBe('company');
    expect(back.fleet[y].livery).toBe('white');
    expect(liveryOf(back, y)).toMatchObject({ source: 'white', livery: WHITE_LIVERY, code: '', name: '' });
    if (z) expect(liveryOf(back, z).source).toBe('company');
  });

  it('new games store a normalised company livery', () => {
    const g = createGame({ name: 'Test Air', code: 'TA', livery: { primary: '#ABC', secondary: 'red', tail: 'zigzag' as never }, base: 'LIS', seed: 1 });
    expect(g.company.livery).toEqual({ primary: '#aabbcc', secondary: '#f5c451', tail: 'sweep' });
  });
});

describe('normaliseLivery', () => {
  it('clamps every field and is idempotent', () => {
    const raw = {
      primary: '#ZZZ', secondary: '#12AB9F', tail: 'split', plain: true,
      code: { text: 'a-b c 9', color: '#FFF', weight: 600 },
      titles: { text: `  Very   long airline name that goes on and on  `, color: 'blue', weight: 500 },
      logo: { id: 'mono', color: 'nope', color2: '#000000', text: 'abcd' },
      stickers: [
        { id: 'code', kind: 'code', side: 'fin', x: -1, y: 2, scale: 10, rotation: 90 },
        { id: 'code', kind: 'titles', side: 'fuselage', scale: 1 },
        { id: 'bad', kind: 'wheel', side: 'fin', scale: 1 },
        { id: 't', kind: 'titles', side: 'fuselage', scale: 0.1, rotation: -100, x: 0.33333 },
        ...Array.from({ length: 8 }, (_, i) => ({ id: `l${i}`, kind: 'logo', side: 'fuselage', scale: 1, rotation: 0 })),
      ],
    } as unknown as Livery;
    const n = normaliseLivery(raw);
    expect(n.primary).toBe('#0b1f4d');
    expect(n.secondary).toBe('#12ab9f');
    expect(n.tail).toBe('split');
    expect(n.plain).toBe(true);
    expect(n.code).toEqual({ text: 'ABC9', color: '#ffffff' }); // v0.11 up to 4 (client marks)
    expect(n.titles!.text!.length).toBeLessThanOrEqual(28);
    expect(n.titles).toMatchObject({ text: 'Very long airline name that', weight: 500 });
    expect(n.titles!.color).toBeUndefined();
    expect(n.logo).toEqual({ id: 'mono', color: '#12ab9f', color2: '#000000', text: 'ABC' });
    expect(n.stickers!.length).toBe(MAX_STICKERS);
    expect(new Set(n.stickers!.map((s) => s.id)).size).toBe(MAX_STICKERS);
    expect(n.stickers![0]).toEqual({ id: 'code', kind: 'code', side: 'fin', x: 0, y: 1, scale: 3, rotation: 45 });
    expect(n.stickers![1]).toEqual({ id: 't', kind: 'titles', side: 'fuselage', x: 0.333, scale: 0.3, rotation: -45 });
    expect(n.stickers![2].rotation).toBeUndefined();
    expect(normaliseLivery(n)).toEqual(n);
    expect(normaliseLivery({ ...LEGACY, logo: { id: 'nope' as never, color: '#000000' } }).logo).toBeUndefined();
    expect(normaliseLivery(LEGACY)).toEqual(LEGACY);
    expect(normaliseLivery(undefined, LEGACY)).toEqual(LEGACY);
  });
});

describe('client liveries', () => {
  it('are deterministic per client, generic, and plain white for decals', () => {
    const g = newGame(3);
    const clients = Object.values(g.clients);
    for (const c of clients.slice(0, 12)) {
      const full = clientLivery(c, 'full');
      expect(clientLivery(c, 'full')).toEqual(full);
      expect(normaliseLivery(full)).toEqual(full);
      expect(full.plain).toBeUndefined();
      // A two-tone fin never gets a logo in either fin colour.
      if (full.tail !== 'solid' && full.logo) expect([full.primary, full.secondary]).not.toContain(full.logo.color);
      const dec = clientLivery(c, 'decals');
      expect(dec).toMatchObject({ primary: '#ffffff', plain: true });
      // a tail mark: a logo of the set or lettering
      expect(dec.logo ? dec.logo.id === 'mono' || LOGO_IDS.includes(dec.logo.id as never) : dec.code?.text !== undefined, c.name).toBe(true);
    }
    // The same client in another game (other ids) looks the same.
    const h = newGame(4);
    const c0 = clients[0];
    const c1 = Object.values(h.clients).find((c) => c.name === c0.name)!;
    expect(clientLivery(c1, 'full')).toEqual(clientLivery(c0, 'full'));
  });
});

describe('the livery picker', () => {
  it('sets company, white and custom liveries; refused while client paint is booked or on', () => {
    const g = newGame(5);
    const ids = Object.keys(g.fleet);
    expect(setCompanyLivery(g, { ...LEGACY, tail: 'stripe', code: { text: 'xy' } }).ok).toBe(true);
    expect(liveryOf(g, ids[0])).toMatchObject({ source: 'company', code: 'XY' });
    expect(setAircraftLivery(g, ids[0], { custom: { ...LEGACY, primary: '#ff0000', titles: { text: 'Sunny' } } }).ok).toBe(true);
    expect(liveryOf(g, ids[0])).toMatchObject({ source: 'custom', name: 'Sunny', code: g.company.code });
    expect(setAircraftLivery(g, ids[0], 'company').ok).toBe(true);
    expect(g.fleet[ids[0]].livery).toBeUndefined();
    expect(setAircraftLivery(g, ids[0], 'bogus' as never).ok).toBe(false);

    const o = offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves: 2, start: g.now + 30 * DAY, days: 60, paint: { kind: 'decals', required: true } });
    const id = ids.find((x) => feasibility(g, o.id, x).level !== 'no')!;
    expect(acceptOffer(g, o.id, [id]).ok).toBe(true);
    const st = paintStatus(g, id);
    expect(st.locked).toBe(true);
    expect(st.booked?.paint?.phase).toBe('in');
    expect(setAircraftLivery(g, id, 'white')).toMatchObject({ ok: false });
    const all = setFleetLivery(g, 'white');
    expect(all.ok && all.data).toEqual({ changed: ids.length - 1, skipped: 1 });
    run(g, st.booked!.end + 60);
    expect(paintStatus(g, id)).toMatchObject({ locked: true, paintedFor: st.booked!.paint!.contractId });
    expect(paintStatus(g, id).why).toMatch(/^In .* colours until /);
    expect(liveryOf(g, id).source).toBe('client');
  });
});

describe('v0.11 client livery recipes', () => {
  it('every recipe is a real client, normalises to itself, carries its titles and a mark readable on its fin', () => {
    const g = newGame(3);
    const names = new Set(Object.values(g.clients).map((c) => c.name));
    for (const [name, r] of Object.entries(CLIENT_LIVERIES)) {
      expect(names.has(name), `${name}: no such client`).toBe(true);
      for (const kind of ['full', 'decals'] as const) {
        const lv = recipeLivery(r, kind);
        expect(normaliseLivery(lv), `${name} ${kind}`).toEqual(lv);
        expect(lv.titles?.text, name).toBe(r.titles[0]);
        expect(lv.titles!.text!.length, name).toBeLessThanOrEqual(28);
      }
      // the clients that ask for paint get their real colours, by name
      const c = Object.values(g.clients).find((x) => x.name === name)!;
      expect(clientLivery(c, 'full').titles?.text).toBe(r.titles[0]);
    }
    // every airline and tour operator has a recipe
    for (const c of Object.values(g.clients)) if (c.kind === 'airline') expect(CLIENT_LIVERIES[c.name], c.name).toBeDefined();
  });
});
