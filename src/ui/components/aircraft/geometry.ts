// Turns an AircraftProfile (metres) into SVG path strings. Pure and cached per
// profile, so the React component only assembles elements and colours.

import type { TailStyle } from '../../../engine/types';
import { COCKPIT } from './cockpit';
import { Box, D, add, chainPts, lerp, lerpV, rad, sampleChain, splitTail, yAt, type V } from './path';
import type { AircraftProfile, EngineSpec, EngineStyle, FairingSpec, TipDevice, WingSpec } from './types';

export interface EngineGeo {
  spec: EngineSpec;
  pylon: string;
  cowl: string;
  /** Livery band on the fan cowl. */
  accent: string;
  /** Intake lip (metallic). */
  lip: string;
  /** Dark slivers: fan face, fan nozzle, turboprop intakes. */
  dark: string;
  core: string;
  plug: string;
  /** Fan-cowl / thrust-reverser seam (fine line). */
  seam: string;
  prop?: { disc: string; blades: string; spinner: string };
}

export interface LiveryGeo {
  /** Primary-colour area on the fuselage (clip to the fuselage). */
  fus: string;
  /** Second-colour area on the fuselage. */
  fus2: string;
  /** Second-colour area on the fin (clip to the fin). */
  fin: string;
  /** Fin-code anchor (centre), maximum letter size and width. */
  code: { x: number; y: number; size: number; w: number };
}

export interface Geometry {
  p: AircraftProfile;
  L: number;
  H: number;
  upperY: (x: number) => number;
  lowerY: (x: number) => number;
  /** Closed fuselage outline including belly fairing and sponsons. */
  fus: string;
  /** Highest crown point (m) — top of the shading gradient. */
  crown: number;
  /** Lowest belly point (m) — bottom of the shading gradient. */
  belly: number;
  /** Crown fairing under a high wing. */
  wingRoot: string;
  fin: { fill: string; edge: string; lines: string; quad: readonly [V, V, V, V]; top: number };
  stab: { near: string; far: string; lines: string; bullet: string; tTail: boolean; none: boolean };
  /** `shade`: darker underside of a sectioned (side-on aerofoil) wing. */
  wing: { fill: string; tip: string; lines: string; shade?: string; shadow: { c: V; rx: number; ry: number } };
  engines: EngineGeo[];
  gear: { struts: string; tyres: string; hubs: string; fromNacelle: boolean };
  windows: string;
  doors: string;
  /** Radome joint, fairing seam and similar fine lines on the fuselage. */
  lines: string;
  apu: string;
  cockpit: { panes: string; mask: string; round: number };
  titles: { x: number; y: number; w: number; size: number };
  livery: (style: TailStyle) => LiveryGeo;
  box: Box;
  boxGear: Box;
}

/** Map fin-normalised (s along chord, t root->tip) to world coordinates. */
export function finAt(q: readonly [V, V, V, V], s: number, t: number): V {
  return lerpV(lerpV(q[0], q[1], s), lerpV(q[2], q[3], s), t);
}

const cache = new Map<AircraftProfile, Geometry>();

export function geometry(p: AircraftProfile): Geometry {
  let g = cache.get(p);
  if (!g) {
    g = build(p);
    cache.set(p, g);
  }
  return g;
}

