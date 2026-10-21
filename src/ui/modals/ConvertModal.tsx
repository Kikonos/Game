// v0.6 bulk type-rating conversion (UPDATE-0.6.md §F2.3): target type, first start day, the people (removable;
// skipped with a reason; cabin crew at 3 types choose the rating they give up) on the left; the classes the
// engine forms (max 20, pilots and cabin apart, staggered), cost and fleet-short warnings on the right.

import { AlertTriangle, GraduationCap, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, toDate, toLocal } from '../../engine/core/time';
import type { GameState } from '../../engine/core/types';
import { ccqPartner, conversionEarliest, conversionPlan, courseOf, crewName, familyLabel, startConversion } from '../../engine/crew';
import { Modal } from '../components/ui';
import { money } from '../format';
import { baseDay, isPilotRole, needsConfirm } from '../screens/screenLogic';
import { store, useGame } from '../store';

const CHIP_DAYS = 56;

/** Families flown or on order first, then the rest of the catalogue. */
function familyList(g: GameState): { family: RatingFamily; inFleet: boolean }[] {
  const fleet = [...new Set(Object.values(g.fleet).map((a) => typeOf(a.typeId).family))];
  const all = [...new Set(ACMI_TYPES_LIST.map((t) => t.family))];
  return [...fleet.map((family) => ({ family, inFleet: true })), ...all.filter((f) => !fleet.includes(f)).map((family) => ({ family, inFleet: false }))];
}

/** The fleet (or on-order) type most of the selection doesn't hold yet; null when they hold every one (pick a chip). */
function defaultFamily(g: GameState, ids: string[], list: { family: RatingFamily; inFleet: boolean }[]): RatingFamily | null {
  const lacking = (f: RatingFamily) => ids.filter((id) => g.crew[id] && !g.crew[id].ratings.includes(f)).length;
  let best: RatingFamily | null = null;
  for (const x of list) if (x.inFleet && lacking(x.family) > (best ? lacking(best) : 0)) best = x.family;
  return best;
}

