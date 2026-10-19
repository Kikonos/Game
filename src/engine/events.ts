// Market events: real-world scheduled events, random shocks and decisions.

import { AIRCRAFT, AIRCRAFT_BY_ID } from '../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS } from '../data/airports';
import { AI_AIRLINES, LESSORS } from '../data/flavor';
import { CONTINENT_ORDER, CONTINENTS, type ContinentId, REGION_BY_ID } from '../data/regions';
import { MATCH_FLOOR, baseCompetition, competition, fareRatio, routeFlightCost, routeSupply } from './demand';
import { usedLeaseRate, ageYears } from './economy';
import * as R from './rng';
import { alert, destinationsServed, isAirportUnlocked, isHub, message, newId, spend } from './state';
import type { Difficulty, GameState, Modifier, ModScope, PendingDecision, Route } from './types';
import { dateToDay, dayToDate, formatDate, pairKey, yearOf } from './util';
import { distance } from './geo';

// ---------- scheduled real-world events ----------

interface Scheduled {
  id: string;
  title: string;
  body: string;
  start: number;
  end: number;
  scope: ModScope;
  targets: string[];
  mult: number;
}

const WC26 = ['JFK', 'EWR', 'LGA', 'BOS', 'PHL', 'ATL', 'MIA', 'FLL', 'DFW', 'IAH', 'MCI', 'SEA', 'SFO', 'SJC', 'LAX', 'YYZ', 'YVR', 'MEX', 'GDL', 'MTY'];
const WC30 = ['MAD', 'BCN', 'SVQ', 'AGP', 'BIO', 'VLC', 'LIS', 'OPO', 'CMN', 'RAK', 'AGA'];
const EURO28 = ['LHR', 'LGW', 'STN', 'MAN', 'BHX', 'NCL', 'GLA', 'EDI', 'DUB', 'BFS'];

function oneOffEvents(): Scheduled[] {
  const d = dateToDay;
  return [
    { id: 'wo26', title: 'Winter Olympics: Milano Cortina 2026', body: 'The Winter Games bring a surge of visitors to northern Italy.', start: d(2026, 2, 1), end: d(2026, 2, 23), scope: 'airport', targets: ['MXP', 'LIN', 'VCE', 'BLQ', 'INN'], mult: 1.35 },
    { id: 'wc26', title: 'FIFA World Cup 2026', body: 'Forty-eight nations, sixteen host cities across the USA, Canada and Mexico. Demand to host cities is soaring.', start: d(2026, 6, 5), end: d(2026, 7, 20), scope: 'airport', targets: WC26, mult: 1.3 },
    { id: 'cg26', title: 'Commonwealth Games: Glasgow 2026', body: 'Athletes and fans descend on Glasgow.', start: d(2026, 7, 18), end: d(2026, 8, 3), scope: 'airport', targets: ['GLA', 'EDI'], mult: 1.3 },
    { id: 'ag26', title: 'Asian Games: Aichi-Nagoya 2026', body: 'Japan hosts the Asian Games — Nagoya is buzzing.', start: d(2026, 9, 15), end: d(2026, 10, 5), scope: 'airport', targets: ['NGO'], mult: 1.35 },
    { id: 'rwc27', title: 'Rugby World Cup 2027', body: 'Australia hosts the Rugby World Cup.', start: d(2027, 9, 28), end: d(2027, 11, 14), scope: 'country', targets: ['AU'], mult: 1.15 },
    { id: 'cwc27', title: 'Cricket World Cup 2027', body: 'Southern Africa hosts the ODI World Cup.', start: d(2027, 10, 5), end: d(2027, 11, 30), scope: 'airport', targets: ['JNB', 'CPT', 'DUR', 'HRE', 'WDH'], mult: 1.2 },
    { id: 'euro28', title: 'UEFA Euro 2028', body: 'The UK and Ireland host Europe’s biggest football tournament.', start: d(2028, 6, 5), end: d(2028, 7, 10), scope: 'airport', targets: EURO28, mult: 1.25 },
    { id: 'la28', title: 'Olympic Games: Los Angeles 2028', body: 'The Summer Olympics return to Los Angeles.', start: d(2028, 7, 8), end: d(2028, 8, 1), scope: 'airport', targets: ['LAX', 'SAN', 'SFO', 'LAS'], mult: 1.45 },
    { id: 'wo30', title: 'Winter Olympics: French Alps 2030', body: 'Skiers and fans head for the French Alps.', start: d(2030, 2, 1), end: d(2030, 2, 18), scope: 'airport', targets: ['LYS', 'GVA', 'NCE'], mult: 1.3 },
    { id: 'wc30', title: 'FIFA World Cup 2030', body: 'The centenary World Cup is hosted by Spain, Portugal and Morocco.', start: d(2030, 6, 4), end: d(2030, 7, 22), scope: 'airport', targets: WC30, mult: 1.3 },
    { id: 'expo30', title: 'Expo 2030 Riyadh', body: 'The World Expo opens in Riyadh for six months.', start: d(2030, 10, 1), end: d(2031, 3, 31), scope: 'airport', targets: ['RUH'], mult: 1.3 },
    { id: 'bne32', title: 'Olympic Games: Brisbane 2032', body: 'The Summer Olympics come to Brisbane.', start: d(2032, 7, 18), end: d(2032, 8, 9), scope: 'airport', targets: ['BNE', 'OOL', 'SYD'], mult: 1.45 },
    { id: 'wo34', title: 'Winter Olympics: Salt Lake City 2034', body: 'Utah welcomes the Winter Games again.', start: d(2034, 2, 5), end: d(2034, 2, 26), scope: 'airport', targets: ['SLC', 'DEN'], mult: 1.35 },
    { id: 'wc34', title: 'FIFA World Cup 2034', body: 'Saudi Arabia hosts the World Cup.', start: d(2034, 11, 20), end: d(2034, 12, 22), scope: 'country', targets: ['SA'], mult: 1.4 },
  ];
}