function build(p: AircraftProfile): Geometry {
  const H = p.height;
  const L = p.length;
  const box = new Box();

  // ---------- fuselage outline ----------
  const nm = (u: number, v: number): V => [u * H, v * H];
  const tm = (u: number, v: number): V => [L + u * H, v * H];
  const nu = chainPts(p.nose.upper, nm);
  const nl = chainPts(p.nose.lower, nm);
  const tu = chainPts(p.tail.upper, tm);
  const tl = chainPts(p.tail.lower, tm);
  const fus = new D().chain(nu, true);
  const up: V[] = sampleChain(nu);
  const crownTop = nu[nu.length - 1][1];
  if (p.hump) {
    const a: V = [p.hump.x1, crownTop];
    const b: V = [p.hump.x1 + p.hump.fair, H / 2];
    const c1: V = [a[0] + p.hump.fair * 0.55, crownTop];
    const c2: V = [b[0] - p.hump.fair * 0.45, H / 2];
    fus.L(a).C(c1, c2, b);
    up.push(...sampleChain([a, c1, c2, b]));
  }
  fus.L(tu[0]).chain(tu).L(tl[tl.length - 1]).chain([...tl].reverse());
  up.push(...sampleChain(tu));
  const low: V[] = [...sampleChain(nl), ...sampleChain(tl)];
  const upperY = (x: number) => yAt(up, x);
  const lowerY = (x: number) => yAt(low, x);

  // belly from the tail-cone start forward to the nose, with fairing bulges
  const xBellyAft = tl[0][0], xBellyFwd = nl[nl.length - 1][0];
  const bulges = [p.fairing, p.sponson].filter((f): f is FairingSpec => !!f).sort((a, b) => b.x0 - a.x0);
  const hb = -H / 2;
  let bellyMin = hb;
  const lines = new D();
  for (const f of bulges) {
    const x0 = Math.max(f.x0, xBellyFwd + 0.1), x1 = Math.min(f.x1, xBellyAft - 0.1);
    const w = x1 - x0, yb = hb - f.depth;
    fus.L([x1, hb])
      .C([x1 - w * 0.1, hb], [x1 - w * 0.14, yb], [x0 + w * 0.7, yb])
      .C([x0 + w * 0.55, yb], [x0 + w * 0.5, yb], [x0 + w * 0.34, yb])
      .C([x0 + w * 0.16, yb], [x0 + w * 0.12, hb], [x0, hb]);
    bellyMin = Math.min(bellyMin, yb);
    // seam where the fairing meets the fuselage side (a pod outline when `rise` is given)
    if (f.rise) lines.M([x0 + w * 0.015, hb - f.depth * 0.35]).C([x0 + w * 0.06, hb + f.rise], [x1 - w * 0.4, hb + f.rise * 1.04], [x1 - w * 0.02, hb - f.depth * 0.3]);
    else lines.M([x0 + w * 0.08, hb - f.depth * 0.08]).C([x0 + w * 0.3, hb + H * 0.035], [x1 - w * 0.3, hb + H * 0.035], [x1 - w * 0.05, hb - f.depth * 0.08]);
  }
  fus.L(nl[nl.length - 1]).chain([...nl].reverse()).Z();
  const fairingBottom = (x: number): number => {
    for (const f of bulges) if (x > f.x0 && x < f.x1) return hb - f.depth;
    return lowerY(x);
  };
  const crown = Math.max(...up.map((v) => v[1]));
  const belly = Math.min(bellyMin, ...low.map((v) => v[1]));
  box.add(...up, ...low, [0, belly]);

  // ---------- vertical fin ----------
  const fn = p.fin;
  const top = H / 2 + fn.height;
  const rootLE: V = [fn.x, upperY(fn.x)];
  const tipLE: V = [fn.x + fn.height * Math.tan(rad(fn.sweep)), top];
  const tipTE: V = [tipLE[0] + fn.tipChord, top];
  const teX = Math.min(fn.x + fn.rootChord, L - 0.05);
  const rootTE: V = [teX, upperY(teX)];
  const dir: V = [tipLE[0] - rootLE[0], tipLE[1] - rootLE[1]];
  const dl = Math.hypot(dir[0], dir[1]);
  const nrm: V = [-dir[1] / dl, dir[0] / dl];
  const bow = (fn.bow ?? 0) * fn.rootChord;
  const lc1 = add(lerpV(rootLE, tipLE, 0.3), [nrm[0] * bow, nrm[1] * bow]);
  const lc2 = add(lerpV(rootLE, tipLE, 0.72), [nrm[0] * bow * 0.5, nrm[1] * bow * 0.5]);
  const edge = new D();
  let finStart: V = rootLE;
  if (fn.fillet) {
    const t = Math.min(0.6, fn.fillet.h / (top - rootLE[1]));
    const [pf, d1, d2] = splitTail(rootLE, lc1, lc2, tipLE, t);
    const f0: V = [fn.x - fn.fillet.len, upperY(fn.x - fn.fillet.len)];
    const tan: V = [d1[0] - pf[0], d1[1] - pf[1]];
    const tl2 = Math.hypot(tan[0], tan[1]) || 1;
    if (fn.fillet.knee) {
      // straight ramp, then a tight round into the leading edge
      const [pk, e1, e2] = splitTail(rootLE, lc1, lc2, tipLE, Math.min(0.75, t + 0.06));
      edge.M(f0).L(lerpV(f0, pf, 0.88)).Q(pf, pk).C(e1, e2, tipLE);
    } else {
      const k = Math.min(fn.fillet.h, fn.fillet.len) * 0.6;
      edge.M(f0).C([f0[0] + fn.fillet.len * 0.6, f0[1]], [pf[0] - (tan[0] / tl2) * k, pf[1] - (tan[1] / tl2) * k], pf).C(d1, d2, tipLE);
    }
    finStart = f0;
  } else {
    edge.M(rootLE).C(lc1, lc2, tipLE);
  }
  const tipKind = fn.tip ?? 'square';
  const tc = fn.tipChord;
  let teTop: V = tipTE;
  if (tipKind === 'round') {
    teTop = [tipTE[0] - tc * 0.08, top];
    edge.C([tipLE[0] + tc * 0.1, top + tc * 0.1], [tipTE[0] - tc * 0.35, top + tc * 0.08], teTop);
  } else if (tipKind === 'raked') {
    teTop = [tipTE[0], top - tc * 0.16];
    edge.L(teTop);
  } else {
    edge.L(tipTE);
  }
  edge.L(rootTE);
  // fill follows the crown back to the start, dipping inside it so the fuselage outline is covered
  const dip = Math.max(0.1, H * 0.05);
  const finFill = new D();
  finFill.s = edge.s;
  for (let i = 0; i <= 12; i++) {
    const x = lerp(rootTE[0], finStart[0], i / 12);
    const k = x > rootLE[0] ? 1 : Math.max(0, (x - finStart[0]) / Math.max(0.01, rootLE[0] - finStart[0]));
    finFill.L([x, upperY(x) - dip * k]);
  }
  finFill.L(finStart).Z();
  box.add(tipLE, tipTE, [tipTE[0], top + tc * 0.1]);
  const quad = [[fn.x, H / 2], [fn.x + fn.rootChord, H / 2], tipLE, tipTE] as const;
  const finLines = new D();
  if (fn.rudder) {
    const rr = fn.rudder;
    const hx0 = rootTE[0] - fn.rootChord * rr;
    finLines.M([hx0, upperY(hx0) + H * 0.06]).L([teTop[0] - tc * rr, top - tc * 0.08]);
  }

  // ---------- horizontal stabiliser ----------
  const sb = p.stab;
  const stabNear = new D(), stabFar = new D(), stabLines = new D(), bullet = new D();
  if (!sb.none) {
    const th = sb.thickness ?? sb.rootChord * 0.11;
    const sy = sb.tTail ? top - th * 0.2 : sb.y;
    const rise = sb.span * Math.sin(rad(sb.dihedral));
    const r0: V = [sb.x, sy];
    const t0: V = [sb.x + sb.span * Math.tan(rad(sb.sweep)), sy + rise];
    const t1: V = [t0[0] + sb.tipChord, t0[1]];
    const r1: V = [sb.x + sb.rootChord, sy];
    const shape = (d: D, o: V) => {
      const P = (v: V): V => [v[0] + o[0], v[1] + o[1]];
      d.M(P([r0[0] + th * 0.9, sy + th * 0.5]))
        .L(P([t0[0] + sb.tipChord * 0.12, t0[1] + th * 0.22]))
        .C(P([t1[0] - sb.tipChord * 0.3, t1[1] + th * 0.24]), P([t1[0], t1[1] + th * 0.1]), P(t1))
        .L(P([r1[0], sy - th * 0.08]))
        .L(P([r0[0] + th * 0.9, sy - th * 0.5]))
        .C(P([r0[0] + th * 0.1, sy - th * 0.48]), P([r0[0] - th * 0.12, sy + th * 0.1]), P([r0[0] + th * 0.9, sy + th * 0.5]))
        .Z();
    };
    shape(stabNear, [0, 0]);
    shape(stabFar, [-th * 0.5, Math.max(th * 0.7, rise * 0.28)]);
    stabLines.M([r1[0] - sb.rootChord * 0.28, sy - th * 0.08]).L([t1[0] - sb.tipChord * 0.32, t1[1] + th * 0.12]);
    box.add([r0[0] - th * 0.6, sy], t0, t1, [t1[0], t1[1] + th]);
    if (sb.tTail) {
      // bullet fairing where the T-tail meets the fin
      const bx = Math.min(sb.x, tipLE[0]) - tc * 0.12, bl = Math.max(tc, sb.rootChord) * 1.15 + Math.abs(sb.x - tipLE[0]), br = th * 0.85;
      bullet.M([bx, sy]).C([bx, sy + br], [bx + bl * 0.2, sy + br], [bx + bl * 0.42, sy + br]).L([bx + bl, sy + br * 0.55]).L([bx + bl, sy - br * 0.55]).L([bx + bl * 0.42, sy - br]).C([bx + bl * 0.2, sy - br], [bx, sy - br], [bx, sy]).Z();
      box.add([bx, sy + br], [bx + bl, sy]);
    }
  }

  // ---------- wing ----------
  const w = p.wing;
  const wingG = wingGeometry(w, box);
  const wrc = w.rootChord;
  const wth = w.thickness ?? wrc * 0.11;
  const shadow = w.high
    ? { c: [w.x + wrc * 0.5, H / 2 - H * 0.08] as V, rx: wrc * 0.9, ry: H * 0.2 }
    : { c: [w.x + wrc * 0.5, w.y - wth * 0.2] as V, rx: wrc * 0.85, ry: H * 0.24 };

  // ---------- high-wing crown fairing ----------
  const wr = new D();
  if (w.high && w.section) {
    // long low fairing on the crown that ramps up into the aerofoil's lower surface
    const x0 = w.x - wrc * 0.55, x1 = w.x + wrc * 1.75;
    const yl = w.y - wth * 0.12;
    wr.M([x0, upperY(x0) - 0.06]).C([x0 + wrc * 0.3, upperY(x0) + 0.03], [w.x - wrc * 0.12, yl], [w.x + wrc * 0.2, yl]).L([w.x + wrc * 0.9, yl]).C([w.x + wrc * 1.15, yl], [x1 - wrc * 0.35, upperY(x1) + 0.03], [x1, upperY(x1) - 0.06]).Z();
    box.add([w.x, yl]);
  } else if (w.high) {
    const x0 = w.x - wrc * 0.45, x1 = w.x + wrc * 1.5;
    const yb = w.y + wth * 0.15;
    wr.M([x0, upperY(x0) - 0.06]).C([x0 + wrc * 0.3, upperY(x0) + 0.02], [w.x - wrc * 0.1, yb], [w.x + wrc * 0.25, yb]).L([w.x + wrc * 0.85, yb]).C([x1 - wrc * 0.25, yb], [x1 - wrc * 0.15, upperY(x1) + 0.02], [x1, upperY(x1) - 0.06]).Z();
    box.add([w.x, yb]);
  }

  // ---------- engines ----------
  const engines = p.engines.map((e) => engineGeometry(e, w, box, upperY));

  // ---------- landing gear ----------
  const boxGear = box.clone();
  const struts = new D(), tyres = new D(), hubs = new D();
  const ground = -p.gear.stance;
  const leg = (x: number, wheels: number, tyre: number, topY: number) => {
    const n = wheels <= 2 ? 1 : wheels / 2;
    const r = tyre / 2;
    const ay = ground + r;
    const sp = tyre * 1.04;
    const sw = Math.max(0.16, tyre * 0.24);
    struts.rrect(x - sw / 2, ay, sw, Math.max(0.1, topY - ay), sw * 0.3);
    // oleo collar
    struts.rrect(x - sw * 0.75, ay + (topY - ay) * 0.42, sw * 1.5, Math.max(0.06, sw * 0.5), sw * 0.2);
    if (n > 1) struts.rrect(x - ((n - 1) / 2) * sp - r * 0.25, ay - sw * 0.32, (n - 1) * sp + r * 0.5, sw * 0.64, sw * 0.3);
    for (let i = 0; i < n; i++) {
      const cx = x + (i - (n - 1) / 2) * sp;
      tyres.ellipse([cx, ay], r, r);
      hubs.ellipse([cx, ay], r * 0.48, r * 0.48);
      boxGear.add([cx - r, ground], [cx + r, ground]);
    }
  };
  const g = p.gear;
  leg(g.nose.x, g.nose.wheels, g.nose.tyre, lowerY(g.nose.x) + 0.2);
  const nacelleBottom = (x: number): number | undefined => {
    for (const e of p.engines) if (e.mount === 'turboprop' && !e.far && x > e.x && x < e.x + (e.tailLen ?? e.len)) return e.y - e.dia * 0.42;
    return undefined;
  };
  for (const m of g.main) {
    const topY = g.from === 'nacelle' ? (nacelleBottom(m.x) ?? fairingBottom(m.x) + 0.3) : fairingBottom(m.x) + Math.min(0.4, H * 0.1);
    leg(m.x, m.wheels, m.tyre, topY);
  }

  // ---------- doors & windows ----------
  const doorBox = p.doors.map((d) => {
    const kind = d.kind ?? 'pax';
    const big = H > 5;
    const dw = d.w ?? (kind === 'exit' ? 0.55 : kind === 'cargo' ? 1.8 : big ? 1.07 : 0.82);
    const dh = d.h ?? (kind === 'exit' ? 0.95 : kind === 'cargo' ? 1.25 : big ? 1.93 : 1.85);
    const row = nearestRow(p, d.y);
    const dy = d.y ?? (kind === 'cargo' ? -H / 2 + H * 0.1 : kind === 'exit' ? row.y - 0.5 : row.y - dh * 0.55);
    return { x: d.x, y: dy, w: dw, h: dh, kind };
  });
  const doors = new D();
  for (const d of doorBox) doors.rrect(d.x, d.y, d.w, d.h, Math.min(d.w, d.h) * 0.2);
  const win = new D();
  for (const row of p.windows) {
    for (let x = row.x0; x <= row.x1 + 1e-6; x += row.pitch) {
      const hit = doorBox.some((d) => d.kind !== 'cargo' && x + row.w / 2 > d.x - 0.12 && x - row.w / 2 < d.x + d.w + 0.12 && row.y > d.y && row.y < d.y + d.h + 0.3);
      if (hit || row.gaps?.some(([a, b]) => x >= a && x <= b)) continue;
      win.rrect(x - row.w / 2, row.y - row.h / 2, row.w, row.h, row.w * 0.45);
    }
  }
  if (p.nose.radome) {
    const rx = p.nose.radome * H;
    const yt = upperY(rx), yb = lowerY(rx);
    lines.M([rx - H * 0.02, yt - H * 0.01]).C([rx + H * 0.05, lerp(yt, yb, 0.3)], [rx + H * 0.05, lerp(yt, yb, 0.7)], [rx - H * 0.01, yb + H * 0.01]);
  }
  if (p.tail.blade) {
    const a = tu[tu.length - 1], b = tl[tl.length - 1];
    lines.M([a[0] - H * 0.035, a[1] - H * 0.01]).L([b[0] - H * 0.035, b[1] + H * 0.01]);
  }
  const apu = new D();
  if (p.tail.apu) {
    const a = tu[tu.length - 1], b = tl[tl.length - 1];
    const cy = (a[1] + b[1]) / 2, ry = Math.min((p.tail.apu * H) / 2, Math.abs(a[1] - b[1]) / 2 + H * 0.01);
    apu.M([L + 0.02, cy + ry]).C([L - ry * 0.7, cy + ry], [L - ry * 0.7, cy - ry], [L + 0.02, cy - ry]).Z();
  }

  // ---------- cockpit ----------
  const ck = COCKPIT[p.cockpit.style];
  const cs = (p.cockpit.scale ?? 1) * H;
  const cx0 = p.cockpit.u * H, cy0 = p.cockpit.v * H;
  const cp = (q: readonly (readonly [number, number])[]) => q.map(([u, v]): V => [cx0 + u * cs, cy0 + v * cs]);
  const panes = new D();
  for (const pane of ck.panes) panes.poly(cp(pane));
  const mask = ck.mask ? new D().smooth([...cp(ck.mask), cp(ck.mask)[0]]).Z().toString() : '';
  const cockpitEnd = cx0 + Math.max(...ck.panes.flat().map((v) => v[0])) * cs;

  // ---------- titles ----------
  const inTube = p.windows.filter((r) => r.y + r.h / 2 < H * 0.4);
  const topRow = (inTube.length ? inTube : p.windows).reduce((a, b) => (b.y > a.y ? b : a));
  const winTop = topRow ? topRow.y + topRow.h / 2 : 0;
  const crownAt = (x: number) => Math.min(upperY(x), H / 2);
  let tx = Math.max(cockpitEnd + H * 0.25, ...doorBox.filter((d) => d.kind === 'pax' && d.x < L * 0.3).map((d) => d.x + d.w + H * 0.08));
  while (tx < L * 0.5 && crownAt(tx) < H * 0.49) tx += H * 0.05;
  const avail = H / 2 - winTop;
  const wingStop = w.high ? w.x - wrc * 0.5 : w.x + wrc * 0.3;
  const titles = p.titles ?? { x: tx, y: winTop + avail * 0.46, w: Math.max(H * 1.6, Math.min(wingStop, L * 0.6) - tx), size: Math.min(avail * 0.62, H * 0.24) };

  // ---------- livery ----------
  const liv = new Map<TailStyle, LiveryGeo>();
  const livery = (style: TailStyle): LiveryGeo => {
    let lg = liv.get(style);
    if (!lg) {
      lg = liveryGeometry(style, { p, L, H, quad, finStart, top });
      liv.set(style, lg);
    }
    return lg;
  };

  return {
    p, L, H, upperY, lowerY,
    fus: fus.toString(),
    crown, belly,
    wingRoot: wr.toString(),
    fin: { fill: finFill.toString(), edge: edge.toString(), lines: finLines.toString(), quad, top },
    stab: { near: stabNear.toString(), far: stabFar.toString(), lines: stabLines.toString(), bullet: bullet.toString(), tTail: !!sb.tTail, none: !!sb.none },
    wing: { ...wingG, shadow },
    engines,
    gear: { struts: struts.toString(), tyres: tyres.toString(), hubs: hubs.toString(), fromNacelle: g.from === 'nacelle' },
    windows: win.toString(),
    doors: doors.toString(),
    lines: lines.toString(),
    apu: apu.toString(),
    cockpit: { panes: panes.toString(), mask, round: H * 0.006 },
    titles,
    livery,
    box,
    boxGear: boxGear.merge(box),
  };
}

