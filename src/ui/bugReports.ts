// v0.16.1 "Report a bug" (player request: "log suspected bugs that I then can export all at once and give to you, along
// with game data"). A report is the player's words (title, what happened, what they expected), the context captured
// when it was written (game time UTC and local, version, screen, open dialog, the selected entity and a summary of its
// state, the last Inbox lines, settings, device and viewport) and a snapshot of the whole game at that moment, compressed
// like a save. Reports live in IndexedDB (localStorage is far too small for snapshots); "Export all" writes one file
// with every report, its snapshot and the current save (scripts/bugs.ts reads it back into plain save files).
// No network: everything stays on the device until the player exports it.
// v0.17.1 one corner button on every screen (ui/BugCorner.tsx): a screenshot of what the player saw (a JPEG or WebP data
// URL, `shot`) goes with each report; reports can be made without a game (Title, New game: no snapshot).

import LZString from 'lz-string';
import { CURRENT } from '../data/whatsNew';
import { fixedIn, versionAtMost } from '../data/fixedReports';
import { AIRPORT_BY_CODE } from '../data/airports';
import { clientStars, clientPrestige } from '../engine/contracts/prestige';
import { flightsOf } from '../engine/core/entities';
import { fmtDateTime, fmtDuration, fmtTime, localOffset, DAY } from '../engine/core/time';
import type { GameState, Minute, Ref } from '../engine/core/types';
import { crewName, dutyLegality, flightCrewStatus, outOfHours } from '../engine/crew';
import { problemAt } from '../engine/problems';
import { deserialize, serialize } from '../engine/save';
import { applyDeltaText, deltaText } from './snapDelta';

/** The export file's format tag and version. */
export const BUGS_FORMAT = 'blockhours-bugs';
export const BUGS_VERSION = 1;
/** Compressed snapshot marker (the same lz-string UTF-16 form as the save slots). */
const LZ_MARK = 'lz1:';
/** v0.23.1 a snapshot kept as the changes since another report's (snapDelta.ts): 'lzd1:' + the compressed changes. */
const LZD_MARK = 'lzd1:';
/** Storage is bounded by a warning, not a wall: from this many reports (or this many bytes) the dialogs say so. */
export const WARN_REPORTS = 30;
export const WARN_BYTES = 60 * 1024 * 1024;

export interface BugContext {
  version: string;
  /** Game clock: '29 Apr 14:42' UTC and the home base's local time beside it. */
  gameTime: string;
  gameTimeLocal: string;
  /** Game minute (absent without a game: Title, New game). */
  now?: Minute;
  company: string;
  seed: string | number | undefined;
  /** Where the player was: tab, sub-view, the open dialog and the selected entity. */
  screen: { tab: string; view?: string; modal?: string; sel?: Ref };
  /** The entity the report is about (the selection or the card's subject) and its state in plain lines. */
  entity?: { ref: Ref; label: string; lines: string[] };
  /** The last Inbox lines, newest first. */
  inbox: string[];
  settings: Record<string, unknown>;
  device: { kind?: string; form?: string; input?: string; standalone?: boolean; viewport: string; dpr: number; ua: string; theme?: string };
  /** The game's own pause state (the hold) when the report was made. */
  hold?: unknown;
}

export interface BugReportMeta {
  id: string;
  /** Real time (ms since the epoch). */
  createdAt: number;
  title: string;
  what: string;
  expected: string;
  context: BugContext;
  /** Snapshot size in characters (UTF-16 code units; 0 without a game). */
  size: number;
  /** v0.17.1 the screenshot's size in characters of its data URL (0 or absent: no screenshot) and its pixels. */
  shotBytes?: number;
  shotSize?: { w: number; h: number };
  /** v0.17.2 included in an Export all (absent: new). Fixed is read from the version installed (reportStatus). */
  status?: 'sent';
  /** v0.17.2 real time it was first exported. */
  sentAt?: number;
  /** v0.17.2 real time the version installed first listed it as fixed (deleted 7 days later). */
  fixedSeenAt?: number;
  /** v0.22.1 filed by the game itself, quietly: a crew alarm that reached the player (kept apart from the player's own reports).
   *  v0.23.1 'self-check': an alarm the self-check withheld (older ones are told by their title, isAutoReport). */
  auto?: 'crew-alarm' | 'self-check';
  /** v0.22.1 the alarm as it fired (auto 'crew-alarm'). */
  alarm?: CrewAlarmEntry;
  /** v0.22.1 the report whose snapshot this one shares (alarms of the same game minute keep one snapshot between them). */
  snapOf?: string;
  /** v0.23.1 the report this one's snapshot is the changes from (its `snapshot` starts 'lzd1:'; snapshotTextFor rebuilds it). */
  snapBase?: string;
}

// ---------- crew alarms filed by the game (v0.22.1) ----------

/**
 * One crew alarm that reached the player, as it fired: when, which flight, which kind, the card's words (what, why,
 * does it hurt), the Inbox line, the planner's evidence and the self-check's verdict. With the snapshot of the game at
 * that minute (its own or a shared one), scripts/crewcheck.ts judges later whether the alarm was right.
 */
export interface CrewAlarmEntry {
  t: Minute;
  /** 'short' | 'hours' | 'early' | 'takenOff' | 'rest'. */
  kind: string;
  flightId: string;
  no: string;
  /** 'JED–LGW 4 May 10:15'. */
  leg: string;
  /** The alarm's title as the Inbox shows it. */
  title: string;
  /** The problem card's lines at that moment (absent when the card was already gone). */
  what?: string;
  why?: string;
  hurt?: string;
  /** The Inbox line's body. */
  body?: string;
  /** The planner's evidence (the self-check's "Checked ✓" lines). */
  evidence: string[];
  verdict: 'confirmed';
}

