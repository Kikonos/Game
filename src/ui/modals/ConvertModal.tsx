// v0.6 bulk type-rating conversion (UPDATE-0.6.md §F2.3): target type, first start day, the people (removable;
// skipped with a reason; cabin crew at 3 types choose the rating they give up) on the left; the classes the
// engine forms (max 20, pilots and cabin apart, staggered), cost and fleet-short warnings on the right.
// v0.18.3 opened from a Utilisation surplus row (`advice`): proposals on top: the type to convert to and why (short of
// crew first), and 1–3 plans (classes, the trips handed to others, cost, line-ready day); picking one fills the form
// below, and Book applies the plan (its re-crewing too).

import { AlertTriangle, Check, GraduationCap, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ACMI_TYPES_LIST, type RatingFamily } from '../../data/acmiTypes';
import { typeOf } from '../../engine/core/perf';
import { DAY, toDate, toLocal } from '../../engine/core/time';
import type { GameState, Role } from '../../engine/core/types';
import { applyConvertOption, ccqKeeps, ccqPartners, conversionEarliest, conversionPlan, convertAdvice, courseOf, courseText, crewName, familyLabel, startConversion, type ConvertOption } from '../../engine/crew';
import { fmtDay } from '../../engine/core/time';
import { approvalReqs, ratedPilots } from '../../engine/ops';
import { Modal } from '../components/ui';
import { Help } from '../components/Help';
import { money } from '../format';
import { baseDay, isPilotRole, needsConfirm } from '../screens/screenLogic';
import { store, useGame } from '../store';
import { lockOf } from '../../engine/scenario';
import { LockNote } from '../components/Locked';

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

/** v0.18.3 a surplus row's proposals: the rank and family, and how many are beyond the flying's need. */
export interface ConvertAdviceFor { from: RatingFamily; role: Role; n: number }