function nearestRow(p: AircraftProfile, y: number | undefined) {
  if (y === undefined) return p.windows[0];
  return p.windows.reduce((a, b) => (Math.abs(b.y - y) < Math.abs(a.y - y) ? b : a), p.windows[0]);
}

// ---------- livery shapes ----------

interface LivCtx {
  p: AircraftProfile;
  L: number;
  H: number;
  quad: readonly [V, V, V, V];
  finStart: V;
  top: number;
}

function liveryGeometry(style: TailStyle, c: LivCtx): LiveryGeo {
  const { L, H, quad, finStart, top } = c;
  const F = (s: number, t: number) => finAt(quad, s, t);
  const fn = c.p.fin;
  const fus = new D(), fus2 = new D(), fin = new D();
  const far = top + H * 2;
  const x0 = finStart[0] - H * 0.15, span = L - x0;
  // tail wrap: the fin colour runs down over the tail cone along a gentle curve
  const wrapEdge = (dy: number): V[] => [[x0 - dy * 2, H / 2 + 0.5], [x0 + span * 0.3, H / 2 + 0.05 + dy], [x0 + span * 0.55, H * 0.0 + dy], [L + 0.5, -H * 0.35 + dy]];
  const wrap = (d: D) => {
    const [a, b, cc, e] = wrapEdge(0);
    d.M(a).C(b, cc, e).L([L + 0.5, far]).L([x0, far]).Z();
  };
  let code: V;
  let cs = 0.5;
  switch (style) {
    case 'solid': {
      wrap(fus);
      code = [0.5, 0.42];
      break;
    }
    case 'split': {
      wrap(fus);
      // upper-rear half of the fin in the second colour, gently S-curved divide
      const a = F(1.3, 0.02), b = F(-0.3, 0.8);
      fin.M(a).C(F(0.85, 0.3), F(0.35, 0.5), b).L(F(-0.4, 2)).L(F(2, 2)).L(F(2, 0.02)).Z();
      code = [0.36, 0.26];
      cs = 0.4;
      break;
    }
    case 'stripe': {
      wrap(fus);
      // two diagonal bands rising aft across the upper fin
      const band = (t0: number, wd: number) => fin.poly([F(-0.4, t0 - 0.22), F(1.4, t0 + 0.2), F(1.4, t0 + 0.2 + wd), F(-0.4, t0 - 0.22 + wd)]);
      band(0.62, 0.12);
      band(0.8, 0.055);
      // matching pinstripe just below the wrap edge
      const lo = wrapEdge(-H * 0.09), hi = wrapEdge(-H * 0.035);
      fus2.M(lo[0]).C(lo[1], lo[2], lo[3]).L(hi[3]).C(hi[2], hi[1], hi[0]).Z();
      code = [0.48, 0.3];
      cs = 0.45;
      break;
    }
    case 'sweep':
    default: {
      // swoosh rising from the lower rear fuselage into the fin, second colour along its leading edge
      const xs = Math.max(c.p.wing.x + c.p.wing.rootChord * 1.15, finStart[0] - (L - finStart[0]) * 0.85);
      const yl = -H * 0.5;
      const tip = F(1.3, 1.05);
      fus.M([xs, yl - 0.3])
        .C([xs + (fn.x - xs) * 0.55, yl], [fn.x - fn.rootChord * 0.05, H * 0.1], F(0.08, 0.32))
        .C(F(0.35, 0.62), F(0.8, 0.9), tip)
        .L([tip[0] + 5, far]).L([L + 5, -H]).L([xs, -H]).Z();
      fus2.M([xs - H * 0.4, yl - 0.4])
        .C([xs + (fn.x - xs) * 0.45, yl + H * 0.06], [fn.x - fn.rootChord * 0.25, H * 0.28], F(-0.06, 0.48))
        .C(F(0.2, 0.76), F(0.6, 1.0), F(1.0, 1.25))
        .L(tip)
        .C(F(0.8, 0.9), F(0.35, 0.62), F(0.08, 0.32))
        .C([fn.x - fn.rootChord * 0.05, H * 0.1], [xs + (fn.x - xs) * 0.55, yl], [xs, yl - 0.3]).Z();
      fin.s = fus2.s;
      code = [0.62, 0.3];
      cs = 0.4;
      break;
    }
  }
  const pos = F(code[0], code[1]);
  const chord = lerp(fn.rootChord, fn.tipChord, code[1]);
  return {
    fus: fus.toString(),
    fus2: fus2.toString(),
    fin: fin.toString(),
    code: { x: pos[0], y: pos[1], size: Math.min(fn.height * cs, chord * 0.62), w: chord * (style === 'split' ? 0.62 : 0.8) },
  };
}

