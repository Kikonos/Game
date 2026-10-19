// Inbox helpers usable from every module. Decisions also request an auto-pause.

import { nextId } from './entities';
import { schedule } from './queue';
import { requestPause } from './pause';
import type { Decision, GameState, Message } from './types';

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
