// v0.12 Visual A: silhouettes per type (engine count and placement, proportions, sizes), the sun and the soft night,
// the spotter's picker and flight profile, and the weather marks.

import { describe, expect, it } from 'vitest';
import { ACMI_TYPES, ACMI_TYPES_LIST } from '../../data/acmiTypes';
import { AIRCRAFT } from '../../data/aircraft';
import { fromUTC } from '../../engine/core/time';
import type { Aircraft, Decision, Flight, GameState, WorldEvent } from '../../engine/core/types';
import { sunElevation, sunPoint } from './mapLogic';
import { buildSilhouette, mapPxPerM, nacelles, SIL_FAMILY, SIL_MAX_M, SIL_MAX_PX, SIL_MIN_M, SIL_MIN_PX, SIL_TYPES, silPx, silSpec, silhouette, wingOutline } from './silhouettes';
import { fillNight, mercLat, nightAlpha } from './sky';
import { CONTRAIL_FT, contrailWindow, flightProfile, nextDeparture, spotList, spotNext } from './spotter';
import { wxMarks } from './weather';

/** Every type in the game → its silhouette family and engine count (the table the player asked for). */
const TABLE: Record<string, [string, 2 | 4]> = {
  a320ceo: ['A320', 2], a320neo: ['A320neo', 2], a321ceo: ['A320', 2], a321neo: ['A320neo', 2],
  b738: ['737', 2], b739: ['737', 2],
  b752: ['757', 2], b753: ['757', 2],
  b763: ['767', 2],
  a332: ['A330', 2], a333: ['A330', 2], a339: ['A330neo', 2],
  a342: ['A340', 4], a343: ['A340', 4], a345: ['A340-500/600', 4], a346: ['A340-500/600', 4],
  b772: ['777', 2], b77w: ['777', 2], b778: ['777X', 2], b779: ['777X', 2],
  b788: ['787', 2], b789: ['787', 2], b78x: ['787', 2],
  a359: ['A350', 2], a35u: ['A350', 2], a35k: ['A350', 2],
  b741: ['747', 4], b742: ['747', 4], b743: ['747', 4], b744: ['747', 4], b748: ['747', 4],
  a388: ['A380', 4],
};

