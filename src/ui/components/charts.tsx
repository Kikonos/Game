// Lightweight SVG charts: thin marks, recessive grid, hover tooltips.

import { useLayoutEffect, useRef, useState } from 'react';

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    setW(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceTicks(min: number, max: number, count = 4): number[] {
  if (max === min) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

export interface Series {
  name: string;
  color: string;
  values: number[];
}

export function LineChart({
  series, labels, height = 200, format = (v) => String(Math.round(v)), area = true, zero = true,
}: {
  series: Series[];
  labels: string[];
  height?: number;
  format?: (v: number) => string;
  area?: boolean;
  zero?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values);
  const min = Math.min(zero ? 0 : Infinity, ...all);
  const max = Math.max(zero ? 0 : -Infinity, ...all);
  const ticks = niceTicks(min, max);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const padL = 52, padR = 12, padT = 10, padB = 24;
  const w = Math.max(10, width - padL - padR);
  const h = height - padT - padB;
  const x = (i: number) => padL + (n <= 1 ? w / 2 : (i / (n - 1)) * w);
  const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));

  const onMove = (e: React.MouseEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round((px / r.width) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };

  return (
    <div className="chart" ref={ref} style={{ height, position: 'relative' }}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(148,170,220,0.35)' : 'rgba(148,170,220,0.09)'} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)" className="num">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">{l}</text>
          ))}
          {series.map((s) => {
            const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
            return (
              <g key={s.name}>
                {area && series.length === 1 && (
                  <polygon points={`${x(0)},${y(Math.max(lo, 0))} ${pts} ${x(s.values.length - 1)},${y(Math.max(lo, 0))}`} fill={s.color} opacity="0.12" />
                )}
                <polyline points={pts} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + h} stroke="rgba(148,170,220,0.4)" strokeDasharray="3 3" />
              {series.map((s) => (
                <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r="4" fill={s.color} stroke="var(--panel-solid)" strokeWidth="2" />
              ))}
            </g>
          )}
          <rect x={padL} y={padT} width={w} height={h} fill="transparent" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="viz-tip" style={{ left: Math.min(width - 80, Math.max(80, x(hover))), top: padT + 8 }}>
          <div className="t-h">{labels[hover]}</div>
          {series.map((s) => (
            <div className="t-r" key={s.name}>
              <span className="row gap-4"><span className="dot" style={{ background: s.color }} />{s.name}</span>
              <span>{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BarChart({
  values, labels, height = 180, format = (v) => String(Math.round(v)), pos = 'var(--pos)', neg = 'var(--neg)', name = 'Value',
}: {
  values: number[];
  labels: string[];
  height?: number;
  format?: (v: number) => string;
  pos?: string;
  neg?: string;
  name?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const padL = 52, padR = 8, padT = 10, padB = 24;
  const w = Math.max(10, width - padL - padR);
  const h = height - padT - padB;
  const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const slot = w / Math.max(1, n);
  const bw = Math.max(3, Math.min(28, slot - 2));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 56))));
  return (
    <div className="chart" ref={ref} style={{ height, position: 'relative' }}>
      {width > 0 && (
        <svg width={width} height={height}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(148,170,220,0.35)' : 'rgba(148,170,220,0.09)'} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{format(t)}</text>
            </g>
          ))}
          {values.map((v, i) => {
            const cx = padL + slot * i + slot / 2;
            const y0 = y(0);
            const y1 = y(v);
            const top = Math.min(y0, y1);
            const hh = Math.max(1, Math.abs(y1 - y0));
            const r = Math.min(4, bw / 2, hh);
            // Rounded only at the data end, square at the baseline.
            const d = v >= 0
              ? `M ${cx - bw / 2} ${y0} L ${cx - bw / 2} ${top + r} Q ${cx - bw / 2} ${top} ${cx - bw / 2 + r} ${top} L ${cx + bw / 2 - r} ${top} Q ${cx + bw / 2} ${top} ${cx + bw / 2} ${top + r} L ${cx + bw / 2} ${y0} Z`
              : `M ${cx - bw / 2} ${y0} L ${cx - bw / 2} ${top + hh - r} Q ${cx - bw / 2} ${top + hh} ${cx - bw / 2 + r} ${top + hh} L ${cx + bw / 2 - r} ${top + hh} Q ${cx + bw / 2} ${top + hh} ${cx + bw / 2} ${top + hh - r} L ${cx + bw / 2} ${y0} Z`;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - slot / 2} y={padT} width={slot} height={h} fill="transparent" />
                <path d={d} fill={v >= 0 ? pos : neg} opacity={hover === null || hover === i ? 1 : 0.55} />
              </g>
            );
          })}
          {labels.map((l, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={i} x={padL + slot * i + slot / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">{l}</text>
          ))}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="viz-tip" style={{ left: Math.min(width - 80, Math.max(80, padL + slot * hover + slot / 2)), top: Math.max(30, y(Math.max(0, values[hover]))) }}>
          <div className="t-h">{labels[hover]}</div>
          <div className="t-r"><span>{name}</span><span>{format(values[hover])}</span></div>
        </div>
      )}
    </div>
  );
}

