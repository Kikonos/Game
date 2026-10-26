// Liveries and client paint (v0.5.1, LIVERY.md §1, §4). Resolving and normalising liveries is pure; the player's
// livery choices are free and instant; client paint-in and strip are 'paint' maintenance events at a paint shop.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { countryName } from '../../data/countries';
import { CLIENT_LIVERIES, recipeLogo, type ClientLiveryRecipe } from '../../data/clientLiveries';
import { CLIENT_LOGOS, CLIENT_PALETTE, LOGO_IDS, MAX_CODE, REMOVED_LOGOS, MAX_STICKERS, MAX_STRIPES, MAX_TITLE, WHITE_LIVERY } from '../../data/livery';
import { BAL } from '../core/balance';
import { flightsOf, removeFlights, touchFlights } from '../core/entities';
import { invoice, post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay } from '../core/time';
import type {
  ActionResult, Aircraft, Client, Contract, GameState, Livery, LiveryBody, LiveryLogo, LiveryRef, LiveryStripe, LiveryText, MaintenanceEvent, Minute, PaintKind, StickerKind, StickerPlacement,
  StickerSide, TailStyle,
} from '../core/types';
import { clamp, hashUnit } from '../core/util';
import { clientPrefix, isGovernment } from '../contracts/clients';
import { paintWindow, type PaintSlot } from '../contracts/paintTerms';
import { scheduleCheck } from './maintenance';
import { usd } from './util';

// ---------- resolving ----------

export interface ResolvedLivery {
  livery: Livery;
  /** Default tail code and titles for the art ('' = none). */
  code: string;
  name: string;
  source: 'company' | 'white' | 'custom' | 'client';
  contractId?: string;
  clientName?: string;
}

const isUN = (c: Client) => /^UN\b|^UNHCR\b/.test(c.name);

/** Fin code of a client livery: its designator ('SV', 'UN'). */
export function clientCode(c: Client): string {
  return isUN(c) ? 'UN' : clientPrefix(c.name).slice(0, MAX_CODE);
}

/** Fuselage titles of a client livery: the name, shortened to MAX_TITLE (acronym, "<Country> Government", word cut). */
export function clientTitles(c: Client): string {
  if (isUN(c)) return 'UN';
  if (c.name.length <= MAX_TITLE) return c.name;
  const acr = c.name.match(/\(([A-Z]{2,6})\)/)?.[1];
  if (acr) return acr;
  if (c.kind === 'government') {
    const gov = `${countryName(c.country)} Government`;
    if (gov.length <= MAX_TITLE) return gov;
  }
  let out = '';
  for (const w of c.name.split(/\s+/)) {
    if ((out ? `${out} ${w}` : w).length > MAX_TITLE) break;
    out = out ? `${out} ${w}` : w;
  }
  return out || c.name.slice(0, MAX_TITLE);
}

/** The livery an aircraft wears now: client paint, then plain white, custom, or the company's. Pure. */
export function liveryOf(g: GameState, ac: Aircraft | string): ResolvedLivery {
  const a = typeof ac === 'string' ? g.fleet[ac] : ac;
  const co = g.company;
  if (a?.paintedFor) {
    const c = g.contracts[a.paintedFor];
    const cl = c ? g.clients[c.clientId] : undefined;
    // resolved from the client's name now (an older save's stored livery is the generated scheme of then)
    if (c?.paint && cl) return { livery: clientLivery(cl, c.paint.kind), code: clientCode(cl), name: clientTitles(cl), source: 'client', contractId: c.id, clientName: cl.name };
  }
  const ref = a?.livery ?? 'company';
  if (ref === 'white') return { livery: WHITE_LIVERY, code: '', name: '', source: 'white' };
  if (typeof ref === 'object') return { livery: ref.custom, code: ref.custom.code?.text ?? co.code, name: ref.custom.titles?.text ?? co.name, source: 'custom' };
  return { livery: co.livery, code: co.livery.code?.text ?? co.code, name: co.livery.titles?.text ?? co.name, source: 'company' };
}