describe('silhouettes', () => {
  it('maps every type in the game to a silhouette with the right number of engines', () => {
    expect(Object.keys(TABLE).sort()).toEqual(ACMI_TYPES_LIST.map((t) => t.id).sort());
    for (const t of ACMI_TYPES_LIST) {
      expect(SIL_TYPES).toContain(t.id);
      const [fam, n] = TABLE[t.id];
      expect(SIL_FAMILY[t.id]).toBe(fam);
      const s = silSpec(t.id);
      expect(s.eng.length * 2).toBe(n);
      expect(s.eng.length * 2).toBe(t.engines);
      expect(silhouette(t.id).engineCount).toBe(n);
      // Length and span are the catalog's (real) ones.
      const cat = AIRCRAFT.find((a) => a.id === (t.catalog ?? t.id))!;
      expect(s.L).toBe(cat.lengthM);
      expect(s.S).toBe(cat.spanM);
    }
  });

  it('hangs the engines under the wings at their real spanwise stations', () => {
    for (const t of ACMI_TYPES_LIST) {
      const s = silSpec(t.id);
      const wing = wingOutline(s);
      const le = (x: number) => s.wingX * s.L + Math.max(0, x - s.fw / 2) * Math.tan((s.sweep * Math.PI) / 180);
      for (const n of nacelles(s)) {
        // Outside the fuselage, inside the span, the intake ahead of the leading edge, the exhaust behind it.
        expect(n.x - n.w / 2).toBeGreaterThan(s.fw / 2);
        expect(n.x).toBeLessThan(s.S / 2 * 0.75);
        expect(n.y).toBeLessThan(le(n.x));
        expect(n.y + n.l).toBeGreaterThan(le(n.x));
      }
      // The wing reaches the tip.
      expect(Math.max(...wing.map((p) => p[0]))).toBeCloseTo(s.S / 2, 5);
    }
    // Twins: one engine a side at about a third of the half span (737 closer in); quads: inner ~0.3–0.4, outer ~0.6–0.7.
    expect(silSpec('b738').eng[0]).toBeLessThan(silSpec('a320ceo').eng[0]);
    for (const id of ['b741', 'b744', 'b748', 'a343', 'a346', 'a388']) {
      const [i, o] = silSpec(id).eng;
      expect(i).toBeGreaterThanOrEqual(0.29);
      expect(i).toBeLessThanOrEqual(0.41);
      expect(o).toBeGreaterThanOrEqual(0.58);
      expect(o).toBeLessThanOrEqual(0.71);
    }
  });

  it('tells the 757, 767 and 777 apart by their proportions', () => {
    const [b757, b767, b777] = ['b752', 'b763', 'b772'].map(silSpec);
    // Fuselage widths grow, the long thin 757 the most slender (length over span).
    expect(b757.fw).toBeLessThan(b767.fw);
    expect(b767.fw).toBeLessThan(b777.fw);
    expect(b757.L / b757.S).toBeGreaterThan(b767.L / b767.S);
    expect(b767.L / b767.S).toBeGreaterThan(b777.L / b777.S);
    expect(b757.nd).toBeLessThan(b767.nd);
    expect(b767.nd).toBeLessThan(b777.nd);
  });

  it("shows the 747's hump and the A380's double deck from above, and their wing sweep", () => {
    expect(silSpec('b744').deck).toBeGreaterThan(0.25);
    expect(silSpec('b744').deck).toBeLessThan(0.5);
    expect(silSpec('a388').deck).toBeGreaterThan(0.9);
    expect(silhouette('b744').deck).not.toBe('');
    expect(silhouette('a388').deck).not.toBe('');
    expect(silhouette('b772').deck).toBe('');
    // The A380 is the widest fuselage; the 747 the most swept wing.
    for (const t of ACMI_TYPES_LIST) {
      if (t.id !== 'a388') expect(silSpec(t.id).fw).toBeLessThan(silSpec('a388').fw);
      if (t.family !== 'B747') expect(silSpec(t.id).sweep).toBeLessThan(silSpec('b744').sweep);
    }
  });

  it('v0.14 draws every type to one scale: size proportional to the real aircraft', () => {
    const px = (id: string) => silPx(silSpec(id));
    // A320 35.8 m span vs A330 60.3 m vs 747 64.4 m span, 70.6 m long: the icons keep those ratios exactly.
    const span = (id: string) => silSpec(id).S;
    const len = (id: string) => silSpec(id).L;
    expect(px('a332') / px('a320ceo')).toBeCloseTo(Math.max(len('a332'), span('a332')) / Math.max(len('a320ceo'), span('a320ceo')), 5);
    expect(silhouette('a332').hs / silhouette('a320ceo').hs).toBeCloseTo(span('a332') / span('a320ceo'), 5);
    expect(silhouette('b744').hl / silhouette('a320ceo').hl).toBeCloseTo(len('b744') / len('a320ceo'), 5);
    expect(silhouette('b744').hl / silhouette('a320ceo').hl).toBeGreaterThan(1.8);
    expect(px('a320ceo')).toBeLessThan(px('b752'));
    expect(px('b763')).toBeLessThan(px('b772'));
    expect(px('a388')).toBeGreaterThan(px('b77w'));
  });

  it('v0.14 grows the one scale gently with the zoom, clamped for the whole set together', () => {
    let last = 0;
    for (const k of [0.5, 1, 2, 4, 8, 16]) {
      const m = mapPxPerM(k);
      expect(m).toBeGreaterThanOrEqual(last);
      last = m;
      // smallest type tappable, largest never swamping the map: at every zoom
      expect(SIL_MIN_M * m).toBeGreaterThanOrEqual(SIL_MIN_PX - 1e-9);
      expect(SIL_MAX_M * m).toBeLessThanOrEqual(SIL_MAX_PX + 1e-9);
    }
    expect(SIL_MIN_M * mapPxPerM(1)).toBeCloseTo(SIL_MIN_PX, 5);
    expect(SIL_MAX_M * mapPxPerM(16)).toBeCloseTo(SIL_MAX_PX, 5);
    // a European view (k ≈ 4): an A320 about 23 px, an A380 about twice that
    expect(37.6 * mapPxPerM(4)).toBeGreaterThan(21);
    expect(37.6 * mapPxPerM(4)).toBeLessThan(26);
  });

  it('builds closed paths at any size', () => {
    for (const id of SIL_TYPES) {
      const s = buildSilhouette(silSpec(id), 3);
      expect(s.body).toMatch(/^M.*Z$/);
      expect((s.engines.match(/M/g) ?? []).length).toBe(s.engineCount);
      expect(s.trails).not.toMatch(/NaN/);
      expect(s.body).not.toMatch(/NaN/);
    }
    // Unknown types fall back to an A320 (never undrawn).
    expect(silSpec('zz9').L).toBe(silSpec('a320ceo').L);
  });
});

