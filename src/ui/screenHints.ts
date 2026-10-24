// v0.9 §14.2 first-time hints per screen: one gentle card the first time a screen opens, written for someone who has
// worked ACMI (no welcome, no explaining the job). 'Got it' hides it for this session; 'Don't show again' is saved
// (Settings › First-time hints › Show again brings them all back).

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

/** Hidden for this session ('Got it'); not saved. */
const sessionHidden = new Set<ScreenHintId>();
export const hiddenThisSession = (id: ScreenHintId) => sessionHidden.has(id);
export const hideForSession = (id: ScreenHintId) => void sessionHidden.add(id);