// ---------- normalising ----------

const TAILS: readonly TailStyle[] = ['solid', 'split', 'stripe', 'sweep'];
const KINDS: readonly StickerKind[] = ['code', 'titles', 'logo'];
const SIDES: readonly StickerSide[] = ['fuselage', 'fin'];
const DEFAULT_LIVERY: Livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' };

/** '#abc' / '#AABBCC' → '#aabbcc'; anything else → undefined. */
function hex(c: unknown): string | undefined {
  if (typeof c !== 'string') return undefined;
  const s = c.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return undefined;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

function text(t: unknown, kind: 'code' | 'titles'): LiveryText | undefined {
  if (!t || typeof t !== 'object') return undefined;
  const x = t as Partial<LiveryText>;
  const out: LiveryText = {};
  if (typeof x.text === 'string') {
    // fin lettering: up to 4 capitals (client marks: 'JET2', 'FKŽ', 'A&K'; the editor still offers 3 A–Z / 0–9)
    out.text = kind === 'code' ? x.text.toUpperCase().replace(/[^\p{Lu}0-9&]/gu, '').slice(0, MAX_CODE + 1) : x.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE).trim();
  }
  const color = hex(x.color);
  if (color) out.color = color;
  if (x.weight === 500 || x.weight === 700) out.weight = x.weight;
  return Object.keys(out).length ? out : undefined;
}

function logo(l: unknown, fallbackColor: string): LiveryLogo | undefined {
  if (!l || typeof l !== 'object') return undefined;
  const x = l as Partial<LiveryLogo>;
  // a mark no longer in the set (v0.11: the orbit) becomes its stand-in
  const id: string | undefined = REMOVED_LOGOS[x.id as string] ?? x.id;
  if (id !== 'mono' && !(LOGO_IDS as readonly string[]).includes(id as string)) return undefined;
  const out: LiveryLogo = { id: id as LiveryLogo['id'], color: hex(x.color) ?? fallbackColor };
  const c2 = hex(x.color2);
  if (c2) out.color2 = c2;
  if (typeof x.text === 'string') {
    const t = x.text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (t) out.text = t;
  }
  return out;
}

/** v0.10 body paint: hex colours, split 0.25–0.9, tilt ±1, ≤ 3 stripes (y 0–1, h 0.02–0.3); empty → absent. */
function bodyPaint(b: unknown): LiveryBody | undefined {
  if (!b || typeof b !== 'object') return undefined;
  const x = b as Partial<LiveryBody>;
  const out: LiveryBody = {};
  const color = hex(x.color);
  if (color) out.color = color;
  if (x.belly && typeof x.belly === 'object') {
    const bc = hex(x.belly.color);
    if (bc) {
      out.belly = { color: bc, split: r3(clamp(num(x.belly.split) ?? 0.62, 0.25, 0.9)), tilt: r3(clamp(num(x.belly.tilt) ?? 0, -1, 1)) };
      if (x.belly.windows === true) out.belly.windows = true;
      const lc = x.belly.line && typeof x.belly.line === 'object' ? hex(x.belly.line.color) : undefined;
      if (lc) out.belly.line = { color: lc, h: r3(clamp(num(x.belly.line!.h) ?? 0.02, 0.005, 0.06)) };
    }
  }
  if (Array.isArray(x.stripes)) {
    const st: LiveryStripe[] = [];
    for (const v of x.stripes) {
      if (!v || typeof v !== 'object' || st.length >= MAX_STRIPES) continue;
      const sc = hex(v.color);
      if (!sc) continue;
      const one: LiveryStripe = { color: sc, y: r3(clamp(num(v.y) ?? 0.45, 0, 1)), h: r3(clamp(num(v.h) ?? 0.08, 0.02, 0.3)) };
      if (v.windows === true) one.windows = true;
      if (v.sweep === true) one.sweep = true;
      st.push(one);
    }
    if (st.length) out.stripes = st;
  }
  for (const k of ['nose', 'engines', 'lip', 'finRoot', 'tailWrap'] as const) {
    const c = hex(x[k]);
    if (c) out[k] = c;
  }
  if (x.noseBand && typeof x.noseBand === 'object') {
    const nc = hex(x.noseBand.color);
    if (nc) {
      out.noseBand = { color: nc };
      const ac = hex(x.noseBand.accent);
      if (ac) out.noseBand.accent = ac;
    }
  }
  if (Array.isArray(x.finBands)) {
    const fb = x.finBands.flatMap((v) => {
      const c = v && typeof v === 'object' ? hex(v.color) : undefined;
      return c ? [{ color: c, t0: r3(clamp(num(v.t0) ?? 0, -0.2, 1.2)), t1: r3(clamp(num(v.t1) ?? 0.1, -0.2, 1.2)) }] : [];
    }).slice(0, 4);
    if (fb.length) out.finBands = fb;
  }
  if (x.vstripes && typeof x.vstripes === 'object') {
    const vc = hex(x.vstripes.color);
    if (vc) out.vstripes = { color: vc, w: r3(clamp(num(x.vstripes.w) ?? 0.03, 0.01, 0.1)) };
  }
  if (x.engineLogo === true) out.engineLogo = true;
  if (x.noseLogo === true) out.noseLogo = true;
  return Object.keys(out).length ? out : undefined;
}

