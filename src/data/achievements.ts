// v0.9 achievements (UPDATE-0.9.md §14.1): milestones in the Company › Achievements gallery. No secret ones, no money.

import type { HeadId } from '../engine/core/types';

export type AchievementId =
  | 'cleanSheet' | 'clockwork' | 'outstationFix' | 'ninetyClean'
  | 'fullCover' | 'bunkTime' | 'slipCrew' | 'standby' | 'goodPlace'
  | 'cOnTime' | 'noOverdue'
  | 'fiveFlown' | 'paidInTheEnd' | 'partner' | 'firstCall' | 'hajj' | 'homeSafe' | 'blueIce'
  | 'widebody' | 'queen'
  | 'reliable' | 'cleanRecord' | 'inTheBlack' | 'rainyDay';

export type AchievementGroup = 'ops' | 'crew' | 'tech' | 'commercial' | 'fleet' | 'company';

export interface AchievementDef { id: AchievementId; title: string; text: string; group: AchievementGroup; /** lucide name */ icon: string; head?: HeadId }

export const ACHIEVEMENT_GROUPS: { id: AchievementGroup; label: string }[] = [
  { id: 'ops', label: 'Operations' }, { id: 'crew', label: 'Crew' }, { id: 'tech', label: 'Technical' },
  { id: 'commercial', label: 'Commercial' }, { id: 'fleet', label: 'Fleet' }, { id: 'company', label: 'Company' },
];

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'cleanSheet', group: 'ops', icon: 'ShieldCheck', title: 'Clean sheet', text: '25 revenue sectors in a row with a legal crew', head: 'opsControl' },
  { id: 'clockwork', group: 'ops', icon: 'Clock', title: 'Like clockwork', text: 'A month with 95 % on-time departures (40 or more)' },
  { id: 'outstationFix', group: 'ops', icon: 'Wrench', title: 'Fixed it away from home', text: 'An AOG away from base fixed without a sub-charter' },
  { id: 'ninetyClean', group: 'ops', icon: 'CalendarCheck', title: 'Ninety days, nothing cancelled', text: '90 days without cancelling a leg' },
  { id: 'fullCover', group: 'crew', icon: 'Users', title: 'Every seat filled', text: '2 months in a row with 98 % crew coverage', head: 'crewDesk' },
  { id: 'bunkTime', group: 'crew', icon: 'BedDouble', title: 'Bunk time', text: 'An augmented duty flown with a legal rest plan' },
  { id: 'slipCrew', group: 'crew', icon: 'Repeat', title: 'Fresh crew at the fuel stop', text: 'The first crew change at a tech stop' },
  { id: 'standby', group: 'crew', icon: 'PhoneCall', title: 'Saved by standby', text: '25 standby call-outs' },
  { id: 'goodPlace', group: 'crew', icon: 'Smile', title: 'A good place to work', text: 'Company morale 75 at a month end' },
  { id: 'cOnTime', group: 'tech', icon: 'Hammer', title: 'Heavy check, on time', text: 'A C-check completed before it was due', head: 'maintPlanner' },
  { id: 'noOverdue', group: 'tech', icon: 'ClipboardCheck', title: 'A year without an overdue check', text: '365 days with no check overdue' },
  { id: 'fiveFlown', group: 'commercial', icon: 'Briefcase', title: 'Five flown', text: '5 contracts completed', head: 'analyst' },
  { id: 'paidInTheEnd', group: 'commercial', icon: 'Landmark', title: 'They paid in the end', text: 'A late government payment collected', head: 'credit' },
  { id: 'partner', group: 'commercial', icon: 'Handshake', title: 'Partners', text: 'A client reaches Partner' },
  { id: 'firstCall', group: 'commercial', icon: 'Trophy', title: 'First call', text: 'Signed an offer a rival was bidding on' },
  { id: 'hajj', group: 'commercial', icon: 'Moon', title: 'Hajj airlift', text: 'A Hajj contract completed' },
  { id: 'homeSafe', group: 'commercial', icon: 'Home', title: 'Bring them home', text: 'An evacuation or repatriation completed' },
  { id: 'blueIce', group: 'commercial', icon: 'Snowflake', title: 'Blue ice', text: 'A landing on an Antarctic ice runway' },
  { id: 'widebody', group: 'fleet', icon: 'Plane', title: 'Widebody', text: 'The first widebody joins the fleet', head: 'fleetPlanner' },
  { id: 'queen', group: 'fleet', icon: 'Crown', title: 'Queen of the Skies', text: 'A 747-400 revenue sector flown' },
  { id: 'reliable', group: 'company', icon: 'BadgeCheck', title: 'Reliable', text: 'Reliable reputation 90 or more for 30 days', head: 'watch' },
  { id: 'cleanRecord', group: 'company', icon: 'Sparkles', title: 'Clean record', text: 'Clean reputation 80 or more' },
  { id: 'inTheBlack', group: 'company', icon: 'TrendingUp', title: 'In the black', text: 'A calendar year with a positive net result' },
  { id: 'rainyDay', group: 'company', icon: 'PiggyBank', title: 'Rainy-day fund', text: '$5M cash at a month end' },
];

export const ACHIEVEMENT_BY_ID: Record<string, AchievementDef> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));