const LNY = [[2026, 2, 17], [2027, 2, 6], [2028, 1, 26], [2029, 2, 13], [2030, 2, 3], [2031, 1, 23], [2032, 2, 11], [2033, 1, 31], [2034, 2, 19], [2035, 2, 8]];

function annualEvents(year: number): Scheduled[] {
  const d = dateToDay;
  const out: Scheduled[] = [];
  // Hajj moves ~11 days earlier each year.
  const hajj = d(year, 5, 25) - Math.round((year - 2026) * 10.88);
  out.push({ id: `hajj${year}`, title: `Hajj ${year}`, body: 'Millions of pilgrims travel to Mecca. Jeddah and Medina demand soars.', start: hajj - 18, end: hajj + 7, scope: 'airport', targets: ['JED', 'MED'], mult: 1.6 });
  const lny = LNY.find((x) => x[0] === year);
  const lnyDay = lny ? d(lny[0], lny[1], lny[2]) : d(year, 2, 5);
  out.push({ id: `lny${year}`, title: `Lunar New Year ${year}`, body: 'The world’s largest annual migration: Chunyun travel rush across East Asia.', start: lnyDay - 12, end: lnyDay + 10, scope: 'country', targets: ['CN', 'HK', 'TW', 'SG', 'MO', 'VN', 'KR'], mult: 1.3 });
  out.push({ id: `okt${year}`, title: `Oktoberfest ${year}`, body: 'Six million visitors head to Munich for beer and Bavarian festivities.', start: d(year, 9, 17), end: d(year, 10, 5), scope: 'airport', targets: ['MUC'], mult: 1.3 });
  out.push({ id: `carn${year}`, title: `Rio Carnival ${year}`, body: 'Samba season! Rio de Janeiro is the place to be.', start: d(year, 2, 8), end: d(year, 2, 22), scope: 'airport', targets: ['GIG', 'SDU', 'SSA'], mult: 1.35 });
  out.push({ id: `sakura${year}`, title: `Cherry Blossom Season ${year}`, body: 'Sakura season draws visitors to Japan.', start: d(year, 3, 22), end: d(year, 4, 12), scope: 'country', targets: ['JP'], mult: 1.15 });
  out.push({ id: `thanks${year}`, title: `US Thanksgiving ${year}`, body: 'The busiest travel week of the American year.', start: d(year, 11, 21), end: d(year, 11, 30), scope: 'country', targets: ['US'], mult: 1.15 });
  out.push({ id: `fringe${year}`, title: `Edinburgh Festival Fringe ${year}`, body: 'The world’s largest arts festival fills Edinburgh.', start: d(year, 8, 1), end: d(year, 8, 26), scope: 'airport', targets: ['EDI'], mult: 1.25 });
  out.push({ id: `diwali${year}`, title: `Diwali ${year}`, body: 'Families across India reunite for the festival of lights.', start: d(year, 10, 22), end: d(year, 11, 8), scope: 'country', targets: ['IN'], mult: 1.15 });
  return out;
}

export function scheduledFor(year: number): Scheduled[] {
  const oneOff = oneOffEvents().filter((e) => yearOf(e.start) === year);
  return [...oneOff, ...annualEvents(year)];
}

/** Adds a year's scheduled events as modifiers. */
export function scheduleYear(state: GameState, year: number) {
  for (const e of scheduledFor(year)) {
    if (state.modifiers.some((m) => m.id === e.id)) continue;
    state.modifiers.push({
      id: e.id, kind: 'demand', scope: e.scope, targets: e.targets, mult: e.mult,
      startDay: e.start, endDay: e.end, label: e.title,
    });
  }
}

