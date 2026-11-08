// Crew (B5): staffing strip and a filterable list with 28-day duty / block bars. v0.18: a tap on a person opens their
// own sheet (modals/PersonSheet.tsx: monthly roster, totals, limits, morale; Train / Hire similar). DESIGN.md §6.3.

import { RankMark } from '../components/RankMark';
import { Check, CheckSquare, Gauge, GraduationCap, Layers, LayoutGrid, List, Lock, Palmtree, Search, UserPlus, Users, X } from 'lucide-react';
import { CrewPlanView, DeploymentStrip, PeakHeadsUp, PlanStrip } from './CrewPlan';
import { LeaveView } from './CrewLeave';
import { UtilisationView } from './CrewUtil';
import { useEffect, useMemo, useState } from 'react';
import { flightsRev } from '../../engine/core/entities';
import { DAY, HOUR, fmtDay } from '../../engine/core/time';
import type { CrewMember, CrewStatus, GameState } from '../../engine/core/types';
import {
  classOf, conversionClasses, crewRev, crewStatusView, crewTravelNow, type CrewTravelNow, crewWindows, familyLabel, leavePolicy, LIMITS, moraleSummary, type CrewWindows,
} from '../../engine/crew';
import { problemAt } from '../../engine/problems';
import { Why } from '../components/Why';
import { Empty, Seg } from '../components/ui';
import { RosterBoard } from './RosterBoard';
import { moraleTone } from './rosterBoardLogic';
import { store, useGame } from '../store';
import { Dot, KV, ScreenHead, useRenderCount } from './common';
import { baseDay, CREW_STATUS_LABEL, filterCrew, isPilotRole, limitTone, NO_FILTER, type CrewFilter } from './screenLogic';
import { ScreenHint } from '../components/ScreenHint';
import { hiresLeft, lockOf } from '../../engine/scenario';
import { LockNote, lockedProps } from '../components/Locked';

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
        <span className="row gap-8"><span className={`rb-morale ${moraleTone(c.morale)}`} aria-label={`Morale ${Math.round(c.morale)}`} title={`Morale ${Math.round(c.morale)}`} /><span className={`sc-role r-${c.role}`}>{c.role}</span><b className="ellipsis">{c.last}, {c.first}</b><RankMark role={c.role} /></span>
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

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v))}`;

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

const VIEW_KEY = 'bh.crewView';
type CrewView = 'people' | 'board' | 'plan' | 'leave' | 'use';
function storedView(): CrewView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'board' || v === 'plan' || v === 'leave' || v === 'use' ? v : 'people';
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
      <button className={`btn btn-primary ${lockOf(g, 'training') ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'convert', crewIds: ids, onBooked: onDone })} disabled={!ids.length || !!lockOf(g, 'training')} data-tip={lockOf(g, 'training') ?? undefined}><GraduationCap /> Convert…</button>
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
  const view: CrewView = store.nav.view === 'board' || store.nav.view === 'people' || store.nav.view === 'plan' || store.nav.view === 'leave' || store.nav.view === 'use' ? store.nav.view : storedView();
  const leaveWaiting = (g.leaveRequests ?? []).filter((q) => q.status === 'pending').length;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => filterCrew(all, f), [g, f, hour, all.length]);
  const shown = more ? list : list.slice(0, PAGE);
  // v0.7 C2: the people list's FTL windows only while it is shown (the board view skips them each game hour).
  const board = view === 'board';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const wins = useMemo(() => (board ? new Map<string, ReturnType<typeof crewWindows>>() : new Map(shown.map((c) => [c.id, crewWindows(g, c, g.now)]))), [g, shown, rev, hour, board]);
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
  // v0.18 a tap opens the person's own sheet (monthly roster first).
  const tap = (id: string) => (selecting ? onSelect([id], !picked.has(id)) : store.openPerson(id));
  const allShown = list.length > 0 && list.every((c) => picked.has(c.id));
  // v0.15 a scenario's hiring allowance (none, a few, or open).
  const hireLock = lockOf(g, 'hiring');

  return (
    <div className={`screen sc-crew ${view === 'board' ? 'sc-crew-board' : ''}`}>
      <ScreenHead hint={view === 'board' ? 'crewBoard' : view === 'plan' ? 'crewPlan' : 'crewPeople'} title="Crew" sub={`${all.length} people · ${all.filter((c) => c.status === 'onDuty').length} on duty now`}>
        <Seg<CrewView> value={view} onChange={setView} options={[{ value: 'people', label: <><List className="sc-ico-s" /> People</> }, { value: 'board', label: <><LayoutGrid className="sc-ico-s" /> Roster board</> }, { value: 'plan', label: <><Layers className="sc-ico-s" /> Planning</> }, { value: 'leave', label: <><Palmtree className="sc-ico-s" /> Leave{leaveWaiting > 0 && !leavePolicy(g).auto ? <span className="lv-count">{leaveWaiting}</span> : null}</> }, { value: 'use', label: <><Gauge className="sc-ico-s" /> Utilisation</> }]} />
        <MoraleChip g={g} />
        {classes.length > 0 && (
          <button className="btn" onClick={() => store.openModal({ kind: 'classes' })}>
            <GraduationCap /> {running ? `${running} class${running === 1 ? '' : 'es'} running` : `${classes.length} class${classes.length === 1 ? '' : 'es'} booked`}
          </button>
        )}
        {all.length > 0 && (
          <button className={`btn ${selecting ? 'btn-on' : ''}`} onClick={() => setSelecting(!selecting)} aria-pressed={selecting}><CheckSquare /> Select</button>
        )}
        <button className={`btn btn-primary ${hireLock ? 'locked' : ''}`} onClick={() => store.openModal({ kind: 'hire' })} {...lockedProps(hireLock)}>{hireLock ? <Lock className="lock-ico" /> : <UserPlus />} Hire{hiresLeft(g) ? ` (${hiresLeft(g)} left)` : ''}</button>
      </ScreenHead>
      {hireLock && view === 'people' && <LockNote why={hireLock} className="mb-8" />}
      {view !== 'leave' && view !== 'use' && <ScreenHint id={view === 'board' ? 'crewBoard' : view === 'plan' ? 'crewPlan' : 'crewPeople'} />}
      {/* v0.7.4 one calm line per type family (sets complete of needed); the detail lives in Planning. */}
      {view === 'people' && <PlanStrip g={g} onOpen={() => setView('plan')} />}
      {view === 'people' && <PeakHeadsUp g={g} />}
      {view === 'people' && <DeploymentStrip g={g} />}
      {view === 'plan' ? (
        <CrewPlanView g={g} />
      ) : view === 'leave' ? (
        <LeaveView g={g} />
      ) : view === 'use' ? (
        <UtilisationView g={g} />
      ) : !all.length ? (
        <Empty icon={<Users />} title="No crew yet">Hire pilots and cabin crew to fly your aircraft.</Empty>
      ) : view === 'board' ? (
        <RosterBoard g={g} selecting={selecting} selected={picked} onSelect={onSelect} />
      ) : (
        <div className="sc-crew-cols v18-people">
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
            <div className="card sc-crew-list v18-list">
              {shown.map((c) => <CrewRow key={c.id} g={g} c={c} w={wins.get(c.id) ?? crewWindows(g, c, g.now)} on={false} t={crewTravelNow(g, c)} selecting={selecting} checked={picked.has(c.id)} onTap={() => tap(c.id)} />)}
              {!list.length && <div className="muted small sc-pad">Nobody matches these filters.</div>}
              {list.length > shown.length && <button className="btn btn-ghost sc-more" onClick={() => setMore(true)}>Show all {list.length}</button>}
            </div>
          </div>
        </div>
      )}
      {selecting && <SelectBar g={g} ids={selected} onClear={() => setPicked(new Set())} onDone={() => { setSelecting(false); setPicked(new Set()); }} />}
    </div>
  );
}
