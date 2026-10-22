// Pure helpers for the B5 screens (labels, sorting, filtering, deep links). No React, no writes.

import type { RatingFamily } from '../../data/acmiTypes';
import { BAL } from '../../engine/core/balance';
import { statementTotals } from '../../engine/core/ledger';
import { problemFor } from '../../engine/problems';
import { DAY, HOUR, fmtDay, monthKey, toLocal } from '../../engine/core/time';
import { mghInMonth } from '../../engine/contracts/pricing';
import type { IdleWindow } from '../../engine/contracts/offers';
import type {
  AircraftOffer, Archetype, ContractOffer, CrewMember, CrewStatus, GameState, LedgerCat, Message, MessageCat, MonthStatement, Product, Ref, Requirements, Role, SchedulePattern,
} from '../../engine/core/types';
import { money } from '../format';
import type { Tab } from '../store';

export const ARCH_LABEL: Record<Archetype, string> = {
  seasonBase: 'Season ACMI base', aogCover: 'AOG cover', adhoc: 'Ad hoc charter', sports: 'Sports charter', repatriation: 'Repatriation',
  tourSeries: 'Tour series', troopRotation: 'Troop rotation', capacityLease: 'Capacity lease', hajj: 'Hajj', unRotation: 'UN rotation', vip: 'VIP charter',
  deportation: 'Deportation', evacuation: 'Evacuation', humanitarian: 'Humanitarian', subcharterIn: 'Sub-charter', dryLeaseOut: 'Dry lease out',
};

/** Category label; a season base of 120 days or more is long-term, as its title says. */
export function archLabel(o: Pick<ContractOffer, 'archetype' | 'start' | 'end'>): string {
  return o.archetype === 'seasonBase' && Math.round((o.end - o.start) / DAY) >= 120 ? 'Long-term ACMI base' : ARCH_LABEL[o.archetype];
}

/** First and last day of an offer as its blurb reads them: a base in its local days, else UTC. Format with fmtDay / fmtDate. */
export function offerDays(o: Pick<ContractOffer, 'pattern' | 'start' | 'end'>): [number, number] {
  return o.pattern.kind === 'base' ? [toLocal(o.pattern.base, o.start), toLocal(o.pattern.base, o.end - 1)] : [o.start, o.end];
}

export const ROLES: Role[] = ['CPT', 'FO', 'CRP', 'PUR', 'CC'];
export const ROLE_LABEL: Record<Role, string> = { CPT: 'Captain', FO: 'First officer', CRP: 'Relief pilot', PUR: 'Purser', CC: 'Cabin crew' };
export const isPilotRole = (r: Role) => r === 'CPT' || r === 'FO' || r === 'CRP';

export const CREW_STATUS_LABEL: Record<CrewStatus, string> = {
  available: 'Available', onDuty: 'On duty', resting: 'Resting', off: 'Day off', leave: 'Leave', sick: 'Sick', training: 'Training', joining: 'Joining',
};

export const MSG_CATS: { id: MessageCat | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'ops', label: 'Ops' }, { id: 'crew', label: 'Crew' }, { id: 'commercial', label: 'Commercial' },
  { id: 'tech', label: 'Tech' }, { id: 'finance', label: 'Finance' }, { id: 'company', label: 'Company' }, { id: 'goal', label: 'Goals' },
];

const URGENCY_RANK: Record<ContractOffer['urgency'], number> = { urgent: 0, short: 1, normal: 2 };

/** Open (and countered) offers: urgent first, then by value. */
export function marketOffers(g: GameState): ContractOffer[] {
  return Object.values(g.offers)
    .filter((o) => o.status === 'open' || o.status === 'countered')
    .sort((a, b) => URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || b.estValue - a.estValue || a.expires - b.expires);
}

/** Offers that left the market without us (lost, expired, declined), newest first. */
export function missedOffers(g: GameState): ContractOffer[] {
  return Object.values(g.offers)
    .filter((o) => o.status === 'lost' || o.status === 'expired' || o.status === 'declined')
    .sort((a, b) => (b.closedAt ?? b.expires) - (a.closedAt ?? a.expires));
}

/** Compact duration in whole hours / days: '45 min', '31 h', '3 d 4 h'. */
export function spanLabel(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < HOUR) return `${m} min`;
  if (m < 2 * DAY) return `${Math.floor(m / HOUR)} h`;
  const d = Math.floor(m / DAY);
  const h = Math.floor((m % DAY) / HOUR);
  return h ? `${d} d ${h} h` : `${d} d`;
}

