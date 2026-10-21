// Ops Map (B4): the calm, full-bleed live map (DESIGN.md §6.2). Night terminator and the selected
// aircraft's arcs under the airports; offer pins and every aircraft above, drawn where it really is
// (parked at a stand, in the hangar, or gliding along its great circle to its eta). Right-hand
// panels for the selection, a fleet strip bottom left and an "up next" card top left.
// v0.5.2: every airborne leg shows its path (typed: operating / positioning / ferry), airline legs our crew
// ride are grey icons with their flight number; Up Next and the panels carry the same type labels.
// v0.7: aircraft appear at their handover site once handed over (DELIVERY tag until home); a selected aircraft's
// arcs show its whole delivery / return / refit ferry chain.

import { Users } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { commercialFlightsBetween, FLIGHT_TYPE_HINT, FLIGHT_TYPE_LABEL, FLIGHT_TYPES } from '../../engine/ops';
import { store, useClock, useGame } from '../store';
import { AircraftLayer, ArcsLayer, CommercialLayer, HIT_R, type LiveShared, NightLayer, newShared, PathsLayer, PinsLayer, pinOffset } from './LiveLayers';
import { MapPanel, TypeKey } from './MapPanels';
import { chipInfo, fitCodes, onMap, fitFresh, isCommercialId, mapAirports, offerPins, pickNearest, selectedLegs, upNextRows } from './mapLogic';
import { type MapAirport, type MapLayerCtx, type Pad, type View, WorldMap } from './WorldMap';

/** Panel width (px) kept clear when revealing a selection, and the fleet strip's height. */
const PANEL_W = 360;
const STRIP_H = 70;
/** View per game, so a tab switch returns to the same framing. */
const views = new WeakMap<GameState, { view: View | null }>();

/** Full chips (172 px) up to this many aircraft (fewer with the panel open), compact ones (112 px) beyond. */
const FULL_CHIPS = 5;

