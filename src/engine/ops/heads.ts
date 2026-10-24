// v0.9 department heads (UPDATE-0.9.md §5): seven hires earned through achievements. Each has a salary and a skill,
// takes routine work by the player's rules, makes the odd mistake, can be overridden or switched off, and never takes
// the big decisions (which contracts, which aircraft, crises).

import { AIRPORT_BY_CODE } from '../../data/airports';
import { HEAD_DEFS, HEAD_IDS } from '../../data/heads';
import { CREW_MIX, DEFAULT_MIX, NAMES } from '../../data/names';
import { BAL } from '../core/balance';
import { flightsOf, nextId, removeFlights } from '../core/entities';
import { post } from '../core/ledger';
import { pushMessage, setDecisionHook } from '../core/messages';
import { isolatePauses, requestPause } from '../core/pause';
import { blockMinutes, typeOf } from '../core/perf';
import { schedule } from '../core/queue';
import { chance, int, next, range, weightedPick, type RngHolder } from '../core/rng';
import { DAY, fmtDay, fmtDuration, fmtTime } from '../core/time';
import type {
  ActionResult, Aircraft, AlertRule, Contract, Decision, Flight, GameState, Head, HeadCandidate, HeadId, HeadLogLine, HeadProposal, HeadRules, MessageCat, Minute, Ref,
} from '../core/types';
import { hash, hashUnit } from '../core/util';
import { feasibility } from '../contracts';
import { setCompleteHook, setDepositHook, setSignHook } from '../contracts/accept';
import { counterBase, counterOdds } from '../contracts/counter';
import { sideRng } from '../contracts/paintTerms';
import { chainBackward, type ChainLeg } from '../contracts/plan';
import { bumpClient, LEVEL_NAME, LEVEL_ORDER, levelOf } from '../contracts/relations';
import { planPositioning } from '../contracts/schedule';
import { applyCrewFix, crewControl, flightCrewStatus, rerosterFrom, setHourlyHook, shortFlights } from '../crew';
import { setFixHook } from '../crew/control';
import { takesPublishedOff, v09Stats } from '../crew/dayPlan';
import { dutyNeed, type ChainShape } from '../crew/duties';
import { crewName } from '../crew/generate';
import { hireCrew } from '../crew/hr';
import { restOf } from '../crew/restPlan';
import { crewPlan, roundTargets, roundUpQuote } from '../crew/sets';
import { bestSlip } from '../crew/slip';
import { cardMeta, checkCard, checkClashCard } from '../problems';
import { achievementProgress, setHeadUnlockHook } from './achievements';
import { applyDecisionOption, crewReadyAt, setReceivableHook } from './events';
import { cancelCheck, checkCostOf, checkStatus, nextPlanned, planA, suggestC } from './maintenance';
import { usd } from './util';

const H = () => BAL.v09.heads;

export interface HeadView {
  id: HeadId; title: string; icon: string; unlocked: boolean; unlockText: string;
  progress: { label: string; have: number; need: number } | null;
  person: { name: string; skill: number; salary: number; since: Minute } | null;
  candidates: HeadCandidate[]; on: boolean; rules: HeadRules;
  does: string[]; never: string[]; proposals: HeadProposal[]; log: HeadLogLine[];
  handled: number; mistakes: number; overridden: number;
}

/** Default rules per head (§5.2). */
export function defaultRules(id: HeadId): HeadRules {
  switch (id) {
    case 'opsControl': return { maxDelayMin: H().ops.maxDelayMin as 60 | 120 | 180, standbyFirst: true };
    case 'crewDesk': return { fixMax: H().desk.fixMax, jetMax: 0, autoHire: false };
    case 'credit': return { waiveTrusted: true, depositSlow: true };
    case 'fleetPlanner': return { autoFerryMax: 0 };
    case 'watch': return { alerts: [] };
    default: return {};
  }
}

export function lockedHead(id: HeadId): Head {
  return { id, unlockedAt: null, hired: null, on: true, rules: defaultRules(id), proposals: [], log: [], handled: 0, mistakes: 0, overridden: 0 };
}

/** The head's record (a locked default when the save has none). */
const headOf = (g: GameState, id: HeadId): Head => g.heads?.[id] ?? lockedHead(id);
/** The head when hired and switched on. */
function active(g: GameState, id: HeadId): Head | null {
  const h = g.heads?.[id];
  return h && h.hired && h.on ? h : null;
}
const rulesOf = (h: Head): HeadRules => ({ ...defaultRules(h.id), ...h.rules });
const firstName = (h: Head) => h.hired?.name.split(' ')[0] ?? HEAD_DEFS[h.id].title;

/** The achievement that earns each head. */
const EARNED_BY: Record<HeadId, string> = {
  opsControl: 'cleanSheet', maintPlanner: 'cOnTime', crewDesk: 'fullCover', analyst: 'fiveFlown', credit: 'paidInTheEnd', fleetPlanner: 'widebody', watch: 'reliable',
};

/** Unlock progress (§5.1), null when unlocked. Pure. */
export function headProgress(g: GameState, id: HeadId): { label: string; have: number; need: number } | null {
  if (headOf(g, id).unlockedAt !== null) return null;
  return achievementProgress(g, EARNED_BY[id]);
}

/** One head as the Team view shows it. Pure. */
export function headView(g: GameState, id: HeadId): HeadView {
  const h = headOf(g, id);
  const def = HEAD_DEFS[id];
  return {
    id, title: def.title, icon: def.icon, unlocked: h.unlockedAt !== null, unlockText: def.unlockText, progress: headProgress(g, id),
    person: h.hired ? { ...h.hired } : null, candidates: h.hired ? [] : (h.candidates ?? []), on: h.on, rules: rulesOf(h),
    does: def.does, never: def.never, proposals: h.proposals, log: h.log, handled: h.handled, mistakes: h.mistakes, overridden: h.overridden,
  };
}

/** All seven, in the Team list order. Pure. */
export function headsView(g: GameState): HeadView[] {
  return HEAD_IDS.map((id) => headView(g, id));
}

// ---------- load, unlock, candidates ----------

/** load / init: every head present (locked by default), rules completed with the defaults. */
export function loadHeads(g: GameState): void {
  const hs = (g.heads ??= {} as Record<HeadId, Head>);
  for (const id of HEAD_IDS) {
    const h = (hs[id] ??= lockedHead(id));
    h.rules = rulesOf(h);
    h.proposals ??= [];
    h.log ??= [];
  }
}

const YEARS: [number, number][] = [[4, 8], [9, 15], [16, 28]];

/** Three candidates (junior, mid, senior) from a side stream: deterministic per game, head and round. */
export function rollCandidates(g: GameState, id: HeadId, round: number): HeadCandidate[] {
  const r: RngHolder = sideRng(g, `head:${id}:${round}`);
  const country = AIRPORT_BY_CODE[g.company.homeBase]?.country ?? '';
  const mix = CREW_MIX[country] ?? DEFAULT_MIX;
  const blurbs = HEAD_DEFS[id].blurbs;
  // Never a name a crew member, a hired head or another candidate already has (re-drawn, a few tries).
  const taken = new Set(Object.values(g.crew).map((c) => `${c.first} ${c.last}`));
  for (const x of Object.values(g.heads ?? {})) {
    if (x?.hired) taken.add(x.hired.name);
    for (const k of x?.candidates ?? []) taken.add(k.name);
  }
  return H().tiers.map(([lo, hi, mult], i) => {
    let first = '';
    let last = '';
    for (let tries = 0; tries < 8 && (!first || taken.has(`${first} ${last}`)); tries++) {
      const nat = weightedPick(r, mix, ([, w]) => w)?.[0] ?? 'GB';
      const kit = NAMES[nat] ?? Object.values(NAMES)[0];
      const female = next(r) < 0.5;
      const firsts = female ? kit.f : kit.m;
      first = firsts[int(r, 0, firsts.length - 1)];
      const li = int(r, 0, kit.last.length - 1);
      last = female && kit.lastF ? kit.lastF[li] : kit.last[li];
    }
    taken.add(`${first} ${last}`);
    return {
      name: `${first} ${last}`, years: int(r, YEARS[i][0], YEARS[i][1]), skill: Math.round(range(r, lo, hi) * 100) / 100,
      salary: Math.round((H().salary[id] * mult) / 100) * 100, blurb: blurbs[i % blurbs.length],
    };
  });
}

