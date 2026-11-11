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
  bmw7ok0qk9kju: { version: 'v0.18.1', what: 'the 14 h rest is the EASA minimum after crossing 4+ time zones; the trip now shows the layover and why, check-in, departure and arrival in local time, and the boarding passes on a deadhead day.' },
  bmw7oluxn4np: { version: 'v0.18.1', what: 'leave comes from a yearly allowance (30 days in Portugal), asked for in blocks of one to two weeks and approved by your rules or by you in Crew › Leave.' },
  bmw7oqp9afm2l: { version: 'v0.18.1', what: 'the roster comes out on the 15th for the whole next month; until then the month reads "Roster out on 15 …".' },
  bmw7ov4ikfs1o: { version: 'v0.18.1', what: 'flown duties keep their flights and numbers on the calendar; older ones show their sectors and block.' },
  bmw7p4brbit4x: { version: 'v0.18.1', what: 'the Ladder cards have room, three calm parts and a gauge for what they still need.' },
  bmw7p747salao: { version: 'v0.18.1', what: 'Return early and the other aircraft actions sit in two even rows; no empty space beside a leased-out aircraft.' },
  bmw8f0f2wfmde: { version: 'v0.18.3', what: 'annual leave starts and ends at home: crew on a tour fly home before their leave, and back out after it if the tour still needs them.' },
  bmw8f32wu6dbb: { version: 'v0.18.3', what: '"Days off" only lowers morale when a month falls below the legal minimum; a day off moved is "Day off moved"; days off at a hotel no longer count against morale, and annual leave lifts morale for a few months.' },
  bmw8fl4ddjfay: { version: 'v0.18.3', what: 'the spare captain and purser at a far base stand by at the hotel instead of flying, and a short day flies with two pilots; the flight sheet lists the flight crew first.' },
  bmw8gfbgud6o6: { version: 'v0.18.3', what: 'a delay that broke one flight\'s in-flight rest plan no longer raises "crew out of hours" on the set\'s later flights; the Details list stays inside its card.' },
  bmwalwl3kkqo9: { version: 'v0.19.5', what: 'the range circles are a globe again, zoomed to the range: the whole range fits inside the circle, with no blank band and no boundary running off the edge.' },
  bmwbiobsokzf4: { version: 'v0.21', what: 'a stop can now be a real stopover: some passengers get off, others get on, others stay on. Build your own route shows "Fuel stop only" and "Stopover" side by side with the pros and cons, and a fuel stop can be turned into a stopover.' },
  bmwbir591j4cw: { version: 'v0.21', what: 'Network › Studies lists every study (under way, shelved, launched, run out). A market with a study still good shows "Show study" and a grey "Valid until" instead of a new paid study.' },
  bmwbjlg2n93bp: { version: 'v0.21', what: 'the business case opens with Worth it / Marginal / Not worth it and why, new pictures (money from revenue to result, load against break-even, margin scale), the analyst\'s suggestions with Apply, a network planner to hire, and small "?" marks that answer your questions on tap. Margins were checked against real airlines.' },
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
