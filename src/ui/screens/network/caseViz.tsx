// v0.21 the business case's pictures (player report bmwbjlg2n93bp: "simple visuals … another form factor" than the
// Finance donuts): a waterfall from revenue to the result, a load meter with the break-even mark, the seats of a
// stopover by market, and the margin against what scheduled routes usually earn. Hand-written SVG and CSS, the fixed
// colour-blind-safe tokens (--cat-*) in both themes, every mark labelled in words and numbers (never colour alone).

import type { MoneyParts } from '../../../engine/network';
import { money, moneyDelta, pct } from '../../format';

export interface FallRow { key: string; label: string; value: number; kind: 'in' | 'out' | 'sum'; hint: string }

/** The waterfall's rows from a year's money by kind: revenue in, each cost group out, the result. Pure. */
export function fallRows(p: MoneyParts, partner: boolean): FallRow[] {
  const rev = p.tickets + p.cargo + p.extras + p.fee;
  const rows: FallRow[] = [];
  if (partner) rows.push({ key: 'fee', label: 'Partner pays', value: p.fee, kind: 'in', hint: `Our fee for each block hour (${money(p.fee - p.passed)}) plus the flying costs the partner repays at cost (${money(p.passed)}).` });
  else rows.push({ key: 'tickets', label: 'Tickets', value: p.tickets, kind: 'in', hint: 'What passengers pay us, after taxes: the mix of cheap, normal and flexible fares.' });
  if (p.cargo > 0) rows.push({ key: 'cargo', label: 'Cargo', value: p.cargo, kind: 'in', hint: 'Freight and mail in the hold.' });
  if (p.extras > 0) rows.push({ key: 'extras', label: 'Extras', value: p.extras, kind: 'in', hint: 'Extra bags, seats and sales on board.' });
  const out: [string, string, number, string][] = [
    ['fuel', 'Fuel', p.fuel, 'Fuel burnt on every sector, at each airport’s price.'],
    ['airport', 'Airports', p.airport, 'Landing and passenger charges, ground handling and air navigation.'],
    ['service', 'On board', p.service, 'Meals and drinks, the booking system, passenger insurance and the lounge.'],
    ['sales', 'Selling', p.sales, 'Travel agents’ commission, booking-system fees and card fees.'],
    ['disruption', 'Bad days', p.disruption, 'An allowance for what a year brings: late flights and passenger compensation, a sub-charter when the aircraft is away, a rival cutting fares after our launch.'],
    ['maint', 'Maintenance', p.maint, 'Maintenance for the hours flown, and the reserves a lessor asks.'],
    ['overheads', 'Station', p.overheads, 'The station at the far end (a manager, a sales desk), the booking set-up and the monthly marketing.'],
    ['aircraft', 'Aircraft', p.aircraft, 'The aircraft’s lease and insurance for the hours this route takes.'],
    ['crew', 'Crew', p.crew, 'Crew pay for the hours, their hotel nights and allowances away, and a third pilot on a long day.'],
  ];
  for (const [key, label, value, hint] of out) if (value > 0) rows.push({ key, label, value, kind: 'out', hint });
  const cost = out.reduce((a, x) => a + x[2], 0);
  rows.push({ key: 'result', label: 'Result', value: rev - cost, kind: 'sum', hint: 'What is left after every cost, the aircraft and the crew included.' });
  return rows;
}