/** Unlocks pending a combined backfill message (load), per game. Runtime only. */
const backfill = new WeakMap<GameState, HeadId[]>();

/** An achievement earned a head: candidates and (unless part of a backfill) the "You've earned" message and card. */
export function unlockHead(g: GameState, id: HeadId, silent = false): void {
  loadHeads(g);
  const h = g.heads![id];
  if (h.unlockedAt !== null) return;
  h.unlockedAt = g.now;
  h.candidates = rollCandidates(g, id, 0);
  if (silent) {
    const xs = backfill.get(g) ?? [];
    xs.push(id);
    backfill.set(g, xs);
    return;
  }
  const t = HEAD_DEFS[id].title;
  pushMessage(g, {
    tone: 'good', cat: 'company', topic: 'head', title: `You've earned ${/^[AEIOU]/.test(t) ? 'an' : 'a'} ${t}`,
    body: `${HEAD_DEFS[id].earnedText}. Three candidates are waiting on Company › Team.`, ref: { kind: 'head', id }, cue: 'headUnlocked',
  });
}

const WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven'];

/** load: heads an older save had already earned, in one message (never hired automatically). */
export function announceBackfill(g: GameState): void {
  const ids = backfill.get(g);
  backfill.delete(g);
  if (!ids?.length) return;
  const names = ids.map((id) => HEAD_DEFS[id].title);
  pushMessage(g, {
    tone: 'good', cat: 'company', topic: 'head',
    title: ids.length === 1 ? `A department head is available: ${names[0]}` : `${WORDS[ids.length] ?? ids.length} department heads are available`,
    body: `Earned before v0.9${ids.length === 1 ? '' : `: ${names.join(', ')}`}. Choose a candidate on Company › Team.`, ref: { kind: 'head', id: ids[0] }, cue: null,
  });
}

setHeadUnlockHook(unlockHead);

// ---------- player actions ----------

export function hireHead(g: GameState, id: HeadId, candidate: number): ActionResult {
  loadHeads(g);
  const h = g.heads![id];
  if (!h) return { ok: false, error: 'Unknown department' };
  if (h.unlockedAt === null) return { ok: false, error: `Not earned yet: ${HEAD_DEFS[id].unlockText}` };
  if (h.hired) return { ok: false, error: `${h.hired.name} already runs it` };
  if (h.firedAt !== undefined && g.now < h.firedAt + H().rehireDays * DAY) return { ok: false, error: `New candidates from ${fmtDay(h.firedAt + H().rehireDays * DAY)}` };
  const c = h.candidates?.[candidate];
  if (!c) return { ok: false, error: 'Choose a candidate' };
  h.hired = { name: c.name, skill: c.skill, salary: c.salary, since: g.now };
  h.on = true;
  h.candidates = [];
  delete h.firedAt;
  pushMessage(g, { tone: 'good', cat: 'company', topic: 'head', title: `${c.name} joins as ${HEAD_DEFS[id].title}`, body: `${usd(c.salary)} a month. Set the rules on Company › Team.`, ref: { kind: 'head', id }, cue: 'headHired' });
  return { ok: true, msg: `${c.name} hired` };
}

export function fireHead(g: GameState, id: HeadId): ActionResult {
  const h = g.heads?.[id];
  if (!h?.hired) return { ok: false, error: 'Nobody to let go' };
  const pay = Math.round(h.hired.salary * H().severanceMonths);
  post(g, 'salaries', -pay);
  const name = h.hired.name;
  h.hired = null;
  h.firedAt = g.now;
  h.candidates = [];
  h.proposals = [];
  return { ok: true, msg: `${name} leaves with ${usd(pay)} severance. New candidates in ${H().rehireDays} days.` };
}

export function setHeadOn(g: GameState, id: HeadId, on: boolean): ActionResult {
  const h = g.heads?.[id];
  if (!h?.hired) return { ok: false, error: 'Hire someone first' };
  h.on = on;
  return { ok: true, msg: `${HEAD_DEFS[id].title} ${on ? 'on' : 'off'}` };
}

const ALERT_KINDS: AlertRule['kind'][] = ['cashBelow', 'delayOver', 'offerOver', 'idleOver', 'clientDown', 'checkDue'];

export function setHeadRules(g: GameState, id: HeadId, rules: Partial<HeadRules>): ActionResult {
  loadHeads(g);
  const h = g.heads![id];
  if (!h) return { ok: false, error: 'Unknown department' };
  if (rules.maxDelayMin !== undefined && ![60, 120, 180].includes(rules.maxDelayMin)) return { ok: false, error: 'Delay limit 1, 2 or 3 hours' };
  for (const k of ['fixMax', 'jetMax', 'autoFerryMax'] as const) if (rules[k] !== undefined && !(rules[k]! >= 0 && rules[k]! <= 1_000_000)) return { ok: false, error: 'Limit between $0 and $1M' };
  if (rules.alerts) {
    if (rules.alerts.length > 8) return { ok: false, error: 'Up to 8 rules' };
    if (rules.alerts.some((a) => !ALERT_KINDS.includes(a.kind) || !Number.isFinite(a.value))) return { ok: false, error: 'Unknown rule' };
  }
  h.rules = { ...rulesOf(h), ...rules };
  if (rules.alerts) {
    // v0.9 round 4: a new rule (no id, or one already taken) gets its id here, from the game's own sequence.
    const taken = new Set<string>();
    h.rules.alerts = rules.alerts.map((a) => {
      const id = a.id && !taken.has(a.id) ? a.id : nextId(g, 'ar');
      taken.add(id);
      return { ...a, id };
    });
  }
  return { ok: true, msg: 'Rules saved' };
}

export function acceptProposal(g: GameState, id: HeadId, proposalId: string): ActionResult {
  const h = g.heads?.[id];
  const p = h?.proposals.find((x) => x.id === proposalId);
  if (!h || !p) return { ok: false, error: 'Proposal not found' };
  const r = runProposal(g, p);
  // A C-check slot stays proposed until the check is booked (the UI opens the check planner on Accept).
  if (r.ok && p.kind !== 'cSlot') h.proposals = h.proposals.filter((x) => x !== p);
  return r;
}

/** The subject of a proposal (a dismissal holds for it until the situation changes, or 14 days). */
function subjectOf(p: Pick<HeadProposal, 'kind' | 'data'>): string {
  return `${p.kind}:${['aircraftId', 'at', 'to', 'contractId', 'family'].map((k) => p.data[k]).filter((x) => x !== undefined).join(':')}`;
}
const dismissedNow = (g: GameState, h: Head, p: Pick<HeadProposal, 'kind' | 'data'>): boolean => (h.dismissed?.[subjectOf(p)] ?? 0) > g.now;

export function dismissProposal(g: GameState, id: HeadId, proposalId: string): ActionResult {
  const h = g.heads?.[id];
  const p = h?.proposals.find((x) => x.id === proposalId);
  if (!h || !p) return { ok: false, error: 'Proposal not found' };
  h.proposals = h.proposals.filter((x) => x !== p);
  // v0.9 round 4: no once a day: the subject is not proposed again for 14 days (sooner when the situation changes).
  const until = g.now + H().dismissDays * DAY;
  const d = (h.dismissed ??= {});
  for (const k of Object.keys(d)) if (d[k] <= g.now) delete d[k];
  d[subjectOf(p)] = until;
  log(h, { t: g.now, kind: 'overridden', text: `Dismissed until ${fmtDay(until)}: ${p.text}`, ...(p.ref ? { ref: p.ref } : {}) });
  return { ok: true, msg: `Dismissed until ${fmtDay(until)}` };
}

