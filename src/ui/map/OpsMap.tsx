// Ops Map (B4): the calm, full-bleed live map. Skeleton version: world map, home base, and every
// aircraft drawn where it is (parked, or moving along its great circle from liveMinute()), with a
// small fleet card. B4 adds the terminator, offer pins, routes, panels and selection (DESIGN.md §6.2).

import { useEffect, useMemo, useRef } from 'react';
import { artFor } from '../../data/acmiTypes';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { aircraftLive } from '../../engine/core/query';
import type { GameState } from '../../engine/core/types';
import { AircraftArt } from '../components/AircraftArt';
import { PLANE_PATH } from '../components/Logo';
import { type MapAirport, type MapLayerCtx, WorldMap } from './WorldMap';
import { liveMinute, store, useGame } from '../store';

/** Imperatively positioned aircraft glyphs (no React render per frame). */
function AircraftLayer({ ctx, g }: { ctx: MapLayerCtx; g: GameState }) {
  const ref = useRef<SVGGElement>(null);
  const ids = Object.keys(g.fleet);
  const unitRef = useRef(ctx.unit);
  unitRef.current = ctx.unit;
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = ref.current;
      if (!root || !store.game) return;
      const t = liveMinute();
      const s = (22 / 24) * unitRef.current;
      // Aircraft parked at the same airport fan out so each stays tappable.
      const stack = new Map<string, number>();
      ids.forEach((id, i) => {
        const el = root.children[i] as SVGGElement | undefined;
        const ac = store.game!.fleet[id];
        if (!el || !ac) return;
        const live = aircraftLive(store.game!, ac, t);
        const p = ctx.proj(live.pos);
        if (!p) return;
        let ang = 0;
        let x = p[0];
        let y = p[1];
        if (live.ahead) {
          const q = ctx.proj(live.ahead);
          if (q) ang = (Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI + 90;
        } else {
          const n = stack.get(live.at!) ?? 0;
          stack.set(live.at!, n + 1);
          x += (16 + n * 24) * unitRef.current;
          y += 2 * unitRef.current;
          ang = 45;
        }
        el.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`);
        el.firstElementChild?.setAttribute('transform', `rotate(${ang.toFixed(1)}) scale(${s.toFixed(4)}) translate(-12 -12)`);
        el.setAttribute('data-phase', live.phase);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ids.join(','), ctx.proj]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <g ref={ref} className="ops-aircraft">
      {ids.map((id) => (
        <g key={id} onClick={() => store.select({ kind: 'aircraft', id })}>
          <path d={PLANE_PATH} fill="#ffffff" stroke="#070b14" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
}

function FleetCard() {
  const g = useGame();
  const c = g.company;
  return (
    <div className="ops-fleet card">
      <div className="upper dim">Fleet</div>
      {Object.values(g.fleet).map((ac) => (
        <button key={ac.id} className={`ops-fleet-row ${store.nav.sel?.id === ac.id ? 'on' : ''}`} onClick={() => store.select({ kind: 'aircraft', id: ac.id })}>
          <div className="ops-fleet-art"><AircraftArt typeId={artFor(ac.typeId)} livery={c.livery} code={c.code} detail="simple" /></div>
          <div className="col" style={{ minWidth: 0 }}>
            <b className="mono">{ac.reg}</b>
            <span className="small muted ellipsis">{ac.status === 'flying' ? 'Airborne' : `Parked at ${AIRPORT_BY_CODE[ac.at]?.city ?? ac.at}`} · {ac.cabin.label}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

export function OpsMap() {
  const g = useGame();
  const base = g.company.homeBase;
  const airports: MapAirport[] = useMemo(() => {
    const codes = new Set([base, ...Object.values(g.fleet).map((a) => a.at)]);
    return [...codes].map((code) => ({ code, state: code === base ? 'hub' : 'served', label: true }));
  }, [g, base, store.version]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="ops-map">
      <WorldMap
        routes={[]}
        airports={airports}
        fit={[base, 'DUB', 'FCO', 'TFS', 'CMN']}
        fitPad={[16, 16, 16, 300]}
        animate={false}
        accent={g.company.livery.secondary}
        layers={(ctx) => <AircraftLayer ctx={ctx} g={g} />}
      />
      <FleetCard />
    </div>
  );
}
