// v0.19 route figures outside the Network area (main bundle, kept small): the flight sheet's sector block (§J.1) and
// the live numbers on the map aircraft card, flat and globe (UPDATE-0.19 additions 3 b). The Network screens
// themselves load lazily.

import '../../../styles/acmi/v019live.css';
import { geoPath, type GeoProjection } from 'd3-geo';
import { CalendarClock, CircleSlash, Route as RouteIcon } from 'lucide-react';
import { memo, useMemo } from 'react';
import { AIRPORT_BY_CODE } from '../../../data/airports';
import { DAY, fmtDay, fmtTime, fmtWeekdayTime } from '../../../engine/core/time';
import type { Flight, GameState } from '../../../engine/core/types';
import type { Rotation, Route } from '../../../engine/network/types';
import { Bar } from '../../components/ui';
import { int, money, moneyDelta } from '../../format';
import { store } from '../../store';
import { net, type SectorLive } from './netApi';
import { cargoLine, kg, lfTone, marketOf, routeCode, routeName, sectorLoad, seatsLine } from './networkLogic';

/** The route, rotation and sector of a route flight (undefined for any other flight). */
export function routeOfFlight(g: GameState, f: Flight | undefined): { route: Route; rot: Rotation; idx: number } | undefined {
  const s = f?.sched;
  if (!s) return undefined;
  const route = g.network?.routes[s.routeId];
  const rot = route?.rotations.find((x) => x.id === s.rotId);
  return route && rot && rot.sectors[s.idx] ? { route, rot, idx: s.idx } : undefined;
}

/** A rotation by id (any route). */
export function rotationOfId(g: GameState, rotId: string): { route: Route; rot: Rotation } | undefined {
  for (const route of Object.values(g.network?.routes ?? {})) {
    const rot = route.rotations.find((x) => x.id === rotId);
    if (rot) return { route, rot };
  }
  return undefined;
}

/** The sector's figures: the engine's live numbers when it has them, else what the rotation holds. */
export function sectorFigures(g: GameState, f: Flight): SectorLive | null {
  const live = net.sectorLive(g, f.id);
  if (live) return live;
  const at = routeOfFlight(g, f);
  if (!at) return null;
  const s = at.rot.sectors[at.idx];
  const l = sectorLoad(s);
  const flown = s.flownY !== undefined || s.flownJ !== undefined;
  return {
    paxJ: l.bookedJ, paxY: l.bookedY, seatsJ: s.capJ, seatsY: s.capY, lf: l.lf, cargoKg: s.cargoKg, aviKg: s.aviKg ?? 0, mailKg: s.mailKg,
    revenue: s.rev ?? 0, cost: s.cost ?? 0, profit: (s.rev ?? 0) - (s.cost ?? 0), flown,
  };
}

const loadOf = (x: SectorLive) => ({ bookedJ: x.paxJ, bookedY: x.paxY, capJ: x.seatsJ, capY: x.seatsY, lf: x.lf });

/** Flight sheet (BlockSheet): the §J.1 block and the rotation's actions. */
export function SectorBlock({ g, f }: { g: GameState; f: Flight }) {
  const at = routeOfFlight(g, f);
  const x = at ? sectorFigures(g, f) : null;
  if (!at || !x) return null;
  const { route, rot } = at;
  const live = f.status === 'scheduled' && rot.status !== 'cancelled';
  const word = x.flown ? 'flown' : 'booked so far';
  return (
    <div className="nwl-block">
      <div className="row between gap-8">
        <span className="upper dim row gap-6"><RouteIcon className="sc-ico-s" /> {routeName(route)}</span>
        <button className="btn btn-sm btn-ghost" onClick={() => store.openModal({ kind: 'route', routeId: route.id })}>Route page</button>
      </div>
      <div className="nwl-load">
        <Bar value={x.lf} tone={lfTone(x.lf)} size="thin" />
        <span className="small num">{seatsLine(loadOf(x))} <span className="muted">{word}</span></span>
      </div>
      {x.cargoKg > 0 && <div className="small muted">{cargoLine({ cargoKg: x.cargoKg, aviKg: x.aviKg, mailKg: x.mailKg })}</div>}
      <div className="small">
        Revenue {money(x.revenue)} · costs {money(x.cost)} · <b className={x.profit >= 0 ? 'good' : 'bad'}>result {moneyDelta(x.profit)}</b>
        {!x.flown && <span className="tiny muted"> (estimate)</span>}
      </div>
      {live && (
        <div className="row wrap gap-8">
          <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'rotationMove', rotId: rot.id, delta: 0 })}><CalendarClock /> Move rotation</button>
          <button className="btn btn-sm btn-danger" onClick={() => confirmCancelRotation(g, route, rot)}><CircleSlash /> Cancel rotation</button>
        </div>
      )}
    </div>
  );
}

