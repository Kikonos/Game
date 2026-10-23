// Crew (B5): staffing strip, filterable list with 28-day duty / block bars, and a detail panel with every
// limit, morale and fatigue, days off and a 14-day roster; Train / Hire similar. DESIGN.md §6.3.

import { ArrowDownRight, ArrowRight, ArrowUpRight, Check, CheckSquare, GraduationCap, Layers, LayoutGrid, List, Lock, Search, UserPlus, Users, X } from 'lucide-react';
import { CrewPlanView, PlanStrip } from './CrewPlan';
import { FlightTypeChip } from '../components/FlightType';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flag } from '../../data/countries';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDate, fmtDay, fmtTime, monthKey, toDate } from '../../engine/core/time';
import type { CrewMember, CrewStatus, GameState } from '../../engine/core/types';
import {
  type CalBlock, classOf, conversionClasses, crewCalendar, crewName, crewRev, crewStatusView, crewTravelNow, type CrewTravelNow, crewWindows, familyLabel, LIMITS,
  moraleOf, moraleSummary, type CrewWindows,
} from '../../engine/crew';
import { crewGauges, crewMonth, publishedTo } from '../../engine/crew';
import { problemAt } from '../../engine/problems';
import { Gauge } from '../components/Gauge';
import { restNow } from '../components/problemLogic';
import { Why } from '../components/Why';
import { Empty, Seg } from '../components/ui';
import { RosterBoard } from './RosterBoard';
import { moraleTone } from './rosterBoardLogic';
import { money } from '../format';
import { dutyRoute } from '../modals/DutyModal';
import { store, useGame } from '../store';
import { Dot, KV, LimitBar, ScreenHead, useRenderCount } from './common';
import { CAL_KEY_LABEL, calAt, calId, calKey, calLabel, calLayer, calLegend, pickCal, stripText } from './crewLogic';
import { baseDay, CREW_STATUS_LABEL, filterCrew, isPilotRole, limitTone, NO_FILTER, ROLE_LABEL, type CrewFilter } from './screenLogic';
import { ScreenHint } from '../components/ScreenHint';

const STATUS_TONE: Record<CrewStatus, 'good' | 'warn' | 'bad' | 'info' | 'off'> = {
  available: 'good', onDuty: 'info', resting: 'off', off: 'off', leave: 'off', sick: 'bad', training: 'warn', joining: 'warn',
};
const PAGE = 60;
const h = (min: number) => min / HOUR;

function CrewRow({ g, c, w, on, t, selecting, checked, onTap }: { g: GameState; c: CrewMember; w: CrewWindows; on: boolean; t: CrewTravelNow | null; selecting: boolean; checked: boolean; onTap: () => void }) {
  // v0.5.2: travelling as a passenger beats the stored status ('Deadheading · DUB→LIS').
  const where = t ? `${t.kind === 'deadhead' ? 'Deadheading' : 'Positioning'} · ${t.phase === 'air' ? `${t.from}→${t.to}` : t.from}` : null;
  // v0.6: a conversion class ('Conversion A330 · until 15 Jul', or booked) and the leave date of crew on notice.
  const cls = classOf(g, c.id);
  const training = c.status === 'training' ? crewStatusView(g, c.id).text.replace(/ · Leaves .*$/, '') : null;
  const booked = cls && cls.status === 'planned' ? ` · Conversion ${familyLabel(cls.family)} from ${baseDay(g, cls.start)}` : '';
  // v0.7.1 §10: a WHY? dot when a problem sits on this person (sick with a trip to cover, resigned with trips ahead).
  const prob = c.status === 'sick' || c.notice ? problemAt(g, { kind: 'crew', id: c.id }) : null;
  return (
    <button className={`sc-crew-row ${on ? 'on' : ''} ${selecting ? 'selecting' : ''} ${checked ? 'checked' : ''}`} onClick={onTap} aria-pressed={selecting ? checked : undefined}>
      {selecting && <span className={`rb-check ${checked ? 'on' : ''}`} aria-hidden>{checked && <Check />}</span>}
      <span className="col sc-crew-name">
        <span className="row gap-8"><span className={`rb-morale ${moraleTone(c.morale)}`} aria-label={`Morale ${Math.round(c.morale)}`} title={`Morale ${Math.round(c.morale)}`} /><span className={`sc-role r-${c.role}`}>{c.role}</span><b className="ellipsis">{c.last}, {c.first}</b></span>
        <span className="tiny muted row gap-4 ellipsis">
          {prob ? <Why refs={{ kind: 'crew', id: c.id }} tone={prob.severity === 'red' ? 'bad' : 'warn'} /> : null}
          {where ? <>{!prob && <Dot tone="info" />}{where}</> : training ? <>{!prob && <Dot tone="warn" />}{training}</> : <>{!prob && <Dot tone={STATUS_TONE[c.status]} />}{CREW_STATUS_LABEL[c.status]} · {c.loc}{c.loc !== c.base ? ` (base ${c.base})` : ''}{booked}</>}
          {c.notice && <span className="bad nowrap"> · Leaves {fmtDay(c.notice.leaves - 1)}</span>}
        </span>
      </span>
      <span className="sc-crew-bars">
        <MiniBar label="Duty 28d" v={h(w.duty28d)} max={h(LIMITS.duty28d)} />
        <MiniBar label="Block 28d" v={h(w.block28d)} max={h(LIMITS.block28d)} />
      </span>
    </button>
  );
}

