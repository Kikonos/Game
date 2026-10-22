// v0.7.1 plain-language glossary (UPDATE-0.7.1.md §11) and the first-time hints (§10). One table: the UI's <Term>
// renders GLOSSARY[id].term and shows `short` in a popover; the Glossary screen lists every entry with "Show me".

import type { ProblemKind } from '../engine/core/types';

export type TermId =
  | 'fdp' | 'deadhead' | 'positioning' | 'tight' | 'discretion' | 'acmi' | 'wetLease' | 'subcharter' | 'aog' | 'standby' | 'rest' | 'blockHours'
  | 'mgh' | 'ferry' | 'augmented' | 'etops' | 'aCheck' | 'cCheck' | 'perDiem' | 'recovery' | 'privateJet';

export interface GlossaryEntry {
  term: string;
  /** One line, player words. */
  short: string;
  /** Where the term shows up (the Glossary screen's "Show me"): a UI tab and an optional view inside it (crew: 'board' | 'people'; VIEW_LABEL names it). */
  where?: { tab: 'map' | 'contracts' | 'schedule' | 'crew' | 'fleet' | 'finance' | 'company' | 'inbox'; view?: string };
}

/** Player words for a view id (the "Show me" button). */
export const VIEW_LABEL: Record<string, string> = { board: 'Roster board', people: 'People' };

export const GLOSSARY: Record<TermId, GlossaryEntry> = {
  fdp: { term: 'FDP', short: "Flight duty period: the crew's working day, from report to the last on-blocks. There is a legal maximum.", where: { tab: 'crew', view: 'board' } },
  deadhead: { term: 'Deadhead', short: 'Crew travelling as passengers on another airline to get to their flight.', where: { tab: 'map' } },
  positioning: { term: 'Positioning', short: 'Flying our own aircraft empty to where the work is.', where: { tab: 'schedule' } },
  tight: { term: 'Tight', short: 'Legal, but within 30 minutes or 5% of a limit; one delay breaks it.', where: { tab: 'crew', view: 'board' } },
  discretion: { term: 'Discretion', short: "The captain may extend the crew's day by up to 2 hours once; the crew get tired and grumpy.", where: { tab: 'crew', view: 'board' } },
  acmi: { term: 'ACMI', short: 'We provide Aircraft, Crew, Maintenance and Insurance; the client pays per block hour, fuel and airport fees.', where: { tab: 'contracts' } },
  wetLease: { term: 'Wet lease', short: 'Same as ACMI: our aircraft and crew fly for the client, who pays per block hour.', where: { tab: 'contracts' } },
  subcharter: { term: 'Sub-charter', short: "Paying a rival airline to fly our client's flight; we still bill the client.", where: { tab: 'contracts' } },
  aog: { term: 'AOG', short: "Aircraft on ground: broken and can't fly until repaired.", where: { tab: 'fleet' } },
  standby: { term: 'Standby', short: 'Crew kept free at a base to cover sickness and surprises.', where: { tab: 'crew' } },
  rest: { term: 'Rest', short: 'The time off a crew member needs before the next duty: 12 h at home, 10 h away.', where: { tab: 'crew', view: 'board' } },
  blockHours: { term: 'Block hours', short: 'Time from pushing back to parking; what clients pay for.', where: { tab: 'finance' } },
  mgh: { term: 'MGH', short: 'Minimum guaranteed hours: the block hours a wet-lease client pays for every month, flown or not.', where: { tab: 'contracts' } },
  ferry: { term: 'Ferry', short: 'An empty flight with no client: to a check, a delivery or a return.', where: { tab: 'schedule' } },
  augmented: { term: 'Augmented', short: 'A third (or fourth) pilot on board so the crew can rest in turns on a long flight.', where: { tab: 'company' } },
  etops: { term: 'ETOPS', short: 'Permission to fly far from the nearest airport over water (120, 180 or 240 minutes).', where: { tab: 'company' } },
  aCheck: { term: 'A-check', short: 'A light overnight inspection every few hundred flight hours.', where: { tab: 'fleet' } },
  cCheck: { term: 'C-check', short: 'A heavy check in a hangar every couple of years; the aircraft is out for days.', where: { tab: 'fleet' } },
  perDiem: { term: 'Per diem', short: 'Daily allowance paid to crew while away from base.', where: { tab: 'company' } },
  recovery: { term: 'Weekly rest', short: 'At least 36 hours off, with two local nights, every week.', where: { tab: 'crew', view: 'board' } },
  privateJet: { term: 'Private jet', short: 'A business jet chartered to fly our crew to their aircraft in hours; dear, but fast.', where: { tab: 'map' } },
};