/** Upcoming scheduled events for the calendar view. */
export function upcomingEvents(state: GameState, days = 400): (Scheduled & { live: boolean })[] {
  const y = yearOf(state.day);
  return [y, y + 1, y + 2]
    .flatMap(scheduledFor)
    .filter((e) => e.end >= state.day && e.start <= state.day + days)
    .sort((a, b) => a.start - b.start)
    .map((e) => ({ ...e, live: e.start <= state.day }));
}

function touchesNetwork(state: GameState, e: Scheduled): boolean {
  return destinationsServed(state).some((code) => {
    const a = AIRPORT_BY_CODE[code];
    const key = e.scope === 'airport' ? a.code : e.scope === 'country' ? a.country : e.scope === 'region' ? a.region : e.scope === 'continent' ? a.continent : '';
    return e.scope === 'global' || e.targets.includes(key);
  });
}

export function announceScheduled(state: GameState) {
  for (const e of scheduledFor(yearOf(state.day)).concat(scheduledFor(yearOf(state.day) + 1))) {
    if (e.start - 30 === state.day) {
      message(state, 'event', 'news', `Coming up: ${e.title}`, `${e.body} Starts ${formatDate(e.start)} — consider adding capacity.`);
    } else if (e.start === state.day) {
      const m = message(state, 'info', 'news', `${e.title} has begun`, e.body);
      // Only big events on the player's own network are worth slowing the clock for.
      if (e.mult >= 1.25 && touchesNetwork(state, e)) alert(state, 'event', m);
    }
  }
}

// ---------- random events ----------

function addMod(state: GameState, m: Omit<Modifier, 'id' | 'startDay'> & { startDay?: number }) {
  state.modifiers.push({ id: newId(state, 'x'), startDay: state.day, ...m });
}

function servedAirports(state: GameState): string[] {
  return destinationsServed(state);
}

function airlineFor(state: GameState, code: string) {
  const c = AIRPORT_BY_CODE[code].continent;
  const pool = AI_AIRLINES.filter((a) => a.continent === c);
  return R.pick(state, pool.length ? pool : AI_AIRLINES).name;
}

interface RandomEvent {
  id: string;
  weight: (s: GameState) => number;
  run: (s: GameState) => void;
}

