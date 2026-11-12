// Play-style measures of one game (player bot round, Nov 2026): how a game was played, read from a save, so a
// player's save and a bot's end state (acmi-bot --dump=<day>,<file>) are measured alike.
//   npx tsx scripts/playstyle.ts <save.json> [more saves…]   one block per save
//   … --tsv                                                   one tab-separated line per save (for compare tables)
// Measures: contracts signed per month by kind and by lead time (signed to start), short-notice share, urgent work
// (< 72 h lead; calls are urgent offers) and calls missed, sub-charters out (crew control's vs the player's own
// hand-overs) and in, aircraft, crew per aircraft and complete sets per aircraft, hires and when, and how much short-term
// work was stacked on top of base deployments (signed while a base deployment ran, and on the same aircraft).

import { readFileSync } from 'node:fs';
import { deserialize } from '../src/engine/save';
import { DAY, fmtMonth, monthKey } from '../src/engine/core/time';
import type { Contract, GameState } from '../src/engine/core/types';
import { crewPlan } from '../src/engine/crew/sets';

const TSV = process.argv.includes('--tsv');
/** --md: a markdown table, one column per save, one row per measure. */
const MD = process.argv.includes('--md');
const files = process.argv.slice(2).filter((a) => !a.startsWith('--'));

export type Kind = 'base' | 'aog' | 'adhoc' | 'tour' | 'sports' | 'subIn' | 'dry' | 'other';
export function kindOf(c: Pick<Contract, 'archetype' | 'pattern'>): Kind {
  if (c.archetype === 'aogCover') return 'aog';
  if (c.archetype === 'dryLeaseOut') return 'dry';
  if (c.archetype === 'subcharterIn') return 'subIn';
  if (c.pattern.kind === 'base' || c.archetype === 'seasonBase' || c.archetype === 'capacityLease') return 'base';
  if (c.archetype === 'adhoc') return 'adhoc';
  if (c.archetype === 'tourSeries' || c.archetype === 'musicTour' || c.archetype === 'worldTour') return 'tour';
  if (c.archetype === 'sports') return 'sports';
  return 'other';
}
const KINDS: Kind[] = ['base', 'aog', 'adhoc', 'tour', 'sports', 'subIn', 'dry', 'other'];
const LEADS = [['<3d', 3], ['3-7d', 7], ['7-30d', 30], ['30d+', Infinity]] as const;
const leadBucket = (d: number) => LEADS.find(([, x]) => d < x)![0];

export interface Style {
  name: string;
  days: number;
  months: number;
  signed: number;
  perMonth: number;
  byKind: Record<Kind, number>;
  byLead: Record<string, number>;
  /** Share of signings with < 7 days' lead, and < 72 h (urgent: calls ring for these). */
  shortShare: number;
  urgentShare: number;
  urgent: number;
  callsMissed: number;
  /** Revenue legs handed to other operators: all, by crew control / ops (with a message), by the player's own hand-over. */
  subOut: number;
  subOutAuto: number;
  subOutOwn: number;
  subIn: number;
  aircraft: number;
  crew: number;
  crewPerAc: number;
  pilotsPerAc: number;
  cabinPerAc: number;
  setsPerAc: number;
  setsNeededPerAc: number;
  hires: number;
  hiresPerMonth: number;
  /** Hires ordered within 7 days after a signing (reactive) vs other times. */
  hiresAfterSign: number;
  /** Non-base signings whose window overlaps a base deployment running (any aircraft / the same aircraft). */
  stacked: number;
  stackedSameAc: number;
  /** Mean and peak contracts running at once (per day). */
  meanConcurrent: number;
  peakConcurrent: number;
  /** Mean contracts running at once per aircraft. */
  concurrentPerAc: number;
  crewRed: number;
  crewAmber: number;
  uncovered: number;
  monthly: { month: string; byKind: Record<Kind, number>; short: number }[];
}

