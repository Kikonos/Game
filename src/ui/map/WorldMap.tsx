import { geoInterpolate, geoPath } from 'd3-geo';
import { Minus, Plus, Maximize2 } from 'lucide-react';
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AIRPORT_BY_CODE, AIRPORTS, type Airport } from '../../data/airports';
import { REGIONS } from '../../data/regions';
import { PLANE_PATH } from '../components/Logo';
import { MAP_H, MAP_W, basePaths, projection } from './mapData';

export interface MapRoute {
  id: string;
  from: string;
  to: string;
  /** 0..1 thickness/intensity. */
  weight: number;
  color?: string;
  dashed?: boolean;
  planes?: number;
  highlight?: boolean;
}

export interface MapAirport {
  code: string;
  state: 'hub' | 'served' | 'open' | 'locked' | 'dim';
  label?: boolean;
}

interface Props {
  rotate?: number;
  routes: MapRoute[];
  airports: MapAirport[];
  fit?: string[];
  fitPad?: Pad;
  interactive?: boolean;
  animate?: boolean;
  accent?: string;
  selected?: string | null;
  onSelect?: (code: string | null) => void;
  onHover?: (code: string | null) => void;
  tooltip?: (a: Airport) => ReactNode;
  regionLabels?: { id: string; locked: boolean }[];
  className?: string;
  /** Changes when the network changes, so planes are rebuilt. */
  planesKey?: string;
  controls?: boolean;
}

interface View {
  k: number;
  x: number;
  y: number;
}

const MAX_PLANES = 60;

const BaseLayers = memo(function BaseLayers({ rotate }: { rotate: number }) {
  const p = basePaths(rotate);
  return (
    <g className="map-base">
      <path d={p.graticule} fill="none" stroke="rgba(120,150,210,0.07)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
      <path d={p.land} fill="url(#land-grad)" stroke="rgba(120,160,230,0.28)" strokeWidth={0.7} vectorEffect="non-scaling-stroke" />
      <path d={p.borders} fill="none" stroke="rgba(150,175,230,0.13)" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
    </g>
  );
});

/** Screen-pixel padding [top, right, bottom, left] kept clear when fitting (e.g. for overlays). */
type Pad = [number, number, number, number];

function fitView(rotate: number, codes: string[], w: number, h: number, pad: Pad = [0, 0, 0, 0]): View {
  const proj = projection(rotate);
  const pts = codes.map((c) => AIRPORT_BY_CODE[c]).filter(Boolean).map((a) => proj([a.lon, a.lat])!);
  if (pts.length === 0) return { k: 1, x: 0, y: 0 };
  let x0 = Math.min(...pts.map((p) => p[0]));
  let x1 = Math.max(...pts.map((p) => p[0]));
  let y0 = Math.min(...pts.map((p) => p[1]));
  let y1 = Math.max(...pts.map((p) => p[1]));
  const minSpan = 140;
  if (x1 - x0 < minSpan) { const c = (x0 + x1) / 2; x0 = c - minSpan / 2; x1 = c + minSpan / 2; }
  if (y1 - y0 < minSpan * 0.6) { const c = (y0 + y1) / 2; y0 = c - minSpan * 0.3; y1 = c + minSpan * 0.3; }
  const padX = (x1 - x0) * 0.18;
  const padY = (y1 - y0) * 0.22;
  x0 -= padX; x1 += padX; y0 -= padY; y1 += padY;
  // The SVG uses "slice", so convert container aspect into map units.
  const scale = Math.max(w / MAP_W, h / MAP_H);
  const visW = Math.max(40, w - pad[1] - pad[3]) / scale;
  const visH = Math.max(40, h - pad[0] - pad[2]) / scale;
  const k = Math.max(1, Math.min(14, Math.min(visW / (x1 - x0), visH / (y1 - y0))));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const tx = MAP_W / 2 + (pad[3] - pad[1]) / 2 / scale;
  const ty = MAP_H / 2 + (pad[0] - pad[2]) / 2 / scale;
  return clampView({ k, x: tx - cx * k, y: ty - cy * k });
}

function clampView(v: View): View {
  const k = Math.max(1, Math.min(14, v.k));
  const minX = MAP_W - MAP_W * k;
  const minY = MAP_H - MAP_H * k;
  return { k, x: Math.min(0, Math.max(minX, v.x)), y: Math.min(0, Math.max(minY, v.y)) };
}

