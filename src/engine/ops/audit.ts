// v0.11 Operations — the yearly authority audit (Part-ORO oversight; the authority's findings per ARO.GEN.350). Once a
// year, announced about four weeks ahead, the authority audits the operator against the year's record: illegal crew
// duties, ramp inspection findings, technical dispatch reliability, aircraft grounded with a check overdue, reduced
// cabin crew reports. Level 1 (serious: a risk to safety now) must be acted on at once (21 days here); Level 2 gets a
// corrective action plan with a deadline (GM2 ARO.GEN.350(d): up to three months). Each finding closes when its
// corrective action is done (cost, days). One left open past its deadline suspends our approval work (no new
// approvals filed or granted on the Ladder) until it is closed. Rolls on a side stream.

import { AUDIT_DEADLINE, AUDIT_FEE, AUDIT_TASKS } from '../../data/opsData';
import { AUTHORITY } from '../../data/flavor';
import { AIRPORT_BY_CODE } from '../../data/airports';
import { nextId } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage } from '../core/messages';
import { techReliability } from '../core/techLog';
import { hashUnit } from '../core/util';
import { DAY, dayStart, fmtDate, yearOf } from '../core/time';
import type { ActionResult, AuditFinding, AuditLevel, GameState, Minute } from '../core/types';
import { countOps, opsState } from './disrupt';
import { OPS_LIVE } from './director';
import { rampYear } from './ramp';
import { isGrounded } from './maintenance';
import { bumpReliable, usd } from './util';

const roll = (g: GameState, key: string) => hashUnit(`${g.seed}:audit:${key}`);
export const authorityName = (g: GameState) => AUTHORITY[AIRPORT_BY_CODE[g.company.homeBase]?.country ?? ''] ?? 'the authority';

/** What the auditors will read: the last year's record. Pure. */
export function auditRecord(g: GameState) {
  const from = g.now - 365 * DAY;
  const illegal = (g.stats.incidents ?? []).filter(([t, k]) => t >= from && k === 'illegalCrew').length;
  const ramp = rampYear(g);
  const tech = techReliability(g, 365);
  const grounded = (g.opsx?.grounded ?? []).filter((t) => t >= from).length;
  const reduced = (g.opsx?.reducedReports ?? []).filter((t) => t >= from).length;
  return { illegal, ramp, tech, grounded, reduced };
}

/** Approvals suspended by an overdue audit finding. Pure. */
export const approvalsSuspended = (g: GameState): boolean => !!g.opsx?.audit.suspended;

/** Open findings (not closed), worst first. Pure. */
export function openFindings(g: GameState): AuditFinding[] {
  return (g.opsx?.audit.findings ?? []).filter((f) => !f.closed).sort((a, b) => a.level - b.level || a.due - b.due);
}

function finding(g: GameState, level: AuditLevel, area: AuditFinding['area'], why: string, dueDays: number): AuditFinding {
  const T = AUDIT_TASKS[area];
  return {
    id: nextId(g, 'af'), level, area, text: T.text, why, raised: g.now, due: dayStart(g.now) + dueDays * DAY,
    task: { label: T.task, cost: T.cost * (level === 1 ? 1.5 : 1), days: T.days },
  };
}

