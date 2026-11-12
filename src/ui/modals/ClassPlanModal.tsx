// v0.23 the class planner (Crew › Planning › Plan classes; engine: crew/classPlan.ts): a target type, cabin crew or
// pilots, who and by when; the proposal as blocks on a month strip, one slider between "fewer, bigger classes" and
// "least roster disruption", the balance as numbers, and each class's people one tap away (move someone to another
// class or take them out). Booking is one tap. Explanations sit behind the '?'.
// Also here: Remove type rating for cabin crew (one person from Train, many from Select on the Crew screen).

import '../../styles/acmi/v023classes.css';
import { AlertTriangle, Check, ChevronDown, GraduationCap, UserMinus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../../engine/core/balance';
import { typeOf } from '../../engine/core/perf';
import { DAY } from '../../engine/core/time';
import type { GameState, Minute, Role } from '../../engine/core/types';
import {
  bookClassPlan, CLASS_PLAN, classCandidates, classPlanNeed, classProposals, conversionEarliest, courseOf, crewName, crewRev, familyLabel, removeRating, removeRatingPlan,
  type ClassProposal, type PlannedClass,
} from '../../engine/crew';
import { lockOf } from '../../engine/scenario';
import { Help } from '../components/Help';
import { LockNote } from '../components/Locked';
import { Modal, Seg } from '../components/ui';
import { money } from '../format';
import { baseDay, isPilotRole } from '../screens/screenLogic';
import { store, useGame, type ModalSpec } from '../store';
import { byChoices, samePlan, sizesText, stripView } from './classPlanLogic';

type Group = 'cabin' | 'pilot';
const RANKS: Record<Group, { role: Role; label: string }[]> = {
  cabin: [{ role: 'PUR', label: 'Pursers' }, { role: 'CC', label: 'Cabin crew' }],
  pilot: [{ role: 'CPT', label: 'Captains' }, { role: 'FO', label: 'First officers' }],
};

/** Families flown or on their way first, then the rest of the catalogue. */
function familyList(g: GameState): RatingFamily[] {
  const fleet = [...new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family))];
  const all = [...new Set(ACMI_TYPES_LIST.map((t) => t.family))];
  return [...fleet, ...all.filter((f) => !fleet.includes(f))];
}

/** The group the type is short of (cabin crew first), else cabin crew. */
function defaultGroup(g: GameState, family: RatingFamily): Group {
  const short = (gr: Group) => classPlanNeed(g, family, gr).roles.some((r) => r.short > 0);
  return short('cabin') || !short('pilot') ? 'cabin' : 'pilot';
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="kp-tile" role="listitem">
      <span className="kp-tile-l">{label}</span>
      <b className={`kp-tile-v num ${tone ?? ''}`}>{value}</b>
      {sub && <span className="kp-tile-s">{sub}</span>}
    </div>
  );
}

/** The proposal on a month strip: classes as blocks (their head count inside), today, the published roster's end, the date asked for. */
function Strip({ g, p, open, onOpen }: { g: GameState; p: ClassProposal; open: string | null; onOpen: (no: string) => void }) {
  const v = stripView(g.company.homeBase, g.now, p);
  const pc = (x: number) => `${x * 100}%`;
  return (
    <div className="kp-strip" role="group" aria-label="Classes on the calendar">
      <div className="kp-months" aria-hidden>
        {v.months.map((m) => <span key={m.key} className="kp-month" style={{ left: pc(m.left), width: pc(m.width) }}>{m.label}</span>)}
      </div>
      <div className="kp-lanes" style={{ height: v.lanes * 30 + 4 }}>
        {v.months.slice(1).map((m) => <i key={m.key} className="kp-grid" style={{ left: pc(m.left) }} />)}
        {v.roster !== null && <i className="kp-roster" style={{ width: pc(v.roster) }} />}
        <i className="kp-now" style={{ left: pc(v.today) }} />
        {v.by !== null && <i className="kp-by" style={{ left: pc(v.by) }} />}
        {v.blocks.map((b) => (
          <button key={b.no} className={`kp-block ${p.group} ${open === b.no ? 'on' : ''}`} style={{ left: pc(b.left), width: pc(b.width), top: b.lane * 30 + 2 }} onClick={() => onOpen(b.no)} aria-label={`${b.no}: ${b.n} people from ${baseDay(g, b.start)}`} aria-pressed={open === b.no}>
            <b>{b.n}</b>
          </button>
        ))}
      </div>
      <div className="kp-legend tiny dim">
        <span><i className="kp-key now" /> today</span>
        {v.roster !== null && <span><i className="kp-key roster" /> roster published to {baseDay(g, p.rosterEnd - 1)}</span>}
        {v.by !== null && p.by !== null && <span><i className="kp-key by" /> finish by {baseDay(g, p.by - 1)}</span>}
      </div>
    </div>
  );
}

