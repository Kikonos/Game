import { useEffect, useMemo, useRef, useState } from 'react';
import { AVIATION_FACTS, LOADING_STEPS } from '../../data/flavor';
import { PLANE_PATH } from '../components/Logo';
import { loadMapData } from '../map/mapData';
import { deserialize } from '../../engine/save';
import { store, takeResumeSave } from '../store';

const MIN_MS = 3200;
const ARC = 'M 40 230 C 200 220, 360 150, 470 40';

export function Loading() {
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);
  const [plane, setPlane] = useState({ x: 40, y: 230, a: 0 });
  const arcRef = useRef<SVGPathElement>(null);
  const fact = useMemo(() => AVIATION_FACTS[Math.floor(Math.random() * AVIATION_FACTS.length)], []);

  useEffect(() => {
    let cancelled = false;
    const t0 = performance.now();
    let loaded = false;
    const work = Promise.all([
      loadMapData(),
      document.fonts?.ready ?? Promise.resolve(),
    ]).then(() => { loaded = true; });
    work.catch(() => { loaded = true; });
    const tick = () => {
      if (cancelled) return;
      const t = (performance.now() - t0) / MIN_MS;
      const p = loaded ? Math.min(1, t) : Math.min(0.9, t);
      setProgress(p);
      const el = arcRef.current;
      if (el) {
        const len = el.getTotalLength();
        const a = el.getPointAtLength(p * len);
        const b = el.getPointAtLength(Math.min(len, p * len + 2));
        const c = el.getPointAtLength(Math.max(0, p * len - 2));
        setPlane({ x: a.x, y: a.y, a: (Math.atan2(b.y - c.y, b.x - c.x) * 180) / Math.PI + 90 });
      }
      if (p >= 1) {
        setDone(true);
        setTimeout(() => {
          if (cancelled) return;
          const resume = takeResumeSave();
          if (resume) {
            try {
              store.loadGame(deserialize(resume));
              return;
            } catch {
              // fall through to the title screen
            }
          }
          store.setScreen('title');
        }, 450);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => { cancelled = true; };
  }, []);

  const step = LOADING_STEPS[Math.min(LOADING_STEPS.length - 1, Math.floor(progress * LOADING_STEPS.length))];

  return (
    <div className={`loading ${done ? 'out' : ''}`}>
      <div className="loading-grid" />
      <div className="loading-center">
        <svg className="loading-arc" viewBox="0 0 510 270" aria-hidden>
          <defs>
            <linearGradient id="arc-g" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0" stopColor="#3ee6ff" stopOpacity="0" />
              <stop offset="0.6" stopColor="#3ee6ff" />
              <stop offset="1" stopColor="#8b5cff" />
            </linearGradient>
            <filter id="arc-glow"><feGaussianBlur stdDeviation="4" /></filter>
          </defs>
          <path d={ARC} className="arc-glow" stroke="url(#arc-g)" strokeWidth="10" fill="none" filter="url(#arc-glow)" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - progress }} />
          <path ref={arcRef} d={ARC} stroke="url(#arc-g)" strokeWidth="4" fill="none" strokeLinecap="round" pathLength={1} style={{ strokeDasharray: 1, strokeDashoffset: 1 - progress }} />
          <g className="arc-plane" transform={`translate(${plane.x} ${plane.y}) rotate(${plane.a})`}>
            <g transform="translate(-18 -18) scale(1.5)">
              <path d={PLANE_PATH} fill="#fff" />
            </g>
          </g>
        </svg>
        <h1 className="loading-word">CONTRAIL</h1>
        <div className="loading-tag">AIRLINE EMPIRE</div>
        <div className="loading-bar"><span style={{ width: `${progress * 100}%` }} /></div>
        <div className="loading-step mono">
          <span>{step}…</span>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </div>
      <div className="loading-fact">
        <span className="upper accent">Did you know?</span>
        <p>{fact}</p>
      </div>
    </div>
  );
}
