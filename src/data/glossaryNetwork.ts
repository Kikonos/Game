// v0.19 scheduled routes: glossary entries (UPDATE-0.19.md §K). Spread into GLOSSARY (data/glossary.ts).

import type { GlossaryEntry } from './glossary';

export type NetworkTermId = 'scheduledRoute' | 'loadFactor' | 'yield' | 'fareBuckets' | 'eu261' | 'downgradeRefund' | 'slotSeries' | 'fifthFreedom' | 'tankering' | 'liveAnimals';

export const GLOSSARY_NETWORK: Record<NetworkTermId, GlossaryEntry> = {
  scheduledRoute: { term: 'Scheduled route', short: 'Our own timetable of flights that we sell (or a partner sells) seat by seat, beside the ACMI work. A modest, steady margin, with the load risk ours.', where: { tab: 'contracts', view: 'network' } },
  loadFactor: { term: 'Load factor', short: 'Passengers as a share of the seats: 200 people on 267 seats is 75 %.', where: { tab: 'contracts', view: 'network' } },
  yield: { term: 'Yield', short: 'Ticket revenue per passenger (or per seat flown): what each person paid us, on average.', where: { tab: 'contracts', view: 'network' } },
  fareBuckets: { term: 'Fare buckets', short: 'Cheap, normal and flexible fares on the same seats. The cheap ones close as a flight fills and can reopen near the day if it sells slowly.', where: { tab: 'contracts', view: 'network' } },
  eu261: { term: 'EU261', short: 'The EU rule on passenger rights: €250–600 for a late (3 h+) or cancelled flight on the day, plus meals and hotels. Changes we plan in advance cost much less in the game.', where: { tab: 'contracts', view: 'network' } },
  downgradeRefund: { term: 'Downgrade refund', short: 'A business passenger moved to economy gets 30–75 % of that flight’s fare back, by distance.', where: { tab: 'contracts', view: 'network' } },
  slotSeries: { term: 'Slot series (80 %)', short: 'A take-off and landing time held at a busy airport for a whole season. Fly at least 80 % of it or lose it next season; sub-charters count as flown, cancellations do not.', where: { tab: 'contracts', view: 'network' } },
  fifthFreedom: { term: 'Fifth freedom', short: 'Selling seats between two foreign countries on the way (Dubai–Dili on a Lisbon flight). We only stop for fuel there, so we may not sell those seats.', where: { tab: 'contracts', view: 'network' } },
  tankering: { term: 'Tankering', short: 'Carrying fuel for the way back from where it is cheaper. The extra weight burns part of the saving and takes payload.', where: { tab: 'contracts', view: 'network' } },
  liveAnimals: { term: 'Live animals (AVI)', short: 'Cargo such as day-old chicks: loaded last, unloaded first, in a heated, ventilated hold, under the IATA rules.', where: { tab: 'contracts', view: 'network' } },
};