function MiniBar({ label, v, max }: { label: string; v: number; max: number }) {
  const r = max > 0 ? v / max : 0;
  return (
    <span className="sc-mini">
      <span className="tiny dim">{label} <span className="num">{Math.round(v)}/{max}h</span></span>
      <span className={`bar thin ${limitTone(r)}`}><span style={{ width: `${Math.min(100, r * 100)}%` }} /></span>
    </span>
  );
}

/** The crew member holds a seat on this pairing that the player set (survives the re-plan). */
const locked = (g: GameState, pairingId: string, crewId: string) => !!g.pairings[pairingId]?.slots.some((x) => x.crewId === crewId && x.locked);

const isStatus = (b: CalBlock) => b.kind === 'sick' || b.kind === 'joining' || b.kind === 'training' || b.kind === 'leave';
const when = (t: number) => `${fmtDay(t)} ${fmtTime(t)}`;
const spanText = (b: CalBlock) => isStatus(b) ? `${fmtDay(b.start)} – ${fmtDay(b.end)}` : (Math.floor(b.start / DAY) === Math.floor(b.end / DAY) ? `${fmtDay(b.start)} ${fmtTime(b.start)}–${fmtTime(b.end)} UTC` : `${when(b.start)} – ${when(b.end)} UTC`);
/** Whole days for status windows ('until 12 Mar'), clock times for work and travel. */
const rowTime = (b: CalBlock) => (isStatus(b) ? `${fmtDay(b.start)} – ${fmtDay(b.end)}` : `${fmtDay(b.start)} ${fmtTime(b.start)}`);

/** Tap-for-details card under the strip: what, when (UTC), the engine's detail and, for duties, the legs and crew change. */
function CalDetail({ g, c, b }: { g: GameState; c: CrewMember; b: CalBlock }) {
  const key = calKey(b);
  const [line1, line2] = b.detail.split('\n');
  const d = b.dutyId ? g.duties[b.dutyId] : undefined;
  return (
    <div className={`sc-cal-detail k-${key}`}>
      <div className="row gap-8">
        <span className={`sc-cal-sw k-${key}`} aria-hidden />
        <b>{calLabel(b)}</b>
        {b.legality && b.legality !== 'legal' && <span className={`badge ${b.legality === 'tight' ? 'warn' : 'bad'}`}>{b.legality}</span>}
        {d && locked(g, d.pairingId, c.id) && <Lock className="sc-ico-s accent" aria-label="set by you" />}
        <span className="grow" />
        <span className="small muted nowrap">{spanText(b)}</span>
      </div>
      <div className="small muted">{line1}</div>
      {b.flights && b.flights.length > 0 && (
        <div className="sc-cal-legs">
          {b.flights.map((f) => (
            <span key={f.id} className="sc-cal-leg small">
              <span className="mono">{f.no}</span>
              <span className="mono">{f.from}–{f.to}</span>
              <span className="dim num">{fmtTime(f.std)}–{fmtTime(f.sta)}</span>
              <FlightTypeChip type={f.type} />
            </span>
          ))}
        </div>
      )}
      {line2 && !(b.kind === 'duty' && b.flights?.length) && <div className="small dim">{line2}</div>}
      {d && !d.done && <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'duty', id: d.id })}><Users /> Change crew</button>}
    </div>
  );
}