/** At most this many crew-alarm records are kept (the oldest go first). */
export const CREW_ALARM_KEEP = 60;
/**
 * v0.23.1 every record keeps a snapshot (they were 12 at most: 56 of the player's 60 could not be checked): the changes
 * since the record before (snapDelta.ts) and a whole game now and then, within CREW_ALARM_SNAP_CHARS characters in all
 * (about 12 MB; the oldest lose theirs first, never the newest 3). A whole game is 250k characters on a big airline,
 * the changes over a day or two 1–60k.
 */
export const CREW_ALARM_SNAP_CHARS = 6_000_000;
/** A new whole game after this many changes in a row, or once the changes since the last whole game outweigh it. */
export const SNAP_CHAIN_MAX = 40;

export const isCrewAlarm = (r: Pick<BugReportMeta, 'auto'>): boolean => r.auto === 'crew-alarm';
/** What the self-check files says (selfCheckFiler.ts); a record of v0.22–v0.23 is told by it. */
export const SELF_CHECK_EXPECTED = 'Filed by the game: this crew alarm did not chime or pause because an independent check disagreed with it.';
/** v0.23.1 filed by the game itself (a crew alarm or a self-check), not written by the player. */
export const isAutoReport = (r: Pick<BugReportMeta, 'auto' | 'title' | 'expected'>): boolean =>
  !!r.auto || (r.title?.startsWith('Self-check: ') === true && r.expected === SELF_CHECK_EXPECTED);

/** What makes two alarms on one flight the same alarm: the kind and its words (title, why, evidence). Pure. */
export const crewAlarmSig = (a: CrewAlarmEntry): string => [a.kind, a.title.replace(/ in \d+ h$/, ''), a.why ?? '', a.evidence.join('|')].join('¦');

/**
 * The alarms of a batch worth filing: the same flight and kind is filed only once unless its wording or evidence
 * changed since the last one filed for it (and never twice in one batch). Pure.
 */
export function newCrewAlarms(existing: readonly BugReportMeta[], batch: readonly CrewAlarmEntry[]): CrewAlarmEntry[] {
  const last = new Map<string, string>();
  for (const r of [...existing].sort((a, b) => a.createdAt - b.createdAt)) if (r.alarm && isCrewAlarm(r)) last.set(`${r.alarm.flightId}|${r.alarm.kind}`, crewAlarmSig(r.alarm));
  const out: CrewAlarmEntry[] = [];
  for (const a of batch) {
    const k = `${a.flightId}|${a.kind}`;
    const sig = crewAlarmSig(a);
    if (last.get(k) === sig) continue;
    last.set(k, sig);
    out.push(a);
  }
  return out;
}

/**
 * Keeps the crew-alarm records small: beyond CREW_ALARM_KEEP the oldest are removed; the rest keep their snapshots
 * within CREW_ALARM_SNAP_CHARS characters (the newest 3 always), older ones beyond it are stripped (the record's words
 * stay). The player's own reports are never touched. Pure.
 */
export function crewAlarmHousekeeping(list: readonly BugReportMeta[]): { remove: string[]; strip: string[] } {
  const mine = list.filter(isCrewAlarm).sort((a, b) => b.createdAt - a.createdAt);
  const remove = mine.slice(CREW_ALARM_KEEP).map((r) => r.id);
  const strip: string[] = [];
  let n = 0;
  let chars = 0;
  for (const r of mine.slice(0, CREW_ALARM_KEEP)) {
    if (!r.size) continue;
    n++;
    chars += r.size;
    if (n > 3 && chars > CREW_ALARM_SNAP_CHARS) strip.push(r.id);
  }
  return { remove, strip };
}

/** The words of a crew-alarm report (the list and the report view read them). Pure. */
export function crewAlarmWords(a: CrewAlarmEntry, gameTime: string): { title: string; what: string; expected: string } {
  const lines = [
    `${gameTime} UTC · ${a.no} ${a.leg} · ${a.kind}`,
    a.what ? `What: ${a.what}` : '',
    a.why ? `Why: ${a.why}` : '',
    a.hurt ? `Does it hurt: ${a.hurt}` : '',
    !a.why && a.body ? a.body : '',
    a.evidence.length ? `Checked: ${a.evidence.join('; ')}` : '',
  ].filter(Boolean);
  return { title: `Crew alarm: ${a.title}`, what: lines.join('\n'), expected: 'Filed by the game, quietly: every crew alarm is kept so it can be checked later whether it was right.' };
}

// ---------- snapshots as changes (v0.23.1) ----------

/**
 * The last crew-alarm snapshot filed in this session: its report, the game's save text, the whole game it goes back to
 * (its size) and the changes since. The next record is kept as the changes from it. After a reload the chain starts
 * again with a whole game.
 */
let tip: { id: string; text: string; keyChars: number; since: number; depth: number } | null = null;
/** Tests: forget the chain. */
export const resetSnapChain = (): void => { tip = null; };

/** A report's snapshot for the save text `text`: the changes from the last one filed when they are small, else the whole game. Updates the chain. */
function chainSnapshot(id: string, text: string, list: readonly BugReportMeta[]): { snapshot: string; snapBase?: string } {
  const t = tip;
  if (t && t.depth < SNAP_CHAIN_MAX && list.some((r) => r.id === t.id && r.size > 0)) {
    try {
      const d = LZD_MARK + LZString.compressToUTF16(deltaText(t.text, text));
      if (d.length <= t.keyChars / 2 && t.since + d.length <= t.keyChars) {
        tip = { id, text, keyChars: t.keyChars, since: t.since + d.length, depth: t.depth + 1 };
        return { snapshot: d, snapBase: t.id };
      }
    } catch { /* the whole game below */ }
  }
  const whole = packSnapshot(text);
  tip = { id, text, keyChars: whole.length, since: 0, depth: 0 };
  return { snapshot: whole };
}

/**
 * Files a batch of crew alarms (the same game minute): the new ones only (newCrewAlarms), one snapshot between them
 * (the first carries it, the others point to it; an earlier report of the same game minute is reused), then the
 * housekeeping. Returns the reports written. `saveText`: the game at that minute as save text (serialize); v0.23.1 it
 * is kept as the changes since the record before when they are small (chainSnapshot).
 */