const RANDOM_EVENTS: RandomEvent[] = [
  {
    id: 'fuel_spike', weight: () => 1,
    run: (s) => {
      const f = R.range(s, 1.15, 1.35);
      s.market.fuel = Math.min(1.9, s.market.fuel * f);
      message(s, 'bad', 'market', 'Jet fuel prices spike', `${R.pick(s, ['Refinery outages', 'Supply disruptions in the Gulf', 'An OPEC+ production cut', 'A cold snap driving heating oil demand'])} pushed jet fuel up ${Math.round((f - 1) * 100)}%. Consider fuel hedging.`);
    },
  },
  {
    id: 'fuel_drop', weight: () => 0.9,
    run: (s) => {
      const f = R.range(s, 0.8, 0.9);
      s.market.fuel = Math.max(0.35, s.market.fuel * f);
      message(s, 'good', 'market', 'Fuel prices tumble', `Oversupply sends jet fuel down ${Math.round((1 - f) * 100)}%. A good moment to lock in a hedge.`);
    },
  },
  {
    id: 'recession', weight: () => 0.35,
    run: (s) => {
      const c = R.pick(s, CONTINENT_ORDER);
      s.market.econ[c] = Math.max(0.75, s.market.econ[c] - R.range(s, 0.06, 0.1));
      addMod(s, { kind: 'demand', scope: 'continent', targets: [c], mult: 0.92, endDay: s.day + R.int(s, 120, 300), label: `${CONTINENTS[c].name} recession` });
      message(s, 'bad', 'market', `Recession hits ${CONTINENTS[c].name}`, 'Consumer confidence collapses and business travel budgets are cut. Expect weaker demand for several months.');
    },
  },
  {
    id: 'boom', weight: () => 0.45,
    run: (s) => {
      const c = R.pick(s, CONTINENT_ORDER);
      s.market.econ[c] = Math.min(1.25, s.market.econ[c] + R.range(s, 0.04, 0.08));
      message(s, 'good', 'market', `Economic boom in ${CONTINENTS[c].name}`, 'Strong growth and rising incomes are boosting travel demand.');
    },
  },
  {
    id: 'tourism_boom', weight: () => 1,
    run: (s) => {
      const a = R.pick(s, AIRPORTS.filter((x) => x.tour >= 0.75));
      addMod(s, { kind: 'demand', scope: 'airport', targets: [a.code], mult: R.range(s, 1.2, 1.4), endDay: s.day + R.int(s, 90, 240), label: `${a.city} tourism boom` });
      message(s, 'good', 'market', `${a.city} is trending`, `${R.pick(s, ['A viral travel video', 'A hit streaming series filmed on location', 'A glowing magazine feature', 'A new luxury resort opening'])} has put ${a.city} on every bucket list. Demand is up sharply for the next few months.`);
    },
  },
  {
    id: 'biz_boom', weight: () => 0.8,
    run: (s) => {
      const a = R.pick(s, AIRPORTS.filter((x) => x.biz >= 0.6));
      s.market.trend[a.code] = Math.min(1.45, (s.market.trend[a.code] ?? 1) + 0.12);
      message(s, 'good', 'market', `Business boom in ${a.city}`, `${R.pick(s, ['A tech giant opens a regional headquarters', 'A new financial district opens', 'A major trade agreement is signed', 'A huge infrastructure project gets under way'])} in ${a.city}. Long-term demand is up.`);
    },
  },
  {
    id: 'decline', weight: () => 0.6,
    run: (s) => {
      const a = R.pick(s, AIRPORTS.filter((x) => x.size >= 2));
      s.market.trend[a.code] = Math.max(0.7, (s.market.trend[a.code] ?? 1) - 0.1);
      message(s, 'warn', 'market', `Demand softens in ${a.city}`, `${R.pick(s, ['A major employer relocates', 'High-speed rail opens a competing link', 'Hotel shortages deter visitors', 'A new airport tax takes effect'])} — demand for ${a.city} is weakening.`);
    },
  },
  {
    id: 'strike', weight: (s) => (servedAirports(s).length ? 0.7 : 0),
    run: (s) => {
      const code = R.pick(s, servedAirports(s));
      const a = AIRPORT_BY_CODE[code];
      const days = R.int(s, 1, 3);
      addMod(s, { kind: 'capacity', scope: 'airport', targets: [code], mult: 0, endDay: s.day + days - 1, label: `${a.city} strike` });
      message(s, 'bad', 'ops', `Strike at ${a.city} (${code})`, `${R.pick(s, ['Air traffic controllers', 'Ground handlers', 'Security staff', 'Airport firefighters'])} walk out for ${days} day${days > 1 ? 's' : ''}. All flights to and from ${code} are cancelled.`);
    },
  },
  {
    id: 'weather', weight: (s) => (servedAirports(s).length ? 0.8 : 0),
    run: (s) => {
      const month = dayToDate(s.day).getUTCMonth();
      const served = servedAirports(s).map((c) => AIRPORT_BY_CODE[c]);
      const winter = month <= 1 || month === 11;
      const typhoon = month >= 6 && month <= 9;
      let pool = served;
      let kind = 'Severe thunderstorms';
      if (winter && served.some((a) => a.lat > 40)) { pool = served.filter((a) => a.lat > 40); kind = 'A heavy snowstorm'; }
      else if (typhoon && served.some((a) => a.continent === 'AS' && a.lat > 8)) { pool = served.filter((a) => a.continent === 'AS' && a.lat > 8); kind = 'A typhoon'; }
      else if (typhoon && served.some((a) => a.region === 'USSE' || a.region === 'MXC')) { pool = served.filter((a) => a.region === 'USSE' || a.region === 'MXC'); kind = 'A hurricane'; }
      const a = R.pick(s, pool);
      addMod(s, { kind: 'capacity', scope: 'airport', targets: [a.code], mult: 0.2, endDay: s.day + R.int(s, 0, 1), label: `${a.city} weather` });
      message(s, 'warn', 'ops', `${kind} hits ${a.city}`, `Most flights at ${a.code} are cancelled while the weather passes.`);
    },
  },
  {
    id: 'volcano', weight: (s) => (s.unlockedRegions.some((r) => r === 'NOR' || r === 'UKI') ? 0.08 : 0),
    run: (s) => {
      addMod(s, { kind: 'capacity', scope: 'region', targets: ['NOR', 'UKI'], mult: 0.3, endDay: s.day + R.int(s, 2, 5), label: 'Volcanic ash cloud' });
      message(s, 'bad', 'ops', 'Icelandic volcano erupts', 'An ash cloud drifts over Northern Europe. Airspace across the Nordics and the British Isles is largely closed.');
    },
  },
  {
    id: 'comp_entry', weight: (s) => (s.routes.some((r) => r.history.length > 4) ? 1.1 : 0),
    run: (s) => {
      const candidates = s.routes.filter((r) => {
        const w = r.history[r.history.length - 1];
        return w && w.seats > 0 && w.pax / w.seats > 0.8 && w.rev > w.cost * 1.2;
      });
      if (!candidates.length) return;
      const r = R.pick(s, candidates);
      const key = pairKey(r.from, r.to);
      const c = competition(s, r.from, r.to);
      const name = airlineFor(s, r.to);
      s.competition[key] = { level: c.level + R.range(s, 0.25, 0.55), priceIdx: c.priceIdx, name, lastMove: s.day };
      alert(s, 'competition', message(s, 'warn', 'market', `${name} attacks ${r.from}–${r.to}`, `Lured by strong loads, ${name} is launching daily flights on your ${r.from}–${r.to} route. Expect pressure on market share.`));
    },
  },
  {
    id: 'comp_exit', weight: (s) => (s.routes.length ? 0.6 : 0),
    run: (s) => {
      const r = R.pick(s, s.routes);
      const key = pairKey(r.from, r.to);
      const c = competition(s, r.from, r.to);
      if (c.level < 0.3) return;
      const name = c.name ?? airlineFor(s, r.to);
      s.competition[key] = { ...c, level: c.level * R.range(s, 0.5, 0.75) };
      message(s, 'good', 'market', `${name} cuts back on ${r.from}–${r.to}`, 'A competitor is reducing capacity on one of your routes. More passengers for you.');
    },
  },
  {
    id: 'price_war', weight: (s) => (s.routes.length >= 3 ? 0.5 : 0),
    run: (s) => {
      const r = R.pick(s, s.routes);
      const key = pairKey(r.from, r.to);
      const c = competition(s, r.from, r.to);
      const name = c.name ?? airlineFor(s, r.to);
      s.competition[key] = { ...c, priceIdx: R.range(s, 0.72, 0.85), name, lastMove: s.day };
      const m = message(s, 'warn', 'market', `Fare war on ${r.from}–${r.to}`, `${name} slashes fares on ${r.from}–${r.to}. Match them, or compete on quality and frequency.`);
      if (s.fleet.some((a) => a.assignments.some((x) => x.routeId === r.id && x.freq > 0))) alert(s, 'competition', m);
    },
  },
  {
    id: 'pilot_shortage', weight: () => 0.3,
    run: (s) => {
      addMod(s, { kind: 'crew', scope: 'global', targets: [], mult: 1.1, endDay: s.day + R.int(s, 120, 240), label: 'Pilot shortage' });
      message(s, 'bad', 'ops', 'Industry-wide pilot shortage', 'Airlines are bidding for crews. Crew costs rise 10% for several months.');
    },
  },
  {
    id: 'fee_hike', weight: (s) => (servedAirports(s).length ? 0.4 : 0),
    run: (s) => {
      const code = R.pick(s, servedAirports(s));
      s.feeMult[code] = Math.min(1.8, (s.feeMult[code] ?? 1) * 1.15);
      message(s, 'warn', 'finance', `${AIRPORT_BY_CODE[code].city} raises airport charges`, `Landing and passenger fees at ${code} rise 15% to fund a terminal expansion.`);
    },
  },
  {
    id: 'award', weight: (s) => (s.reputation > 68 && s.fleet.length > 3 ? 0.4 : 0),
    run: (s) => {
      s.reputation = Math.min(100, s.reputation + 3);
      const cat = R.pick(s, ['Best Regional Airline', 'Best Cabin Crew', 'Most Improved Airline', 'Best Economy Class', 'Best Airline Lounge', 'Best Value Airline']);
      message(s, 'good', 'news', `${s.airline.name} wins “${cat}”`, 'The Global Airline Awards jury praised your product. Reputation +3.');
    },
  },
  {
    id: 'health_scare', weight: () => 0.08,
    run: (s) => {
      const c = R.pick(s, CONTINENT_ORDER);
      addMod(s, { kind: 'demand', scope: 'continent', targets: [c], mult: 0.78, endDay: s.day + R.int(s, 45, 90), label: 'Health scare' });
      message(s, 'bad', 'news', `Health scare in ${CONTINENTS[c].name}`, 'A disease outbreak makes travellers nervous. Demand drops for a couple of months.');
    },
  },
  {
    id: 'aircraft_deal', weight: (s) => (s.fleet.length >= 2 ? 0.5 : 0),
    run: (s) => {
      const t = R.pick(s, AIRCRAFT.filter((x) => x.inProduction && x.minLevel <= s.level + 1 && x.body !== 'supersonic'));
      const discount = R.pick(s, [0.08, 0.1, 0.12, 0.15]);
      s.market.deals.push({ typeId: t.id, discount, until: s.day + 45 });
      message(s, 'good', 'market', `${t.manufacturer} offers ${Math.round(discount * 100)}% off the ${t.name}`, `A sales campaign gives you a ${Math.round(discount * 100)}% discount on new ${t.name} orders for the next 45 days.`);
    },
  },
  // ----- decisions -----
  {
    id: 'union_raise', weight: (s) => (s.fleet.length >= 4 ? 0.35 : 0),
    run: (s) => decide(s, 'union_raise', 'Cabin crew union demands a raise',
      'The cabin crew union is asking for a 6% pay increase, citing record workloads. Refusing could lead to industrial action.',
      [
        { id: 'accept', label: 'Accept the deal', desc: 'Crew costs +6% permanently. Reputation +1.' },
        { id: 'counter', label: 'Offer 3%', desc: 'Crew costs +3%. 30% chance of a one-day strike.' },
        { id: 'refuse', label: 'Refuse', desc: '55% chance of a two-day network-wide strike and reputation damage.' },
      ]),
  },
  {
    id: 'pr_crisis', weight: (s) => (s.stats.totalPax > 50_000 ? 0.4 : 0),
    run: (s) => decide(s, 'pr_crisis', 'A video goes viral', `A passenger’s video of ${R.pick(s, ['lost luggage piling up at the carousel', 'a rude gate agent', 'a broken seat on a long flight', 'a nine-hour delay with no food vouchers'])} has millions of views.`,
      [
        { id: 'compensate', label: 'Apologise & compensate', desc: 'Costs $750K. Reputation +1.' },
        { id: 'ignore', label: 'Ride it out', desc: 'Free, but reputation −4.' },
      ]),
  },
  {
    id: 'sale_leaseback', weight: (s) => (s.fleet.some((a) => a.ownership === 'owned' && a.status === 'active') ? 0.3 : 0),
    run: (s) => {
      const owned = s.fleet.filter((a) => a.ownership === 'owned' && a.status === 'active');
      const ac = R.pick(s, owned);
      const t = AIRCRAFT_BY_ID[ac.typeId];
      const price = Math.round((ac.bookValue * 1.1) / 100_000) * 100_000;
      const monthly = usedLeaseRate(t, ageYears(s, ac), ac.condition);
      decide(s, 'sale_leaseback', 'Sale-and-leaseback offer',
        `${R.pick(s, LESSORS)} offers to buy ${ac.reg} (${t.name}) for $${(price / 1e6).toFixed(1)}M — 10% above book value — and lease it straight back to you for $${Math.round(monthly / 1000)}K per month over 5 years.`,
        [
          { id: 'accept', label: 'Sell & lease back', desc: 'Instant cash, but a monthly lease payment.' },
          { id: 'decline', label: 'Keep ownership', desc: 'Nothing changes.' },
        ], { aircraft: ac.id, price, monthly });
    },
  },
  {
    id: 'green_tax', weight: (s) => (s.routes.length >= 4 ? 0.2 : 0),
    run: (s) => {
      const c = R.pick(s, [...new Set(s.unlockedRegions.map((r) => REGION_BY_ID[r].continent))]);
      decide(s, 'green_tax', `Carbon levy proposed in ${CONTINENTS[c].name}`,
        'Lawmakers propose a per-passenger carbon levy that would raise airport charges by 10% for two years.',
        [
          { id: 'lobby', label: 'Lobby against it ($3M)', desc: '60% chance the levy is dropped.' },
          { id: 'comply', label: 'Accept it', desc: 'Charges +10% in this continent for two years. Reputation +2 for going green.' },
        ], { continent: c });
    },
  },
  {
    id: 'subsidy', weight: (s) => (s.routes.length >= 2 && s.contracts.length < 2 ? 0.45 : 0),
    run: (s) => {
      const hub = R.pick(s, s.hubs).code;
      const pool = AIRPORTS.filter((a) => a.size <= 2 && isAirportUnlocked(s, a.code) && !isHub(s, a.code) &&
        !s.routes.some((r) => r.to === a.code) && distance(hub, a.code) > 150 && distance(hub, a.code) < 2500);
      if (!pool.length) return;
      const a = R.pick(s, pool);
      const monthly = Math.round((150_000 + distance(hub, a.code) * 120) / 10_000) * 10_000;
      decide(s, 'subsidy', `Route subsidy offer: ${hub}–${a.code}`,
        `The regional government of ${a.city} wants better connectivity. They offer $${Math.round(monthly / 1000)}K per month for 12 months if you fly ${hub}–${a.code} at least 7 times a week within 60 days.`,
        [
          { id: 'accept', label: 'Accept the contract', desc: 'Open the route and fly it daily to earn the subsidy.' },
          { id: 'decline', label: 'Decline', desc: 'No obligation.' },
        ], { from: hub, to: a.code, monthly });
    },
  },
];