export function ConvertModal({ crewIds, family: fam0, onBooked, advice }: { crewIds: string[]; family?: RatingFamily; onBooked?: () => void; advice?: ConvertAdviceFor }) {
  const g = useGame();
  const fams = useMemo(() => familyList(g), [g]);
  const earliest = conversionEarliest(g);
  // v0.18.3 proposals for a surplus row (computed once for the target picked; a dry run on a copy of the game).
  const [aim, setAim] = useState<RatingFamily | undefined>(undefined);
  const adv = useMemo(() => (advice ? convertAdvice(g, advice.from, advice.role, advice.n, aim) : null), [g, advice?.from, advice?.role, advice?.n, aim, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstOpt = adv?.options[0];
  const [chosen, setChosen] = useState<string | null>(() => firstOpt?.key ?? null);
  const opt: ConvertOption | undefined = adv?.options.find((o) => o.key === chosen);
  const [ids, setIds] = useState(() => (firstOpt ? firstOpt.classes.flatMap((k) => k.crewIds) : crewIds).filter((id) => g.crew[id]));
  const [picked, setFamily] = useState<RatingFamily | null>(() => (adv?.targets[0]?.family ?? fam0 ?? defaultFamily(g, crewIds, fams)));
  const family = picked ?? fams[0]?.family ?? 'A320';
  const [start, setStart] = useState(firstOpt?.classes[0]?.start ?? earliest);
  const choose = (o: ConvertOption, f: RatingFamily) => {
    setChosen(o.key);
    setIds(o.classes.flatMap((k) => k.crewIds));
    setFamily(f);
    setStart(o.classes[0].start);
  };
  // Any change by hand below leaves the plan: the form books as before.
  const leave = () => setChosen(null);
  const [drop, setDrop] = useState<Record<string, RatingFamily>>({});
  const live = ids.filter((id) => g.crew[id]);
  const plan = useMemo(() => conversionPlan(g, { crewIds: live, family, start: Math.max(start, earliest), drop }), [g, live.join(), family, start, earliest, drop, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => store.closeModal();
  // v0.7 C1: red warnings turn Book into a two-step confirm (one tap must never ground the fleet).
  const [review, setReview] = useState(false);
  const risky = needsConfirm(plan);
  const book = () => {
    const res = opt ? store.act((gg) => applyConvertOption(gg, family, opt)) : store.act((gg) => startConversion(gg, { crewIds: live, family, start: Math.max(start, earliest), drop }));
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
  const nSkip = picked ? live.filter((id) => skipped.has(id)).length : 0;
  // v0.7: a widebody target before Widebody operations is held: the 4 + 4 the filing needs after this booking,
  // and a start that ends the course near the first such aircraft's handover (converted pilots fly only it).
  const wide = ACMI_TYPES_LIST.some((t) => t.family === family && t.body === 'wide');
  const wbNeed = useMemo(() => {
    if (!wide || g.company.approvals.includes('widebody')) return null;
    const m = /^(\d+) \+ (\d+)$/.exec(approvalReqs(g, 'widebody').find((r) => / rated on /.test(r.label))?.need ?? '');
    return m ? { CPT: Number(m[1]), FO: Number(m[2]) } : null;
  }, [g, wide, g.now]); // eslint-disable-line react-hooks/exhaustive-deps
  let wbLine: { ok: boolean; text: string } | null = null;
  if (wbNeed && picked) {
    const r = ratedPilots(g, [family], { booked: true });
    const add = { CPT: 0, FO: 0 };
    for (const k of plan.classes) if (k.group === 'pilot') for (const id of k.crewIds) { const role = g.crew[id]?.role; if (role === 'CPT' || role === 'FO') add[role]++; }
    const cpt = r.CPT + add.CPT;
    const fo = r.FO + add.FO;
    const ok = cpt >= wbNeed.CPT && fo >= wbNeed.FO;
    wbLine = { ok, text: `Widebody operations needs ${wbNeed.CPT} + ${wbNeed.FO} ${label} pilots: after this booking ${cpt} + ${fo}${ok ? '' : ` (${Math.max(0, wbNeed.CPT - cpt)} CPT + ${Math.max(0, wbNeed.FO - fo)} FO short)`}.` };
  }
  const arriving = Object.values(g.fleet)
    .filter((a) => a.status === 'delivering' && typeOf(a.typeId).family === family)
    .map((a) => ({ reg: a.reg, at: a.delivery?.arrived ?? a.delivery?.handover ?? a.deliveredAt }))
    .sort((a, b) => a.at - b.at)[0];
  const fitDay = arriving ? earliest + Math.min(CHIP_DAYS - 1, Math.max(0, Math.round((arriving.at - pc.days * DAY - earliest) / DAY))) * DAY : null;

  const person = (id: string) => {
    const c = g.crew[id];
    const why = skipped.get(id);
    const dropFor = plan.dropDefault[id];
    return (
      <span key={id} className={`cv-person ${why ? 'skipped' : ''}`}>
        <span className="col cv-person-txt">
          <span className="row gap-4"><span className={`sc-role r-${c.role}`}>{c.role}</span><b className="ellipsis">{c.last}, {c.first.charAt(0)}.</b></span>
          {/* v0.12.1 a CCQ keeps the old type: 'CCQ (keeps A320)'. */}
          <span className="tiny muted ellipsis">{why ?? (picked && ccqKeeps(c, family) ? `${c.ratings.join(', ')} · CCQ (keeps ${familyLabel(ccqKeeps(c, family)!)})` : c.ratings.join(', '))}</span>
        </span>
        {dropFor && !why && (
          <select className="select cv-drop" value={drop[id] ?? dropFor} onChange={(e) => setDrop({ ...drop, [id]: e.target.value as RatingFamily })} aria-label={`Rating ${c.last} gives up`}>
            {c.ratings.map((f) => <option key={f} value={f}>drops {f}</option>)}
          </select>
        )}
        <button className="btn btn-ghost btn-icon cv-x" onClick={() => { leave(); setIds(ids.filter((x) => x !== id)); }} aria-label={`Remove ${crewName(c)}`}><X /></button>
      </span>
    );
  };

  return (
    <Modal size="wide" className="cv-modal" title={`Type conversion · ${nSkip ? `${live.length - nSkip} of ` : ''}${live.length} ${live.length === 1 ? 'person' : 'people'}`} icon={<GraduationCap className="accent" />} onClose={close} footer={
      <>
        {review && risky ? <>
          <span className="grow small muted">Red warnings above: check them first.</span>
          <button className="btn btn-danger" onClick={book} disabled={!plan.ok}>Book anyway</button>
          <button className="btn btn-primary" onClick={() => setReview(false)} autoFocus>Go back</button>
        </> : <>
          <button className="btn" onClick={close}>Cancel</button>
          <span className="grow small muted">{opt ? `${opt.classes.flatMap((k) => k.crewIds).length} people · ${opt.classes.length} class${opt.classes.length === 1 ? '' : 'es'} · ${bd(opt.classes[0].start)} – ${bd(opt.ready - 1)}` : picked && plan.classes.length ? `${live.length - nSkip} of ${live.length} booked${nSkip ? ` · ${nSkip} skipped` : ''} · ${plan.classes.length} class${plan.classes.length === 1 ? '' : 'es'} · ${bd(t0)} – ${bd(t1 - 1)}` : ''}</span>
          <LockNote why={lockOf(g, 'training')} />
          <button className="btn btn-primary" onClick={risky && !opt ? () => setReview(true) : book} disabled={!picked || (!opt && !plan.ok) || !!lockOf(g, 'training')}><GraduationCap /> {!picked ? 'Pick a type' : opt ? `Book this plan · ${money(opt.fees)}` : risky ? `Review & book · ${money(plan.cost)}` : `Book conversion · ${money(plan.cost)}`}</button>
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
      {adv && (
        <section className="cv-adv" aria-label="Proposed">
          <div className="upper dim">Proposed for {adv.want} of these {advice!.role === 'CC' ? 'cabin crew' : advice!.role === 'PUR' ? 'pursers' : advice!.role === 'CPT' ? 'captains' : 'first officers'} <Help title="How the plans are made">
            <p>The least busy go first. Classes of up to 8 pilots (simulator pairs) or 20 cabin crew.</p>
            <p>Trips in the way go to crew a dry run of the roster finds legal for them.</p>
            <p>Pick a plan, or change anything below and book by hand.</p>
          </Help></div>
          <div className="cv-adv-targets">
            {adv.targets.slice(0, 4).map((t) => (
              <button key={t.family} className={`cv-adv-t ${t.family === (aim ?? adv.targets[0]?.family) ? 'on' : ''} ${t.short ? 'short' : ''}`} onClick={() => { setAim(t.family); setChosen(null); }} aria-pressed={t.family === (aim ?? adv.targets[0]?.family)}>
                <b>{familyLabel(t.family)}{t.ccq ? ' · CCQ' : ''}</b><span className="small muted">{t.why}</span>
              </button>
            ))}
          </div>
          {adv.why && <div className="small muted">{adv.why}.</div>}
          <div className="cv-adv-opts" role="radiogroup" aria-label="Plans">
            {adv.options.map((o) => {
              const f = aim ?? adv.targets[0]!.family;
              const on = chosen === o.key;
              return (
                <button key={o.key} role="radio" aria-checked={on} className={`cv-adv-o ${on ? 'on' : ''}`} onClick={() => choose(o, f)}>
                  <span className="row between gap-8"><b className="small">{o.title}</b><span className={`tiny ${o.late ? 'warn' : 'good'}`}>Line-ready {fmtDay(o.ready)}{o.late ? ', after the need' : ''}</span></span>
                  <span className="tiny muted">Course {money(o.fees)}{o.recrew ? ` · tickets ${money(o.recrew)}` : ''} · {o.swaps.length ? `${o.swaps.length} trip${o.swaps.length === 1 ? '' : 's'} re-crewed` : o.unresolved ? '' : 'no trips in the way'}{o.unresolved ? `${o.swaps.length ? ' · ' : ''}${o.unresolved} trip${o.unresolved === 1 ? '' : 's'} back to the auto-roster` : ''}{o.handedBH ? ` · ${o.handedBH} h of their flying handed over` : ''}</span>
                  {o.swaps.length > 0 && <span className="tiny dim cv-adv-sw">{o.swaps.slice(0, 3).map((s) => s.text).join(' · ')}{o.swaps.length > 3 ? ` · and ${o.swaps.length - 3} more` : ''}</span>}
                </button>
              );
            })}
          </div>
        </section>
      )}
      <div className="cv-cols">
        <div className="col gap-12" style={{ minWidth: 0 }}>
          <div className="upper dim">Target type</div>
          <div className="cv-chips">
            {fams.map((x) => (
              <button key={x.family} className={`cv-chip ${x.family === picked ? 'on' : ''} ${x.inFleet ? '' : 'off'}`} onClick={() => { leave(); setFamily(x.family); }} aria-pressed={x.family === picked}>
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
                <button key={t} className={`cv-day ${mon ? 'mon' : ''} ${on ? 'on' : ''}`} onClick={() => { leave(); setStart(t); }} aria-pressed={on}>
                  <span className="tiny">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                  <b>{d.getUTCDate()}</b>
                  <span className="tiny dim">{d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' })}</span>
                </button>
              );
            })}
          </div>
          {arriving && fitDay !== null && (
            <button className={`btn btn-sm cv-fit ${Math.abs(fitDay - start) < DAY / 2 ? 'on' : ''}`} onClick={() => { leave(); setStart(fitDay); }}>
              End near {arriving.reg}’s arrival · {bd(arriving.at)}
            </button>
          )}
          <div className="small dim">Pilots {pc.days} days · cabin crew {cc.days} days <Help title="Courses and classes">
            <p>Pilots: ground school, simulator, base and line training.</p>
            <p>Classes of up to 20. Pilot classes start 14 days apart; two cabin classes run at a time.</p>
            <p>{ccqPartners(family).length ? `Pilots rated on the ${ccqPartners(family).map(familyLabel).join(' or ')} take a ${courseOf('pilot', 'ccq', family).days}-day CCQ and keep both. ` : ''}Cabin crew keep their types, up to 3.</p>
          </Help></div>
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
          {opt && <div className="cv-timeline">{opt.classes.map((k, i) => (
            <div key={i} className="cv-class">
              <div className="row between small"><b>Class {i + 1}</b><span className="muted">{k.crewIds.length} {k.group === 'pilot' ? `pilot${k.crewIds.length === 1 ? '' : 's'}` : 'cabin crew'} · {bd(k.start)} – {bd(k.end - 1)}</span></div>
              <div className="tiny dim">{k.crewIds.map((id) => g.crew[id]?.last ?? '').join(', ')}</div>
            </div>
          ))}</div>}
          {!opt && !plan.classes.length && <div className="small muted">No class: everyone selected is skipped.</div>}
          {!opt && <div className="cv-timeline">
            {plan.classes.map((k) => (
              <div key={k.no} className="cv-class">
                <div className="row between small">
                  <b>{k.no}</b>
                  <span className="muted">{k.crewIds.length} {k.group === 'pilot' ? 'pilot' : 'cabin crew'}{k.group === 'pilot' && k.crewIds.length !== 1 ? 's' : ''}{k.course === 'ccq' ? ` · ${courseText(g, { course: k.course, family, crewIds: k.crewIds })}` : ''} · {bd(k.start)} – {bd(k.end - 1)}</span>
                </div>
                <div className="cv-track">
                  <span className={`cv-bar ${k.group}`} style={{ left: `${pct(k.start)}%`, width: `${Math.max(2, pct(k.end) - pct(k.start))}%` }}>
                    {k.phases.map((p) => <span key={p.label} className="cv-phase" style={{ width: `${((p.to - p.from) / (k.end - k.start)) * 100}%` }} />)}
                  </span>
                </div>
                <div className="tiny dim">{k.phases.map((p) => `${p.label} ${bd(p.from)}`).join(' · ')}</div>
              </div>
            ))}
          </div>}
          <div className="cv-cost">
            {nP > 0 && <div className="row between small"><span className="muted">Pilots {nP} × {money(costP / nP)}</span><b className="num">{money(costP)}</b></div>}
            {nC > 0 && <div className="row between small"><span className="muted">Cabin {nC} × {money(costC / nC)}</span><b className="num">{money(costC)}</b></div>}
            <div className="row between"><b>Total <Help title="Paying and refunds">Charged once at booking. Full refund up to 14 days before a class, half after, none once it runs.</Help></b><b className="num">{money(plan.cost)}</b></div>
          </div>
          {wbLine && <div className={`small row gap-8 cv-warn ${wbLine.ok ? 'good' : 'warn'}`}>{wbLine.ok ? <Check className="sc-ico-s" /> : <AlertTriangle className="sc-ico-s" />}<span>{wbLine.text}</span></div>}
          {plan.warnings.length > 0 && (
            <div className="col gap-4">
              {plan.warnings.map((w, i) => (
                <div key={i} className={`small row gap-8 cv-warn ${w.level === 'bad' ? 'bad' : 'warn'}`}><AlertTriangle className="sc-ico-s" /><span>{w.text}</span></div>
              ))}
            </div>
          )}
          <div className="tiny dim">Pilots then fly the {label} only</div>
          </>}
        </div>
      </div>
    </Modal>
  );
}
