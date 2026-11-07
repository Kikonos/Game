// v0.18 why an offer can't be taken, most important first (the player: "if I don't have IOSA registration, then
// it's impossible ... if just some flights are in the way, the case is totally different and I can solve that").
//
// Every 'no' check of a feasibility report falls in one of three tiers:
//   0 'impossible'  nothing we can do in time: an approval we do not hold (IOSA, ETOPS, widebody: grants take months),
//                   the wrong aircraft (body, family, seats, range, runway, ETOPS certification, a cabin layout no
//                   refit gives), a closed airport or airspace, a lease that ends first, an aircraft sold, too far to
//                   get there in time, a crew that can't reach the first departure.
//   1 'work'        fixable but costly: a cabin or crew-rest refit, a C-check inside the job, no paint-shop or
//                   hangar slot, crew to hire.
//   2 'busy'        easily solved: some of our flights are in the way (move them to another aircraft or sub-lease
//                   them), and the lines that only follow from it ('Not planned: the aircraft is busy').
// 'warn' checks never block; they sort after every 'no' (tier 3), 'ok' last (tier 4). Pure.

import type { GameState } from '../core/types';
import type { FeasibilityCheck, FeasibilityReport } from './feasibility';
import { APPROVALS } from '../ops/company';
import { fmtDate } from '../core/time';

export type BlockTier = 0 | 1 | 2;
/** Sort rank of any check: its blocking tier, 3 for a warning, 4 when fine. */
export type CheckRank = BlockTier | 3 | 4;

export const TIER_WORD: Record<BlockTier, string> = { 0: 'Not possible', 1: 'Needs work first', 2: 'Flights in the way' };