function sticker(s: unknown): StickerPlacement | null {
  if (!s || typeof s !== 'object') return null;
  const x = s as Partial<StickerPlacement>;
  if (typeof x.id !== 'string' || !x.id || !KINDS.includes(x.kind as StickerKind) || !SIDES.includes(x.side as StickerSide)) return null;
  const out: StickerPlacement = { id: x.id.slice(0, 24), kind: x.kind as StickerKind, side: x.side as StickerSide, scale: r3(clamp(num(x.scale) ?? 1, 0.3, 3)) };
  const px = num(x.x);
  const py = num(x.y);
  if (px !== undefined) out.x = r3(clamp(px, 0, 1));
  if (py !== undefined) out.y = r3(clamp(py, 0, 1));
  const rot = num(x.rotation);
  if (rot !== undefined && rot !== 0) out.rotation = Math.round(clamp(rot, -45, 45) * 10) / 10;
  return out;
}

/**
 * A valid livery from anything (editor output, old saves, new-game input): hex colours, known scheme, texts trimmed
 * (code A–Z/0–9 ≤ 3, titles ≤ 28), known logo, ≤ 6 stickers with unique ids, x/y 0–1, scale 0.3–3, rotation ±45°.
 * Absent fields stay absent (a v0.5 livery comes back unchanged). Idempotent. Pure.
 */
export function normaliseLivery(l: Partial<Livery> | undefined, fallback: Livery = DEFAULT_LIVERY): Livery {
  const x = (l && typeof l === 'object' ? l : {}) as Partial<Livery>;
  const out: Livery = {
    primary: hex(x.primary) ?? fallback.primary,
    secondary: hex(x.secondary) ?? fallback.secondary,
    tail: TAILS.includes(x.tail as TailStyle) ? (x.tail as TailStyle) : fallback.tail,
  };
  if (x.plain === true) out.plain = true;
  const body = bodyPaint(x.body);
  if (body) out.body = body;
  const code = text(x.code, 'code');
  if (code) out.code = code;
  const titles = text(x.titles, 'titles');
  if (titles) out.titles = titles;
  const lg = logo(x.logo, out.secondary);
  if (lg) out.logo = lg;
  if (x.reg && typeof x.reg === 'object') {
    const rg: NonNullable<Livery['reg']> = {};
    if (x.reg.hide === true) rg.hide = true;
    if (x.reg.noFlag === true) rg.noFlag = true;
    if (x.reg.at === 'fin') rg.at = 'fin';
    if (x.reg.fleet === true) rg.fleet = true;
    const rc = hex(x.reg.color);
    if (rc) rg.color = rc;
    if (Object.keys(rg).length) out.reg = rg;
  }
  if (x.model === 'forward' || x.model === 'off') out.model = x.model;
  if (Array.isArray(x.stickers)) {
    const seen = new Set<string>();
    out.stickers = [];
    for (const s of x.stickers) {
      const p = sticker(s);
      if (!p || seen.has(p.id) || out.stickers.length >= MAX_STICKERS) continue;
      seen.add(p.id);
      out.stickers.push(p);
    }
  }
  return out;
}