/** Expiry countdown in game hours (changes at most hourly). */
export function expiryLabel(now: number, expires: number): string {
  const left = expires - now;
  if (left <= 0) return 'Expired';
  return `${spanLabel(Math.floor(left / HOUR) * HOUR || left)} left`;
}

/** 'LIS ⇄ HAM', 'KBL → LIS', 'HAM base · PMI, AGP +2'. */
export function routeSummary(p: SchedulePattern): string {
  if (p.kind === 'base') {
    const d = p.dests.slice(0, 3).join(', ');
    return `${p.base} base · ${d}${p.dests.length > 3 ? ` +${p.dests.length - 3}` : ''}`;
  }
  const legs = [...p.legs].sort((a, b) => a.dep - b.dep);
  if (!legs.length) return '';
  const stops: string[] = [legs[0].from];
  for (const l of legs) {
    if (stops[stops.length - 1] !== l.from) stops.push(l.from);
    stops.push(l.to);
  }
  if (stops.length === 3 && stops[0] === stops[2]) return `${stops[0]} ⇄ ${stops[1]}`;
  const uniq = new Set(stops);
  if (legs.length > 4 && uniq.size <= 3) {
    const [a, b] = [stops[0], stops.find((s) => s !== stops[0]) ?? stops[0]];
    return `${a} ⇄ ${b} · ${legs.length} legs`;
  }
  return stops.length > 5 ? `${stops.slice(0, 4).join(' → ')} … ${stops[stops.length - 1]}` : stops.join(' → ');
}

const k = (v: number) => money(v);

/** '$3,950/BH · MGH 200', '$412K charter', '$228K/month dry'. */
export function productLine(p: Product): string {
  if (p.kind === 'wet') return `$${p.ratePerBH.toLocaleString('en-US')}/BH · MGH ${p.mghPerMonth}`;
  if (p.kind === 'charter') return `${k(p.price)} charter`;
  return `${k(p.rentPerMonth)}/month dry`;
}

export interface Chip {
  label: string;
  tone?: 'good' | 'warn' | 'bad';
  tip?: string;
}

/** Requirement chips: seats, body/families, ETOPS, runway, approvals. */
export function reqChips(r: Requirements): Chip[] {
  const out: Chip[] = [{ label: r.maxSeats ? `${r.minSeats}–${r.maxSeats} seats` : `${r.minSeats}+ seats`, tip: 'Seats the client needs' }];
  if (r.body === 'wide') out.push({ label: 'Widebody' });
  if (r.families?.length && r.families.length <= 2) out.push({ label: r.families.join(' / ') });
  // v0.7: accepted layouts (supersede `layout`) and premium seats.
  const layouts = r.layouts ?? (r.layout ? [r.layout] : null);
  if (layouts?.length === 1 && layouts[0] === 'all-economy' && r.minSeats >= 174) out.push({ label: `Max seats ${r.minSeats}+`, tone: 'warn', tip: 'All-economy, high-density cabin' });
  else if (layouts?.length === 1 && layouts[0] === 'vip') out.push({ label: 'VIP cabin', tone: 'warn', tip: 'Needs a VIP layout (refit on the Fleet card)' });
  else if (layouts && !layouts.includes('all-economy')) out.push({ label: layouts.length === 1 ? layouts[0].replace('-', ' ') : 'Premium cabin', tip: `Cabins: ${layouts.map((l) => (l === 'vip' ? 'VIP' : l)).join(', ')}` });
  if (r.minPremium) out.push({ label: `Premium ${r.minPremium}+`, tip: 'Business and premium-economy seats' });
  if (r.etops) out.push({ label: `ETOPS ${r.etops}`, tone: 'warn', tip: 'Needs ETOPS approval and a capable twin' });
  if (r.minRunwayM && r.minRunwayM < 2400) out.push({ label: `Runway ${r.minRunwayM.toLocaleString('en-US')} m`, tone: 'warn', tip: 'Short runway on the programme' });
  if (r.longestSectorNm >= 3000) out.push({ label: `${r.longestSectorNm.toLocaleString('en-US')} nm`, tip: 'Longest sector' });
  for (const a of r.approvals) out.push({ label: a.toUpperCase(), tone: 'warn', tip: 'Approval needed' });
  if (r.extraCabin) out.push({ label: `+${r.extraCabin} cabin crew` });
  // v0.6: the client pays for extra cabin crew above the minimum when we fly at least n.
  if (r.extraCabinPaid) out.push({ label: `Client pays +${pctLabel(r.extraCabinPaid.pct / r.extraCabinPaid.n)} per extra cabin crew`, tone: 'good', tip: `Fly ${r.extraCabinPaid.n} or more extra cabin crew and the client pays ${pctLabel(r.extraCabinPaid.pct)} more` });
  if (r.noTechStops) out.push({ label: 'No fuel stops' });
  return out;
}