/** Revenue to result, one row a step: each bar starts where the one above ended. */
export function Waterfall({ parts, partner }: { parts: MoneyParts; partner: boolean }) {
  const rows = fallRows(parts, partner);
  const rev = rows.filter((r) => r.kind === 'in').reduce((a, r) => a + r.value, 0);
  const result = rows[rows.length - 1].value;
  const lo = Math.min(0, result);
  const span = Math.max(1, rev - lo);
  const x = (v: number) => ((v - lo) / span) * 100;
  let run = 0;
  return (
    <div className="nv-fall" role="table" aria-label="From revenue to the result, the likely year">
      {rows.map((r) => {
        const a = r.kind === 'in' ? run : r.kind === 'out' ? run - r.value : Math.min(0, r.value);
        const b = r.kind === 'in' ? run + r.value : r.kind === 'out' ? run : Math.max(0, r.value);
        if (r.kind === 'in') run += r.value;
        if (r.kind === 'out') run -= r.value;
        const tone = r.kind === 'sum' ? (r.value >= 0 ? 'good' : 'bad') : r.kind;
        return (
          <div key={r.key} className={`nv-fall-row ${r.kind}`} role="row" title={r.hint}>
            <span className="nv-fall-label" role="cell">{r.label}</span>
            <span className="nv-fall-track" role="presentation">
              {lo < 0 && <i className="nv-fall-zero" style={{ left: `${x(0)}%` }} />}
              <i className={`nv-fall-bar ${tone}`} style={{ left: `${x(a)}%`, width: `${Math.max(0.6, x(b) - x(a))}%` }} />
            </span>
            <span className={`nv-fall-val num ${r.kind === 'sum' ? tone : ''}`} role="cell">{r.kind === 'out' ? `−${money(r.value)}` : r.kind === 'sum' ? moneyDelta(r.value) : money(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** How full the flights are: the likely load, the weak-to-strong range and the load it needs to break even. */
export function LoadMeter({ lf, lo, hi, breakEven }: { lf: number; lo: number; hi: number; breakEven: number }) {
  const c = (v: number) => Math.max(0, Math.min(1, v)) * 100;
  const ok = lf >= breakEven;
  const over = breakEven > 1;
  return (
    <div className="nv-load" role="img" aria-label={`Flights about ${pct(lf)} full (${pct(lo)} to ${pct(hi)}); break-even at ${over ? 'more than 100 %' : pct(breakEven)}`}>
      <div className="nv-load-head"><b className="num">{pct(lf)}</b><span className="small muted">of seats filled</span><span className={`small nv-load-word ${ok ? 'good' : 'bad'}`}>{ok ? `${Math.round((lf - breakEven) * 100)} points above break-even` : over ? 'cannot break even' : `${Math.round((breakEven - lf) * 100)} points short`}</span></div>
      <div className="nv-load-track">
        <i className="nv-load-range" style={{ left: `${c(lo)}%`, width: `${Math.max(1, c(hi) - c(lo))}%` }} />
        <i className="nv-load-fill" style={{ width: `${c(lf)}%` }} />
        {!over && <i className="nv-load-be" style={{ left: `${c(breakEven)}%` }} />}
      </div>
      <div className="nv-load-scale tiny dim"><span>0</span>{!over && <span className="nv-load-be-label" style={{ left: `${c(breakEven)}%` }}>break-even {pct(breakEven)}</span>}<span>100 %</span></div>
    </div>
  );
}

/** A stopover's seats on each leg: who sits where (through passengers on both). */
export function SeatSplit({ a, b, c, split }: { a: string; b: string; c: string; split: { thr: number; ab: number; bc: number; seats: number } }) {
  const n = Math.max(1, split.seats);
  const legs: [string, [string, number, string][]][] = [
    [`${a} – ${b}`, [['thr', split.thr, `${a}–${c}`], ['ab', split.ab, `${a}–${b}`]]],
    [`${b} – ${c}`, [['thr', split.thr, `${a}–${c}`], ['bc', split.bc, `${b}–${c}`]]],
  ];
  return (
    <div className="nv-seats" role="img" aria-label={`Passengers a flight: ${Math.round(split.thr)} fly ${a} to ${c}, ${Math.round(split.ab)} ${a} to ${b}, ${Math.round(split.bc)} ${b} to ${c}, on ${split.seats} seats`}>
      {legs.map(([name, parts]) => {
        const used = parts.reduce((s, p) => s + p[1], 0);
        return (
          <div key={name} className="nv-seats-leg">
            <span className="tiny muted mono nv-seats-name">{name}</span>
            <span className="nv-seats-bar">
              {parts.filter((p) => p[1] >= 0.5).map(([k, v]) => <i key={k} className={`nv-seat ${k}`} style={{ width: `${(v / n) * 100}%` }} />)}
            </span>
            <span className="tiny num muted nv-seats-n">{Math.round(used)} / {split.seats}</span>
          </div>
        );
      })}
      <div className="nv-seats-key tiny">
        <span><i className="nv-seat thr" /> {a}–{c} <b className="num">{Math.round(split.thr)}</b></span>
        <span><i className="nv-seat ab" /> {a}–{b} <b className="num">{Math.round(split.ab)}</b></span>
        <span><i className="nv-seat bc" /> {b}–{c} <b className="num">{Math.round(split.bc)}</b></span>
      </div>
    </div>
  );
}

const ZONES: [number, number, string][] = [[-0.1, 0, 'Loses money'], [0, 0.05, 'Thin'], [0.05, 0.12, 'Healthy'], [0.12, 0.3, 'Strong']];

/** The margin on a scale of what scheduled routes earn, with the weak-to-strong range and our other routes. */
export function MarginStrip({ lo, mid, hi, others }: { lo: number; mid: number; hi: number; others: { name: string; margin: number }[] }) {
  const min = -0.1;
  const max = 0.3;
  const x = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * 100;
  const zone = ZONES.find((z) => mid < z[1]) ?? ZONES[ZONES.length - 1];
  return (
    <div className="nv-margin" role="img" aria-label={`Margin about ${pct(mid)} (${pct(lo)} to ${pct(hi)}): ${zone[2].toLowerCase()}`}>
      <div className="nv-load-head"><b className="num">{pct(mid)}</b><span className="small muted">margin</span><span className="small nv-load-word">{zone[2]}</span></div>
      <div className="nv-margin-track">
        {ZONES.map((z, i) => <i key={z[2]} className={`nv-zone z${i} ${z === zone ? 'on' : ''}`} style={{ left: `${x(z[0])}%`, width: `${x(z[1]) - x(z[0])}%` }} />)}
        <i className="nv-margin-range" style={{ left: `${x(lo)}%`, width: `${Math.max(1, x(hi) - x(lo))}%` }} />
        {others.map((o) => <i key={o.name} className="nv-margin-other" style={{ left: `${x(o.margin)}%` }} title={`${o.name}: ${pct(o.margin)} over its last three months`} />)}
        <i className="nv-margin-dot" style={{ left: `${x(mid)}%` }} />
      </div>
      <div className="nv-margin-scale tiny dim">
        {ZONES.map((z) => <span key={z[2]} style={{ left: `${x(z[0])}%`, width: `${x(z[1]) - x(z[0])}%` }}>{z[2]}</span>)}
      </div>
      {others.length > 0 && <div className="tiny muted nv-margin-key"><i className="nv-margin-other key" /> our routes now: {others.slice(0, 3).map((o) => `${o.name} ${pct(o.margin)}`).join(' · ')}</div>}
    </div>
  );
}
