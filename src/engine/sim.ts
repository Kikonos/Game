// The daily simulation tick and periodic (weekly / monthly / yearly) processing.

import { AIRCRAFT_BY_ID } from '../data/aircraft';
import { AIRPORT_BY_CODE } from '../data/airports';
import { CLASSES, type CabinClass } from '../data/seats';
import { type Seats, cabinSeats, zeroSeats } from './cabin';
import {
  type RouteSupply, assignmentIndex, competition, frequencyFactor, isFlying, localDemand, marketDepth, priceFactor, marketDemand,
  optimizePrices, routeSupply, totalOf,
} from './demand';
import {
  STATION_MONTHLY, hubMonthlyCost, ageYears, ancillaryPerPax, blockHours, cargoRevenuePerLeg, costIndex, fixedMonthlyCosts, heavyCheckCost,
  heavyCheckDays, DISTRIBUTION_RATE, landingFee, legCost, marketFare, marketValue, overheadMonthly, paxFee, restoredCondition,
  serviceCostPerPax, monthProfit,
} from './economy';
import {
  announceScheduled, competitionDrift, pruneModifiers, rivalReactions, rollDailyEvents, rollMonthlyEvents, scheduleYear,
} from './events';
import { distance } from './geo';
import { airlineRank, refreshMarkets, updateAiAirlines, updateEconomyMonthly, updateFuel } from './market';
import { modifierFor } from './modifiers';
import { addXp, checkGoals, fleetGrowthXp } from './progression';
import * as R from './rng';
import { alert, book, earn, emptyMonth, isHub, message, spend, stations } from './state';
import type { Aircraft, GameState, MonthFinance, Route } from './types';
import { clamp, monthKey, monthLabel, pairKey, yearOf } from './util';

interface LegState {
  route: Route;
  supply: RouteSupply;
  capMult: number;
  seats: Seats;
  flights: number;
  local: Seats;
  demand: Seats;
  remaining: Seats;
  connReq: Seats;
  connPax: Seats;
  connRev: number;
  share: number;
}

const CONNECT_PENALTY = 0.8;

function simulateConnections(state: GameState, legs: LegState[]) {
  const direct = new Set(state.routes.map((r) => pairKey(r.from, r.to)));
  const byHub = new Map<string, LegState[]>();
  for (const l of legs) {
    if (totalOf(l.seats) <= 0) continue;
    const arr = byHub.get(l.route.from) ?? [];
    arr.push(l);
    byHub.set(l.route.from, arr);
  }
  interface Flow { a: LegState; b: LegState; req: Seats; dist: number }
  const flows: Flow[] = [];
  for (const [hubCode, hubLegs] of byHub) {
    if (hubLegs.length < 2) continue;
    const hub = state.hubs.find((h) => h.code === hubCode);
    const hubF = hub?.upgrades.connections ? 1.3 : 1;
    for (let i = 0; i < hubLegs.length; i++) {
      for (let j = i + 1; j < hubLegs.length; j++) {
        const A = hubLegs[i];
        const B = hubLegs[j];
        const x = A.route.to;
        const y = B.route.to;
        if (x === y) continue;
        const dXY = distance(x, y);
        if (dXY < 400 || direct.has(pairKey(x, y))) continue;
        const detour = (A.route.dist + B.route.dist) / dXY;
        if (detour > 1.7) continue;
        const connF = 0.5 * Math.pow(1 - (detour - 1) / 0.7, 1.5) * hubF;
        const market = marketDemand(state, x, y);
        const comp = competition(state, x, y);
        const fpd = Math.min(A.flights, B.flights);
        const freqF = frequencyFactor(fpd, marketDepth(totalOf(market), dXY));
        const repF = 0.65 + 0.7 * (state.reputation / 100);
        const req = zeroSeats();
        for (const c of CLASSES) {
          if (market[c] <= 0) continue;
          const q = ((A.supply.quality[c] || A.supply.quality.Y) + (B.supply.quality[c] || B.supply.quality.Y)) / 2;
          const qF = 1 + ((q - 55) / 100) * (0.5 + Math.min(0.7, dXY / 8000));
          // Connecting fares follow the average fare level the player sets on both legs.
          const fareRatio = (A.route.prices[c] / marketFare(state, A.route.dist, c) + B.route.prices[c] / marketFare(state, B.route.dist, c)) / 2;
          const att = freqF * qF * repF * 1.12 * priceFactor(fareRatio, 1, c);
          const share = att / (att + comp.level / Math.max(0.5, comp.priceIdx) + 0.3 + CONNECT_PENALTY);
          req[c] = market[c] * share * connF;
        }
        // Spill premium demand into economy when either leg lacks the cabin.
        for (const c of ['F', 'J', 'W'] as CabinClass[]) {
          if (A.seats[c] <= 0 || B.seats[c] <= 0) {
            req.Y += req[c] * 0.3;
            req[c] = 0;
          }
        }
        flows.push({ a: A, b: B, req, dist: dXY });
        for (const c of CLASSES) {
          A.connReq[c] += req[c];
          B.connReq[c] += req[c];
        }
      }
    }
  }
  if (!flows.length) return;
  const ratio = (l: LegState, c: CabinClass) => (l.connReq[c] > 0 ? Math.min(1, l.remaining[c] / l.connReq[c]) : 0);
  for (const f of flows) {
    for (const c of CLASSES) {
      if (f.req[c] <= 0) continue;
      const pax = f.req[c] * Math.min(ratio(f.a, c), ratio(f.b, c));
      if (pax <= 0) continue;
      const fare = marketFare(state, f.dist, c) * 0.85 *
        Math.min(1.15, (f.a.route.prices[c] / marketFare(state, f.a.route.dist, c) + f.b.route.prices[c] / marketFare(state, f.b.route.dist, c)) / 2);
      const total = f.a.route.dist + f.b.route.dist;
      f.a.connPax[c] += pax;
      f.b.connPax[c] += pax;
      f.a.connRev += pax * fare * (f.a.route.dist / total);
      f.b.connRev += pax * fare * (f.b.route.dist / total);
    }
  }
}

