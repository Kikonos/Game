// Ops Map (B4): the calm, full-bleed live map (DESIGN.md §6.2). Night terminator and the selected
// aircraft's arcs under the airports; offer pins and every aircraft above, drawn where it really is
// (parked at a stand, in the hangar, or gliding along its great circle to its eta). Right-hand
// panels for the selection, a fleet strip bottom left and an "up next" card top left.
// v0.5.2: every airborne leg shows its path (typed: operating / positioning / ferry), airline legs our crew
// ride are grey icons with their flight number; Up Next and the panels carry the same type labels.
// v0.7: aircraft appear at their handover site once handed over (DELIVERY tag until home); a selected aircraft's
// arcs show its whole delivery / return / refit ferry chain.
// v0.7.2: Up Next is a compact departures board (5 rows, grid lines, the "?" legend in its header) that folds away.
// v0.8: world-event zones painted with the land (static), their labels and event pins (tap → event panel); a
// dry-leased-out aircraft stands at the lessee's base in their paint with a LEASED tag.
// v0.9: CREW OUT OF HOURS beside CREW SHORT (Up Next, fleet chips, legend); a selected aircraft's crew changes at a fuel
// stop (slip crews' airline legs and a tappable crew-change mark, static; panel per crew change).

import { ArrowLeftRight, ChevronDown, ChevronUp, HelpCircle, TimerOff, Users, X } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { DAY, fmtDay, fmtTime } from '../../engine/core/time';
import type { GameState, Ref } from '../../engine/core/types';
import { slipsOfAircraft } from '../../engine/crew';
import { commercialFlightsBetween, FLIGHT_TYPE_HINT, FLIGHT_TYPE_LABEL, worldEventPins, worldZones } from '../../engine/ops';
import { store, useClock, useGame } from '../store';
import { useTouch } from '../useMedia';
import { AircraftLayer, ArcsLayer, CommercialLayer, HIT_R, type LiveShared, NightLayer, newShared, PathsLayer, PinsLayer, pinOffset, SlipArcsLayer, SlipMarksLayer } from './LiveLayers';
import { MapPanel, TypeKey } from './MapPanels';
import { ALERT_CHIP, awaitingDelivery, chipInfo, commercialById, fitCodes, onMap, fitFresh, isCommercialId, JET_PATH, mapAirports, offerPins, parseSlipId, pickNearest, placeEventPins, placeSlipMarks, selectedLegs, shortIndex, slipArcs, slipWindow, upNextRows } from './mapLogic';
import { EventPinsLayer, hatchUnit, ZoneGround, ZoneLabels } from './WorldLayer';
import { type FocusAt, type MapAirport, type MapLayerCtx, type Pad, type View, WorldMap } from './WorldMap';

/** Panel width (px) kept clear when revealing a selection, and the fleet strip's height. */
const PANEL_W = 360;
const STRIP_H = 70;
/** Screen px around an aircraft icon its labels can reach (left, top, right, bottom: reg and DELIVERY tag under it). */
const AC_LABEL_BOX: [number, number, number, number] = [36, 20, 36, 46];
/** Never let a half-built engine view take the map down. */
function safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** The aircraft of a crew-change selection id. */
const slipAcOf = (g: GameState, id: string) => {
  const f = parseSlipId(id);
  return f ? g.flights[f]?.aircraftId ?? undefined : undefined;
};

/** View per game, so a tab switch returns to the same framing. */
const views = new WeakMap<GameState, { view: View | null }>();

/** Full chips (172 px) up to this many aircraft (fewer with the panel open), compact ones (112 px) beyond. */
const FULL_CHIPS = 5;

