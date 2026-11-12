// v0.18 the aircraft spec sheet's content (ui/specs/SpecSheet.tsx draws it): the airframe (ours, an offer, or just
// a type), its key figures, the money and terms, and how it fits our network. Reads the game; changes nothing.

import { ACMI_TYPES, artFor, type AcmiType, type CabinPreset } from '../../data/acmiTypes';
import { AIRCRAFT_BY_ID, type AircraftType } from '../../data/aircraft';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { cabinPresets } from '../../data/cabins';
import { CLIENT_LIVERIES } from '../../data/clientLiveries';
import { LESSOR_BY_ID } from '../../data/lessors';
import { MARKET_LIVERY } from '../../data/livery';
import { TYPE_SPECS } from '../../data/specs';
import { enginesOf, variantOf } from '../../data/variants';
import { BAL } from '../../engine/core/balance';
import { hashUnit } from '../../engine/core/util';
import { cabinMinimum, etopsCap, etopsNeeded, planSector, rangeFromNm, runwayFit, typeOf } from '../../engine/core/perf';
import { DAY, fmtDate, yearOf } from '../../engine/core/time';
import type { AcRest, Cabin, GameState, Livery } from '../../engine/core/types';
import { restOf, restOfAc, restShort } from '../../engine/crew';
import { gradeWords, inductionPlan, loiQuote, rating, usesLoi } from '../../engine/leasing';
import { leaseView, marketView } from '../../engine/ops';
import { insuranceOf } from '../../engine/ops/finance';
import { recipeLivery } from '../../engine/ops/paint';
import { mapLivery } from '../map/mapLogic';
import { money } from '../format';
import { lessorLabel, offerReadyLine, offerTermsLine, sourceBadge, tName } from '../screens/market/marketLogic';

export type SpecSubject =
  | { kind: 'aircraft'; id: string }
  | { kind: 'offer'; id: string }
  | { kind: 'type'; typeId: string; cabin?: Cabin; variant?: string };

export interface SpecArt { typeId: string; livery: Livery; code?: string; name?: string; reg?: string; acName?: string }

export interface SpecData {
  subject: SpecSubject;
  typeId: string;
  variant?: string;
  t: AcmiType;
  cat?: AircraftType;
  title: string;
  sub: string;
  badge?: { label: string; tone: string };
  art: SpecArt;
  artNote?: string;
  facts: [string, string][];
  cabin: Cabin | null;
  presets: CabinPreset[];
  rest: AcRest | null;
  restSeats: number;
  bunks: boolean;
  builtYear: number | null;
  money: [string, string][];
  lessor: { name: string; note?: string; stance: string } | null;
  ops: [string, string][];
  fit: FitView | null;
  etops: string;
}

export interface FitView { summary: string; lines: { tone: 'good' | 'warn' | 'bad'; text: string }[] }

const city = (c: string) => AIRPORT_BY_CODE[c]?.city ?? c;

// ---------- line numbers ----------