function FleetStrip({ g, sel, panelOpen }: { g: GameState; sel?: Ref; panelOpen: boolean }) {
  const list = Object.values(g.fleet);
  if (!list.length) return null;
  // Fixed-width chips: the hourly status text never reflows the strip.
  const compact = list.length > (panelOpen ? FULL_CHIPS - 1 : FULL_CHIPS);
  return (
    <div className={`ops-strip ${compact ? 'compact' : ''}`} role="list" aria-label="Fleet">
      {list.map((ac) => {
        const ci = chipInfo(g, ac, g.now);
        const on = sel?.kind === 'aircraft' && sel.id === ac.id;
        return (
          <button key={ac.id} role="listitem" className={`ops-chip ${on ? 'on' : ''}`} title={`${ac.reg} · ${ci.line}`} onClick={() => store.select(on ? undefined : { kind: 'aircraft', id: ac.id })}>
            <span className={`op-dot ${ci.tone}`} aria-hidden />
            <span className="ops-chip-t">
              <b className="mono">{ac.reg}</b>
              <span className="small muted mono">{compact ? ci.short : ci.line}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Whole UTC days from `now` to `t` (0 = today), shown as +1 after a time on a later day. */
const dayOff = (now: number, t: number) => Math.floor(t / DAY) - Math.floor(now / DAY);

/** '07:00', '07:00+1' tomorrow, '5 Apr 07:00' further out. */
function depLabel(now: number, t: number) {
  const d = dayOff(now, t);
  if (d > 1) return <>{fmtDay(t)} {fmtTime(t)}</>;
  return <>{fmtTime(t)}{d === 1 && <sup className="dim">+1</sup>}</>;
}

function UpNext({ g }: { g: GameState }) {
  // Steps with the clock label (10–30 game min), so a leg that has gone drops out between hourly emits.
  const now = useClock();
  const list = upNextRows(g, 4, now);
  if (!list.length) return null;
  const dated = list.some((r) => dayOff(now, r.t) > 1);
  return (
    <div className={`ops-next card ${dated ? 'dated' : ''}`} aria-label="Up next">
      <div className="upper dim">Up next</div>
      {list.map((r) => (
        <button key={r.id} className={`ops-next-row ${r.type}`} onClick={() => r.sel && store.select(r.sel)} title={FLIGHT_TYPE_HINT[r.type]}>
          <span className="mono">{depLabel(now, r.t)}</span>
          <b className="mono ellipsis">{r.who}</b>
          <span className="mono muted">{r.from}→{r.to}</span>
          <span className={`ops-type ${r.type}`}><TypeKey type={r.type} />{FLIGHT_TYPE_LABEL[r.type]}{r.crew ? <span className="ops-type-n" aria-label={`${r.crew} crew`}><Users aria-hidden />{r.crew}</span> : null}</span>
        </button>
      ))}
      <div className="ops-legend" aria-label="Flight types">
        {FLIGHT_TYPES.map((t) => <span key={t} title={FLIGHT_TYPE_HINT[t]}><TypeKey type={t} />{FLIGHT_TYPE_LABEL[t]}</span>)}
      </div>
    </div>
  );
}

export function OpsMap() {
  const g = useGame();
  const sel = store.nav.sel;
  const selCm = sel?.kind === 'flight' && isCommercialId(sel.id) ? sel.id : undefined;
  const panelOpen = !!sel && (sel.kind === 'aircraft' || sel.kind === 'airport' || sel.kind === 'offer' || !!selCm);
  const sharedRef = useRef<LiveShared | null>(null);
  const shared = (sharedRef.current ??= newShared());
  let memo = views.get(g);
  if (!memo) views.set(g, (memo = { view: null }));

  const hour = Math.floor(g.now / 60);
  const v = store.version;
  const apList = useMemo(() => mapAirports(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(() => offerPins(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const legs = useMemo(() => (sel?.kind === 'aircraft' ? selectedLegs(g, sel.id) : []), [g, hour, v, sel?.kind, sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextArcs = useMemo(() => legs.filter((l) => !l.current), [legs]);
  const marked = useMemo(() => new Set(apList.filter((a) => a.label).map((a) => a.code)), [apList]);
  const selAp = sel?.kind === 'airport' ? sel.id : undefined;
  // Ends of the airline legs our crew ride this hour (dots; codes when selected).
  const cmAps = useMemo(() => {
    const h0 = hour * 60;
    const out = new Map<string, boolean>();
    for (const cf of commercialFlightsBetween(g, h0, h0 + 60)) for (const c of [cf.leg.from, cf.leg.to]) out.set(c, (out.get(c) ?? false) || cf.id === selCm);
    return out;
  }, [g, hour, v, selCm]); // eslint-disable-line react-hooks/exhaustive-deps
  const airports: MapAirport[] = useMemo(() => {
    const legAps = new Set(legs.flatMap((l) => [l.from, l.to]));
    const out: MapAirport[] = apList.map((a) => ({ code: a.code, state: a.hub ? 'hub' : 'served', label: a.label || legAps.has(a.code) || !!cmAps.get(a.code) }));
    for (const c of legAps) if (!apList.some((a) => a.code === c)) out.push({ code: c, state: 'served', label: true });
    for (const [c, lab] of cmAps) if (AIRPORT_BY_CODE[c] && !out.some((a) => a.code === c)) out.push({ code: c, state: 'served', label: lab });
    if (selAp && !out.some((a) => a.code === selAp)) out.push({ code: selAp, state: 'served', label: true });
    return out;
  }, [apList, legs, selAp, cmAps]);

  /** Airports and projection shared.aps was built for (rebuilt only when they change). */
  const apsFor = useRef<{ a: MapAirport[] | null; proj: MapLayerCtx['proj'] | null }>({ a: null, proj: null });
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
    for (const [id, p] of shared.cm) items.push({ x: p[0], y: p[1], item: { kind: 'flight', id } });
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
  const fitCentre = useCallback(() => (fitFresh(refs.current.g) ? refs.current.g.company.homeBase : undefined), []);
  const revealPad = useCallback((): Pad => [12, store.nav.sel ? PANEL_W + 40 : 12, STRIP_H + 8, 12], []);

  const focusKey = sel && panelOpen ? `${sel.kind}:${sel.id}` : '';
  const focus = useMemo(() => {
    if (!sel || !focusKey) return null;
    return {
      key: focusKey,
      at: (): [number, number] | null => {
        if (sel.kind === 'aircraft') {
          // Not on the map yet (before a handover abroad): reveal where it will be handed over.
          const at = shared.ac.get(sel.id);
          if (at) return at;
          const ac = refs.current.g.fleet[sel.id];
          const a = ac && !onMap(ac) ? AIRPORT_BY_CODE[ac.at] : undefined;
          return (a && refs.current.proj?.([a.lon, a.lat])) || null;
        }
        if (sel.kind === 'flight') return shared.cm.get(sel.id) ?? null;
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
        fitCentre={fitCentre}
        fitPad={[24, 24, STRIP_H, 24]}
        animate={false}
        accent={g.company.livery.secondary}
        selected={sel?.kind === 'airport' ? sel.id : null}
        onSelect={onSelect}
        onTap={onTap}
        revealPad={revealPad}
        focus={focus}
        memo={memo}
        backdrop={(ctx) => <NightLayer shared={shared} proj={ctx.proj} shift={ctx.backShift} />}
        underlay={(ctx) => {
          refs.current.proj = ctx.proj;
          if (apsFor.current.a !== airports || apsFor.current.proj !== ctx.proj) {
            apsFor.current = { a: airports, proj: ctx.proj };
            shared.aps = airports.flatMap((a) => {
              const ap = AIRPORT_BY_CODE[a.code];
              const p = ap && ctx.proj([ap.lon, ap.lat]);
              return p ? [p] : [];
            });
          }
          // The current leg is always drawn by the live paths; the arcs add the selected aircraft's next legs.
          return (
            <>
              <PathsLayer shared={shared} />
              <ArcsLayer legs={nextArcs} proj={ctx.proj} />
            </>
          );
        }}
        layers={(ctx) => (
          <>
            <PinsLayer pins={pins} marked={marked} proj={ctx.proj} unit={ctx.unit} selected={selPin} />
            <CommercialLayer shared={shared} />
            <AircraftLayer ctx={ctx} g={g} shared={shared} selected={selAc} selectedFlight={selCm} />
          </>
        )}
      />
      <UpNext g={g} />
      <FleetStrip g={g} sel={sel} panelOpen={panelOpen} />
      <MapPanel g={g} sel={sel} />
    </div>
  );
}