/** v0.9 §R.8: this month's days off against the legal minimum, standby, flying and leave (one line). */
function MonthLine({ g, c }: { g: GameState; c: CrewMember }) {
  const v = crewMonth(g, c.id, g.now);
  const i = v.line.indexOf(': ');
  return (
    <div className={`small muted sc-month-line ${v.off < v.offMin && monthKey(publishedTo(g)) > v.key ? 'low' : ''}`}>
      <b>{v.line.slice(0, i)}:</b> {v.line.slice(i + 2)}
    </div>
  );
}

/** 14 days of everything that blocks the person: duties by flight type, travel, rest, days off, sick / joining / training / leave. */
function Roster({ g, c }: { g: GameState; c: CrewMember }) {
  const from = dayStart(g.now);
  const to = from + 14 * DAY;
  const rev = flightsRev(g);
  const crev = crewRev(g);
  const hour = Math.floor(g.now / HOUR);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const blocks = useMemo(() => crewCalendar(g, c.id, from, to), [g, c.id, from, rev, crev, hour]);
  const lane = useRef<HTMLDivElement>(null);
  const [laneW, setLaneW] = useState(0);
  useLayoutEffect(() => {
    const el = lane.current;
    if (!el) return;
    setLaneW(el.clientWidth);
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [selId, setSel] = useState<string | null>(null);
  const sel = (selId ? blocks.find((b) => calId(b) === selId) : null) ?? calAt(blocks, g.now);
  const span = to - from;
  const ppm = laneW > 0 ? laneW / span : 0;
  const pct = (t: number) => ((Math.min(to, Math.max(from, t)) - from) / span) * 100;
  const tap = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width) return;
    const b = pickCal(blocks, from + ((e.clientX - r.left) / r.width) * span, r.width / span);
    if (b) setSel(calId(b));
  };
  const items = blocks.filter((b) => calLayer(b) > 0 && b.end > g.now);
  const legend = calLegend(blocks);
  const layered = [...blocks].sort((a, b) => calLayer(a) - calLayer(b));
  return (
    <div className="sc-roster">
      <div className="sc-roster-days tiny dim">
        {Array.from({ length: 14 }, (_, i) => <span key={i}>{toDate(from + i * DAY).getUTCDate()}</span>)}
      </div>
      <div className="sc-roster-lane sc-cal-lane" ref={lane} onClick={tap} role="group" aria-label="Next 14 days: tap a block for details">
        {layered.map((b, i) => {
          const key = calKey(b);
          const l = pct(b.start);
          const w = pct(b.end) - l;
          if (w <= 0) return null;
          const px = (w / 100) * laneW;
          const label = b.kind === 'rest' ? '' : b.kind === 'duty' ? (key === 'ferry' ? 'FERRY' : '') : stripText(b);
          const id = calId(b);
          return (
            <span key={`${id}-${i}`} className={`sc-cal k-${key} l${calLayer(b)} ${b.legality && b.legality !== 'legal' ? b.legality : ''} ${sel && calId(sel) === id ? 'on' : ''}`} style={{ left: `${l.toFixed(3)}%`, width: `${w.toFixed(3)}%` }}>
              {label && ppm > 0 && px >= 8 * label.length + 10 ? <span className="sc-cal-t">{label}</span> : null}
            </span>
          );
        })}
        <span className="sc-roster-now" style={{ left: `${pct(g.now).toFixed(3)}%` }} />
      </div>
      <MonthLine g={g} c={c} />
      {legend.length > 0 && (
        <div className="sc-cal-legend tiny muted">
          {legend.map((k) => <span key={k} className="row gap-4"><span className={`sc-cal-sw k-${k}`} aria-hidden />{CAL_KEY_LABEL[k]}</span>)}
        </div>
      )}
      {sel ? <CalDetail g={g} c={c} b={sel} /> : <div className="small dim">Tap the strip for details.</div>}
      <div className="sc-duty-list">
        {items.slice(0, 8).map((b, i) => {
          const key = calKey(b);
          const d = b.dutyId ? g.duties[b.dutyId] : undefined;
          // v0.9 a standby row reads like the roster: 'SBY E · 05:00–17:00 · LIS · 12 h'.
          const sby = b.kind === 'standby';
          const route = d ? dutyRoute(g, d.id) : sby ? `${fmtTime(b.start)}–${fmtTime(b.end)} · ${b.sby === 'hotel' ? 'hotel' : b.at ?? c.base}` : b.flights?.length ? [b.flights[0].from, ...b.flights.map((f) => f.to)].join('–') : b.detail.split('\n')[0];
          const open = () => (d && !d.done ? store.openModal({ kind: 'duty', id: d.id }) : setSel(calId(b)));
          return (
            <button key={`${calId(b)}-${i}`} className={`sc-duty-row small ${sel && calId(sel) === calId(b) ? 'on' : ''}`} onClick={open}>
              <span className={`sc-cal-sw k-${key}`} aria-hidden />
              <span className="dim nowrap">{sby ? fmtDay(b.start) : rowTime(b)}</span>
              <span className="nowrap">{sby ? stripText(b) : calLabel(b)}</span>
              <span className={`${b.flights?.length ? 'mono' : ''} ellipsis grow dim`}>{route}</span>
              {d && locked(g, d.pairingId, c.id) && <Lock className="sc-ico-s accent" aria-label="set by you" />}
              {b.legality && b.legality !== 'legal' && <Dot tone={b.legality === 'tight' ? 'warn' : 'bad'} />}
              {!isStatus(b) && <span className="num dim nowrap">{Math.round(h(b.end - b.start) * 10) / 10} h</span>}
            </button>
          );
        })}
        {items.length > 8 && <div className="small dim">… {items.length - 8} more</div>}
        {!items.length && <div className="small muted">Nothing rostered in the next 14 days.</div>}
      </div>
    </div>
  );
}