/** v0.6: a day at the home base ('3 Jun'): conversion classes run on base-local days. */
export const baseDay = (g: Pick<GameState, 'company'>, t: number) => fmtDay(toLocal(g.company.homeBase, t));

/** '0.75%' / '1.5%': a price share as a short percentage. */
export const pctLabel = (x: number) => `${Math.round(x * 10_000) / 100}%`;

/** Risk chips for risks of 0.35 or more. */
export function riskChips(risk: ContractOffer['risk']): Chip[] {
  const out: Chip[] = [];
  const add = (v: number, label: string, tip: string) => {
    if (v >= 0.35) out.push({ label, tone: v >= 0.65 ? 'bad' : 'warn', tip });
  };
  add(risk.payment, 'Late payer', 'The client often pays after the due date');
  add(risk.disruption, 'Disruption', 'Delays, diversions and schedule changes likely');
  add(risk.politics, 'Politics', 'Sensitive work: reputation and morale at stake');
  add(risk.permit, 'Permits', 'Overflight and landing permits may come late');
  return out;
}

export type Tone = 'good' | 'warn' | 'bad';

/** Limit bars: green under 75%, amber under 95%, red above. */
export const limitTone = (ratio: number): Tone => (ratio < 0.75 ? 'good' : ratio < 0.95 ? 'warn' : 'bad');

export interface CrewFilter {
  group: 'all' | 'pilots' | 'cabin';
  role: Role | 'all';
  status: CrewStatus | 'all' | 'away';
  rating: RatingFamily | 'all';
  q: string;
}

export const NO_FILTER: CrewFilter = { group: 'all', role: 'all', status: 'all', rating: 'all', q: '' };

const ROLE_RANK: Record<Role, number> = { CPT: 0, FO: 1, CRP: 2, PUR: 3, CC: 4 };

