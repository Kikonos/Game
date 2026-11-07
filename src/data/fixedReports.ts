// v0.17.2 the player's bug reports we have fixed, by report id (Menu › Bug reports: the id each report was saved with,
// as the export carries it): the version that fixed it and what we did, in a line. A report whose fix is in the
// version installed reads "Fixed in v0.17.2: …" in the list, is left out of the next Export all, and is deleted from
// the device 7 days later (or at once with Delete fixed). scripts/bugs.ts marks these as known.

export interface FixedReport {
  /** As What's new shows it: 'v0.17.2'. */
  version: string;
  /** What we did, one plain line. */
  what: string;
}

export const FIXED_REPORTS: Record<string, FixedReport> = {
  bmw43m7ejicd6: { version: 'v0.16.4', what: 'an offer for an A320-size aircraft only lets you pick aircraft of that size, not the A330.' },
  bmw441ihle8id: { version: 'v0.16.4', what: 'the in-flight rest plan covers only the flight it is for, not an earlier leg in the same duty.' },
  bmw44a4117o4o: { version: 'v0.16.4', what: 'standby no longer counts against morale, and the resignation line reads properly.' },
  bmw44mdbp2mte: { version: 'v0.16.4', what: 'a short flight gets two pilots; extra pilots only when the day needs them.' },
  bmw44wenpden7: { version: 'v0.16.4', what: 'an aircraft left away from home gets a ferry and a crew to bring it back.' },
  bmw5r4e4p6hpq: { version: 'v0.17.2', what: 'crew ride our own empty legs home (straight on from the gate, or after their rest) instead of an airline ticket.' },
  bmw5r8e3ggrqs: { version: 'v0.17.2', what: 'crew stay on a long-term base for the whole rotation you set; leave is moved after it, and only a real limit or reason sends them home early.' },
  bmw6lnjpzbdkk: { version: 'v0.17.2', what: 'the check dialog says when the aircraft goes back (with the year), lets you book a C-check due before that, and near a return weighs the ways with costs and a recommendation.' },
};

/** 'v0.17.2' → [0, 17, 2]. Pure. */
const parts = (v: string): number[] => v.replace(/^v/, '').split('.').map((x) => Number(x) || 0);

/** a ≤ b for versions 'v0.16.4' / 'v0.17'. Pure. */
export function versionAtMost(a: string, b: string): boolean {
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d < 0;
  }
  return true;
}

/** The fix for report `id` when it is in version `installed` (else null). Pure. */
export function fixedIn(id: string, installed: string): FixedReport | null {
  const f = FIXED_REPORTS[id];
  return f && versionAtMost(f.version, installed) ? f : null;
}
