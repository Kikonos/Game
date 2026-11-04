// v0.16 Sales (UPDATE-0.16.md §C; lane `sales`): brokers with a relationship and their commission, the leads pipeline
// (lead → proposal → negotiation → signed, or cold / lost), pre-season pitches to airlines and regional sales managers.
// State lives in g.com (brokers, leads, pitches, reps). Offers that come this way carry `brokerId` / `leadId`.
//
// Step 0 (the shared skeleton): the record and its defaults, the broker table and the pure reads are real; every action
// answers "not yet", the daily pass does nothing and the monthly pass pays the (empty) sales payroll, so a game plays on
// exactly as before. The lane fills them in.

import { BAL } from '../core/balance';
import { post } from '../core/ledger';
import { monthKey, monthStart } from '../core/time';
import type { ActionResult, BrokerId, BrokerRel, GameState, HeadCandidate, Lead, MonthKey, Pitch, SalesRep } from '../core/types';
import { com } from './state';
import type { ProblemCard } from '../problems/types';

const S = BAL.v016.sales;

export const BROKER_IDS: BrokerId[] = ['acs', 'chapman', 'acc', 'airPartner', 'huntPalmer'];
export const brokerName = (id: BrokerId): string => S.brokers[id]?.name ?? id;
/** The commission a broker takes on a deal it brought (share of the price / rate). Pure. */
export const commissionOf = (id: BrokerId): number => S.brokers[id]?.commission ?? BAL.brokerCommission;
/** A broker id from a broker's name (older offers carry the name only). Pure. */
export const brokerIdOf = (name: string | undefined): BrokerId | undefined => BROKER_IDS.find((id) => S.brokers[id].name === name);

/** Load (and new game): the sales records' defaults (SAVE_VERSION stays 1). */
export function loadSales(g: GameState): void {
  const c = com(g);
  c.brokers ??= {};
  c.leads ??= [];
  c.pitches ??= [];
  c.reps ??= [];
}

// ---------- brokers ----------

export interface BrokerView {
  id: BrokerId;
  name: string;
  commission: number;
  /** What they bring, in words. */
  focus: string;
  rel: BrokerRel | null;
}

const FOCUS: Record<BrokerId, string> = {
  acs: 'Every kind of work, worldwide',
  chapman: 'Governments, aid agencies, sports and big groups, worldwide',
  acc: 'Airlines\' ACMI: season bases, AOG cover, capacity leases',
  airPartner: 'Sports, music and corporate groups in Europe and North America',
  huntPalmer: 'Sports and group charters in the UK and Europe',
};

/** The brokers for Contracts › Sales. Pure. */
export function brokerView(g: GameState): BrokerView[] {
  const rels = g.com?.brokers ?? {};
  return BROKER_IDS.map((id) => ({ id, name: brokerName(id), commission: commissionOf(id), focus: FOCUS[id], rel: rels[id] ?? null }));
}

const notYet = (): ActionResult => ({ ok: false, error: 'Not available yet' });

/** Register with a broker (a day's visit or a call). Step 0: not yet. */
export function registerBroker(_g: GameState, _id: BrokerId): ActionResult {
  return notYet();
}

// ---------- leads ----------

export interface LeadView extends Lead {
  clientName: string;
  stageName: string;
  /** Days before the current stage lapses. */
  daysLeft: number;
}

/** The pipeline, live leads first, newest first. Pure. */
export function leadsView(_g: GameState): LeadView[] {
  return [];
}
/** Send a proposal on a lead. Step 0: not yet. */
export function workLead(_g: GameState, _leadId: string): ActionResult {
  return notYet();
}
export function dropLead(_g: GameState, _leadId: string): ActionResult {
  return notYet();
}

// ---------- pitches ----------

/** The season a pitch made now is for ('S2028' / 'W2027'), null outside the windows. Pure. */
export function pitchWindow(_g: GameState): { season: string; label: string } | null {
  return null;
}
export function pitchAirline(_g: GameState, _clientId: string): ActionResult {
  return notYet();
}
export const pitchesOf = (g: GameState): Pitch[] => g.com?.pitches ?? [];

// ---------- sales managers ----------

/** Candidates for a market (rolled on first look, kept until hired). Step 0: none. */
export function repCandidates(_g: GameState, _market: string): HeadCandidate[] {
  return [];
}
export function hireSalesRep(_g: GameState, _market: string, _candidate: number): ActionResult {
  return notYet();
}
export function fireSalesRep(_g: GameState, _repId: string): ActionResult {
  return notYet();
}
export const salesReps = (g: GameState): SalesRep[] => g.com?.reps ?? [];

/** The sales managers' pay for month k, pro-rated from the day each joined (month-end bill and forecast alike). Pure. */
export function salesBill(g: GameState, k: MonthKey = monthKey(g.now)): number {
  let pay = 0;
  const a = monthStart(k), b = monthStart(k + 1);
  for (const r of g.com?.reps ?? []) {
    const from = Math.max(a, r.joins);
    if (from < b) pay += r.salary * ((b - from) / (b - a));
  }
  return Math.round(pay);
}

// ---------- passes ----------

/** Daily: broker leads, lead lifetimes, pitch replies, the managers' leads. Step 0: nothing. */
export function dailySales(_g: GameState): void {}

/** Month end (before the statement closes): the sales payroll; broker relations drift. */
export function monthlySales(g: GameState): void {
  const pay = salesBill(g, g.finance.current.month);
  if (pay) post(g, 'salaries', -pay);
}

// ---------- cards (UPDATE-0.16.md §C.3) ----------

/** A lead about to go cold (amber, `lead.warnDays` before). Step 0: no card yet. */
export function leadColdCard(_g: GameState, _leadId: string): ProblemCard | null {
  return null;
}