// ---------- wing (projected side view) ----------

/** Wing station 0..1: leading edge point, chord and thickness. */
export function wingStation(w: WingSpec, f: number): { le: V; chord: number; th: number } {
  const rise = w.span * Math.sin(rad(w.dihedral));
  const run = w.span * Math.tan(rad(w.sweep));
  const th = w.thickness ?? w.rootChord * 0.11;
  return { le: [w.x + run * f, w.y + rise * f], chord: lerp(w.rootChord, w.tipChord, f), th: lerp(th, Math.max(0.1, th * (w.tipChord / w.rootChord)), f) };
}

/** Tip devices in a local frame: x in tip chords from the tip LE, y in device heights. */
const TIP: Partial<Record<TipDevice, { up: number[]; down?: number[] }>> = {
  sharklet: { up: [-0.1, 0, 0.55, 0.02, 0.9, 0.28, 1.12, 0.68, 1.42, 1, 1.72, 1, 1, 0] },
  winglet: { up: [0.2, 0, 0.36, 0.01, 0.48, 0.07, 0.56, 0.16, 1.22, 1, 1.56, 1, 1, 0] },
  blended: { up: [-0.4, 0, 0.55, 0.0, 0.92, 0.22, 1.14, 0.62, 1.42, 1, 1.64, 1, 1, 0] },
  scimitar: { up: [-0.35, 0, 0.55, 0.0, 0.95, 0.22, 1.16, 0.62, 1.5, 1, 1.68, 0.98, 1, 0], down: [0.45, 0, 0.62, -0.08, 0.86, -0.2, 1.08, -0.3, 1.22, -0.28, 1, 0] },
  curved: { up: [-0.8, 0, 0.6, 0.0, 1.05, 0.18, 1.45, 0.7, 1.7, 1.04, 1.82, 1.0, 1, 0] },
  fence: { up: [0.05, 0, 0.55, 1, 0.82, 0.96, 0.95, 0], down: [0.15, 0, 0.5, -0.75, 0.75, -0.7, 0.88, 0] },
};

