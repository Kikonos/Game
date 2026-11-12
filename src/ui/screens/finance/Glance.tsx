// v0.20 Finance › At a glance (player: "more visuals in finance, more easily digestible ... pie charts with different
// colours"). On top of the Finance screen: the month's verdict (made or lost, with and without one-offs) and the cash
// today, the three biggest changes on the month before, Expenses and Income (two donuts in
// plain groups, tap a slice or a row for its lines and what it is), each block hour's earnings and costs, plain tips,
// and the cash line behind and ahead with the big one-offs marked. Lazy-loaded (ui/screens/Finance.tsx); everything is
// computed once per month picked (and once a day for this month so far) from engine/finance/glance.ts.

import { ArrowDownRight, ArrowUpRight, ChevronRight, X } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DAY, fmtDay, monthKey, monthStart } from '../../../engine/core/time';
import type { GameState, LedgerCat, MonthKey, MonthStatement } from '../../../engine/core/types';
import {
  biggestChanges, cashPath, COST_GROUPS, financeTips, groupMonth, monthVerdict, perBlockHour, REV_GROUPS, type CashPath, type Change,
  type CostGroupId, type RevGroupId, type Slice, type Tip,
} from '../../../engine/finance/glance';
import { glanceFacts } from '../../../engine/finance/glanceFacts';
import { fitLabels, niceTicks } from '../../components/charts';
import { Card } from '../../components/ui';
import { Help } from '../../components/Help';
import { MONTH_BOOKING_NOTE } from '../../notes';
import { toCss } from '../../device';
import { money, moneyDelta } from '../../format';
import { store, type Tab } from '../../store';
import { useTouch } from '../../useMedia';
import { Dot } from '../common';
import { LEDGER_LABEL } from '../screenLogic';

const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longName = (k: MonthKey) => LONG[k % 12];

/** Group colours by fixed slot (theme tokens --cat-N, both themes); 'Other' is grey. */
const COST_COLOR: Record<CostGroupId, string> = {
  crew: 'var(--cat-1)', crewTravel: 'var(--cat-2)', aircraft: 'var(--cat-3)', mx: 'var(--cat-4)', flying: 'var(--cat-5)', overhead: 'var(--cat-6)', oneOff: 'var(--cat-7)', permits: 'var(--cat-8)', bank: 'var(--cat-9)', other: 'var(--cat-other)',
};
const REV_COLOR: Record<RevGroupId, string> = { acmi: 'var(--cat-1)', charter: 'var(--cat-2)', routes: 'var(--cat-3)', leases: 'var(--cat-4)', other: 'var(--cat-other)' };
const ABOUT = new Map<string, string>([...COST_GROUPS.map((d) => [`cost:${d.id}`, d.about] as const), ...REV_GROUPS.map((d) => [`revenue:${d.id}`, d.about] as const)]);

