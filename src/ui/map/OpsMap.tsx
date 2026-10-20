// Ops Map (B4): the calm, full-bleed live map (DESIGN.md §6.2). Night terminator and the selected
// aircraft's arcs under the airports; offer pins and every aircraft above, drawn where it really is
// (parked at a stand, in the hangar, or gliding along its great circle to its eta). Right-hand
// panels for the selection, a fleet strip bottom left and an "up next" card top left.

import { useCallback, useMemo, useRef } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { DAY, fmtTime } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { store, useGame } from '../store';
import { AircraftLayer, ArcsLayer, HIT_R, type LiveShared, NightLayer, newShared, PinsLayer, pinOffset } from './LiveLayers';
import { MapPanel } from './MapPanels';
import { chipInfo, fitCodes, mapAirports, offerPins, pickNearest, selectedLegs, upNext } from './mapLogic';
import { type MapAirport, type MapLayerCtx, type Pad, type View, WorldMap } from './WorldMap';

/** Panel width (px) kept clear when revealing a selection, and the fleet strip's height. */
const PANEL_W = 360;
const STRIP_H = 70;
/** View per game, so a tab switch returns to the same framing. */
const views = new WeakMap<GameState, { view: View | null }>();

function FleetStrip({ g, sel }: { g: GameState; sel?: Ref }) {
  const list = Object.values(g.fleet);
  if (!list.length) return null;
  return (
    <div className="ops-strip" role="list" aria-label="Fleet">
      {list.map((ac) => {
        const ci = chipInfo(g, ac, g.now);
        const on = sel?.kind === 'aircraft' && sel.id === ac.id;
        return (
          <button key={ac.id} role="listitem" className={`ops-chip ${on ? 'on' : ''}`} onClick={() => store.select(on ? undefined : { kind: 'aircraft', id: ac.id })}>
            <span className={`op-dot ${ci.tone}`} aria-hidden />
            <span className="ops-chip-t">
              <b className="mono">{ac.reg}</b>
              <span className="small muted mono">{ci.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Whole UTC days from `now` to `t` (0 = today), shown as +1 after a time on a later day. */
const dayOff = (now: number, t: number) => Math.floor(t / DAY) - Math.floor(now / DAY);

function UpNext({ g }: { g: GameState }) {
  const list = upNext(g, 3);
  if (!list.length) return null;
  return (
    <div className="ops-next card" aria-label="Up next">
      <div className="upper dim">Up next</div>
      {list.map((f) => (
        <button key={f.id} className="ops-next-row" onClick={() => f.aircraftId && store.select({ kind: 'aircraft', id: f.aircraftId })}>
          <span className="mono">{fmtTime(f.std + f.delay)}{dayOff(g.now, f.std + f.delay) > 0 && <sup className="dim">+{dayOff(g.now, f.std + f.delay)}</sup>}</span>
          <b className="mono">{f.aircraftId ? g.fleet[f.aircraftId]?.reg : f.no}</b>
          <span className="mono muted">{f.from}→{f.to}</span>
        </button>
      ))}
    </div>
  );
}

export function OpsMap() {
  const g = useGame();
  const sel = store.nav.sel;
  const panelOpen = !!sel && (sel.kind === 'aircraft' || sel.kind === 'airport' || sel.kind === 'offer');
  const sharedRef = useRef<LiveShared | null>(null);
  const shared = (sharedRef.current ??= newShared());
  let memo = views.get(g);
  if (!memo) views.set(g, (memo = { view: null }));

  const hour = Math.floor(g.now / 60);
  const v = store.version;
  const apList = useMemo(() => mapAirports(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(() => offerPins(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const legs = useMemo(() => (sel?.kind === 'aircraft' ? selectedLegs(g, sel.id) : []), [g, hour, v, sel?.kind, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const marked = useMemo(() => new Set(apList.filter((a) => a.label).map((a) => a.code)), [apList]);
  const selAp = sel?.kind === 'airport' ? sel.id : undefined;
  const airports: MapAirport[] = useMemo(() => {
    const legAps = new Set(legs.flatMap((l) => [l.from, l.to]));
    const out: MapAirport[] = apList.map((a) => ({ code: a.code, state: a.hub ? 'hub' : 'served', label: a.label || legAps.has(a.code) }));
    for (const c of legAps) if (!apList.some((a) => a.code === c)) out.push({ code: c, state: 'served', label: true });
    if (selAp && !out.some((a) => a.code === selAp)) out.push({ code: selAp, state: 'served', label: true });
    return out;
  }, [apList, legs, selAp]);

  const refs = useRef({ g, pins, marked, airports, proj: null as MapLayerCtx['proj'] | null });
  refs.current.g = g;
  refs.current.pins = pins;
  refs.current.marked = marked;
  refs.current.airports = airports;

  /** Map point of a pin group (its screen-px offset scaled by map units per px). */
  const pinPoint = (code: string, unit: number): [number, number] | null => {
    const a = AIRPORT_BY_CODE[code];
    const q = a && refs.current.proj?.([a.lon, a.lat]);
    if (!q) return null;
    const [ox, oy] = pinOffset(refs.current.marked.has(code));
    return [q[0] + ox * unit, q[1] + oy * unit];
  };

  // The nearest aircraft, offer pin or airport dot within a finger's reach wins; airports fall through to WorldMap.
  const onTap = useCallback((m: [number, number], unit: number, finger: boolean) => {
    const r = (finger ? HIT_R.touch : HIT_R.mouse) * unit;
    const { g: game, pins: pinList, airports: aps, proj } = refs.current;
    type Hit = { x: number; y: number; item: Ref | null };
    const items: Hit[] = [];
    for (const [id, p] of shared.ac) if (game.fleet[id]) items.push({ x: p[0], y: p[1], item: { kind: 'aircraft', id } });
    for (const p of pinList) {
      const q = pinPoint(p.code, unit);
      if (q) items.push({ x: q[0], y: q[1], item: p.offers.length === 1 ? { kind: 'offer', id: p.offers[0].id } : { kind: 'airport', id: p.code } });
    }
    for (const a of aps) {
      const ap = AIRPORT_BY_CODE[a.code];
      const q = ap && proj?.([ap.lon, ap.lat]);
      if (q) items.push({ x: q[0], y: q[1], item: null });
    }
    const hit = pickNearest(items, m[0], m[1], r);
    if (!hit) return false;
    store.select(hit);
    return true;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onSelect = useCallback((code: string | null) => store.select(code ? { kind: 'airport', id: code } : undefined), []);
  const fitFn = useCallback(() => fitCodes(refs.current.g), []);
  const revealPad = useCallback((): Pad => [12, store.nav.sel ? PANEL_W + 40 : 12, STRIP_H + 8, 12], []);

  const focusKey = sel && panelOpen ? `${sel.kind}:${sel.id}` : '';
  const focus = useMemo(() => {
    if (!sel || !focusKey) return null;
    return {
      key: focusKey,
      at: (): [number, number] | null => {
        if (sel.kind === 'aircraft') return shared.ac.get(sel.id) ?? null;
        if (sel.kind === 'airport') {
          const a = AIRPORT_BY_CODE[sel.id];
          return (a && refs.current.proj?.([a.lon, a.lat])) || null;
        }
        const o = refs.current.g.offers[sel.id];
        return o ? pinPoint(o.pin, 0) : null;
      },
    };
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const selAc = sel?.kind === 'aircraft' ? sel.id : undefined;
  const selPin = sel?.kind === 'offer' || sel?.kind === 'airport' ? sel.id : undefined;

  return (
    <div className={`ops-map ${panelOpen ? 'panel-open' : ''}`}>
      <WorldMap
        routes={[]}
        airports={airports}
        fitFn={fitFn}
        fitPad={[24, 24, STRIP_H, 24]}
        animate={false}
        accent={g.company.livery.secondary}
        selected={sel?.kind === 'airport' ? sel.id : null}
        onSelect={onSelect}
        onTap={onTap}
        revealPad={revealPad}
        focus={focus}
        memo={memo}
        underlay={(ctx) => {
          refs.current.proj = ctx.proj;
          return (
            <>
              <NightLayer shared={shared} proj={ctx.proj} />
              <ArcsLayer legs={legs} proj={ctx.proj} />
            </>
          );
        }}
        layers={(ctx) => (
          <>
            <PinsLayer pins={pins} marked={marked} proj={ctx.proj} unit={ctx.unit} selected={selPin} />
            <AircraftLayer ctx={ctx} g={g} shared={shared} selected={selAc} />
          </>
        )}
      />
      <UpNext g={g} />
      <FleetStrip g={g} sel={sel} />
      <MapPanel g={g} sel={sel} />
    </div>
  );
}