function runProposal(g: GameState, p: HeadProposal): ActionResult {
  switch (p.kind) {
    case 'ferryHome':
    case 'position': {
      const r = ferryAircraft(g, String(p.data.aircraftId), String(p.data.to), typeof p.data.arriveBy === 'number' ? p.data.arriveBy : undefined, p.data.contractId ? String(p.data.contractId) : undefined);
      return r.ok ? { ok: true, msg: r.msg } : r;
    }
    case 'cSlot':
      return { ok: true, msg: 'Pick the slot in the check planner' };
    case 'hire': {
      const plan = crewPlan(g).find((x) => x.family === p.data.family);
      if (!plan) return { ok: false, error: 'No crew plan for that family any more' };
      const q = roundUpQuote(g, plan, Number(p.data.target));
      if (!q.lines.length) return { ok: true, msg: 'The sets are complete already' };
      let n = 0;
      for (const l of q.lines) {
        const r = hireCrew(g, l.req);
        if (!r.ok) return n ? { ok: true, msg: `Hired ${n}; ${r.error}` } : r;
        n += l.req.count;
      }
      return { ok: true, msg: `Hired ${n} crew` };
    }
  }
  return { ok: false, error: 'Unknown proposal' };
}

// ---------- shared: log, messages, mistakes ----------

let acting = false;

function log(h: Head, line: HeadLogLine): void {
  h.log.unshift(line);
  if (h.log.length > 12) h.log.length = 12;
}

/** A handled item: counters, the log line, one quiet message (topic 'head', the headDone chime); the override watch. */
function done(g: GameState, h: Head, cat: MessageCat, title: string, body: string, ref?: Ref, mistake?: string): void {
  h.handled++;
  v09Stats(g).headHandled++;
  log(h, { t: g.now, kind: 'done', text: title, ...(ref ? { ref } : {}) });
  if (mistake) {
    h.mistakes++;
    v09Stats(g).headMistakes++;
    log(h, { t: g.now, kind: 'mistake', text: mistake, ...(ref ? { ref } : {}) });
  }
  if (ref) {
    const rec = (h.recent ?? []).filter(([, until]) => until > g.now);
    rec.push([ref.id, g.now + 120]);
    h.recent = rec.slice(-20);
  }
  pushMessage(g, { tone: 'info', cat, topic: 'head', title, body: mistake ? `${body} ${mistake}` : body, ...(ref ? { ref } : {}), cue: 'headDone' });
}

/** A mistake roll, (1 − skill) × 0.35, on a side stream of the engine RNG (keyed: the main sequence is untouched). */
export const mistakeRoll = (g: GameState, skill: number, key: string) => chance(sideRng(g, `mistake:${key}`), (1 - skill) * H().mistake);
const slips = (g: GameState, h: Head) => mistakeRoll(g, h.hired?.skill ?? 0.7, `${h.id}:${g.now}:${h.handled}:${h.mistakes}:${h.log.length}`);

/** A player's fix to a flight (or late-payment choice on a receivable) a head handled within 2 h counts as overridden. */
function overridden(g: GameState, ref: Ref): void {
  if (acting || !g.heads) return;
  for (const h of Object.values(g.heads)) {
    const i = (h.recent ?? []).findIndex(([id, until]) => id === ref.id && until > g.now);
    if (i < 0) continue;
    h.recent!.splice(i, 1);
    h.overridden++;
    log(h, { t: g.now, kind: 'overridden', text: `You changed what ${firstName(h)} did`, ref });
  }
}
setFixHook((g, flightId) => overridden(g, { kind: 'flight', id: flightId }));
setReceivableHook((g, receivableId) => overridden(g, { kind: 'receivable', id: receivableId }));

// ---------- decisions (Ops Control, credit control) ----------

/**
 * The decision hook (core/messages.ts): a hired, switched-on head takes a routine decision the moment it is posted,
 * by the player's rules, and says so in one quiet message. Anything else is left to the player.
 */
function onDecision(g: GameState, d: Decision): boolean {
  if (acting || d.data?.player) return false;
  acting = true;
  try {
    if (d.kind === 'sickCrew') return opsSick(g, d);
    if (d.kind === 'crewShort') return opsGate(g, d);
    if (d.kind === 'latePayment') return creditLate(g, d);
    return false;
  } finally {
    acting = false;
  }
}
setDecisionHook(onDecision);

/** Crew on the flight's trip. */
function crewOn(g: GameState, flightId: string): Set<string> {
  const f = g.flights[flightId];
  const d = f?.dutyId ? g.duties[f.dutyId] : undefined;
  const p = d ? g.pairings[d.pairingId] : undefined;
  return new Set((p?.slots ?? []).filter((s) => s.crewId).map((s) => s.crewId!));
}

/** The standby window of a crew member that covers a departure (called or not). */
const standbyFor = (c: { standby?: { from: Minute; to: Minute; at?: string }[] }, f: Flight, now: Minute) => c.standby?.find((s) => s.from <= f.std && s.to > now);

/**
 * Ops Control: a sick call is answered with a call-in when a legal replacement is ready in time. "Standby first"
 * (§5.3): the replacement comes from a standby window or is free without a day off; with the rule off the sick call
 * stays with the player (the gate delay, below, is the head's other tool).
 */
function opsSick(g: GameState, d: Decision): boolean {
  const h = active(g, 'opsControl');
  const f = g.flights[String(d.data?.flightId ?? '')];
  if (!h || !f || f.status !== 'scheduled' || !d.options.some((o) => o.id === 'callIn')) return false;
  const R = rulesOf(h);
  if (R.standbyFirst === false) return false;
  // The call-in is tried on a copy first: a refused one must leave the roster as the player will find it.
  const maxDelay = R.maxDelayMin ?? 120;
  const before = crewOn(g, f.id);
  const works = (x: GameState): boolean => {
    const r = applyDecisionOption(x, d, 'callIn');
    const xf = x.flights[f.id];
    const lvl = flightCrewStatus(x, f.id).level;
    if (!r.ok || !xf || (lvl !== 'ok' && lvl !== 'tight')) return false;
    const ac = xf.aircraftId ? x.fleet[xf.aircraftId] : undefined;
    if (ac && crewReadyAt(x, xf, ac) > xf.std + maxDelay) return false;
    // Standby first: nobody is pulled off a published day off, and no day off is swapped for the work (§R.5: that
    // ask is the player's).
    const xd = xf.dutyId ? x.duties[xf.dutyId] : undefined;
    return [...crewOn(x, f.id)].filter((id) => !before.has(id)).every((id) => {
      const c = x.crew[id];
      if (!c || !!standbyFor(c, xf, x.now)) return true;
      const same = (a?: number[], b?: number[]) => (a ?? []).length === (b ?? []).length && (a ?? []).every((k, i) => k === b![i]);
      return same(c.off, g.crew[id]?.off) && (!xd || !takesPublishedOff(x, c, xd.report, xd.release));
    });
  };
  // The trial on the copy raises no cue or pause in the live game (core/pause.ts).
  if (!isolatePauses(() => works(structuredClone(g)))) return false;
  // Who was on standby over the departure before the call-in (a call-out closes the window).
  const onSby = new Map(Object.values(g.crew).map((c) => [c.id, standbyFor(c, f, g.now)]));
  if (!works(g)) return false;
  const added = [...crewOn(g, f.id)].filter((id) => !before.has(id)).map((id) => g.crew[id]).filter((c) => !!c);
  const sick = g.crew[String(d.data?.crewId ?? '')];
  const who = added.length ? added.map((c) => crewName(c)).join(' and ') : 'a replacement';
  const first = added[0];
  const sby = first ? onSby.get(first.id) : undefined;
  // §5.3 the second-best call, only when it is real: the replacement was not on standby although someone of that
  // role was (a ticket where a standby was free), never above the desk's fix limit.
  const spare = !!first && !sby && Object.values(g.crew).some((c) => c.id !== first.id && c.role === first.role && c.id !== sick?.id && !!onSby.get(c.id));
  const ticket = Math.min(1_200, rulesOf(headOf(g, 'crewDesk')).fixMax ?? H().desk.fixMax);
  const mistake = spare && slips(g, h) ? `${firstName(h)} booked a ${usd(ticket)} ticket for a positioning the standby roster could have covered.` : undefined;
  if (mistake) post(g, 'deadhead', -ticket);
  const where = first ? `${crewName(first).split(' ')[0]} ${sby ? `is on standby at ${sby.at ?? first.base}` : `was free at ${first.base}`}, no delay.` : 'The trip is crewed again, no delay.';
  done(g, h, 'crew', `Ops Control called in ${who} for ${f.no}`, `Sick call${sick ? `: ${crewName(sick)}` : ''}. ${where}`, { kind: 'flight', id: f.id }, mistake);
  return true;
}