function FleetStrip({ g, sel, panelOpen }: { g: GameState; sel?: Ref; panelOpen: boolean }) {
  const list = Object.values(g.fleet);
  if (!list.length) return null;
  // Fixed-width chips: the hourly status text never reflows the strip.
  const compact = list.length > (panelOpen ? FULL_CHIPS - 1 : FULL_CHIPS);
  // v0.7.1: a crew-short flight turns its aircraft's chip amber/red ("CREW SHORT 08:34").
  const short = shortIndex(g).byAircraft;
  return (
    <div className={`ops-strip ${compact ? 'compact' : ''}`} role="list" aria-label="Fleet">
      {list.map((ac) => {
        const ci = chipInfo(g, ac, g.now, short.get(ac.id));
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

/** v0.7.1 colour legend for the map's crew layer: what the lines, icons, dots and chips mean. */
const LEGEND: { swatch: ReactNode; label: string }[] = [
  { swatch: <TypeKey type="operating" />, label: 'Solid green: our aircraft flying passengers' },
  { swatch: <TypeKey type="positioning" />, label: 'Dotted amber: our aircraft flying empty (positioning or ferry)' },
  { swatch: <TypeKey type="deadhead" />, label: 'Thin dotted grey: our crew riding an airline or a private jet' },
  { swatch: <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden><path d={JET_PATH} fill="#848ea2" stroke="#d3d9e4" strokeWidth={1.5} /></svg>, label: 'Grey icon: an airline flight or a private jet (their aircraft, our crew)' },
  { swatch: <span className="op-dot good" />, label: 'Green dot: the flight has a legal crew' },
  { swatch: <span className="op-dot warn" />, label: 'Amber: tight, or a crew shortage two days out' },
  { swatch: <span className="op-dot bad" />, label: 'Red: no legal crew, under 12 hours to go (CREW SHORTAGE)' },
  { swatch: <TimerOff className="ops-help-ooh" aria-hidden />, label: 'Crew out of hours: someone rostered has reached a legal limit' },
  { swatch: <ArrowLeftRight className="ops-help-slip" aria-hidden />, label: 'Crew change at a fuel stop: a fresh crew flies in and takes over' },
  { swatch: <span className="op-dot air" />, label: 'Blue: airborne' },
  { swatch: <span className="op-dot" />, label: 'Grey chip: idle, or a delivery not yet started' },
  { swatch: <span className="ops-help-ap" />, label: 'White dot: an airport we fly to, or where our crew are at a hotel' },
];

function MapLegend() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Any tap elsewhere closes it.
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', off, true);
    return () => document.removeEventListener('pointerdown', off, true);
  }, [open]);
  return (
    <div className="ops-help" ref={ref}>
      <button className="btn btn-ghost btn-icon ops-help-btn" onClick={() => setOpen((v) => !v)} aria-label="What the colours mean" aria-expanded={open} title="What the colours mean"><HelpCircle /></button>
      {open && (
        <div className="ops-help-pop card" role="dialog" aria-label="What the colours mean">
          <div className="row between ops-help-h"><span className="upper dim">What the colours mean</span><button className="btn btn-ghost btn-icon" onClick={() => setOpen(false)} aria-label="Close"><X /></button></div>
          {LEGEND.map((l, i) => <div key={i} className="ops-help-row"><span className="ops-help-sw">{l.swatch}</span><span>{l.label}</span></div>)}
        </div>
      )}
    </div>
  );
}

/** Up Next fold: a per-viewer convenience (browser storage can be missing or blocked; defaults open). */
const FOLD_KEY = 'bh:upNextCollapsed';
const readFold = () => {
  try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; }
};
const writeFold = (v: boolean) => {
  try { if (v) localStorage.setItem(FOLD_KEY, '1'); else localStorage.removeItem(FOLD_KEY); } catch { /* not stored */ }
};

/** Up Next rows (a departures board). */
const NEXT_ROWS = 5;

function UpNext({ g }: { g: GameState }) {
  // Steps with the clock label (10–30 game min), so a leg that has gone drops out between hourly emits.
  const now = useClock();
  const [folded, setFolded] = useState(readFold);
  const list = upNextRows(g, NEXT_ROWS, now);
  if (!list.length) return null;
  const dated = list.some((r) => dayOff(now, r.t) > 1);
  const fold = () => setFolded((v) => { writeFold(!v); return !v; });
  return (
    <div className={`ops-next card${dated ? ' dated' : ''}${folded ? ' folded' : ''}`} aria-label="Up next">
      <div className="ops-next-h">
        <span className="upper dim">Up next</span>
        <MapLegend />
        <button className="btn btn-ghost btn-icon ops-next-fold" onClick={fold} aria-expanded={!folded} aria-label={folded ? 'Show up next' : 'Fold up next'} title={folded ? 'Show' : 'Fold'}>
          {folded ? <ChevronDown /> : <ChevronUp />}
        </button>
      </div>
      {!folded && (
        <div className="ops-next-grid" role="list">
          {list.map((r) => (
            // v0.7.1: a private jet row names the jet type under "Private jet"; a crew-short flight carries the CREW SHORT chip.
            <button key={r.id} role="listitem" className={`ops-next-row ${r.type}${r.jet ? ' jet' : ''}`} onClick={() => r.sel && store.select(r.sel)} title={r.jet ? 'A chartered private jet positioning our crew' : FLIGHT_TYPE_HINT[r.type]}>
              <span className="mono">{depLabel(now, r.t)}</span>
              <b className={`ellipsis${r.jet ? '' : ' mono'}`}>{r.who}</b>
              <span className="mono muted">{r.from}→{r.to}</span>
              <span className={`ops-type ${r.type}`}>
                <TypeKey type={r.type} />
                {r.alert ? <span className={`ops-short ${r.alert}`}>{ALERT_CHIP[r.alertKind ?? 'short']}</span> : r.jet ? 'Private jet' : FLIGHT_TYPE_LABEL[r.type]}
                {r.crew ? <span className="ops-type-n" aria-label={`${r.crew} crew`}><Users aria-hidden />{r.crew}</span> : null}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function OpsMap() {
  const touch = useTouch();
  const g = useGame();
  const sel = store.nav.sel;
  const selCm = sel?.kind === 'flight' && isCommercialId(sel.id) ? sel.id : undefined;
  // v0.9 a crew change (slip at a fuel stop): its panel keeps the aircraft's arcs and slip legs on the map.
  const selSlip = sel?.kind === 'flight' ? parseSlipId(sel.id) : null;
  const slipAc = selSlip ? g.flights[selSlip]?.aircraftId ?? undefined : undefined;
  const arcAc = sel?.kind === 'aircraft' ? sel.id : slipAc;
  const panelOpen = !!sel && (sel.kind === 'aircraft' || sel.kind === 'airport' || sel.kind === 'offer' || sel.kind === 'event' || !!selCm || !!selSlip);
  const sharedRef = useRef<LiveShared | null>(null);
  const shared = (sharedRef.current ??= newShared());
  let memo = views.get(g);
  if (!memo) views.set(g, (memo = { view: null }));

  const hour = Math.floor(g.now / 60);
  const v = store.version;
  const apList = useMemo(() => mapAirports(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const pins = useMemo(() => offerPins(g), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const legs = useMemo(() => (arcAc ? selectedLegs(g, arcAc) : []), [g, hour, v, arcAc]); // eslint-disable-line react-hooks/exhaustive-deps
  const nextArcs = useMemo(() => legs.filter((l) => !l.current), [legs]);
  // v0.9 §W.4 the selected aircraft's crew changes: static marks and the slip crews' airline legs (hourly).
  const slips = useMemo(() => (arcAc ? safe(() => slipsOfAircraft(g, arcAc, ...slipWindow(g.now)), []) : []), [g, hour, v, arcAc]); // eslint-disable-line react-hooks/exhaustive-deps
  const slipMarks = useMemo(() => placeSlipMarks(slips), [slips]);
  const slipLegs = useMemo(() => safe(() => slipArcs(g, slips), []), [g, slips]); // eslint-disable-line react-hooks/exhaustive-deps
  const marked = useMemo(() => new Set(apList.filter((a) => a.label).map((a) => a.code)), [apList]);
  // v0.8 world: zones keep their array identity while unchanged (drawn once); pins step with the hourly emit.
  const zones = useMemo(() => safe(() => worldZones(g), []), [g, hour, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const evPins = useMemo(() => placeEventPins(safe(() => worldEventPins(g), []), marked, new Set(pins.map((p) => p.code))), [g, hour, v, marked, pins]); // eslint-disable-line react-hooks/exhaustive-deps
  const selEv = sel?.kind === 'event' ? sel.id : undefined;
  const selAp = sel?.kind === 'airport' ? sel.id : undefined;
  // Ends of the airline legs our crew ride this hour (dots; codes when selected).
  const cmAps = useMemo(() => {
    const h0 = hour * 60;
    const out = new Map<string, boolean>();
    for (const cf of commercialFlightsBetween(g, h0, h0 + 60)) for (const c of [cf.leg.from, cf.leg.to]) out.set(c, (out.get(c) ?? false) || cf.id === selCm);
    return out;
  }, [g, hour, v, selCm]); // eslint-disable-line react-hooks/exhaustive-deps
  const airports: MapAirport[] = useMemo(() => {
    const legAps = new Set([...legs.flatMap((l) => [l.from, l.to]), ...slipLegs.flatMap((l) => [l.from, l.to]), ...slipMarks.map((m) => m.at)]);
    const out: MapAirport[] = apList.map((a) => ({ code: a.code, state: a.hub ? 'hub' : 'served', label: a.label || legAps.has(a.code) || !!cmAps.get(a.code) }));
    for (const c of legAps) if (!apList.some((a) => a.code === c)) out.push({ code: c, state: 'served', label: true });
    for (const [c, lab] of cmAps) if (AIRPORT_BY_CODE[c] && !out.some((a) => a.code === c)) out.push({ code: c, state: 'served', label: lab });
    if (selAp && !out.some((a) => a.code === selAp)) out.push({ code: selAp, state: 'served', label: true });
    return out;
  }, [apList, legs, selAp, cmAps, slipLegs, slipMarks]);

  /** Airports and projection shared.aps was built for (rebuilt only when they change). */
  const apsFor = useRef<{ a: MapAirport[] | null; proj: MapLayerCtx['proj'] | null }>({ a: null, proj: null });
  const refs = useRef({ g, pins, evPins, slipMarks, marked, airports, proj: null as MapLayerCtx['proj'] | null });
  refs.current.g = g;
  refs.current.slipMarks = slipMarks;
  refs.current.pins = pins;
  refs.current.evPins = evPins;
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
    const { g: game, pins: pinList, evPins: evList, slipMarks: smList, airports: aps, proj } = refs.current;
    type Hit = { x: number; y: number; item: Ref | null };
    const items: Hit[] = [];
    for (const [id, p] of shared.ac) if (game.fleet[id]) items.push({ x: p[0], y: p[1], item: { kind: 'aircraft', id } });
    for (const [id, p] of shared.cm) items.push({ x: p[0], y: p[1], item: { kind: 'flight', id } });
    for (const p of pinList) {
      const q = pinPoint(p.code, unit);
      if (q) items.push({ x: q[0], y: q[1], item: p.offers.length === 1 ? { kind: 'offer', id: p.offers[0].id } : { kind: 'airport', id: p.code } });
    }
    for (const p of evList) {
      const ap = AIRPORT_BY_CODE[p.at];
      const q = ap && proj?.([ap.lon, ap.lat]);
      if (q) items.push({ x: q[0] + p.off[0] * unit, y: q[1] + p.off[1] * unit, item: { kind: 'event', id: p.eventId } });
    }
    for (const s of smList) {
      const ap = AIRPORT_BY_CODE[s.at];
      const q = ap && proj?.([ap.lon, ap.lat]);
      if (q) items.push({ x: q[0] + s.off[0] * unit, y: q[1] + s.off[1] * unit, item: { kind: 'flight', id: s.id } });
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
  const revealPad = useCallback((): Pad => {
    // v0.8: an event pin is small and often far off (Iceland, Sudan): keep it clear of the open Up Next card too.
    const s = store.nav.sel;
    let top = 12;
    if (s?.kind === 'event') {
      const card = document.querySelector('.ops-map .ops-next:not(.folded)');
      const map = document.querySelector('.ops-map');
      if (card && map) top = Math.max(top, card.getBoundingClientRect().bottom - map.getBoundingClientRect().top + 12);
    }
    return [top, s ? PANEL_W + 40 : 12, STRIP_H + 8, 12];
  }, []);

  const focusKey = sel && panelOpen ? `${sel.kind}:${sel.id}` : '';
  const focus = useMemo(() => {
    if (!sel || !focusKey) return null;
    return {
      key: focusKey,
      at: (): FocusAt | null => {
        const apPt = (code: string) => {
          const a = AIRPORT_BY_CODE[code];
          return (a && refs.current.proj?.([a.lon, a.lat])) || null;
        };
        if (sel.kind === 'aircraft') {
          // Its reg and DELIVERY tag (under a parked icon) stay clear too.
          const at = shared.ac.get(sel.id);
          if (at) return { pts: [at], box: AC_LABEL_BOX };
          // Not on the map yet (before a handover abroad): reveal where it will be handed over.
          const ac = refs.current.g.fleet[sel.id];
          return ac && !onMap(ac) ? apPt(ac.at) : null;
        }
        if (sel.kind === 'flight' && parseSlipId(sel.id)) {
          // A crew change: its mark at the fuel stop (and the aircraft, when it is on the map).
          const m = refs.current.slipMarks.find((x) => x.id === sel.id);
          const at = m && apPt(m.at);
          const ac = slipAcOf(refs.current.g, sel.id);
          const q = ac ? shared.ac.get(ac) : undefined;
          return at ? { pts: q ? [at, q] : [at], box: [40 - m.off[0], 40, 40, 40 + m.off[1]] } : null;
        }
        if (sel.kind === 'flight') {
          // An airline leg: the icon first, then where it lands and any aircraft our crew are going to collect there.
          const at = shared.cm.get(sel.id);
          if (!at) return null;
          const cf = commercialById(refs.current.g, sel.id);
          const pts: [number, number][] = [at];
          const to = cf && apPt(cf.leg.to);
          if (to) pts.push(to);
          if (cf) for (const ac of awaitingDelivery(refs.current.g, cf.leg.to)) { const q = shared.ac.get(ac.id); if (q) pts.push(q); }
          return { pts, box: AC_LABEL_BOX };
        }
        if (sel.kind === 'airport') {
          const a = AIRPORT_BY_CODE[sel.id];
          return (a && refs.current.proj?.([a.lon, a.lat])) || null;
        }
        if (sel.kind === 'event') {
          // Its pin (off the map once the event is over: nothing to reveal).
          const p = refs.current.evPins.find((x) => x.eventId === sel.id);
          const at = p && apPt(p.at);
          // A roomy box: the pin (up-left of its airport) lands well inside, clear of the zoom buttons by the panel.
          return at ? { pts: [at], box: [40 - p.off[0], 40 - p.off[1], 90, 40] } : null;
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
        ground={(ctx) => <ZoneGround zones={zones} proj={ctx.proj} hatch={hatchUnit(ctx.px, ctx.k)} />}
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
              <ZoneLabels zones={zones} proj={ctx.proj} unit={ctx.unit} selected={selEv ? zones.find((z) => z.eventId === selEv)?.eventId : undefined} />
              <PathsLayer shared={shared} />
              <SlipArcsLayer arcs={slipLegs} proj={ctx.proj} />
              <ArcsLayer legs={nextArcs} proj={ctx.proj} />
            </>
          );
        }}
        layers={(ctx) => (
          <>
            <PinsLayer pins={pins} marked={marked} proj={ctx.proj} unit={ctx.unit} selected={selPin} touch={touch} />
            <EventPinsLayer pins={evPins} proj={ctx.proj} unit={ctx.unit} selected={selEv} />
            <SlipMarksLayer marks={slipMarks} proj={ctx.proj} unit={ctx.unit} selected={selSlip ? sel?.id : undefined} />
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