/** Two series side by side per period on one shared axis (e.g. revenue vs costs). */
export function PairBars({
  a, b, labels, height = 200, format = (v) => String(Math.round(v)),
}: {
  a: Series;
  b: Series;
  labels: string[];
  height?: number;
  format?: (v: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const ticks = niceTicks(0, Math.max(1, ...a.values, ...b.values));
  const hi = ticks[ticks.length - 1];
  const padL = 52, padR = 8, padT = 10, padB = 24;
  const w = Math.max(10, width - padL - padR);
  const h = height - padT - padB;
  const y = (v: number) => padT + h - (v / (hi || 1)) * h;
  const slot = w / Math.max(1, n);
  const bw = Math.max(2, Math.min(14, (slot - 6) / 2));
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 56))));
  const bar = (cx: number, v: number, color: string, key: string, dim: boolean) => {
    const top = y(v);
    const y0 = y(0);
    const r = Math.min(4, bw / 2, Math.max(0, y0 - top));
    return (
      <path
        key={key}
        d={`M ${cx - bw / 2} ${y0} L ${cx - bw / 2} ${top + r} Q ${cx - bw / 2} ${top} ${cx - bw / 2 + r} ${top} L ${cx + bw / 2 - r} ${top} Q ${cx + bw / 2} ${top} ${cx + bw / 2} ${top + r} L ${cx + bw / 2} ${y0} Z`}
        fill={color}
        opacity={dim ? 0.5 : 1}
      />
    );
  };
  return (
    <div className="chart" ref={ref} style={{ height, position: 'relative' }}>
      {width > 0 && (
        <svg width={width} height={height}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'rgba(148,170,220,0.35)' : 'rgba(148,170,220,0.09)'} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--text-3)">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => {
            const cx = padL + slot * i + slot / 2;
            const dim = hover !== null && hover !== i;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={cx - slot / 2} y={padT} width={slot} height={h} fill="transparent" />
                {bar(cx - bw / 2 - 1, a.values[i] ?? 0, a.color, 'a', dim)}
                {bar(cx + bw / 2 + 1, b.values[i] ?? 0, b.color, 'b', dim)}
                {(i % labelEvery === 0 || i === n - 1) && <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--text-3)">{l}</text>}
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && width > 0 && (
        <div className="viz-tip" style={{ left: Math.min(width - 80, Math.max(80, padL + slot * hover + slot / 2)), top: 40 }}>
          <div className="t-h">{labels[hover]}</div>
          {[a, b].map((s) => (
            <div className="t-r" key={s.name}>
              <span className="row gap-4"><span className="dot" style={{ background: s.color }} />{s.name}</span>
              <span>{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.name} className="row gap-4 small muted"><span className="dot" style={{ background: i.color }} />{i.name}</span>
      ))}
    </div>
  );
}

export function Sparkline({ values, color = 'var(--accent)', width = 90, height = 28 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 3 - ((v - min) / (max - min || 1)) * (height - 6)}`).join(' ');
  return (
    <svg width={width} height={height} aria-hidden>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