/** Ops Control: a crew-short flight at the gate waits for a legal crew when one is ready within the limit and no penalty is due. */
function opsGate(g: GameState, d: Decision): boolean {
  const h = active(g, 'opsControl');
  const f = g.flights[String(d.data?.flightId ?? '')];
  const ac = f?.aircraftId ? g.fleet[f.aircraftId] : undefined;
  if (!h || !f || !ac || f.status !== 'scheduled' || !d.options.some((o) => o.id === 'delay')) return false;
  const ready = crewReadyAt(g, f, ac);
  const wait = Math.max(0, ready - Math.max(g.now, f.std + f.delay));
  if (wait > (rulesOf(h).maxDelayMin ?? 120)) return false;
  const c = f.contractId ? g.contracts[f.contractId] : undefined;
  const late = ready - (f.schedStd ?? f.std);
  // v0.9 round 4: past 3 h late (VIP: 30 min) a hold costs relation or penalty on every contract kind: the player's call.
  if (c && late >= (c.requirements.standards === 'vip' ? 30 : 180)) return false;
  const r = applyDecisionOption(g, d, 'delay');
  if (!r.ok) return false;
  // §5.3 the second-best call: the slot re-filed later than the crew needed (handling overtime).
  const slip = slips(g, h);
  if (slip) post(g, 'airportFees', -600);
  done(g, h, 'ops', `Ops Control held ${f.no} for a legal crew`, `${r.msg ? `${r.msg}. ` : ''}A ${fmtDuration(Math.max(5, wait))} wait, no penalty.`, { kind: 'flight', id: f.id },
    slip ? `${firstName(h)} re-filed the slot 20 min later than the crew needed: $600 handling overtime.` : undefined);
  return true;
}

/** Credit control: a late payer is waived (Trusted and Partner, by the rule) or waited for. */
function creditLate(g: GameState, d: Decision): boolean {
  const h = active(g, 'credit');
  if (!h) return false;
  const cl = g.clients[String(d.data?.clientId ?? '')];
  const lv = LEVEL_ORDER.indexOf(levelOf(g, cl));
  const opt = rulesOf(h).waiveTrusted && lv >= LEVEL_ORDER.indexOf('trusted') && d.options.some((o) => o.id === 'waive') ? 'waive' : 'wait';
  const r = applyDecisionOption(g, d, opt);
  if (!r.ok) return false;
  const name = cl?.name ?? 'the client';
  // §5.3 the second-best call: no phone call to go with it (the client feels ignored).
  const slip = !!cl && slips(g, h);
  if (slip) bumpClient(g, cl.id, -2, 'A late payment handled without a call');
  done(g, h, 'finance', `Credit control: ${opt === 'waive' ? `waived the interest for ${name}` : `we wait for ${name}`}`, `${d.title}. ${r.msg ? `${r.msg}.` : ''}`.trim(), d.ref,
    slip ? `${firstName(h)} sent a form letter instead of calling (relation −2).` : undefined);
  return true;
}

// ---------- daily and monthly work ----------

/** Daily (ops): skill growth, rehire candidates, expired proposals, then each head's daily job. */
export function dailyHeads(g: GameState): void {
  if (!g.heads) return;
  for (const h of Object.values(g.heads)) {
    if (h.hired) {
      const d = Math.floor((g.now - h.hired.since) / DAY);
      if (d > 0 && d % H().growthDays === 0) h.hired.skill = Math.min(H().cap, Math.round((h.hired.skill + H().growth) * 100) / 100);
    } else if (h.firedAt !== undefined && g.now >= h.firedAt + H().rehireDays * DAY && !h.candidates?.length) {
      h.candidates = rollCandidates(g, h.id, Math.floor(h.firedAt));
    }
    h.proposals = h.proposals.filter((p) => p.expires > g.now && !(p.kind === 'cSlot' && nextPlanned(g, String(p.data.aircraftId), 'C')));
  }
  acting = true;
  try {
    maintPlanner(g);
    creditChase(g);
    fleetPlanner(g);
  } finally {
    acting = false;
  }
}

/** Month end (before the statement closes): salaries under 'salaries'; the crew desk's hire proposal. */
export function monthlyHeads(g: GameState): void {
  if (!g.heads) return;
  let pay = 0;
  for (const h of Object.values(g.heads)) if (h.hired) pay += h.hired.salary;
  if (pay) post(g, 'salaries', -pay);
  acting = true;
  try {
    crewDeskHires(g);
  } finally {
    acting = false;
  }
}

function propose(g: GameState, h: Head, p: Omit<HeadProposal, 'id' | 't' | 'expires'>, hours: number): HeadProposal {
  const x: HeadProposal = { id: `hp${hash(`${h.id}:${g.now}:${p.kind}:${JSON.stringify(p.data)}`).toString(36)}`, t: g.now, expires: g.now + hours * 60, ...p };
  h.proposals.push(x);
  log(h, { t: g.now, kind: 'proposal', text: p.text, ...(p.ref ? { ref: p.ref } : {}) });
  pushMessage(g, {
    tone: 'info', cat: h.id === 'maintPlanner' ? 'tech' : h.id === 'crewDesk' ? 'crew' : 'ops', topic: 'head', title: `${firstName(h)} proposes: ${p.text}`,
    body: `About ${usd(p.cost)}. Accept or dismiss on Company › Team.`, ref: { kind: 'head', id: h.id }, cue: 'decision',
  });
  return x;
}

/**
 * Maintenance planner (after planChecks): books A-checks ≥ 75 % used or due within 14 days into ground gaps (never by
 * dropping legs, never a C-check), moves a planned A-check a flight now overlaps, and proposes the C-check slot.
 */
