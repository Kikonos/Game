// Approvals and policies (B3). DESIGN.md §5.11.

import { describe, expect, it } from 'vitest';
import { DAY } from '../core/time';
import type { ApprovalId, HotelTier, Policies } from '../core/types';
import { addAircraft, newGame } from '../contracts/testkit';
import { advanceTo } from '../sim';
import { APPROVALS, applyApproval, approvalBlocker, setPolicies } from '.';

describe('approvals', () => {
  it('match DESIGN §5.11 costs, times and prerequisites', () => {
    const rows = APPROVALS.map((a) => [a.id, a.cost, a.days, a.requires.join('+')]);
    expect(rows).toEqual([
      ['etops120', 250_000, 180, ''], ['etops180', 350_000, 365, 'etops120'], ['augmented', 300_000, 60, ''],
      ['ulr', 900_000, 270, 'augmented+etops180'], ['iosa', 180_000, 240, ''], ['dg', 60_000, 60, ''],
    ]);
  });

  it('blockers: prerequisites, fleet capability, tenure, cash, already held or in progress', () => {
    const g = newGame(33);
    expect(approvalBlocker(g, 'etops120')).toBeNull();
    expect(approvalBlocker(g, 'dg')).toBeNull();
    expect(approvalBlocker(g, 'augmented')).toBeNull();
    expect(approvalBlocker(g, 'etops180')).toBe('Needs ETOPS 120 first');
    expect(approvalBlocker(g, 'ulr')).toBe('Needs Augmented crew ops and ETOPS 180 first');
    expect(approvalBlocker(g, 'iosa')).toBe('Needs 12 months of operations');
    expect(approvalBlocker(g, 'nope' as ApprovalId)).toBe('Unknown approval');
    g.company.approvals.push('etops120', 'augmented');
    expect(approvalBlocker(g, 'etops120')).toBe('Already held');
    expect(approvalBlocker(g, 'etops180')).toBe('Needs a twin capable of ETOPS 180');
    addAircraft(g, 'b763');
    expect(approvalBlocker(g, 'etops180')).toBeNull();
    g.company.approvals.push('etops180');
    expect(approvalBlocker(g, 'ulr')).toBe('Needs a ULR-capable aircraft');
    addAircraft(g, 'b77l');
    expect(approvalBlocker(g, 'ulr')).toBeNull();
    g.now = g.started + 365 * DAY;
    expect(approvalBlocker(g, 'iosa')).toBeNull();
    g.company.cash = 100_000;
    expect(approvalBlocker(g, 'iosa')).toBe('Costs $180K');
    expect(approvalBlocker(g, 'ulr')).toBe('Costs $900K');
    expect(applyApproval(g, 'ulr')).toEqual({ ok: false, error: 'Costs $900K' });
  });

  it('applyApproval pays now, shows as pending, and approval.done grants it', () => {
    const g = newGame(34);
    const cash = g.company.cash;
    const r = applyApproval(g, 'augmented');
    expect(r.ok).toBe(true);
    expect(g.company.cash).toBe(cash - 300_000);
    expect(g.finance.current.lines.approvals).toBe(-300_000);
    expect(g.company.pendingApprovals).toEqual([{ id: 'augmented', started: g.now, done: g.now + 60 * DAY, cost: 300_000 }]);
    expect(approvalBlocker(g, 'augmented')).toBe('In progress');
    expect(applyApproval(g, 'augmented').ok).toBe(false);
    expect(g.messages[0].title).toBe('Augmented crew ops: application filed');
    advanceTo(g, g.now + 59 * DAY, new Set());
    expect(g.company.approvals).not.toContain('augmented');
    advanceTo(g, g.now + 2 * DAY, new Set());
    expect(g.company.approvals).toContain('augmented');
    expect(g.company.pendingApprovals).toHaveLength(0);
    expect(approvalBlocker(g, 'augmented')).toBe('Already held');
    expect(g.messages.some((m) => m.cat === 'company' && m.title === 'Augmented crew ops approved')).toBe(true);
    // Paid once: the approvals line is unchanged after the grant.
    expect([g.finance.current, ...g.finance.history].reduce((s, st) => s + (st.lines.approvals ?? 0), 0)).toBe(-300_000);
  });
});

describe('policies', () => {
  it('setPolicies clamps every field to its range', () => {
    const g = newGame(35);
    expect(setPolicies(g, { perDiemPct: 300, extraCabin: 5.4, hotelTier: 7 as HotelTier, rotationWeeks: 9 as Policies['rotationWeeks'] }).ok).toBe(true);
    expect(g.company.policies).toMatchObject({ perDiemPct: 150, extraCabin: 2, hotelTier: 4, rotationWeeks: 5 });
    setPolicies(g, { perDiemPct: 10, extraCabin: -1, hotelTier: 5, rotationWeeks: 4, autoRoster: false, allowTight: true });
    expect(g.company.policies).toMatchObject({ perDiemPct: 80, extraCabin: 0, hotelTier: 5, rotationWeeks: 4, autoRoster: false, allowTight: true, autoMaintenance: true, autoDeadhead: true });
    setPolicies(g, { perDiemPct: 112.6 });
    expect(g.company.policies.perDiemPct).toBe(113);
  });
});