function simulateRoutes(state: GameState): LegState[] {
  const legs: LegState[] = [];
  const index = assignmentIndex(state);
  for (const route of state.routes) {
    const supply = routeSupply(state, route, true, index);
    const capMult = modifierFor(state, 'capacity', route.from, route.to);
    const seats = zeroSeats();
    for (const c of CLASSES) seats[c] = supply.seats[c] * capMult;
    const flights = supply.flightsPerDay * capMult;
    const { demand, share } = flights > 0 ? localDemand(state, route, supply) : { demand: zeroSeats(), share: 0 };
    const noise = 1 + R.gaussian(state) * 0.045;
    const local = zeroSeats();
    const remaining = zeroSeats();
    for (const c of CLASSES) {
      demand[c] *= noise;
      local[c] = Math.min(demand[c], seats[c]);
      remaining[c] = seats[c] - local[c];
    }
    legs.push({
      route, supply, capMult, seats, flights, local, demand, remaining, share,
      connReq: zeroSeats(), connPax: zeroSeats(), connRev: 0,
    });
  }

  simulateConnections(state, legs);

  let dayPax = 0;
  let dayFlights = 0;
  for (const l of legs) dayPax += accountLeg(state, l, (f) => (dayFlights += f));
  state.stats.totalPax += dayPax;
  state.stats.weekPax += dayPax;
  state.stats.yearPax += dayPax;
  state.stats.totalFlights += dayFlights;
  state.finance.current.pax += dayPax;
  state.finance.current.flights += dayFlights;
  return legs;
}