function wingGeometry(w: WingSpec, box: Box): { fill: string; tip: string; lines: string; shade?: string } {
  if (w.section) return wingSection(w, box);
  const root = wingStation(w, 0);
  const tip = wingStation(w, 1);
  const rc = w.rootChord, tc = w.tipChord;
  const th = root.th, tth = tip.th;
  const [rx, ry] = root.le;
  const [tx, ty] = tip.le;
  const fill = new D();
  const lead = w.delta ? 0.5 : 0.25;
  const plain = w.tip === 'none' || w.tip === 'fence' || !(w.tipH ?? 0);
  fill.M([rx, ry])
    .C([rx, ry + th * 0.3], [rx + rc * lead * 0.3, ry + th * 0.5], [rx + rc * lead, ry + th * 0.5])
    .L([tx + tc * 0.12, ty + tth * 0.5]);
  if (plain) fill.C([tx + tc * 0.6, ty + tth * 0.6], [tx + tc, ty + tth * 0.3], [tx + tc, ty]);
  else fill.L([tx + tc * 0.9, ty + tth * 0.45]).L([tx + tc, ty]);
  fill.L([rx + rc, ry - th * 0.12]).L([rx + rc * 0.42, ry - th * 0.5]).C([rx + rc * 0.1, ry - th * 0.5], [rx, ry - th * 0.3], [rx, ry]).Z();
  box.add([rx, ry - th / 2], [tx + tc, ty + tth]);

  const tipD = new D();
  const h = w.tipH ?? 0;
  const preset = TIP[w.tip];
  if (preset && h > 0) {
    const m = (a: number, b: number): V => [tx + a * tc, ty + tth * 0.3 + b * h];
    const draw = (pts: number[]) => {
      tipD.M(m(pts[0], pts[1]));
      if (w.tip === 'fence') {
        for (let i = 2; i + 1 < pts.length; i += 2) tipD.L(m(pts[i], pts[i + 1]));
      } else {
        tipD.C(m(pts[2], pts[3]), m(pts[4], pts[5]), m(pts[6], pts[7]));
        for (let i = 8; i + 1 < pts.length; i += 2) tipD.L(m(pts[i], pts[i + 1]));
      }
      tipD.Z();
      for (let i = 0; i + 1 < pts.length; i += 2) box.add(m(pts[i], pts[i + 1]));
    };
    draw(preset.up);
    if (preset.down) draw(preset.down);
  } else if ((w.tip === 'raked' || w.tip === 'folding') && h > 0) {
    // raked tip: the leading edge sweeps on aft to a point; h = extra length (m)
    const base: V = [tx + tc * 0.05, ty + tth * 0.45];
    const rise = h * 0.12;
    const point: V = [tx + tc + h, ty + tth * 0.25 + rise];
    tipD.M(base).C([tx + tc * 0.55, ty + tth * 0.55 + rise * 0.3], [point[0] - h * 0.45, point[1] + tth * 0.12], point).C([tx + tc + h * 0.5, point[1] - tth * 0.1], [tx + tc * 1.05, ty - tth * 0.1], [tx + tc * 0.8, ty - tth * 0.12]).Z();
    box.add(point);
  }
  const lines = new D();
  lines.M([rx + rc * 0.72, ry - th * 0.2]).L([tx + tc * 0.7, ty + tth * 0.05]);
  if (w.tip === 'folding' && h > 0) lines.M([tx + tc * 0.7, ty + tth * 0.6]).L([tx + tc * 1.02, ty - tth * 0.1]);
  return { fill: fill.toString(), tip: tipD.toString(), lines: lines.toString() };
}