function decide(state: GameState, eventId: string, title: string, body: string, options: PendingDecision['options'], data: PendingDecision['data'] = {}) {
  state.decisions.push({ id: newId(state, 'd'), eventId, day: state.day, title, body, options, data });
  message(state, 'event', 'news', title, 'A decision is waiting for you.');
}

export function rollMonthlyEvents(state: GameState) {
  const count = R.chance(state, 0.55) ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const ev = R.weightedPick(state, RANDOM_EVENTS, (e) => e.weight(state));
    ev?.run(state);
  }
}

/** Occasional small daily events so the world feels alive between months. */
export function rollDailyEvents(state: GameState) {
  if (R.chance(state, 0.012)) {
    const ev = R.weightedPick(state, RANDOM_EVENTS.filter((e) => ['strike', 'weather', 'tourism_boom', 'comp_entry'].includes(e.id)), (e) => e.weight(state));
    ev?.run(state);
  }
}

export function resolveDecision(state: GameState, decisionId: string, optionId: string) {
  const d = state.decisions.find((x) => x.id === decisionId);
  if (!d) return;
  state.decisions = state.decisions.filter((x) => x.id !== decisionId);
  const strike = (days: number) => {
    state.modifiers.push({ id: newId(state, 'x'), kind: 'capacity', scope: 'global', targets: [], mult: 0, startDay: state.day + 1, endDay: state.day + days, label: 'Cabin crew strike' });
  };
  switch (d.eventId) {
    case 'union_raise':
      if (optionId === 'accept') {
        state.crewMult *= 1.06;
        state.reputation = Math.min(100, state.reputation + 1);
        message(state, 'info', 'ops', 'Pay deal agreed', 'Crew costs rise 6%. Morale is high.');
      } else if (optionId === 'counter') {
        state.crewMult *= 1.03;
        if (R.chance(state, 0.3)) {
          strike(1);
          message(state, 'bad', 'ops', 'One-day strike', 'The union rejects your offer and walks out for a day before accepting.');
        } else message(state, 'good', 'ops', 'Compromise reached', 'The union accepts a 3% raise.');
      } else if (R.chance(state, 0.55)) {
        strike(2);
        state.reputation = Math.max(0, state.reputation - 4);
        message(state, 'bad', 'ops', 'Cabin crew strike!', 'All flights are grounded for two days. Reputation −4.');
      } else message(state, 'good', 'ops', 'Union backs down', 'The union drops its demands — for now.');
      break;
    case 'pr_crisis':
      if (optionId === 'compensate') {
        spend(state, 'other', 750_000);
        state.reputation = Math.min(100, state.reputation + 1);
      } else state.reputation = Math.max(0, state.reputation - 4);
      break;
    case 'sale_leaseback': {
      if (optionId !== 'accept') break;
      const ac = state.fleet.find((a) => a.id === d.data.aircraft);
      if (!ac || ac.ownership !== 'owned') break;
      const price = Number(d.data.price);
      state.cash += price;
      state.finance.current.assetSales += price;
      state.finance.current.rev.other += price - ac.bookValue;
      ac.ownership = 'leased';
      ac.leaseMonthly = Number(d.data.monthly);
      ac.leaseDeposit = 0;
      ac.leaseEndDay = state.day + 365 * 5;
      ac.bookValue = 0;
      message(state, 'good', 'finance', 'Sale-and-leaseback complete', `${ac.reg} sold for $${(price / 1e6).toFixed(1)}M and leased back.`);
      break;
    }
    case 'green_tax': {
      const c = String(d.data.continent) as ContinentId;
      if (optionId === 'lobby') {
        spend(state, 'other', 3_000_000);
        if (R.chance(state, 0.6)) {
          message(state, 'good', 'news', 'Carbon levy defeated', 'Your lobbying paid off.');
          break;
        }
        message(state, 'bad', 'news', 'Lobbying failed', 'The carbon levy passes anyway.');
      } else state.reputation = Math.min(100, state.reputation + 2);
      state.modifiers.push({ id: newId(state, 'x'), kind: 'fees', scope: 'continent', targets: [c], mult: 1.1, startDay: state.day, endDay: state.day + 730, label: 'Carbon levy' });
      break;
    }
    case 'subsidy':
      if (optionId === 'accept') {
        state.contracts.push({
          id: newId(state, 'c'), from: String(d.data.from), to: String(d.data.to), monthly: Number(d.data.monthly),
          minFreq: 7, monthsLeft: 12, deadline: state.day + 60, active: false,
        });
        message(state, 'info', 'ops', 'Subsidy contract signed', `Fly ${d.data.from}–${d.data.to} at least 7× weekly within 60 days to start earning.`);
      }
      break;
  }
}

