// v0.17.2 bug report statuses: New → Sent (in an Export all) → Fixed (the version installed lists the id), so the
// player's exports carry only what matters. Fixed reports go 7 days after the update that fixed them.

import { describe, expect, it } from 'vitest';
import { FIXED_REPORTS, fixedIn, versionAtMost } from '../data/fixedReports';
import { CURRENT } from '../data/whatsNew';
import { exportFile, exportSelection, FIXED_KEEP_MS, fixedHousekeeping, fixedLine, markSent, parseBugsFile, reportStatus, type BugReport } from './bugReports';

const rep = (id: string, extra: Partial<BugReport> = {}): BugReport => ({
  id, createdAt: 1, title: id, what: '', expected: '', size: 0, snapshot: '',
  context: { version: 'v0.17.1', company: 'X', gameTime: '', gameTimeLocal: '', screen: { tab: 'map' }, inbox: [], settings: {}, device: { viewport: '1×1', dpr: 1, ua: '' } } as never,
  ...extra,
});

describe('v0.17.2 bug report status', () => {
  it('the player\'s eight reports are listed as fixed, with the version and a line', () => {
    for (const id of ['bmw43m7ejicd6', 'bmw441ihle8id', 'bmw44a4117o4o', 'bmw44mdbp2mte', 'bmw44wenpden7']) expect(FIXED_REPORTS[id].version).toBe('v0.16.4');
    for (const id of ['bmw5r4e4p6hpq', 'bmw5r8e3ggrqs', 'bmw6lnjpzbdkk']) expect(FIXED_REPORTS[id].version).toBe('v0.17.2');
    expect(versionAtMost('v0.16.4', 'v0.17')).toBe(true);
    expect(versionAtMost('v0.17.2', 'v0.17.1')).toBe(false);
    expect(versionAtMost('v0.17', 'v0.17.0')).toBe(true);
    // A fix in a later version than the one installed is not shown yet.
    expect(fixedIn('bmw5r4e4p6hpq', 'v0.17.1')).toBeNull();
    expect(fixedIn('bmw5r4e4p6hpq', CURRENT.version)?.version).toBe('v0.17.2');
    expect(fixedLine('bmw6lnjpzbdkk')).toMatch(/^Fixed in v0\.17\.2: the check dialog/);
  });

  it('New → Sent → Fixed', () => {
    const r = rep('bnew1');
    expect(reportStatus(r)).toBe('new');
    const s = markSent(r, 1000);
    expect(reportStatus(s)).toBe('sent');
    expect(markSent(s, 2000).sentAt).toBe(1000);
    expect(reportStatus(rep('bmw44mdbp2mte'))).toBe('fixed');
    expect(reportStatus(rep('bmw44mdbp2mte', { status: 'sent' }))).toBe('fixed');
  });

  it('Export all takes the new reports (and the sent ones on request) and names the skipped ids in its header', () => {
    const list = [rep('bnew1'), rep('bsent1', { status: 'sent' }), rep('bmw5r8e3ggrqs', { status: 'sent' })];
    const a = exportSelection(list, false);
    expect(a.take.map((r) => r.id)).toEqual(['bnew1']);
    expect(a.skipped).toEqual([{ id: 'bsent1', status: 'sent' }, { id: 'bmw5r8e3ggrqs', status: 'fixed' }]);
    const b = exportSelection(list, true);
    expect(b.take.map((r) => r.id)).toEqual(['bnew1', 'bsent1']);
    const f = parseBugsFile(exportFile(a.take, null, new Date(0), a.skipped));
    expect(f.reports.map((r) => r.id)).toEqual(['bnew1']);
    expect(f.skipped).toEqual(a.skipped);
    expect(parseBugsFile(exportFile(a.take, null, new Date(0))).skipped).toBeUndefined();
  });

  it('fixed reports are marked when first seen and go 7 days later', () => {
    const now = 10 * FIXED_KEEP_MS;
    const list = [rep('bnew1'), rep('bmw43m7ejicd6'), rep('bmw441ihle8id', { fixedSeenAt: now - FIXED_KEEP_MS + 1 }), rep('bmw44a4117o4o', { fixedSeenAt: now - FIXED_KEEP_MS })];
    expect(fixedHousekeeping(list, now)).toEqual({ mark: ['bmw43m7ejicd6'], remove: ['bmw44a4117o4o'] });
  });
});
