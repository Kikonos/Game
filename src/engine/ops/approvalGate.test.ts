// v0.12.1 approvals at departure: a leg that needs an approval we don't hold does not fly (sub-charter by default,
// else cancelled, our fault); the card and the decision ahead of time; the Ladder's at-risk line; ferries exempt.

import { describe, expect, it } from 'vitest';
import { addFlight } from '../core/entities';
import { blockMinutes } from '../core/perf';
import { DAY } from '../core/time';
import type { GameState, PendingApproval } from '../core/types';
import { run } from '../contracts/testkit';
import { fixtureContract, fixtureGame } from '../crew/fixtures';
import { devAddType } from '../dev';
import { problems } from '../problems';
import { atRiskLine, dailyApprovalGate, gateMisses, legApprovals, noApprovalAtGate } from './approvalGate';
import { resolveDecision } from './events';

type State = 'waiting' | 'late' | 'due' | 'held';

/** An A330-200 at Zagreb with a Croatia-style ZAG–HRG–ZAG job in 3 days; Widebody operations as `state` says. */
function setup(state: State) {
  const g = fixtureGame();
  g.company.cash = 50_000_000;
  const acId = devAddType(g, 'a332');
  g.company.approvals = g.company.approvals.filter((a) => a !== 'widebody');
  const p: PendingApproval = { id: 'widebody', started: g.now - 130 * DAY, done: g.now + 30 * DAY, cost: 300_000 };
  if (state === 'waiting') g.company.pendingApprovals.push({ ...p, done: g.now - DAY, waiting: 'Needs 4 A330 captains rated (2 now)' });
  else if (state === 'late') g.company.pendingApprovals.push(p);
  else if (state === 'due') g.company.pendingApprovals.push({ ...p, done: g.now + DAY });
  else g.company.approvals.push('widebody');
  const ac = g.fleet[acId];
  ac.at = 'ZAG';
  const std = Math.ceil((g.now + 3 * DAY) / 60) * 60;
  const blk = blockMinutes(ac.typeId, 'ZAG', 'HRG');
  const clientId = Object.keys(g.clients)[0];
  const k = fixtureContract(g, {
    aircraftIds: [acId], clientId, start: std - DAY, end: std + 5 * DAY, archetype: 'adhoc', pattern: { kind: 'legs', legs: [] },
    penalties: { cancelScale: [], perDelay: 0, perCancelledLeg: 20_000 },
  });
  const f1 = addFlight(g, { no: 'OU2000', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'ZAG', to: 'HRG', std, sta: std + blk, pax: 250 });
  const f2 = addFlight(g, { no: 'OU2001', aircraftId: acId, contractId: k.id, kind: 'revenue', from: 'HRG', to: 'ZAG', std: std + blk + 60, sta: std + 2 * blk + 60, pax: 250 });
  return { g, ac, k, f1, f2, client: g.clients[clientId].name };
}

const penalties = (g: GameState) => g.finance.current.lines.penalties ?? 0;