type Pick = { kind: 'cost'; id: CostGroupId } | { kind: 'revenue'; id: RevGroupId };
const pickKey = (p: Pick | null) => (p ? `${p.kind}:${p.id}` : '');
const pct = (r: number) => (r > 0 && r < 0.005 ? '<1%' : `${Math.round(r * 100)}%`);
/** Axis ticks: whole millions without decimals ($5M, not $5.00M). */
const tick = (v: number) => money(v, Math.abs(v) >= 1e6 && Math.abs(v) % 1e6 === 0 ? 0 : undefined);
const perH = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((e) => setW(e[0].contentRect.width));
    ro.observe(el);
    setW(toCss(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// ---------- donut ----------

function arc(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const p = (r: number, a: number) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(r1, a0)} A ${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L ${p(r0, a1)} A ${r0} ${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
}

function Donut<Id extends string>({ slices, colors, kind, total, caption, pick, onPick }: {
  slices: Slice<Id>[]; colors: Record<Id, string>; kind: Pick['kind']; total: number; caption: string; pick: Pick | null; onPick: (p: Pick | null) => void;
}) {
  const [hover, setHover] = useState<Id | null>(null);
  const S = 172;
  const c = S / 2;
  const r1 = c - 6;
  const r0 = r1 - 24;
  // v0.23.1 the biggest line first (player report bmwdgq50o8vuy); a tie keeps the groups' own order.
  const shown = slices.map((s, i) => ({ s, i })).filter((x) => x.s.amount > 0).sort((x, y) => y.s.amount - x.s.amount || x.i - y.i).map((x) => x.s);
  const on = pick?.kind === kind ? (pick.id as Id) : null;
  const lit = hover ?? on;
  let a = -Math.PI / 2;
  const toggle = (id: Id) => onPick(on === id ? null : ({ kind, id } as Pick));
  return (
    <div className="gl-donut">
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="gl-donut-svg" role="img" aria-label={`${caption}: ${shown.map((s) => `${s.label} ${pct(s.share)}`).join(', ')}`}>
        {shown.length === 0 && <circle cx={c} cy={c} r={(r0 + r1) / 2} fill="none" stroke="rgba(var(--line-rgb),0.15)" strokeWidth={r1 - r0} />}
        {shown.map((s) => {
          const a0 = a;
          const a1 = a + s.share * Math.PI * 2;
          a = a1;
          const mid = (a0 + a1) / 2;
          const out = lit === s.id ? 4 : 0;
          const dx = out * Math.cos(mid);
          const dy = out * Math.sin(mid);
          const d = s.share >= 0.9999 ? `${arc(c, c, r0, r1, -Math.PI / 2, Math.PI * 1.5 - 1e-4)}` : arc(c, c, r0, r1, a0, a1);
          return (
            <path key={s.id} d={d} transform={`translate(${dx} ${dy})`} fill={colors[s.id]} stroke="var(--panel-solid)" strokeWidth={2} strokeLinejoin="round"
              opacity={lit && lit !== s.id ? 0.35 : 1} className="gl-slice"
              onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(s.id)} onPointerLeave={() => setHover(null)} onClick={() => toggle(s.id)}>
              <title>{`${s.label}: ${money(s.amount)} (${pct(s.share)})`}</title>
            </path>
          );
        })}
        <text x={c} y={c - 2} textAnchor="middle" className="gl-donut-total num" fill="var(--text)">{money(lit ? slices.find((s) => s.id === lit)!.amount : total)}</text>
        <text x={c} y={c + 16} textAnchor="middle" className="gl-donut-cap" fill="var(--text-3)">{lit ? pct(slices.find((s) => s.id === lit)!.share) : caption}</text>
      </svg>
      <div className="gl-legend" role="list">
        {shown.map((s) => (
          <button key={s.id} role="listitem" className={`gl-leg ${on === s.id ? 'on' : ''} ${lit && lit !== s.id ? 'dim' : ''}`} onClick={() => toggle(s.id)}
            onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(s.id)} onPointerLeave={() => setHover(null)} aria-pressed={on === s.id}>
            <span className="gl-sw" style={{ background: colors[s.id] }} aria-hidden />
            <span className="gl-leg-name">{s.label}</span>
            <span className="gl-leg-amt num">{money(s.amount)}</span>
            <span className="gl-leg-pct num">{pct(s.share)}</span>
          </button>
        ))}
        {!shown.length && <div className="small muted">Nothing booked yet.</div>}
      </div>
    </div>
  );
}

// ---------- detail of a picked group ----------

function Detail({ pick, groups, prev, bh, onClose }: { pick: Pick; groups: ReturnType<typeof groupMonth>; prev: ReturnType<typeof groupMonth> | null; bh: number; onClose: () => void }) {
  const list = pick.kind === 'cost' ? groups.costs : groups.revenue;
  const s = (list as Slice<string>[]).find((x) => x.id === pick.id);
  if (!s) return null;
  const before = prev ? ((pick.kind === 'cost' ? prev.costs : prev.revenue) as Slice<string>[]).find((x) => x.id === pick.id)?.amount ?? 0 : null;
  const of = pick.kind === 'cost' ? groups.totals.costs : groups.totals.revenue;
  const color = pick.kind === 'cost' ? COST_COLOR[pick.id] : REV_COLOR[pick.id];
  const link = pick.kind === 'cost' && pick.id === 'crew' ? { label: 'Crew › Utilisation', tab: 'crew' as Tab, view: 'use' }
    : pick.kind === 'cost' && pick.id === 'mx' ? { label: 'Fleet', tab: 'fleet' as Tab, view: undefined }
      : pick.kind === 'revenue' ? { label: 'Contracts', tab: 'contracts' as Tab, view: undefined } : null;
  return (
    <div className="gl-detail card">
      <div className="gl-detail-head">
        <span className="gl-sw lg" style={{ background: color }} aria-hidden />
        <b>{s.label}</b>
        <span className="num">{money(s.amount)}</span>
        <span className="muted small">{pct(of > 0 ? s.amount / of : 0)} of {pick.kind === 'cost' ? 'costs' : 'revenue'}</span>
        <button className="btn btn-ghost btn-icon gl-x" onClick={onClose} aria-label="Close"><X /></button>
      </div>
      <p className="small muted gl-about">{ABOUT.get(`${pick.kind}:${pick.id}`)}</p>
      <div className="gl-lines">
        {[...s.lines].sort((x, y) => y.amount - x.amount).map((l) => (
          <div key={l.cat} className="gl-line">
            <span>{LEDGER_LABEL[l.cat] ?? l.cat}</span>
            <span className="num">{money(l.amount)}</span>
            {bh >= 20 && <span className="num dim small">{perH(l.amount / bh)} / BH</span>}
          </div>
        ))}
      </div>
      <div className="row gap-12 wrap small gl-detail-foot">
        {before !== null && <span className="muted">Month before: <b className="num">{money(before)}</b> ({moneyDelta(s.amount - before)})</span>}
        {link && <button className="btn btn-sm" onClick={() => store.navigate(link.tab, link.view ? { view: link.view } : {})}>{link.label} <ChevronRight /></button>}
      </div>
    </div>
  );
}

// ---------- each block hour ----------

function HourBars({ g, pick, onPick }: { g: ReturnType<typeof perBlockHour> & object; pick: Pick | null; onPick: (p: Pick | null) => void }) {
  const max = Math.max(g.earn, g.cost, 1);
  const bar = (kind: Pick['kind'], parts: { id: string; amount: number }[], colors: Record<string, string>, total: number) => {
    const shown = parts.filter((p) => p.amount > 0.5);
    return (
      <div className="gl-hbar" style={{ width: `${(total / max) * 100}%` }}>
        {shown.map((p, i) => {
          const on = pick?.kind === kind && pick.id === p.id;
          const label = (kind === 'cost' ? COST_GROUPS : REV_GROUPS).find((d) => d.id === p.id)!.label;
          return (
            <button key={p.id} className={`gl-seg ${i === shown.length - 1 ? 'last' : ''} ${pick && !on ? 'dim' : ''}`} style={{ flexGrow: p.amount, background: colors[p.id] }}
              title={`${label}: ${perH(p.amount)} per block hour`} aria-label={`${label}: ${perH(p.amount)} per block hour`}
              onClick={() => onPick(on ? null : ({ kind, id: p.id } as Pick))} />
          );
        })}
      </div>
    );
  };
  const top = [...g.costs].sort((a, b) => b.amount - a.amount).slice(0, 3);
  return (
    <div className="gl-hours">
      <div className="gl-hrow">
        <span className="gl-hl">Earns</span>
        <div className="gl-htrack">{bar('revenue', g.revenue, REV_COLOR, g.earn)}</div>
        <b className="num gl-hv">{perH(g.earn)}</b>
      </div>
      <div className="gl-hrow">
        <span className="gl-hl">Costs</span>
        <div className="gl-htrack">{bar('cost', g.costs, COST_COLOR, g.cost)}</div>
        <b className="num gl-hv">{perH(g.cost)}</b>
      </div>
      <div className={`gl-hres ${g.profit >= 0 ? 'good' : 'bad'}`}>
        {g.profit >= 0 ? <>Each block hour keeps <b className="num">{perH(g.profit)}</b></> : <>Each block hour loses <b className="num">{perH(-g.profit)}</b></>}
      </div>
      <div className="small muted gl-htop">
        Biggest costs an hour: {top.map((t, i) => <span key={t.id}>{i ? ' · ' : ''}<span className="gl-sw sm" style={{ background: COST_COLOR[t.id] }} aria-hidden /> {COST_GROUPS.find((d) => d.id === t.id)!.label} <b className="num">{perH(t.amount)}</b></span>)}
      </div>
      <div className="tiny dim">{Math.round(g.bh).toLocaleString('en-US')} block hours flown{g.oneOffsLeftOut > 0 ? ` · one-offs (${money(g.oneOffsLeftOut)}) left out` : ''}</div>
    </div>
  );
}

// ---------- cash line ----------

function CashLine({ path, now }: { path: CashPath; now: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const fs = useTouch() ? 12 : 11;
  const height = 210;
  const pts = path.points;
  if (pts.length < 2) return <div ref={ref} className="small muted">The line starts when a month closes.</div>;
  const ticks = niceTicks(Math.min(0, ...pts.map((p) => p.cash)), Math.max(0, ...pts.map((p) => p.cash)));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const padL = Math.max(40, Math.max(...ticks.map((t) => tick(t).length)) * fs * 0.62 + 12);
  const padR = 14, padT = 22, padB = fs + 14;
  const w = Math.max(10, width - padL - padR);
  const h = height - padT - padB;
  const t0 = pts[0].t;
  const t1 = pts[pts.length - 1].t;
  const x = (t: number) => padL + ((t - t0) / (t1 - t0 || 1)) * w;
  const y = (v: number) => padT + h - ((v - lo) / (hi - lo || 1)) * h;
  const past = pts.filter((p) => !p.ahead);
  const ahead = [past[past.length - 1], ...pts.filter((p) => p.ahead)];
  const line = (xs: typeof pts) => xs.map((p) => `${x(p.t).toFixed(1)},${y(p.cash).toFixed(1)}`).join(' ');
  // Month labels at each month start in range.
  const months: { t: number; label: string }[] = [];
  const k0 = monthKey(t0);
  for (let k = k0; monthStart(k) <= t1; k++) if (monthStart(k) >= t0) months.push({ t: monthStart(k), label: SHORT[k % 12] });
  const every = Math.max(1, Math.ceil(months.length / Math.max(2, Math.floor(w / (fs * 4.2)))));
  const shownLbl = fitLabels(months.map((m) => m.label), months.map((m) => x(m.t)), fs, width, every);
  const pickAt = (px: number) => {
    const t = t0 + ((px - padL) / w) * (t1 - t0);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].t - t) < Math.abs(pts[best].t - t)) best = i;
    return best;
  };
  const at = (e: React.PointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget.ownerSVGElement ?? e.currentTarget).getBoundingClientRect();
    setHover(pickAt(toCss(e.clientX - r.left)));
  };
  const hp = hover !== null ? pts[hover] : null;
  const zx = path.zeroAt ?? path.backAt;
  return (
    <div className="chart gl-cash" ref={ref} style={{ height, position: 'relative' }}>
      {width > 0 && (
        <svg width={width} height={height}>
          {lo < 0 && <rect x={padL} y={y(0)} width={w} height={y(lo) - y(0)} fill="rgba(var(--bad-rgb),0.06)" />}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={padL + w} y1={y(t)} y2={y(t)} style={{ stroke: t === 0 ? 'rgba(var(--line-rgb),0.45)' : 'rgba(var(--line-rgb),0.09)' }} />
              <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize={fs} fill="var(--text-3)" className="num">{tick(t)}</text>
            </g>
          ))}
          {months.map((m, i) => shownLbl[i] && <text key={m.t} x={x(m.t)} y={height - 6} fontSize={fs} textAnchor="middle" fill="var(--text-3)">{m.label}</text>)}
          <line x1={x(now)} x2={x(now)} y1={padT - 8} y2={padT + h} style={{ stroke: 'rgba(var(--line-rgb),0.35)' }} strokeDasharray="2 3" />
          <text x={x(now)} y={padT - 11} fontSize={fs} textAnchor={x(now) > padL + w - 40 ? 'end' : 'middle'} fill="var(--text-2)">Today</text>
          {ahead.length > 1 && (
            <text x={padL + w} y={padT - 11} fontSize={fs} textAnchor="end" fill="var(--text-3)">{x(now) < padL + w - 120 ? 'Forecast →' : ''}</text>
          )}
          <polyline points={line(past)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {ahead.length > 1 && <polyline points={line(ahead)} fill="none" stroke="var(--accent)" strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />}
          {(() => {
            // Direct labels on the one-offs; a label that would touch the one before shows its dot only (the readout has it).
            let right = -Infinity;
            return path.events.map((ev) => {
              const ex = x(ev.t);
              const ey = y(ev.cash);
              const label = w < 420 ? money(ev.amount) : `${LEDGER_LABEL[ev.cat] ?? ev.cat} ${money(ev.amount)}`;
              const lw = label.length * fs * 0.56;
              const anchor = ex + lw / 2 > padL + w ? 'end' : ex - lw / 2 < padL ? 'start' : 'middle';
              const lx = anchor === 'end' ? ex + 6 : anchor === 'start' ? ex - 6 : ex;
              const l0 = anchor === 'end' ? lx - lw : anchor === 'start' ? lx : lx - lw / 2;
              const show = l0 > right + 8;
              if (show) right = l0 + lw;
              // A dip (both neighbours higher) takes its label below, clear of the line; else above, room allowing.
              const i = pts.findIndex((p) => p.t === ev.t);
              const dip = i > 0 && i < pts.length - 1 && pts[i - 1].cash > ev.cash && pts[i + 1].cash > ev.cash;
              const above = dip ? ey + 22 > padT + h : ey - 14 > padT + 4;
              return (
                <g key={ev.t} className="gl-event">
                  <circle cx={ex} cy={ey} r={5} fill="var(--panel-solid)" stroke="var(--text-2)" strokeWidth={2} />
                  {show && <text x={lx} y={above ? ey - 11 : ey + 20} fontSize={fs} textAnchor={anchor} fill="var(--text-2)">{label}</text>}
                </g>
              );
            });
          })()}
          {zx !== null && (
            <g>
              <circle cx={x(zx)} cy={y(0)} r={4.5} fill={path.zeroAt ? 'var(--bad)' : 'var(--good)'} stroke="var(--panel-solid)" strokeWidth={2} />
            </g>
          )}
          {hp && (
            <g>
              <line x1={x(hp.t)} x2={x(hp.t)} y1={padT} y2={padT + h} style={{ stroke: 'rgba(var(--line-rgb),0.4)' }} strokeDasharray="3 3" />
              <circle cx={x(hp.t)} cy={y(hp.cash)} r={4} fill="var(--accent)" stroke="var(--panel-solid)" strokeWidth={2} />
            </g>
          )}
          <rect x={padL} y={padT} width={w} height={h} fill="transparent" style={{ touchAction: 'pan-y' }}
            onPointerDown={(e) => e.pointerType !== 'mouse' && at(e)} onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons) && at(e)}
            onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(null)} />
        </svg>
      )}
      {hp && width > 0 && (
        <div className="viz-tip" style={{ left: Math.min(width - 80, Math.max(80, x(hp.t))), top: Math.max(54, y(hp.cash)) }}>
          <div className="t-h">{fmtDay(hp.t)}{hp.ahead ? ' · forecast' : hp.t === now ? ' · today' : ' · month end'}</div>
          <div className="t-r"><span>Cash</span><span>{money(hp.cash)}</span></div>
          {path.events.filter((ev) => ev.t === hp.t).map((ev) => <div className="t-r" key={ev.cat}><span>{LEDGER_LABEL[ev.cat] ?? ev.cat}</span><span>{money(ev.amount)}</span></div>)}
        </div>
      )}
    </div>
  );
}