/** Words that the UI wraps in <Term> when they appear in a card's text (lower-case match). */
export const TERM_WORDS: [string, TermId][] = [
  ['FDP', 'fdp'], ['deadhead', 'deadhead'], ['positioning', 'positioning'], ['tight', 'tight'], ['discretion', 'discretion'], ['ACMI', 'acmi'],
  ['wet lease', 'wetLease'], ['sub-charter', 'subcharter'], ['AOG', 'aog'], ['standby', 'standby'], ['rest', 'rest'], ['block hours', 'blockHours'],
  ['MGH', 'mgh'], ['ferry', 'ferry'], ['augmented', 'augmented'], ['ETOPS', 'etops'], ['A-check', 'aCheck'], ['C-check', 'cCheck'], ['per diem', 'perDiem'],
  ['weekly rest', 'recovery'], ['private jet', 'privateJet'],
];

/** First-time hints: one plain paragraph the first time each kind of problem appears (Settings.hintsSeen). */
export const HINTS: Partial<Record<ProblemKind, { title: string; text: string }>> = {
  crewShort: {
    title: 'A flight without a crew',
    text: 'A flight needs a legal crew: rested, rated on the type and in the right place. When nobody fits, you see this card. The bar shows how late the nearest crew would land; the buttons are the ways out, cheapest and quickest first. Two days before departure the warning is amber; twelve hours before, the game pauses so you can decide.',
  },
  crewIllegal: {
    title: 'A crew that cannot legally fly',
    text: 'Every crew member has limits: a maximum working day, minimum rest, and hours per week, month and year. When the plan breaks one, the flight shows red. The gauges show which limit is the problem; Crew Control lists the fixes.',
  },
  crewTight: {
    title: 'A crew close to a limit',
    text: 'Amber means legal, but within half an hour of a limit. One delay is enough to break it. Nothing to do yet; keep an eye on it.',
  },
  crewSick: {
    title: 'Someone called in sick',
    text: 'A sick crew member comes off their trips; the roster looks for a replacement at once. When nobody fits, the flight turns amber and you decide.',
  },
  aog: {
    title: 'Aircraft on ground',
    text: 'A fault has grounded the aircraft until it is repaired. The timeline shows the repair and the flights it hits. You can wait for the part, fly in a team, swap aircraft, hand the flights to a rival or cancel them.',
  },
  checkDue: {
    title: 'A check is coming up',
    text: 'Aircraft need a light A-check every few hundred flight hours and a heavy C-check every couple of years. The gauge shows how much of the interval is used; book the check before it runs out or the aircraft is grounded.',
  },
  grounded: {
    title: 'Grounded for an overdue check',
    text: 'The check interval ran out, so the aircraft may not carry passengers until the check is done. Book it now; the flights until then are lost.',
  },
  offerFit: {
    title: 'An offer you cannot fly as it stands',
    text: 'Every offer is checked against your aircraft and crew: seats, range, cabin, paint, who is free. The card names the one thing in the way and the button that fixes it.',
  },
  counterExpiry: {
    title: 'A counter-offer about to expire',
    text: 'When you counter, the client thinks and comes back. A halfway offer is the price on the table; after the deadline the job goes to a rival.',
  },
  cashLow: {
    title: 'Cash running out',
    text: 'The 30-day forecast adds up everything due in and out. When it dips below zero, salaries are paid late (morale falls) and lessors get nervous. Find work, chase invoices or sell one to a factor.',
  },
  invoiceOverdue: {
    title: 'A late payment',
    text: 'Clients do not always pay on time; governments are the worst. A reminder goes out at 7 days, a formal one at 30. You can wait, sell the invoice for a fee, or threaten to stop flying.',
  },
  lossMonth: {
    title: 'A losing month',
    text: 'Rent, salaries and insurance run whether the aircraft fly or not. A month with too few block hours loses money. The cure is work: contracts for the idle aircraft.',
  },
  deliveryWait: {
    title: 'An aircraft stuck at the seller',
    text: 'A new aircraft is handed over where the seller is. Your pilots fly out on airline tickets and ferry it home. Without rated pilots it waits there, and parking is charged by the day.',
  },
  leaseReturn: {
    title: 'A lease coming to an end',
    text: 'A leased aircraft goes back to its lessor with a return check, its original cabin and a white paint. You can extend the lease instead; decide before the notice date.',
  },
};
