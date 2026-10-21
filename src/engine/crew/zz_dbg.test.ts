import { it } from 'vitest';
import { DAY } from '../core/time';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { crewControl } from '.';
import { buildDuties } from './duties';
import { addCrew, fixtureContract, fixtureGame } from './fixtures';
import { autoRoster, releaseCrew, setFlightsCrew } from './roster';
import type { GameState } from '../core/types';
function trip(dep: string, dest: string, hhmm = 17 * 60, seed = 5) {
  const g = fixtureGame(seed);
  const acId = Object.keys(g.fleet)[0];
  const ac = g.fleet[acId];
  ac.at = dep;
  const std = Math.floor(g.now / DAY) * DAY + 2 * DAY + hhmm;
  const b = blockMinutes(ac.typeId, dep, dest);
  const k = fixtureContract(g, { pattern: { kind: 'legs', legs: [] }, aircraftIds: [acId], start: std - DAY, end: std + 2 * DAY, product: { kind: 'charter', price: 120_000, depositPct: 0.3, balanceDaysBefore: 7, fuelEscalation: false }, penalties: { cancelScale: [], perDelay: 2_500, perCancelledLeg: 15_000 } });
  const f1 = addFlight(g, { no: 'AW816', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dep, to: dest, std, sta: std + b, pax: 170 });
  addFlight(g, { no: 'AW817', aircraftId: acId, contractId: k.id, kind: 'revenue', from: dest, to: dep, std: std + b + 50, sta: std + 2 * b + 50, pax: 160 });
  const d = buildDuties(g, acId, g.now, g.now + 5 * DAY)[0];
  const crew = addCrew(g, { CPT: 2, FO: 2, SCC: 1, CC: 3 });
  return { g, d, p: g.pairings[d.pairingId], crew, flightId: f1.id, acId };
}
function shortOfCaptain(dep = 'DUS', dest = 'FNC', hoursBefore = 40, seed = 5) {
  const t = trip(dep, dest, 17 * 60, seed);
  const { g } = t;
  autoRoster(g);
  const d = g.duties[g.flights[t.flightId].dutyId!];
  const p = g.pairings[d.pairingId];
  const cpt = p.slots.find((s) => s.role === 'CPT' && s.crewId)!;
  const was = cpt.crewId!;
  releaseCrew(g, p, was);
  setFlightsCrew(g, p);
  g.now = d.report - hoursBefore * 60;
  return { ...t, d, p, was };
}
it('dbg', () => {
  for (const [h, loc, dep] of [[1, 'LIS', 'DUS'], [3, 'LIS', 'DUS'], [2, 'FNC', 'DUS'], [2, 'LIS', 'KEF'], [3, 'OPO', 'MAD'], [2, 'LIS', 'FNC']] as [number, string, string][]) {
    const { g, flightId, was } = shortOfCaptain(dep, 'LHR', h);
    for (const c of Object.values(g.crew)) if (c.role === 'CPT' && c.id !== was) { c.blocks = [{ from: g.now - DAY, to: g.now + 10 * DAY, why: 'leave' }]; c.status = 'leave'; }
    g.crew[was].loc = loc;
    const v = crewControl(g, flightId)!;
    console.log('h', h, loc, dep, 'card', v.card.why);
    for (const s of v.solutions.filter((y) => y.id === 'delay' || y.id === 'jet')) console.log(`#${s.rank} ${s.id} ${s.available ? 'OK' : 'no: ' + s.why} cost=${s.cost} newDep=${s.newDeparture} chips=${JSON.stringify(s.chips)} after=${s.preview.after.level} changes=${JSON.stringify(s.preview.changes)}`);
  }
});
