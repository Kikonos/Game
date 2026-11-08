// v0.18.1 Crew › Leave (player's report: "leave should come from a yearly allowance and be approved by operations"):
// the Company's leave policy, the requests waiting (approve or decline, with what the rules say), the ones decided
// lately, and each rank's allowance and the share away by month.

import { Check, Palmtree, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DAY, fmtDay, monthKey, monthStart, yearOf } from '../../engine/core/time';
import type { CrewMember, GameState, LeaveRequest, Role } from '../../engine/core/types';
import { answerLeave, crewName, crewRev, dayIndex, decideBy, leaveBalance, leaveDaysFor, leavePolicy, leaveVerdict, setLeavePolicy } from '../../engine/crew';
import { Seg, Stepper } from '../components/ui';
import { RankMark } from '../components/RankMark';
import { store } from '../store';

const MON = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
const ROLE_PLURAL: Record<Role, string> = { CPT: 'Captains', FO: 'First officers', CRP: 'Cruise relief', PUR: 'Pursers', CC: 'Cabin crew' };

const dayRange = (from: number, days: number) => `${fmtDay(from + 720)} – ${fmtDay(from + (days - 1) * DAY + 720)}`;

/** Per rank: people, the year's allowance, booked, asked, left, away today; and the busiest day of each of the next 6 months. */
export function leaveSummary(g: GameState) {
  const y = yearOf(g.now);
  const rows = ROLES.map((role) => ({ role, n: 0, ent: 0, booked: 0, pending: 0, left: 0, today: 0, months: [] as number[] }));
  const by = new Map(rows.map((r) => [r.role, r]));
  const m0 = monthKey(g.now);
  const crew = Object.values(g.crew).filter((c) => !c.notice && c.status !== 'joining');
  for (const c of crew) {
    const r = by.get(c.role)!;
    const b = leaveBalance(g, c, y);
    r.n++;
    r.ent += b.ent + b.carried;
    r.booked += b.booked;
    r.pending += b.pending;
    r.left += b.left;
    if (c.blocks?.some((x) => x.why === 'leave' && x.annual && x.from <= g.now && x.to > g.now)) r.today++;
  }
  for (const r of rows) {
    for (let i = 0; i < 6; i++) {
      const a = Math.floor(monthStart(m0 + i) / DAY);
      const z = Math.floor(monthStart(m0 + i + 1) / DAY);
      let most = 0;
      for (let k = a; k < z; k++) {
        const t = k * DAY + 720;
        let n = 0;
        for (const c of crew) if (c.role === r.role && c.blocks?.some((x) => x.why === 'leave' && x.annual && x.from <= t && x.to > t)) n++;
        most = Math.max(most, n);
      }
      r.months.push(r.n ? most / r.n : 0);
    }
  }
  return { year: y, rows: rows.filter((r) => r.n > 0), m0 };
}


function Policy({ g }: { g: GameState }) {
  const pol = leavePolicy(g);
  const set = (p: Parameters<typeof setLeavePolicy>[1]) => store.act((gg) => setLeavePolicy(gg, p), { toastOk: false });
  const days = leaveDaysFor(g.company.homeBase);
  return (
    <section className="card lv-policy">
      <div className="lv-head"><Palmtree className="sc-ico" aria-hidden /><h3>Leave policy</h3></div>
      <p className="small muted">Each crew member has {days} days a year at {g.company.homeBase} (pro rata in the year they join; up to 10 unused days carry over). They ask for it in blocks of up to two weeks, at least three weeks ahead, never in a month whose roster is out.</p>
      <div className="lv-rules">
        <div className="lv-rule">
          <span className="lv-k">Requests decided</span>
          <Seg<'auto' | 'me'> value={pol.auto ? 'auto' : 'me'} onChange={(v) => set({ auto: v === 'auto' })} options={[{ value: 'auto', label: 'By the rules' }, { value: 'me', label: 'By me' }]} />
        </div>
        <div className="lv-rule">
          <span className="lv-k">Most of a rank away</span>
          <Stepper value={Math.round(pol.maxShare * 100)} min={4} max={25} onChange={(v) => set({ maxShare: v / 100 })} format={(v) => `${v}%`} />
        </div>
        <div className="lv-rule lv-months">
          <span className="lv-k">No leave in</span>
          <div className="lv-mchips" role="group" aria-label="Months with no leave">
            {MON.map((m, i) => {
              const on = pol.blackout.includes(i);
              return <button key={i} className={`lv-mchip ${on ? 'on' : ''}`} aria-pressed={on} aria-label={MONTH[i]} onClick={() => set({ blackout: on ? pol.blackout.filter((x) => x !== i) : [...pol.blackout, i] })}>{m}</button>;
            })}
          </div>
        </div>
      </div>
      <p className="tiny dim">{pol.auto ? 'Crew planning approves or declines each request the day after it comes in.' : 'You decide. What you leave open is decided by the rules when its month is planned (the 12th of the month before).'} A refusal costs a little morale.</p>
    </section>
  );
}