describe('sun and the soft night', () => {
  it('puts the subsolar point at equinoxes and solstices where the almanac does', () => {
    // March equinox 2027 (20 Mar 14:25 UTC): on the equator, solar noon at Greenwich 12:07 → 34.4°W.
    const mar = sunPoint(fromUTC(2027, 3, 20, 14, 25));
    expect(Math.abs(mar[1])).toBeLessThan(0.15);
    expect(mar[0]).toBeCloseTo(-34.4, 0);
    // September equinox 2027 (23 Sep 06:02 UTC): on the equator, solar noon 11:52 → 87.6°E.
    const sep = sunPoint(fromUTC(2027, 9, 23, 6, 2));
    expect(Math.abs(sep[1])).toBeLessThan(0.05);
    expect(sep[0]).toBeCloseTo(87.6, 0);
    // Solstices at noon UTC: ±23.44° (tropics), within half a degree of Greenwich.
    const jun = sunPoint(fromUTC(2027, 6, 21, 12, 0));
    const dec = sunPoint(fromUTC(2027, 12, 22, 12, 0));
    expect(jun[1]).toBeCloseTo(23.44, 1);
    expect(dec[1]).toBeCloseTo(-23.44, 1);
    expect(Math.abs(jun[0])).toBeLessThan(0.6);
    expect(Math.abs(dec[0])).toBeLessThan(0.6);
  });

  it('shades with a twilight band, not a hard edge', () => {
    expect(nightAlpha(10)).toBe(0);
    expect(nightAlpha(1)).toBe(0);
    expect(nightAlpha(-14)).toBe(1);
    expect(nightAlpha(-40)).toBe(1);
    // Civil twilight is half-shaded; the sunset line itself barely.
    expect(nightAlpha(0)).toBeLessThan(0.05);
    expect(nightAlpha(-6)).toBeGreaterThan(0.3);
    expect(nightAlpha(-6)).toBeLessThan(0.7);
    for (let e = 5; e > -20; e -= 0.5) expect(nightAlpha(e - 0.5)).toBeGreaterThanOrEqual(nightAlpha(e));
  });

  it('paints the night raster dark on the far side, clear under the sun, with a band between', () => {
    const w = 360;
    const h = 1;
    const out = new Uint8ClampedArray(w * h * 4);
    // The equator at an equinox: the sun over 0°, night from about ±90° outwards.
    fillNight(out, w, h, 0, () => 0, [0, 0, 0], 1);
    const a = (lon: number) => out[Math.floor(((lon + 180) / 360) * w) * 4 + 3];
    expect(a(0)).toBe(0);
    expect(a(60)).toBe(0);
    expect(a(179)).toBe(255);
    expect(a(-179)).toBe(255);
    // Some columns in between: a soft band on each side, more than ten columns wide.
    let part = 0;
    for (let i = 0; i < w; i++) if (out[i * 4 + 3] > 5 && out[i * 4 + 3] < 250) part++;
    expect(part).toBeGreaterThan(20);
    // June: the north pole lit all day, the south dark (polar night).
    const one = new Uint8ClampedArray(4);
    fillNight(one, 1, 1, 23.44, () => 85, [0, 0, 0], 1);
    expect(one[3]).toBe(0);
    fillNight(one, 1, 1, 23.44, () => -85, [0, 0, 0], 1);
    expect(one[3]).toBe(255);
    // Inverse Mercator matches the game's projection (equator at y 774, the map's top edge about 80°N).
    expect(mercLat(774, 2000)).toBeCloseTo(0, 6);
    expect(mercLat(0, 2000)).toBeCloseTo(79.95, 1);
    expect(mercLat(1193, 2000)).toBeLessThan(-55);
  });

  it('agrees with the elevation helper', () => {
    const sun = sunPoint(fromUTC(2027, 3, 20, 18, 0));
    expect(nightAlpha(sunElevation(sun, sun[0], sun[1]))).toBe(0);
    expect(nightAlpha(sunElevation(sun, sun[0] + 180, -sun[1]))).toBe(1);
  });
});

// ---------- spotter ----------

const T0 = fromUTC(2027, 5, 10, 12, 0);

function flight(id: string, ac: string, from: string, to: string, off: number, on: number, status: Flight['status'] = 'enroute', extra: Partial<Flight> = {}): Flight {
  return { id, no: `AWL${id}`, aircraftId: ac, kind: 'revenue', from, to, std: off, sta: on, block: on - off, delay: 0, status, atd: status === 'scheduled' ? undefined : off, eta: on, ...extra } as unknown as Flight;
}

