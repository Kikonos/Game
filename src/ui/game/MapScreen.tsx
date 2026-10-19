import { ArrowRight, Briefcase, ChevronDown, ChevronUp, Lock, MapPin, Palmtree, Plane, Plus, Route as RouteIcon, TrendingUp, Users, X } from 'lucide-react';
import { type ReactNode, type RefObject, useMemo, useRef, useState } from 'react';
import { AIRCRAFT_BY_ID } from '../../data/aircraft';
import { AIRPORT_BY_CODE, AIRPORTS, SIZE_LABEL, type Airport } from '../../data/airports';
import { countryName, flag } from '../../data/countries';
import { REGIONS, REGION_BY_ID } from '../../data/regions';
import { routeCheck } from '../../engine/actions';
import { competition, competitionLabel, marketDemand, totalOf } from '../../engine/demand';
import { distance } from '../../engine/geo';
import { isHub } from '../../engine/state';
import type { GameState, Route } from '../../engine/types';
import { Bar, Seg } from '../components/ui';
import { dist, int, money, pct } from '../format';
import { WorldMap, type MapAirport, type MapRoute, type Pad } from '../map/WorldMap';
import { store, useGame } from '../store';
import { useMedia, useTouch } from '../useMedia';
import { lfTone, mapRotate, routeAircraft, routeWeek } from './common';
import { networkMap } from './Dashboard';

type Mode = 'network' | 'demand';
type Sel = { kind: 'airport'; code: string } | { kind: 'route'; id: string } | null;

/** Where the details panel becomes a bottom sheet: narrow windows and portrait tablets. */
const SHEET_Q = '(max-width: 699.98px), (orientation: portrait) and (max-width: 1099.98px)';
/** Screen space kept clear of the toolbar (top) and legend (bottom) when fitting the network. */
const FIT_PAD: Pad = [76, 20, 60, 20];

/**
 * Details panel: a full-height card on the right in landscape; in portrait a bottom sheet that
 * shows the header + main action and expands (tap or drag the grip, or "More details").
 */
function MapPanel({ sheet, head, primary, children, onClose, panelRef }: {
  sheet: boolean; head: ReactNode; primary?: ReactNode; children?: ReactNode; onClose: () => void; panelRef: RefObject<HTMLElement | null>;
}) {
  const [expanded, setExpanded] = useState(false);
  const drag = useRef<{ y: number; dy: number; id: number } | null>(null);
  const settle = (dy: number) => {
    const el = panelRef.current;
    if (el) { el.style.transform = ''; el.style.transition = ''; }
    if (dy < -24) setExpanded(true);
    else if (dy > 24) { if (expanded) setExpanded(false); else onClose(); }
    else setExpanded((x) => !x);
  };
  const grip = sheet && (
    <button
      className="mp-grip"
      aria-label={expanded ? 'Show less' : 'Show more'}
      onPointerDown={(e) => {
        drag.current = { y: e.clientY, dy: 0, id: e.pointerId };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        const el = panelRef.current;
        if (!d || !el || d.id !== e.pointerId) return;
        d.dy = e.clientY - d.y;
        el.style.transition = 'none';
        el.style.transform = `translateY(${Math.max(-40, d.dy)}px)`;
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && d.id === e.pointerId) settle(d.dy);
      }}
      onPointerCancel={() => { drag.current = null; settle(0); }}
      onClick={(e) => { if (e.detail === 0) setExpanded((x) => !x); /* keyboard */ }}
    />
  );
  return (
    <aside ref={panelRef as RefObject<HTMLElement>} className={`map-panel card ${sheet ? `sheet ${expanded ? 'expanded' : 'collapsed'}` : 'side'}`}>
      {grip}
      <div className="mp-head">
        <div className="mp-title">{head}</div>
        <button className="btn btn-ghost btn-icon btn-sm mp-close" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      {primary && <div className="mp-primary">{primary}</div>}
      {children && <div className="mp-body">{children}</div>}
      {sheet && children && (
        <button className="mp-more" onClick={() => setExpanded((x) => !x)}>
          {expanded ? <><ChevronDown /> Less</> : <><ChevronUp /> More details</>}
        </button>
      )}
    </aside>
  );
}

function hubMarket(g: GameState, h: string, a: Airport) {
  const m = marketDemand(g, h, a.code);
  const c = competition(g, h, a.code);
  return {
    hub: h,
    d: distance(h, a.code),
    market: totalOf(m),
    cl: competitionLabel(c.level),
    err: routeCheck(g, h, a.code),
    existing: g.routes.find((r) => (r.from === h && r.to === a.code) || (r.to === h && r.from === a.code)),
  };
}