const trendIcon = (v: number) => (v >= 2 ? <ArrowUpRight className="sc-ico-s good" /> : v <= -2 ? <ArrowDownRight className="sc-ico-s bad" /> : <ArrowRight className="sc-ico-s dim" />);
const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

/** v0.6: morale bar with the 14-day trend arrow. */
function MoraleBar({ g, c }: { g: GameState; c: CrewMember }) {
  const m = moraleOf(g, c.id);
  return (
    <div className="sc-limit">
      <div className="row between small">
        <span className="muted">Morale</span>
        <span className="num row gap-4">{m.value}<span className="dim"> / 100</span>{trendIcon(m.trend14d)}</span>
      </div>
      <div className={`bar thin ${moraleTone(m.value)}`}><span style={{ width: `${Math.min(100, m.value)}%` }} /></div>
    </div>
  );
}

/** v0.6: the top 3 morale drivers and the risks they bring. */
function MoraleWhy({ g, c }: { g: GameState; c: CrewMember }) {
  const m = moraleOf(g, c.id);
  const why = m.drivers.filter((d) => Math.round(d.value) !== 0);
  const resign = Math.round(m.resignPerMonth * 1000) / 10;
  return (
    <div className="col gap-4 sc-morale-why">
      <div className="small muted">{why.length ? <>Why: {why.map((d) => `${d.label} ${signed(d.value)}`).join(' · ')}</> : `Steady near the company target of ${m.target}.`}</div>
      <div className="row gap-8 wrap">
        {m.sickMult > 1.05 && <span className={`chip sc-chip ${m.sickMult >= 1.3 ? 'bad' : 'warn'}`}>Sick risk ×{m.sickMult.toFixed(1)}</span>}
        {!c.notice && resign > 0 && <span className={`chip sc-chip ${resign >= 1.6 ? 'bad' : resign > 0.8 ? 'warn' : ''}`} data-tip="Chance a month that they hand in their notice">Resign risk {resign}%/mo</span>}
        {c.bondUntil !== undefined && c.bondUntil > g.now && <span className="chip sc-chip" data-tip="Company-paid type rating: resignation is much less likely until then">Bonded to {fmtDate(c.bondUntil)}</span>}
      </div>
    </div>
  );
}