/** Books revenue and costs for one route-day (both directions). Returns passengers carried. */
function accountLeg(state: GameState, l: LegState, countFlights: (f: number) => void): number {
  const { route } = l;
  const pax = zeroSeats();
  let ticketRev = l.connRev;
  for (const c of CLASSES) {
    pax[c] = l.local[c] + l.connPax[c];
    ticketRev += l.local[c] * route.prices[c];
  }
  const paxOneWay = totalOf(pax);
  const paxBoth = paxOneWay * 2;
  ticketRev *= 2;
  const ancillary = (pax.Y + pax.W) * 2 * ancillaryPerPax(state, route.dist);

  let fuel = 0, crew = 0, maint = 0, nav = 0, landing = 0, cargo = 0;
  const econ = (state.market.econ[AIRPORT_BY_CODE[route.from].continent] + state.market.econ[AIRPORT_BY_CODE[route.to].continent]) / 2;
  const totalSeatsDay = totalOf(l.supply.seats) || 1;
  let legsFlown = 0;
  for (const { ac, freq } of l.supply.aircraft) {
    const t = AIRCRAFT_BY_ID[ac.typeId];
    const legsPerDay = (2 * freq / 7) * l.capMult;
    if (legsPerDay <= 0) continue;
    const lc = legCost(state, ac, route.dist, route.to);
    const landAvg = (landingFee(state, t, route.to) + landingFee(state, t, route.from)) / 2 + lc.handling;
    const acFuel = lc.fuel * legsPerDay;
    const acCrew = lc.crew * legsPerDay;
    const acMaint = lc.maintenance * legsPerDay;
    const acNav = lc.navigation * legsPerDay;
    const acLand = landAvg * legsPerDay;
    const acCargo = cargoRevenuePerLeg(state, t, route.dist, econ) * legsPerDay;
    fuel += acFuel; crew += acCrew; maint += acMaint; nav += acNav; landing += acLand; cargo += acCargo;
    legsFlown += legsPerDay;
    // Wear & utilisation
    const block = blockHours(t, route.dist);
    ac.hours += block * legsPerDay;
    ac.cycles += legsPerDay;
    const decay = [1.4, 1, 0.7][state.policies.maintenance] * (1 + ageYears(state, ac) / 40);
    ac.condition = Math.max(0, ac.condition - 0.0055 * decay * block * legsPerDay);
    // Per-aircraft P&L attribution by seat share
    const seatShare = (totalOf(cabinSeats(t, ac.cabin)) * freq / 7) / totalSeatsDay;
    const acRev = (ticketRev + ancillary) * seatShare + acCargo;
    const acCost = acFuel + acCrew + acMaint + acNav + acLand;
    ac.monthRevenue += acRev;
    ac.monthCost += acCost;
    ac.lifetimeRevenue += acRev;
    ac.lifetimeCost += acCost;
  }
  countFlights(legsFlown);

  const fees = paxOneWay * (paxFee(state, route.from) + paxFee(state, route.to));
  let service = 0;
  for (const c of CLASSES) service += pax[c] * 2 * serviceCostPerPax(state, c, route.dist);
  if (state.loyalty.active) service += paxBoth * 0.4;

  earn(state, 'tickets', ticketRev);
  earn(state, 'ancillary', ancillary);
  earn(state, 'cargo', cargo);
  spend(state, 'fuel', fuel);
  spend(state, 'crew', crew);
  spend(state, 'maintenance', maint);
  spend(state, 'navigation', nav);
  spend(state, 'airport', landing + fees);
  spend(state, 'service', service);
  const distribution = ticketRev * DISTRIBUTION_RATE;
  spend(state, 'distribution', distribution);

  const rev = ticketRev + ancillary + cargo;
  const cost = fuel + crew + maint + nav + landing + fees + service + distribution;
  const seatsBoth = totalOf(l.seats) * 2;
  route.last = {
    pax: { F: pax.F * 2, J: pax.J * 2, W: pax.W * 2, Y: pax.Y * 2 },
    seats: { F: l.seats.F * 2, J: l.seats.J * 2, W: l.seats.W * 2, Y: l.seats.Y * 2 },
    demand: { F: l.demand.F * 2, J: l.demand.J * 2, W: l.demand.W * 2, Y: l.demand.Y * 2 },
    connPax: totalOf(l.connPax) * 2,
    rev,
    cost,
    flights: legsFlown,
    share: l.share,
  };
  route.acc.pax += paxBoth;
  route.acc.seats += seatsBoth;
  route.acc.rev += rev;
  route.acc.cost += cost;
  route.acc.connPax += totalOf(l.connPax) * 2;
  route.acc.days += 1;
  route.lifetime.pax += paxBoth;
  route.lifetime.rev += rev;
  route.lifetime.cost += cost;
  state.stats.weekProfit += rev - cost;
  return paxBoth;
}

// ---------- aircraft status ----------

