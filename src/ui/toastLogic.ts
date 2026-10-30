// v0.12.1 toast timing and the pop-up log (round D, the player: "notifications are still a bit too quick, and when I
// want to read the important ones they disappear"). Pure: the store keeps the timers, this decides how long, what the
// stack keeps and what the log holds.

import type { Cue } from '../engine/core/cues';
import type { Minute, Ref } from '../engine/core/types';

export type ToastKind = 'good' | 'bad' | 'warn' | 'info' | 'achievement';

/** Reading time by tone: news 8 s, a warning or bad news 15 s (v0.9.1: 5 s for all). */
export const TOAST_MS: Record<ToastKind, number> = { info: 8000, good: 8000, achievement: 8000, warn: 15000, bad: 15000 };
/** After a hover or a touch the toast keeps at least this long (time to move the eyes on). */
export const RESUME_MIN_MS = 3000;
/** Toasts on screen at once (lower right). */
export const STACK_MAX = 3;
/** Pop-ups the log keeps (Inbox › Recent pop-ups). */
export const LOG_MAX = 50;

/** Critical ones stay until closed: the urgent crew alarms and emergencies. */
const STICKY = new Set<Cue>(['crewShortage', 'crewOutOfHours', 'opsEmergency', 'evacuation', 'cashNegative', 'aog']);
export const stickyCue = (cue: Cue): boolean => STICKY.has(cue);

/** How long a toast stays: null = until closed. */
export function toastMs(kind: ToastKind, sticky = false): number | null {
  return sticky ? null : TOAST_MS[kind];
}

/** Time left after a pause (hover, touch): what was left, never under RESUME_MIN_MS. */
export const resumeMs = (left: number): number => Math.max(RESUME_MIN_MS, left);

export interface StackToast { id: number; sticky?: boolean; leaving?: boolean }

/** The stack after a new toast: at most STACK_MAX, the oldest that may go first (a sticky one only when all are). */
export function pushStack<T extends StackToast>(list: T[], t: T, max = STACK_MAX): T[] {
  const out = [...list.filter((x) => !x.leaving), t];
  while (out.length > max) {
    const i = out.findIndex((x) => !x.sticky && x !== t);
    out.splice(i >= 0 ? i : 0, 1);
  }
  return out;
}

/** What a short screen (a phone on its side) shows of the stack: the urgent ones first, then the newest, in order. */
export function shownToasts<T extends StackToast>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const keep = new Set<T>(list.filter((x) => x.sticky).slice(-max));
  for (let i = list.length - 1; i >= 0 && keep.size < max; i--) keep.add(list[i]);
  return list.filter((x) => keep.has(x));
}

export interface ToastLogEntry {
  id: number;
  kind: ToastKind;
  title: string;
  body?: string;
  /** Game time it showed. */
  at: Minute;
  ref?: Ref;
  msgId?: string;
}

/** The log with the newest first, at most LOG_MAX (a repeat of the same title within a minute is one line). */
export function logToast(log: ToastLogEntry[], e: ToastLogEntry): ToastLogEntry[] {
  const rest = log.filter((x) => !(x.title === e.title && Math.abs(x.at - e.at) <= 1));
  return [e, ...rest].slice(0, LOG_MAX);
}