// ---------- rivals fight back ----------

const RIVAL_AGGRESSION: Record<Difficulty, number> = { easy: 0.6, normal: 1, hard: 1.35 };

/** Margin a route may earn after its share of aircraft costs (network overheads still to pay) before rivals take an interest. */
const NORMAL_MARGIN = 0.08;
/** Days a route is left alone after rivals have answered it. */
const RIVAL_COOLDOWN = 150;

/**
 * How much a route invites a rival response: margins above normal once its aircraft are paid for,
 * and full planes. Uses the last eight weeks.
 */
export function routeHeat(state: GameState, r: Route): number {
  const h = r.history.slice(-8);
  if (h.length < 6) return 0;
  let rev = 0, cost = 0, pax = 0, seats = 0;
  for (const w of h) { rev += w.rev; cost += w.cost; pax += w.pax; seats += w.seats; }
  if (rev <= 0 || seats <= 0) return 0;
  const ownership = routeFlightCost(state, r, routeSupply(state, r, false).aircraft).ownership * 7 * h.length;
  const margin = (rev - cost - ownership) / rev;
  return Math.max(0, (margin - NORMAL_MARGIN) * 5 + Math.max(0, pax / seats - 0.92));
}

/**
 * Monthly: rivals study the player's most lucrative routes and answer with extra capacity or a fare
 * war, so above-normal profits don't last unless the player keeps improving. Each route sees at most
 * one move every five months.
 */