function updateAircraftStatus(state: GameState) {
  for (const ac of state.fleet) {
    const t = AIRCRAFT_BY_ID[ac.typeId];
    if (ac.status !== 'active' && ac.statusUntil <= state.day) {
      const idle = !ac.assignments.some((a) => a.freq > 0);
      const prev = ac.status;
      ac.status = 'active';
      if (prev === 'delivering') {
        alert(state, 'fleet', message(state, 'good', 'fleet', `Delivered: ${ac.reg}`, `Your ${t.name} has arrived at ${ac.hub}${idle ? '. Assign it to a route to start earning.' : ' and is starting its schedule.'}`));
        const active = state.fleet.filter((a) => a.status !== 'delivering').length;
        if (active > state.stats.peakFleet) {
          state.stats.peakFleet = active;
          addXp(state, fleetGrowthXp(t));
        }
      } else if (prev === 'maintenance') {
        ac.condition = restoredCondition(ageYears(state, ac));
        const m = message(state, idle ? 'warn' : 'info', 'fleet', `${ac.reg} back in service`, `Heavy check complete. Condition restored to ${Math.round(ac.condition)}%.${idle ? ' It has no routes — assign it to start earning.' : ''}`);
        if (idle) alert(state, 'fleet', m);
      } else if (prev === 'ferry') {
        alert(state, 'fleet', message(state, 'warn', 'fleet', `${ac.reg} arrived at ${ac.hub}`, 'Ferry flight complete — the aircraft is idle until you assign it to a route.'));
      } else if (prev === 'refit' && ac.pendingCabin) {
        ac.cabin = ac.pendingCabin;
        ac.pendingCabin = undefined;
        const m = message(state, idle ? 'warn' : 'info', 'fleet', `${ac.reg} refit complete`, `The new cabin is installed and the aircraft is back in service.${idle ? ' It has no routes yet.' : ''}`);
        if (idle) alert(state, 'fleet', m);
      }
    }
    if (ac.status === 'active' && state.policies.autoMaint && ac.condition < state.policies.autoMaintThreshold) {
      const cost = heavyCheckCost(t, ageYears(state, ac));
      if (state.cash > cost) {
        spend(state, 'maintenance', cost);
        ac.status = 'maintenance';
        ac.statusUntil = state.day + heavyCheckDays(t);
        message(state, 'info', 'fleet', `${ac.reg} sent for heavy check`, `Auto-maintenance: condition fell below ${state.policies.autoMaintThreshold}%.`);
      }
    }
  }
}

function rollDisruptions(state: GameState): { flying: number; disrupted: number } {
  let flying = 0;
  let disrupted = 0;
  for (const ac of state.fleet) {
    if (ac.status !== 'active' || !ac.assignments.some((a) => a.freq > 0)) continue;
    flying++;
    const p = 0.0015 * (1 + (100 - ac.condition) / 25);
    if (R.chance(state, p)) {
      ac.lastDisruption = state.day;
      disrupted++;
      const t = AIRCRAFT_BY_ID[ac.typeId];
      spend(state, 'maintenance', t.maintHour * R.range(state, 3, 10));
      state.reputation = Math.max(0, state.reputation - 0.15);
      if (ac.condition < 55) {
        message(state, 'warn', 'fleet', `Technical fault grounds ${ac.reg}`, `The ${t.name} (condition ${Math.round(ac.condition)}%) is out of service today. Ageing, poorly maintained aircraft break down more often.`);
      }
    }
  }
  return { flying, disrupted };
}

function updateReputation(state: GameState, ops: { flying: number; disrupted: number }, legs: LegState[]) {
  if (ops.flying > 0) {
    const rel = 1 - ops.disrupted / ops.flying;
    state.stats.reliability = state.stats.reliability * 0.97 + rel * 0.03;
  }
  let qSum = 0, valueSum = 0, w = 0;
  for (const { route: r, supply } of legs) {
    if (!r.last || totalOf(r.last.pax) <= 0) continue;
    for (const c of CLASSES) {
      const p = r.last.pax[c];
      if (p <= 0) continue;
      qSum += (supply.quality[c] || 50) * p;
      valueSum += clamp(marketFare(state, r.dist, c) / Math.max(1, r.prices[c]), 0.5, 1.5) * p;
      w += p;
    }
  }
  if (w <= 0) return;
  const q = qSum / w;
  const value = valueSum / w;
  state.stats.avgQuality = q;
  const bonus = (state.loyalty.active ? 3 : 0) + state.campaigns.filter((c) => c.endDay >= state.day && c.type !== 'route').length * 1.5;
  const target = clamp(0.55 * q + 28 * state.stats.reliability + 15 * (value - 0.6) + bonus - 4, 0, 100);
  state.reputation = clamp(state.reputation + (target - state.reputation) * 0.012, 0, 100);
}

// ---------- weekly ----------