function MarketAction({ x, a, big }: { x: ReturnType<typeof hubMarket>; a: Airport; big?: boolean }) {
  if (x.existing) return <button className={`btn ${big ? '' : 'btn-sm'}`} onClick={() => store.navigate('routes', { routeId: x.existing!.id })}><RouteIcon /> View route</button>;
  if (x.err) return <div className="tiny dim mp-err">{x.err}</div>;
  return <button className={`btn btn-primary ${big ? '' : 'btn-sm'}`} onClick={() => store.openModal({ kind: 'planner', hub: x.hub, dest: a.code })}><Plus /> Plan route</button>;
}

function MarketCard({ x, a, big }: { x: ReturnType<typeof hubMarket>; a: Airport; big?: boolean }) {
  return (
    <div className={`hub-market ${big ? 'main' : ''}`}>
      <div className="row between">
        <b>{x.hub} → {a.code}</b>
        <span className="dim small">{dist(x.d)}</span>
      </div>
      <div className="row between small">
        <span className="muted">{int(x.market)} pax/day market</span>
        <span className={x.cl.tone}>{x.cl.label} competition</span>
      </div>
      <MarketAction x={x} a={a} big={big} />
    </div>
  );
}

function AirportPanel({ g, a, sheet, onClose, panelRef }: { g: GameState; a: Airport; sheet: boolean; onClose: () => void; panelRef: RefObject<HTMLElement | null> }) {
  const unlocked = g.unlockedRegions.includes(a.region);
  const hub = isHub(g, a.code);
  const routes = g.routes.filter((r) => r.from === a.code || r.to === a.code);
  const trend = g.market.trend[a.code] ?? 1;
  // The main suggestion: the hub already flying here, else the nearest hub that can.
  const markets = hub ? [] : g.hubs.map((h) => hubMarket(g, h.code, a))
    .sort((x, y) => (x.existing ? 0 : 1) - (y.existing ? 0 : 1) || (x.err ? 1 : 0) - (y.err ? 1 : 0) || x.d - y.d);
  const [main, ...others] = markets;

  const head = (
    <>
      <div className="row gap-8 wrap">
        <span className="code big-code">{a.code}</span>
        {hub && <span className="badge accent">Your hub</span>}
        {!unlocked && <span className="badge"><Lock size={12} /> Locked</span>}
      </div>
      <h2>{a.city}</h2>
      <div className="muted small ellipsis">{flag(a.country)} {a.name} · {countryName(a.country)}</div>
      <div className="small dim">{REGION_BY_ID[a.region].name} · {SIZE_LABEL[a.size]}</div>
    </>
  );

  let primary: ReactNode;
  if (!unlocked) {
    primary = <button className="btn mp-wide" onClick={() => store.navigate('expansion')}><Lock /> Unlock {REGION_BY_ID[a.region].name}</button>;
  } else if (hub) {
    primary = (
      <div className="mp-cta">
        <span className="small muted grow">{routes.length} route{routes.length === 1 ? '' : 's'} from this hub</span>
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'planner', hub: a.code })}><Plus /> Plan route</button>
      </div>
    );
  } else if (main) {
    primary = <MarketCard x={main} a={a} big />;
  }

  return (
    <MapPanel sheet={sheet} head={head} primary={primary} onClose={onClose} panelRef={panelRef}>
      <div className="ap-stats">
        <div><Users size={14} /><span className="dim">Catchment</span><b>{a.pop >= 1 ? `${a.pop.toFixed(1)}M` : `${int(a.pop * 1000)}K`}</b></div>
        <div><Briefcase size={14} /><span className="dim">Business</span><Bar value={a.biz} /></div>
        <div><Palmtree size={14} /><span className="dim">Tourism</span><Bar value={a.tour} /></div>
        <div><TrendingUp size={14} /><span className="dim">Trend</span><b className={trend >= 1.02 ? 'good' : trend <= 0.98 ? 'bad' : ''}>{trend >= 1 ? '+' : ''}{Math.round((trend - 1) * 100)}%</b></div>
      </div>
      {others.length > 0 && (
        <div className="mt-16">
          <div className="upper dim mb-8">From your other hubs</div>
          {others.map((x) => <MarketCard key={x.hub} x={x} a={a} />)}
        </div>
      )}
      {routes.length > 0 && (
        <div className="mt-16">
          <div className="upper dim mb-8">Your routes</div>
          {routes.map((r) => (
            <button key={r.id} className="list-btn" onClick={() => store.navigate('routes', { routeId: r.id })}>
              <span>{r.from} → {r.to}</span>
              <span className="dim small row gap-4">{routeAircraft(g, r.id).reduce((s, x) => s + x.freq, 0)}× weekly <ArrowRight size={14} /></span>
            </button>
          ))}
        </div>
      )}
    </MapPanel>
  );
}

