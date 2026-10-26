// v0.12 Visual B: the airline flights our crew ride are drawn with a top-down silhouette (grey: never ours). The type is
// what the carrier mostly flies on such a leg: its narrowbody (737 operators get a 737), or on a long leg (over 4,500 km,
// as the engine's ticket block times assume) its typical widebody. Unknown carriers: an A320, or an A330 on a long leg.

import { WIDE_KM } from '../components/boardingPass';
import { distance } from '../../engine/core/geo';

/** Carriers whose short and medium haul is all (or mostly) Boeing 737. */
const B737 = new Set(['FR', 'LS', 'DY', 'FZ', 'WN', 'HV', 'AT', 'ET', 'KQ', 'UX', 'G3', 'CM', 'AR', 'AS', 'WS', 'QF', 'VA', 'FJ', 'RO', 'SN', 'XY', 'KL', 'SV', 'OB', 'UP', 'DM']);
/** A carrier's typical long-haul type (silhouettes in silhouettes.ts). */
const LONG: Record<string, string> = {
  EK: 'b77w', QR: 'a359', EY: 'b789', TK: 'b77w', ET: 'a359', SQ: 'a359', CX: 'a35k', BA: 'b77w', LH: 'a346', AF: 'b77w', KL: 'b77w',
  TP: 'a339', IB: 'a359', UX: 'b789', LX: 'b77w', OS: 'b772', AY: 'a359', SK: 'a333', LO: 'b788', AZ: 'a339', SN: 'a333',
  AA: 'b77w', DL: 'a339', UA: 'b772', AC: 'b77w', LA: 'b789', AV: 'b788', CM: 'b738', AM: 'b789', AR: 'a332', G3: 'b738', AD: 'a339',
  SA: 'a359', KQ: 'b788', MS: 'b789', AT: 'b788', DT: 'b77w', WB: 'a333', AI: 'b77w', SV: 'b77w', GF: 'b789', KU: 'b77w', WY: 'b789',
  NH: 'b77w', JL: 'a35k', KE: 'b77w', CA: 'b77w', MU: 'a359', CZ: 'b789', BR: 'b77w', TG: 'a359', MH: 'a359', GA: 'b77w', PR: 'a359',
  VN: 'b789', QF: 'b789', NZ: 'b789', FJ: 'a359', UL: 'a333', PK: 'b77w', VS: 'a35k', S4: 'a332', MK: 'a359',
};

/** The silhouette type of an airline leg (`iata` carrier, `from`–`to`). Pure. */
export function airlineType(iata: string, from: string, to: string): string {
  let km = 0;
  try {
    km = distance(from, to);
  } catch {
    km = 0;
  }
  if (km > WIDE_KM) return LONG[iata] ?? 'a333';
  return B737.has(iata) ? 'b738' : 'a320ceo';
}