function maintPlanner(g: GameState): void {
  const h = active(g, 'maintPlanner');
  if (!h) return;
  const M = H().maint;
  for (const ac of Object.values(g.fleet)) {
    if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') continue;
    const st = checkStatus(g, ac);
    const planned = nextPlanned(g, ac.id, 'A');
    if (planned && planned.status === 'planned' && planned.start > g.now) {
      const clash = flightsOf(g, ac.id).find((f) => f.status === 'scheduled' && f.std < planned.end && f.sta > planned.start);
      if (clash && cancelCheck(structuredClone(g), planned.id).ok) {
        const due = Math.max(st.aDue, g.now + DAY);
        // v0.9 round 4: the replacement slot is found on a copy first; the booking is released only when one exists.
        const fits = isolatePauses(() => {
          const x = structuredClone(g);
          return cancelCheck(x, planned.id).ok && planA(x, x.fleet[ac.id], due, true);
        });
        if (!fits) {
          // Kept as booked (the check waits for the inbound leg); one warning per booking, the clash as its card.
          const key = `clash:${planned.id}`;
          if (!(h.recent ?? []).some(([id, until]) => id === key && until > g.now)) {
            h.recent = [...(h.recent ?? []).filter(([, until]) => until > g.now), [key, planned.start]];
            pushMessage(g, {
              tone: 'warn', cat: 'tech', topic: 'head', title: `${firstName(h)} can't move ${ac.reg}'s A-check: ${clash.no} flies then`,
              body: `No other free slot before it is due ${fmtDay(st.aDue)}. It stays booked for ${fmtDay(planned.start)} ${fmtTime(planned.start)} at ${planned.at}: move the check or the flight on the Fleet screen.`,
              ref: { kind: 'aircraft', id: ac.id }, ...cardMeta(checkClashCard(g, planned.id) ?? checkCard(g, ac.id)),
            });
          }
          continue;
        }
        cancelCheck(g, planned.id);
        planA(g, ac, due, true);
        const m = nextPlanned(g, ac.id, 'A');
        const early = !!m && slips(g, h);
        const lost = Math.round(checkCostOf(ac, 'A') * 0.15);
        if (early) post(g, 'checks', -lost);
        done(g, h, 'tech', m ? `${firstName(h)} moved ${ac.reg}'s A-check to ${fmtDay(m.start)} ${fmtTime(m.start)}` : `${firstName(h)} took ${ac.reg}'s A-check off: ${clash.no} flies then`,
          m ? `It clashed with ${clash.no}; the new slot is at ${m.at}.` : 'No other free slot before it is due: book one on the Fleet screen.', { kind: 'aircraft', id: ac.id },
          early ? `The new slot is about 15 % early, so that share of the interval is lost (${usd(lost)}).` : undefined);
        continue;
      }
    }
    if (!planned && (st.aUsed >= M.aAt || st.aDue - g.now <= M.aDays * DAY) && planA(g, ac, Math.max(st.aDue, g.now + DAY), true)) {
      const m = nextPlanned(g, ac.id, 'A')!;
      const early = slips(g, h);
      const lost = Math.round(checkCostOf(ac, 'A') * 0.15);
      if (early) post(g, 'checks', -lost);
      done(g, h, 'tech', `${firstName(h)} booked ${ac.reg}'s A-check`, `${fmtDay(m.start)} ${fmtTime(m.start)} at ${m.at}${m.at === g.company.homeBase ? '' : ' (line station)'}.`, { kind: 'aircraft', id: ac.id },
        early ? `It went in about 15 % early, so that share of the interval is lost (${usd(lost)}).` : undefined);
    }
    if (!nextPlanned(g, ac.id, 'C') && st.cDue - g.now <= M.cDays * DAY && !h.proposals.some((p) => p.kind === 'cSlot' && p.data.aircraftId === ac.id) && !dismissedNow(g, h, { kind: 'cSlot', data: { aircraftId: ac.id } })) {
      const s = suggestC(g, ac, st.cDue);
      if (s) propose(g, h, { kind: 'cSlot', text: `${ac.reg} C-check ${fmtDay(s.from)}–${fmtDay(s.to)}`, cost: checkCostOf(ac, 'C'), ref: { kind: 'aircraft', id: ac.id }, data: { aircraftId: ac.id, reg: ac.reg, from: s.from, to: s.to } }, 14 * 24);
    }
  }
}

/** Credit control: reminders at due + 3 and + 10 days, each raising the chance the invoice is paid within 7 days. */
function creditChase(g: GameState): void {
  const h = active(g, 'credit');
  if (!h) return;
  const C = H().credit;
  for (const r of g.finance.receivables) {
    if (r.paid !== null) continue;
    const over = Math.floor((g.now - r.due) / DAY);
    const step = C.remind.filter((d) => over >= d && (r.chased ?? 0) < d).pop();
    if (step === undefined) continue;
    r.chased = step;
    const cl = g.clients[r.clientId];
    const rr = sideRng(g, `chase:${r.id}:${step}`);
    if (r.payAt > g.now + 7 * DAY && chance(rr, C.base + C.perSkill * (h.hired?.skill ?? 0.7))) {
      r.payAt = g.now + int(rr, 1, 7) * DAY;
      schedule(g, r.payAt, 'payment', r.id);
    }
    // §5.3 any client may be chased a little early (the mistake roll on every reminder).
    const early = !!cl && slips(g, h);
    if (early) bumpClient(g, r.clientId, -2, 'Chased an invoice a little early');
    done(g, h, 'finance', `Credit control reminded ${cl?.name ?? 'a client'}`, `${usd(r.amount)} for ${r.desc}, ${over} days late.`, r.contractId ? { kind: 'contract', id: r.contractId } : undefined,
      early ? `${firstName(h)} chased a ${LEVEL_NAME[levelOf(g, cl)]} client too early (relation −2).` : undefined);
  }
}

/** Credit control's deposit rule: slow payers (reliability < 0.8) give 30 % (governments 20 %) on a new charter. */
setDepositHook((g, c: Contract) => {
  const h = active(g, 'credit');
  const cl = g.clients[c.clientId];
  if (!h || !rulesOf(h).depositSlow || !cl || cl.payReliability >= H().credit.slow) return 0;
  return cl.kind === 'government' ? H().credit.govDeposit : H().credit.deposit;
});

/** Block minutes of an empty move, 0 without a route. */
function emptyBlock(typeId: string, from: string, to: string): number {
  try {
    return Math.round(blockMinutes(typeId, from, to));
  } catch {
    return 0;
  }
}

/** Ferry cost estimate: fuel, maintenance and fees of the legs. */
function legsCost(g: GameState, typeId: string, legs: { std: number; sta: number }[]): number {
  const t = typeOf(typeId);
  const wide = t.body === 'wide' ? 1 : 0;
  return Math.round(legs.reduce((s, l) => s + ((l.sta - l.std) / 60) * (t.fuelTBH * g.market.fuelPrice + t.maintBH) + BAL.airportFees[wide], 0));
}

/** A chain's shape for the crew rules (duties.ts dutyNeed). */
const shapeOf = (legs: { from: string; to: string; std: Minute; sta: Minute }[]): ChainShape => ({ from: legs[0].from, std: legs[0].std, legs: legs.map((l) => ({ from: l.from, to: l.to, std: l.std, sta: l.sta })) });

/** The crew plan of an empty chain: '' when one crew flies it as a basic day, else the plan or the crew change (§W). */
function chainCrewText(g: GameState, ac: Aircraft, chain: ChainLeg[]): string {
  const rest = restOf(g, ac.id);
  const need = dutyNeed(g, ac.typeId, rest, shapeOf(chain));
  if (need.mode !== 'none') return need.mode === 'basic' ? '' : need.text;
  return bestSlip(g, ac.typeId, rest, shapeOf(chain))?.text ?? 'Too long for one crew';
}

/**
 * §5.3 positioning the day before: a contract's first revenue leg within three days whose same-day positioning leaves
 * the crew under `marginMin` of FDP (or no one crew can fly the positioning and the first duty) → fly the empty legs
 * the day before, arriving `arriveBeforeMin` ahead of the leg (the crew's rest). Long positioning says how it is
 * crewed (fuel stops are legs, a crew change at the stop). Auto-run under autoFerryMax, else a proposal.
 */