const lum = (hex: string): number => {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * ch((n >> 16) & 255) + 0.7152 * ch((n >> 8) & 255) + 0.0722 * ch(n & 255);
};
const contrast = (a: string, b: string): number => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
/** White or near-black for a fin logo: it sits on the fin base (p1) and the band only clips an edge,
 *  so p1 counts three times as much as p2. Pure. */
function finInk(p1: string, p2: string): string {
  const score = (c: string) => Math.min(contrast(c, p1), 3 * contrast(c, p2));
  return score('#ffffff') >= score('#0f172a') ? '#ffffff' : '#0f172a';
}

/** How the aircraft looks after a client strip: its own choice of livery. */
function homeLook(g: GameState, ac: Aircraft): { to: string; in: string } {
  const ref = ac.livery ?? 'company';
  if (ref === 'white') return { to: 'back to plain white', in: 'back in plain white' };
  if (typeof ref === 'object') return { to: 'back to its own livery', in: 'back in its own livery' };
  return { to: `back to ${g.company.name} colours`, in: `back in ${g.company.name} colours` };
}

/** A client's colours: its real livery (data/clientLiveries.ts) when it has a recipe, else a generated scheme. */
export function clientLivery(client: Client, kind: PaintKind): Livery {
  const r = CLIENT_LIVERIES[client.name];
  if (r) return recipeLivery(r, kind);
  return generatedLivery(client, kind);
}

/** A client's real-livery recipe as a livery: full paint, or (decals) a white aircraft with its lettering and mark. */
export function recipeLivery(r: ClientLiveryRecipe, kind: PaintKind): Livery {
  const [fin, fin2, tail] = r.fin;
  const [text, tcolor, weight] = r.titles;
  const logo = recipeLogo(r);
  const code = 'code' in r.mark ? { text: r.mark.code[0], color: r.mark.code[1], weight: 700 as const } : undefined;
  const stickers: StickerPlacement[] = [
    logo ? { id: 'logo', kind: 'logo', side: 'fin', scale: 1 } : { id: 'code', kind: 'code', side: 'fin', scale: 1 },
    { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 },
  ];
  if (kind === 'decals') {
    const ink = r.decalInk ?? tcolor;
    // on a white fin the mark must read: white lettering or a white glyph takes the client's ink
    const onWhite = (c: string) => (lum(c) > 0.8 ? ink : c);
    return {
      primary: '#ffffff', secondary: ink, tail: 'solid', plain: true, titles: { text, color: ink, weight: weight ?? 700 },
      ...(code ? { code: { ...code, color: onWhite(code.color) } } : {}),
      ...(logo ? { logo: { ...logo, color: onWhite(logo.color), ...(logo.color2 ? { color2: onWhite(logo.color2) } : {}) } } : {}),
      stickers,
    };
  }
  return {
    primary: fin, secondary: fin2, tail, ...(r.body ? { body: structuredClone(r.body) } : {}),
    titles: { text, color: tcolor, weight: weight ?? 700 }, ...(code ? { code } : {}), ...(logo ? { logo } : {}), stickers,
    ...(r.fleet ? { reg: { fleet: true } } : {}),
  };
}

