// v0.11 Operations: Company › Safety & audit (next to the Ladder). The yearly authority audit (date, findings with
// their deadlines and corrective actions, the suspension), the safety record it reads (illegal duties, ramp inspections
// by category, technical reliability, grounded days) and the year's disruptions.

import { ClipboardCheck, ShieldAlert } from 'lucide-react';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { DAY, fmtDate, yearOf } from '../../engine/core/time';
import type { AuditFinding, GameState, RampCheck } from '../../engine/core/types';
import { auditRecord, authorityName, startAuditTask } from '../../engine/ops/audit';
import { programmeAt } from '../../engine/ops/ramp';
import { Card } from '../components/ui';
import { money } from '../format';
import { store } from '../store';

const days = (g: GameState, t: number) => Math.ceil((t - g.now) / DAY);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The year's disruption counts in plain words (Company and the bot read the same record). Pure. */
export function disruptionLine(g: GameState): string {
  const c = g.opsx?.counts[yearOf(g.now)] ?? {};
  const parts: [string, number][] = [
    ['diversions', (c.weatherDivert ?? 0) + (c.techDivert ?? 0) + (c.curfewDivert ?? 0)],
    ['medical emergencies', c.medical ?? 0],
    ['bird strikes', c.birdStrike ?? 0],
    ['crew sick away', c.sickAway ?? 0],
    ['ATC slots', c.ctot ?? 0],
    ['slow turnarounds', c.turnaround ?? 0],
    ['curfews', c.curfew ?? 0],
  ];
  const on = parts.filter(([, n]) => n > 0);
  return on.length ? on.map(([w, n]) => `${n} ${w}`).join(' · ') : 'None yet this year';
}

function Finding({ g, f }: { g: GameState; f: AuditFinding }) {
  const left = days(g, f.due);
  const start = () => store.openModal({
    kind: 'confirm', title: f.task.label, confirm: `Start for ${money(f.task.cost)}`,
    body: `Closes the Level ${f.level} finding (${f.text.toLowerCase()}) in about ${f.task.days} days. Due ${fmtDate(f.due)}.`,
    onConfirm: () => store.act((gg) => startAuditTask(gg, f.id)),
  });
  return (
    <div className={`ops-find ${f.closed ? 'done' : f.overdue ? 'overdue' : f.level === 1 ? 'l1' : ''}`}>
      <div className="row between gap-8">
        <b>{f.text}</b>
        <span className={`badge ${f.level === 1 || f.overdue ? 'bad' : 'warn'}`}>Level {f.level}</span>
      </div>
      <div className="small muted">{f.why}</div>
      <div className="row between gap-8 mt-8 wrap">
        <span className="small">
          {f.closed ? <span className="good">Closed {fmtDate(f.closed)}</span>
            : f.started ? <>Under way: <b>{f.task.label}</b>, done {fmtDate(f.ready ?? f.due)}</>
            : <><b>{f.task.label}</b> · {money(f.task.cost)} · {f.task.days} days</>}
        </span>
        {!f.closed && <span className={`small nowrap ${f.overdue ? 'bad' : left <= 14 ? 'warn' : 'dim'}`}>{f.overdue ? `Overdue since ${fmtDate(f.due)}` : `Due ${fmtDate(f.due)} (${left} d)`}</span>}
        {!f.closed && !f.started && <button className="btn btn-sm btn-primary" onClick={start} disabled={g.company.cash < f.task.cost}>Start</button>}
      </div>
    </div>
  );
}

function RampRow({ r }: { r: RampCheck }) {
  return (
    <div className="ops-row">
      <span className="small nowrap dim">{fmtDate(r.t)}</span>
      <span className="grow small"><b>{r.reg}</b> at {AIRPORT_BY_CODE[r.at]?.city ?? r.at} · {r.prog === 'local' ? 'local authority' : r.prog}{r.action === '3c' ? ' · detained' : r.action === '3b' ? ' · fixed before flight' : ''}</span>
      <span className="ops-cats">
        {r.cats[0] + r.cats[1] + r.cats[2] === 0 ? <span className="ops-cat">clean</span> : r.cats.map((n, i) => (n ? <span key={i} className={`ops-cat c${i + 1}`}>Cat {i + 1} ×{n}</span> : null))}
      </span>
    </div>
  );
}