/** Filters and sorts crew: role, then surname. */
export function filterCrew(list: CrewMember[], f: CrewFilter): CrewMember[] {
  const q = f.q.trim().toLowerCase();
  return list
    .filter((c) => {
      if (f.group === 'pilots' && !isPilotRole(c.role)) return false;
      if (f.group === 'cabin' && isPilotRole(c.role)) return false;
      if (f.role !== 'all' && c.role !== f.role) return false;
      if (f.status === 'away' ? c.loc === c.base : f.status !== 'all' && c.status !== f.status) return false;
      if (f.rating !== 'all' && !c.ratings.includes(f.rating)) return false;
      if (q && !`${c.first} ${c.last} ${c.loc} ${c.nationality}`.toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || a.last.localeCompare(b.last) || a.first.localeCompare(b.first));
}

export const LEDGER_LABEL: Record<LedgerCat, string> = {
  acmiRevenue: 'ACMI (block hours)', charterRevenue: 'Charter', otherRevenue: 'Other revenue',
  fuel: 'Fuel', airportFees: 'Airport & handling', rent: 'Aircraft rent', reserves: 'Maintenance reserves', salaries: 'Salaries',
  perDiem: 'Per diems', hotels: 'Crew hotels', deadhead: 'Crew deadheads', crewJet: 'Crew jet charters', maintenance: 'Line maintenance', checks: 'Checks',
  insurance: 'Insurance', overhead: 'Overhead', training: 'Training', hiring: 'Hiring', penalties: 'Penalties', subcharter: 'Sub-charter',
  approvals: 'Approvals', interest: 'Interest', capex: 'Aircraft purchases', assetSale: 'Asset sales', paint: 'Paint & livery',
  refit: 'Cabin refits', leaseReturn: 'Lease returns',
};

const REVENUE: LedgerCat[] = ['acmiRevenue', 'charterRevenue', 'otherRevenue', 'assetSale'];
const COSTS: LedgerCat[] = [
  'fuel', 'airportFees', 'rent', 'reserves', 'salaries', 'perDiem', 'hotels', 'deadhead', 'maintenance', 'checks', 'paint', 'insurance', 'overhead',
  'training', 'hiring', 'penalties', 'subcharter', 'approvals', 'interest', 'capex', 'refit', 'leaseReturn',
];

export interface StatementRow {
  cat: LedgerCat;
  label: string;
  revenue: boolean;
  values: number[];
}

/** Statement columns (current month first, then up to `n` closed months newest first) and the lines used in any of them. */
export function statementView(current: MonthStatement, history: MonthStatement[], n = 5): { months: MonthStatement[]; rows: StatementRow[] } {
  const closed = history.filter((h) => h.month !== current.month).sort((a, b) => b.month - a.month).slice(0, n);
  const months = [current, ...closed];
  const rows: StatementRow[] = [];
  for (const cat of [...REVENUE, ...COSTS]) {
    const values = months.map((m) => m.lines[cat] ?? 0);
    if (values.some((v) => Math.abs(v) >= 0.5)) rows.push({ cat, label: LEDGER_LABEL[cat], revenue: REVENUE.includes(cat), values });
  }
  return { months, rows };
}

/** v0.7: 'market' filters by topic (aircraft market alerts). v0.7.1: 'problems' = messages about a problem still open, and bad news of the last week. */
export type MsgFilter = MessageCat | 'all' | 'market' | 'problems';

/** Bad news stays under 'Problems only' this long. */
export const PROBLEM_RECENT = 7 * DAY;

/** A message belongs under 'Problems only' while its problem is still live (the WHY? dots agree), or as bad news of the last week. */
export function isProblemMessage(m: Message, g: GameState): boolean {
  if (m.problem) return problemFor(g, m.problem) !== null;
  return m.tone === 'bad' && g.now - m.t <= PROBLEM_RECENT;
}

/** An offer is an opportunity, not a penalty: its money badge reads '$199K of work' in blue. */
export const isOpportunity = (m: Message): boolean => m.ref?.kind === 'offer' && m.tone !== 'bad';

export function filterMessages(list: Message[], cat: MsgFilter, g?: GameState): Message[] {
  if (cat === 'all') return list;
  if (cat === 'market') return list.filter((m) => m.topic === 'market');
  if (cat === 'problems') return g ? list.filter((m) => isProblemMessage(m, g)) : list.filter((m) => !!m.problem || m.tone === 'bad');
  return list.filter((m) => m.cat === cat);
}

/** The loss-month line on Finance only while this month is losing too, or after two losing months in a row (else it is last month's news). */
export function showLossMonth(g: GameState): boolean {
  if (statementTotals(g.finance.current.lines).profit < 0) return true;
  const closed = g.finance.history.filter((h) => h.closed && h.month !== g.finance.current.month).sort((a, b) => b.month - a.month);
  return closed.length >= 2 && statementTotals(closed[0].lines).profit < 0 && statementTotals(closed[1].lines).profit < 0;
}

export interface DeepLink {
  tab: Tab;
  sel?: Ref;
  view?: string;
  /** Open the offer dialog instead of navigating. */
  offerId?: string;
}

/** Where a message's ref leads. */
export function refTarget(g: GameState, ref: Ref): DeepLink | null {
  switch (ref.kind) {
    case 'flight': {
      const f = g.flights[ref.id];
      const acId = f?.aircraftId ?? (f?.contractId ? g.contracts[f.contractId]?.aircraftIds[0] : undefined);
      return acId ? { tab: 'schedule', sel: { kind: 'aircraft', id: acId }, view: String(f!.std) } : { tab: 'schedule' };
    }
    case 'aircraft':
      return g.fleet[ref.id] ? { tab: 'fleet', sel: ref } : { tab: 'fleet' };
    case 'contract':
      return { tab: 'contracts', view: 'active', sel: ref };
    case 'offer': {
      const o = g.offers[ref.id];
      if (o && (o.status === 'open' || o.status === 'countered')) return { tab: 'contracts', view: 'market', offerId: o.id };
      if (o?.status === 'accepted') {
        const c = Object.values(g.contracts).find((x) => x.offerId === o.id);
        if (c) return { tab: 'contracts', view: 'active', sel: { kind: 'contract', id: c.id } };
      }
      return { tab: 'contracts', view: 'missed' };
    }
    case 'crew':
      return g.crew[ref.id] ? { tab: 'crew', sel: ref } : { tab: 'crew' };
    case 'maint': {
      const m = g.maintenance[ref.id];
      return m ? { tab: 'schedule', sel: { kind: 'aircraft', id: m.aircraftId }, view: String(m.start) } : { tab: 'fleet' };
    }
    case 'airport':
      return { tab: 'map', sel: ref };
    case 'market':
      return { tab: 'fleet', view: 'market', sel: ref };
  }
  return null;
}

/** Counter price steps: +2.5% … +20% over the asking price (rounded to $5/BH or $1K). */
export function counterSteps(asking: number, wet: boolean): number[] {
  const out: number[] = [];
  for (let i = 1; i <= 8; i++) {
    const v = asking * (1 + 0.025 * i);
    out.push(wet ? Math.round(v / 5) * 5 : Math.round(v / 1000) * 1000);
  }
  return out;
}

/**
 * Wet-lease money earned this month but invoiced only at month end: per contract, max(flown BH, MGH pro rata
 * to today) × rate, plus short-cycle fees, minus the broker commission. Display-only estimate (pure).
 */
export function earnedUnbilled(g: GameState): number {
  const k = monthKey(g.now);
  let sum = 0;
  for (const c of Object.values(g.contracts)) {
    const p = c.product;
    if (p.kind !== 'wet' || (c.status !== 'signed' && c.status !== 'active') || c.billedMonths.includes(k)) continue;
    const u = c.use[k];
    const flown = (u?.blockMin ?? 0) / 60;
    const end = Math.min(c.end, c.cancelledAt ?? Infinity, g.now);
    const mgh = end > c.start ? mghInMonth(p.mghPerMonth, c.start, end, k) * c.aircraftIds.length : 0;
    let v = p.ratePerBH * Math.max(flown, mgh) + (u?.shortCycles && p.cycleFee ? u.shortCycles * p.cycleFee : 0);
    if (c.broker) v *= 1 - BAL.brokerCommission;
    sum += v;
  }
  return Math.round(sum);
}

/**
 * An offer's 'Follow-on' / 'Fits' hint as of now: the stored text names an aircraft (and station) from when the
 * offer was made; it is rebuilt from that aircraft's current idle window, or dropped when the window is gone.
 */
export function liveHook(g: GameState, o: ContractOffer, windows: IdleWindow[]): string | undefined {
  if (!o.hook) return undefined;
  const m = /^(?:Follow-on: |Fits )(\S+?):? /.exec(o.hook);
  if (!m) return o.hook;
  const ac = Object.values(g.fleet).find((a) => a.reg === m[1]);
  const at = /free at ([A-Z]{3})/.exec(o.hook)?.[1];
  const w = ac && windows.find((x) => x.aircraftId === ac.id && x.from <= o.start + 2 * DAY && x.to > o.start && (!at || x.at === at));
  if (!ac || !w) return undefined;
  if (at) return `Follow-on: ${ac.reg} is free at ${w.at} from ${fmtDay(Math.max(w.from, g.now))}`;
  return `Fits ${ac.reg}: free ${fmtDay(Math.max(w.from, g.now))}${w.to - w.from < 120 * DAY ? `–${fmtDay(w.to)}` : ' onwards'}`;
}

/** v0.7 C1: a conversion plan with a red warning (fleet short of legal crew, cost above cash) books only after a confirm. */
export const needsConfirm = (plan: { warnings: { level: 'warn' | 'bad' }[] }): boolean => plan.warnings.some((w) => w.level === 'bad');

// ---------- v0.7 aircraft market ----------

/** Kind chip of a market offer. */
export function offerKind(o: Pick<AircraftOffer, 'kind' | 'newBuild'>): { label: string; tone: string } {
  if (o.newBuild) return { label: 'New-build lease', tone: 'accent' };
  return o.kind === 'dryLeaseIn' ? { label: 'Lease used', tone: 'info' } : { label: 'Buy used', tone: 'gold' };
}

/** 'AerCap · ex-LATAM' style seller (the lessor without the engine's '(used sale)' tag). */
export const sellerOf = (o: Pick<AircraftOffer, 'lessor'>) => o.lessor.replace(/ \(used sale\)$/, '');

const SEEN_KEY = 'bh.marketSeen';

function seenIds(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Open market offers not seen on the Market view yet (the switch's dot). */
export function unseenOffers(ids: string[]): number {
  const seen = new Set(seenIds());
  return ids.filter((id) => !seen.has(id)).length;
}

/** Remembers offers shown on the Market view (last 60, per browser). */
export function markMarketSeen(ids: string[]): void {
  const prev = seenIds();
  if (ids.every((id) => prev.includes(id))) return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...prev, ...ids])].slice(-60)));
  } catch {
    // storage unavailable
  }
}

/** 'all-economy' / 'two-class' / 'VIP' (cabin layout names as the Fleet card and refit dialog say them). */
export const layoutLabel = (l: string) => (l === 'vip' ? 'VIP' : l);