function positionPlans(g: GameState, h: Head): void {
  const F = H().fleet;
  const seen = new Set<string>();
  for (const f0 of Object.values(g.flights).sort((a, b) => a.std - b.std)) {
    if (f0.kind !== 'revenue' || f0.status !== 'scheduled' || !f0.aircraftId || !f0.contractId || f0.std <= g.now + F.arriveBeforeMin || f0.std > g.now + 3 * DAY) continue;
    const key = `${f0.contractId}:${f0.aircraftId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = g.contracts[f0.contractId];
    const ac = g.fleet[f0.aircraftId];
    if (!c || !ac || (c.status !== 'signed' && c.status !== 'active') || ac.status !== 'available' || ac.flightId) continue;
    const fs = flightsOf(g, ac.id);
    // The contract's first revenue leg on this aircraft, with same-day positioning landing where it starts.
    if (fs.some((f) => f.contractId === c.id && f.kind === 'revenue' && f.status !== 'cancelled' && f.std < f0.std)) continue;
    const pos = fs.filter((f) => f.kind === 'positioning' && f.contractId === c.id && f.status === 'scheduled' && f.sta <= f0.std && f.sta > f0.std - F.arriveBeforeMin);
    if (!pos.length || pos[pos.length - 1].to !== f0.from) continue;
    const d = f0.dutyId ? g.duties[f0.dutyId] : undefined;
    const day = [...pos, ...(d ? d.flightIds.map((id) => g.flights[id]).filter((x): x is Flight => !!x && x.std >= f0.std) : [f0])].sort((a, b) => a.std - b.std);
    const need = dutyNeed(g, ac.typeId, restOf(g, ac.id), shapeOf(day));
    const margin = need.mode === 'none' ? 0 : need.max - need.fdp;
    if (margin >= F.marginMin) continue;
    if (h.proposals.some((p) => p.kind === 'position' && p.data.contractId === c.id && p.data.aircraftId === ac.id)) continue;
    const arriveBy = f0.std - F.arriveBeforeMin;
    const data = { aircraftId: ac.id, to: f0.from, arriveBy, contractId: c.id };
    if (dismissedNow(g, h, { kind: 'position', data })) continue;
    const chain = chainBackward(ac.typeId, pos[0].from, f0.from, g.now + BAL.ferryLeadMin, arriveBy);
    if (!chain?.length) continue;
    let cost = legsCost(g, ac.typeId, chain);
    const mistake = slips(g, h);
    if (mistake) cost = Math.round(cost * (1 + range(sideRng(g, `fp:${ac.id}:${g.now}`), 0.05, 0.1)));
    const why = need.mode === 'none' ? 'no one crew can fly the positioning and the first day' : `the crew's day would leave ${fmtDuration(margin)} of FDP`;
    const stops = chain.slice(0, -1).map((l) => l.to);
    const crewText = chainCrewText(g, ac, chain);
    const lim = rulesOf(h).autoFerryMax ?? 0;
    if (lim > 0 && cost <= lim) {
      const r = ferryAircraft(g, ac.id, f0.from, arriveBy, c.id);
      if (r.ok) done(g, h, 'ops', `${firstName(h)} positioned ${ac.reg} the day before ${c.title}`, `${r.msg ?? ''}: ${why}.${crewText ? ` ${crewText}.` : ''}`, { kind: 'aircraft', id: ac.id }, mistake ? 'The routing was 5–10 % dearer than the best.' : undefined);
      continue;
    }
    const text = `Position ${ac.reg} ${pos[0].from}–${f0.from}${stops.length ? ` via ${stops.join(', ')}` : ''} the day before ${c.title}: ${why}${crewText ? `. ${crewText}` : ''}`;
    propose(g, h, { kind: 'position', text, cost, ref: { kind: 'aircraft', id: ac.id }, data }, Math.max(1, Math.min(H().proposalH, Math.floor((arriveBy - g.now) / 60))));
  }
}

/** Fleet planner (daily): aircraft idle ≥ 48 h away from home with nothing in the next 72 h → a ferry home; positioning the day before a contract. */
function fleetPlanner(g: GameState): void {
  const h = active(g, 'fleetPlanner');
  if (!h) return;
  positionPlans(g, h);
  const F = H().fleet;
  const home = g.company.homeBase;
  for (const ac of Object.values(g.fleet)) {
    if (ac.at === home || ac.status !== 'available' || ac.flightId) continue;
    if (h.proposals.some((p) => p.data.aircraftId === ac.id)) continue;
    if (dismissedNow(g, h, { kind: 'ferryHome', data: { aircraftId: ac.id, at: ac.at, to: home } })) continue;
    const fs = flightsOf(g, ac.id);
    const last = fs.filter((f) => f.status === 'done').reduce((m, f) => Math.max(m, f.ata ?? f.sta), ac.bhSince !== undefined ? ac.bhSince * DAY : -Infinity);
    if (!(g.now - last >= F.idleH * 60)) continue;
    if (fs.some((f) => f.status === 'scheduled' && f.std < g.now + F.freeH * 60)) continue;
    if (Object.values(g.maintenance).some((m) => m.aircraftId === ac.id && m.status !== 'done' && m.status !== 'cancelled' && m.start < g.now + F.freeH * 60)) continue;
    const blk = emptyBlock(ac.typeId, ac.at, home);
    if (!blk) continue;
    let cost = legsCost(g, ac.typeId, [{ std: 0, sta: blk }]);
    const mistake = slips(g, h);
    if (mistake) cost = Math.round(cost * (1 + range(sideRng(g, `fp:${ac.id}:${g.now}`), 0.05, 0.1)));
    const fits = Object.values(g.offers).filter((o) => o.status === 'open' && o.pattern.kind === 'legs' && o.pattern.legs[0]?.from === ac.at).length;
    const text = `Ferry ${ac.reg} home from ${ac.at}${fits ? ` (or leave it there: ${fits} open offer${fits > 1 ? 's' : ''} start${fits > 1 ? '' : 's'} at ${ac.at})` : ''}`;
    const lim = rulesOf(h).autoFerryMax ?? 0;
    if (lim > 0 && cost <= lim) {
      const r = ferryAircraft(g, ac.id, home);
      if (r.ok) done(g, h, 'ops', `${firstName(h)} ferried ${ac.reg} home`, `${r.msg ?? ''}.`, { kind: 'aircraft', id: ac.id }, mistake ? 'The routing was 5–10 % dearer than the best.' : undefined);
      continue;
    }
    propose(g, h, { kind: 'ferryHome', text, cost, ref: { kind: 'aircraft', id: ac.id }, data: { aircraftId: ac.id, at: ac.at, to: home } }, H().proposalH);
  }
}

/** Crew desk (month end): a round-up hire proposal when a family is short of complete sets (or hires up to 4 itself). */
function crewDeskHires(g: GameState): void {
  const h = active(g, 'crewDesk');
  if (!h) return;
  for (const p of crewPlan(g)) {
    if (p.setsComplete >= p.setsNeeded) continue;
    const target = roundTargets(p).complete ?? p.setsNeeded;
    const q = roundUpQuote(g, p, target);
    if (!q.lines.length) continue;
    const who = q.lines.map((l) => `${l.req.count} ${l.req.role}`).join(', ');
    if (rulesOf(h).autoHire) {
      let n = 0;
      for (const l of q.lines) {
        if (n >= 4) break;
        const count = Math.min(l.req.count, 4 - n);
        if (hireCrew(g, { ...l.req, count }).ok) n += count;
      }
      // §5.3 the second-best call: one more than the round-up (a salary nobody needs yet).
      const extra = n > 0 && slips(g, h) && hireCrew(g, { ...q.lines[0].req, count: 1 }).ok;
      if (n) done(g, h, 'crew', `The crew desk hired ${n + (extra ? 1 : 0)} for the ${p.label}`, `Towards ${target} complete sets (short ${who}).`, undefined,
        extra ? `${firstName(h)} hired one ${q.lines[0].req.role} more than the round-up needs.` : undefined);
      continue;
    }
    if (h.proposals.some((x) => x.kind === 'hire' && x.data.family === p.family) || dismissedNow(g, h, { kind: 'hire', data: { family: p.family } })) continue;
    propose(g, h, { kind: 'hire', text: `Hire ${who} to complete ${target} ${p.label} sets`, cost: q.cost, data: { family: p.family, target } }, H().proposalH);
  }
}

// ---------- hourly work (crew desk, watch desk) ----------

/** The roster re-runs itself every hour (auto-fix); the desk adds a ticket, a call-in and (within its limit) a jet. */
const DESK_FIXES = ['deadhead', 'callIn', 'jet'] as const;

