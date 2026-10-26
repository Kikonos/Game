// v0.12 Visual B: a crew member's airline ticket shown as a small boarding pass: the airline (name and code, no logo),
// flight, from → to with local times, date, seat and passenger. One pass per airline leg of the ticket.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtDayAt, fmtTime } from '../../engine/core/time';
import type { CrewMember, GameState } from '../../engine/core/types';
import { commercialItinerary } from '../../engine/ops';
import { passName, seatFor, wideLeg } from './boardingPass';

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;

/** The passes of one ticket (Flight kind 'deadhead', not a private jet) for one crew member; nothing otherwise. */
export function BoardingPasses({ g, ticketId, crew }: { g: GameState; ticketId: string; crew: CrewMember }) {
  const tk = g.flights[ticketId];
  if (!tk || tk.kind !== 'deadhead' || tk.charter) return null;
  let legs: ReturnType<typeof commercialItinerary> = [];
  try {
    legs = commercialItinerary(g, tk);
  } catch {
    return null;
  }
  const i = Math.max(0, tk.crewIds.indexOf(crew.id));
  return (
    <div className="bp-list">
      {legs.map((l, k) => (
        <div key={k} className="bp" role="group" aria-label={`Boarding pass ${l.no} ${l.from} to ${l.to}`}>
          <div className="bp-main">
            <div className="bp-top">
              <span className="bp-code mono">{l.iata}</span>
              <b className="bp-airline ellipsis">{l.airline}</b>
              <span className="bp-kind">BOARDING PASS</span>
            </div>
            <div className="bp-route">
              <span className="bp-end"><b className="mono">{l.from}</b><span className="tiny muted ellipsis">{city(l.from)}</span><span className="bp-time mono">{fmtTime(l.dep, l.from)}</span></span>
              <span className="bp-arrow" aria-hidden>✈</span>
              <span className="bp-end right"><b className="mono">{l.to}</b><span className="tiny muted ellipsis">{city(l.to)}</span><span className="bp-time mono">{fmtTime(l.arr, l.to)}</span></span>
            </div>
            <div className="bp-meta">
              <span><span className="bp-k">Passenger</span><b className="mono ellipsis">{passName(crew.first, crew.last)}</b></span>
              <span><span className="bp-k">Flight</span><b className="mono">{l.no}</b></span>
              <span><span className="bp-k">Date</span><b className="mono">{fmtDayAt(l.from, l.dep)}</b></span>
            </div>
          </div>
          <div className="bp-stub">
            <span className="bp-k">Seat</span>
            <b className="mono bp-seat">{seatFor(tk.id, k, i, wideLeg(l.from, l.to))}</b>
            <span className="bp-k">Boards</span>
            <b className="mono">{fmtTime(l.dep - 30, l.from)}</b>
          </div>
        </div>
      ))}
    </div>
  );
}
