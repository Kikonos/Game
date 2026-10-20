// Crew (B5): staffing strip, filterable list with 28-day duty / block bars, and a detail panel with every
// limit, morale and fatigue, days off and a 14-day roster; Train / Hire similar. DESIGN.md §6.3.

import { GraduationCap, Search, UserPlus, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { flag } from '../../data/countries';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, dayStart, fmtDate, fmtDay, monthKey, monthStart, nextMonthStart, toDate } from '../../engine/core/time';
import type { CrewMember, CrewStatus, GameState } from '../../engine/core/types';
import { crewName, crewWindows, daysOffInMonth, LIMITS, rosterOf, staffing, type CrewWindows } from '../../engine/crew';
import { Empty, Seg } from '../components/ui';
import { money } from '../format';
import { store, useGame } from '../store';
import { Dot, KV, LimitBar, ScreenHead, useRenderCount } from './common';
import { contractColor } from './palette';
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

/** 14 days of duties: one lane, a block per duty (report → release), coloured by contract. */
function Roster({ g, c }: { g: GameState; c: CrewMember }) {
  const from = dayStart(g.now);
  const to = from + 14 * DAY;
  const duties = rosterOf(g, c.id, from, to);
  const span = to - from;
  const pct = (t: number) => `${(((Math.min(to, Math.max(from, t)) - from) / span) * 100).toFixed(2)}%`;
  return (
    <div className="sc-roster">
      <div className="sc-roster-days tiny dim">
        {Array.from({ length: 14 }, (_, i) => <span key={i}>{toDate(from + i * DAY).getUTCDate()}</span>)}
      </div>
      <div className="sc-roster-lane">
        {duties.map((d) => {
          const f = g.flights[d.flightIds[0]];
          const k = f?.contractId ? g.contracts[f.contractId]?.color : undefined;
          return (
            <span key={d.id} className={`sc-duty ${d.legality}`} style={{ left: pct(d.report), width: `calc(${pct(d.release)} - ${pct(d.report)})`, ['--kc' as string]: k !== undefined ? contractColor(k) : undefined }} />
          );
        })}
        <span className="sc-roster-now" style={{ left: pct(g.now) }} />
      </div>
      <div className="sc-duty-list">
        {duties.slice(0, 6).map((d) => {
          const stops = d.flightIds.map((id) => g.flights[id]).filter(Boolean);
          const route = stops.length ? [stops[0].from, ...stops.map((f) => f.to)].join('-') : d.deadheadIds.length ? 'positioning' : 'standby';
          return (
            <div key={d.id} className="row gap-8 small">
              <Dot tone={d.legality === 'legal' ? 'good' : d.legality === 'tight' ? 'warn' : 'bad'} />
              <span className="dim nowrap">{fmtDay(d.report)}</span>
              <span className="mono ellipsis grow">{route}</span>
              <span className="num dim nowrap">{Math.round(h(d.release - d.report) * 10) / 10} h</span>
            </div>
          );
        })}
        {duties.length > 6 && <div className="tiny dim">… {duties.length - 6} more duties</div>}
        {!duties.length && <div className="small muted">No duties in the next 14 days.</div>}
      </div>
    </div>
  );
}

function Detail({ g, c }: { g: GameState; c: CrewMember }) {
  const w = crewWindows(g, c, g.now);
  const k = monthKey(g.now);
  const off = daysOffInMonth(g, c, monthStart(k), nextMonthStart(g.now));
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
          <span className={`badge ${STATUS_TONE[c.status] === 'bad' ? 'bad' : STATUS_TONE[c.status] === 'warn' ? 'warn' : ''}`}>{CREW_STATUS_LABEL[c.status]}</span>
        </div>
        <KV rows={[
          ['Now at', c.loc],
          ['Rest until', c.restUntil > g.now ? fmtDate(c.restUntil) : '—'],
          ['Languages', c.languages.join(', ') || '—'],
          ['Hired', fmtDate(c.hired)],
          ['Total hours', Math.round(c.totalHours).toLocaleString('en-US')],
          ['Salary', `${money(c.salary)}/month`],
          ['Days off this month', String(off)],
        ]} />
        <div className="grid-2 sc-moods">
          <LimitBar label="Morale" value={c.morale} limit={100} unit="" tone={c.morale >= 60 ? 'good' : c.morale >= 40 ? 'warn' : 'bad'} />
          <LimitBar label="Fatigue" value={c.fatigue} limit={100} unit="" tone={limitTone(c.fatigue / 100)} />
        </div>
        <div className="upper dim">Flight time limits</div>
        <div className="grid-2 sc-limits">
          {bar('Duty 7 days', w.duty7d, LIMITS.duty7d)}
          {bar('Duty 14 days', w.duty14d, LIMITS.duty14d)}
          {bar('Duty 28 days', w.duty28d, LIMITS.duty28d)}
          {bar('Block 28 days', w.block28d, LIMITS.block28d)}
          {bar('Block this year', w.blockYear, LIMITS.blockYear)}
        </div>
        <div className="upper dim">Next 14 days</div>
        <Roster g={g} c={c} />
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