/** Lines that only say the aircraft is busy (a consequence of flights in the way). */
const BUSY_RE = /^(Busy: |Can't be back for |Already leased out|Not planned: the aircraft is busy|Paint not planned: the aircraft is busy|Cabin change not planned: the aircraft is busy)/;

/**
 * The blocking tier of a 'no' check (see the header). With its report: an aircraft booked by a programme that has no
 * flights yet (a base season, a dry lease out) has nothing to move or sub-lease, so it needs work (tier 1). Pure.
 */
export function blockTier(c: FeasibilityCheck, r?: FeasibilityReport): BlockTier {
  if (BUSY_RE.test(c.label)) return r && !r.conflicts.flights.length && r.conflicts.programmes.length ? 1 : 2;
  switch (c.id) {
    case 'approvals': case 'etops': case 'body': case 'family': case 'seats': case 'range': case 'runway':
    case 'lease': case 'airspace': case 'mission': case 'warRisk': case 'clientCrew': case 'positioning': case 'crew':
      return 0;
    case 'availability':
      // Sold, too late to ferry out: final. A check booked inside the window can be moved.
      return /^(Sold|Too late)/.test(c.label) ? 0 : 1;
    case 'layout':
    case 'rest':
    case 'restSeats':
      // A refit gives the cabin or the rest seats; with no refit on offer the type cannot do it.
      return c.action ? 1 : 0;
    case 'cabinReq':
      return /has no such layout/.test(c.label) ? 0 : 1;
    default:
      // paint (no slot, or their livery is required), maintenance (C-check inside), dryLease (C-check due), others.
      return 1;
  }
}

/** The sort rank of any check. Pure. */
export const checkRank = (c: FeasibilityCheck, r?: FeasibilityReport): CheckRank => (c.level === 'no' ? blockTier(c, r) : c.level === 'warn' ? 3 : 4);

/** A report's checks, most important first (stable within a rank: the feasibility order). Pure. */
export function sortChecks(checks: readonly FeasibilityCheck[], r?: FeasibilityReport): FeasibilityCheck[] {
  return checks.map((c, i) => [c, i, checkRank(c, r)] as const).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map(([c]) => c);
}

/** The blocking checks of a report, most important first ([] when it can be taken). Pure. */
export const blockers = (r: FeasibilityReport): FeasibilityCheck[] => sortChecks(r.checks.filter((c) => c.level === 'no'), r);

/** The most important reason a report can't be taken (null: it can). Pure. */
export const topBlocker = (r: FeasibilityReport): FeasibilityCheck | null => blockers(r)[0] ?? null;

/** The worst tier of a report: 0–2 blocked, 3 only warnings, 4 fine. Pure. */
export function reportRank(r: FeasibilityReport): CheckRank {
  const top = topBlocker(r);
  if (top) return blockTier(top, r);
  return r.checks.some((c) => c.level === 'warn') ? 3 : 4;
}

/**
 * The report to lead with: the aircraft closest to taking the job. Fine before warnings before blocked; among blocked
 * ones, the least severe top reason (busy before needs work before impossible), then the fewest reasons, then the best
 * profit. Stable for equal reports (the fleet order). Pure.
 */
export function bestByRank(reports: readonly FeasibilityReport[]): FeasibilityReport | null {
  let best: FeasibilityReport | null = null;
  let bk = [0, 0, 0];
  for (const r of reports) {
    const rank = reportRank(r);
    // Higher rank number = closer to taking it (4 fine ... 0 impossible).
    const k = [rank, -blockers(r).length, r.estMargin];
    if (!best || k[0] > bk[0] || (k[0] === bk[0] && (k[1] > bk[1] || (k[1] === bk[1] && k[2] > bk[2])))) {
      best = r;
      bk = k;
    }
  }
  return best;
}

const APPROVAL_NAMES = APPROVALS.map((a) => ({ id: a.id, name: a.name }));
const lowerFirst = (t: string) => (/^[A-Z0-9]{2,}\b/.test(t) || /^[A-Z]{2}-/.test(t) ? t : t.charAt(0).toLowerCase() + t.slice(1));

/**
 * One plain reason for the headline: 'needs IOSA registration (we have none)', 'needs ETOPS 180 (filed, due 3 Mar
 * 2029)', else the check's own line. Pure.
 */
export function reasonText(g: GameState, c: FeasibilityCheck): string {
  if (c.id === 'approvals' && c.label.startsWith('Needs approval: ')) {
    const names = c.label.slice('Needs approval: '.length).split(', ');
    return names.map((n) => {
      const id = APPROVAL_NAMES.find((a) => a.name === n)?.id;
      const p = id ? g.company.pendingApprovals.find((x) => x.id === id) : undefined;
      return `needs ${n} (${p ? (p.waiting ? 'filed, waiting for what it needs first' : `filed, due ${fmtDate(p.done)}`) : 'we have none'})`;
    }).join('; ');
  }
  // 'Busy: Summer base at Faro (1 Jun–30 Sep)': the tier word already says it is in the way.
  return lowerFirst(c.label.replace(/^Busy: /, ''));
}

export interface OfferVerdict {
  /** 0–2 blocked (the tier), 3 only warnings, 4 fine. */
  rank: CheckRank;
  /** The report it speaks of. */
  report: FeasibilityReport;
  /** 'Not possible: needs IOSA registration (we have none)'. */
  headline: string;
  /** The other reasons, most important first (blocking ones, then warnings), each with its rank. */
  more: { check: FeasibilityCheck; rank: CheckRank }[];
}

/**
 * The offer's verdict over the aircraft offered (the dialog's headline and the Accept button's reason). A reason every
 * aircraft shares (an approval) is said once; the rest are the lead aircraft's. Null with no aircraft. Pure.
 */
export function offerVerdict(g: GameState, reports: readonly FeasibilityReport[], pick?: string | null): OfferVerdict | null {
  const chosen = pick ? reports.find((r) => r.aircraftId === pick) : undefined;
  const r = chosen ?? bestByRank(reports);
  if (!r) return null;
  const rank = reportRank(r);
  const sorted = sortChecks(r.checks.filter((c) => c.level !== 'ok'), r);
  const head = sorted[0];
  const reg = g.fleet[r.aircraftId]?.reg;
  // A busy line is about the aircraft: 'Flights in the way on CS-TQA: ...', 'Booked for other work: CS-TQA, ...'.
  const busy = !!head && BUSY_RE.test(head.label);
  const word = busy && rank === 1 ? 'Booked for other work' : TIER_WORD[rank as BlockTier];
  const on = busy && reg && !head.label.includes(reg) ? ` on ${reg}` : '';
  const headline = !head || rank === 4 ? 'Can be flown as it stands'
    : rank === 3 ? `Check before signing: ${lowerFirst(head.label)}`
    : `${word}${on}: ${reasonText(g, head)}`;
  return { rank, report: r, headline, more: sorted.slice(1).map((c) => ({ check: c, rank: checkRank(c, r) })) };
}
