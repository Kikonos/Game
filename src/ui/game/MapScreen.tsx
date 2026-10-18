import { Briefcase, Lock, MapPin, Palmtree, Plus, Route as RouteIcon, TrendingUp, Users, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS, SIZE_LABEL, type Airport } from '../../data/airports';
import { countryName, flag } from '../../data/countries';
import { REGIONS, REGION_BY_ID } from '../../data/regions';
import { routeCheck } from '../../engine/actions';
import { competition, competitionLabel, marketDemand, totalOf } from '../../engine/demand';
import { distance } from '../../engine/geo';
import { isHub } from '../../engine/state';
import type { GameState } from '../../engine/types';
import { Bar, Seg } from '../components/ui';
import { dist, int } from '../format';
import { WorldMap, type MapAirport, type MapRoute } from '../map/WorldMap';
import { store, useGame } from '../store';
import { mapRotate, routeAircraft } from './common';
import { networkMap } from './Dashboard';

type Mode = 'network' | 'demand';

function AirportPanel({ g, a, onClose }: { g: GameState; a: Airport; onClose: () => void }) {
  const unlocked = g.unlockedRegions.includes(a.region);
  const routes = g.routes.filter((r) => r.from === a.code || r.to === a.code);
  const trend = g.market.trend[a.code] ?? 1;
  return (
    <aside className="map-panel card">
      <div className="row between">
        <div className="row gap-8">
          <span className="code big-code">{a.code}</span>
          {isHub(g, a.code) && <span className="badge accent">Your hub</span>}
          {!unlocked && <span className="badge"><Lock size={12} /> Locked</span>}
        </div>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <h2 className="mt-8">{a.city}</h2>
      <div className="muted small">{flag(a.country)} {a.name} · {countryName(a.country)}</div>
      <div className="small dim">{REGION_BY_ID[a.region].name} · {SIZE_LABEL[a.size]}</div>
      <div className="ap-stats">
        <div><Users size={14} /><span className="dim">Catchment</span><b>{a.pop >= 1 ? `${a.pop.toFixed(1)}M` : `${int(a.pop * 1000)}K`}</b></div>
        <div><Briefcase size={14} /><span className="dim">Business</span><Bar value={a.biz} /></div>
        <div><Palmtree size={14} /><span className="dim">Tourism</span><Bar value={a.tour} /></div>
        <div><TrendingUp size={14} /><span className="dim">Trend</span><b className={trend >= 1.02 ? 'good' : trend <= 0.98 ? 'bad' : ''}>{trend >= 1 ? '+' : ''}{Math.round((trend - 1) * 100)}%</b></div>
      </div>
      {!isHub(g, a.code) && (
        <div className="mt-12">
          <div className="upper dim mb-8">From your hubs</div>
          {g.hubs.map((h) => {
            const d = distance(h.code, a.code);
            const m = marketDemand(g, h.code, a.code);
            const c = competition(g, h.code, a.code);
            const cl = competitionLabel(c.level);
            const err = routeCheck(g, h.code, a.code);
            const existing = g.routes.find((r) => (r.from === h.code && r.to === a.code) || (r.to === h.code && r.from === a.code));
            return (
              <div key={h.code} className="hub-market">
                <div className="row between">
                  <b>{h.code} → {a.code}</b>
                  <span className="dim small">{dist(d)}</span>
                </div>
                <div className="row between small">
                  <span className="muted">{int(totalOf(m))} pax/day market</span>
                  <span className={cl.tone}>{cl.label} competition</span>
                </div>
                {existing ? (
                  <button className="btn btn-sm mt-8" onClick={() => store.navigate('routes', { routeId: existing.id })}><RouteIcon /> View route</button>
                ) : err ? (
                  <div className="tiny dim mt-8">{err}</div>
                ) : (
                  <button className="btn btn-primary btn-sm mt-8" onClick={() => store.openModal({ kind: 'planner', hub: h.code, dest: a.code })}><Plus /> Plan route</button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {routes.length > 0 && (
        <div className="mt-12">
          <div className="upper dim mb-8">Your routes</div>
          {routes.map((r) => (
            <button key={r.id} className="list-btn" onClick={() => store.navigate('routes', { routeId: r.id })}>
              <span>{r.from} → {r.to}</span>
              <span className="dim small">{routeAircraft(g, r.id).reduce((s, x) => s + x.freq, 0)}× weekly</span>
            </button>
          ))}
        </div>
      )}
      {!unlocked && (
        <button className="btn mt-12" onClick={() => store.navigate('expansion')}><Lock /> Unlock {REGION_BY_ID[a.region].name}</button>
      )}
    </aside>
  );
}

export function MapScreen() {
  const g = useGame();
  const [selected, setSelected] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('network');
  const [hub, setHub] = useState(g.hubs[0].code);
  const net = networkMap(g);

  const airports: MapAirport[] = useMemo(() => {
    const served = new Set(g.routes.flatMap((r) => [r.from, r.to]));
    return AIRPORTS.map((a) => ({
      code: a.code,
      state: isHub(g, a.code) ? 'hub' : served.has(a.code) ? 'served' : g.unlockedRegions.includes(a.region) ? 'open' : 'locked',
      label: isHub(g, a.code) || served.has(a.code),
    }));
  }, [g, g.routes.length, g.hubs.length, g.unlockedRegions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const demandRoutes: MapRoute[] = useMemo(() => {
    if (mode !== 'demand') return [];
    const cands = AIRPORTS.filter((a) => a.code !== hub && g.unlockedRegions.includes(a.region) && distance(hub, a.code) >= 150)
      .map((a) => ({ a, d: totalOf(marketDemand(g, hub, a.code)) }))
      .sort((x, y) => y.d - x.d)
      .slice(0, 40);
    const max = Math.max(1, ...cands.map((c) => c.d));
    return cands.map((c) => ({ id: `d-${c.a.code}`, from: hub, to: c.a.code, weight: c.d / max, color: '#f5c451', dashed: false }));
  }, [mode, hub, g, g.day >> 4]); // eslint-disable-line react-hooks/exhaustive-deps

  const regionLabels = REGIONS.map((r) => ({ id: r.id, locked: !g.unlockedRegions.includes(r.id) }));
  const fit = useMemo(() => {
    const codes = AIRPORTS.filter((a) => g.unlockedRegions.includes(a.region)).map((a) => a.code);
    return codes;
  }, [g.unlockedRegions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const sel = selected ? AIRPORT_BY_CODE[selected] : null;

  return (
    <div className="map-screen">
      <WorldMap
        rotate={mapRotate(g)}
        routes={mode === 'network' ? net.routes : demandRoutes}
        airports={airports}
        fit={fit}
        selected={selected}
        onSelect={setSelected}
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
        <Seg<Mode> value={mode} onChange={setMode} options={[{ value: 'network', label: 'My network' }, { value: 'demand', label: 'Opportunities' }]} />
        {mode === 'demand' && (
          <select className="select sm" value={hub} onChange={(e) => setHub(e.target.value)}>
            {g.hubs.map((h) => <option key={h.code} value={h.code}>From {h.code}</option>)}
          </select>
        )}
        <button className="btn btn-primary btn-sm" onClick={() => store.openModal({ kind: 'planner' })}><Plus /> Plan route</button>
      </div>
      <div className="map-legend card">
        <span><i className="lg hub" /> Hub</span>
        <span><i className="lg served" /> Served</span>
        <span><i className="lg open" /> Available</span>
        <span><i className="lg locked" /> Locked region</span>
        {mode === 'demand' && <span><i className="lg line" /> Market size</span>}
        <span className="dim tiny"><MapPin size={11} /> Scroll to zoom · drag to pan · click an airport</span>
      </div>
      {sel && <AirportPanel g={g} a={sel} onClose={() => setSelected(null)} />}
    </div>
  );
}