function RoutePanel({ g, r, sheet, onClose, onAirport, panelRef }: {
  g: GameState; r: Route; sheet: boolean; onClose: () => void; onAirport: (code: string) => void; panelRef: RefObject<HTMLElement | null>;
}) {
  const w = routeWeek(r);
  const ac = routeAircraft(g, r.id);
  const freq = ac.reduce((s, x) => s + x.freq, 0);
  const A = AIRPORT_BY_CODE[r.from];
  const B = AIRPORT_BY_CODE[r.to];
  const head = (
    <>
      <div className="row gap-8">
        <span className="code big-code">{r.from}</span>
        <Plane size={15} className="accent mp-plane" />
        <span className="code big-code">{r.to}</span>
      </div>
      <h2>{A.city} – {B.city}</h2>
      <div className="muted small">{dist(r.dist)} · {g.airline.code} {r.flightNo}</div>
    </>
  );
  const primary = (
    <div className="mp-cta">
      <div className="mp-stats">
        <div><span className="dim tiny">Weekly</span><b>{freq}×</b></div>
        <div><span className="dim tiny">Load</span><b className={w ? lfTone(w.lf) : ''}>{w ? pct(w.lf) : '—'}</b></div>
        <div><span className="dim tiny">Profit / wk</span><b className={w ? (w.profit >= 0 ? 'good' : 'bad') : ''}>{w ? money(w.profit) : '—'}</b></div>
      </div>
      <button className="btn btn-primary" onClick={() => store.navigate('routes', { routeId: r.id })}>Manage <ArrowRight /></button>
    </div>
  );
  return (
    <MapPanel sheet={sheet} head={head} primary={primary} onClose={onClose} panelRef={panelRef}>
      <div className="mp-kv">
        <div><span className="dim">Revenue / wk</span><b>{w ? money(w.rev) : '—'}</b></div>
        <div><span className="dim">Passengers / wk</span><b>{w ? int(w.pax) : '—'}</b></div>
        <div><span className="dim">Market share</span><b>{r.last ? pct(r.last.share) : '—'}</b></div>
      </div>
      <div className="mt-16">
        <div className="upper dim mb-8">Aircraft</div>
        {ac.length === 0 && <div className="small muted">No aircraft assigned — this route isn’t flying.</div>}
        {ac.map(({ ac: x, freq: f }) => (
          <button key={x.id} className="list-btn" onClick={() => store.navigate('fleet', { aircraftId: x.id })}>
            <span className="ellipsis"><b>{x.reg}</b> <span className="dim small">{AIRCRAFT_BY_ID[x.typeId].name}</span></span>
            <span className="dim small">{f}× weekly</span>
          </button>
        ))}
      </div>
      <div className="mt-16">
        <div className="upper dim mb-8">Airports</div>
        {[A, B].map((x) => (
          <button key={x.code} className="list-btn" onClick={() => onAirport(x.code)}>
            <span><span className="code">{x.code}</span> {x.city}</span>
            <MapPin size={14} className="dim" />
          </button>
        ))}
      </div>
    </MapPanel>
  );
}