export function WorldMap({
  rotate = 0, routes, airports, fit, fitPad, interactive = true, animate = true, accent = '#3ee6ff', selected, onSelect, onHover,
  tooltip, regionLabels, className, planesKey, controls = true,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const planesRef = useRef<SVGGElement>(null);
  const [view, setView] = useState<View>({ k: 1, x: 0, y: 0 });
  // Screen pixels per map unit at zoom 1 (the SVG uses "slice" scaling).
  const [pxPerUnit, setPxPerUnit] = useState(0.6);
  const pxRef = useRef(pxPerUnit);
  pxRef.current = pxPerUnit;
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setPxPerUnit(Math.max(r.width / MAP_W, r.height / MAP_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<{ code: string; x: number; y: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const proj = projection(rotate);
  const path = useMemo(() => geoPath(proj), [proj]);

  const fitKey = (fit ?? []).join(',');
  const doFit = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setView(fit && fit.length ? fitView(rotate, fit, r.width, r.height, fitPad) : { k: 1, x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, rotate]);
  useEffect(() => {
    doFit();
  }, [doFit]);

  // ---------- pan & zoom ----------
  const toMap = (clientX: number, clientY: number): [number, number] => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };
  const zoomAt = (factor: number, mx: number, my: number) => {
    setView((v) => {
      const k = Math.max(1, Math.min(14, v.k * factor));
      const f = k / v.k;
      return clampView({ k, x: mx - (mx - v.x) * f, y: my - (my - v.y) * f });
    });
  };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [mx, my] = toMap(e.clientX, e.clientY);
      zoomAt(Math.exp(-e.deltaY * 0.0015), mx, my);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [interactive]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    const [mx, my] = toMap(e.clientX, e.clientY);
    drag.current = { x: mx, y: my, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [mx, my] = toMap(e.clientX, e.clientY);
    const dx = mx - d.x;
    const dy = my - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) {
      if (!d.moved) (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      d.moved = true;
    }
    if (d.moved) setView(clampView({ k: viewRef.current.k, x: d.vx + dx, y: d.vy + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && interactive && (e.target as Element).tagName === 'rect') onSelect?.(null);
  };

  // ---------- airports ----------
  const k = view.k;
  const airportEls = useMemo(() => {
    return airports.map((ap) => {
      const a = AIRPORT_BY_CODE[ap.code];
      const p = proj([a.lon, a.lat]);
      if (!p) return null;
      return { ...ap, a, x: p[0], y: p[1] };
    }).filter(Boolean) as (MapAirport & { a: Airport; x: number; y: number })[];
  }, [airports, proj]);

  const regionLabelEls = useMemo(() => {
    if (!regionLabels) return [];
    return regionLabels.map((r) => {
      const aps = AIRPORTS.filter((a) => a.region === r.id);
      const pts = aps.map((a) => proj([a.lon, a.lat])!).filter(Boolean);
      const x = pts.reduce((s, p) => s + p[0], 0) / pts.length;
      const y = pts.reduce((s, p) => s + p[1], 0) / pts.length;
      return { ...r, x, y, name: REGIONS.find((x) => x.id === r.id)!.name };
    });
  }, [regionLabels, proj]);

  // ---------- planes (imperative animation) ----------
  // Cap the number of animated aircraft so big networks stay smooth.
  const planeRoutes = useMemo(() => {
    const list = routes.filter((r) => (r.planes ?? 0) > 0).sort((a, b) => (b.planes ?? 0) - (a.planes ?? 0));
    let budget = MAX_PLANES;
    const out: MapRoute[] = [];
    for (const r of list) {
      if (budget <= 0) break;
      const n = Math.min(r.planes ?? 0, budget, Math.max(1, Math.ceil(MAX_PLANES / list.length)));
      out.push({ ...r, planes: n });
      budget -= n;
    }
    return out;
  }, [planesKey ?? routes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const g = planesRef.current;
    if (!g) return;
    g.innerHTML = '';
    if (!animate) return;
    const NS = 'http://www.w3.org/2000/svg';
    interface P { el: SVGGElement; trail: SVGPolylineElement; interp: (t: number) => [number, number]; dur: number; phase: number }
    const planes: P[] = [];
    for (const r of planeRoutes) {
      const A = AIRPORT_BY_CODE[r.from];
      const B = AIRPORT_BY_CODE[r.to];
      const interp = geoInterpolate([A.lon, A.lat], [B.lon, B.lat]);
      const distKm = Math.hypot(A.lat - B.lat, A.lon - B.lon) * 111;
      const dur = 9000 + Math.min(32000, distKm * 3.2);
      for (let i = 0; i < (r.planes ?? 0); i++) {
        const el = document.createElementNS(NS, 'g');
        const icon = document.createElementNS(NS, 'path');
        icon.setAttribute('d', PLANE_PATH);
        icon.setAttribute('transform', 'translate(-12 -12)');
        icon.setAttribute('fill', '#ffffff');
        el.appendChild(icon);
        const trail = document.createElementNS(NS, 'polyline');
        trail.setAttribute('fill', 'none');
        trail.setAttribute('stroke', r.color ?? accent);
        trail.setAttribute('stroke-opacity', '0.55');
        trail.setAttribute('stroke-width', '1.6');
        trail.setAttribute('stroke-linecap', 'round');
        trail.setAttribute('vector-effect', 'non-scaling-stroke');
        g.appendChild(trail);
        g.appendChild(el);
        planes.push({ el, trail, interp, dur, phase: (i / (r.planes ?? 1)) * 2 + Math.random() * 0.3 });
      }
    }
    let raf = 0;
    let paused = false;
    const t0 = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (paused) return;
      // Freeze while a dialog is open: blurred backdrops over moving content are expensive.
      if (document.querySelector('.modal-backdrop')) return;
      const kk = viewRef.current.k;
      for (const p of planes) {
        const cyc = ((now - t0) / p.dur + p.phase) % 2;
        const fwd = cyc < 1;
        const t = fwd ? cyc : 2 - cyc;
        // Ease near the airports so planes appear to land and take off.
        const e = t < 0.04 ? t * 0.5 + 0.02 * (t / 0.04) : t > 0.96 ? 1 - (1 - t) * 0.5 - 0.02 * ((1 - t) / 0.04) : t;
        const pos = proj(p.interp(Math.max(0, Math.min(1, e))));
        const ahead = proj(p.interp(Math.max(0, Math.min(1, e + (fwd ? 0.01 : -0.01)))));
        if (!pos || !ahead) continue;
        let ang = (Math.atan2(ahead[1] - pos[1], ahead[0] - pos[0]) * 180) / Math.PI + 90;
        if (Math.abs(ahead[0] - pos[0]) > MAP_W / 2) ang += 180;
        const s = 15 / 24 / (pxRef.current * kk);
        p.el.setAttribute('transform', `translate(${pos[0]} ${pos[1]}) rotate(${ang}) scale(${s})`);
        const pts: string[] = [];
        for (let j = 0; j <= 3; j++) {
          const tt = Math.max(0, Math.min(1, e + (fwd ? -1 : 1) * j * 0.024));
          const q = proj(p.interp(tt));
          if (q && Math.abs(q[0] - pos[0]) < MAP_W / 4) pts.push(`${q[0].toFixed(1)},${q[1].toFixed(1)}`);
        }
        p.trail.setAttribute('points', pts.join(' '));
        const vis = t > 0.02 && t < 0.98 ? '1' : '0';
        p.el.setAttribute('opacity', vis);
        p.trail.setAttribute('opacity', vis);
      }
    };
    raf = requestAnimationFrame(tick);
    const onVis = () => { paused = document.visibilityState === 'hidden'; };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [planeRoutes, animate, proj, accent]);

  // Convert screen pixels into map units at the current zoom.
  const px = (n: number) => n / (pxPerUnit * k);
  const showAllLabels = k * pxPerUnit > 1.6;
  // Dense networks only label hubs until you zoom in, to avoid a pile of overlapping codes.
  const crowded = airports.filter((a) => a.label).length > 16 && k * pxPerUnit < 2.2;

  return (
    <div
      ref={wrapRef}
      className={`worldmap ${interactive ? 'interactive' : ''} ${className ?? ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={() => { drag.current = null; }}
    >
      <svg ref={svgRef} viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="xMidYMid slice">
        <defs>
          <radialGradient id="ocean-grad" cx="50%" cy="40%" r="75%">
            <stop offset="0" stopColor="#0c1528" />
            <stop offset="1" stopColor="#050912" />
          </radialGradient>
          <linearGradient id="land-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1a2640" />
            <stop offset="1" stopColor="#131d33" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={MAP_W} height={MAP_H} fill="url(#ocean-grad)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${k})`}>
          <BaseLayers rotate={rotate} />
          {regionLabelEls.map((r) => (
            <text key={r.id} x={r.x} y={r.y} textAnchor="middle" className={`region-label ${r.locked ? 'locked' : ''}`} fontSize={px(11)} style={{ opacity: k * pxPerUnit > 2.6 ? 0 : 1 }}>
              {r.name.toUpperCase()}
            </text>
          ))}
          <g className="routes">
            {routes.map((r) => {
              const A = AIRPORT_BY_CODE[r.from];
              const B = AIRPORT_BY_CODE[r.to];
              const d = path({ type: 'LineString', coordinates: [[A.lon, A.lat], [B.lon, B.lat]] });
              if (!d) return null;
              const color = r.color ?? accent;
              return (
                <g key={r.id}>
                  {r.highlight && <path d={d} fill="none" stroke={color} strokeOpacity={0.25} strokeWidth={8} vectorEffect="non-scaling-stroke" />}
                  <path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeOpacity={r.highlight ? 1 : 0.25 + 0.6 * r.weight}
                    strokeWidth={0.8 + r.weight * 2.4 + (r.highlight ? 1 : 0)}
                    strokeDasharray={r.dashed ? '4 4' : undefined}
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              );
            })}
          </g>
          <g ref={planesRef} className="planes" />
          <g className="airports">
            {airportEls.map((ap) => {
              const big = ap.state === 'hub';
              const rad = px(ap.state === 'hub' ? 6.5 : ap.state === 'served' ? 4.5 : ap.state === 'open' ? 2.2 + ap.a.size * 0.5 : 2.2);
              const isSel = selected === ap.code;
              const fill = ap.state === 'hub' ? accent : ap.state === 'served' ? '#ffffff' : ap.state === 'open' ? '#9fb2d8' : ap.state === 'locked' ? '#3a4766' : '#56617a';
              const showLabel = (ap.label && !crowded) || isSel || big || hover?.code === ap.code || (showAllLabels && ap.state !== 'locked' && ap.state !== 'dim');
              return (
                <g
                  key={ap.code}
                  transform={`translate(${ap.x} ${ap.y})`}
                  className={`ap ap-${ap.state} ${isSel ? 'sel' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (interactive) onSelect?.(ap.code); }}
                  onPointerEnter={(e) => {
                    if (!interactive) return;
                    const rect = wrapRef.current!.getBoundingClientRect();
                    setHover({ code: ap.code, x: e.clientX - rect.left, y: e.clientY - rect.top });
                    onHover?.(ap.code);
                  }}
                  onPointerLeave={() => { setHover(null); onHover?.(null); }}
                >
                  {big && <circle r={rad * 2.4} fill={accent} opacity={0.18} className="pulse" />}
                  {isSel && <circle r={rad * 2.2} fill="none" stroke="#fff" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
                  <circle r={Math.max(rad, px(9))} fill="transparent" />
                  <circle r={rad} fill={fill} stroke={big ? '#fff' : 'rgba(5,9,18,0.8)'} strokeWidth={big ? 1.5 : 1} vectorEffect="non-scaling-stroke" />
                  {showLabel && (
                    <text y={-rad - px(5)} textAnchor="middle" fontSize={px(big ? 12 : 10.5)} className="ap-label">
                      {ap.code}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      {hover && tooltip && (
        <div className="map-tip" style={{ left: hover.x, top: hover.y }}>
          {tooltip(AIRPORT_BY_CODE[hover.code])}
        </div>
      )}
      {interactive && controls && (
        <div className="map-zoom">
          <button className="btn btn-icon btn-sm" onClick={() => zoomAt(1.6, MAP_W / 2, MAP_H / 2)} aria-label="Zoom in"><Plus /></button>
          <button className="btn btn-icon btn-sm" onClick={() => zoomAt(1 / 1.6, MAP_W / 2, MAP_H / 2)} aria-label="Zoom out"><Minus /></button>
          <button className="btn btn-icon btn-sm" onClick={doFit} aria-label="Reset view"><Maximize2 /></button>
        </div>
      )}
    </div>
  );
}