/** Root aerofoil seen side-on: rounded leading edge at (x, y), cambered, sharp trailing edge. */
function wingSection(w: WingSpec, box: Box): { fill: string; tip: string; lines: string; shade: string } {
  const c = w.rootChord, t = w.thickness ?? c * 0.16;
  const P = (u: number, v: number): V => [w.x + u * c, w.y + v * t];
  const fill = new D().M(P(0, 0))
    .C(P(0, 0.42), P(0.09, 0.74), P(0.3, 0.74))
    .C(P(0.6, 0.74), P(0.86, 0.3), P(1, 0.04))
    .L(P(1, -0.03))
    .C(P(0.78, -0.12), P(0.48, -0.27), P(0.2, -0.27))
    .C(P(0.07, -0.27), P(0, -0.15), P(0, 0))
    .Z();
  // flap / aileron hinge line
  const lines = new D().M(P(0.74, 0.47)).C(P(0.75, 0.3), P(0.76, 0.0), P(0.75, -0.14));
  // underside in shadow: lower surface up to the mean camber line
  const shade = new D().M(P(0.012, -0.08))
    .C(P(0.1, 0.1), P(0.4, 0.22), P(0.7, 0.18))
    .C(P(0.85, 0.14), P(0.95, 0.06), P(1, 0.0))
    .L(P(1, -0.03))
    .C(P(0.78, -0.12), P(0.48, -0.27), P(0.2, -0.27))
    .C(P(0.07, -0.27), P(0.012, -0.18), P(0.012, -0.08))
    .Z();
  box.add(P(0, -0.27), P(0.3, 0.74), P(1, 0));
  return { fill: fill.toString(), tip: '', lines: lines.toString(), shade: shade.toString() };
}

// ---------- engines ----------

interface Nac { cowl: number; lip: number; max: number; aft: number; core: number; coreEnd: number; flat?: number; chev?: number }