export async function addCrewAlarms(batch: readonly CrewAlarmEntry[], context: (a: CrewAlarmEntry) => BugContext, saveText: () => string, gameTime: (t: Minute) => string, store: ReportStore = reportStore(), now = Date.now()): Promise<BugReport[]> {
  const list = await store.list();
  const fresh = newCrewAlarms(list, batch);
  if (!fresh.length) return [];
  const out: BugReport[] = [];
  let holder = list.find((r) => isCrewAlarm(r) && r.size > 0 && r.alarm?.t === fresh[0].t)?.id;
  fresh.forEach((a, i) => {
    const id = newId();
    const snap = holder ? { snapshot: '' } : chainSnapshot(id, saveText(), list);
    const r: BugReport = { id, createdAt: now + i, ...crewAlarmWords(a, gameTime(a.t)), context: context(a), size: snap.snapshot.length, ...snap, auto: 'crew-alarm', alarm: a, ...(holder ? { snapOf: holder } : {}) };
    holder ??= r.id;
    out.push(r);
  });
  for (const r of out) await store.put(r);
  const hk = crewAlarmHousekeeping(await store.list());
  if (hk.remove.length || hk.strip.length) await dropReports(hk.remove, hk.strip, store);
  return out;
}

/**
 * v0.23.1 the save text a report can be replayed from ('' when none): its own snapshot, the one it shares (snapOf), or
 * its changes applied to the report they were made from (snapBase), as far back as needed. `all`: the reports of the
 * export (with their snapshots); `memo` keeps texts already rebuilt. Pure.
 */
export function snapshotTextFor(r: BugReport, all: readonly BugReport[], memo: Map<string, string> = new Map()): string {
  const hit = memo.get(r.id);
  if (hit !== undefined) return hit;
  let text = '';
  if (r.snapshot.startsWith(LZD_MARK)) {
    const base = r.snapBase ? all.find((x) => x.id === r.snapBase) : undefined;
    const bt = base ? snapshotTextFor(base, all, memo) : '';
    if (bt) text = applyDeltaText(bt, LZString.decompressFromUTF16(r.snapshot.slice(LZD_MARK.length)) ?? 'null');
  } else if (r.snapshot) text = snapshotText(r.snapshot);
  else if (r.snapOf) {
    const h = all.find((x) => x.id === r.snapOf);
    text = h ? snapshotTextFor(h, all, memo) : '';
  }
  memo.set(r.id, text);
  return text;
}

/** The snapshot a report can be replayed from, compressed (its own whole one, else rebuilt: snapshotTextFor); '' when none. Pure. */
export function snapshotFor(r: BugReport, all: readonly BugReport[]): string {
  if (r.snapshot && !r.snapshot.startsWith(LZD_MARK)) return r.snapshot;
  const t = snapshotTextFor(r, all);
  return t ? packSnapshot(t) : '';
}

/** The save text of a stored report's snapshot, rebuilt from the store as far back as needed ('' when none). */
export async function storedSnapshotText(id: string, store: ReportStore = reportStore(), memo: Map<string, string> = new Map()): Promise<string> {
  const hit = memo.get(id);
  if (hit !== undefined) return hit;
  const r = await store.get(id);
  let text = '';
  if (r?.snapshot.startsWith(LZD_MARK)) {
    const bt = r.snapBase ? await storedSnapshotText(r.snapBase, store, memo) : '';
    if (bt) text = applyDeltaText(bt, LZString.decompressFromUTF16(r.snapshot.slice(LZD_MARK.length)) ?? 'null');
  } else if (r?.snapshot) text = snapshotText(r.snapshot);
  else if (r?.snapOf) text = await storedSnapshotText(r.snapOf, store, memo);
  memo.set(id, text);
  return text;
}

/**
 * v0.23.1 removes reports (`remove`) and the snapshots of others (`strip`, their words stay) without losing a snapshot
 * that another report's is built on: a report that shared one, or kept the changes from one, gets it again first (the
 * changes from the nearest report still kept before it, or the whole game).
 */
export async function dropReports(remove: readonly string[], strip: readonly string[] = [], store: ReportStore = reportStore()): Promise<void> {
  if (!remove.length && !strip.length) return;
  const list = await store.list();
  const byId = new Map(list.map((r) => [r.id, r]));
  const gone = new Set(remove);
  const lose = new Set([...remove, ...strip]);
  const hit = list.filter((r) => !gone.has(r.id) && !strip.includes(r.id) && ((r.snapBase && lose.has(r.snapBase)) || (r.snapOf && lose.has(r.snapOf)))).sort((a, b) => a.createdAt - b.createdAt);
  const memo = new Map<string, string>();
  // Every text needed is read before anything changes.
  const texts = new Map<string, string>();
  for (const r of hit) texts.set(r.id, await storedSnapshotText(r.id, store, memo));
  const holders = new Map<string, string>();
  for (const m of hit) {
    const r = await store.get(m.id);
    if (!r) continue;
    const text = texts.get(m.id) ?? '';
    const { snapBase: _b, snapOf: _o, ...rest } = r;
    let next: BugReport;
    if (!text) next = { ...rest, snapshot: '', size: 0 };
    else if (r.snapOf && lose.has(r.snapOf)) {
      // The first of those that shared it carries the game now; the others share theirs.
      const h = holders.get(r.snapOf);
      if (h) next = { ...rest, snapshot: '', size: 0, snapOf: h };
      else {
        holders.set(r.snapOf, r.id);
        const snapshot = packSnapshot(text);
        next = { ...rest, snapshot, size: snapshot.length };
      }
    } else {
      let a = r.snapBase;
      while (a && lose.has(a)) a = byId.get(a)?.snapBase;
      const at = a ? await storedSnapshotText(a, store, memo) : '';
      const snapshot = at ? LZD_MARK + LZString.compressToUTF16(deltaText(at, text)) : packSnapshot(text);
      next = { ...rest, snapshot, size: snapshot.length, ...(at ? { snapBase: a } : {}) };
    }
    await store.put(next);
  }
  for (const id of strip) {
    const r = await store.get(id);
    if (r) {
      const { snapBase: _b, ...rest } = r;
      await store.put({ ...rest, snapshot: '', size: 0 });
    }
  }
  for (const id of remove) await store.remove(id);
  if (tip && lose.has(tip.id)) tip = null;
}