/** The audit itself: findings from the year's record, the fee, one message per finding and a summary. */
export function runAudit(g: GameState): AuditFinding[] {
  const st = opsState(g).audit;
  const r = auditRecord(g);
  const L2 = (lo: number) => Math.round(AUDIT_DEADLINE[2][0] + (AUDIT_DEADLINE[2][1] - AUDIT_DEADLINE[2][0]) * lo);
  const out: AuditFinding[] = [];
  if (r.illegal >= 3) out.push(finding(g, 1, 'ftl', `${r.illegal} duties flown over a legal limit this year.`, AUDIT_DEADLINE[1]));
  else if (r.illegal) out.push(finding(g, 2, 'ftl', `${r.illegal} dut${r.illegal > 1 ? 'ies' : 'y'} flown over a legal limit this year.`, L2(0)));
  if (r.ramp.detained || r.ramp.cats[2] >= 4) out.push(finding(g, 1, 'ramp', `${r.ramp.cats[2]} major ramp findings${r.ramp.detained ? `, ${r.ramp.detained} detention` : ''} in a year.`, AUDIT_DEADLINE[1]));
  else if (r.ramp.cats[2] >= 2 || r.ramp.cats[1] >= 4) out.push(finding(g, 2, 'ramp', `${r.ramp.cats[2]} major and ${r.ramp.cats[1]} significant ramp findings in a year.`, L2(0.5)));
  if (r.tech.pct !== null && r.tech.pct < 97) out.push(finding(g, 2, 'tech', `Technical dispatch reliability ${r.tech.pct} % (standard 97 %).`, L2(0.5)));
  if (r.grounded >= 10) out.push(finding(g, 1, 'checks', `Aircraft grounded ${r.grounded} days with a check overdue.`, AUDIT_DEADLINE[1]));
  else if (r.grounded) out.push(finding(g, 2, 'checks', `An aircraft was grounded ${r.grounded} day${r.grounded > 1 ? 's' : ''} with a check overdue.`, L2(0)));
  if (r.reduced >= 2) out.push(finding(g, 2, 'training', `${r.reduced} flights flew one cabin crew short this year: no reserve in cabin crew planning.`, L2(1)));
  // Auditors nearly always find something small (one in two audits, a Level 2 on the paperwork).
  if (out.length < 2 && roll(g, `q:${yearOf(g.now)}`) < 0.5) out.push(finding(g, 2, roll(g, `qa:${yearOf(g.now)}`) < 0.5 ? 'quality' : 'training', 'Found during the document review.', L2(1)));
  st.findings = [...st.findings.filter((f) => !f.closed || f.closed > g.now - 400 * DAY), ...out];
  st.last = g.now;
  st.history.push([g.now, out.filter((f) => f.level === 1).length, out.filter((f) => f.level === 2).length]);
  st.next = dayStart(g.now) + (350 + Math.round(roll(g, `next:${yearOf(g.now)}`) * 30)) * DAY;
  st.announced = false;
  post(g, 'compliance', -AUDIT_FEE);
  countOps(g, 'audit');
  for (const f of out) countOps(g, `auditL${f.level}`);
  const auth = authorityName(g);
  if (!out.length) {
    bumpReliable(g, 1);
    pushMessage(g, { tone: 'good', cat: 'company', title: `${cap(auth)} audit: no findings`, body: `A clean audit. Reliable name +1. Audit fee ${usd(AUDIT_FEE)}. Next audit around ${fmtDate(st.next)}.`, ref: { kind: 'audit', id: 'next' } });
    return out;
  }
  const l1 = out.filter((f) => f.level === 1).length;
  pushMessage(g, {
    tone: l1 ? 'bad' : 'warn', cat: 'company', title: `${cap(auth)} audit: ${out.length} finding${out.length > 1 ? 's' : ''}${l1 ? ` (${l1} Level 1)` : ''}`,
    body: `${out.map((f) => `Level ${f.level}: ${f.text}, fix by ${fmtDate(f.due)}`).join('. ')}. Start each corrective action in Company › Safety. Audit fee ${usd(AUDIT_FEE)}.`,
    ref: { kind: 'audit', id: out[0].id }, problem: { kind: 'auditFinding', ref: { kind: 'audit', id: out[0].id } },
    hurt: { money: out.reduce((s, f) => s + f.task.cost, 0), pax: 0, delayMin: 0, level: l1 ? 'high' : 'low' }, cue: l1 ? 'opsEmergency' : 'notice',
  });
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Player action: start the corrective action of a finding (pays now; the finding closes when it is done). */
export function startAuditTask(g: GameState, id: string): ActionResult {
  const f = g.opsx?.audit.findings.find((x) => x.id === id);
  if (!f || f.closed) return { ok: false, error: 'Finding not found or closed' };
  if (f.started) return { ok: false, error: 'Already under way' };
  if (g.company.cash < f.task.cost) return { ok: false, error: `Needs ${usd(f.task.cost)}` };
  post(g, 'compliance', -f.task.cost);
  f.started = g.now;
  f.ready = g.now + f.task.days * DAY;
  return { ok: true, msg: `${f.task.label}: done by ${fmtDate(f.ready)}` };
}

/** Daily: the four-week notice, the audit itself, actions completing, deadlines passing, the suspension. */
export function dailyAudit(g: GameState): void {
  if (!OPS_LIVE.on || !OPS_LIVE.disrupt) return;
  const ops = opsState(g);
  const st = ops.audit;
  // Grounded aircraft-days (overdue check) for the record.
  const grounded = Object.values(g.fleet).filter((ac) => ac.status !== 'delivering' && ac.status !== 'stored' && ac.status !== 'leasedOut' && isGrounded(g, ac)).length;
  if (grounded) {
    ops.grounded = [...(ops.grounded ?? []).filter((t) => t > g.now - 400 * DAY), ...Array<Minute>(grounded).fill(dayStart(g.now))];
  }
  if (!st.announced && g.now >= st.next - 28 * DAY && g.now < st.next) {
    st.announced = true;
    const r = auditRecord(g);
    pushMessage(g, {
      tone: 'info', cat: 'company', title: `${cap(authorityName(g))} audit on ${fmtDate(st.next)}`, cue: 'notice',
      body: `The yearly audit of our operation. They read the year: ${r.illegal} illegal duties, ${r.ramp.n} ramp inspections (${r.ramp.cats[2]} major findings), technical reliability ${r.tech.pct ?? '–'} %, ${r.grounded} grounded days. Company › Safety shows the record.`,
      ref: { kind: 'audit', id: 'next' },
    });
  }
  if (g.now >= st.next) runAudit(g);
  for (const f of st.findings) {
    if (f.closed) continue;
    if (f.ready !== undefined && f.ready <= g.now) {
      f.closed = g.now;
      countOps(g, 'auditClosed');
      pushMessage(g, { tone: 'good', cat: 'company', title: `Audit finding closed: ${f.text.toLowerCase()}`, body: `${f.task.label}: done. ${cap(authorityName(g))} accepted it.`, ref: { kind: 'audit', id: f.id } });
      continue;
    }
    if (!f.overdue && g.now > f.due) {
      f.overdue = true;
      countOps(g, 'auditOverdue');
      bumpReliable(g, f.level === 1 ? -4 : -2);
      const first = !st.suspended;
      st.suspended ??= g.now;
      pushMessage(g, {
        tone: 'bad', cat: 'company', title: `Audit deadline missed: ${f.text.toLowerCase()}`, cue: 'opsEmergency',
        body: `The Level ${f.level} finding was due ${fmtDate(f.due)}. ${first ? 'The authority suspends our approval work: nothing new is filed or granted on the Ladder until it is closed.' : 'Approvals stay suspended.'} Reliable name ${f.level === 1 ? '−4' : '−2'}.`,
        ref: { kind: 'audit', id: f.id }, problem: { kind: 'auditFinding', ref: { kind: 'audit', id: f.id } }, hurt: { money: f.task.cost, pax: 0, delayMin: 0, level: 'high' },
      });
    }
  }
  if (st.suspended && !st.findings.some((f) => f.overdue && !f.closed)) {
    st.suspended = null;
    pushMessage(g, { tone: 'good', cat: 'company', title: 'Approvals no longer suspended', body: 'Every overdue audit finding is closed. The Ladder is open again.', ref: { kind: 'audit', id: 'next' } });
  }
}

/** Dev: hold the audit now (or announce it). */
export function devAudit(g: GameState, announceOnly = false): void {
  const st = opsState(g).audit;
  if (announceOnly) {
    st.next = g.now + 28 * DAY;
    st.announced = false;
  } else st.next = g.now;
  dailyAudit(g);
}