export function rivalReactions(state: GameState) {
  const hot = state.routes
    .map((r) => ({ r, heat: routeHeat(state, r), c: competition(state, r.from, r.to) }))
    .filter((x) => x.heat > 0 && (x.c.lastMove === undefined || state.day - x.c.lastMove >= RIVAL_COOLDOWN))
    .sort((a, b) => b.heat - a.heat);
  const aggression = RIVAL_AGGRESSION[state.airline.difficulty] ?? 1;
  let moves = 1 + Math.floor(state.routes.length / 10);
  for (const { r, heat, c } of hot) {
    if (moves <= 0) break;
    if (!R.chance(state, Math.min(0.6, heat) * aggression)) continue;
    moves--;
    const key = pairKey(r.from, r.to);
    const name = c.name ?? airlineFor(state, r.to);
    let title: string;
    let body: string;
    if (R.chance(state, 0.6)) {
      const add = Math.max(0.15, baseCompetition(r.from, r.to) * R.range(state, 0.2, 0.4));
      state.competition[key] = { ...c, level: c.level + add, name, lastMove: state.day };
      title = `${name} adds flights on ${r.from}–${r.to}`;
      body = `Your results on ${r.from}–${r.to} have been noticed: ${name} is adding capacity. Expect a smaller share — answer with frequency, a better product or sharper fares.`;
    } else {
      const idx = Math.min(c.priceIdx, R.range(state, 0.76, 0.88));
      state.competition[key] = { ...c, priceIdx: idx, name, lastMove: state.day };
      title = `Fare war on ${r.from}–${r.to}`;
      body = `${name} undercuts market fares by ${Math.round((1 - idx) * 100)}% on ${r.from}–${r.to} to win back passengers. It will fade over a few months — match it, or hold on with quality and frequency.`;
    }
    alert(state, 'competition', message(state, 'warn', 'market', title, body));
  }
}