/** A client without a recipe: a full scheme from the new options, chosen and coloured by the client's name. */
function generatedLivery(client: Client, kind: PaintKind): Livery {
  const key = client.name;
  const un = isUN(client);
  const [p1, p2] = un ? ['#1f2937', '#4b92db'] : CLIENT_PALETTE[Math.floor(hashUnit(key) * CLIENT_PALETTE.length) % CLIENT_PALETTE.length];
  const mono = un || isGovernment(client) || client.kind === 'agency';
  const tail = TAILS[Math.floor(hashUnit(`${key}#tail`) * TAILS.length) % TAILS.length];
  // Full paint on a two-tone fin: the logo takes white or ink that reads on the fin, not the accent band's colour.
  const ink = kind !== 'full' ? p1 : tail === 'solid' ? p2 : finInk(p1, p2);
  // the glyph's second tone must not be the fin colour (it would vanish): accent, or white/ink on a solid fin
  const tone2 = kind === 'full' && tail === 'solid' ? finInk(p1, p1) : p2;
  const lg: LiveryLogo = mono
    ? { id: 'mono', color: ink, color2: kind === 'full' ? p1 : p2, text: clientCode(client) }
    : { id: CLIENT_LOGOS[Math.floor(hashUnit(`${key}#logo`) * CLIENT_LOGOS.length) % CLIENT_LOGOS.length], color: ink, color2: tone2 };
  const stickers: StickerPlacement[] = [
    { id: 'logo', kind: 'logo', side: 'fin', scale: 1 },
    { id: 'titles', kind: 'titles', side: 'fuselage', scale: 1 },
  ];
  if (kind === 'decals') {
    return { primary: '#ffffff', secondary: p1, tail: 'solid', plain: true, titles: { color: p1, weight: 700 }, code: { color: p1 }, logo: lg, stickers };
  }
  // a fuselage scheme too: eurowhite, a belly below the windows, a two-tone, a cheatline or a belly band
  const look = Math.floor(hashUnit(`${key}#body`) * 5);
  const grey = '#c6cdd4';
  const body: LiveryBody | undefined = mono
    ? { stripes: [{ color: p1, y: 0.56, h: 0.035 }, { color: p2, y: 0.6, h: 0.02 }], engines: '#ffffff' }
    : [
      { engines: p1, finRoot: p2 },
      { belly: { color: grey, split: 0.62, tilt: 0, windows: true }, noseBand: { color: p1, accent: p2 }, finRoot: p2 },
      { color: p1, belly: { color: '#ffffff', split: 0.62, tilt: 0, windows: true, line: { color: p2, h: 0.018 } }, engines: '#ffffff' },
      { stripes: [{ color: p1, y: 0.4, h: 0.09, windows: true }, { color: p2, y: 0.56, h: 0.025 }], belly: { color: grey, split: 0.72, tilt: 0 } },
      { belly: { color: p1, split: 0.62, tilt: 0, windows: true, line: { color: p2, h: 0.03 } } },
    ][look];
  return { primary: p1, secondary: p2, tail, ...(body ? { body } : {}), titles: { weight: 700 }, logo: lg, stickers };
}

// ---------- status and player actions ----------

export interface PaintStatus {
  paintedFor?: string;
  clientName?: string;
  /** Next planned or running paint-in / strip. */
  booked?: MaintenanceEvent;
  /** The livery picker is locked (client paint on, or a paint job booked). */
  locked: boolean;
  /** "In Saudia colours until 12 Mar" style line for the locked picker. */
  why?: string;
}