function RequestRow({ g, q, c }: { g: GameState; q: LeaveRequest; c: CrewMember }) {
  const v = leaveVerdict(g, c, q.from, q.days, q);
  const b = leaveBalance(g, c, yearOf(q.from + 720));
  const by = decideBy(g, q);
  return (
    <div className="lv-req">
      <button className="lv-who" onClick={() => store.openPerson(c.id)}>
        <span className="row gap-6"><b className="ellipsis">{crewName(c)}</b><RankMark role={c.role} /></span>
        <span className="tiny muted ellipsis">{c.ratings.join(' · ')} · {b.left} of {b.ent + b.carried} left after</span>
      </button>
      <div className="lv-when">
        <span className="row gap-6"><b className="num nowrap">{dayRange(q.from, q.days)}</b><span className="tiny muted nowrap">{q.days} days</span></span>
        <span className={`lv-verdict tiny ${v.ok ? 'good' : v.hard ? 'bad' : 'warn'}`}>{v.ok ? 'Within the rules' : v.why}{!leavePolicy(g).auto && by > g.now ? <span className="muted"> · answer by {fmtDay(by)}</span> : null}</span>
      </div>
      <div className="lv-act">
        <button className="btn btn-sm btn-ghost" onClick={() => store.act((gg) => answerLeave(gg, q.id, false))} aria-label="Decline"><X /> Decline</button>
        <button className="btn btn-sm btn-primary" disabled={v.hard} onClick={() => store.act((gg) => answerLeave(gg, q.id, true))} aria-label="Approve"><Check /> Approve</button>
      </div>
    </div>
  );
}

const STATUS_WORD: Record<LeaveRequest['status'], string> = { pending: 'Waiting', approved: 'Approved', declined: 'Declined', withdrawn: 'Withdrawn' };

function DecidedRow({ g, q }: { g: GameState; q: LeaveRequest }) {
  const c = g.crew[q.crewId];
  return (
    <div className="lv-done small">
      <span className={`badge ${q.status === 'approved' ? 'good' : q.status === 'declined' ? 'warn' : ''}`}>{STATUS_WORD[q.status]}</span>
      <span className="ellipsis">{c ? crewName(c) : 'Left the company'}</span>
      <span className="num muted nowrap">{dayRange(q.from, q.days)}</span>
      <span className="tiny dim ellipsis">{q.by === 'you' ? 'by you' : 'by the rules'}{q.why && q.status !== 'approved' ? ` · ${q.why}` : ''}</span>
    </div>
  );
}

export function LeaveView({ g }: { g: GameState }) {
  const rev = crewRev(g);
  const day = dayIndex(g.company.homeBase, g.now);
  const [showAll, setShowAll] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sum = useMemo(() => leaveSummary(g), [g, rev, day]);
  const reqs = g.leaveRequests ?? [];
  const open = reqs.filter((q) => q.status === 'pending' && g.crew[q.crewId]).sort((a, b) => a.from - b.from || (a.id < b.id ? -1 : 1));
  const done = reqs.filter((q) => q.status !== 'pending').sort((a, b) => (b.decided ?? 0) - (a.decided ?? 0));
  const shown = showAll ? open : open.slice(0, 12);
  return (
    <div className="lv">
      <div className="lv-main">
        <section className="card lv-list">
          <div className="lv-head"><h3>Requests</h3><span className="sub small muted">{open.length ? `${open.length} waiting` : 'none waiting'}</span></div>
          {shown.map((q) => <RequestRow key={q.id} g={g} q={q} c={g.crew[q.crewId]} />)}
          {!open.length && <p className="small muted lv-empty">No requests waiting. Crew ask for leave through the year, a few months ahead.</p>}
          {open.length > shown.length && <button className="btn btn-ghost" onClick={() => setShowAll(true)}>Show all {open.length}</button>}
          {done.length > 0 && (
            <details className="lv-decided">
              <summary className="small">Decided in the last 60 days <span className="muted">({done.filter((q) => q.status === 'approved').length} approved · {done.filter((q) => q.status === 'declined').length} declined)</span></summary>
              <div className="lv-done-list">{done.slice(0, 40).map((q) => <DecidedRow key={q.id} g={g} q={q} />)}</div>
            </details>
          )}
        </section>
        <section className="card lv-allow">
          <div className="lv-head"><h3>Allowance {sum.year}</h3></div>
          <div className="lv-table" role="table">
            <div className="lv-tr lv-th tiny upper dim" role="row"><span>Rank</span><span>Taken or booked</span><span className="num">Left</span><span className="num">Away</span></div>
            {sum.rows.map((r) => (
              <div key={r.role} className="lv-tr small" role="row">
                <span>{ROLE_PLURAL[r.role]} <span className="dim">{r.n}</span></span>
                <span className="lv-use"><span className="bar thin"><span style={{ width: `${r.ent ? Math.min(100, (100 * r.booked) / r.ent) : 0}%` }} /></span><span className="tiny dim num">{r.ent ? Math.round((100 * r.booked) / r.ent) : 0}%</span></span>
                <span className="num">{r.n ? Math.round(r.left / r.n) : 0} <span className="tiny dim">avg</span></span>
                <span className="num">{r.today}</span>
              </div>
            ))}
          </div>
          <div className="upper tiny dim lv-sub">Busiest day away, next 6 months</div>
          <div className="lv-heat">
            <span />
            {Array.from({ length: 6 }, (_, i) => <span key={i} className="tiny dim lv-hm">{MON[(sum.m0 + i) % 12]}</span>)}
            {sum.rows.map((r) => [
              <span key={r.role} className="tiny muted ellipsis">{ROLE_PLURAL[r.role]}</span>,
              ...r.months.map((v, i) => <span key={`${r.role}${i}`} className={`lv-cell ${v > leavePolicy(g).maxShare + 1e-9 ? 'over' : ''}`} style={{ ['--v' as string]: Math.min(1, v / 0.2) }} title={`${Math.round(v * 100)}%`}><span className="num">{Math.round(v * 100)}</span></span>),
            ])}
          </div>
        </section>
      </div>
      <div className="lv-side">
        <Policy g={g} />
      </div>
    </div>
  );
}