describe('v0.12.1 approvals at departure', () => {
  it('what a leg needs: the type’s Ladder gate and the route’s ETOPS; nothing for a narrowbody or a ferry', () => {
    const { g, ac, f1 } = setup('held');
    expect(legApprovals(g, f1)).toEqual(['widebody']);
    const atl = addFlight(g, { no: 'AW9', aircraftId: ac.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'GRU', std: f1.std + 3 * DAY, sta: f1.std + 3 * DAY + 600, pax: 200 });
    expect(legApprovals(g, atl)).toEqual(['widebody', 'etops120']);
    expect(gateMisses(g, atl).map((m) => [m.id, m.state])).toEqual([['etops120', 'missing']]);
    const ferry = addFlight(g, { no: 'AW8', aircraftId: ac.id, contractId: null, kind: 'ferry', from: 'ZAG', to: 'LIS', std: f1.std + 6 * DAY, sta: f1.std + 6 * DAY + 200 });
    ferry.purpose = 'delivery';
    expect(legApprovals(g, ferry)).toEqual([]);
    const nb = Object.values(g.fleet).find((a) => a.typeId.startsWith('a320'))!;
    const leg = addFlight(g, { no: 'AW7', aircraftId: nb.id, contractId: null, kind: 'revenue', from: 'LIS', to: 'FAO', std: f1.std, sta: f1.std + 50, pax: 150 });
    expect(legApprovals(g, leg)).toEqual([]);
  });

  it('held, or granted before the day: no card, it flies', () => {
    for (const s of ['held', 'due'] as const) {
      const { g, f1 } = setup(s);
      expect(gateMisses(g, f1)).toEqual([]);
      expect(problems(g).some((c) => c.subject.kind === 'approvalLate')).toBe(false);
    }
  });

  it('stuck waiting: a red four-line card ahead of time, the Ladder names the job at risk, and one decision', () => {
    const { g, f1, client } = setup('waiting');
    const card = problems(g).find((c) => c.subject.kind === 'approvalLate')!;
    expect(card.severity).toBe('red');
    expect(card.what).toBe('OU2000 can\'t fly without Widebody operations');
    expect(card.why).toMatch(/^Widebody operations is stuck: the authority waits for rated pilots \(needs 4 A330 captains rated/);
    expect(card.hurt.money).toBe(40_000);
    expect(card.hurt.pax).toBe(500);
    expect(card.actions.map((a) => a.id)).toEqual(['subcharter', 'swap', 'ladder']);
    expect(atRiskLine(g, 'widebody')).toMatch(new RegExp(`^At risk: ${client}, 2 legs from `));
    dailyApprovalGate(g);
    const d = g.decisions.find((x) => x.kind === 'approvalLate')!;
    expect(d.options.map((o) => o.id)).toEqual(['wait', 'subcharter', 'cancel']);
    expect(d.defaultOption).toBe('wait');
    expect(problems(g).find((c) => c.subject.kind === 'approvalLate')!.actions[0].id).toBe('decision');
    // Once a week per job.
    dailyApprovalGate(g);
    expect(g.decisions.filter((x) => x.kind === 'approvalLate')).toHaveLength(1);
    expect(f1.status).toBe('scheduled');
  });

  it('due after the job starts: an amber card days ahead', () => {
    const { g } = setup('late');
    const card = problems(g).find((c) => c.subject.kind === 'approvalLate')!;
    expect(card.severity).toBe('amber');
    expect(card.why).toMatch(/^Widebody operations is due .+, after OU2000 leaves on /);
  });

  it('the decision: cancel is our fault (compensation, reliability falls)', () => {
    const { g, f1, f2 } = setup('waiting');
    dailyApprovalGate(g);
    const d = g.decisions.find((x) => x.kind === 'approvalLate')!;
    const rel = g.company.reputation.reliable;
    const p0 = penalties(g);
    expect(resolveDecision(g, d.id, 'cancel').ok).toBe(true);
    expect([f1.status, f2.status]).toEqual(['cancelled', 'cancelled']);
    expect(p0 - penalties(g)).toBe(40_000);
    expect(g.company.reputation.reliable).toBeLessThan(rel);
  });

  it('the decision: sub-charter hands the legs to a rival at our cost', () => {
    const { g, f1, f2 } = setup('waiting');
    dailyApprovalGate(g);
    const d = g.decisions.find((x) => x.kind === 'approvalLate')!;
    const sub = g.finance.current.lines.subcharter ?? 0;
    expect(resolveDecision(g, d.id, 'subcharter').ok).toBe(true);
    expect(f1.operatedBy && f2.operatedBy).toBeTruthy();
    expect(g.finance.current.lines.subcharter ?? 0).toBeLessThan(sub);
  });

  it('at the gate, by default: a rival flies it; with no rival it is cancelled, our fault', () => {
    const a = setup('waiting');
    run(a.g, a.f1.std + 90);
    expect(a.f1.operatedBy).toBeTruthy();
    expect(a.f1.status).not.toBe('enroute');
    expect(a.g.stats.gateStopped).toBeGreaterThanOrEqual(1);
    expect(a.g.messages.some((m) => /^OU2000 sub-chartered.*: no Widebody operations$/.test(m.title))).toBe(true);

    const b = setup('waiting');
    b.g.rivals = [];
    const p0 = penalties(b.g);
    const rel = b.g.company.reputation.reliable;
    expect(noApprovalAtGate(b.g, b.f1, b.ac)).toBe(true);
    expect([b.f1.status, b.f2.status]).toEqual(['cancelled', 'cancelled']);
    expect(p0 - penalties(b.g)).toBe(40_000);
    expect(b.g.company.reputation.reliable).toBeLessThan(rel);
    expect(b.g.messages[0].title).toBe('OU2000 cancelled with 1 more: no Widebody operations');
    expect(b.g.messages[0].body).toMatch(/Our fault: compensation \$40K, reliability falls\./);
  });

  it('held at the gate: it leaves as before (nothing stopped)', () => {
    const { g, ac, f1 } = setup('held');
    expect(noApprovalAtGate(g, f1, ac)).toBe(false);
    expect(g.stats.gateStopped ?? 0).toBe(0);
  });

  it('an empty positioning leg days before its job waits for the grant instead', () => {
    const { g, ac, f1 } = setup('late');
    const pos = addFlight(g, { no: 'AW1P', aircraftId: ac.id, contractId: f1.contractId, kind: 'positioning', from: 'ZAG', to: 'ZAG', std: f1.std - 4 * DAY, sta: f1.std - 4 * DAY + 60 });
    const std0 = pos.std;
    g.now = pos.std;
    expect(noApprovalAtGate(g, pos, ac)).toBe(true);
    expect(pos.status).toBe('scheduled');
    expect(pos.std).toBeGreaterThan(std0);
    expect(f1.status).toBe('scheduled');
  });
});
