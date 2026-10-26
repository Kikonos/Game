// v0.9 §14.2 first-time hints per screen: one gentle card the first time a screen opens, written for someone who has
// worked ACMI (no welcome, no explaining the job). v0.12: once seen ('Got it', or the screen left after the hint showed)
// it folds into the screen's '?' button, where a tap shows it again; 'Don't show again' removes it, '?' and all (both
// saved; Settings › First-time hints › Show again brings them all back).

export type ScreenHintId =
  | 'map' | 'contracts' | 'offer' | 'schedule' | 'crewPeople' | 'crewBoard' | 'crewPlan' | 'fleet' | 'finance' | 'company' | 'team'
  | 'inbox' | 'crewControl';

export const SCREEN_HINTS: Record<ScreenHintId, string> = {
  map: 'Live ops. Tap an aircraft for its duty, crew and next legs; pins are open offers. Amber and red in the top bar is what needs you.',
  contracts: 'Offers expire and a rival may take them first. Wet offers pay per block hour against an MGH; charters are all-in and you pay the fuel. The light on each card is the planner’s verdict for your best aircraft.',
  offer: 'Pick the aircraft, read the red and amber lines, then accept, counter or let it go. A counter costs time: urgent clients answer in hours, others in a day or two.',
  schedule: 'One row per aircraft. Hatched is positioning, striped is maintenance, faint is idle. Tap a block for its sheet; drag a trip onto another row to swap aircraft.',
  crewPeople: 'Each person’s limits as fuel gauges, the next 14 days and this month’s days off against the 7 minimum.',
  crewBoard: 'OFF days are published 14 days ahead and protected; SBY, ASBY and RES are your standby pool. Drag to swap; red is illegal.',
  crewPlan: 'Crew sets per type. Round up hires exactly what completes them.',
  fleet: 'Each card shows the checks, the cabin, the crew rest and the longest legal day. The Market tab sells and leases aircraft: few at a time, long lead times.',
  finance: 'Revenue lands as legs fly; governments pay late. The forecast line is cash, not profit.',
  company: 'Reputation, approvals and policies. Team and Achievements are next door.',
  team: 'Department heads are earned, not bought. Each takes routine work off your desk, makes the odd mistake, and can be switched off.',
  inbox: 'Decisions sit on top. Each problem has a four-line card: what, why, does it hurt, what you can do.',
  crewControl: 'Every way to crew this flight, cheapest and quickest first. Standby call-outs come first: no overtime.',
};

/** v0.12 how a screen's hint shows: the full strip (first time), folded into the '?' button, or not at all. */
export type HintMode = 'strip' | 'fold' | 'off';

/** v0.12 the hint's mode from the saved lists ('Don't show again' wins; seen once → folded). Pure. */
export function hintMode(id: ScreenHintId, s: { screenHintsSeen: readonly string[]; screenHintsFolded?: readonly string[] }): HintMode {
  if (s.screenHintsSeen.includes(id)) return 'off';
  if (hiddenThisSession(id) || s.screenHintsFolded?.includes(id)) return 'fold';
  return 'strip';
}

/** v0.12 the folded list with this hint added (unchanged when it is already there). Pure. */
export const foldHint = (folded: readonly string[] | undefined, id: ScreenHintId): string[] => (folded?.includes(id) ? [...folded] : [...(folded ?? []), id]);

/** A strip shown at least this long (real ms) counts as seen when its screen closes. */
export const HINT_SEEN_MS = 1500;

/** Hidden for this session; not saved (v0.12: folded into '?' instead of hidden). */
const sessionHidden = new Set<ScreenHintId>();
export const hiddenThisSession = (id: ScreenHintId) => sessionHidden.has(id);
export const hideForSession = (id: ScreenHintId) => void sessionHidden.add(id);
