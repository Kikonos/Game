// v0.24.1 keyboard shortcuts: the actions, their default keys, and rebinding (pure). The bindings live in the app's
// settings on this device (store.settings.keys), never in the save. Shell.tsx reads the live map on every key press;
// Settings › Key bindings is both the list and the editor.

import type { Tab } from './store';

/** True while Settings › Key bindings waits for a key: the shortcuts and the dialogs' Esc and Enter leave that press alone. */
export const keyCapture = { on: false };

/** The window event Shell.tsx sends for a map or board key (OpsMap, Schedule and the roster board listen). */
export const KEY_EVENT = 'acmi-key';

export type KeyGroup = 'Time' | 'Screens' | 'Map' | 'Boards' | 'Dialogs';

export type KeyAction =
  | 'pause' | 'speed1' | 'speed2' | 'speed3'
  | 'tab.map' | 'tab.contracts' | 'tab.network' | 'tab.schedule' | 'tab.crew' | 'tab.fleet' | 'tab.finance' | 'tab.company' | 'tab.inbox'
  | 'zoomIn' | 'zoomOut'
  | 'boardBack' | 'boardFwd' | 'boardToday'
  | 'keys';

export interface KeyActionInfo { id: KeyAction; label: string; group: KeyGroup }

export const KEY_ACTIONS: KeyActionInfo[] = [
  { id: 'pause', label: 'Pause or run', group: 'Time' },
  { id: 'speed1', label: 'Speed 1×', group: 'Time' },
  { id: 'speed2', label: 'Speed 2×', group: 'Time' },
  { id: 'speed3', label: 'Speed 4×', group: 'Time' },
  { id: 'tab.map', label: 'Map', group: 'Screens' },
  { id: 'tab.contracts', label: 'Contracts', group: 'Screens' },
  { id: 'tab.network', label: 'Network', group: 'Screens' },
  { id: 'tab.schedule', label: 'Schedule', group: 'Screens' },
  { id: 'tab.crew', label: 'Crew', group: 'Screens' },
  { id: 'tab.fleet', label: 'Fleet', group: 'Screens' },
  { id: 'tab.finance', label: 'Finance', group: 'Screens' },
  { id: 'tab.company', label: 'Company', group: 'Screens' },
  { id: 'tab.inbox', label: 'Inbox', group: 'Screens' },
  { id: 'zoomIn', label: 'Zoom in', group: 'Map' },
  { id: 'zoomOut', label: 'Zoom out', group: 'Map' },
  { id: 'boardBack', label: 'A day earlier', group: 'Boards' },
  { id: 'boardFwd', label: 'A day later', group: 'Boards' },
  { id: 'boardToday', label: 'Back to today', group: 'Boards' },
  { id: 'keys', label: 'Key bindings', group: 'Dialogs' },
];

export const KEY_GROUPS: KeyGroup[] = ['Time', 'Screens', 'Map', 'Boards', 'Dialogs'];

export type KeyMap = Record<KeyAction, string>;

/** The defaults (keys as normKey gives them). */
export const DEFAULT_KEYS: KeyMap = {
  pause: 'Space', speed1: '1', speed2: '2', speed3: '4',
  'tab.map': 'm', 'tab.contracts': 'c', 'tab.network': 'n', 'tab.schedule': 's', 'tab.crew': 'r', 'tab.fleet': 'f',
  'tab.finance': 'b', 'tab.company': 'o', 'tab.inbox': 'i',
  zoomIn: '=', zoomOut: '-',
  boardBack: '[', boardFwd: ']', boardToday: 't',
  keys: '?',
};

/** Keys every player has, not rebindable (shown in the list). */
export const FIXED_KEYS: { keys: string; label: string; group: KeyGroup }[] = [
  { keys: '← →', label: 'Also a day earlier or later', group: 'Boards' },
  { keys: 'Esc', label: 'Close a dialog, or open the menu', group: 'Dialogs' },
  { keys: 'Enter', label: 'Confirm a dialog', group: 'Dialogs' },
  { keys: '⌘S', label: 'Save now (Ctrl+S on Windows)', group: 'Dialogs' },
];

export const TAB_ACTION: Record<Tab, KeyAction> = {
  map: 'tab.map', contracts: 'tab.contracts', network: 'tab.network', schedule: 'tab.schedule', crew: 'tab.crew', fleet: 'tab.fleet',
  finance: 'tab.finance', company: 'tab.company', inbox: 'tab.inbox',
};

/** One key press as a binding: 'Space', a lower-case letter, '=' for + and =, else the key's own name. Pure. */
export function normKey(e: { key: string; code?: string }): string {
  const k = e.key;
  if (k === ' ' || k === 'Spacebar' || e.code === 'Space') return 'Space';
  if (k === '+') return '=';
  if (k.length === 1) return k.toLowerCase();
  return k;
}

const ARROW: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** What a key chip shows: 'M', 'Space', '+', '←'. Pure. */
export function keyLabel(k: string | undefined): string {
  if (!k) return '—';
  if (k === '=') return '+';
  if (ARROW[k]) return ARROW[k];
  if (k.length === 1) return k.toUpperCase();
  return k;
}