/** Production line (Airbus MSN, Boeing line number) by year, from real deliveries (Euro Atlantic: A330 MSN 489 in 2002, MSN 1229 in 2011; 767 line 889 in 2002). */
const LINE: Record<string, [number, number][]> = {
  A320: [[1988, 1], [1995, 550], [2000, 1150], [2005, 2550], [2008, 3650], [2010, 4300], [2012, 5300], [2014, 6300], [2016, 7300], [2018, 8600], [2020, 9800], [2022, 11000], [2024, 12400], [2027, 14400]],
  'A330/340': [[1993, 1], [1998, 230], [2002, 489], [2005, 700], [2008, 950], [2011, 1229], [2014, 1550], [2017, 1800], [2020, 1980], [2024, 2120], [2027, 2240]],
  A350: [[2014, 1], [2016, 60], [2018, 250], [2020, 420], [2022, 540], [2024, 700], [2027, 960]],
  A380: [[2007, 1], [2009, 30], [2011, 80], [2013, 140], [2015, 200], [2017, 240], [2019, 260], [2021, 272]],
  B737: [[1998, 1], [2000, 500], [2003, 1300], [2005, 1800], [2008, 2750], [2010, 3300], [2012, 4100], [2014, 5050], [2016, 6050], [2018, 7050], [2020, 7600]],
  'B757/767': [[1982, 1], [1988, 200], [1995, 580], [2002, 889], [2005, 940], [2010, 990], [2014, 1070]],
  B777: [[1995, 1], [1998, 150], [2001, 350], [2004, 480], [2008, 700], [2011, 950], [2014, 1250], [2017, 1500], [2020, 1650], [2023, 1800], [2027, 2000]],
  B787: [[2011, 1], [2013, 120], [2015, 350], [2017, 600], [2019, 900], [2021, 1000], [2024, 1200], [2027, 1500]],
  B747: [[1970, 1], [1975, 250], [1980, 450], [1985, 600], [1990, 800], [1995, 1050], [2000, 1250], [2005, 1360], [2010, 1420], [2015, 1520], [2020, 1560], [2023, 1574]],
};
const LINE757: [number, number][] = [[1983, 1], [1990, 300], [1995, 650], [2000, 880], [2005, 1050]];

/** A plausible line number for an airframe built in `year` (stable per airframe). Pure. */
export function lineNumber(typeId: string, year: number, seed: string): { label: string; n: number } {
  const t = ACMI_TYPES[typeId];
  const tab = typeId.startsWith('b75') ? LINE757 : LINE[t?.family ?? 'A320'] ?? LINE.A320;
  const at = (y: number) => {
    if (y <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      const [y1, n1] = tab[i];
      const [y0, n0] = tab[i - 1];
      if (y <= y1) return n0 + ((n1 - n0) * (y - y0)) / (y1 - y0);
    }
    return tab[tab.length - 1][1];
  };
  const a = at(year);
  const b = at(year + 1);
  const n = Math.max(1, Math.round(a + (b - a) * hashUnit(`line:${seed}`)));
  return { label: t?.name.startsWith('Airbus') ? 'MSN' : 'Line no.', n };
}

// ---------- the network fit ----------

