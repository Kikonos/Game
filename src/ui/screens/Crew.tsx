// Crew (B5): staffing strip, filterable list with 28-day duty / block bars, and a detail panel with every
// limit, morale and fatigue, days off and a 14-day roster; Train / Hire similar. DESIGN.md §6.3.

import { GraduationCap, Lock, Search, UserPlus, Users } from 'lucide-react';
import { FlightTypeChip } from '../components/FlightType';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flag } from '../../data/countries';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDate, fmtDay, fmtTime, monthKey, monthStart, nextMonthStart, toDate } from '../../engine/core/time';
import type { CrewMember, CrewStatus, GameState } from '../../engine/core/types';
import { type CalBlock, crewCalendar, crewName, crewRev, crewStatusView, crewWindows, daysOffInMonth, LIMITS, staffing, type CrewWindows } from '../../engine/crew';
import { Empty, Seg } from '../components/ui';
import { money } from '../format';
import { dutyRoute } from '../modals/DutyModal';
import { store, useGame } from '../store';
import { Dot, KV, LimitBar, ScreenHead, useRenderCount } from './common';
import { CAL_KEY_LABEL, calAt, calId, calKey, calLabel, calLayer, calLegend, pickCal } from './crewLogic';
import { CREW_STATUS_LABEL, filterCrew, limitTone, NO_FILTER, ROLE_LABEL, type CrewFilter } from './screenLogic';

const STATUS_TONE: Record<CrewStatus, 'good' | 'warn' | 'bad' | 'info' | 'off'> = {
  available: 'good', onDuty: 'info', resting: 'off', off: 'off', leave: 'off', sick: 'bad', training: 'warn', joining: 'warn',
};
const PAGE = 60;
const h = (min: number) => min / HOUR;

function Staffing({ g }: { g: GameState }) {
  const lines = staffing(g);
  if (!lines.length) return null;
  return (
    <div className="sc-staff">
      {lines.map((l) => {
        const short = l.have < l.need;
        return (
          <button key={`${l.family}-${l.role}`} className={`sc-staff-chip ${short ? 'short' : ''}`} onClick={() => store.openModal({ kind: 'hire', role: l.role, family: l.family })} data-tip={`${ROLE_LABEL[l.role]}: ${l.have} on the books, ${l.need} needed for the fleet`}>
            <span className="tiny dim">{l.family}</span>
            <b>{l.role}</b>
            <span className={`num ${short ? 'warn' : ''}`}>{l.have}/{l.need}</span>
          </button>
        );
      })}
    </div>
  );
}

function CrewRow({ c, w, on }: { c: CrewMember; w: CrewWindows; on: boolean }) {
  return (
    <button className={`sc-crew-row ${on ? 'on' : ''}`} onClick={() => store.select({ kind: 'crew', id: c.id })}>
      <span className="col sc-crew-name">
        <span className="row gap-8"><span className={`sc-role r-${c.role}`}>{c.role}</span><b className="ellipsis">{c.last}, {c.first}</b></span>
        <span className="tiny muted row gap-4 ellipsis"><Dot tone={STATUS_TONE[c.status]} />{CREW_STATUS_LABEL[c.status]} · {c.loc}{c.loc !== c.base ? ` (base ${c.base})` : ''}</span>
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
        {layered.map((b) => {
          const key = calKey(b);
          const l = pct(b.start);
          const w = pct(b.end) - l;
          if (w <= 0) return null;
          const px = (w / 100) * laneW;
          const label = b.kind === 'off' ? 'Off' : b.kind === 'rest' ? '' : b.kind === 'duty' ? (key === 'ferry' ? 'FERRY' : '') : b.label;
          const id = calId(b);
          return (
            <span key={id} className={`sc-cal k-${key} l${calLayer(b)} ${b.legality && b.legality !== 'legal' ? b.legality : ''} ${sel && calId(sel) === id ? 'on' : ''}`} style={{ left: `${l.toFixed(3)}%`, width: `${w.toFixed(3)}%` }}>
              {label && ppm > 0 && px >= 8 * label.length + 10 ? <span className="sc-cal-t">{label}</span> : null}
            </span>
          );
        })}
        <span className="sc-roster-now" style={{ left: `${pct(g.now).toFixed(3)}%` }} />
      </div>
      {legend.length > 0 && (
        <div className="sc-cal-legend tiny muted">
          {legend.map((k) => <span key={k} className="row gap-4"><span className={`sc-cal-sw k-${k}`} aria-hidden />{CAL_KEY_LABEL[k]}</span>)}
        </div>
      )}
      {sel ? <CalDetail g={g} c={c} b={sel} /> : <div className="small dim">Tap the strip for details.</div>}
      <div className="sc-duty-list">
        {items.slice(0, 8).map((b) => {
          const key = calKey(b);
          const d = b.dutyId ? g.duties[b.dutyId] : undefined;
          const route = d ? dutyRoute(g, d.id) : b.flights?.length ? [b.flights[0].from, ...b.flights.map((f) => f.to)].join('–') : b.detail.split('\n')[0];
          const open = () => (d && !d.done ? store.openModal({ kind: 'duty', id: d.id }) : setSel(calId(b)));
          return (
            <button key={calId(b)} className={`sc-duty-row small ${sel && calId(sel) === calId(b) ? 'on' : ''}`} onClick={open}>
              <span className={`sc-cal-sw k-${key}`} aria-hidden />
              <span className="dim nowrap">{rowTime(b)}</span>
              <span className="nowrap">{calLabel(b)}</span>
              <span className={`${b.flights?.length ? 'mono' : ''} ellipsis grow dim`}>{route}</span>
              {d && locked(g, d.pairingId, c.id) && <Lock className="sc-ico-s accent" aria-label="set by you" />}
              {b.legality && b.legality !== 'legal' && <Dot tone={b.legality === 'tight' ? 'warn' : 'bad'} />}
              {!isStatus(b) && <span className="num dim nowrap">{Math.round(h(b.end - b.start) * 10) / 10} h</span>}
            </button>
          );
        })}
        {items.length > 8 && <div className="small dim">… {items.length - 8} more</div>}
        {!items.length && <div className="small muted">Nothing rostered in the next 14 days: only rest and days off.</div>}
      </div>
    </div>
  );
}