export function ConvertModal({ crewIds, family: fam0, onBooked }: { crewIds: string[]; family?: RatingFamily; onBooked?: () => void }) {
  const g = useGame();
  const fams = useMemo(() => familyList(g), [g]);
  const earliest = conversionEarliest(g);
  const [ids, setIds] = useState(() => crewIds.filter((id) => g.crew[id]));
  const [picked, setFamily] = useState<RatingFamily | null>(() => fam0 ?? defaultFamily(g, crewIds, fams));
  const family = picked ?? fams[0]?.family ?? 'A320';
  const [start, setStart] = useState(earliest);
  const [drop, setDrop] = useState<Record<string, RatingFamily>>({});
  const live = ids.filter((id) => g.crew[id]);
  const plan = useMemo(() => conversionPlan(g, { crewIds: live, family, start: Math.max(start, earliest), drop }), [g, live.join(), family, start, earliest, drop, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => store.closeModal();
  // v0.7 C1: red warnings turn Book into a two-step confirm (one tap must never ground the fleet).
  const [review, setReview] = useState(false);
  const risky = needsConfirm(plan);
  const book = () => {
    const res = store.act((gg) => startConversion(gg, { crewIds: live, family, start: Math.max(start, earliest), drop }));
    if (!res.ok) return;
    close();
    onBooked?.();
  };
  const skipped = new Map(picked ? plan.skipped.map((s) => [s.crewId, s.why]) : []);
  const pilots = live.filter((id) => isPilotRole(g.crew[id].role));
  const cabin = live.filter((id) => !isPilotRole(g.crew[id].role));
  const nP = plan.classes.filter((k) => k.group === 'pilot').reduce((s, k) => s + k.crewIds.length, 0);
  const nC = plan.classes.filter((k) => k.group === 'cabin').reduce((s, k) => s + k.crewIds.length, 0);
  const costP = plan.classes.filter((k) => k.group === 'pilot').reduce((s, k) => s + k.cost, 0);
  const costC = plan.classes.filter((k) => k.group === 'cabin').reduce((s, k) => s + k.cost, 0);
  const t0 = plan.classes.length ? Math.min(...plan.classes.map((k) => k.start)) : start;
  const t1 = plan.classes.length ? Math.max(...plan.classes.map((k) => k.end)) : start + DAY;
  const pct = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * 100;
  const base = g.company.homeBase;
  const bd = (t: number) => baseDay(g, t);
  const days = Array.from({ length: CHIP_DAYS }, (_, i) => earliest + i * DAY);
  const label = familyLabel(family);
  const pc = courseOf('pilot', 'full', family);
  const cc = courseOf('cabin', 'full', family);

  const person = (id: string) => {
    const c = g.crew[id];
    const why = skipped.get(id);
    const dropFor = plan.dropDefault[id];
    return (
      <span key={id} className={`cv-person ${why ? 'skipped' : ''}`}>
        <span className="col cv-person-txt">
          <span className="row gap-4"><span className={`sc-role r-${c.role}`}>{c.role}</span><b className="ellipsis">{c.last}, {c.first.charAt(0)}.</b></span>
          <span className="tiny muted ellipsis">{why ?? c.ratings.join(', ')}</span>
        </span>
        {dropFor && !why && (
          <select className="select cv-drop" value={drop[id] ?? dropFor} onChange={(e) => setDrop({ ...drop, [id]: e.target.value as RatingFamily })} aria-label={`Rating ${c.last} gives up`}>
            {c.ratings.map((f) => <option key={f} value={f}>drops {f}</option>)}
          </select>
        )}
        <button className="btn btn-ghost btn-icon cv-x" onClick={() => setIds(ids.filter((x) => x !== id))} aria-label={`Remove ${crewName(c)}`}><X /></button>
      </span>
    );
  };

  return (
    <Modal size="wide" className="cv-modal" title={`Type conversion · ${live.length} ${live.length === 1 ? 'person' : 'people'}`} icon={<GraduationCap className="accent" />} onClose={close} footer={
      <>
        {review && risky ? <>
          <span className="grow small muted">Red warnings above: check them first.</span>
          <button className="btn btn-danger" onClick={book} disabled={!plan.ok}>Book anyway</button>
          <button className="btn btn-primary" onClick={() => setReview(false)} autoFocus>Go back</button>
        </> : <>
          <button className="btn" onClick={close}>Cancel</button>
          <span className="grow small muted">{picked && plan.classes.length ? `${plan.classes.length} class${plan.classes.length === 1 ? '' : 'es'} · ${bd(t0)} – ${bd(t1 - 1)}` : ''}</span>
          <button className="btn btn-primary" onClick={risky ? () => setReview(true) : book} disabled={!picked || !plan.ok}><GraduationCap /> {!picked ? 'Pick a type' : risky ? `Review & book · ${money(plan.cost)}` : `Book conversion · ${money(plan.cost)}`}</button>
        </>}
      </>
    }>
      {review && risky && (
        <div className="cv-confirm" role="alert">
          <b>Book anyway?</b>
          {plan.warnings.filter((w) => w.level === 'bad').map((w, i) => <div key={i} className="small bad row gap-8"><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>)}
          <div className="small muted">Flights in these weeks may go uncrewed.</div>
        </div>
      )}
      <div className="cv-cols">
        <div className="col gap-12" style={{ minWidth: 0 }}>
          <div className="upper dim">Target type</div>
          <div className="cv-chips">
            {fams.map((x) => (
              <button key={x.family} className={`cv-chip ${x.family === picked ? 'on' : ''} ${x.inFleet ? '' : 'off'}`} onClick={() => setFamily(x.family)} aria-pressed={x.family === picked}>
                <b>{familyLabel(x.family)}</b>
                {!x.inFleet && <span className="tiny dim">no aircraft</span>}
              </button>
            ))}
          </div>
          <div className="upper dim">First class starts</div>
          <div className="cv-days" role="group" aria-label="Start day">
            {days.map((t) => {
              const d = toDate(toLocal(base, t + 12 * 60));
              const mon = d.getUTCDay() === 1;
              const on = Math.abs(t - start) < DAY / 2;
              return (
                <button key={t} className={`cv-day ${mon ? 'mon' : ''} ${on ? 'on' : ''}`} onClick={() => setStart(t)} aria-pressed={on}>
                  <span className="tiny">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <b>{d.getUTCDate()}</b>
                  <span className="tiny dim">{d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
          <div className="small dim">Pilots {pc.days} days (ground school, simulator, base and line training) · cabin crew {cc.days} days. Classes of up to 20; pilot classes start 14 days apart, two cabin classes at a time.</div>
          {pilots.length > 0 && <div className="upper dim">Pilots ({pilots.length})</div>}
          {pilots.length > 0 && <div className="cv-people">{pilots.map(person)}</div>}
          {cabin.length > 0 && <div className="upper dim">Cabin crew ({cabin.length})</div>}
          {cabin.length > 0 && <div className="cv-people">{cabin.map(person)}</div>}
          {!live.length && <div className="small muted">Nobody selected. Close and select crew in the Crew list or on the roster board.</div>}
        </div>
        <div className="col gap-12 cv-right" style={{ minWidth: 0 }}>
          <div className="upper dim">Classes</div>
          {!picked && <div className="small muted">Everyone selected already holds every type in the fleet. Tap a target type to plan the classes.</div>}
          {picked && <>
          {!plan.classes.length && <div className="small muted">No class: everyone selected is skipped.</div>}
          <div className="cv-timeline">
            {plan.classes.map((k) => (
              <div key={k.no} className="cv-class">
                <div className="row between small">
                  <b>{k.no}</b>
                  <span className="muted">{k.crewIds.length} {k.group === 'pilot' ? 'pilot' : 'cabin crew'}{k.group === 'pilot' && k.crewIds.length !== 1 ? 's' : ''} · {bd(k.start)} – {bd(k.end - 1)}</span>
                </div>
                <div className="cv-track">
                  <span className={`cv-bar ${k.group}`} style={{ left: `${pct(k.start)}%`, width: `${Math.max(2, pct(k.end) - pct(k.start))}%` }}>
                    {k.phases.map((p) => <span key={p.label} className="cv-phase" style={{ width: `${((p.to - p.from) / (k.end - k.start)) * 100}%` }} />)}
                  </span>
                </div>
                <div className="tiny dim">{k.phases.map((p) => `${p.label} ${bd(p.from)}`).join(' · ')}</div>
              </div>
            ))}
          </div>
          <div className="cv-cost">
            {nP > 0 && <div className="row between small"><span className="muted">Pilots {nP} × {money(costP / nP)}</span><b className="num">{money(costP)}</b></div>}
            {nC > 0 && <div className="row between small"><span className="muted">Cabin {nC} × {money(costC / nC)}</span><b className="num">{money(costC)}</b></div>}
            <div className="row between"><b>Total</b><b className="num">{money(plan.cost)}</b></div>
            <div className="tiny dim">Charged once at booking. Full refund up to 14 days before a class, half after, none once it runs.</div>
          </div>
          {plan.warnings.length > 0 && (
            <div className="col gap-4">
              {plan.warnings.map((w, i) => (
                <div key={i} className={`small row gap-8 cv-warn ${w.level === 'bad' ? 'bad' : 'warn'}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>
              ))}
            </div>
          )}
          <div className="tiny dim">After the course pilots fly the {label} only{ccqPartner(family) ? ` (pilots rated on the ${familyLabel(ccqPartner(family)!)} take a 14-day common-type course and keep both)` : ''}; cabin crew keep their types, up to 3.</div>
          </>}
        </div>
      </div>
    </Modal>
  );
}
