// v0.8 feasibility lines (UPDATE-0.8.md §2.9, §5.4, §7.2): what each new kind of work needs, closed airspace,
// war-risk cover and the client's cabin crew, each as one plain sentence. Pure.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { ZONE_BY_ID } from '../../data/worldZones';
import { BAL } from '../core/balance';
import { fmtDay } from '../core/time';
import type { ContractOffer, GameState } from '../core/types';
import { mixedCrewText } from '../crew/clientCrew';
import { closedAirport, crosses, eventsOf, isLive, warRiskAt } from '../ops/world';
import type { CheckId, CheckLevel } from './feasibility';

export interface V08Line { id: CheckId; level: CheckLevel; label: string; detail?: string }

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const usdK = (v: number) => `$${Math.round(v / 1000)}K`;

/** War-risk cover per landing at a level (narrowbody; widebody × 1.8). Pure. */
export function warRiskCost(level: number, wide: boolean): number {
  if (level <= 0) return 0;
  const W = BAL.v08.world.warRisk;
  return Math.round(W.narrow[Math.min(3, level) - 1] * (wide ? W.wideMult : 1));
}

/** The 'what it needs' sentence of a v0.8 archetype (§2). */
function missionLine(g: GameState, o: ContractOffer): V08Line | null {
  const req = o.requirements;
  const legs = o.pattern.kind === 'legs' ? o.pattern.legs : [];
  const at = legs[0]?.from ?? o.pin;
  switch (o.archetype) {
    case 'hajj': {
      const weeks = Math.round((o.end - o.start) / (7 * 1440));
      return { id: 'mission', level: 'ok', label: `Hajj: all-economy ${req.minSeats}+ seats; every other leg empty; crews based near ${city(at)} for ${weeks} weeks` };
    }
    case 'unRotation':
      return { id: 'mission', level: 'ok', label: 'UN: IOSA registration, all-economy, 100 kg of baggage each; pays 30 days after each invoice' };
    case 'vip':
      return req.standards === 'vip' ? { id: 'mission', level: 'ok', label: 'Presidential: no fuel stops, a spare pilot, any delay over 30 min is noticed' } : null;
    case 'deportation':
      return {
        id: 'mission', level: 'warn', label: `Deportation: crews under ${BAL.v08.deport.refuseBelow} morale refuse it; the press may notice (clean −2 a flight)`,
        detail: `Morale −${Math.abs(BAL.v08.deport.morale)} for everyone who flies it; about ${Math.round(BAL.v08.world.injunction * 100)} % of flights are stopped by a court (the client still pays).`,
      };
    case 'evacuation': {
      const x = legs.find((l) => (l.pax ?? 0) > 0)?.from ?? o.pin;
      return { id: 'mission', level: 'warn', label: `Evacuation: no night stop at ${city(x)} (2 h on the ground at most); war-risk cover can be withdrawn at short notice` };
    }
    case 'medical':
      return { id: 'mission', level: 'ok', label: `Medical: ${req.stretchers ?? 0} stretchers take ${6 * (req.stretchers ?? 0)} seats; medical oxygen (dangerous goods); one extra cabin crew` };
    case 'musicTour':
      return { id: 'mission', level: 'ok', label: 'Music tour: the aircraft stays with the tour; band, crew and guests in a premium cabin' };
    case 'antarctic': {
      const ice = legs.find((l) => AIRPORT_BY_CODE[l.to]?.ice)?.to ?? o.pin;
      return { id: 'mission', level: 'warn', label: `Antarctica: blue ice at ${city(ice)}, polar approval and kit, fuel for the way back`, detail: `Whiteouts send about ${Math.round(BAL.v08.world.whiteout * 100)} % of flights back at the point of no return; we pay that fuel.` };
    }
    case 'humanitarian':
      return { id: 'mission', level: 'ok', label: 'Relief: aid workers and supplies in, empty back; paid after the job' };
    case 'capacityLease':
      return { id: 'mission', level: 'ok', label: `Capacity lease: their schedule for ${Math.round((o.end - o.start) / (30.44 * 1440))} months at a long-term rate` };
    case 'worldTour': {
      // v0.12.1 the tour's stops (every leg's arrival but the last, home).
      const n = Math.max(0, legs.length - 1);
      const days = Math.round((o.end - o.start) / 1440);
      return { id: 'mission', level: 'ok', label: `World tour: the aircraft and one crew are away ${days} days; augmented, ${req.extraCabin} extra cabin crew for the service, hotels at ${n} stops` };
    }
    case 'subcharterIn': {
      const r = g.rivals.find((x) => x.id === g.clients[o.clientId]?.rivalId);
      return { id: 'mission', level: 'ok', label: `Sub-charter in: we fly for ${r?.name ?? 'a rival'}'s client under its flight numbers; ${r?.name ?? 'they'} pay us` };
    }
    default:
      return null;
  }
}

/** Every v0.8 line for an offer on a type (mission, closures, war risk, client crew). Pure. */
export function v08Lines(g: GameState, o: ContractOffer, wide: boolean, airports: string[], sectors: [string, string][]): V08Line[] {
  const out: V08Line[] = [];
  const m = missionLine(g, o);
  if (m) out.push(m);
  // Closed airports through the first departure that uses them; closed airspace crossed (a reroute).
  const legs = o.pattern.kind === 'legs' ? o.pattern.legs : [];
  for (const code of airports) {
    const firstUse = legs.find((l) => l.from === code || l.to === code)?.dep ?? o.start;
    const e = closedAirport(g, code, firstUse, o.eventId);
    if (e) {
      out.push({ id: 'airspace', level: 'no', label: `${city(code)} is closed (${e.title}) until about ${fmtDay(e.end)}`, detail: 'Force majeure: nothing can fly there before it reopens.' });
      break;
    }
  }
  if (!out.some((x) => x.id === 'airspace')) {
    for (const e of eventsOf(g)) {
      if (!isLive(g, e) || !e.closed || !e.zoneId || e.id === o.eventId) continue;
      const z = ZONE_BY_ID[e.zoneId];
      if (z && sectors.some(([a, b]) => crosses(z, a, b))) {
        out.push({ id: 'airspace', level: 'warn', label: `Rerouted around ${z.adj} airspace: about +${z.detourMin} min a leg while it is closed` });
        break;
      }
    }
  }
  let worst = { level: 0, code: '' };
  for (const code of airports) {
    const lv = warRiskAt(g, code);
    if (lv > worst.level) worst = { level: lv, code };
  }
  if (worst.level) {
    out.push({
      id: 'warRisk', level: 'warn',
      label: `War-risk cover ${usdK(warRiskCost(worst.level, wide))} a landing at ${city(worst.code)}; cover can be withdrawn 48 h before`,
      detail: o.product.kind === 'wet' ? 'Re-billed to the client on a wet lease.' : 'Paid by us on a charter (priced in when the risk was known).',
    });
  }
  const mc = mixedCrewText(g, o.id);
  if (mc) out.push({ id: 'clientCrew', level: 'ok', label: mc });
  return out;
}