export function SafetyCard({ g }: { g: GameState }) {
  const a = g.opsx?.audit;
  const rec = auditRecord(g);
  const auth = authorityName(g);
  const findings = (a?.findings ?? []).filter((f) => !f.closed || f.closed > g.now - 60 * DAY).sort((x, y) => Number(!!x.closed) - Number(!!y.closed) || x.level - y.level || x.due - y.due);
  const last = a?.history.at(-1);
  const ramps = [...rec.ramp.list].reverse().slice(0, 6);
  const tone = (bad: boolean, warn = false) => (bad ? 'bad' : warn ? 'warn' : 'good');
  return (
    <Card title="Safety & audit" icon={<ShieldAlert className="ico" />} className="ops-safety"
      sub={a ? `${cap(auth)} audits us every year · next ${fmtDate(a.next)} (${Math.max(0, days(g, a.next))} days)${a.announced ? ' · announced' : ''}` : undefined}>
      {a?.suspended && <div className="ops-susp small"><b>Approvals suspended</b> since {fmtDate(a.suspended)}: an audit finding is past its deadline. Nothing new is filed or granted on the Ladder until it is closed.</div>}
      <div className="ops-gauges">
        <div className={`ops-gauge ${tone(rec.illegal > 0)}`}><b>{rec.illegal}</b><span className="tiny dim">illegal duties, 12 months</span></div>
        <div className={`ops-gauge ${tone(rec.ramp.cats[2] >= 2 || rec.ramp.detained > 0, rec.ramp.cats[2] > 0 || rec.ramp.cats[1] >= 3)}`}><b>{rec.ramp.n}</b><span className="tiny dim">ramp checks: {rec.ramp.cats[0]}/{rec.ramp.cats[1]}/{rec.ramp.cats[2]} by Cat 1/2/3</span></div>
        <div className={`ops-gauge ${tone(rec.tech.pct !== null && rec.tech.pct < 97, rec.tech.pct !== null && rec.tech.pct < 98)}`}><b>{rec.tech.pct === null ? '–' : `${rec.tech.pct}%`}</b><span className="tiny dim">technical reliability (97 % standard)</span></div>
        <div className={`ops-gauge ${tone(rec.grounded >= 10, rec.grounded > 0)}`}><b>{rec.grounded}</b><span className="tiny dim">days grounded, check overdue</span></div>
      </div>
      <div className="row gap-8 mt-12"><ClipboardCheck className="sc-ico-s dim" /><b className="small">Audit findings</b><span className="tiny dim grow">{last ? `Last audit ${fmtDate(last[0])}: ${last[1] + last[2] ? `${last[1]} Level 1, ${last[2]} Level 2` : 'no findings'}` : 'No audit yet'}</span></div>
      {findings.length ? findings.map((f) => <Finding key={f.id} g={g} f={f} />) : <div className="small dim mt-8">Nothing open. Level 1 findings must be fixed within 21 days, Level 2 within 30–90 days; a missed deadline suspends the Ladder.</div>}
      <div className="row gap-8 mt-12"><b className="small">Ramp inspections</b><span className="tiny dim">{programmeAt(g, 'FRA') === 'SACA' ? 'SACA at European airports (we are an EU operator)' : 'SAFA at European airports (we are not an EU operator)'}, the local authority elsewhere</span></div>
      <div className="ops-list">{ramps.length ? ramps.map((r) => <RampRow key={r.id} r={r} />) : <div className="small dim">None in the last 12 months.</div>}</div>
      <div className="small mt-12"><span className="muted">Disruptions this year:</span> {disruptionLine(g)}</div>
    </Card>
  );
}