function aircraft(id: string, reg: string, typeId: string, flightId: string | null, at = 'LIS'): Aircraft {
  return { id, reg, typeId, flightId, at, status: 'available' } as unknown as Aircraft;
}

function game(acs: Aircraft[], fls: Flight[], extra: Partial<GameState> = {}): GameState {
  return { seed: 7, now: T0, fleet: Object.fromEntries(acs.map((a) => [a.id, a])), flights: Object.fromEntries(fls.map((f) => [f.id, f])), decisions: [], ...extra } as unknown as GameState;
}

describe('spotter', () => {
  const fls = [flight('1', 'a1', 'LIS', 'JFK', T0 - 60, T0 + 400), flight('2', 'a2', 'LIS', 'FAO', T0 - 10, T0 + 40), flight('3', 'a3', 'LIS', 'MAD', T0 - 20, T0 + 60), flight('4', 'a5', 'LIS', 'OPO', T0 + 90, T0 + 140, 'scheduled')];
  const acs = [aircraft('a1', 'CS-TBC', 'b772', '1'), aircraft('a2', 'CS-TBA', 'a320ceo', '2'), aircraft('a3', 'CS-TBB', 'b738', '3'), aircraft('a4', 'CS-TAA', 'a332', null), aircraft('a5', 'CS-TAB', 'a321ceo', null)];

  it('goes round every airborne aircraft by registration, skipping none and none twice', () => {
    const g = game(acs, fls);
    expect(spotList(g).map((a) => a.reg)).toEqual(['CS-TBA', 'CS-TBB', 'CS-TBC']);
    const seen: string[] = [];
    let id = spotNext(g, null);
    for (let i = 0; i < 6; i++) { seen.push(id!); id = spotNext(g, id); }
    expect(seen).toEqual(['a2', 'a3', 'a1', 'a2', 'a3', 'a1']);
    // Deterministic: the same game gives the same answer every time.
    expect(spotNext(g, 'a3')).toBe(spotNext(g, 'a3'));
  });

  it('carries on after one that landed, from where it was in the round', () => {
    const landed = [...fls];
    landed[2] = { ...fls[2], status: 'done' } as Flight; // CS-TBB is down
    const g = game(acs.map((a) => (a.id === 'a3' ? { ...a, flightId: null } : a)), landed);
    expect(spotNext(g, 'a3')).toBe('a1');
    expect(spotNext(g, 'a2')).toBe('a1');
    expect(spotNext(g, 'a1')).toBe('a2');
  });

  it('shows the next departure when nothing is airborne', () => {
    const g = game(acs.map((a) => ({ ...a, flightId: null })), fls.map((f) => ({ ...f, status: f.id === '4' ? 'scheduled' : 'done' }) as Flight));
    expect(spotNext(g, 'a1')).toBeNull();
    const nx = nextDeparture(g, T0);
    expect(nx?.flight.id).toBe('4');
    expect(nx?.ac.reg).toBe('CS-TAB');
  });

  it('flies a believable profile: taxi, climb, cruise on the semicircular rule, descent', () => {
    // LIS→JFK in a 777-200ER: 7 h 40 off-blocks to on-blocks, westbound.
    const off = T0;
    const f = flight('9', 'a1', 'LIS', 'JFK', off, off + 460);
    const at = (m: number) => flightProfile(f, 'b772', off + m);
    expect(at(2).phase).toBe('taxiOut');
    expect(at(2).altFt).toBe(0);
    const climb = [16, 20, 25, 30].map((m) => at(m).altFt);
    for (let i = 1; i < climb.length; i++) expect(climb[i]).toBeGreaterThan(climb[i - 1]);
    const cr = at(200);
    expect(cr.phase).toBe('cruise');
    // Westbound: an even level (FL340 for the 777), stepping up 2,000 ft later on.
    expect((cr.fl / 10) % 2).toBe(0);
    expect(cr.altFt).toBeGreaterThanOrEqual(cr.fl * 100);
    expect(at(400).altFt).toBeGreaterThan(at(100).altFt);
    // Ground speed near the type's cruise speed, slower westbound (jet stream).
    expect(cr.gsKt).toBeLessThan(ACMI_TYPES.b772.cruiseKt);
    expect(cr.gsKt).toBeGreaterThan(ACMI_TYPES.b772.cruiseKt * 0.85);
    const desc = [430, 436, 442].map((m) => at(m).altFt);
    expect(desc[1]).toBeLessThan(desc[0]);
    expect(desc[2]).toBeLessThan(desc[1]);
    expect(at(458).phase).toBe('taxiIn');
    // Eastbound back: an odd level.
    const back = flight('10', 'a1', 'JFK', 'LIS', off, off + 420);
    expect((flightProfile(back, 'b772', off + 200).fl / 10) % 2).toBe(1);
    // Short hops cruise low: Lisbon–Porto in the high twenties, Lisbon–Faro under 20,000 ft.
    expect(flightProfile(flight('12', 'a2', 'LIS', 'OPO', off, off + 55), 'a320ceo', off + 25).altFt).toBeLessThan(30_000);
    const hop = flight('11', 'a2', 'LIS', 'FAO', off, off + 40);
    expect(flightProfile(hop, 'a320ceo', off + 20).altFt).toBeLessThan(20_000);
    // Contrails from climbing through 26,000 ft to the descent through it; none on the hop.
    const w = contrailWindow(f, 'b772')!;
    expect(w[0]).toBeGreaterThan(off);
    expect(w[1]).toBeLessThan(off + 460);
    expect(flightProfile(f, 'b772', w[0] + 0.5).altFt).toBeGreaterThanOrEqual(CONTRAIL_FT - 200);
    expect(flightProfile(f, 'b772', w[1] - 0.5).altFt).toBeGreaterThanOrEqual(CONTRAIL_FT - 200);
    expect(contrailWindow(hop, 'a320ceo')).toBeNull();
  });
});