function weekly(state: GameState) {
  const week = Math.floor(state.day / 7);
  for (const r of state.routes) {
    if (r.acc.days > 0) {
      r.history.push({
        week, pax: Math.round(r.acc.pax), seats: Math.round(r.acc.seats), rev: Math.round(r.acc.rev),
        cost: Math.round(r.acc.cost), connPax: Math.round(r.acc.connPax),
      });
      if (r.history.length > 52) r.history.shift();
    }
    r.acc = { pax: 0, seats: 0, rev: 0, cost: 0, connPax: 0, days: 0 };
  }
  checkLosingRoutes(state, week);
  state.stats.weeklyPax.push(Math.round(state.stats.weekPax));
  state.stats.weeklyProfit.push(Math.round(state.stats.weekProfit));
  if (state.stats.weeklyPax.length > 104) state.stats.weeklyPax.shift();
  if (state.stats.weeklyProfit.length > 104) state.stats.weeklyProfit.shift();
  if (state.loyalty.active) state.loyalty.members += state.stats.weekPax * 0.12;
  state.stats.weekPax = 0;
  state.stats.weekProfit = 0;
  state.campaigns = state.campaigns.filter((c) => c.endDay >= state.day);

  if (state.policies.autoPricing && state.licenses.revenueMgmt) {
    for (const r of state.routes) {
      const supply = routeSupply(state, r, false);
      if (totalOf(supply.seats) > 0) r.prices = optimizePrices(state, r, supply);
    }
  }
  state.market.fuelHistory.push(Math.round(state.market.fuel * 1000) / 1000);
  if (state.market.fuelHistory.length > 156) state.market.fuelHistory.shift();
}

/** Alerts once when a flying route has lost money four weeks running; re-arms after a profitable week. */
function checkLosingRoutes(state: GameState, week: number) {
  const losing: string[] = [];
  for (const r of state.routes) {
    const key = `loss:${r.id}`;
    const h = r.history.slice(-4);
    const last = h[h.length - 1];
    if (!last || last.week !== week) continue;
    if (last.rev >= last.cost) delete state.flags[key];
    else if (h.length === 4 && h.every((w) => w.rev < w.cost && w.seats > 0) && !state.flags[key]) {
      state.flags[key] = week;
      losing.push(`${r.from}–${r.to}`);
    }
  }
  for (const k of Object.keys(state.flags)) {
    if (k.startsWith('loss:') && !state.routes.some((r) => `loss:${r.id}` === k)) delete state.flags[k];
  }
  if (losing.length) {
    alert(state, 'route', message(state, 'warn', 'ops', losing.length === 1 ? `${losing[0]} keeps losing money` : `${losing.length} routes keep losing money`,
      `${losing.join(', ')} ${losing.length === 1 ? 'has' : 'have'} been below cost four weeks in a row. Re-price, use a smaller aircraft, cut frequency — or close ${losing.length === 1 ? 'it' : 'them'}.`));
  }
}

/** Warns once when cash drops below a month of fixed costs; re-arms after recovering. */
function checkCash(state: GameState) {
  const fixed = fixedMonthlyCosts(state);
  if (fixed <= 0) return;
  if (state.cash < fixed) {
    if (state.flags.cashLow) return;
    state.flags.cashLow = 1;
    alert(state, 'cash', message(state, 'bad', 'finance', state.cash < 0 ? 'Cash balance negative' : 'Cash running low',
      `Cash is $${(state.cash / 1e6).toFixed(1)}M, less than one month of fixed costs ($${(fixed / 1e6).toFixed(1)}M for leases, overhead, stations and loans). Cut losing routes, take a loan or sell an aircraft.`));
  } else if (state.cash > fixed * 1.5) delete state.flags.cashLow;
}

// ---------- monthly ----------