/** Client paint on an aircraft and its next paint-shop visit. Pure. */
export function paintStatus(g: GameState, aircraftId: string): PaintStatus {
  const ac = g.fleet[aircraftId];
  const out: PaintStatus = { locked: false };
  if (!ac) return out;
  for (const m of Object.values(g.maintenance)) {
    if (m.aircraftId !== aircraftId || m.kind !== 'paint' || (m.status !== 'planned' && m.status !== 'inWork')) continue;
    if (!out.booked || m.start < out.booked.start) out.booked = m;
  }
  const c = ac.paintedFor ? g.contracts[ac.paintedFor] : undefined;
  if (c) {
    out.paintedFor = c.id;
    out.clientName = g.clients[c.clientId]?.name;
  }
  out.locked = !!out.paintedFor || !!out.booked;
  if (out.paintedFor) {
    const strip = out.booked?.paint?.phase === 'out' ? out.booked : undefined;
    out.why = `In ${out.clientName ?? 'client'} colours until ${fmtDay(strip ? strip.end : Math.max(g.now, c!.end))}`;
  } else if (out.booked) {
    const bc = out.booked.paint ? g.contracts[out.booked.paint.contractId] : undefined;
    out.why = `Paint shop ${fmtDay(out.booked.start)}: ${g.clients[bc?.clientId ?? '']?.name ?? 'client'} colours`;
  }
  return out;
}

function validRef(ref: LiveryRef, fallback: Livery): LiveryRef | null {
  if (ref === 'company' || ref === 'white') return ref;
  if (ref && typeof ref === 'object' && ref.custom && typeof ref.custom === 'object') return { custom: normaliseLivery(ref.custom, fallback) };
  return null;
}

/** Company livery (Company screen, New Game): normalised, free and instant. */
export function setCompanyLivery(g: GameState, l: Livery): ActionResult {
  if (!l || typeof l !== 'object') return { ok: false, error: 'No livery given' };
  g.company.livery = normaliseLivery(l, g.company.livery);
  return { ok: true, msg: 'Company livery saved' };
}

/** One aircraft's livery: company, plain white or custom. Refused while client paint is on or booked. */
export function setAircraftLivery(g: GameState, aircraftId: string, ref: LiveryRef): ActionResult {
  const ac = g.fleet[aircraftId];
  if (!ac) return { ok: false, error: 'Aircraft not found' };
  const st = paintStatus(g, aircraftId);
  if (st.locked) return { ok: false, error: `${ac.reg}: ${st.why ?? 'client paint booked'}` };
  const r = validRef(ref, g.company.livery);
  if (!r) return { ok: false, error: 'Unknown livery' };
  if (r === 'company') delete ac.livery;
  else ac.livery = r;
  return { ok: true, msg: `${ac.reg}: ${r === 'company' ? 'company livery' : r === 'white' ? 'plain white' : 'custom livery'}` };
}

/** "Use on all aircraft": every aircraft not locked by client paint. */
export function setFleetLivery(g: GameState, ref: LiveryRef): ActionResult<{ changed: number; skipped: number }> {
  const r = validRef(ref, g.company.livery);
  if (!r) return { ok: false, error: 'Unknown livery' };
  let changed = 0;
  let skipped = 0;
  for (const ac of Object.values(g.fleet)) {
    if (paintStatus(g, ac.id).locked) {
      skipped++;
      continue;
    }
    if (r === 'company') delete ac.livery;
    else ac.livery = typeof r === 'object' ? { custom: structuredClone(r.custom) } : r;
    changed++;
  }
  return { ok: true, msg: `Livery set on ${changed} aircraft${skipped ? ` (${skipped} in client colours)` : ''}`, data: { changed, skipped } };
}

// ---------- client paint: booking and the paint shop ----------

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;
const pct = (v: number) => `${Math.round(v * 100)}%`;

/**
 * Books a paint-in ('in', before the contract) or strip ('out', after it) at the slot's shop: a 'paint' maintenance
 * event that blocks the aircraft like a check (ferries booked by scheduleCheck). Returns the error, or null.
 */