// ---------- weather ----------

describe('weather marks', () => {
  const ac = aircraft('a1', 'CS-TBC', 'a320ceo', '1');
  it('marks a destination closed by weather while the card is open, then while the weather lasts, then clears', () => {
    const f = flight('1', 'a1', 'LIS', 'CAG', T0 - 60, T0 + 60);
    const d = { id: 'd1', kind: 'diversion', data: { flightId: '1', cause: 'weather', what: 'Fog below landing minimums' }, options: [] } as unknown as Decision;
    const g = game([ac], [f], { decisions: [d] });
    expect(wxMarks(g)).toEqual([{ at: 'CAG', kind: 'cloud', title: 'Fog below landing minimums', tap: { decision: 'd1' } }]);
    // Diverted to Olbia: Cagliari stays marked until a while after it is down there; tapping shows the aircraft.
    const div = { ...f, to: 'OLB', eta: T0 + 30, div: { to0: 'CAG', at: T0, eta0: T0 + 60, cause: 'weather' } } as Flight;
    const g2 = game([ac], [div]);
    const m = wxMarks(g2);
    expect(m.map((x) => x.at)).toEqual(['CAG']);
    expect(m[0].tap).toEqual({ sel: { kind: 'aircraft', id: 'a1' } });
    expect(wxMarks(g2, T0 + 30 + 200)).toEqual([]);
  });

  it('marks an airport a world event closes, until it reopens', () => {
    const e = { id: 'e1', kind: 'disaster', tpl: 'windMadeira', title: 'Storm winds close Madeira', at: 'FNC', start: T0 - 60, end: T0 + 3000, airportClosedUntil: T0 + 1440, offerIds: [], flightsHit: 0 } as unknown as WorldEvent;
    const g = game([], [], { world: { events: [e] } } as Partial<GameState>);
    expect(wxMarks(g)).toEqual([{ at: 'FNC', kind: 'storm', title: 'Storm winds close Madeira', tap: { sel: { kind: 'event', id: 'e1' } } }]);
    expect(wxMarks({ ...g, now: T0 + 1500 } as GameState)).toEqual([]);
  });
});

describe('v0.12 family colours', () => {
  it('every type has its family colour; families never share a colour; variants keep their family', async () => {
    const { SIL_COLOURS, SIL_TYPES, silColour, silColourFamily } = await import('./silhouettes');
    expect(new Set(SIL_COLOURS.map((c) => c.colour)).size).toBe(SIL_COLOURS.length);
    const fams = new Set(SIL_COLOURS.map((c) => c.family));
    for (const t of SIL_TYPES) expect(fams.has(silColourFamily(t)), t).toBe(true);
    expect(silColour('a321neo')).toBe(silColour('a320ceo'));
    expect(silColour('b779')).toBe(silColour('b77w'));
    expect(silColour('a346')).toBe(silColour('a343'));
    expect(silColour('b744')).not.toBe(silColour('a388'));
  });
});
