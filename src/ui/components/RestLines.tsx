// v0.7.3 the airframe's in-flight rest in player words (UPDATE-0.7.3.md §2.6 items 1–2): 'Pilots rest' and
// 'Cabin crew rest' with the glossary term of the facility, and the longest day it allows. Fleet card rows, the
// Market two-liner (also in the AcquireModal), the refit modal's 'today' box.

import type { ReactNode } from 'react';
import type { TermId } from '../../data/glossary';
import type { AcRest, GameState, RestFacility } from '../../engine/core/types';
import { longestDay, restShort, restText } from '../../engine/crew';
import { Term } from './Term';

/** The glossary term behind a facility (business seats: class 2 or 3 as fitted). */
export function restTerm(f: RestFacility | null): TermId {
  if (!f) return 'crewRest';
  if (f.kind === 'jSeats') return 'jSeats';
  return f.kind;
}

/** 'business seats' / 'economy seats' / 'recliner seats' for the seats taken out of sale on rest flights, null without seat rest. */
export function restSeatWord(rest: AcRest): string | null {
  const ks = [rest.fc, rest.cc].filter((f) => f && (f.kind === 'jSeats' || f.kind === 'recliners' || f.kind === 'ySeats')).map((f) => f!.kind);
  if (!ks.length) return null;
  if (new Set(ks).size > 1) return 'seats';
  return ks[0] === 'jSeats' ? 'business seats' : ks[0] === 'ySeats' ? 'economy seats' : 'recliner seats';
}

/** '13 h · up to 17 h' (v0.7.4: the 'Longest day: ' head dropped; the details are in the term's popover). */
export const longestText = (g: GameState, rest: AcRest, typeId: string) => longestDay(g, rest, typeId).text.replace(/^Longest day: /, '');

/** Fleet card KV rows: Pilots rest · Cabin crew rest · Longest day. */
export function restRows(g: GameState, rest: AcRest, typeId: string): [ReactNode, string][] {
  return [
    [<Term key="fc" id={restTerm(rest.fc)}>Pilots rest</Term>, restText(rest.fc, 'fc', typeId)],
    [<Term key="cc" id={restTerm(rest.cc)}>Cabin crew rest</Term>, restText(rest.cc, 'cc', typeId)],
    [<Term key="ld" id="longestDay" extra={longestDay(g, rest, typeId).detail}>Longest day</Term>, longestText(g, rest, typeId)],
  ];
}

/** Market / acquire two-liner: 'Pilots rest: bunks (class 1) · Cabin crew rest: …' and the longest day. */
export function RestTwoLiner({ g, rest, typeId }: { g: GameState; rest: AcRest; typeId: string }) {
  return (
    <div className="mk-rest">
      <span className="muted">Pilots rest: <b>{restShort(rest.fc)}</b> · Cabin crew rest: <b>{restShort(rest.cc)}</b></span>
      <span className="dim"><Term id="longestDay" extra={longestDay(g, rest, typeId).detail}>Longest day</Term>: {longestText(g, rest, typeId)}</span>
    </div>
  );
}
