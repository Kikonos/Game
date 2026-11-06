// v0.17 requests for proposals (UPDATE-0.17.md §D; lane `deals`): we ask lessors for a type, age, term, start and
// count; each answers on its own day. Step 0: none can be sent.

import type { ActionResult, AgeBand, GameState, LessorId, Minute } from '../core/types';

export interface RfpDraft {
  typeId: string;
  band: AgeBand;
  months: number;
  count: 1 | 2 | 3;
  /** Wanted handover; null = as soon as possible. */
  from: Minute | null;
  flex: boolean;
}

/** The request dialog's lines before sending (§D.1, §N.3). */
export interface RfpPreview {
  lessors: { id: LessorId; name: string; ok: boolean; why?: string }[];
  goesTo: number;
  wontConsider: number;
  /** Days to the answers, [first, last]. */
  replyDays: [number, number];
  /** 'Goes to 7 lessors · 3 won't consider us yet (rating C) · answers in 1–2 weeks'. */
  text: string;
  /** Why it can't be sent (too many open, scenario lock, the type's gate). */
  blocked: string | null;
  /** 'New type for our AOC: the variation takes 90 days'. */
  aocNote?: string;
  /** 'Fleet average age would be 19.4: the majors ask 18 or less'. */
  ageWarning?: string;
}

/** Step 0: nothing to send to. Pure. */
export function rfpPreview(g: GameState, d: RfpDraft): RfpPreview {
  void g;
  void d;
  return { lessors: [], goesTo: 0, wontConsider: 0, replyDays: [0, 0], text: '', blocked: 'Requests to lessors are not open yet' };
}

/** Sends a request to every lessor that leases that family and age (§D.1). Step 0: refused. */
export function sendRfp(g: GameState, d: RfpDraft): ActionResult<{ rfpId: string }> {
  return { ok: false, error: rfpPreview(g, d).blocked ?? 'Not open yet' };
}

/** Withdraws an open request. Step 0: none exist. */
export function withdrawRfp(g: GameState, rfpId: string): ActionResult {
  void g;
  void rfpId;
  return { ok: false, error: 'Request not found' };
}

/** Daily: answers due today (§D.2–§D.3), the summary message. Step 0: nothing. */
export function dailyRfps(g: GameState): void {
  void g;
}