export function MapScreen() {
  const g = useGame();
  const touch = useTouch();
  const sheet = useMedia(SHEET_Q);
  const [sel, setSel] = useState<Sel>(null);
  const [mode, setMode] = useState<Mode>('network');
  const [hub, setHub] = useState(g.hubs[0].code);
  const panelRef = useRef<HTMLElement>(null);
  const selRoute = sel?.kind === 'route' ? g.routes.find((r) => r.id === sel.id) : undefined;
  const selAirport = sel?.kind === 'airport' ? AIRPORT_BY_CODE[sel.code] : undefined;
  const net = networkMap(g, selRoute?.id);

  const airports: MapAirport[] = useMemo(() => {
    const served = new Set(g.routes.flatMap((r) => [r.from, r.to]));
    return AIRPORTS.map((a) => ({
      code: a.code,
      state: isHub(g, a.code) ? 'hub' : served.has(a.code) ? 'served' : g.unlockedRegions.includes(a.region) ? 'open' : 'locked',
      label: isHub(g, a.code) || served.has(a.code),
    }));
  }, [g, g.routes.length, g.hubs.length, g.unlockedRegions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const demandBase: MapRoute[] = useMemo(() => {
    if (mode !== 'demand') return [];
    const cands = AIRPORTS.filter((a) => a.code !== hub && g.unlockedRegions.includes(a.region) && distance(hub, a.code) >= 150)
      .map((a) => ({ a, d: totalOf(marketDemand(g, hub, a.code)) }))
      .sort((x, y) => y.d - x.d)
      .slice(0, 40);
    const max = Math.max(1, ...cands.map((c) => c.d));
    return cands.map((c) => ({ id: `d-${c.a.code}`, from: hub, to: c.a.code, weight: c.d / max, color: '#f5c451', dashed: false }));
  }, [mode, hub, g, g.day >> 4]); // eslint-disable-line react-hooks/exhaustive-deps
  const demandRoutes = selAirport ? demandBase.map((r) => (r.to === selAirport.code ? { ...r, highlight: true } : r)) : demandBase;

  const regionLabels = REGIONS.map((r) => ({ id: r.id, locked: !g.unlockedRegions.includes(r.id) }));
  const fit = useMemo(() => AIRPORTS.filter((a) => g.unlockedRegions.includes(a.region)).map((a) => a.code), [g.unlockedRegions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => setSel(null);
  const selectAirport = (code: string | null) => setSel(code ? { kind: 'airport', code } : null);
  const selectRoute = (id: string | null) => {
    if (!id) return setSel(null);
    // Opportunity lines stand for their destination airport.
    if (id.startsWith('d-')) return setSel({ kind: 'airport', code: id.slice(2) });
    setSel({ kind: 'route', id });
  };
  // Keep a newly selected airport clear of the side panel / bottom sheet.
  const revealPad = (): Pad => {
    const el = panelRef.current;
    const host = el?.parentElement;
    if (!el || !host) return FIT_PAD;
    const r = el.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    return sheet ? [FIT_PAD[0], 16, Math.max(60, h.bottom - r.top + 8), 16] : [FIT_PAD[0], Math.max(20, h.right - r.left + 8), 60, 20];
  };

  const panelOpen = !!(selAirport || selRoute);
  const hint = touch
    ? 'Pinch to zoom · drag to pan · tap an airport or route'
    : 'Scroll to zoom · drag to pan · click an airport or route';

  return (
    <div className={`map-screen ${sheet ? 'sheet-mode' : 'side-mode'} ${panelOpen ? 'panel-open' : ''}`}>
      <WorldMap
        rotate={mapRotate(g)}
        routes={mode === 'network' ? net.routes : demandRoutes}
        airports={airports}
        fit={fit}
        fitPad={FIT_PAD}
        selected={selAirport?.code ?? null}
        onSelect={selectAirport}
        onSelectRoute={selectRoute}
        revealPad={revealPad}
        regionLabels={regionLabels}
        animate={store.settings.mapAnimations && mode === 'network'}
        planesKey={net.routes.map((r) => `${r.id}:${r.planes}`).join(',') + mode}
        tooltip={(a) => (
          <div>
            <b>{a.code}</b> · {a.city} {flag(a.country)}
            <div className="tiny dim">{SIZE_LABEL[a.size]} · {REGION_BY_ID[a.region].name}{g.unlockedRegions.includes(a.region) ? '' : ' (locked)'}</div>
          </div>
        )}
      />
      <div className="map-toolbar card">
        <Seg<Mode> value={mode} onChange={(m) => { setMode(m); if (m === 'demand' && sel?.kind === 'route') setSel(null); }} options={[{ value: 'network', label: 'My network' }, { value: 'demand', label: 'Opportunities' }]} />
        {mode === 'demand' && g.hubs.length > 1 && (
          <select className="select sm" value={hub} onChange={(e) => setHub(e.target.value)} aria-label="From hub">
            {g.hubs.map((h) => <option key={h.code} value={h.code}>From {h.code}</option>)}
          </select>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => store.openModal({ kind: 'planner', hub: mode === 'demand' ? hub : undefined })}><Plus /> Plan route</button>
      </div>
      <div className="map-legend card">
        <span><i className="lg hub" /> Hub</span>
        <span><i className="lg served" /> Served</span>
        <span><i className="lg open" /> Available</span>
        <span><i className="lg locked" /> Locked</span>
        {mode === 'demand' && <span><i className="lg line" /> Market size</span>}
        <span className="dim map-hint"><MapPin size={12} /> {hint}</span>
      </div>
      {selAirport && <AirportPanel key={selAirport.code} g={g} a={selAirport} sheet={sheet} onClose={close} panelRef={panelRef} />}
      {selRoute && <RoutePanel key={selRoute.id} g={g} r={selRoute} sheet={sheet} onClose={close} onAirport={selectAirport} panelRef={panelRef} />}
    </div>
  );
}