// ---------- the whole view ----------

function changeChip(c: Change) {
  const up = c.delta > 0;
  return (
    <span key={`${c.kind}:${c.id}`} className={`gl-chip ${c.good ? 'good' : 'bad'}`}>
      {up ? <ArrowUpRight aria-hidden /> : <ArrowDownRight aria-hidden />}
      <span>{c.label}</span>
      <b className="num">{moneyDelta(c.delta)}</b>
    </span>
  );
}

function TipRow({ t }: { t: Tip }) {
  return (
    <div className="gl-tip">
      <Dot tone={t.tone} />
      <span>{t.text}</span>
      {t.link && <button className="btn btn-sm gl-tip-go" onClick={() => store.navigate(t.link!.tab, t.link!.view ? { view: t.link!.view } : {})}>{t.link.label} <ChevronRight /></button>}
    </div>
  );
}

export default function Glance({ g, forecast }: { g: GameState; forecast: { t: number; cash: number }[] }) {
  const day = Math.floor(g.now / DAY);
  const cur = g.finance.current;
  const closed = useMemo(() => g.finance.history.filter((m) => m.month < cur.month).sort((a, b) => b.month - a.month), [g.finance.history.length, cur.month]); // eslint-disable-line react-hooks/exhaustive-deps
  const choices = useMemo(() => [...closed.slice(0, 6).map((m) => m.month).reverse(), cur.month], [closed, cur.month]);
  const [sel, setSel] = useState<MonthKey | null>(null);
  const month = sel !== null && choices.includes(sel) ? sel : closed[0]?.month ?? cur.month;
  const isCur = month === cur.month;
  const [pick, setPick] = useState<Pick | null>(null);
  // The picked month stays in sight in the pill row (a narrow phone scrolls the row, never the page).
  const pills = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = pills.current;
    const on = el?.querySelector<HTMLElement>('.gl-month.on');
    if (el && on && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, on.offsetLeft - el.clientWidth / 2 + on.offsetWidth / 2);
  }, [month]);

  // One computation per month picked (this month so far: once a day).
  const view = useMemo(() => {
    const st: MonthStatement = isCur ? cur : closed.find((m) => m.month === month)!;
    const prevSt = (isCur ? closed[0] : closed.find((m) => m.month === month - 1)) ?? null;
    const groups = groupMonth(st.lines);
    return {
      st, groups, prev: prevSt ? groupMonth(prevSt.lines) : null, prevMonth: prevSt?.month ?? null,
      verdict: monthVerdict(st.lines), hours: perBlockHour(st), changes: prevSt ? biggestChanges(st.lines, prevSt.lines) : [],
    };
  }, [month, isCur, isCur ? day : 0, closed]); // eslint-disable-line react-hooks/exhaustive-deps
  const facts = useMemo(() => glanceFacts(g, forecast), [day, forecast]); // eslint-disable-line react-hooks/exhaustive-deps
  const tips = useMemo(() => financeTips(view.st.lines, isCur ? `${longName(month)} so far` : longName(month), facts, (c: LedgerCat) => LEDGER_LABEL[c] ?? c), [view, facts, isCur, month]);
  const path = useMemo(() => cashPath(g.finance.history, cur.month, g.company.cash, g.now, forecast), [day, forecast, g.finance.history.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const v = view.verdict;
  const name = isCur ? `${longName(month)} so far` : longName(month);
  const tone = v.profit >= 0 ? 'good' : 'bad';
  const cash = g.company.cash;
  const zero = path.zeroAt ?? path.backAt;
  return (
    <div className="gl">
      <div className="gl-months" role="tablist" aria-label="Month" ref={pills}>
        {choices.map((k) => (
          <button key={k} role="tab" aria-selected={k === month} className={`gl-month ${k === month ? 'on' : ''}`} onClick={() => { setSel(k); setPick(null); }}>
            {k === cur.month ? `${SHORT[k % 12]} so far` : SHORT[k % 12]}
          </button>
        ))}
      </div>

      <section className="card gl-verdict">
        <div className="gl-v-main">
          <div className="gl-v-k muted small">{name}{isCur && <> <Help title="How a month is booked">{MONTH_BOOKING_NOTE.map((t) => <p key={t}>{t}</p>)}</Help></>}</div>
          <div className={`gl-v-big ${tone}`}>{v.profit >= 0 ? 'You made ' : 'You lost '}<span className="num">{v.profit >= 0 ? moneyDelta(v.profit) : money(v.profit)}</span></div>
          <div className="gl-v-sub">
            Earned <b className="num">{money(v.revenue)}</b>, spent <b className="num">{money(v.costs)}</b>.
            {v.oneOffs > 0 && v.biggestOneOff && v.oneOffs >= v.costs * 0.05 && (
              <> Without the one-offs ({LEDGER_LABEL[v.biggestOneOff.cat]?.toLowerCase() ?? 'one-offs'}{v.oneOffs > v.biggestOneOff.amount + 1 ? ' and others' : ''}, {money(v.oneOffs)}): <b className={`num ${v.underlying >= 0 ? 'good' : 'bad'}`}>{moneyDelta(v.underlying)}</b>.</>
            )}
          </div>
        </div>
        <div className="gl-v-cash">
          <div className="gl-v-k muted small">Cash today</div>
          <div className={`gl-v-cashv num ${cash < 0 ? 'bad' : ''}`}>{money(cash)}</div>
          {path.trend3 !== null && (
            <div className="small muted row gap-4 gl-v-trend">
              {path.trend3 >= 0 ? <ArrowUpRight className="good" aria-hidden /> : <ArrowDownRight className="bad" aria-hidden />}
              {path.trend3 >= 0 ? 'up' : 'down'} <b className="num">{money(Math.abs(path.trend3))}</b> in 3 months
            </div>
          )}
          {zero !== null && <div className={`small ${path.zeroAt ? 'bad' : 'good'}`}>{path.zeroAt ? `Below zero around ${fmtDay(zero)}` : `Back above zero around ${fmtDay(zero)}`}</div>}
          {zero === null && cash < 0 && <div className="small bad">Not back above zero in the next 90 days</div>}
        </div>
        {view.changes.length > 0 && (
          <div className="gl-changes">
            <span className="tiny muted">vs {view.prevMonth !== null ? longName(view.prevMonth) : 'the month before'}</span>
            {view.changes.map(changeChip)}
          </div>
        )}
      </section>

      <div className="gl-two gl-donuts">
        <Card title="Expenses" sub="tap a slice">
          <Donut slices={view.groups.costs} colors={COST_COLOR} kind="cost" total={view.groups.totals.costs} caption="spent" pick={pick} onPick={setPick} />
        </Card>
        <Card title="Income" sub="tap a slice">
          <Donut slices={view.groups.revenue} colors={REV_COLOR} kind="revenue" total={view.groups.totals.revenue} caption="earned" pick={pick} onPick={setPick} />
        </Card>
      </div>
      {pick && <Detail key={pickKey(pick)} pick={pick} groups={view.groups} prev={view.prev} bh={view.st.bh} onClose={() => setPick(null)} />}

      <div className="gl-two">
        <Card title="Each block hour">
          {view.hours ? <HourBars g={view.hours} pick={pick} onPick={setPick} /> : <div className="small muted">Too few block hours this month to say.</div>}
        </Card>
        <Card title="Tips" sub="from your numbers">
          {tips.length ? <div className="gl-tips">{tips.map((t) => <TipRow key={t.id} t={t} />)}</div> : <div className="small muted">Nothing stands out this month.</div>}
        </Card>
      </div>

      <Card title="Cash" sub="the last 12 months, then the next 90 days (dashed)">
        <CashLine path={path} now={g.now} />
      </Card>
    </div>
  );
}