function Detail({ g, c }: { g: GameState; c: CrewMember }) {
  const w = crewWindows(g, c, g.now);
  // v0.5.2: header status with the right date ('Joins 26 May 2027', 'Sick · back ~12 Mar'), no fake rest.
  const sv = crewStatusView(g, c.id);
  const k = monthKey(g.now);
  // So far (through today): later days have no roster yet and would all count as off.
  const off = daysOffInMonth(g, c, monthStart(k), Math.min(nextMonthStart(g.now), dayStart(g.now) + DAY));
  // Not joined yet: no rest, no days off, limits count from the start date.
  const joining = sv.startLabel === 'Joins';
  const bar = (label: string, v: number, lim: number) => <LimitBar label={label} value={h(v)} limit={h(lim)} tone={limitTone(v / lim)} />;
  return (
    <div className="card sc-crew-detail">
      <div className="card-body col gap-12">
        <div className="row gap-12">
          <span className="sc-flag" aria-hidden>{flag(c.nationality)}</span>
          <div className="grow" style={{ minWidth: 0 }}>
            <h3 className="ellipsis">{crewName(c)}</h3>
            <div className="small muted">{ROLE_LABEL[c.role]} · {c.ratings.join(', ') || 'no rating'} · base {c.base}</div>
          </div>
          <span className={`badge ${sv.tone === 'bad' ? 'bad' : sv.tone === 'warn' ? 'warn' : sv.tone === 'good' ? 'good' : ''}`}>{sv.label}</span>
        </div>
        {sv.text && <div className={`small sc-crew-status ${sv.tone === 'info' ? 'accent' : sv.tone}`}>{sv.text}</div>}
        <KV rows={[
          ['Now at', c.loc],
          ...(joining ? [] : [['Rest until', sv.restUntil ? `${fmtDay(sv.restUntil)} ${fmtTime(sv.restUntil)} UTC` : '—'] as [string, string]]),
          ['Languages', c.languages.join(', ') || '—'],
          [sv.startLabel, fmtDate(sv.startDate)],
          ['Total hours', Math.round(c.totalHours).toLocaleString('en-US')],
          ['Salary', `${money(c.salary)}/month`],
          ['Days off so far this month', joining ? '—' : String(off)],
        ]} />
        <div className="grid-2 sc-moods">
          <LimitBar label="Morale" value={c.morale} limit={100} unit="" tone={c.morale >= 60 ? 'good' : c.morale >= 40 ? 'warn' : 'bad'} />
          <LimitBar label="Fatigue" value={c.fatigue} limit={100} unit="" tone={limitTone(c.fatigue / 100)} />
        </div>
        <div className="upper dim">Flight time limits{joining ? ` · from ${fmtDate(sv.startDate)}` : ''}</div>
        <div className="grid-2 sc-limits">
          {bar('Duty 7 days', w.duty7d, LIMITS.duty7d)}
          {bar('Duty 14 days', w.duty14d, LIMITS.duty14d)}
          {bar('Duty 28 days', w.duty28d, LIMITS.duty28d)}
          {bar('Block 28 days', w.block28d, LIMITS.block28d)}
          {bar('Block this year', w.blockYear, LIMITS.blockYear)}
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

export function CrewScreen() {
  useRenderCount('crew');
  const g = useGame();
  const [f, setF] = useState<CrewFilter>(NO_FILTER);
  const [more, setMore] = useState(false);
  const rev = flightsRev(g);
  const hour = Math.floor(g.now / HOUR);
  const all = Object.values(g.crew);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => filterCrew(all, f), [g, f, hour, all.length]);
  const shown = more ? list : list.slice(0, PAGE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wins = useMemo(() => new Map(shown.map((c) => [c.id, crewWindows(g, c, g.now)])), [g, shown, rev, hour]);
  const selId = store.nav.sel?.kind === 'crew' ? store.nav.sel.id : list[0]?.id;
  const sel = selId ? g.crew[selId] : undefined;
  const families = [...new Set(all.flatMap((c) => c.ratings))];
  const set = (p: Partial<CrewFilter>) => {
    setF({ ...f, ...p });
    setMore(false);
  };

  return (
    <div className="screen sc-crew">
      <ScreenHead title="Crew" sub={`${all.length} people · ${all.filter((c) => c.status === 'onDuty').length} on duty now`}>
        <button className="btn btn-primary" onClick={() => store.openModal({ kind: 'hire' })}><UserPlus /> Hire</button>
      </ScreenHead>
      <Staffing g={g} />
      {!all.length ? (
        <Empty icon={<Users />} title="No crew yet">Hire pilots and cabin crew to fly your aircraft.</Empty>
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
            </div>
            <div className="card sc-crew-list">
              {shown.map((c) => <CrewRow key={c.id} c={c} w={wins.get(c.id) ?? crewWindows(g, c, g.now)} on={c.id === selId} />)}
              {!list.length && <div className="muted small sc-pad">Nobody matches these filters.</div>}
              {list.length > shown.length && <button className="btn btn-ghost sc-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
            </div>
          </div>
          {sel ? <Detail g={g} c={sel} /> : <div />}
        </div>
      )}
    </div>
  );
}