const NAC: Record<Exclude<EngineStyle, 'turboprop' | 'supersonic'>, Nac> = {
  plain: { cowl: 0.64, lip: 0.9, max: 0.24, aft: 0.8, core: 0.5, coreEnd: 0.86 },
  longduct: { cowl: 0.86, lip: 0.88, max: 0.3, aft: 0.6, core: 0.4, coreEnd: 0.93 },
  gtf: { cowl: 0.7, lip: 0.94, max: 0.26, aft: 0.8, core: 0.44, coreEnd: 0.88 },
  chevron: { cowl: 0.62, lip: 0.9, max: 0.24, aft: 0.8, core: 0.5, coreEnd: 0.87, chev: 6 },
  ge90: { cowl: 0.66, lip: 0.94, max: 0.25, aft: 0.84, core: 0.46, coreEnd: 0.88 },
  flatbottom: { cowl: 0.62, lip: 0.88, max: 0.26, aft: 0.78, core: 0.5, coreEnd: 0.86, flat: 0.2 },
  rear: { cowl: 0.8, lip: 0.9, max: 0.26, aft: 0.74, core: 0.42, coreEnd: 0.92 },
};

function cowlR(t: number, s: Nac): number {
  if (t < s.max) return s.lip + (1 - s.lip) * Math.sin(((t / s.max) * Math.PI) / 2);
  const k = (t - s.max) / (s.cowl - s.max);
  return 1 - (1 - s.aft) * k * k;
}

function engineGeometry(e: EngineSpec, w: WingSpec, box: Box, upperY: (x: number) => number): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  const pylon = new D();
  if (e.mount === 'underwing' && e.station !== undefined) {
    const st = wingStation(w, e.station);
    const wy = st.le[1] - st.th * 0.3;
    const ax = x + len * (e.style === 'supersonic' ? 0.25 : 0.14);
    const topY = Math.max(wy, cy + r * 0.8);
    const fx = Math.min(st.le[0] - st.chord * 0.05, ax + 0.6);
    pylon.M([ax, cy + r * 0.8])
      .C([ax, topY - (topY - cy - r * 0.8) * 0.3], [fx - 0.4, topY], [fx, topY])
      .L([st.le[0] + st.chord * 0.8, wy - st.th * 0.1])
      .C([x + len * 0.94, cy + r * 0.62], [x + len * 1.02, cy + r * 0.32], [x + len * 1.02, cy + r * 0.18])
      .L([x + len * 0.6, cy + r * 0.3])
      .Z();
    box.add([st.le[0] + st.chord * 0.8, wy]);
  } else if (e.mount === 'rear') {
    // short stub pylon back to the fuselage side, mostly hidden by the nacelle
    const px = x + len * 0.35;
    const py = Math.min(cy, upperY(px) - r) - r * 0.1;
    pylon.M([px, cy]).L([px + len * 0.4, cy]).L([px + len * 0.45, py]).L([px - len * 0.05, py]).Z();
  }
  if (e.style === 'turboprop') return turboprop(e, pylon, box);
  if (e.style === 'supersonic') return supersonic(e, pylon, box);

  const s = NAC[e.style];
  const ts = [0, 0.012, 0.04, 0.09, s.max * 0.75, s.max, (s.max + s.cowl) / 2, s.cowl * 0.86, s.cowl];
  const flatK = (t: number) => (s.flat && t < 0.4 ? 1 - s.flat * (1 - t / 0.4) ** 1.4 : 1);
  const upper = ts.map((t): V => [x + t * len, cy + r * cowlR(t, s)]);
  const lower = ts.map((t): V => [x + t * len, cy - r * cowlR(t, s) * flatK(t)]);
  const xc = x + s.cowl * len;
  const ra = r * s.aft;
  const cowl = new D().smooth(upper);
  if (s.chev) {
    const k = s.chev;
    for (let i = 1; i <= k * 2; i++) cowl.L([i % 2 ? xc + r * 0.14 : xc, cy + ra - (2 * ra * i) / (k * 2)]);
  }
  cowl.L(lower[lower.length - 1]).smooth([...lower].reverse(), false).Z();
  // accent band on the fan cowl, following the outline
  const ta = 0.1, tb = 0.2;
  const band: V[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = lerp(ta, tb, i / 4);
    band.push([x + t * len, cy + r * cowlR(t, s) + 0.02]);
  }
  for (let i = 4; i >= 0; i--) {
    const t = lerp(ta, tb, i / 4);
    band.push([x + t * len, cy - r * cowlR(t, s) * flatK(t) - 0.02]);
  }
  const accent = new D().poly(band).toString();
  const cr = r * s.core;
  const xe = x + s.coreEnd * len;
  const core = new D().M([xc - r * 0.12, cy + cr]).C([xc + (xe - xc) * 0.4, cy + cr], [xe - (xe - xc) * 0.2, cy + cr * 0.8], [xe, cy + cr * 0.72]).L([xe, cy - cr * 0.72]).C([xe - (xe - xc) * 0.2, cy - cr * 0.8], [xc + (xe - xc) * 0.4, cy - cr], [xc - r * 0.12, cy - cr]).Z();
  const pr = cr * 0.62;
  const xp = x + len;
  const plug = new D().M([xe - 0.02, cy + pr]).C([xe + (xp - xe) * 0.45, cy + pr], [xp - (xp - xe) * 0.12, cy + pr * 0.25], [xp, cy]).C([xp - (xp - xe) * 0.12, cy - pr * 0.25], [xe + (xp - xe) * 0.45, cy - pr], [xe - 0.02, cy - pr]).Z();
  const lipCy = s.flat ? cy + r * s.flat * 0.14 : cy;
  const lipRy = r * s.lip * (s.flat ? 0.9 : 1);
  const lip = new D().ellipse([x + r * 0.03, lipCy], r * 0.11, lipRy).toString();
  const dark = new D().ellipse([x + r * 0.07, lipCy], r * 0.06, lipRy * 0.82).ellipse([xc + r * 0.015, cy], r * 0.045, ra * 0.9).toString();
  const ts2 = s.max + 0.06;
  const seam = new D().M([x + len * ts2, cy + r * cowlR(ts2, s) - 0.01]).L([x + len * ts2, cy - r * cowlR(ts2, s) * flatK(ts2) + 0.01]).toString();
  box.add([x - r * 0.1, cy - r], [xp, cy + r]);
  return { spec: e, pylon: pylon.toString(), cowl: cowl.toString(), accent, lip, dark, core: core.toString(), plug: plug.toString(), seam };
}

