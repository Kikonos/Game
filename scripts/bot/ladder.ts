// v0.16 the bot on the prestige ladder (UPDATE-0.16.md §B), run once a day from scripts/acmi-bot.ts: files IOSA
// registration as soon as the authority allows it (12 months of operations) and the cash is there, because national
// carriers and the majors ask for it and level 3 needs it held. The bot sets no offer filter (it wants every job). Pure
// in g apart from the approval it files.

import { playerLevel, prestigeView } from '../../src/engine/contracts/prestige';
import { statsV016 } from '../../src/engine/core/stats016';
import { APPROVALS, applyApproval, approvalBlocker } from '../../src/engine/ops/company';
import type { GameState } from '../../src/engine/core/types';

/** Cash kept back over the filing fee. */
const IOSA_RESERVE = 600_000;

/** Returns true when it acted (the bot settles after). */
export function botLadder(g: GameState): boolean {
  const co = g.company;
  if (co.approvals.includes('iosa') || co.pendingApprovals.some((p) => p.id === 'iosa')) return false;
  const cost = APPROVALS.find((a) => a.id === 'iosa')?.cost ?? 0;
  if (co.cash < cost + IOSA_RESERVE || approvalBlocker(g, 'iosa')) return false;
  return applyApproval(g, 'iosa').ok;
}

/** One line for the bot's summary: our level, the visibility by source, stretch offers made and signed, offers hidden. */
export function botLadderReport(g: GameState): string {
  const s = statsV016(g);
  const v = prestigeView(g);
  const from = ([1, 2, 3, 4] as const).map((l) => `L${l} ${Math.round(s.visibilityFrom[l])}`).join(' ');
  const at = g.company.prestige?.levelAt ?? {};
  const reached = ([2, 3, 4] as const).filter((l) => at[l] !== undefined).map((l) => `L${l} day ${Math.floor(((at[l] ?? 0) - g.started) / 1440)}`).join(', ');
  return `prestige: level ${playerLevel(g)} (${v.name}), visibility ${v.visibility} (${from})${reached ? `, reached ${reached}` : ''}; stretch offers ${s.stretchOffers} made / ${s.stretchSigned} signed; hidden by filter ${s.hidden}${v.next ? `; next needs ${v.next.missing.join(', ') || 'nothing'}` : ''}`;
}
