// v0.16 the bot's sales policy (UPDATE-0.16.md §C; lane sales), run once a day from scripts/acmi-bot.ts: register with
// two brokers in month 2 (a third once Established), send a proposal on every lead, pitch two airlines a season, hire
// one sales manager for the home market once cash allows. Pure in g (every choice reads the state, so a loaded save
// plays on the same way). The Compliance Monitoring Manager is a separate policy below (`--cmm` hires one on day 1,
// for the with / without comparison of UPDATE-0.16.md §6.9).

import { DAY } from '../../src/engine/core/time';
import type { BrokerId, GameState } from '../../src/engine/core/types';
import { homeMarket } from '../../src/engine/commercial/presence';
import { BROKER_VISIT, hireSalesRep, pitchAirline, pitchQuota, pitchTargets, registerBroker, repCandidates, visitBroker, workLead } from '../../src/engine/commercial/sales';
import { complianceCandidates, hireComplianceManager } from '../../src/engine/ops/compliance';

/** The bot's sales policy numbers (not BAL: the bot's own choices). */
const BOT = {
  /** Register with every broker after this many days (v0.16 balance: registration is free and any operator is on every broker's list; was two, a third once Established). */
  registerDay: 30, brokers: ['acs', 'acc', 'chapman', 'airPartner', 'huntPalmer'] as BrokerId[],
  /** Pitches a season (v0.16 balance: the desk's whole quota, a pitch is a $1,500 visit), and the cash that allows one. */
  pitches: 4, pitchCash: 200_000,
  /** One sales manager for the home market when cash is above this (the mid candidate; v0.16 balance: 3M → 2M, a $6K a month hire against a halved inbound stream). */
  repCash: 2_000_000,
  /** v0.16 balance: a monthly day at each broker's office while cash is above this (relation +5 up to the visit cap). */
  visitCash: 1_000_000,
};

/** Returns true when it acted (the bot settles after). */
export function botSales(g: GameState): boolean {
  let acted = false;
  const day = Math.floor((g.now - g.started) / DAY);
  const c = g.com;
  // Brokers: two in month 2, a third when Established (standing ≥ 1).
  if (day >= BOT.registerDay) {
    for (const id of BOT.brokers) {
      if (c?.brokers?.[id]) continue;
      if (registerBroker(g, id).ok) acted = true;
    }
    // A day at each broker's office once a month while cash allows (v0.16 balance: a real sales call).
    if (g.company.cash > BOT.visitCash) {
      for (const id of BOT.brokers) {
        const rel = c?.brokers?.[id];
        if (!rel || g.now - (rel.lastVisit ?? -Infinity) < BROKER_VISIT.everyDays * DAY) continue;
        if (visitBroker(g, id).ok) acted = true;
      }
    }
  }
  // Every lead gets a proposal (the desk's cap stops it).
  for (const l of c?.leads ?? []) {
    if (l.stage !== 'lead') continue;
    if (workLead(g, l.id).ok) acted = true;
    else break;
  }
  // Pitches: two a season, the best-known airlines at our level first (pitchTargets sorts by relation).
  if (g.company.cash > BOT.pitchCash) {
    const q = pitchQuota(g);
    if (q.used < Math.min(BOT.pitches, q.max)) {
      const t = pitchTargets(g).find((x) => !x.pitched && !x.stretch);
      if (t && pitchAirline(g, t.client.id).ok) acted = true;
    }
  }
  // One sales manager for the home market once cash allows.
  if (g.company.cash > BOT.repCash && !(c?.reps ?? []).length) {
    const m = homeMarket(g);
    if (repCandidates(g, m).length >= 2 && hireSalesRep(g, m, 1).ok) acted = true;
  }
  if (botCompliance(g)) acted = true;
  return acted;
}

/** `--cmm`: a Compliance Monitoring Manager (the mid candidate) from day 1, to measure ramp findings with and without. */
export function botCompliance(g: GameState): boolean {
  if (!process.argv.includes('--cmm') || g.compliance?.hired) return false;
  const cands = complianceCandidates(g);
  return cands.length >= 2 && hireComplianceManager(g, 1).ok;
}