/** Monthly drift of route competition back towards its natural level. */
/**
 * Monthly drift of route competition back towards its natural level. Where the player sells below
 * market fares, rivals follow them down instead (to at most 30% below market).
 */
export function competitionDrift(state: GameState) {
  const matched = new Map<string, number>();
  for (const r of state.routes) {
    const ratio = fareRatio(state, r);
    if (ratio < 0.97) matched.set(pairKey(r.from, r.to), Math.max(MATCH_FLOOR, ratio));
  }
  for (const key of matched.keys()) {
    if (!state.competition[key]) {
      const [a, b] = key.split('-');
      state.competition[key] = { ...competition(state, a, b) };
    }
  }
  for (const [key, c] of Object.entries(state.competition)) {
    const [a, b] = key.split('-');
    const base = baseCompetition(a, b);
    const target = matched.get(key) ?? 1;
    c.level += (base - c.level) * 0.04;
    c.priceIdx += (target - c.priceIdx) * (target < c.priceIdx ? 0.25 : 0.15);
    if (!matched.has(key) && Math.abs(c.level - base) < 0.02 && Math.abs(1 - c.priceIdx) < 0.02) delete state.competition[key];
  }
}

export function pruneModifiers(state: GameState) {
  state.modifiers = state.modifiers.filter((m) => m.endDay >= state.day - 1);
}