/** Map aircraft card (flat and globe): passengers by class, load, cargo and profit of the flight now; the next sector's bookings. */
export function RouteLive({ g, f }: { g: GameState; f: Flight }) {
  const at = routeOfFlight(g, f);
  const x = at ? sectorFigures(g, f) : null;
  if (!at || !x) return null;
  const n = x.next;
  return (
    <div className="nwl-live">
      <div className="nwl-live-head"><RouteIcon className="sc-ico-s accent" /><span className="small ellipsis">{routeName(at.route)}</span></div>
      <div className="nwl-grid">
        {(x.seatsJ > 0 || x.paxJ > 0) && <div><span>Business</span><b className="num">{x.paxJ}/{x.seatsJ}</b></div>}
        <div><span>Economy</span><b className="num">{x.paxY}/{x.seatsY}</b></div>
        <div><span>Load</span><b className={`num ${lfTone(x.lf)}`}>{Math.round(x.lf * 100)} %</b></div>
        <div><span>Cargo</span><b className="num">{kg(x.cargoKg)}{x.aviKg ? <span className="tiny muted"> · AVI {kg(x.aviKg)}</span> : null}</b></div>
        <div className="nwl-wide"><span>{x.flown ? 'Result' : 'Profit (estimate)'}</span><b className={`num ${x.profit >= 0 ? 'good' : 'bad'}`}>{moneyDelta(x.profit)}</b><span className="tiny muted">{money(x.revenue)} in · {money(x.cost)} out</span></div>
      </div>
      {n && (
        <div className="nwl-next small">
          <span className="muted">Next <span className="mono">{n.flightNo}</span> {fmtWeekdayTime(n.std)}:</span>{' '}
          <span className="num">{n.seatsJ ? `J ${n.bookedJ}/${n.seatsJ} · ` : ''}Y {n.bookedY}/{n.seatsY}</span>
          <span className={`num ${n.vsCurve >= 0 ? 'good' : 'warn'}`}> · {Math.round(n.lfForecast * 100)} % expected{n.vsCurve ? ` (${n.vsCurve > 0 ? 'ahead of' : 'behind'} the usual pace)` : ''}</span>
        </div>
      )}
    </div>
  );
}

/** One-line hint for the Schedule bubble while dragging a route flight along its row. */
export function dragLine(g: GameState, rotId: string, delta: number): { text: string; ok: boolean } {
  const at = rotationOfId(g, rotId);
  if (!at) return { text: 'This rotation is no longer planned', ok: false };
  if (!delta) return { text: `${routeName(at.route)}: slide it earlier or later`, ok: true };
  const q = net.quoteMove(g, rotId, delta);
  const dep = at.rot.dep + delta;
  const head = `${fmtDay(dep)} ${fmtTime(dep)} UTC · ${fmtTime(dep, at.rot.sectors[0]?.from ?? g.company.homeBase)} local`;
  return q.ok ? { text: `${head} · ${q.cost > 0 ? `about ${money(q.cost)}` : 'no cost'}`, ok: true } : { text: `${head} · ${q.why ?? 'not possible'}`, ok: false };
}

export function confirmCancelRotation(g: GameState, r: Route, rot: Rotation) {
  const q = net.quoteCancel(g, rot.id);
  const pax = rot.sectors.reduce((a, s) => a + s.bookedJ + s.bookedY, 0);
  const days = Math.max(0, Math.round((rot.dep - g.now) / DAY));
  store.openModal({
    kind: 'confirm', danger: true, title: `Cancel ${routeCode(marketOf(r))} on ${fmtDay(rot.dep)}?`, confirm: 'Cancel the rotation',
    body: `${pax ? `${int(pax)} booked passengers are refunded or rebooked` : 'No one is booked yet'}${q ? `; it costs about ${money(q.cost)}` : ''}${days < 14 ? ` (${days} days' notice: more than with 14 days or more)` : ''}.${q?.subBack !== undefined ? ` Another operator was to fly it: ${money(q.subBack)} of its price comes back, it keeps ${money(q.subFee ?? 0)}.` : ''} A cancelled flight counts against the slot rule.`,
    onConfirm: () => store.act((gg) => (net.cancel(gg, rot.id) ? { ok: true, msg: 'Rotation cancelled' } : { ok: false, error: 'Could not cancel it' })),
  });
}


/** §K the map's routes overlay: each operating (or on-sale) route's sectors as a faint dashed line, under everything. */
export function routeSectors(g: GameState): { id: string; from: string; to: string }[] {
  const out = new Map<string, { id: string; from: string; to: string }>();
  for (const r of Object.values(g.network?.routes ?? {})) {
    if (r.status !== 'operating' && r.status !== 'onSale') continue;
    const m = marketOf(r);
    if (!m) continue;
    const chain = [m.from, ...(m.via ?? []), m.to];
    const back = [m.to, ...(m.viaBack ?? []), m.from];
    for (const c of [chain, back]) for (let i = 1; i < c.length; i++) {
      const [a, b] = [c[i - 1], c[i]].sort();
      out.set(`${a}-${b}`, { id: `${a}-${b}`, from: a, to: b });
    }
  }
  return [...out.values()];
}

export const RouteLinesLayer = memo(function RouteLinesLayer({ lines, proj }: { lines: { id: string; from: string; to: string }[]; proj: GeoProjection }) {
  const path = useMemo(() => geoPath(proj), [proj]);
  if (!lines.length) return null;
  return (
    <g className="nw-map-routes" pointerEvents="none">
      {lines.map((l) => {
        const A = AIRPORT_BY_CODE[l.from];
        const B = AIRPORT_BY_CODE[l.to];
        const d = A && B ? path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] }) : null;
        return d ? <path key={l.id} d={d} fill="none" stroke="var(--accent)" strokeOpacity={0.32} strokeWidth={1.3} strokeDasharray="2 5" strokeLinecap="round" /> : null;
      })}
    </g>
  );
});