/** v0.6 header chip: company morale and trend; tap for pilots / cabin, low and leaving counts, the top drivers. */
function MoraleChip({ g }: { g: GameState }) {
  const [open, setOpen] = useState(false);
  const nav = store.nav;
  useEffect(() => setOpen(false), [nav]);
  const day = Math.floor(g.now / DAY);
  const n = Object.keys(g.crew).length;
  const s = useMemo(() => moraleSummary(g), [g, day, n, crewRev(g)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!n) return null;
  return (
    <span className="sc-pop-wrap">
      <button className={`btn sc-morale-chip ${moraleTone(s.avg)}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className={`rb-morale ${moraleTone(s.avg)}`} aria-hidden />Morale <b className="num">{s.avg}</b>
        {Math.abs(s.trend) >= 1 && <span className={`num small ${s.trend > 0 ? 'good' : 'bad'}`}>{s.trend > 0 ? '▲' : '▼'}{Math.abs(s.trend)}</span>}
      </button>
      {open && (
        <>
          <button className="sc-pop-shade" aria-label="Close" onClick={() => setOpen(false)} />
          <div className="sc-pop card">
            <div className="row between"><b>Crew morale {s.avg}</b><span className="small muted">target {s.target}</span></div>
            <KV rows={[
              ['Pilots', String(s.pilots)],
              ['Cabin crew', String(s.cabin)],
              ['14-day trend', signed(s.trend) || '0'],
              ['Below 40', String(s.low)],
              ['On notice', String(s.leaving)],
            ]} />
            {s.drivers.length > 0 && <div className="small muted">Main drivers: {s.drivers.map((d) => `${d.label} ${signed(d.value)}`).join(' · ')}</div>}
            <div className="tiny dim">Low morale brings sick calls, weaker service and resignations. Per diem, hotels and tour length are in Company → Policies.</div>
            <button className="btn btn-sm" onClick={() => { setOpen(false); store.navigate('company'); }}>Company policies</button>
          </div>
        </>
      )}
    </span>
  );
}

function Detail({ g, c }: { g: GameState; c: CrewMember }) {
  const w = crewWindows(g, c, g.now);
  // v0.5.2: header status with the right date ('Joins 26 May 2027', 'Sick · back ~12 Mar'), no fake rest.
  const sv = crewStatusView(g, c.id);
  // v0.9: this month's days off live in the month line under the 14-day strip (crewMonth), said once.
  // Not joined yet: no rest, no days off, limits count from the start date.
  const joining = sv.startLabel === 'Joins';
  // v0.7.1 §7: the limits as fuel gauges (next duty's day length, rest, 7-day duty, 28-day and year flying).
  const gauges = joining ? [] : crewGauges(g, c.id).map((s) => restNow(s, g.now));
  const bar = (label: string, v: number, lim: number) => <LimitBar label={label} value={h(v)} limit={h(lim)} tone={limitTone(v / lim)} />;
  return (
    <div className="card sc-crew-detail">
      <div className="card-body col gap-12">
        <div className="row gap-12">
          <span className="sc-flag" aria-hidden>{flag(c.nationality)}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="ellipsis">{crewName(c)}</h3>
            <div className="small muted">{ROLE_LABEL[c.role]} · {c.ratings.map(familyLabel).join(', ') || 'no rating'} · base {c.base}</div>
          </div>
          <span className={`badge ${sv.tone === 'bad' ? 'bad' : sv.tone === 'warn' ? 'warn' : sv.tone === 'good' ? 'good' : ''}`}>{sv.label}</span>
        </div>
        {c.notice && (
          <div className="sc-notice">
            <span className="grow small"><b>Resigned</b> · last day {fmtDate(c.notice.leaves - 1)}</span>
            <button className="btn btn-sm" onClick={() => store.openModal({ kind: 'hire', role: c.role, family: c.ratings[0], base: c.base })}><UserPlus /> Hire replacement</button>
          </div>
        )}
        {sv.text && <div className={`small sc-crew-status ${sv.tone === 'info' ? 'accent' : sv.tone}`}>{sv.text}</div>}
        <KV rows={[
          ['Now at', sv.nowAt || c.loc],
          ...(joining ? [] : [['Rest until', sv.restUntil ? `${fmtDay(sv.restUntil)} ${fmtTime(sv.restUntil)} UTC` : '—'] as [string, string]]),
          ['Languages', c.languages.join(', ') || '—'],
          [sv.startLabel, fmtDate(sv.startDate)],
          ['Total hours', Math.round(c.totalHours).toLocaleString('en-US')],
          ['Salary', `${money(c.salary)}/month`],
        ]} />
        <div className="grid-2 sc-moods">
          <MoraleBar g={g} c={c} />
          <LimitBar label="Fatigue" value={c.fatigue} limit={100} unit="" tone={limitTone(c.fatigue / 100)} />
        </div>
        <MoraleWhy g={g} c={c} />
        <div className="upper dim">Flight time limits{joining ? ` · from ${fmtDate(sv.startDate)}` : ''}</div>
        <div className="grid-2 sc-limits">
          {gauges.length ? gauges.map((s) => <Gauge key={s.id} spec={s} />) : (
            <>
              {bar('Duty 7 days', w.duty7d, LIMITS.duty7d)}
              {bar('Duty 28 days', w.duty28d, LIMITS.duty28d)}
              {bar('Block 28 days', w.block28d, LIMITS.block28d)}
              {bar('Block this year', w.blockYear, LIMITS.blockYear)}
            </>
          )}
          {gauges.length > 0 && bar('Duty 28 days', w.duty28d, LIMITS.duty28d)}
        </div>
        <div className="row between"><span className="upper dim">Next 14 days</span><span className="small dim">tap for details · a duty to change its crew</span></div>
        <Roster key={c.id} g={g} c={c} />
        <div className="row gap-8">
          <button className="btn grow" onClick={() => store.openModal({ kind: 'train', crewId: c.id })}><GraduationCap /> Train</button>
          <button className="btn grow" onClick={() => store.openModal({ kind: 'hire', role: c.role, family: c.ratings[0], base: c.base })}><UserPlus /> Hire similar</button>
        </div>
      </div>
    </div>
  );
}

const VIEW_KEY = 'bh.crewView';
type CrewView = 'people' | 'board' | 'plan';
function storedView(): CrewView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'board' || v === 'plan' ? v : 'people';
  } catch {
    return 'people';
  }
}

/** v0.6: bottom bar of Select mode ('12 selected · Convert… · Clear'). */
function SelectBar({ g, ids, onClear, onDone }: { g: GameState; ids: string[]; onClear: () => void; onDone: () => void }) {
  const pilots = ids.filter((id) => isPilotRole(g.crew[id].role)).length;
  return (
    <div className="sc-selbar card">
      <b className="nowrap">{ids.length} selected</b>
      <span className="small muted ellipsis">{ids.length ? `${pilots} pilot${pilots === 1 ? '' : 's'} · ${ids.length - pilots} cabin crew` : 'Tap people or a group to select them'}</span>
      <span className="grow" />
      <button className="btn" onClick={onClear} disabled={!ids.length}>Clear</button>
      <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'convert', crewIds: ids, onBooked: onDone })} disabled={!ids.length}><GraduationCap /> Convert…</button>
      <button className="btn btn-ghost btn-icon" onClick={onDone} aria-label="Done selecting"><X /></button>
    </div>
  );
}

export function CrewScreen() {
  useRenderCount('crew');
  const g = useGame();
  const [f, setF] = useState<CrewFilter>(NO_FILTER);
  const [more, setMore] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const rev = flightsRev(g);
  const hour = Math.floor(g.now / HOUR);
  const all = Object.values(g.crew);
  const view: CrewView = store.nav.view === 'board' || store.nav.view === 'people' || store.nav.view === 'plan' ? store.nav.view : storedView();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => filterCrew(all, f), [g, f, hour, all.length]);
  const shown = more ? list : list.slice(0, PAGE);
  // v0.7 C2: the people list's FTL windows only while it is shown (the board view skips them each game hour).
  const board = view === 'board';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wins = useMemo(() => (board ? new Map<string, ReturnType<typeof crewWindows>>() : new Map(shown.map((c) => [c.id, crewWindows(g, c, g.now)]))), [g, shown, rev, hour, board]);
  // Resigned crew leave the save on their last day: a stale selection falls back to the first in the list.
  const selId = store.nav.sel?.kind === 'crew' && g.crew[store.nav.sel.id] ? store.nav.sel.id : list[0]?.id;
  const sel = selId ? g.crew[selId] : undefined;
  const families = [...new Set(all.flatMap((c) => c.ratings))];
  const classes = conversionClasses(g);
  const running = classes.filter((k) => k.status === 'running').length;
  const selected = [...picked].filter((id) => g.crew[id]);
  const set = (p: Partial<CrewFilter>) => {
    setF({ ...f, ...p });
    setMore(false);
  };
  const setView = (v: CrewView) => {
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // storage unavailable
    }
    store.navigate('crew', { view: v, sel: store.nav.sel });
  };
  const onSelect = (ids: string[], on: boolean) => {
    const next = new Set(picked);
    for (const id of ids) {
      if (on) next.add(id);
      else next.delete(id);
    }
    setPicked(next);
  };
  const tap = (id: string) => (selecting ? onSelect([id], !picked.has(id)) : store.select({ kind: 'crew', id }));
  const allShown = list.length > 0 && list.every((c) => picked.has(c.id));

  return (
    <div className={`screen sc-crew ${view === 'board' ? 'sc-crew-board' : ''}`}>
      <ScreenHead title="Crew" sub={`${all.length} people · ${all.filter((c) => c.status === 'onDuty').length} on duty now`}>
        <Seg<CrewView> value={view} onChange={setView} options={[{ value: 'people', label: <><List className="sc-ico-s" /> People</> }, { value: 'board', label: <><LayoutGrid className="sc-ico-s" /> Roster board</> }, { value: 'plan', label: <><Layers className="sc-ico-s" /> Planning</> }]} />
        <MoraleChip g={g} />
        {classes.length > 0 && (
          <button className="btn" onClick={() => store.openModal({ kind: 'classes' })}>
            <GraduationCap /> {running ? `${running} class${running === 1 ? '' : 'es'} running` : `${classes.length} class${classes.length === 1 ? '' : 'es'} booked`}
          </button>
        )}
        {all.length > 0 && (
          <button className={`btn ${selecting ? 'btn-on' : ''}`} onClick={() => setSelecting(!selecting)} aria-pressed={selecting}><CheckSquare /> Select</button>
        )}
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'hire' })}><UserPlus /> Hire</button>
      </ScreenHead>
      <ScreenHint id={view === 'board' ? 'crewBoard' : view === 'plan' ? 'crewPlan' : 'crewPeople'} />
      {/* v0.7.4 one calm line per type family (sets complete of needed); the detail lives in Planning. */}
      {view === 'people' && <PlanStrip g={g} onOpen={() => setView('plan')} />}
      {view === 'plan' ? (
        <CrewPlanView g={g} />
      ) : !all.length ? (
        <Empty icon={<Users />} title="No crew yet">Hire pilots and cabin crew to fly your aircraft.</Empty>
      ) : view === 'board' ? (
        <RosterBoard g={g} selecting={selecting} selected={picked} onSelect={onSelect} />
      ) : (
        <div className="sc-crew-cols">
          <div className="col gap-8" style={{ minWidth: 0 }}>
            <div className="sc-filters">
              <Seg<CrewFilter['group']> value={f.group} onChange={(v) => set({ group: v, role: 'all' })} options={[{ value: 'all', label: 'All' }, { value: 'pilots', label: 'Pilots' }, { value: 'cabin', label: 'Cabin' }]} />
              <select className="select" value={f.status} onChange={(e) => set({ status: e.target.value as CrewFilter['status'] })} aria-label="Status">
                <option value="all">Any status</option>
                <option value="away">Away from base</option>
                {(Object.keys(CREW_STATUS_LABEL) as CrewStatus[]).map((s) => <option key={s} value={s}>{CREW_STATUS_LABEL[s]}</option>)}
              </select>
              {families.length > 1 && (
                <select className="select" value={f.rating} onChange={(e) => set({ rating: e.target.value as CrewFilter['rating'] })} aria-label="Rating">
                  <option value="all">Any type</option>
                  {families.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <label className="sc-search">
                <Search />
                <input className="input" value={f.q} placeholder="Name, place" onChange={(e) => set({ q: e.target.value })} />
              </label>
              {selecting && list.length > 0 && (
                <button className="btn" onClick={() => onSelect(list.map((c) => c.id), !allShown)}>{allShown ? 'Clear these' : `Select these ${list.length}`}</button>
              )}
            </div>
            <div className="card sc-crew-list">
              {shown.map((c) => <CrewRow key={c.id} g={g} c={c} w={wins.get(c.id) ?? crewWindows(g, c, g.now)} on={!selecting && c.id === selId} t={crewTravelNow(g, c)} selecting={selecting} checked={picked.has(c.id)} onTap={() => tap(c.id)} />)}
              {!list.length && <div className="muted small sc-pad">Nobody matches these filters.</div>}
              {list.length > shown.length && <button className="btn btn-ghost sc-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
            </div>
          </div>
          {sel ? <Detail g={g} c={sel} /> : <div />}
        </div>
      )}
      {selecting && <SelectBar g={g} ids={selected} onClear={() => setPicked(new Set())} onDone={() => { setSelecting(false); setPicked(new Set()); }} />}
    </div>
  );
}