/** The routes we fly or have signed (upcoming flights of our contracts), at most 40 distinct ones. */
export function ourRoutes(g: GameState): [string, string][] {
  const seen = new Set<string>();
  const out: [string, string][] = [];
  for (const f of Object.values(g.flights)) {
    if (f.status !== 'scheduled' || !f.contractId || f.from === f.to) continue;
    const k = `${f.from}-${f.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([f.from, f.to]);
    if (out.length >= 40) break;
  }
  return out;
}

/** Which of our routes the type flies nonstop, with a fuel stop, or not (runway, ETOPS on our approval). Pure. */
export function fitOf(g: GameState, typeId: string): FitView | null {
  const routes = ourRoutes(g);
  if (!routes.length) return null;
  const cap = etopsCap(g.company.approvals, typeId);
  let nonstop = 0;
  const stops: string[] = [];
  const runway = new Set<string>();
  const etops: string[] = [];
  for (const [a, b] of routes) {
    if (runwayFit(typeId, a) === 'no' || runwayFit(typeId, b) === 'no') {
      if (runwayFit(typeId, a) === 'no') runway.add(a);
      if (runwayFit(typeId, b) === 'no') runway.add(b);
      continue;
    }
    const p = planSector(typeId, a, b);
    const need = typeOf(typeId).engines === 2 ? etopsNeeded(typeId, a, b) : 0;
    if (need > (cap === Infinity ? 999 : cap)) etops.push(`${a}–${b} (${need} min)`);
    if (p.ok && !p.techStops.length) nonstop++;
    else if (p.ok) stops.push(`${a}–${b} via ${p.techStops.join(', ')}`);
    else stops.push(`${a}–${b}: out of range`);
  }
  const lines: FitView['lines'] = [];
  lines.push({ tone: nonstop === routes.length ? 'good' : nonstop ? 'warn' : 'bad', text: `Nonstop on ${nonstop} of our ${routes.length} routes` });
  if (stops.length) lines.push({ tone: 'warn', text: `Fuel stop: ${stops.slice(0, 3).join(' · ')}${stops.length > 3 ? ` · ${stops.length - 3} more` : ''}` });
  if (runway.size) lines.push({ tone: 'bad', text: `Runway too short: ${[...runway].slice(0, 4).map(city).join(', ')}` });
  if (etops.length) lines.push({ tone: 'bad', text: `ETOPS beyond our approval: ${etops.slice(0, 3).join(' · ')}` });
  const summary = `${nonstop}/${routes.length} nonstop`;
  return { summary, lines };
}

// ---------- operating cost ----------

/** Cost per block hour of flying it (fuel at today's price, maintenance at its age, reserves, rent and insurance at 300 BH a month). */
export function opCost(g: GameState, typeId: string, builtYear: number, rent: number | null, reservesFH: number | null): { rows: [string, string][]; total: number } {
  const t = typeOf(typeId);
  const age = Math.max(0, yearOf(g.now) - builtYear);
  const fuel = t.fuelTBH * g.market.fuelPrice;
  const maint = t.maintBH * (1 + BAL.maintAgeFactor * Math.max(0, age - 12));
  const res = reservesFH ? reservesFH * 0.88 : 0;
  const bh = 300;
  const fixed = ((rent ?? 0) + insuranceOf(g, { typeId, builtYear })) / bh;
  const rows: [string, string][] = [
    ['Fuel', `${money(fuel)}/BH (${t.fuelTBH} t at ${money(g.market.fuelPrice)}/t)`],
    ['Maintenance', `${money(Math.max(0, maint - res))}/BH${res ? ` + reserves ${money(res)}` : ''}`],
    [rent ? 'Rent and insurance' : 'Insurance', `${money(fixed)}/BH at ${bh} BH a month`],
  ];
  const total = fuel + Math.max(maint, res) + fixed;
  rows.push(['Clients pay', `about ${money(t.rateBH)}/BH wet (ACMI, client's fuel)`]);
  return { rows, total };
}

// ---------- the subject ----------

const exLivery = (name?: string): Livery | null => {
  const r = name ? CLIENT_LIVERIES[name] : undefined;
  return r ? recipeLivery(r, 'full') : null;
};

export function specData(g: GameState, subject: SpecSubject): SpecData | null {
  const now = g.now;
  const yr = yearOf(now);
  if (subject.kind === 'aircraft') {
    const ac = g.fleet[subject.id];
    if (!ac) return null;
    const t = typeOf(ac.typeId);
    const lv = mapLivery(g, ac);
    const ln = lineNumber(ac.typeId, ac.builtYear, ac.id);
    const ex = ac.delivery?.where?.match(/ex-([^,]+)/)?.[1];
    const o = ac.ownership;
    const lease = leaseView(g, ac.id);
    const facts: [string, string][] = [
      [ln.label, String(ln.n)],
      ['Built', `${ac.builtYear} · ${yr - ac.builtYear} years`],
      ...(ex ? [['Before us', ex] as [string, string]] : []),
      ['With us since', fmtDate(ac.deliveredAt)],
      ['Now', ac.status === 'delivering' ? 'In transition, not yet with us' : `${ac.status === 'flying' ? 'Flying from' : 'At'} ${city(ac.at)}`],
      ['Hours / cycles', `${Math.round(ac.hours).toLocaleString('en-US')} FH / ${Math.round(ac.cycles).toLocaleString('en-US')}`],
    ];
    const rest = restOf(g, ac.id);
    const restSeats = (ac.rest?.fc?.kind === 'recliners' ? ac.rest.fc.places : 0) + (ac.rest?.cc?.kind === 'recliners' ? ac.rest.cc.places : 0);
    const moneyRows: [string, string][] = o.kind === 'owned'
      ? [['Owned', `book value ${money(o.bookValue)}`]]
      : [['Rent', `${money(o.rentPerMonth)} a month`], ['Lessor', o.lessor], ['Lease ends', fmtDate(o.leaseEnd)], ['Reserves', `$${o.reservesPerFH.toLocaleString('en-US')} per FH`],
        ...(o.deposit ? [['Deposit held', money(o.deposit)] as [string, string]] : []), ...(lease ? [['Return', `at ${city(lease.returnSite)}`] as [string, string]] : [])];
    const oc = opCost(g, ac.typeId, ac.builtYear, o.kind === 'dryLeaseIn' ? o.rentPerMonth : null, o.kind === 'dryLeaseIn' ? o.reservesPerFH : null);
    return {
      subject, typeId: ac.typeId, variant: ac.variant, t, cat: AIRCRAFT_BY_ID[t.catalog ?? ac.typeId],
      title: ac.reg, sub: `${t.name}${variantOf(ac.typeId, ac.variant) ? ` · ${variantOf(ac.typeId, ac.variant)!.label}` : ''}${ac.name ? ` · ${ac.name}` : ''}`,
      art: { typeId: artFor(ac.typeId, ac.variant), livery: lv.livery, code: lv.code, name: lv.name, reg: ac.reg, acName: ac.name },
      facts, cabin: ac.cabin, presets: cabinPresets(ac.typeId), rest, restSeats, bunks: rest.fc?.cls === 1 || rest.cc?.cls === 1, builtYear: ac.builtYear,
      money: [...moneyRows, ['Running cost', `about ${money(oc.total)} a block hour`]], lessor: o.kind === 'dryLeaseIn' ? lessorOf(g, o.lessorId ?? null, o.lessor) : null,
      ops: oc.rows, fit: fitOf(g, ac.typeId), etops: ac.etops ? `${ac.etops} min (this airframe)` : 'Not ETOPS',
    };
  }
  if (subject.kind === 'offer') {
    const v = marketView(g).find((x) => x.offer.id === subject.id);
    if (!v) return null;
    const o = v.offer;
    const t = typeOf(o.typeId);
    const loi = usesLoi(g, o);
    const q = loi ? loiQuote(g, o.id) : null;
    const ready = q ? q.ready : o.source ? inductionPlan(g, o).ready : v.quote.handover;
    const ferry = v.quote.legs.length ? v.quote.homeBy - v.quote.handover : 0;
    const ln = lineNumber(o.typeId, o.builtYear, o.id);
    const prev = o.spot?.airline ?? o.batchOf ?? o.exOperator;
    const exl = exLivery(prev);
    const facts: [string, string][] = [
      [ln.label, String(ln.n)],
      ['Built', `${o.builtYear} · ${yr - o.builtYear} years`],
      ...(prev ? [['Before', prev] as [string, string]] : []),
      ['Where', o.where ?? city(o.site ?? g.company.homeBase)],
      ['Ready', offerReadyLine(now, o, ready, ferry > 0 ? ready + ferry : null)],
      ['Offer open', `${v.daysLeft} more day${v.daysLeft === 1 ? '' : 's'}`],
    ];
    const lease = o.kind === 'dryLeaseIn';
    const moneyRows: [string, string][] = lease
      ? [
        ['Rent', `${money(o.rentPerMonth)} a month · ${o.leaseMonths} months`],
        ['Deposit', q ? `${money(q.holding)} with the letter of intent · ${money(q.depositAtSign)} at signing` : money(o.deposit)],
        ['Reserves', q ? q.reserves : `$${o.reservesPerFH.toLocaleString('en-US')} per FH`],
        ...(o.reservesDeposit ? [['Reserves up front', `${money(o.reservesDeposit)}, back at return`] as [string, string]] : []),
        ...(o.transition ? [['Transition', `${money(o.transition)} at signing`] as [string, string]] : []),
        ['Return', v.returnText ?? q?.ret ?? '—'],
      ]
      : [['Price', money(o.price)], ...(o.transition ? [['Transition', `${money(o.transition)} at signing`] as [string, string]] : [])];
    const oc = opCost(g, o.typeId, o.builtYear, lease ? o.rentPerMonth : null, lease ? o.reservesPerFH : null);
    const rest = restOfAc(o);
    const restSeats = (o.rest?.fc?.kind === 'recliners' ? o.rest.fc.places : 0) + (o.rest?.cc?.kind === 'recliners' ? o.rest.cc.places : 0);
    return {
      subject, typeId: o.typeId, variant: o.variant, t, cat: AIRCRAFT_BY_ID[t.catalog ?? o.typeId],
      title: `Offered: ${tName(o.typeId)}, ${o.builtYear}`, sub: `${t.name}${variantOf(o.typeId, o.variant) ? ` · ${variantOf(o.typeId, o.variant)!.label}` : ''} · ${lessorLabel(o).name}`,
      badge: sourceBadge(o),
      art: { typeId: artFor(o.typeId, o.variant), livery: exl ?? MARKET_LIVERY, ...(exl ? { name: CLIENT_LIVERIES[prev!]?.titles[0] } : {}) },
      artNote: exl ? `Still in ${prev} colours` : 'White, as lessors hand them over',
      facts, cabin: o.cabin, presets: cabinPresets(o.typeId), rest, restSeats, bunks: rest.fc?.cls === 1 || rest.cc?.cls === 1, builtYear: o.builtYear,
      money: [...moneyRows, ['Terms', offerTermsLine(o)], ['Running cost', `about ${money(oc.total)} a block hour`]],
      lessor: lessorOf(g, o.lessorId ?? null, o.lessor), ops: oc.rows, fit: fitOf(g, o.typeId),
      etops: t.engines === 4 ? 'Not needed (four engines)' : t.etopsMax ? `Up to ${t.etopsMax} min for the type` : 'Not ETOPS capable',
    };
  }
  const t = ACMI_TYPES[subject.typeId];
  if (!t) return null;
  const cab = subject.cabin ?? (() => { const p = cabinPresets(t.id)[0]; return { j: p.j, w: p.w, y: p.y, total: p.j + p.w + p.y, label: p.label, layout: p.layout }; })();
  const builtYear = Math.max(t.firstYear ?? yr - 12, Math.min(t.lastYear ?? yr, yr - 12));
  const oc = opCost(g, t.id, builtYear, t.rentMonth, null);
  return {
    subject, typeId: t.id, variant: subject.variant, t, cat: AIRCRAFT_BY_ID[t.catalog ?? t.id],
    title: t.name.replace(/^(Airbus|Boeing) /, ''), sub: `${t.name} · ${t.family === 'A320' || t.family === 'B737' ? 'narrowbody' : t.body === 'wide' ? 'widebody' : 'narrowbody'}`,
    art: { typeId: artFor(t.id, subject.variant), livery: MARKET_LIVERY },
    facts: [['Built', `${t.firstYear ?? '—'}–${t.lastYear ?? 'today'}`], ['Market', t.newOnly ? 'New builds only' : t.scarcity >= 0.7 ? 'Rare' : t.scarcity >= 0.4 ? 'Tight' : 'Plenty about']],
    cabin: cab, presets: cabinPresets(t.id), rest: null, restSeats: 0, bunks: false, builtYear: null,
    money: [['Rent', `about ${money(t.rentMonth)} a month (12 years old)`], ['Value', `about ${money(t.valueUsed)} (12 years old)`], ['Running cost', `about ${money(oc.total)} a block hour`]],
    lessor: null, ops: oc.rows, fit: fitOf(g, t.id),
    etops: t.engines === 4 ? 'Not needed (four engines)' : t.etopsMax ? `Up to ${t.etopsMax} min for the type` : 'Not ETOPS capable',
  };
}

function lessorOf(g: GameState, id: string | null, name: string): SpecData['lessor'] {
  const def = id ? LESSOR_BY_ID[id as keyof typeof LESSOR_BY_ID] : undefined;
  const r = g.leasing ? rating(g) : null;
  return { name: def?.name ?? name.replace(/ \(used sale\)$/, ''), note: def?.note, stance: r ? `Our lessor rating ${r.grade}: ${gradeWords(r.grade)}` : 'No lessor rating yet' };
}

// ---------- key figures ----------

export interface KeyFig { k: string; label: string; value: string; sub?: string }

/** Engine makers named before a model ('Rolls-Royce RB211-535'); 'GE90', 'GEnx' and 'CFM56' are model names and stay. */
const MAKERS = ['Rolls-Royce', 'Pratt & Whitney', 'Engine Alliance', 'IAE', 'GE', 'CFM'];

/**
 * v0.23 the Engines tile: the models as the value ('2 × RB211-535 or PW2000'), their makers and the thrust under it
 * ('Rolls-Royce / Pratt & Whitney · 178–185 kN each'), so a long engine line no longer makes one tile tower over the
 * rest (it wrapped to five lines). Nothing is left out. Pure.
 */
export function engineFig(n: number, engines: string, thrust?: string): KeyFig {
  const makers: string[] = [];
  let models = engines.replace(/ \(four\)$/, '');
  for (const m of MAKERS) {
    const re = new RegExp(`(^|, | or )${m.replace(/[&]/g, '\\$&')} (?=\\S)`, 'g');
    if (re.test(models)) {
      makers.push(m);
      models = models.replace(re, '$1');
    }
  }
  // In the order they are named.
  makers.sort((a, b) => engines.indexOf(a) - engines.indexOf(b));
  const sub = [makers.join(' / '), thrust].filter(Boolean).join(' · ');
  return { k: 'engines', label: 'Engines', value: `${n} × ${models}`, sub: sub || undefined };
}

/** v0.23 a rest facility as a tile: 'Economy seats' with 'class 3' under it (it was one long line, 'economy seats (class 3)'). Pure. */
export function restFig(k: 'fc' | 'cc', label: string, r: Parameters<typeof restShort>[0]): KeyFig {
  const words = restShort(r);
  const m = /^(.*) \((class \d)\)$/.exec(words);
  const v = m ? m[1] : words;
  return { k, label, value: v.charAt(0).toUpperCase() + v.slice(1), sub: m ? m[2] : r ? `class ${r.cls}` : undefined };
}

/** The icon row: the type's figures and this airframe's own. Pure. */
export function keyFigures(g: GameState, d: SpecData): KeyFig[] {
  const t = d.t;
  const c = d.cat;
  const sp = TYPE_SPECS[t.id];
  const km = Math.round((t.rangeNm * 1.852) / 10) * 10;
  const home = g.company.homeBase;
  const fromHome = Math.round(rangeFromNm(t.id, home) * 1.852 / 10) * 10;
  const out: KeyFig[] = [
    { k: 'range', label: 'Range, full payload', value: `${km.toLocaleString('en-US')} km`, sub: `${t.rangeNm.toLocaleString('en-US')} nm${fromHome < km * 0.95 ? ` · ${fromHome.toLocaleString('en-US')} km from ${city(home)}` : ''}` },
    { k: 'cruise', label: 'Cruise', value: `${Math.round(t.cruiseKt * 1.852)} km/h`, sub: `${t.cruiseKt} kt` },
    ...(c ? [{ k: 'mtow', label: 'Max take-off weight', value: `${Math.round(c.mtow * 1000).toLocaleString('en-US')} kg`, sub: sp ? `landing ${sp.mlwKg.toLocaleString('en-US')} kg` : undefined }] : []),
    ...(sp ? [{ k: 'cargo', label: 'Cargo hold', value: `${sp.cargoM3} m³`, sub: `${Math.round(sp.cargoM3 * 35.315).toLocaleString('en-US')} cu ft` }] : []),
    engineFig(t.engines, enginesOf(t.id, d.variant), sp ? `${sp.thrustKN[0] === sp.thrustKN[1] ? sp.thrustKN[0] : `${sp.thrustKN[0]}–${sp.thrustKN[1]}`} kN each` : undefined),
    ...(sp ? [{ k: 'fuel', label: 'Fuel', value: `${sp.fuelL.toLocaleString('en-US')} L`, sub: `${t.fuelTBH} t a block hour` }] : []),
    { k: 'etops', label: 'ETOPS', value: d.etops.replace(/ \(this airframe\)$/, ''), sub: d.etops.includes('airframe') ? 'this airframe' : undefined },
    { k: 'runway', label: 'Runway', value: `${t.minRunwayM.toLocaleString('en-US')} m`, sub: 'at full payload, sea level' },
    ...(sp ? [{ k: 'noise', label: 'Noise', value: `Chapter ${sp.noise}`, sub: sp.noise === 3 ? 'curfews and fees bite' : sp.noise === 14 ? 'quietest class' : undefined }] : []),
  ];
  return out;
}

/** The cabin row of figures: seats per class, crew rest, IFE, power, cabin crew. Pure. */
export function cabinFigures(d: SpecData, cab: Cabin | CabinPreset): KeyFig[] {
  const t = d.t;
  const sp = TYPE_SPECS[t.id];
  const total = cab.j + cab.w + cab.y;
  const out: KeyFig[] = [];
  if (cab.j) out.push({ k: 'j', label: 'Business', value: String(cab.j) });
  if (cab.w) out.push({ k: 'w', label: 'Premium economy', value: String(cab.w) });
  if (cab.y) out.push({ k: 'y', label: 'Economy', value: String(cab.y) });
  if (d.rest) {
    // v0.22 the class is named once; v0.23 under the words ('Economy seats' / 'class 3'), so the tile stays short.
    out.push(restFig('fc', 'Pilots rest', d.rest.fc));
    out.push(restFig('cc', 'Cabin crew rest', d.rest.cc));
  } else if (t.body === 'wide') {
    out.push({ k: 'fc', label: 'Crew bunks', value: t.rest.bunkShare >= 0.95 ? 'On every airframe' : t.rest.bunkShare > 0 ? `On ${Math.round(t.rest.bunkShare * 100)} % of airframes` : 'None', sub: 'class 1 rest' });
  }
  if (sp) {
    out.push({ k: 'ife', label: 'IFE', value: sp.ife === 'avod' ? 'Seat-back AVOD' : sp.ife === 'byod' ? 'Streamed to phones' : 'None', sub: sp.ife === 'byod' ? 'own devices, Wi-Fi' : undefined });
    out.push({ k: 'power', label: 'Power', value: sp.power === 'ac' ? 'AC + USB' : sp.power === 'usb' ? 'USB' : 'None', sub: sp.wifi ? 'Wi-Fi fitted' : 'no Wi-Fi' });
  }
  out.push({ k: 'crew', label: 'Cabin crew', value: `${cabinMinimum(t.id, total)} minimum`, sub: `typical ${t.cabinTypical} · ${t.cockpitMin} pilots${t.body === 'wide' ? ', 3–4 on long days' : ''}` });
  return out;
}

/** The cities of the range discs: our home base, then London, New York, Dubai, Singapore (Beijing for a repeat). */
export function discCities(g: GameState): string[] {
  const out = [g.company.homeBase];
  for (const c of ['LHR', 'JFK', 'DXB', 'SIN', 'PEK']) {
    if (out.length >= 5) break;
    if (AIRPORT_BY_CODE[c] && !out.includes(c) && city(c) !== city(out[0])) out.push(c);
  }
  return out;
}

export const daysTo = (now: number, t: number) => Math.max(0, Math.ceil((t - now) / DAY));