/** Crew desk (every 6 h): the cheapest Crew Control fix within the limit on amber flights (at most 3 a round). */
export function crewDeskHour(g: GameState): number {
  const h = active(g, 'crewDesk');
  if (!h) return 0;
  const R = rulesOf(h);
  let n = 0;
  for (const row of shortFlights(g)) {
    if (n >= 3) break;
    if (row.stage !== 'amber') continue;
    // Availability and cost only (no state copies): the desk weighs cheap fixes; a jet only when its limit allows one.
    const v = crewControl(g, row.flightId, { previews: false, only: (R.jetMax ?? 0) > 0 ? DESK_FIXES : DESK_FIXES.slice(0, 2) });
    if (!v) continue;
    const best = v.solutions
      .filter((s) => s.available && (s.id === 'jet' ? (R.jetMax ?? 0) > 0 && s.cost <= R.jetMax! : s.cost <= (R.fixMax ?? 8_000)))
      .sort((a, b) => a.cost - b.cost)[0];
    if (!best) continue;
    const r = applyCrewFix(g, row.flightId, best.id, { confirmed: true });
    if (!r.ok) continue;
    n++;
    const f = g.flights[row.flightId];
    const mistake = slips(g, h);
    if (mistake) post(g, 'deadhead', -1_900);
    done(g, h, 'crew', `The crew desk fixed ${f?.no ?? 'a flight'}: ${best.label.toLowerCase()}`, `${r.msg ?? ''}${best.cost ? ` (${usd(best.cost)})` : ''}.`, { kind: 'flight', id: row.flightId },
      mistake ? 'They bought a $1,900 ticket where a standby was free.' : undefined);
  }
  return n;
}

const RULE_TEXT: Record<AlertRule['kind'], (v: number) => string> = {
  cashBelow: (v) => `cash below ${usd(v)}`,
  delayOver: (v) => `a flight delayed more than ${v} h`,
  offerOver: (v) => `an offer worth more than ${usd(v)}`,
  idleOver: (v) => `an aircraft idle more than ${v} days`,
  clientDown: () => 'a client drops a level',
  checkDue: (v) => `a check due in ${v} days with no slot`,
};

type Subject = [string, string, Ref | undefined];

/** The subjects a rule holds for now: [subject id, body, ref]. Pure. */
function subjects(g: GameState, a: AlertRule, h: Head): Subject[] {
  switch (a.kind) {
    case 'cashBelow':
      return g.company.cash < a.value ? [['cash', `Cash is ${usd(g.company.cash)}.`, undefined]] : [];
    case 'delayOver':
      return Object.values(g.flights).filter((f) => f.status === 'scheduled' && !!f.aircraftId && f.delay > a.value * 60 && f.std < g.now + DAY)
        .map((f): Subject => [f.id, `${f.no} ${f.from}–${f.to} is ${fmtDuration(f.delay)} late.`, { kind: 'flight', id: f.id }]);
    case 'offerOver':
      return Object.values(g.offers).filter((o) => o.status === 'open' && o.estValue > a.value).map((o): Subject => [o.id, `${o.title}: about ${usd(o.estValue)}.`, { kind: 'offer', id: o.id }]);
    case 'idleOver':
      return Object.values(g.fleet).filter((ac) => {
        if (ac.status !== 'available' || ac.flightId) return false;
        const fs = flightsOf(g, ac.id);
        const last = fs.filter((f) => f.status === 'done').reduce((m, f) => Math.max(m, f.ata ?? f.sta), ac.bhSince !== undefined ? ac.bhSince * DAY : -Infinity);
        return g.now - last > a.value * DAY && !fs.some((f) => f.status === 'scheduled' && f.std < g.now + DAY);
      }).map((ac): Subject => [ac.id, `${ac.reg} has been idle at ${ac.at} for over ${a.value} days.`, { kind: 'aircraft', id: ac.id }]);
    case 'clientDown': {
      const out: Subject[] = [];
      for (const c of Object.values(g.clients)) {
        const lv = LEVEL_ORDER.indexOf(levelOf(g, c));
        const was = h.seen?.[c.id];
        if (was !== undefined && lv < was) out.push([`${c.id}:${lv}`, `${c.name} is now ${LEVEL_NAME[LEVEL_ORDER[lv]]} (was ${LEVEL_NAME[LEVEL_ORDER[was]]}).`, undefined]);
      }
      return out;
    }
    case 'checkDue':
      return Object.values(g.fleet).flatMap((ac): Subject[] => {
        if (ac.status === 'delivering' || ac.status === 'stored' || ac.status === 'leasedOut') return [];
        const st = checkStatus(g, ac);
        const x: Subject[] = [];
        if (!st.nextA && st.aDue - g.now <= a.value * DAY) x.push([`${ac.id}:A`, `${ac.reg}'s A-check is due ${fmtDay(st.aDue)} and nothing is booked.`, { kind: 'aircraft', id: ac.id }]);
        if (!st.nextC && st.cDue - g.now <= a.value * DAY) x.push([`${ac.id}:C`, `${ac.reg}'s C-check is due ${fmtDay(st.cDue)} and nothing is booked.`, { kind: 'aircraft', id: ac.id }]);
        return x;
      });
  }
}

/** Watch desk (hourly): each rule fires once per subject until it clears; a mistake brings the alert an hour late. */
export function watchDeskHour(g: GameState): number {
  const h = active(g, 'watch');
  if (!h) return 0;
  const fired = new Set(h.fired ?? []);
  const live = new Set<string>();
  const held = new Map((h.recent ?? []).filter(([k]) => k.startsWith('w:')));
  let n = 0;
  for (const a of rulesOf(h).alerts ?? []) {
    if (!a.on) continue;
    for (const [sub, body, ref] of subjects(g, a, h)) {
      const key = `${a.id}:${sub}`;
      live.add(key);
      if (fired.has(key)) continue;
      const hk = `w:${key}`;
      const due = held.get(hk);
      if (due === undefined && slips(g, h)) {
        held.set(hk, g.now + 60);
        continue;
      }
      if (due !== undefined && due > g.now) continue;
      held.delete(hk);
      fired.add(key);
      n++;
      h.handled++;
      v09Stats(g).headHandled++;
      if (due !== undefined) {
        h.mistakes++;
        v09Stats(g).headMistakes++;
        log(h, { t: g.now, kind: 'mistake', text: `The alert on ${RULE_TEXT[a.kind](a.value)} came an hour late` });
      }
      log(h, { t: g.now, kind: 'done', text: `Your rule: ${RULE_TEXT[a.kind](a.value)}`, ...(ref ? { ref } : {}) });
      pushMessage(g, { tone: 'warn', cat: 'ops', topic: 'head', title: `Your rule: ${RULE_TEXT[a.kind](a.value)}`, body, ...(ref ? { ref } : {}), cue: 'ruleAlert' });
      if (a.action === 'pause') requestPause('rule');
    }
  }
  h.fired = [...fired].filter((k) => live.has(k));
  const keep = (h.recent ?? []).filter(([k, until]) => !k.startsWith('w:') && until > g.now);
  // v0.9 round 4: a subject held back an hour that cleared meanwhile needs no alert, but the miss is on the record.
  for (const [k] of held) {
    if (live.has(k.slice(2))) continue;
    const a = (rulesOf(h).alerts ?? []).find((x) => x.id === k.slice(2).split(':')[0]);
    h.mistakes++;
    v09Stats(g).headMistakes++;
    log(h, { t: g.now, kind: 'mistake', text: `The alert on ${a ? RULE_TEXT[a.kind](a.value) : 'a rule'} was held an hour and the subject cleared before it went out` });
  }
  h.recent = [...keep, ...[...held.entries()].filter(([k]) => live.has(k.slice(2)))];
  const seen: Record<string, number> = {};
  for (const c of Object.values(g.clients)) seen[c.id] = LEVEL_ORDER.indexOf(levelOf(g, c));
  h.seen = seen;
  return n;
}

setHourlyHook((g) => {
  if (!g.heads) return;
  acting = true;
  try {
    // The desk works the amber list every 6 h (03, 09, 15, 21 UTC): an amber flight has 36–48 h to go.
    if (Math.floor(g.now / 60) % 6 === 3) crewDeskHour(g);
    watchDeskHour(g);
  } finally {
    acting = false;
  }
});

// ---------- the analyst ----------

/** verdict 'busy': the job pays, but no aircraft is free on its dates (score 0, shown as '—'). */
export interface AnalystView { name: string; skill: number; score: number; verdict: 'take' | 'counter' | 'pass' | 'busy'; aircraftId: string | null; marginPct: number; counter: number | null; lines: string[] }