export function bookPaint(g: GameState, c: Contract, aircraftId: string, phase: 'in' | 'out', slot: PaintSlot): string | null {
  const t = c.paint;
  const ac = g.fleet[aircraftId];
  if (!t || !ac) return 'Nothing to paint';
  const days = phase === 'in' ? t.days : t.stripDays;
  const cost = phase === 'in' ? t.cost : t.stripCost;
  const r = scheduleCheck(g, aircraftId, 'paint', slot.start, slot.shop, { paint: { contractId: c.id, phase, days, cost } });
  if (!r.ok) return r.error;
  const id = r.data!.maintId;
  if (phase === 'in') {
    // Painting over another client's colours: a strip still booked after this slot is no longer needed.
    for (const x of Object.values(g.maintenance)) if (x.aircraftId === aircraftId && x.paint?.phase === 'out' && x.status === 'planned' && x.start >= slot.start) dropPaint(g, x);
  }
  if (phase === 'in') (t.inMx ??= {})[aircraftId] = id;
  else (t.outMx ??= {})[aircraftId] = id;
  const m = g.maintenance[id];
  const client = g.clients[c.clientId]?.name ?? 'The client';
  const what = phase === 'out' ? (t.kind === 'full' ? 'Repaint' : 'Decal removal') : t.kind === 'full' ? 'Full repaint' : 'Decals';
  const share = t.clientShare >= 1 ? 'all of it' : t.clientShare > 0 ? pct(t.clientShare) : 'nothing';
  pushMessage(g, phase === 'in'
    ? { tone: 'info', cat: 'tech', title: `Paint booked: ${ac.reg} in ${client} colours`, body: `${what} at ${city(m.at)}, ${fmtDay(m.start)}–${fmtDay(m.end)}. ${usd(cost)}; ${client} pays ${share}.`, ref: { kind: 'maint', id } }
    : { tone: 'info', cat: 'tech', title: `Repaint booked: ${ac.reg} ${homeLook(g, ac).to}`, body: `${what} at ${city(m.at)}, ${fmtDay(m.start)}–${fmtDay(m.end)}. ${usd(cost)}${c.status === 'completed' && t.clientShare > 0 ? `; ${client} pays ${share}` : ''}.`, ref: { kind: 'maint', id } });
  return null;
}

/** Gives up a planned paint event (contract cancelled before the paint shop): slot and ferries released. */
function dropPaint(g: GameState, m: MaintenanceEvent): void {
  if (m.status !== 'planned') return;
  m.status = 'cancelled';
  m.ev++;
  const ferries = (m.ferryIds ?? []).filter((id) => g.flights[id]?.status === 'scheduled');
  if (ferries.length) removeFlights(g, ferries);
  touchFlights(g);
}

/** Contract cancelled by us: paint-ins not started yet are called off (a finished paint is stripped by dailyPaint). */
export function cancelPaintFor(g: GameState, c: Contract): void {
  for (const id of Object.values(c.paint?.inMx ?? {})) {
    const m = g.maintenance[id];
    if (m) dropPaint(g, m);
  }
}

/** 'maint.end' of a paint event: cost posted, the livery swapped, the client's share invoiced. */
export function onPaintEnd(g: GameState, m: MaintenanceEvent): void {
  post(g, 'paint', -m.cost);
  const ac = g.fleet[m.aircraftId];
  const c = m.paint ? g.contracts[m.paint.contractId] : undefined;
  if (!ac || !c?.paint || !m.paint) return;
  const t = c.paint;
  const cl = g.clients[c.clientId];
  const client = cl?.name ?? 'The client';
  if (m.paint.phase === 'in') {
    ac.paintedFor = c.id;
    const live = c.status === 'signed' || c.status === 'active';
    const amount = live ? Math.round(m.cost * t.clientShare) : 0;
    if (amount > 0) invoice(g, { clientId: c.clientId, contractId: c.id, desc: `Paint: ${ac.reg} in ${client} colours`, amount, cat: 'otherRevenue', dueDays: c.payment.dueDays });
    pushMessage(g, {
      tone: 'good', cat: 'tech', title: `${ac.reg} now flies in ${client} colours`,
      body: `Out of the paint shop at ${city(m.at)}. ${amount > 0 ? `${client} invoiced ${usd(amount)}.` : live ? `At our cost (${usd(m.cost)}).` : `${c.title} is cancelled: it goes ${homeLook(g, ac).to} at the first slot.`}`,
      ref: { kind: 'aircraft', id: ac.id },
    });
    return;
  }
  if (ac.paintedFor === c.id) delete ac.paintedFor;
  // The client pays its share of the strip only for a contract that ran its course.
  const amount = c.status === 'completed' ? Math.round(m.cost * t.clientShare) : 0;
  if (amount > 0) invoice(g, { clientId: c.clientId, contractId: c.id, desc: `Repaint after ${c.title}: ${ac.reg}`, amount, cat: 'otherRevenue', dueDays: c.payment.dueDays });
  pushMessage(g, {
    tone: 'info', cat: 'tech', title: `${ac.reg} ${homeLook(g, ac).in}`,
    body: `Repaint done at ${city(m.at)}. ${usd(m.cost)}${amount > 0 ? `; ${client} invoiced ${usd(amount)}` : ''}.`,
    ref: { kind: 'aircraft', id: ac.id },
  });
}

