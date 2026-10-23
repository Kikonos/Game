// v0.9 Company › Team (UPDATE-0.9.md §5.5): the seven department heads. Left, one 64 px row each (the person with an
// on/off pill, 'Locked' with its progress, or 'Available: choose a candidate'); right, the selected head: person and
// skill, On/Off, the rules (44 px rows), does / never does, proposals (Accept / Dismiss), the last 12 log lines and the
// counters; Fire is a small text button with a confirm. Heads never take the big decisions. Static, no animation.

import { Check, Lock, Plus, Trash2, UserPlus, X } from 'lucide-react';
import type { AlertRule, AlertRuleKind, GameState, HeadId, HeadRules } from '../../engine/core/types';
import { fmtDay, fmtDateTime } from '../../engine/core/time';
import { acceptProposal, dismissProposal, fireHead, headsView, hireHead, setHeadOn, setHeadRules, type HeadView } from '../../engine/ops';
import { NamedIcon } from '../components/NamedIcon';
import { Bar, Seg, Stepper, Toggle } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const pct = (x: number) => Math.round(x * 100);
/** A progress worth a bar ('18 of 25 sectors'); a one-off goal ('Not yet') shows its unlock line instead. */
export const realProgress = <P extends { need: number }>(p: P | null): P | null => (p && p.need > 1 ? p : null);

function HeadRow({ v, on, onPick }: { v: HeadView; on: boolean; onPick: () => void }) {
  return (
    <button className={`v8-row v9-head-row ${on ? 'on' : ''} ${v.unlocked ? '' : 'locked'}`} onClick={onPick} aria-pressed={on}>
      <span className={`v9-head-ico ${v.unlocked ? '' : 'dim'}`}><NamedIcon name={v.icon} /></span>
      <span className="col grow" style={{ minWidth: 0, gap: 3 }}>
        <b className="ellipsis">{v.title}</b>
        {v.person ? (
          <span className="small muted ellipsis">{v.person.name} · skill {pct(v.person.skill)} · {money(v.person.salary)}/mo</span>
        ) : v.unlocked ? (
          <span className="small accent">Available: choose a candidate</span>
        ) : (
          <span className="col" style={{ gap: 3 }}>
            <span className="tiny dim ellipsis">{realProgress(v.progress)?.label ?? v.unlockText}</span>
            {realProgress(v.progress) && <span className="v8-thin"><span className="new" style={{ width: `${Math.min(100, (v.progress!.have / Math.max(1, v.progress!.need)) * 100)}%` }} /></span>}
          </span>
        )}
      </span>
      {v.person ? <span className={`v9-pill ${v.on ? 'on' : ''}`}>{v.on ? 'On' : 'Off'}</span> : !v.unlocked ? <Lock className="sc-ico-s dim" aria-label="Locked" /> : null}
    </button>
  );
}

const setRules = (id: HeadId, r: Partial<HeadRules>) => store.act((g) => setHeadRules(g, id, r), { toastOk: false });

