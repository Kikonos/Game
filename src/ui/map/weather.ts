// v0.12 Visual A: weather and closure marks on the map, pure. An airport closed or limited by an Update-1
// disruption (weather at the destination, a night curfew we had to avoid) or by a world event (a storm, a strike, an
// earthquake) gets one small mark with a soft halo while it lasts; it goes when the disruption clears. Tapping it
// opens what the game already has: the open card, the diverted aircraft, or the world event's panel.

import { WEATHER_CAUSES } from '../../data/opsData';
import { AIRPORT_BY_CODE } from '../../data/airports';
import type { GameState, Minute, Ref } from '../../engine/core/types';
import { hashUnit } from '../../engine/core/util';
import { curfewEnd, inCurfew } from '../../engine/core/curfew';
import { eventsOf, isLive } from '../../engine/ops/world';

export type WxKind = 'storm' | 'cloud' | 'curfew' | 'closed';

export interface WxMark {
  /** Airport code. */
  at: string;
  kind: WxKind;
  /** Short line for the tooltip ('Fog below landing minimums'). */
  title: string;
  /** What a tap opens: an open decision card, or a map selection. */
  tap: { decision: string } | { sel: Ref };
}

/** Weather marks stay this long after the diverted aircraft is on the ground at its alternate (the weather lifts). */
export const WX_LIFT_MIN = 120;

/** Fog and low cloud read as a low-cloud mark; storms, wind and snow as a storm. */
export const wxKindOf = (what: string): WxKind => (/fog|low cloud|calima|haze|dust|ash/i.test(what) ? 'cloud' : 'storm');

/** The weather text a diversion card picked for a flight (ops/disrupt.ts diversionCard, the same side-stream pick). */
function weatherWhat(g: GameState, flightId: string): string {
  const r = hashUnit(`${g.seed}:ops:div:${flightId}:w`);
  return WEATHER_CAUSES[Math.floor(r * WEATHER_CAUSES.length) % WEATHER_CAUSES.length];
}

/** World-event templates that are weather (their mark is a storm or a haze, not a closed sign). */
const WX_TPL: [RegExp, WxKind][] = [[/wind|hurricane|storm|snow|typhoon|cyclone/i, 'storm'], [/calima|fog|ash|dust/i, 'cloud']];

/** Every airport closed or limited right now (one mark per airport; an open card wins). Pure. */
export function wxMarks(g: GameState, t: Minute = g.now): WxMark[] {
  const out = new Map<string, WxMark>();
  const put = (m: WxMark, strong = false) => {
    if (!AIRPORT_BY_CODE[m.at]) return;
    if (strong || !out.has(m.at)) out.set(m.at, m);
  };
  // 1. Open cards: a destination closed by weather (hold or divert), a curfew about to close one.
  for (const d of g.decisions) {
    const f = d.data?.flightId ? g.flights[String(d.data.flightId)] : undefined;
    if (!f) continue;
    if (d.kind === 'diversion' && d.data?.cause === 'weather') {
      const what = String(d.data?.what ?? '');
      put({ at: f.div?.to0 ?? f.to, kind: wxKindOf(what), title: what || 'Weather', tap: { decision: d.id } }, true);
    } else if (d.kind === 'curfew') {
      put({ at: f.to, kind: 'curfew', title: 'Night curfew', tap: { decision: d.id } }, true);
    } else if (d.kind === 'divertOnward' && f.div?.cause === 'weather') {
      put({ at: f.div.to0, kind: wxKindOf(weatherWhat(g, f.id)), title: weatherWhat(g, f.id), tap: { decision: d.id } }, true);
    }
  }
  // 2. Flights that diverted or night-stopped: the weather lifts a while after they are down; a curfew ends on time.
  for (const f of Object.values(g.flights)) {
    if (f.status === 'cancelled') continue;
    if (f.div && f.div.cause === 'weather' && f.ops !== 'curfew' && f.to !== f.div.to0) {
      const down = f.ata ?? f.eta ?? f.sta;
      if (t >= f.div.at && t < down + WX_LIFT_MIN) {
        const what = weatherWhat(g, f.id);
        put({ at: f.div.to0, kind: wxKindOf(what), title: what, tap: { sel: f.aircraftId ? { kind: 'aircraft', id: f.aircraftId } : { kind: 'airport', id: f.div.to0 } } });
      }
    }
    if (f.ops === 'curfew') {
      const code = f.div?.to0 ?? f.to;
      const since = f.div?.at ?? f.std - 24 * 60;
      if (t >= since && t < since + 24 * 60 && inCurfew(code, t, false) && t < curfewEnd(code, t)) {
        put({ at: code, kind: 'curfew', title: 'Night curfew', tap: { sel: { kind: 'airport', id: code } } });
      }
    }
  }
  // 3. World events closing an airport (a storm, a strike, an earthquake) while the closure lasts.
  for (const e of eventsOf(g)) {
    if (!isLive(g, e) || !e.airportClosedUntil || t >= e.airportClosedUntil) continue;
    const kind = WX_TPL.find(([re]) => re.test(e.tpl) || re.test(e.title))?.[1] ?? 'closed';
    put({ at: e.at, kind, title: e.title, tap: { sel: { kind: 'event', id: e.id } } });
  }
  return [...out.values()].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