/**
 * The commercial analyst's take on an offer (null unless hired and on): the best flyable aircraft and its margin
 * (off by up to ±(1 − skill) × 15 %, fixed per offer and hire), a score, and the highest counter the client accepts at
 * least 60 % of the time. Pure.
 */
export function analystView(g: GameState, offerId: string): AnalystView | null {
  const h = active(g, 'analyst');
  const o = g.offers[offerId];
  if (!h || !h.hired || !o || (o.status !== 'open' && o.status !== 'countered')) return null;
  let best: { id: string; margin: number; rev: number } | null = null;
  // An aircraft refused only for being busy on the dates (its margin if it were free): 'no aircraft free', not 'pass'.
  let busy: { id: string; margin: number; rev: number } | null = null;
  for (const id of Object.keys(g.fleet)) {
    const r = feasibility(g, offerId, id, { quick: true });
    if (r.estRevenue <= 0) continue;
    if (r.level === 'no') {
      const only = r.checks.filter((c) => c.level === 'no').every((c) => c.id === 'availability' || /busy/i.test(c.label));
      if (only && (!busy || r.estMargin > busy.margin)) busy = { id, margin: r.estMargin, rev: r.estRevenue };
      continue;
    }
    if (!best || r.estMargin > best.margin) best = { id, margin: r.estMargin, rev: r.estRevenue };
  }
  const skill = h.hired.skill;
  const err = analystErr(offerId, h);
  const marginPct = best ? Math.round((best.margin / best.rev) * (1 + err) * 1000) / 10 : 0;
  const asking = counterBase(o);
  let ratio = 1;
  for (let k = 1; k <= 40; k++) {
    if (counterOdds(o, 1 + k / 100).accept >= 0.6) ratio = 1 + k / 100;
    else break;
  }
  const step = o.product.kind === 'wet' ? 5 : o.product.kind === 'charter' ? 1_000 : 50;
  const counter = ratio > 1 ? Math.max(Math.ceil(asking / step) * step, Math.floor((asking * ratio) / step) * step) : null;
  // Round 4: 50 + margin %, so the pill keeps ranking offers up to a 49 % margin (×2 saturated at 25 %).
  const score = best ? Math.max(1, Math.min(99, Math.round(50 + marginPct))) : 0;
  const reg = best ? g.fleet[best.id].reg : '';
  const fmt = (v: number) => (o.product.kind === 'wet' ? `$${v.toLocaleString('en-US')}/BH` : usd(v));
  const busyPct = !best && busy ? Math.round((busy.margin / busy.rev) * (1 + err) * 100) : null;
  const verdict: AnalystView['verdict'] = !best && busyPct !== null && busyPct >= 0 ? 'busy' : !best || marginPct < 0 ? 'pass' : marginPct >= 15 || !counter ? 'take' : 'counter';
  const lines = [
    verdict === 'busy' ? `No aircraft free on these dates (best: ${g.fleet[busy!.id].reg}, margin about ${busyPct} % if freed)`
      : verdict === 'pass' ? 'Pass: no aircraft makes money on it'
      : verdict === 'take' ? `Take it on ${reg}: margin about ${Math.round(marginPct)} %`
      : `Counter at ${fmt(counter!)}: they usually accept within ${Math.round((ratio - 1) * 100)} % of asking`,
  ];
  if (best && verdict === 'counter') lines.push(`On ${reg} at the asking price: margin about ${Math.round(marginPct)} %`);
  return { name: h.hired.name, skill, score, verdict, aircraftId: best?.id ?? (verdict === 'busy' ? busy!.id : null), marginPct: verdict === 'busy' ? busyPct! : marginPct, counter, lines };
}

/** The analyst's relative margin error on an offer: ±(1 − skill) × 15 %, fixed per offer and hire. */
const analystErr = (offerId: string, h: Head): number => (2 * hashUnit(`${offerId}:${h.hired!.since}`) - 1) * (1 - h.hired!.skill) * 0.15;

/** §5.3 the estimate goes on the contract at signing (the shown margin and the planner's own for that aircraft). */
setSignHook((g, c, o, aircraftId) => {
  const h = active(g, 'analyst');
  if (!h?.hired) return;
  const r = feasibility(g, o.id, aircraftId, { quick: true });
  if (r.estRevenue <= 0) return;
  const est = (r.estMargin / r.estRevenue) * 100;
  c.analyst = { name: h.hired.name, pct: Math.round(est * (1 + analystErr(o.id, h)) * 10) / 10, est: Math.round(est * 10) / 10 };
});

/** …and is judged when the contract ends: logged honestly, a mistake from ±5 % off ("overestimated the Condor margin"). */
setCompleteHook((g, c) => {
  const h = g.heads?.analyst;
  const a = c.analyst;
  if (!h || !a) return;
  const who = a.name.split(' ')[0];
  const ref: Ref = { kind: 'contract', id: c.id };
  const err = a.est ? a.pct / a.est - 1 : 0;
  h.handled++;
  v09Stats(g).headHandled++;
  log(h, { t: g.now, kind: 'done', text: `${c.title}: margin ${a.est} % (${who} said ${a.pct} %)`, ref });
  if (Math.abs(err) < H().analystErr) return;
  h.mistakes++;
  v09Stats(g).headMistakes++;
  log(h, { t: g.now, kind: 'mistake', text: `${who} ${a.pct > a.est ? 'overestimated' : 'underestimated'} the ${g.clients[c.clientId]?.name ?? 'client'} margin: said ${a.pct} %, it was ${a.est} %`, ref });
});

// ---------- ferry ----------

/**
 * Ferries an aircraft (no passengers) to `to` as soon as a crew can be positioned for it, with fuel stops as legs,
 * through planPositioning (kind 'ferry'). Returns the legs and the cost estimate. Action.
 */
export function ferryAircraft(g: GameState, aircraftId: string, to: string, arriveBy?: Minute, contractId?: string): ActionResult<{ flightIds: string[]; cost: number }> {
  const ac = g.fleet[aircraftId];
  if (!ac) return { ok: false, error: 'Aircraft not found' };
  if (!AIRPORT_BY_CODE[to]) return { ok: false, error: 'Unknown airport' };
  if (ac.status !== 'available' || ac.flightId) return { ok: false, error: `${ac.reg} is not free to ferry now` };
  if (ac.at === to) return { ok: false, error: `${ac.reg} is already at ${to}` };
  const blk = emptyBlock(ac.typeId, ac.at, to);
  const by = arriveBy ?? g.now + BAL.ferryLeadMin + blk + 6 * 60;
  // v0.9 round 4: positioning for a contract (billable on a wet lease) replaces that contract's later same-day legs,
  // once a plan is known to fit (tried on a copy, no cues).
  const old = contractId ? flightsOf(g, aircraftId).filter((f) => f.contractId === contractId && f.kind === 'positioning' && f.status === 'scheduled' && f.std >= by && f.std < by + DAY).map((f) => f.id) : [];
  if (old.length) {
    const fits = isolatePauses(() => {
      const x = structuredClone(g);
      removeFlights(x, old);
      return !!planPositioning(x, aircraftId, to, by, 'positioning', contractId!)?.length;
    });
    if (!fits) return { ok: false, error: `No positioning fits before ${fmtDay(by)} ${fmtTime(by)}` };
    removeFlights(g, old);
  }
  const legs = contractId ? planPositioning(g, aircraftId, to, by, 'positioning', contractId) : planPositioning(g, aircraftId, to, by, 'ferry', null);
  if (!legs) return { ok: false, error: `No ferry fits before ${fmtDay(by)} ${fmtTime(by)}` };
  if (!legs.length) return { ok: false, error: `${ac.reg} is already going to ${to}` };
  rerosterFrom(g, aircraftId, g.now);
  const cost = legsCost(g, ac.typeId, legs);
  return { ok: true, msg: `${ac.reg} ferries ${legs[0].from}–${to} ${fmtDay(legs[0].std)} ${fmtTime(legs[0].std)} (${legs.length} leg${legs.length > 1 ? 's' : ''}, about ${usd(cost)})`, data: { flightIds: legs.map((f) => f.id), cost } };
}