function RuleRow({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return <div className="set-row v9-rule"><div><b>{label}</b>{desc && <div className="tiny dim">{desc}</div>}</div>{children}</div>;
}

const ALERT_LABEL: Record<AlertRuleKind, string> = {
  cashBelow: 'Cash below', delayOver: 'A flight delayed more than', offerOver: 'An offer worth more than', idleOver: 'An aircraft idle more than',
  clientDown: 'A client drops a level', checkDue: 'A check due with no slot within',
};
const ALERT_DEFAULT: Record<AlertRuleKind, number> = { cashBelow: 500_000, delayOver: 2, offerOver: 1_000_000, idleOver: 3, clientDown: 0, checkDue: 10 };
const ALERT_STEP: Record<AlertRuleKind, [number, number, number]> = {
  cashBelow: [0, 20_000_000, 100_000], delayOver: [1, 12, 1], offerOver: [250_000, 50_000_000, 250_000], idleOver: [1, 30, 1], clientDown: [0, 0, 1], checkDue: [1, 60, 1],
};
/** Money rules step proportionally ($100K under $1M, $250K under $5M, then $1M, $5M over $20M): Stepper walks this ladder's index. */
const moneyLadder = (lo: number, hi: number): number[] => {
  const out: number[] = [];
  for (let v = lo; v <= hi; v += v < 1_000_000 ? 100_000 : v < 5_000_000 ? 250_000 : v < 20_000_000 ? 1_000_000 : 5_000_000) out.push(v);
  return out;
};
const LADDER: Partial<Record<AlertRuleKind, number[]>> = { cashBelow: moneyLadder(0, 20_000_000), offerOver: moneyLadder(250_000, 50_000_000) };
const nearest = (xs: number[], v: number) => xs.reduce((b, x, i) => (Math.abs(x - v) < Math.abs(xs[b] - v) ? i : b), 0);
const alertValue = (k: AlertRuleKind, v: number) => (k === 'cashBelow' || k === 'offerOver' ? money(v) : k === 'delayOver' ? `${v} h` : k === 'idleOver' || k === 'checkDue' ? `${v} d` : '');

/** Watch desk: up to 8 rules, each kind · value · Pause / Alert only · on. */
function AlertRules({ v }: { v: HeadView }) {
  const list = v.rules.alerts ?? [];
  const save = (next: AlertRule[]) => setRules(v.id, { alerts: next });
  const edit = (i: number, p: Partial<AlertRule>) => save(list.map((a, j) => (j === i ? { ...a, ...p } : a)));
  const add = () => {
    const kind = (Object.keys(ALERT_LABEL) as AlertRuleKind[]).find((k) => !list.some((a) => a.kind === k)) ?? 'cashBelow';
    save([...list, { id: `r${Date.now().toString(36)}`, kind, value: ALERT_DEFAULT[kind], action: 'alert', on: true }]);
  };
  return (
    <div className="col gap-8">
      {list.map((a, i) => {
        const [lo, hi, step] = ALERT_STEP[a.kind];
        const lad = LADDER[a.kind];
        return (
          <div key={a.id} className="v9-alert">
            <select className="select" value={a.kind} aria-label="Rule" onChange={(e) => { const k = e.target.value as AlertRuleKind; edit(i, { kind: k, value: ALERT_DEFAULT[k] }); }}>
              {(Object.keys(ALERT_LABEL) as AlertRuleKind[]).map((k) => <option key={k} value={k}>{ALERT_LABEL[k]}</option>)}
            </select>
            {a.kind === 'clientDown' ? <span />
              : lad ? <Stepper value={nearest(lad, a.value)} min={0} max={lad.length - 1} onChange={(x) => edit(i, { value: lad[x] })} format={(x) => alertValue(a.kind, lad[x])} />
              : <Stepper value={a.value} min={lo} max={hi} step={step} onChange={(x) => edit(i, { value: x })} format={(x) => alertValue(a.kind, x)} />}
            <Seg<'pause' | 'alert'> value={a.action} onChange={(x) => edit(i, { action: x })} options={[{ value: 'pause', label: 'Pause' }, { value: 'alert', label: 'Alert only' }]} />
            <Toggle on={a.on} onChange={(x) => edit(i, { on: x })} label="Rule on" />
            <button className="btn btn-ghost btn-icon" onClick={() => save(list.filter((_, j) => j !== i))} aria-label="Delete rule"><Trash2 /></button>
          </div>
        );
      })}
      {list.length < 8 && <button className="btn" onClick={add}><Plus /> Add a rule</button>}
      {!list.length && <div className="small dim">No rules yet. Each rule fires once per subject, then waits until it clears.</div>}
    </div>
  );
}

function Rules({ v }: { v: HeadView }) {
  const r = v.rules;
  switch (v.id) {
    case 'opsControl':
      return (
        <>
          <RuleRow label="Longest delay it may take" desc="Longer ones come to you"><Seg<number> value={r.maxDelayMin ?? 120} onChange={(x) => setRules(v.id, { maxDelayMin: x as 60 | 120 | 180 })} options={[60, 120, 180].map((x) => ({ value: x, label: `${x / 60} h` }))} /></RuleRow>
          <RuleRow label="Standby first" desc="Call standby crew before delaying"><Toggle on={r.standbyFirst ?? true} onChange={(x) => setRules(v.id, { standbyFirst: x })} label="Standby first" /></RuleRow>
        </>
      );
    case 'crewDesk':
      return (
        <>
          <RuleRow label="Cost limit per fix" desc="Dearer fixes come to you"><Stepper value={r.fixMax ?? 8000} min={0} max={50_000} step={1000} onChange={(x) => setRules(v.id, { fixMax: x })} format={money} /></RuleRow>
          <RuleRow label="Private jet limit" desc="$0: never charters a jet"><Stepper value={r.jetMax ?? 0} min={0} max={150_000} step={5000} onChange={(x) => setRules(v.id, { jetMax: x })} format={money} /></RuleRow>
          <RuleRow label="Hire by itself" desc="Up to 4 a month to complete crew sets; off: proposals only"><Toggle on={!!r.autoHire} onChange={(x) => setRules(v.id, { autoHire: x })} label="Hire by itself" /></RuleRow>
        </>
      );
    case 'credit':
      return (
        <>
          <RuleRow label="Waive for Trusted clients" desc="A late Trusted or Partner client is waived, not chased"><Toggle on={r.waiveTrusted ?? true} onChange={(x) => setRules(v.id, { waiveTrusted: x })} label="Waive for Trusted" /></RuleRow>
          <RuleRow label="Deposits from slow payers" desc="30 % on new charters (governments 20 %)"><Toggle on={r.depositSlow ?? true} onChange={(x) => setRules(v.id, { depositSlow: x })} label="Deposits" /></RuleRow>
        </>
      );
    case 'fleetPlanner':
      return <RuleRow label="Ferry by itself up to" desc="$0: proposals only"><Stepper value={r.autoFerryMax ?? 0} min={0} max={250_000} step={10_000} onChange={(x) => setRules(v.id, { autoFerryMax: x })} format={money} /></RuleRow>;
    case 'watch':
      return <AlertRules v={v} />;
    default:
      return <div className="small dim">No settings: it works to the fleet's own plan.</div>;
  }
}

function Candidates({ v }: { v: HeadView }) {
  if (!v.candidates.length) return <div className="small muted">New candidates soon.</div>;
  return (
    <div className="col gap-8">
      {v.candidates.map((c, i) => (
        <div key={`${c.name}-${i}`} className="v8-box v9-cand-row">
          <div className="row gap-12">
            <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
              <b>{c.name} <span className="small muted">· {c.years} years</span></b>
              <span className="small muted">{c.blurb}</span>
              <span className="row gap-8 small"><span className="dim">Skill {pct(c.skill)}</span><Bar value={c.skill} size="thin" tone="good" /><span className="num nowrap">{money(c.salary)}/mo</span></span>
            </div>
            <button className="btn btn-primary" onClick={() => store.act((g) => hireHead(g, v.id, i))}><UserPlus /> Hire</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function fire(v: HeadView) {
  if (!v.person) return;
  store.openModal({
    kind: 'confirm', danger: true, title: `Let ${v.person.name} go?`, confirm: 'Let go',
    body: `One month's salary in severance (${money(v.person.salary)}). New candidates after 30 days.`,
    onConfirm: () => store.act((g) => fireHead(g, v.id)),
  });
}

function Detail({ v }: { v: HeadView }) {
  return (
    <div className="col gap-16 v8-detail">
      <div className="row gap-12">
        <span className="v9-head-ico lg"><NamedIcon name={v.icon} /></span>
        <div className="col grow" style={{ minWidth: 0, gap: 2 }}>
          <span className="v8-name">{v.title}</span>
          <span className="small muted">{v.person ? `${v.person.name} · since ${fmtDay(v.person.since)} · ${money(v.person.salary)} a month` : v.unlocked ? 'Earned: choose a candidate' : `Locked: ${v.unlockText}`}</span>
        </div>
        {v.person && <Toggle on={v.on} onChange={(x) => store.act((gg) => setHeadOn(gg, v.id, x), { toastOk: false })} label={`${v.title} on`} />}
      </div>
      {v.person && (
        <div className="col gap-4">
          <div className="row between small"><span className="muted">Skill</span><span className="num">{pct(v.person.skill)}</span></div>
          <Bar value={v.person.skill} size="thin" tone="good" />
          <span className="tiny dim">Higher skill, fewer mistakes. It grows a little every three months.</span>
        </div>
      )}
      {!v.unlocked && realProgress(v.progress) && v.progress && (
        <div className="col gap-4">
          <div className="row between small"><span className="muted">{v.progress.label}</span><span className="num">{v.progress.have} / {v.progress.need}</span></div>
          <Bar value={v.progress.have / Math.max(1, v.progress.need)} size="thin" />
        </div>
      )}
      <div className="v9-does">
        <div className="col gap-4"><div className="upper dim">Does</div><ul className="v8-lines">{v.does.map((d) => <li key={d}>{d}</li>)}</ul></div>
        <div className="col gap-4"><div className="upper dim">Never does</div><ul className="v8-lines">{v.never.map((d) => <li key={d}>{d}</li>)}</ul></div>
      </div>
      {v.unlocked && !v.person && <div className="col gap-8"><div className="upper dim">Candidates</div><Candidates v={v} /></div>}
      {v.person && <div className="col gap-4"><div className="upper dim">Rules</div><Rules v={v} /></div>}
      {v.proposals.length > 0 && (
        <div className="col gap-8">
          <div className="upper dim">Proposals</div>
          {v.proposals.map((p) => (
            <div key={p.id} className="v8-box">
              <span className="small">{p.text}</span>
              <span className="row gap-8 wrap">
                {p.cost > 0 && <span className="small num">{money(p.cost)}</span>}
                <span className="tiny dim grow">until {fmtDateTime(p.expires)}</span>
                <button className="btn" onClick={() => store.act((gg) => dismissProposal(gg, v.id, p.id))}><X /> Dismiss</button>
                <button className="btn btn-primary" onClick={() => store.act((gg) => acceptProposal(gg, v.id, p.id))}><Check /> Accept</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {v.person && (
        <div className="col gap-4">
          <div className="upper dim">Recent</div>
          {!v.log.length && <div className="small dim">Nothing handled yet.</div>}
          {v.log.map((l, i) => (
            <div key={i} className={`v8-log v8-log2 small v9-log-${l.kind}`}>
              <span className="dim nowrap">{fmtDay(l.t)}</span>
              <span>{l.kind === 'mistake' ? `Mistake: ${l.text}` : l.text}</span>
            </div>
          ))}
          <div className="row between small mt-8">
            <span className="muted">Handled {v.handled} · mistakes {v.mistakes} · overridden {v.overridden}</span>
            <button className="btn btn-ghost v9-fire" onClick={() => fire(v)}>Let go</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Company › Team: the seven heads on the left, the selected one on the right. */
export function TeamView({ g }: { g: GameState }) {
  const list = headsView(g);
  const selId = store.nav.sel?.kind === 'head' ? store.nav.sel.id : (list.find((h) => h.unlocked && !h.person) ?? list.find((h) => h.person) ?? list[0])?.id;
  const v = list.find((h) => h.id === selId) ?? list[0];
  const earned = list.filter((h) => h.unlocked).length;
  return (
    <div className="v8-split v9-team">
      <div className="card v8-pane v8-list">
        <div className="v8-list-head small muted">{earned} of {list.length} earned · {list.filter((h) => h.person).length} hired</div>
        {list.map((h) => <HeadRow key={h.id} v={h} on={h.id === v?.id} onPick={() => store.select({ kind: 'head', id: h.id })} />)}
      </div>
      <div className="card v8-pane v8-pane-r">{v && <Detail v={v} />}</div>
    </div>
  );
}