function monthEnd(state: GameState) {
  const ci = costIndex(state);
  if (state.inflation.relief) state.inflation.relief = Math.max(0, state.inflation.relief - 0.0125);
  // Leases
  for (const ac of state.fleet) {
    if (ac.ownership !== 'leased' || ac.status === 'delivering') continue;
    spend(state, 'leases', ac.leaseMonthly);
    if (ac.leaseEndDay <= state.day) {
      ac.leaseEndDay = state.day + 365 * 2;
      message(state, 'info', 'fleet', `Lease extended: ${ac.reg}`, 'The lease reached its end date and was extended for two years at the same rate.');
    }
  }
  // Depreciation & insurance
  for (const ac of state.fleet) {
    const t = AIRCRAFT_BY_ID[ac.typeId];
    if (ac.status === 'delivering') continue;
    if (ac.ownership === 'owned') {
      const v = marketValue(t, ageYears(state, ac), ac.condition);
      if (v < ac.bookValue) {
        book(state, 'depreciation', ac.bookValue - v);
        ac.bookValue = v;
      }
      spend(state, 'insurance', ac.bookValue * 0.0045 / 12);
    } else {
      spend(state, 'insurance', marketValue(t, ageYears(state, ac), ac.condition) * 0.0035 / 12);
    }
  }
  // Loans
  for (const loan of state.loans) {
    const interest = loan.balance * loan.rate / 12;
    const principal = Math.min(loan.balance, loan.payment - interest);
    spend(state, 'interest', interest);
    state.cash -= principal;
    loan.balance -= principal;
    loan.monthsLeft -= 1;
  }
  const paidOff = state.loans.filter((l) => l.balance <= 1 || l.monthsLeft <= 0);
  for (const l of paidOff) {
    if (l.balance > 1) state.cash -= l.balance;
    message(state, 'good', 'finance', 'Loan repaid', `Your $${(l.principal / 1e6).toFixed(1)}M loan is fully repaid.`);
  }
  state.loans = state.loans.filter((l) => !paidOff.includes(l));
  // Overheads
  const activeFleet = state.fleet.filter((a) => a.status !== 'delivering').length;
  spend(state, 'overhead', overheadMonthly(state));
  for (const h of state.hubs) {
    let cost = hubMonthlyCost(state, h.code);
    if (h.upgrades.lounge) cost += 120_000 * ci;
    if (h.upgrades.maintenance) cost += 200_000 * ci;
    if (h.upgrades.connections) cost += 150_000 * ci;
    spend(state, 'stations', cost);
  }
  for (const code of stations(state)) spend(state, 'stations', STATION_MONTHLY[AIRPORT_BY_CODE[code].size] * ci);
  if (state.policies.wifi > 0) spend(state, 'service', activeFleet * (state.policies.wifi === 2 ? 30_000 : 18_000) * ci);
  if (state.cash < 0) spend(state, 'interest', -state.cash * 0.015);

  // Subsidy contracts
  for (const c of state.contracts) {
    const route = state.routes.find((r) => (r.from === c.from && r.to === c.to) || (r.from === c.to && r.to === c.from));
    const freq = route ? state.fleet.reduce((s, a) => s + a.assignments.filter((x) => x.routeId === route.id).reduce((t, x) => t + x.freq, 0), 0) : 0;
    if (freq >= c.minFreq) {
      if (!c.active) message(state, 'good', 'finance', `Subsidy active: ${c.from}–${c.to}`, 'The route meets the contract terms. Payments have started.');
      c.active = true;
      earn(state, 'other', c.monthly);
      c.monthsLeft -= 1;
    } else if (c.active || state.day > c.deadline) {
      message(state, 'bad', 'finance', `Subsidy cancelled: ${c.from}–${c.to}`, 'You did not meet the minimum frequency, so the contract was terminated.');
      c.monthsLeft = 0;
    }
  }
  state.contracts = state.contracts.filter((c) => c.monthsLeft > 0);

  // Aircraft month stats
  for (const ac of state.fleet) {
    ac.lastMonthProfit = ac.monthRevenue - ac.monthCost - (ac.ownership === 'leased' && ac.status !== 'delivering' ? ac.leaseMonthly : 0);
    ac.monthRevenue = 0;
    ac.monthCost = 0;
  }

  // Close the books
  const closed = state.finance.current;
  closed.cashEnd = state.cash;
  state.finance.history.push(closed);
  if (state.finance.history.length > 240) state.finance.history.shift();
  state.finance.current = emptyMonth(monthKey(state.day));
  const profit = monthProfit(closed);
  message(state, profit >= 0 ? 'good' : 'warn', 'finance', `${monthLabel(closed.key, false)} results`,
    `Net ${profit >= 0 ? 'profit' : 'loss'} of $${(Math.abs(profit) / 1e6).toFixed(2)}M with ${Math.round(closed.pax).toLocaleString()} passengers.`);
  monthXp(state, closed);

  // World updates
  refreshMarkets(state);
  updateEconomyMonthly(state);
  updateAiAirlines(state);
  competitionDrift(state);
  if (!process.env.NORIVAL) rivalReactions(state);
  pruneModifiers(state);
  rollMonthlyEvents(state);
  state.stats.peakFleet = Math.max(state.stats.peakFleet, activeFleet);

  // Solvency
  if (state.cash < 0) {
    state.finance.negativeMonths += 1;
    const left = 4 - state.finance.negativeMonths;
    if (left <= 0) {
      state.gameOver = { reason: 'Your airline ran out of cash for four consecutive months and the creditors have taken over.', day: state.day };
    } else {
      alert(state, 'cash', message(state, 'bad', 'finance', 'Cash balance negative!',
        `Your bank is charging overdraft interest. Return to a positive balance within ${left} month${left > 1 ? 's' : ''} or the airline will be declared bankrupt. Take a loan, sell aircraft or cut unprofitable routes.`));
    }
  } else state.finance.negativeMonths = 0;
}

