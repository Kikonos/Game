// v0.12 Visual B: the big side view against the sky of the LOCAL time where the aircraft is now (its destination while
// airborne): dawn, day, dusk or night from the sun's real elevation there (map/sky.ts, mapLogic sunElevation). At night
// a few stars and the aircraft softly lit. Static (nothing animates) and its own little scene, readable in both themes.

import type { ReactNode } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { fmtTime } from '../../engine/core/time';
import type { Aircraft, GameState } from '../../engine/core/types';
import { sunElevation, sunPoint } from '../map/mapLogic';
import { SKY_STARS, type SkyPhase, skyPhase } from '../map/sky';

const PHASE_WORD: Record<SkyPhase, string> = { dawn: 'Dawn', day: 'Day', dusk: 'Dusk', night: 'Night' };

/** Where the sky is read: the destination while airborne, else where the aircraft stands. */
export function skyAirport(g: GameState, ac: Aircraft): string {
  const f = ac.flightId ? g.flights[ac.flightId] : undefined;
  return f && f.status === 'enroute' ? f.to : ac.at;
}

/** The phase of the sky at an airport at game minute t (the sun 20 minutes later says rising or setting). Pure. */
export function skyAt(code: string, t: number): SkyPhase {
  const A = AIRPORT_BY_CODE[code];
  if (!A) return 'day';
  const e0 = sunElevation(sunPoint(t), A.lon, A.lat);
  const e1 = sunElevation(sunPoint(t + 20), A.lon, A.lat);
  return skyPhase(e0, e1 > e0);
}

export function SkyArt({ g, ac, className, children, caption = true }: { g: GameState; ac: Aircraft; className?: string; children: ReactNode; caption?: boolean }) {
  const code = skyAirport(g, ac);
  const phase = skyAt(code, g.now);
  const city = AIRPORT_BY_CODE[code]?.city ?? code;
  return (
    <div className={`sky ${className ?? ''}`} data-phase={phase}>
      {phase === 'night' && (
        <svg className="sky-stars" aria-hidden width="100%" height="100%">
          {SKY_STARS.map(([x, y, r], i) => <circle key={i} cx={`${x}%`} cy={`${y}%`} r={r} />)}
        </svg>
      )}
      <div className="sky-art">{children}</div>
      {caption && <span className="sky-cap tiny">{PHASE_WORD[phase]} in {city} · {fmtTime(g.now, code)} local</span>}
    </div>
  );
}
