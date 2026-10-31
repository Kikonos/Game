// Inbox helpers usable from every module. Decisions also request an auto-pause.

import { cue, cueOfDecision, cueOfMessage, type Cue } from './cues';
import { nextId } from './entities';
import { schedule } from './queue';
import { requestPause } from './pause';
import type { ActionResult, Decision, GameState, Message } from './types';

const MAX_MESSAGES = 300;

/** v0.9: `cue` overrides the sound cueOfMessage would pick (null = silent); it is never saved. */
export function pushMessage(g: GameState, m: Omit<Message, 'id' | 't' | 'read'> & { cue?: Cue | null }): Message {
  const { cue: want, ...rest } = m;
  const msg: Message = { id: nextId(g, 'm'), t: g.now, read: false, ...rest };
  const c = want === undefined ? cueOfMessage(msg) : want;
  if (c) cue(c, { title: msg.title, body: msg.body, tone: msg.tone, msgId: msg.id, ...(msg.ref ? { ref: msg.ref } : {}) });
  g.messages.unshift(msg);
  if (g.messages.length > MAX_MESSAGES) g.messages.length = MAX_MESSAGES;
  return msg;
}

/**
 * v0.9 department heads (ops/heads.ts): offered every decision the moment it is posted; true = a head took it (applied
 * an option and posted its own quiet note), so nothing is queued, paused or chimed.
 */
let decisionHook: ((g: GameState, d: Decision) => boolean) | null = null;
export function setDecisionHook(f: ((g: GameState, d: Decision) => boolean) | null): void {
  decisionHook = f;
}

/**
 * v0.12.1 ops/events.ts pacing: a decision posted straight here (crew's sick call, a lease notice) is offered to the
 * week's question budget first; true = over it, operations applied the default (one quiet inbox note), so it never
 * chimes, toasts "Decision: …" or pauses the clock for a card that is already gone.
 */
let paceHook: ((g: GameState, d: Decision) => boolean) | null = null;
export function setPaceHook(f: ((g: GameState, d: Decision) => boolean) | null): void {
  paceHook = f;
}

/** Adds a decision, queues its expiry (default option applies) and asks the clock to pause. */
export function pushDecision(g: GameState, d: Omit<Decision, 'id' | 't'>): Decision {
  const dec: Decision = { id: nextId(g, 'd'), t: g.now, ...d };
  if (decisionHook?.(g, dec)) return dec;
  if (!dec.data?.paced && paceHook?.(g, dec)) return dec;
  cue(cueOfDecision(dec), { title: `Decision: ${dec.title}`, body: dec.body, tone: 'warn' });
  g.decisions.push(dec);
  schedule(g, dec.expires, 'decision.expire', dec.id);
  requestPause('decision');
  return dec;
}

/** Marks messages read (all when `ids` is omitted). Player action; never fails. */
export function markRead(g: GameState, ids?: string[]): ActionResult<{ count: number }> {
  const want = ids ? new Set(ids) : null;
  let count = 0;
  for (const m of g.messages) {
    if (m.read || (want && !want.has(m.id))) continue;
    m.read = true;
    count++;
  }
  return { ok: true, data: { count } };
}

/** Unread messages and open decisions (shell badge). Pure. */
export function inboxCounts(g: GameState): { unread: number; alerts: number; decisions: number } {
  let unread = 0;
  let alerts = 0;
  for (const m of g.messages) {
    if (m.read) continue;
    unread++;
    if (m.tone === 'bad' || m.tone === 'warn') alerts++;
  }
  return { unread, alerts, decisions: g.decisions.length };
}