const liveMx = (g: GameState, id: string | undefined) => {
  const m = id ? g.maintenance[id] : undefined;
  return !!m && (m.status === 'planned' || m.status === 'inWork');
};

/** When the aircraft's last leg for the contract lands (or now). */
function lastArrivalFor(g: GameState, c: Contract, aircraftId: string): Minute {
  let last = g.now;
  for (const f of flightsOf(g, aircraftId)) if (f.contractId === c.id && (f.status === 'scheduled' || f.status === 'enroute')) last = Math.max(last, f.eta ?? f.sta);
  return last;
}

/**
 * Daily: aircraft still in the colours of a finished or cancelled contract get their strip booked at the first gap
 * within 30 days (warned once when none); a missed paint-in is re-booked while it can still end before the job.
 */
export function dailyPaint(g: GameState): void {
  for (const c of Object.values(g.contracts)) {
    const t = c.paint;
    if (!t?.accepted) continue;
    const done = c.status === 'completed' || c.status === 'cancelled';
    for (const acId of c.aircraftIds) {
      const ac = g.fleet[acId];
      if (!ac || ac.status === 'stored' || ac.status === 'leasedOut') continue;
      if (done) {
        if (ac.paintedFor !== c.id || liveMx(g, t.outMx?.[acId])) continue;
        // A new client's paint-in already booked paints over it.
        if (Object.values(g.maintenance).some((m) => m.aircraftId === acId && m.paint?.phase === 'in' && m.status === 'planned')) continue;
        const after = Math.max(lastArrivalFor(g, c, acId), g.now + BAL.ferryLeadMin);
        const slot = paintWindow(g, acId, { days: t.stripDays }, after + (BAL.paint.stripWithinDays + t.stripDays) * DAY, after);
        if (slot && !bookPaint(g, c, acId, 'out', slot)) continue;
        if (!t.warned) {
          t.warned = true;
          pushMessage(g, { tone: 'warn', cat: 'tech', title: `${ac.reg} still wears ${g.clients[c.clientId]?.name ?? 'client'} colours`, body: 'No paint-shop slot within 30 days; it flies in their livery until one opens.', ref: { kind: 'aircraft', id: acId } });
        }
      } else if (ac.paintedFor !== c.id && t.inMx?.[acId] && !liveMx(g, t.inMx[acId]) && g.maintenance[t.inMx[acId]]?.status === 'cancelled') {
        // Missed paint-in: one more try while the job hasn't started.
        const first = flightsOf(g, acId).find((f) => f.contractId === c.id && f.status === 'scheduled' && f.kind !== 'positioning');
        if (!first || first.std <= g.now + DAY) continue;
        const slot = paintWindow(g, acId, { days: t.days }, first.std, undefined, { nextAt: first.from });
        if (slot) bookPaint(g, c, acId, 'in', slot);
      }
    }
  }
}