/** XP pays for growth: new monthly passenger and operating-profit records, plus a small trickle for flying. */
function monthXp(state: GameState, m: MonthFinance) {
  const st = state.stats;
  const opProfit = monthProfit(m) - m.rev.other;
  let xp = m.pax / 5000;
  if (m.pax > st.bestMonthPax) {
    xp += (m.pax - st.bestMonthPax) / 60;
    st.bestMonthPax = m.pax;
  }
  if (opProfit > st.bestMonthProfit) {
    xp += (opProfit - Math.max(0, st.bestMonthProfit)) / 20_000;
    st.bestMonthProfit = opProfit;
  }
  addXp(state, xp);
}

/** January price review: costs inflate, market fares follow only partly. Player fares stay where they were set. */
function annualInflation(state: GameState, year: number) {
  const cost = R.range(state, 0.022, 0.042);
  const fare = cost * R.range(state, 0.5, 0.8);
  state.inflation.cost *= 1 + cost;
  state.inflation.fare *= 1 + fare;
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  message(state, 'warn', 'finance', `${year} price review: costs +${pct(cost)}`,
    `Wages, airport charges and maintenance rates rise ${pct(cost)} this year; market fares are up only ${pct(fare)}. ` +
    'Fares you set by hand stay where they are — re-price your routes (Optimise, or auto-pricing) to keep up.');
}

function yearEnd(state: GameState, year: number) {
  const months = state.finance.history.filter((m) => Math.floor(m.key / 12) === year);
  const revenue = months.reduce((s, m) => s + Object.values(m.rev).reduce((a, b) => a + b, 0), 0);
  const profit = months.reduce((s, m) => s + monthProfit(m), 0);
  let bestRoute: string | null = null;
  let best = -Infinity;
  for (const r of state.routes) {
    const p = r.history.slice(-52).reduce((s, w) => s + w.rev - w.cost, 0);
    if (p > best) { best = p; bestRoute = `${r.from}–${r.to}`; }
  }
  state.stats.lastYearPax = state.stats.yearPax;
  state.yearReview = {
    year, pax: state.stats.yearPax, revenue, profit, fleet: state.fleet.length, routes: state.routes.length,
    reputation: state.reputation, rank: airlineRank(state), bestRoute,
  };
  state.stats.yearPax = 0;
}

// ---------- the tick ----------

export function advanceDay(state: GameState) {
  if (state.gameOver) return;
  state.alerts = [];
  const prevMonth = monthKey(state.day);
  const prevYear = yearOf(state.day);
  state.day += 1;

  // Close the previous period before simulating the new day.
  if (monthKey(state.day) !== prevMonth) monthEnd(state);
  if (yearOf(state.day) !== prevYear) {
    yearEnd(state, prevYear);
    if (!process.env.NOINFL) annualInflation(state, yearOf(state.day));
    scheduleYear(state, yearOf(state.day) + 1);
  }
  if (state.gameOver) return;

  updateAircraftStatus(state);
  updateFuel(state);
  const ops = rollDisruptions(state);
  const legs = simulateRoutes(state);
  updateReputation(state, ops, legs);
  announceScheduled(state);
  rollDailyEvents(state);

  if (state.day % 7 === 0) weekly(state);
  checkCash(state);
  checkGoals(state);
}

/** Today's flying status of an aircraft, for UI badges. */
export function aircraftFlyingToday(state: GameState, ac: Aircraft): boolean {
  return isFlying(ac, state.day) && ac.assignments.some((a) => a.freq > 0);
}

export function isHubCode(state: GameState, code: string) {
  return isHub(state, code);
}