function turboprop(e: EngineSpec, pylon: D, box: Box): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  const sp = len * 0.12;
  const xb = x + sp;
  const end = x + (e.tailLen ?? len);
  const cowl = new D()
    .M([xb, cy + r * 0.52])
    .C([xb + len * 0.03, cy + r * 0.95], [xb + len * 0.1, cy + r * 1.04], [xb + len * 0.3, cy + r * 1.04])
    .L([end - (end - x) * 0.1, cy + r * 0.98])
    .C([end - (end - x) * 0.02, cy + r * 0.96], [end, cy + r * 0.8], [end, cy + r * 0.62])
    .C([end - (end - x) * 0.2, cy - r * 0.5], [x + len * 0.62, cy - r * 0.98], [x + len * 0.42, cy - r * 1.0])
    .L([xb + len * 0.16, cy - r * 1.0])
    .C([xb + len * 0.04, cy - r * 0.98], [xb, cy - r * 0.78], [xb, cy - r * 0.3])
    .Z();
  // chin intake under the spinner and exhaust on the nacelle side
  const dark = new D()
    .M([xb + len * 0.015, cy - r * 0.4]).L([xb + len * 0.09, cy - r * 0.44]).L([xb + len * 0.09, cy - r * 0.74]).L([xb + len * 0.03, cy - r * 0.72]).Z()
    .M([x + len * 0.58, cy - r * 0.05]).L([x + len * 0.7, cy - r * 0.02]).L([x + len * 0.68, cy - r * 0.32]).L([x + len * 0.58, cy - r * 0.3]).Z();
  const accent = new D().M([xb + len * 0.2, cy + r * 1.03]).L([xb + len * 0.28, cy + r * 1.03]).L([xb + len * 0.28, cy - r * 1.0]).L([xb + len * 0.2, cy - r * 1.0]).Z().toString();
  const spinner = new D().M([xb + 0.03, cy + r * 0.5]).C([xb - sp * 0.45, cy + r * 0.48], [x + sp * 0.05, cy + r * 0.16], [x, cy]).C([x + sp * 0.05, cy - r * 0.16], [xb - sp * 0.45, cy - r * 0.48], [xb + 0.03, cy - r * 0.5]).Z();
  const R = (e.prop?.dia ?? r * 4) / 2;
  const nb = e.prop?.blades ?? 6;
  const xd = xb - sp * 0.3;
  const rx = R * 0.1;
  const disc = new D().ellipse([xd, cy], rx, R).toString();
  const blades = new D();
  // blades seen from the side: thin tapered shapes radiating from the hub at different phase angles
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + 0.25;
    const sy = Math.sin(a), sx = Math.cos(a);
    const tip: V = [xd + sx * rx * 0.9, cy + sy * R * 0.98];
    const root: V = [xd, cy + sy * r * 0.35];
    const wd = R * 0.06 * (0.35 + 0.65 * Math.abs(sx));
    blades.M(root).C([root[0] + wd, lerp(root[1], tip[1], 0.35)], [tip[0] + wd * 0.6, lerp(root[1], tip[1], 0.8)], tip).C([tip[0] - wd * 0.6, lerp(root[1], tip[1], 0.8)], [root[0] - wd, lerp(root[1], tip[1], 0.35)], root).Z();
  }
  box.add([xd - rx, cy - R], [xd + rx, cy + R], [end, cy]);
  return {
    spec: e, pylon: pylon.toString(), cowl: cowl.toString(), accent, lip: '', dark: dark.toString(), core: '', plug: '', seam: '',
    prop: { disc, blades: blades.toString(), spinner: spinner.toString() },
  };
}

function supersonic(e: EngineSpec, pylon: D, box: Box): EngineGeo {
  const r = e.dia / 2;
  const { x, y: cy, len } = e;
  const cowl = new D().M([x, cy + r * 0.8]).L([x + len * 0.1, cy + r]).L([x + len * 0.86, cy + r * 0.94]).C([x + len * 0.95, cy + r * 0.9], [x + len, cy + r * 0.8], [x + len, cy + r * 0.68])
    .L([x + len, cy - r * 0.68]).C([x + len, cy - r * 0.8], [x + len * 0.95, cy - r * 0.9], [x + len * 0.86, cy - r * 0.94]).L([x + len * 0.1, cy - r]).L([x - len * 0.06, cy - r]).Z().toString();
  const dark = new D().poly([[x - len * 0.055, cy - r * 0.92], [x + len * 0.004, cy + r * 0.74], [x + len * 0.03, cy + r * 0.7], [x - len * 0.015, cy - r * 0.92]])
    .poly([[x + len * 0.985, cy + r * 0.66], [x + len, cy + r * 0.68], [x + len, cy - r * 0.68], [x + len * 0.985, cy - r * 0.66]]).toString();
  const accent = new D().poly([[x + len * 0.18, cy + r * 0.99], [x + len * 0.24, cy + r * 0.985], [x + len * 0.24, cy - r * 0.99], [x + len * 0.18, cy - r * 0.995]]).toString();
  box.add([x - len * 0.06, cy - r], [x + len, cy + r]);
  return { spec: e, pylon: pylon.toString(), cowl, accent, lip: '', dark, core: '', plug: '', seam: '' };
}
