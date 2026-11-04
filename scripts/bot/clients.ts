// v0.16 the bot and the far routes (UPDATE-0.16.md §B.5; lane clients). A far route is a handful of overseas rotations
// weeks apart (few block hours a day over its span), which the bot's thin-series filter would pass over; it pays
// × 1.25, so the bot looks at it like any long-lead job. Pure reads; the tally is the bot's own.

import type { ContractOffer, GameState } from '../../src/engine/core/types';

/** The bot's thin-series filter lets a far route through (its feasibility and margin still decide). */
export const farRouteOk = (o: Pick<ContractOffer, 'exotic'>): boolean => !!o.exotic;

const seen = new Map<string, { title: string; client: string; value: number }>();
const signed = new Set<string>();

/** Once a day: remembers every far-route offer made and the ones signed (offers are pruned from a save over time). */
export function botFarRouteTally(g: GameState): void {
  for (const o of Object.values(g.offers)) {
    if (!o.exotic || seen.has(o.id)) continue;
    seen.set(o.id, { title: o.title, client: g.clients[o.clientId]?.name ?? '?', value: o.estValue });
  }
  for (const k of Object.values(g.contracts)) if (k.offerId && seen.has(k.offerId)) signed.add(k.offerId);
}

/** One line for the bot's summary: far routes offered, signed and their value. */
export function botFarRouteReport(): string {
  const made = [...seen.values()];
  const won = [...signed].map((id) => seen.get(id)!);
  const sum = (xs: { value: number }[]) => Math.round(xs.reduce((s, x) => s + x.value, 0) / 1000);
  const list = made.slice(0, 6).map((x) => `${x.title} (${x.client})`).join('; ');
  return `far routes: ${made.length} offered ($${sum(made)}K), ${won.length} signed ($${sum(won)}K)${list ? ` — ${list}${made.length > 6 ? '…' : ''}` : ''}`;
}