/**
 * v0.23.1 the reports of an export made whole on their own: one whose snapshot is shared with, or built on, a report
 * not in the export (sent before) gets the game itself, from the store.
 */
export async function exportReady(reports: readonly BugReport[], store: ReportStore = reportStore()): Promise<BugReport[]> {
  const ids = new Set(reports.map((r) => r.id));
  const memo = new Map<string, string>();
  const out: BugReport[] = [];
  for (const r of reports) {
    const need = (r.snapBase && !ids.has(r.snapBase)) || (!r.snapshot && r.snapOf && !ids.has(r.snapOf));
    if (!need) { out.push(r); continue; }
    const text = await storedSnapshotText(r.id, store, memo);
    const { snapBase: _b, snapOf: _o, ...rest } = r;
    const snapshot = text ? packSnapshot(text) : '';
    out.push({ ...rest, snapshot, size: snapshot.length });
  }
  return out;
}

// ---------- clean-up when the game opens (v0.23.1) ----------

/** A report deleted because its fix is in: what it was and what was done (Bug reports › Cleared). */
export interface ClearedReport { id: string; title: string; version: string; what: string; at: number }

/** A stable id for a stored record that has none: from its content (when, title, words). Pure. */
export function stableReportId(r: Pick<BugReportMeta, 'createdAt' | 'title' | 'what'> & { context?: Partial<BugContext> }): string {
  const s = `${r.createdAt ?? 0}|${r.title ?? ''}|${r.what ?? ''}|${r.context?.gameTime ?? ''}`;
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `r${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** The version a record was filed by (its context; '' when unknown). */
const filedBy = (r: BugReportMeta): string => r.context?.version ?? '';

/**
 * v0.23.1 what the game deletes when it opens (the player: "auto-delete fixed bugs when I open the game"): the reports
 * the version installed lists as fixed (data/fixedReports.ts), and the records the game filed itself (crew alarms,
 * self-checks) by an older version: they were looked at when they were exported, and this version files again whatever
 * is still wrong. The player's own reports stay unless fixed. Records without an id get a stable one (`rekey`). Pure.
 */
export function openCleanup(list: readonly BugReportMeta[], installed: string = CURRENT.version, now = Date.now()): { remove: string[]; fixed: ClearedReport[]; old: number; rekey: { from: string | undefined; to: string }[] } {
  const remove: string[] = [];
  const fixed: ClearedReport[] = [];
  const rekey: { from: string | undefined; to: string }[] = [];
  let old = 0;
  for (const r of list) {
    const id = typeof r.id === 'string' && r.id ? r.id : stableReportId(r);
    if (id !== r.id) rekey.push({ from: r.id, to: id });
    const f = fixedIn(id, installed);
    if (f && !isAutoReport(r)) {
      remove.push(id);
      // A report left with the default title is named by the player's own first words.
      const title = r.title === 'Bug report' && r.what ? r.what.split('\n')[0].slice(0, 90) : r.title;
      fixed.push({ id, title, version: f.version, what: f.what, at: now });
      continue;
    }
    const v = filedBy(r);
    if (isAutoReport(r) && (f || (v && v !== installed && versionAtMost(v, installed)))) {
      remove.push(id);
      old++;
    }
  }
  return { remove, fixed, old, rekey };
}

/**
 * v0.23.1 the clean-up when the game opens (openCleanup), on the store: records get their stable id, then the fixed
 * and the old ones go (dropReports keeps every snapshot another record needs). Returns what was cleared.
 */
export async function cleanReportsOnOpen(store: ReportStore = reportStore(), installed: string = CURRENT.version, now = Date.now()): Promise<{ fixed: ClearedReport[]; old: number }> {
  const list = await store.list();
  const plan = openCleanup(list, installed, now);
  for (const k of plan.rekey) {
    try {
      const r = await store.get(k.from as string);
      if (!r) continue;
      await store.put({ ...r, id: k.to });
      await store.remove(k.from as string);
    } catch { /* a record the store cannot address by its old key stays as it was */ }
  }
  await dropReports(plan.remove, [], store);
  return { fixed: plan.fixed, old: plan.old };
}

// ---------- status (v0.17.2) ----------

export type ReportStatus = 'new' | 'sent' | 'fixed';
/** v0.17.2 a fixed report is deleted from the device this long after the update that fixed it was first seen. */
export const FIXED_KEEP_MS = 7 * 24 * 3600 * 1000;

/** New → Sent (in an Export all) → Fixed (the version installed lists its id as fixed). Pure. */
export function reportStatus(r: Pick<BugReportMeta, 'id' | 'status'>, installed: string = CURRENT.version): ReportStatus {
  if (fixedIn(r.id, installed)) return 'fixed';
  return r.status === 'sent' ? 'sent' : 'new';
}

/** The fix line for the list ('Fixed in v0.17.2: …'), or null. Pure. */
export function fixedLine(id: string, installed: string = CURRENT.version): string | null {
  const f = fixedIn(id, installed);
  return f ? `Fixed in ${f.version}: ${f.what}` : null;
}

/**
 * v0.17.2 housekeeping when the list opens: fixed reports not yet marked get the time first seen (`mark`), those seen
 * fixed 7 days ago or more go (`remove`). Pure.
 */
export function fixedHousekeeping(list: readonly BugReportMeta[], now: number, installed: string = CURRENT.version): { mark: string[]; remove: string[] } {
  const mark: string[] = [];
  const remove: string[] = [];
  for (const r of list) {
    if (reportStatus(r, installed) !== 'fixed') continue;
    if (r.fixedSeenAt === undefined) mark.push(r.id);
    else if (now - r.fixedSeenAt >= FIXED_KEEP_MS) remove.push(r.id);
  }
  return { mark, remove };
}

/** v0.17.2 the reports an Export all carries: the new ones (and the sent ones with `includeSent`), and the ids it skipped. Pure. */
export function exportSelection<T extends BugReportMeta>(list: readonly T[], includeSent: boolean, installed: string = CURRENT.version): { take: T[]; skipped: { id: string; status: ReportStatus }[] } {
  const take: T[] = [];
  const skipped: { id: string; status: ReportStatus }[] = [];
  for (const r of list) {
    const st = reportStatus(r, installed);
    if (st === 'new' || (st === 'sent' && includeSent)) take.push(r);
    else skipped.push({ id: r.id, status: st });
  }
  return { take, skipped };
}

/** v0.17.2 a report marked sent (keeps the first time it was sent). Pure. */
export const markSent = <T extends BugReportMeta>(r: T, now: number): T => ({ ...r, status: 'sent', sentAt: r.sentAt ?? now });

export interface BugReport extends BugReportMeta {
  /** 'lz1:' + the compressed save text (snapshotOf); '' when no game was running. */
  snapshot: string;
  /** v0.17.1 the screenshot as a data URL (image/jpeg or image/webp), absent when the capture failed. */
  shot?: string;
}

/** What the corner button found open: the entity (the open dialog's subject, else the selection) and the dialog. */
export interface BugPrefill {
  title?: string;
  ref?: Ref;
  /** The dialog that was open when the button was pressed. */
  modal?: string;
}

/** A screenshot as the corner button took it. */
export interface BugShot {
  url: string;
  w: number;
  h: number;
}

// ---------- snapshots ----------

/** The game as a save, compressed. Pure. */
export function snapshotOf(g: GameState): string {
  return packSnapshot(serialize(g, 'bug'));
}

/** v0.22.1 a save's text as a snapshot (compressed). Pure. */
export const packSnapshot = (saveText: string): string => LZ_MARK + LZString.compressToUTF16(saveText);

/** The save text of a snapshot (plain JSON). Pure. */
export function snapshotText(s: string): string {
  if (s.startsWith(LZ_MARK)) {
    const out = LZString.decompressFromUTF16(s.slice(LZ_MARK.length));
    if (!out) throw new Error('The snapshot could not be read.');
    return out;
  }
  return s;
}

/** The game state a snapshot holds (deserialize: migrated and loaded). */
export const loadSnapshot = (s: string): GameState => deserialize(snapshotText(s));

// ---------- context ----------

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const hm = (m: number) => fmtDuration(m, true);

/** Plain lines on a flight: its legs that day on the aircraft, duty limits, crew and the open card. Pure. */
function flightLines(g: GameState, id: string): string[] {
  const f = g.flights[id];
  if (!f) return ['Flight not found'];
  const out: string[] = [];
  const ac = f.aircraftId ? g.fleet[f.aircraftId] : undefined;
  out.push(`${f.no} ${f.kind} ${f.from}–${f.to} ${fmtDateTime(f.std)}–${fmtDateTime(f.sta)} UTC · ${f.status}${f.delay ? ` · delay ${fmtDuration(f.delay)}` : ''}${f.delayReason ? ` (${f.delayReason})` : ''}${f.crewAlert ? ` · crew mark ${f.crewAlert}` : ''}${f.contractId ? ` · contract ${f.contractId} ${g.contracts[f.contractId]?.title ?? ''}` : ''}`);
  if (ac) {
    out.push(`${ac.reg} (${ac.typeId}) at ${ac.at}${ac.flightId ? ` · airborne on ${g.flights[ac.flightId]?.no ?? ac.flightId}` : ''} · ${ac.status}`);
    const legs = flightsOf(g, ac.id).filter((x) => x.status !== 'cancelled' && Math.abs(x.std - f.std) <= 2 * DAY);
    for (const x of legs) out.push(`  ${x.no} ${x.kind} ${x.from}–${x.to} ${fmtDateTime(x.std)}–${fmtDateTime(x.sta)} ${x.status}${x.delay ? ` +${fmtDuration(x.delay)}` : ''} crew ${x.crewIds.length}${x.riders?.length ? ` riders ${x.riders.length}` : ''}${x.dutyId ? ` duty ${x.dutyId}` : ''}`);
  }
  const d = f.dutyId ? g.duties[f.dutyId] : undefined;
  if (d) {
    out.push(`Duty ${d.id}: report ${fmtDateTime(d.report)} release ${fmtDateTime(d.release)} UTC · day ${hm(d.fdp)} of ${hm(d.maxFdp + (d.discretion ?? 0))} · ${d.sectors} sector(s) · ${d.legality}${d.augment ? ` · ${2 + d.augment} pilots` : ''}`);
    try {
      const lv = dutyLegality(g, d.id);
      if (lv.warnings.length) out.push(`  Limits: ${lv.warnings.map((w) => `${w.level} ${w.code}: ${w.text}`).join('; ')}`);
    } catch { /* a view that cannot be built is not the report's business */ }
  }
  try {
    const cs = flightCrewStatus(g, f.id, { live: false });
    out.push(`Crew: ${cs.level}${cs.missing.length ? ` · missing ${cs.missing.join(', ')}` : ''}`);
    for (const cid of f.crewIds) {
      const c = g.crew[cid];
      if (c) out.push(`  ${crewName(c)} ${c.role} at ${c.loc} · ${c.status}`);
    }
    const ooh = outOfHours(g, f.id);
    if (ooh.length) out.push(`Out of hours: ${ooh.map((o) => `${o.name} ${o.limitText}${o.overMin ? ` (${fmtDuration(o.overMin)})` : ''}`).join('; ')}`);
  } catch { /* as above */ }
  try {
    const card = problemAt(g, { kind: 'flight', id: f.id });
    if (card) out.push(`Card: ${card.what} | ${card.why} | ${card.hurt.text}`);
  } catch { /* as above */ }
  return out;
}

function aircraftLines(g: GameState, id: string): string[] {
  const ac = g.fleet[id];
  if (!ac) return ['Aircraft not found'];
  const out = [`${ac.reg} (${ac.typeId}) at ${ac.at} · ${ac.status}${ac.flightId ? ` · on ${g.flights[ac.flightId]?.no ?? ac.flightId}` : ''}`];
  for (const x of flightsOf(g, ac.id).filter((x) => x.status === 'scheduled' || x.status === 'enroute').slice(0, 12)) out.push(`  ${x.no} ${x.kind} ${x.from}–${x.to} ${fmtDateTime(x.std)}–${fmtDateTime(x.sta)} ${x.status} crew ${x.crewIds.length}`);
  for (const m of Object.values(g.maintenance)) if (m.aircraftId === ac.id && (m.status === 'planned' || m.status === 'inWork')) out.push(`  ${m.kind} at ${m.at} ${fmtDateTime(m.start)}–${fmtDateTime(m.end)} ${m.status}`);
  return out;
}

function crewLines(g: GameState, id: string): string[] {
  const c = g.crew[id];
  if (!c) return ['Crew member not found'];
  const out = [`${crewName(c)} ${c.role} · base ${c.base} · at ${c.loc} · ${c.status} · ratings ${c.ratings.join('/')}`];
  for (const f of Object.values(g.flights)) if (f.crewIds.includes(c.id) && f.status !== 'cancelled' && f.std > g.now - 3 * DAY && f.std < g.now + 7 * DAY) out.push(`  ${f.no} ${f.kind} ${f.from}–${f.to} ${fmtDateTime(f.std)} ${f.status}${f.dutyId ? ` duty ${f.dutyId}` : ''}`);
  return out;
}

function contractLines(g: GameState, id: string): string[] {
  const k = g.contracts[id];
  if (!k) return ['Contract not found'];
  const cl = g.clients[k.clientId];
  const out = [`${k.title} · ${cl?.name ?? k.clientId} · ${k.archetype} · ${k.status} · ${fmtDateTime(k.start)}–${fmtDateTime(k.end)} UTC · aircraft ${k.aircraftIds.map((a) => g.fleet[a]?.reg ?? a).join(', ')}${k.eventId ? ` · event ${k.eventId}` : ''}`];
  for (const f of Object.values(g.flights).filter((f) => f.contractId === id && f.status !== 'cancelled').sort((a, b) => a.std - b.std).slice(0, 20)) out.push(`  ${f.no} ${f.kind} ${f.from}–${f.to} ${fmtDateTime(f.std)}–${fmtDateTime(f.sta)} ${f.status} crew ${f.crewIds.length}`);
  return out;
}

function clientLines(g: GameState, id: string): string[] {
  const c = g.clients[id];
  if (!c) return ['Client not found'];
  return [`${c.name} · ${c.kind} · ${c.country} · level ${clientPrestige(c)} · ${clientStars(c)} of 5 stars · relation ${c.relation} · jobs ${c.jobs ?? 0}`];
}

function offerLines(g: GameState, id: string): string[] {
  const o = g.offers[id];
  if (!o) return ['Offer not found'];
  return [`${o.title} · ${g.clients[o.clientId]?.name ?? o.clientId} · ${o.archetype} · ${o.status}${o.hidden ? ' · hidden by the filter' : ''} · expires ${fmtDateTime(o.expires)} UTC`];
}

/** A plain summary of the entity a report is about (null for a kind with nothing to say). Pure. */
export function entitySummary(g: GameState, ref: Ref): { ref: Ref; label: string; lines: string[] } | null {
  switch (ref.kind) {
    case 'flight': return { ref, label: g.flights[ref.id] ? `Flight ${g.flights[ref.id].no}` : `Flight ${ref.id}`, lines: flightLines(g, ref.id) };
    case 'aircraft': return { ref, label: g.fleet[ref.id]?.reg ?? `Aircraft ${ref.id}`, lines: aircraftLines(g, ref.id) };
    case 'crew': return { ref, label: g.crew[ref.id] ? crewName(g.crew[ref.id]) : `Crew ${ref.id}`, lines: crewLines(g, ref.id) };
    case 'contract': return { ref, label: g.contracts[ref.id]?.title ?? `Contract ${ref.id}`, lines: contractLines(g, ref.id) };
    case 'client': return { ref, label: g.clients[ref.id]?.name ?? `Client ${ref.id}`, lines: clientLines(g, ref.id) };
    case 'offer': return { ref, label: g.offers[ref.id]?.title ?? `Offer ${ref.id}`, lines: offerLines(g, ref.id) };
    case 'maint': {
      const m = g.maintenance[ref.id];
      return m ? { ref, label: `${m.kind} ${g.fleet[m.aircraftId]?.reg ?? ''}`.trim(), lines: [`${m.kind} at ${m.at} ${fmtDateTime(m.start)}–${fmtDateTime(m.end)} ${m.status}`] } : null;
    }
    case 'airport': return { ref, label: `${ref.id} ${city(ref.id)}`, lines: [`Local time ${fmtTime(g.now, ref.id)}`] };
    case 'decision': {
      const d = g.decisions.find((x) => x.id === ref.id);
      return d ? { ref, label: d.title, lines: [`${d.kind} · ${fmtDateTime(d.t)} UTC`, d.body, ...d.options.map((o) => `  option: ${o.label}`)] } : { ref, label: `Decision ${ref.id}`, lines: ['Decision not found (answered)'] };
    }
    default: return { ref, label: `${ref.kind} ${ref.id}`, lines: [] };
  }
}

/** What the capture reads from the app (passed in, so this stays pure and testable). */
export interface CaptureEnv {
  tab: string;
  view?: string;
  modal?: string;
  sel?: Ref;
  settings: Record<string, unknown>;
  device?: { kind?: string; form?: string; input?: string; standalone?: boolean };
  viewport?: { w: number; h: number; dpr: number };
  ua?: string;
  theme?: string;
  hold?: unknown;
}

/** The context of a report: game time, where the player was, the entity's state, the Inbox, settings, device. Pure.
 *  Without a game (Title, New game) it keeps the screen, settings and device. */
export function captureContext(g: GameState | null, env: CaptureEnv, prefill?: BugPrefill): BugContext {
  const ref = prefill?.ref ?? env.sel;
  let entity: BugContext['entity'];
  try {
    entity = g && ref ? entitySummary(g, ref) ?? undefined : undefined;
  } catch {
    entity = ref ? { ref, label: `${ref.kind} ${ref.id}`, lines: ['(could not be summarised)'] } : undefined;
  }
  const modal = prefill?.modal ?? env.modal;
  const base = {
    version: CURRENT.version,
    screen: { tab: env.tab, ...(env.view ? { view: env.view } : {}), ...(modal ? { modal } : {}), ...(env.sel ? { sel: env.sel } : {}) },
    settings: env.settings,
    device: {
      ...(env.device ?? {}),
      viewport: env.viewport ? `${env.viewport.w}×${env.viewport.h}` : '',
      dpr: env.viewport?.dpr ?? 1,
      ua: env.ua ?? '',
      ...(env.theme ? { theme: env.theme } : {}),
    },
    ...(env.hold !== undefined ? { hold: env.hold } : {}),
  };
  if (!g) return { ...base, gameTime: 'No game running', gameTimeLocal: '', company: '', seed: undefined, inbox: [] };
  const home = g.company.homeBase;
  const off = localOffset(home, g.now);
  const sign = off < 0 ? '−' : '+';
  return {
    ...base,
    gameTime: `${fmtDateTime(g.now)} UTC`,
    gameTimeLocal: `${fmtDateTime(g.now + off)} ${home} (UTC${sign}${Math.floor(Math.abs(off) / 60)}${Math.abs(off) % 60 ? `:${String(Math.abs(off) % 60).padStart(2, '0')}` : ''})`,
    now: g.now,
    company: g.company.name,
    seed: g.seed,
    ...(entity ? { entity } : {}),
    inbox: g.messages.slice(0, 12).map((m) => `${fmtDateTime(m.t)} ${m.tone} ${m.title}`),
  };
}

// ---------- storage ----------

export interface ReportStore {
  list(): Promise<BugReportMeta[]>;
  get(id: string): Promise<BugReport | null>;
  put(r: BugReport): Promise<void>;
  remove(id: string): Promise<void>;
}

const meta = ({ snapshot: _s, shot: _p, ...m }: BugReport): BugReportMeta => m;

/** An in-memory store (tests, and browsers without IndexedDB: reports last until the page closes). */
export function memoryStore(): ReportStore {
  const m = new Map<string, BugReport>();
  return {
    list: async () => [...m.values()].map(meta).sort((a, b) => b.createdAt - a.createdAt),
    get: async (id) => m.get(id) ?? null,
    put: async (r) => void m.set(r.id, r),
    remove: async (id) => void m.delete(id),
  };
}

const DB_NAME = 'blockhours-bugs';
const STORE = 'reports';

function openDb(): Promise<IDBDatabase> {
  return new Promise((ok, no) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => no(new Error('IndexedDB is blocked'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | IDBRequest<T>[]): Promise<T[]> {
  return openDb().then((db) => new Promise<T[]>((ok, no) => {
    const t = db.transaction(STORE, mode);
    const reqs = run(t.objectStore(STORE));
    const list = Array.isArray(reqs) ? reqs : [reqs];
    t.oncomplete = () => {
      db.close();
      ok(list.map((r) => r.result));
    };
    t.onerror = () => {
      db.close();
      no(t.error ?? new Error('IndexedDB transaction failed'));
    };
    t.onabort = t.onerror;
  }));
}

/** The IndexedDB store. */
export function idbStore(): ReportStore {
  return {
    list: async () => ((await tx<BugReport[]>('readonly', (s) => s.getAll()))[0] ?? []).map(meta).sort((a, b) => b.createdAt - a.createdAt),
    get: async (id) => (await tx<BugReport | undefined>('readonly', (s) => s.get(id)))[0] ?? null,
    put: async (r) => void (await tx('readwrite', (s) => s.put(r))),
    remove: async (id) => void (await tx('readwrite', (s) => s.delete(id))),
  };
}

let current: ReportStore | null = null;
/** The store the app uses: IndexedDB where there is one, else memory (a note in the dialog says so). */
export function reportStore(): ReportStore {
  return (current ??= typeof indexedDB !== 'undefined' ? idbStore() : memoryStore());
}
export const hasDurableStore = (): boolean => typeof indexedDB !== 'undefined';
/** Tests: use this store. */
export function setReportStore(s: ReportStore | null): void {
  current = s;
}

const newId = () => `b${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

/** Builds a report from the player's words, the context, a snapshot of the game now (none without a game) and the
 *  screenshot when there is one. Pure but for the clock and id. */
export function makeReport(g: GameState | null, words: { title: string; what: string; expected: string }, context: BugContext, now = Date.now(), shot?: BugShot | null): BugReport {
  const snapshot = g ? snapshotOf(g) : '';
  return {
    id: newId(), createdAt: now, title: words.title.trim() || context.entity?.label || 'Bug report', what: words.what.trim(), expected: words.expected.trim(), context, size: snapshot.length, snapshot,
    ...(shot ? { shot: shot.url, shotBytes: shot.url.length, shotSize: { w: shot.w, h: shot.h } } : {}),
  };
}

/** Saves a report; returns the list after. */
export async function addReport(r: BugReport, store: ReportStore = reportStore()): Promise<BugReportMeta[]> {
  await store.put(r);
  return store.list();
}

/** Bytes the reports take: snapshots (UTF-16: two bytes a character) and screenshots (their data URL's length). Pure. */
export const storageBytes = (list: readonly BugReportMeta[]): number => list.reduce((s, r) => s + r.size * 2 + (r.shotBytes ?? 0), 0);

/** The screenshot's file extension from its data URL ('jpg', 'webp', 'png'; null when it is not an image). Pure. */
export function shotExt(url: string | undefined): string | null {
  const m = /^data:image\/(jpeg|jpg|webp|png);base64,/.exec(url ?? '');
  return m ? (m[1] === 'jpeg' ? 'jpg' : m[1]) : null;
}

/** A warning once the store is big (null while it is not). Pure. */
export function storageNote(list: readonly BugReportMeta[]): string | null {
  const bytes = storageBytes(list);
  if (list.length < WARN_REPORTS && bytes < WARN_BYTES) return null;
  return `${list.length} report${list.length === 1 ? '' : 's'}, about ${Math.round(bytes / 1024 / 1024)} MB on this device. Export them and delete the ones you have sent.`;
}

// ---------- export ----------

export interface BugsFile {
  format: typeof BUGS_FORMAT;
  version: number;
  app: string;
  exportedAt: string;
  company: string | null;
  /** The game as it is now (a plain save file's text), when a game is running. */
  currentSave: string | null;
  reports: BugReport[];
  /** v0.17.2 reports on the device left out of this export: already sent, or fixed in the version installed. */
  skipped?: { id: string; status: ReportStatus }[];
}

/** The export file: the reports given with their snapshots and screenshots (`shot`, a data URL), the current save, and (v0.17.2) the ids of those left out. Pure. */
export function exportFile(reports: readonly BugReport[], g: GameState | null, now = new Date(), skipped: { id: string; status: ReportStatus }[] = []): string {
  const file: BugsFile = {
    format: BUGS_FORMAT, version: BUGS_VERSION, app: CURRENT.version, exportedAt: now.toISOString(),
    company: g?.company.name ?? null, currentSave: g ? serialize(g, 'bugs-export') : null, reports: [...reports].sort((a, b) => a.createdAt - b.createdAt),
    ...(skipped.length ? { skipped } : {}),
  };
  return JSON.stringify(file);
}

/** Reads an export file (scripts/bugs.ts, tests). Throws on another kind of file. Pure. */
export function parseBugsFile(text: string): BugsFile {
  const data = JSON.parse(text) as Partial<BugsFile>;
  if (data.format !== BUGS_FORMAT || !Array.isArray(data.reports)) throw new Error('This file is not a BLOCK HOURS bug report export.');
  return data as BugsFile;
}

/** 'blue-airlines-bugreports-2026-11-05.blockhours-bugs.json'. Pure. */
export function exportFileName(company: string | null | undefined, now = new Date()): string {
  const slug = (company ?? 'blockhours').replace(/\W+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'blockhours';
  return `${slug}-bugreports-${now.toISOString().slice(0, 10)}.blockhours-bugs.json`;
}

/** A short text of every report (the copy button): title, when, where, the words, the entity lines. Pure. */
export function summaryText(reports: readonly BugReportMeta[]): string {
  return [...reports].sort((a, b) => a.createdAt - b.createdAt).map((r) => {
    const c = r.context;
    const lines = [
      `# ${r.title}`,
      `Written ${new Date(r.createdAt).toISOString()} · game ${c.gameTime} (${c.gameTimeLocal}) · ${c.version} · ${c.company}`,
      `Screen: ${c.screen.tab}${c.screen.view ? ` › ${c.screen.view}` : ''}${c.screen.modal ? ` · dialog ${c.screen.modal}` : ''}${c.screen.sel ? ` · selected ${c.screen.sel.kind} ${c.screen.sel.id}` : ''}`,
      r.what ? `What happened: ${r.what}` : '',
      r.expected ? `Expected: ${r.expected}` : '',
      ...(c.entity ? [`About: ${c.entity.label}`, ...c.entity.lines.map((l) => `  ${l}`)] : []),
      c.inbox.length ? `Inbox: ${c.inbox.slice(0, 5).join(' | ')}` : '',
      `Device: ${[c.device.kind, c.device.form, c.device.input, c.device.standalone ? 'home-screen app' : '', c.device.viewport].filter(Boolean).join(' · ')}`,
      r.shotBytes ? `Screenshot: ${r.shotSize ? `${r.shotSize.w}×${r.shotSize.h}, ` : ''}${Math.round(r.shotBytes / 1024)} KB (in the export file)` : 'No screenshot',
    ];
    return lines.filter(Boolean).join('\n');
  }).join('\n\n');
}

// ---------- what was cleared (v0.23.1) ----------

const CLEARED_KEY = 'bh:reportsCleared';
/** At most this many cleared reports are remembered (the newest). */
export const CLEARED_KEEP = 40;

/** The reports cleared as fixed, newest first (this device only; empty when the browser keeps nothing). */
export function readCleared(): ClearedReport[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLEARED_KEY) ?? '[]') as ClearedReport[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Remembers reports cleared as fixed (Bug reports › Cleared shows what each fix was). */
export function noteCleared(list: readonly ClearedReport[]): void {
  if (!list.length) return;
  try {
    const all = [...list, ...readCleared().filter((c) => !list.some((x) => x.id === c.id))].slice(0, CLEARED_KEEP);
    localStorage.setItem(CLEARED_KEY, JSON.stringify(all));
  } catch { /* not kept */ }
}

/** "3 fixed bug reports cleared". Pure. */
export const clearedTitle = (n: number): string => `${n} fixed bug report${n === 1 ? '' : 's'} cleared`;