export function ClassPlanModal({ family: fam0, group: group0 }: { family?: RatingFamily; group?: Group }) {
  const g = useGame();
  const fams = useMemo(() => familyList(g), [g]);
  const [family, setFamilyRaw] = useState<RatingFamily>(fam0 ?? fams[0] ?? 'A320');
  const [group, setGroupRaw] = useState<Group>(() => group0 ?? defaultGroup(g, fam0 ?? fams[0] ?? 'A320'));
  const need = useMemo(() => classPlanNeed(g, family, group), [g, family, group]);
  const everyone = useMemo(() => classCandidates(g, family, group), [g, family, group, crewRev(g)]); // eslint-disable-line react-hooks/exhaustive-deps
  const [rank, setRank] = useState<Role | 'all'>('all');
  const [by, setBy] = useState<Minute | null>(() => classPlanNeed(g, family, group).arrival?.at ?? null);
  const [balance, setBalance] = useState(2);
  const [pins, setPins] = useState<Record<string, Minute | 'out'>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [showOut, setShowOut] = useState(false);
  const [review, setReview] = useState(false);
  const reset = (f: RatingFamily, gr: Group) => {
    setRank('all');
    setPins({});
    setOpen(null);
    setReview(false);
    setBy(classPlanNeed(g, f, gr).arrival?.at ?? null);
  };
  const setFamily = (f: RatingFamily) => { setFamilyRaw(f); reset(f, group); };
  const setGroup = (gr: Group) => { setGroupRaw(gr); reset(family, gr); };
  const ids = useMemo(() => everyone.filter((id) => rank === 'all' || g.crew[id]?.role === rank), [everyone, rank, g]);
  // The proposals for all five stops: worked out once per request (a dry run each), after the dialog has painted.
  const key = `${family}|${group}|${by}|${ids.join()}|${JSON.stringify(pins)}|${Math.floor(g.now / DAY)}|${crewRev(g)}|${Object.keys(g.classes ?? {}).length}`;
  const [made, setMade] = useState<{ key: string; plans: ClassProposal[] } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setMade({ key, plans: classProposals(g, { family, group, crewIds: ids, by, pins }) }), 20);
    return () => clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const plans = made?.plans ?? null;
  const stale = !made || made.key !== key;
  const p = plans ? plans[balance] : null;
  const close = () => store.closeModal();
  const lock = lockOf(g, 'training');
  const label = familyLabel(family);
  const course = courseOf(group, 'full', family);
  const risky = !!p && p.short.length > 0;
  const book = () => {
    if (!p) return;
    const res = store.act((gg) => bookClassPlan(gg, p));
    if (res.ok) close();
  };
  const pin = (id: string, to: Minute | 'out' | null) => {
    const next = { ...pins };
    if (to === null) delete next[id];
    else next[id] = to;
    setPins(next);
    setReview(false);
  };
  const whoWord = group === 'cabin' ? 'cabin crew' : 'pilots';
  const byList = byChoices(g.company.homeBase, g.now, conversionEarliest(g), course.days);
  const byValue = by === null ? '' : String(by);
  const same = plans ? samePlan(plans) : false;

  const member = (k: PlannedClass, id: string) => {
    const c = g.crew[id];
    const x = p!.people[id];
    if (!c) return null;
    return (
      <div key={id} className="kp-person">
        <span className={`sc-role r-${c.role}`}>{c.role}</span>
        <button className="sc-seat-name ellipsis grow" onClick={() => store.openPerson(id)}>{c.last}, {c.first.charAt(0)}.</button>
        {x?.drop && <span className="tiny dim nowrap">drops {familyLabel(x.drop)}</span>}
        {x && x.duties > 0 && <span className="tiny warn nowrap">{x.duties} {x.duties === 1 ? 'duty' : 'duties'}</span>}
        <select className="select kp-move" value={x?.pinned ? String(k.start) : ''} onChange={(e) => pin(id, e.target.value === 'out' ? 'out' : e.target.value === '' ? null : Number(e.target.value))} aria-label={`Move ${crewName(c)}`}>
          <option value="">{x?.pinned ? 'Let the planner place' : 'In this class'}</option>
          {x?.pinned && <option value={k.start}>Placed here by you</option>}
          {p!.classes.filter((o) => o.start !== k.start).map((o) => <option key={o.no} value={o.start}>Move to {baseDay(g, o.start)}</option>)}
          <option value="out">Take out</option>
        </select>
      </div>
    );
  };

  return (
    <Modal size="wide" className="kp-modal" title={`Plan classes · ${label}`} icon={<GraduationCap className="accent" />} onClose={close} footer={
      review && risky ? <>
        <span className="grow small bad">{p!.short.length} flight{p!.short.length === 1 ? '' : 's'} would be left short.</span>
        <button className="btn btn-danger" onClick={book}>Book anyway</button>
        <button className="btn btn-primary" onClick={() => setReview(false)} autoFocus>Go back</button>
      </> : <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="grow small muted kp-foot">{p && p.classes.length ? `${p.trained} ${p.trained === 1 ? 'person' : 'people'} · ${p.classes.length} class${p.classes.length === 1 ? '' : 'es'} · ${baseDay(g, p.first!)} – ${baseDay(g, p.finish! - 1)}` : ''}</span>
        <button className="btn btn-primary" onClick={risky ? () => setReview(true) : book} disabled={!p || stale || !p.ok || !!lock}><GraduationCap /> {p && p.classes.length ? `Book ${p.classes.length} class${p.classes.length === 1 ? '' : 'es'} · ${money(p.fees)}` : 'Nothing to book'}</button>
      </>
    }>
      <div className="col gap-12">
        <LockNote why={lock} />
        <div className="kp-controls">
          <Seg<Group> value={group} onChange={setGroup} options={[{ value: 'cabin', label: 'Cabin crew' }, { value: 'pilot', label: 'Pilots' }]} />
          <select className="select" value={family} onChange={(e) => setFamily(e.target.value as RatingFamily)} aria-label="Type to train for">
            {fams.map((f) => <option key={f} value={f}>Onto the {familyLabel(f)}</option>)}
          </select>
          <select className="select" value={rank} onChange={(e) => { setRank(e.target.value as Role | 'all'); setPins({}); }} aria-label="Who">
            <option value="all">All {everyone.length} {whoWord}</option>
            {RANKS[group].map((r) => <option key={r.role} value={r.role}>{r.label} only ({everyone.filter((id) => g.crew[id]?.role === r.role).length})</option>)}
          </select>
          <select className="select" value={byValue} onChange={(e) => setBy(e.target.value === '' ? null : Number(e.target.value))} aria-label="Finish by">
            <option value="">No finish date</option>
            {need.arrival && <option value={need.arrival.at}>Before {need.arrival.reg} flies · {baseDay(g, need.arrival.at)}</option>}
            {byList.map((b) => <option key={b.at} value={b.at}>{b.label}</option>)}
          </select>
        </div>
        <div className={`small ${need.roles.some((r) => r.short > 0) ? 'warn' : 'muted'}`}>
          The {label}: {need.text.charAt(0).toLowerCase() + need.text.slice(1)}{need.arrival ? ` · ${need.arrival.reg} flies from ${baseDay(g, need.arrival.at)}` : ''}
        </div>

        <div className="kp-balance">
          <div className="row between small">
            <span className={balance <= 1 ? 'kp-end on' : 'kp-end'}>Fewer, bigger classes</span>
            <Help title="How the plan is made">
              <p>Left: as few classes as the room allows, as full as they can be, even if rostered duties must go to others. Right: nobody’s roster is touched, even if that takes smaller classes or leaves someone out.</p>
              <p>At every setting each flight stays crewed: the plan is first tried on a copy of the roster. Leave is never moved, and each type keeps the crew its sets need at work.</p>
              <p>{group === 'cabin'
                ? `Cabin crew: ${course.days} days (classroom, doors, slides, fire and first aid), up to ${CLASS_PLAN.max.cabin} in a class, ${BAL.conv.cabinParallel} classes at a time, ${money(course.cost)} each. They keep their types, up to 3.`
                : `Pilots: ${course.days} days (ground school, simulator, base and line training), up to ${CLASS_PLAN.max.pilot} in a class in simulator pairs, classes ${BAL.conv.pilotStaggerDays} days apart, ${money(course.cost)} each. A pilot leaves the old type when the course starts, so nobody goes before its aircraft can spare them.`}</p>
              <p>Paid at booking. Full refund up to {BAL.conv.refundFull} days before a class, half after.</p>
            </Help>
            <span className={balance >= 3 ? 'kp-end on' : 'kp-end'}>Least roster disruption</span>
          </div>
          <input type="range" min={0} max={CLASS_PLAN.stops - 1} step={1} value={balance} onChange={(e) => { setBalance(Number(e.target.value)); setReview(false); }} aria-label="Balance: fewer, bigger classes to least roster disruption" style={{ ['--fill' as string]: `${(balance / (CLASS_PLAN.stops - 1)) * 100}%` }} />
          {same && p && p.classes.length > 0 && <div className="tiny muted">One plan is best at every setting here{p.duties === 0 ? ': nothing on the roster is in the way' : ''}.</div>}
        </div>

        {!p ? (
          <div className="kp-wait small muted" role="status">Working out the classes…</div>
        ) : !p.classes.length ? (
          <div className="kp-wait small muted">No class fits{p.leftOut.length ? `: ${p.leftOut[0].why.charAt(0).toLowerCase() + p.leftOut[0].why.slice(1)}` : ` (nobody of this group left to train on the ${label})`}.</div>
        ) : (
          <div className={`col gap-12 ${stale ? 'kp-stale' : ''}`}>
            <Strip g={g} p={p} open={open} onOpen={(no) => setOpen(open === no ? null : no)} />
            <div className="kp-tiles" role="list" aria-label="The balance">
              <Tile label="Trained" value={`${p.trained} of ${p.asked}`} tone={p.trained < p.asked ? 'warn' : 'good'} />
              <Tile label="Classes" value={String(p.classes.length)} sub={sizesText(p)} />
              <Tile label="Duties to re-crew" value={String(p.duties)} sub={p.duties ? 'go to other crew' : 'roster untouched'} tone={p.duties ? 'warn' : 'good'} />
              <Tile label="Flights left short" value={String(p.short.length)} tone={p.short.length ? 'bad' : 'good'} />
              <Tile label="Finished" value={baseDay(g, p.finish! - 1)} sub={p.late ? 'after the date asked' : `first starts ${baseDay(g, p.first!)}`} tone={p.late ? 'warn' : undefined} />
              <Tile label="Course fees" value={money(p.fees)} sub={p.extra ? `+ ${money(p.extra)} tickets` : 'training'} />
            </div>
            {p.warnings.map((w, i) => <div key={i} className={`small row gap-8 cv-warn ${w.level === 'bad' ? 'bad' : 'warn'}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>)}
            {p.pace.length > 0 && <div className="small muted">{p.pace.join(' · ')}</div>}
            <div className="col gap-8">
              {p.classes.map((k) => {
                const on = open === k.no;
                return (
                  <div key={k.no} className={`kp-class ${on ? 'on' : ''}`}>
                    <button className="kp-class-head" onClick={() => setOpen(on ? null : k.no)} aria-expanded={on}>
                      <b>{k.no}</b>
                      <span className="small muted grow ellipsis">{baseDay(g, k.start)} – {baseDay(g, k.end - 1)} · {k.crewIds.length} {group === 'pilot' ? 'pilots' : 'people'}{k.course === 'ccq' ? ' · CCQ' : ''}{k.duties ? ` · ${k.duties} ${k.duties === 1 ? 'duty' : 'duties'} to re-crew` : ''}</span>
                      <span className="small num nowrap">{money(k.fees)}</span>
                      <ChevronDown className={`sc-ico-s kp-chev ${on ? 'up' : ''}`} />
                    </button>
                    {on && <div className="kp-people">{k.crewIds.map((id) => member(k, id))}</div>}
                    {on && k.phases.length > 1 && <div className="tiny dim kp-phases">{k.phases.map((ph) => `${ph.label} ${baseDay(g, ph.from)}`).join(' · ')}</div>}
                  </div>
                );
              })}
              {p.leftOut.length > 0 && (
                <div className={`kp-class out ${showOut ? 'on' : ''}`}>
                  <button className="kp-class-head" onClick={() => setShowOut(!showOut)} aria-expanded={showOut}>
                    <b>Not in a class</b>
                    <span className="small muted grow ellipsis">{p.leftOut.length} {p.leftOut.length === 1 ? 'person' : 'people'} · {p.leftOut[0].why}{p.leftOut.some((x) => x.why !== p.leftOut[0].why) ? ' …' : ''}</span>
                    <ChevronDown className={`sc-ico-s kp-chev ${showOut ? 'up' : ''}`} />
                  </button>
                  {showOut && (
                    <div className="kp-people">
                      {p.leftOut.map((x) => {
                        const c = g.crew[x.crewId];
                        if (!c) return null;
                        return (
                          <div key={x.crewId} className="kp-person">
                            <span className={`sc-role r-${c.role}`}>{c.role}</span>
                            <span className="col grow" style={{ minWidth: 0 }}>
                              <button className="sc-seat-name ellipsis" onClick={() => store.openPerson(x.crewId)}>{c.last}, {c.first.charAt(0)}.</button>
                              <span className="tiny muted ellipsis">{x.why}</span>
                            </span>
                            <select className="select kp-move" value={pins[x.crewId] === 'out' ? 'out' : ''} onChange={(e) => pin(x.crewId, e.target.value === '' ? null : e.target.value === 'out' ? 'out' : Number(e.target.value))} aria-label={`Place ${crewName(c)}`}>
                              <option value="">{pins[x.crewId] === 'out' ? 'Put back' : 'Left out'}</option>
                              {pins[x.crewId] === 'out' && <option value="out">Taken out</option>}
                              {p.classes.map((o) => <option key={o.no} value={o.start}>Add to {baseDay(g, o.start)}</option>)}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---------- Remove type rating (cabin crew) ----------

/** The type most of these people could give up: one with no aircraft in the fleet first, else the one most of them hold. */
function defaultRemove(g: GameState, ids: string[]): RatingFamily | null {
  const fleet = new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family));
  const count = new Map<RatingFamily, number>();
  for (const id of ids) {
    const c = g.crew[id];
    if (!c || isPilotRole(c.role) || c.ratings.length < 2) continue;
    for (const f of c.ratings) count.set(f, (count.get(f) ?? 0) + 1);
  }
  const fams = [...count.keys()];
  if (!fams.length) return null;
  return fams.sort((a, b) => Number(fleet.has(a)) - Number(fleet.has(b)) || count.get(b)! - count.get(a)!)[0];
}

export function RemoveRatingModal({ crewIds, family: fam0, back, onDone }: { crewIds: string[]; family?: RatingFamily; back?: ModalSpec; onDone?: () => void }) {
  const g = useGame();
  const ids = crewIds.filter((id) => g.crew[id]);
  const cabin = ids.filter((id) => !isPilotRole(g.crew[id].role));
  const held = [...new Set(cabin.flatMap((id) => g.crew[id].ratings))];
  const [family, setFamily] = useState<RatingFamily | null>(() => fam0 ?? defaultRemove(g, ids));
  const [review, setReview] = useState(false);
  const plan = useMemo(() => (family ? removeRatingPlan(g, ids, family) : null), [g, ids.join(), family, crewRev(g)]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => (back ? store.openModal(back) : store.closeModal());
  const risky = !!plan && plan.warnings.some((w) => w.level === 'bad');
  const n = plan?.people.length ?? 0;
  const label = family ? familyLabel(family) : '';
  const go = () => {
    if (!family) return;
    const res = store.act((gg) => removeRating(gg, ids, family));
    if (!res.ok) return;
    onDone?.();
    close();
  };
  const ROLE_WORD: Record<string, string> = { PUR: 'Pursers', CC: 'Cabin crew' };
  return (
    <Modal title={`Remove type rating · ${cabin.length} ${cabin.length === 1 ? 'person' : 'people'}`} icon={<UserMinus className="accent" />} onClose={close} footer={
      review && risky ? <>
        <span className="grow small muted">Red warnings above: check them first.</span>
        <button className="btn btn-danger" onClick={go}>Remove anyway</button>
        <button className="btn btn-primary" onClick={() => setReview(false)} autoFocus>Go back</button>
      </> : <>
        <button className="btn" onClick={close}>Cancel</button>
        <span className="grow" />
        <button className="btn btn-danger" onClick={risky ? () => setReview(true) : go} disabled={!plan || !plan.ok}><UserMinus /> {n ? `Remove the ${label} from ${n}` : 'Nobody to change'}</button>
      </>
    }>
      <div className="col gap-12">
        {!held.length ? (
          <div className="small muted">Only cabin crew can give up a type. Pilots change type by a conversion course.</div>
        ) : (
          <>
            <div className="row gap-8 wrap">
              <span className="upper dim">Type to remove</span>
              <Help title="Removing a type">
                <p>Cabin crew hold up to 3 types. Removing one frees a place for another.</p>
                <p>It costs nothing. To fly that type again they take its course again.</p>
                <p>Their trips on the type that have not started go back to the roster.</p>
              </Help>
            </div>
            <div className="cv-chips">
              {held.map((f) => <button key={f} className={`cv-chip ${f === family ? 'on' : ''}`} onClick={() => { setFamily(f); setReview(false); }} aria-pressed={f === family}><b>{familyLabel(f)}</b></button>)}
            </div>
          </>
        )}
        {plan && family && (
          <>
            {plan.coverage.length > 0 && (
              <div className="kp-cover">
                <div className="upper dim">{label} cabin crew after</div>
                {plan.coverage.map((x) => (
                  <div key={x.role} className="row between small">
                    <span>{ROLE_WORD[x.role] ?? x.role}</span>
                    <span className="num"><span className="muted">{x.have} → </span><b className={x.after < x.need && x.after < x.have ? 'bad' : ''}>{x.after}</b><span className="muted"> · {x.need} needed</span></span>
                  </div>
                ))}
              </div>
            )}
            {plan.warnings.map((w, i) => <div key={i} className={`small row gap-8 cv-warn ${w.level === 'bad' ? 'bad' : 'warn'}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>)}
            {!plan.warnings.length && n > 0 && <div className="small good row gap-8"><Check className="sc-ico-s" /><span>{plan.coverage.length ? `The ${label} stays covered.` : `No ${label} in the fleet.`}</span></div>}
            {n > 0 && (plan.trips > 0 || plan.pay !== 0) && (
              <div className="small muted">
                {plan.trips > 0 ? `${plan.trips} trip${plan.trips === 1 ? '' : 's'} on the ${label} go${plan.trips === 1 ? 'es' : ''} back to the roster.` : ''}{plan.trips > 0 && plan.pay !== 0 ? ' ' : ''}{plan.pay !== 0 ? `Payroll ${plan.pay < 0 ? '−' : '+'}${money(Math.abs(plan.pay))} a month.` : ''}
              </div>
            )}
            <div className="kp-people">
              {plan.people.map((x) => {
                const c = g.crew[x.crewId];
                return (
                  <div key={x.crewId} className="kp-person">
                    <span className={`sc-role r-${c.role}`}>{c.role}</span>
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{c.last}, {c.first.charAt(0)}.</b>
                      <span className="tiny muted ellipsis">loses the {label} · keeps {x.keeps.map(familyLabel).join(', ')}{x.trips ? ` · ${x.trips} trip${x.trips === 1 ? '' : 's'} to re-crew` : ''}</span>
                    </span>
                  </div>
                );
              })}
              {plan.skipped.map((x) => {
                const c = g.crew[x.crewId];
                if (!c) return null;
                return (
                  <div key={x.crewId} className="kp-person skipped">
                    <span className={`sc-role r-${c.role}`}>{c.role}</span>
                    <span className="col grow" style={{ minWidth: 0 }}>
                      <b className="ellipsis">{c.last}, {c.first.charAt(0)}.</b>
                      <span className="tiny muted ellipsis">Keeps it: {x.why.charAt(0).toLowerCase() + x.why.slice(1)}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