export function measure(g: GameState, name: string): Style {
  const all = Object.values(g.contracts).filter((c) => c.signed >= g.started);
  const days = Math.max(1, (g.now - g.started) / DAY);
  const months = days / 30.44;
  const byKind = Object.fromEntries(KINDS.map((k) => [k, 0])) as Record<Kind, number>;
  const byLead: Record<string, number> = Object.fromEntries(LEADS.map(([k]) => [k, 0]));
  const monthly = new Map<number, { byKind: Record<Kind, number>; short: number }>();
  let short = 0;
  let urgent = 0;
  for (const c of all) {
    const k = kindOf(c);
    byKind[k]++;
    const lead = (c.start - c.signed) / DAY;
    byLead[leadBucket(lead)]++;
    if (lead < 7) short++;
    if (lead < 3) urgent++;
    const mk = monthKey(c.signed);
    const m = monthly.get(mk) ?? { byKind: Object.fromEntries(KINDS.map((x) => [x, 0])) as Record<Kind, number>, short: 0 };
    m.byKind[k]++;
    if (lead < 7) m.short++;
    monthly.set(mk, m);
  }
  // Hand-overs: the engine's own (crew control, ops) post a message naming the legs; the player's hand-over posts none.
  let subOutAuto = 0;
  for (const m of g.messages) {
    if (m.t < g.started) continue;
    const a = /^(\S+) sub-chartered with (\d+) more/.exec(m.title);
    if (a) subOutAuto += 1 + Number(a[2]);
    else if (/^\S+ sub-chartered(:|$)/.test(m.title)) {
      const legs = /flies (\d+) legs?/.exec(m.body ?? '');
      subOutAuto += legs ? Number(legs[1]) : 1;
    }
  }
  const subOut = g.stats.subchartered ?? 0;
  // The inbox keeps the last 300 messages: the split is read over the legs handed over inside its window, scaled up.
  const msgFrom = g.messages.length >= 300 ? Math.min(...g.messages.map((m) => m.t)) : g.started;
  const winLegs = Object.values(g.contracts).reduce((n, c) => n + (c.subLegs ?? []).filter((t) => t >= msgFrom).length, 0);
  const autoShare = msgFrom === g.started ? Math.min(1, subOutAuto / Math.max(1, subOut)) : Math.min(1, subOutAuto / Math.max(1, winLegs));
  const callsMissed = g.messages.filter((m) => m.t >= g.started && /call/i.test(m.title) && /miss|unanswered|no answer|went elsewhere/i.test(`${m.title} ${m.body ?? ''}`)).length;
  const fleet = Object.values(g.fleet).filter((a) => a.status !== 'delivering');
  const crew = Object.values(g.crew).filter((c) => !c.notice && c.status !== 'joining');
  const pilots = crew.filter((c) => c.role === 'CPT' || c.role === 'FO').length;
  const ac = Math.max(1, fleet.length);
  const plans = crewPlan(g);
  const setsComplete = plans.reduce((n, p) => n + p.setsComplete, 0);
  const setsNeeded = plans.reduce((n, p) => n + p.setsNeeded, 0);
  // Hires: crew hired after the start (the hire orders still on file plus people who have joined).
  const hiredAt = Object.values(g.crew).filter((c) => c.hired > g.started + 60).map((c) => c.hired);
  const orders = Object.values(g.hires ?? {}).map((h) => h.ordered);
  const hireTimes = [...new Set([...hiredAt, ...orders])];
  const signs = all.map((c) => c.signed);
  const hiresAfterSign = hireTimes.filter((t) => signs.some((s) => t >= s && t - s <= 7 * DAY)).length;
  // Stacked: a non-base job whose window overlaps a base deployment's (any aircraft / its own aircraft).
  const bases = all.filter((c) => kindOf(c) === 'base');
  let stacked = 0;
  let stackedSameAc = 0;
  for (const c of all) {
    if (kindOf(c) === 'base' || kindOf(c) === 'dry') continue;
    const over = bases.filter((b) => b.start < c.end && c.start < b.end);
    if (over.length) stacked++;
    if (over.some((b) => b.aircraftIds.some((id) => c.aircraftIds.includes(id)))) stackedSameAc++;
  }
  // Contracts running per day.
  let sum = 0;
  let peak = 0;
  let n = 0;
  for (let t = g.started; t < g.now; t += DAY) {
    const k = all.filter((c) => c.start <= t + DAY && c.end > t && !(c.cancelledAt && c.cancelledAt < t)).length;
    sum += k;
    peak = Math.max(peak, k);
    n++;
  }
  return {
    name, days: Math.round(days), months: Math.round(months * 10) / 10, signed: all.length, perMonth: all.length / months, byKind, byLead,
    shortShare: all.length ? short / all.length : 0, urgentShare: all.length ? urgent / all.length : 0, urgent, callsMissed,
    subOut, subOutAuto: Math.round(subOut * autoShare), subOutOwn: subOut - Math.round(subOut * autoShare), subIn: g.stats.v08?.subIn ?? 0,
    aircraft: fleet.length, crew: crew.length, crewPerAc: crew.length / ac, pilotsPerAc: pilots / ac, cabinPerAc: (crew.length - pilots) / ac,
    setsPerAc: setsComplete / ac, setsNeededPerAc: setsNeeded / ac,
    hires: hireTimes.length, hiresPerMonth: hireTimes.length / months, hiresAfterSign,
    stacked, stackedSameAc, meanConcurrent: n ? sum / n : 0, peakConcurrent: peak, concurrentPerAc: n ? sum / n / ac : 0,
    crewRed: g.stats.crewRed ?? 0, crewAmber: g.stats.crewAmber ?? 0, uncovered: g.stats.uncovered ?? 0,
    monthly: [...monthly].sort((a, b) => a[0] - b[0]).map(([mk, m]) => ({ month: fmtMonth(mk), ...m })),
  };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const f1 = (x: number) => x.toFixed(1);
export const TSV_HEAD = ['save', 'days', 'ac', 'signed/mo', 'base', 'aog', 'adhoc', 'tour', 'sports', 'other', '<3d', '3-7d', '7-30d', '30d+', 'short<7d', 'urgent<72h', 'subOut own', 'subOut auto', 'subIn', 'crew/ac', 'pilots/ac', 'cabin/ac', 'sets/ac', 'setsNeed/ac', 'hires/mo', 'hires<=7d after sign', 'stacked on base', 'same ac', 'running/ac', 'peak running', 'red', 'amber', 'uncovered'];
export const tsvLine = (s: Style) => [s.name, s.days, s.aircraft, f1(s.perMonth), s.byKind.base, s.byKind.aog, s.byKind.adhoc, s.byKind.tour, s.byKind.sports, s.byKind.other + s.byKind.subIn + s.byKind.dry, ...LEADS.map(([k]) => s.byLead[k]), pct(s.shortShare), pct(s.urgentShare), s.subOutOwn, s.subOutAuto, s.subIn, f1(s.crewPerAc), f1(s.pilotsPerAc), f1(s.cabinPerAc), f1(s.setsPerAc), f1(s.setsNeededPerAc), f1(s.hiresPerMonth), `${s.hiresAfterSign}/${s.hires}`, `${s.stacked}/${s.signed - s.byKind.base - s.byKind.dry}`, s.stackedSameAc, f1(s.concurrentPerAc), s.peakConcurrent, s.crewRed, s.crewAmber, s.uncovered].join('\t');

if (files.length && import.meta.url === `file://${process.argv[1]}`) {
  if (TSV) console.log(TSV_HEAD.join('\t'));
  if (MD) {
    const rows = files.map((f) => tsvLine(measure(deserialize(readFileSync(f, 'utf8')), f.replace(/^.*\/work\//, '').replace(/\.blockhours\.json$|\.json$/, ''))).split('\t'));
    console.log(`| measure | ${rows.map((r) => r[0]).join(' | ')} |`);
    console.log(`|---|${rows.map(() => '---').join('|')}|`);
    for (let i = 1; i < TSV_HEAD.length; i++) console.log(`| ${TSV_HEAD[i]} | ${rows.map((r) => r[i]).join(' | ')} |`);
  }
  for (const f of MD ? [] : files) {
    const g = deserialize(readFileSync(f, 'utf8'));
    const s = measure(g, f.replace(/^.*\/work\//, ''));
    if (TSV) {
      console.log(tsvLine(s));
      continue;
    }
    console.log(`${s.name}: ${g.company.name}, ${s.days} days, ${s.aircraft} aircraft, ${s.crew} crew`);
    console.log(`  signed ${s.signed} (${f1(s.perMonth)}/month): ${KINDS.filter((k) => s.byKind[k]).map((k) => `${k} ${s.byKind[k]}`).join(', ')}`);
    console.log(`  lead: ${LEADS.map(([k]) => `${k} ${s.byLead[k]}`).join(', ')}; short (<7d) ${pct(s.shortShare)}, urgent (<72h) ${pct(s.urgentShare)}; calls missed ${s.callsMissed}`);
    console.log(`  sub-charter out ${s.subOut} legs (own hand-overs ${s.subOutOwn}, crew control/ops ${s.subOutAuto}); in ${s.subIn}`);
    console.log(`  crew/aircraft ${f1(s.crewPerAc)} (pilots ${f1(s.pilotsPerAc)}, cabin ${f1(s.cabinPerAc)}); complete sets/aircraft ${f1(s.setsPerAc)} of ${f1(s.setsNeededPerAc)} needed`);
    console.log(`  hires ${s.hires} (${f1(s.hiresPerMonth)}/month, ${s.hiresAfterSign} within 7 days after a signing)`);
    console.log(`  stacked on a running base deployment ${s.stacked} (same aircraft ${s.stackedSameAc}); running at once mean ${f1(s.meanConcurrent)} (${f1(s.concurrentPerAc)}/aircraft), peak ${s.peakConcurrent}`);
    console.log(`  crew alarms red ${s.crewRed} amber ${s.crewAmber}, uncovered ${s.uncovered}`);
    for (const m of s.monthly) console.log(`    ${m.month}: ${KINDS.filter((k) => m.byKind[k]).map((k) => `${k} ${m.byKind[k]}`).join(', ')}; short ${m.short}`);
  }
}
