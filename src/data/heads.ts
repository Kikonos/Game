// v0.9 department heads (UPDATE-0.9.md §5.1): who they are, what earns them, what they do and never do. Player words.

import type { HeadId } from '../engine/core/types';

export interface HeadDef {
  id: HeadId;
  title: string;
  /** lucide icon name. */
  icon: string;
  /** What earns the hire (the locked row and the unlock card). */
  unlockText: string;
  /** One line for the celebration card ("25 sectors in a row, all with legal crews"). */
  earnedText: string;
  does: string[];
  never: string[];
  /** Candidate one-liners (rolled at unlock). */
  blurbs: string[];
}

export const HEAD_IDS: HeadId[] = ['opsControl', 'crewDesk', 'analyst', 'credit', 'fleetPlanner', 'maintPlanner', 'watch'];

export const HEAD_DEFS: Record<HeadId, HeadDef> = {
  opsControl: {
    id: 'opsControl', title: 'Ops Control duty manager', icon: 'Radio',
    unlockText: '25 revenue sectors in a row with a legal crew', earnedText: '25 sectors in a row, all with legal crews',
    does: ['Calls in a replacement for a sick call', 'Takes a short delay at the gate when a legal crew is ready within your limit'],
    never: ['Sub-charter or cancel', "Use captain's discretion", 'Decide AOGs or closed airspace', 'Delay beyond your limit'],
    blurbs: ['Ten years in an IOCC; calm on the phone at 3 a.m.', 'Ex-dispatcher, knows every handling agent by name', 'Ran the night desk for a charter airline'],
  },
  maintPlanner: {
    id: 'maintPlanner', title: 'Maintenance planner', icon: 'Wrench',
    unlockText: 'A C-check completed before it was due', earnedText: 'Your first heavy check, finished on time',
    does: ['Books A-checks into maintenance nights and gaps', 'Moves a booked A-check when a clash appears', 'Proposes the best C-check slot'],
    never: ['Book a C-check, a refit or a check that cancels revenue legs'],
    blurbs: ['CAMO background, reads an AMP like a novel', 'Line maintenance controller turned planner', 'Ex-MRO slot planner; knows the hangars'],
  },
  crewDesk: {
    id: 'crewDesk', title: 'Crew scheduling desk', icon: 'CalendarCheck',
    unlockText: '2 months in a row with at least 98 % crew coverage', earnedText: 'Two months with every seat filled',
    does: ['Repairs the roster after disruptions (auto-fix, deadhead, call-in) within a cost limit', 'Re-plans standby and days off after disruptions', 'Proposes round-up hires'],
    never: ['Charter a private jet above your limit', 'Sub-charter or cancel', 'Swap crews between contracts'],
    blurbs: ['Two schedulers from a big ACMI operator', 'A crewing pair who rostered a Hajj season', 'Crew control veterans from a leisure airline'],
  },
  analyst: {
    id: 'analyst', title: 'Commercial analyst', icon: 'LineChart',
    unlockText: '5 contracts completed', earnedText: 'Five contracts flown',
    does: ['Scores every open offer against your fleet', 'Suggests a counter-price'],
    never: ['Accept, decline or counter for you'],
    blurbs: ['Former broker; knows what clients really pay', 'Network planner with a feel for yields', 'Ex-lessor analyst, quick with a margin'],
  },
  credit: {
    id: 'credit', title: 'Credit controller', icon: 'Receipt',
    unlockText: 'The first late government payment collected', earnedText: 'They paid in the end',
    does: ['Chases late payers with reminders', 'Answers a late payment with wait or waive by your rule', 'Asks slow payers for a deposit on new charters'],
    never: ['Threaten, sell invoices or sue'],
    blurbs: ['Collected from three ministries without a raised voice', 'Airline finance, patient and persistent', 'Ex-bank, good at polite reminders'],
  },
  fleetPlanner: {
    id: 'fleetPlanner', title: 'Fleet & positioning planner', icon: 'Route',
    unlockText: 'The first widebody joins the fleet', earnedText: 'Your first widebody',
    does: ['Proposes ferries home for idle aircraft', 'Proposes positioning the day before a contract', 'Plans fuel stops and crew changes for long positioning'],
    never: ['Sign, buy, lease or sell', 'Ferry above your limit'],
    blurbs: ['Ops engineer who planned ETOPS routes', 'Ex-charter planner, knows the fuel stops', 'Fleet planner from a cargo airline'],
  },
  watch: {
    id: 'watch', title: 'Watch desk', icon: 'BellRing',
    unlockText: 'Reliable reputation reaches 85', earnedText: 'Reliable 85: the market trusts you',
    does: ['Runs your own alert and auto-pause rules'],
    never: ['Act on anything: it only alerts and pauses'],
    blurbs: ['Night-shift ops assistant with sharp eyes', 'Duty officer who never misses a call', 'Ex-OCC watch keeper'],
  },
};