const NEVER = new Set(['Tab', 'Escape', 'Enter', 'Shift', 'Meta', 'Control', 'Alt', 'AltGraph', 'CapsLock', 'Fn', 'FnLock', 'Dead', 'Unidentified', 'OS', 'ContextMenu', 'Process', 'Backspace']);

/** Why a key press cannot become a binding (null when it can). Pure. */
export function unbindable(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }): string | null {
  if (e.metaKey || e.ctrlKey) return 'Keys with ⌘ or Ctrl belong to the browser.';
  if (e.altKey) return 'Keys with ⌥ or Alt type other letters. Pick a plain key.';
  if (e.key === 'Escape') return 'Esc closes dialogs. Pick another key.';
  if (e.key === 'Tab') return 'Tab moves between buttons. Pick another key.';
  if (e.key === 'Enter') return 'Enter confirms dialogs. Pick another key.';
  if (NEVER.has(e.key)) return 'That key can\'t be used alone.';
  if (ARROW[e.key]) return 'The arrows already step the boards. Pick another key.';
  return null;
}

/** The action bound to a key (undefined when none). Pure. */
export function actionOf(map: KeyMap, key: string): KeyAction | undefined {
  return (Object.keys(map) as KeyAction[]).find((a) => map[a] === key);
}

/** Binds `key` to `action`: the new map, or the action that already has it (map unchanged). Pure. */
export function rebind(map: KeyMap, action: KeyAction, key: string): { map: KeyMap; conflict?: KeyAction } {
  const other = actionOf(map, key);
  if (other && other !== action) return { map, conflict: other };
  return { map: { ...map, [action]: key } };
}

/** Binds `key` to `action`; the action that had it takes `action`'s old key. Pure. */
export function swapKeys(map: KeyMap, action: KeyAction, key: string): KeyMap {
  const other = actionOf(map, key);
  const out = { ...map, [action]: key };
  if (other && other !== action) out[other] = map[action];
  return out;
}

/** One action back to its default (swapping with whoever holds that key now). Pure. */
export function resetKey(map: KeyMap, action: KeyAction): KeyMap {
  return swapKeys(map, action, DEFAULT_KEYS[action]);
}

/** Stored bindings (an older settings' none) with every action present, unknown ones dropped, no key twice. Pure. */
export function keymapFrom(stored: unknown): KeyMap {
  const out: KeyMap = { ...DEFAULT_KEYS };
  if (!stored || typeof stored !== 'object') return out;
  const s = stored as Record<string, unknown>;
  const used = new Map<string, KeyAction>();
  for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) {
    const k = s[a];
    if (typeof k === 'string' && k && !unbindable({ key: k })) out[a] = k;
  }
  // Two actions on one key (a hand-edited store): the later one goes back to its default when that is free, else to none.
  for (const a of Object.keys(DEFAULT_KEYS) as KeyAction[]) {
    const k = out[a];
    if (!used.has(k)) { used.set(k, a); continue; }
    const d = DEFAULT_KEYS[a];
    out[a] = used.has(d) ? '' : d;
    if (out[a]) used.set(d, a);
  }
  return out;
}

/** The action of a key event, or undefined (⌘/Ctrl/Alt combos and held keys never fire one). Pure. */
export function eventAction(map: KeyMap, e: { key: string; code?: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; repeat?: boolean }): KeyAction | undefined {
  if (e.metaKey || e.ctrlKey || e.altKey) return undefined;
  const k = normKey(e);
  const a = actionOf(map, k);
  if (a) return a;
  // 3 has always meant the third speed too (4×), unless bound to something else.
  if (k === '3') return 'speed3';
  // The fixed board arrows.
  if (k === 'ArrowLeft') return 'boardBack';
  if (k === 'ArrowRight') return 'boardFwd';
  return undefined;
}

/** True for ⌘S / Ctrl+S (the quick save). Pure. */
export const isSaveCombo = (e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean }): boolean =>
  !!(e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's';

/** The nav button's tooltip: its name and key ('Map (M)'). Pure. */
export function navTitle(label: string, map: KeyMap, tab: Tab): string {
  const k = map[TAB_ACTION[tab]];
  return k ? `${label} (${keyLabel(k)})` : label;
}

/** The bits of the focused element the pause key looks at (an HTMLElement fits). */
export interface FocusLike { tagName?: string; getAttribute?(n: string): string | null; closest?(sel: string): unknown }

/**
 * v0.25 True when the pause key must leave this press alone: Space (or Enter) pressed on a focused button, link or
 * tab inside a dialog presses that control, and the game must not pause or run as well. Outside dialogs the pause
 * key keeps working (the screen's last-clicked button is not "pressed again"). Pure.
 */
export function pauseYields(key: string, modalOpen: boolean, focused: FocusLike | null | undefined): boolean {
  if (key !== 'Space' && key !== 'Enter') return false;
  if (!focused || !focused.tagName) return false;
  const tag = focused.tagName.toUpperCase();
  const role = focused.getAttribute?.('role') ?? '';
  const control = tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY' || role === 'button' || role === 'tab' || role === 'menuitem' || role === 'switch' || role === 'checkbox' || role === 'radio';
  if (!control) return false;
  return modalOpen || !!focused.closest?.('[role="dialog"], .modal');
}
