// Inbox helpers usable from every module. Decisions also request an auto-pause.

import { nextId } from './entities';
import { schedule } from './queue';
import { requestPause } from './pause';
import type { ActionResult, Decision, GameState, Message } from './types';

const MAX_MESSAGES = 300;

export function pushMessage(g: GameState, m: Omit<Message, 'id' | 't' | 'read'>): Message {
  const msg: Message = { id: nextId(g, 'm'), t: g.now, read: false, ...m };
  g.messages.unshift(msg);
  if (g.messages.length > MAX_MESSAGES) g.messages.length = MAX_MESSAGES;
  return msg;
}

/** Adds a decision, queues its expiry (default option applies) and asks the clock to pause. */
export function pushDecision(g: GameState, d: Omit<Decision, 'id' | 't'>): Decision {
  const dec: Decision = { id: nextId(g, 'd'), t: g.now, ...d };
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
