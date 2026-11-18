import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYS, KEY_ACTIONS, actionOf, eventAction, isSaveCombo, pauseYields, keyLabel, keymapFrom, navTitle, normKey, rebind, resetKey, swapKeys, unbindable } from './keymap';
import { settingsFrom } from './store';

describe('v0.24.1 key bindings', () => {
  it('defaults: every action has one key, no key twice, every action listed once', () => {
    const keys = Object.values(DEFAULT_KEYS);
    expect(new Set(keys).size).toBe(keys.length);
    expect(KEY_ACTIONS.map((a) => a.id).sort()).toEqual(Object.keys(DEFAULT_KEYS).sort());
    for (const k of keys) expect(unbindable({ key: k === 'Space' ? ' ' : k })).toBeNull();
  });

  it('normalises presses and labels chips', () => {
    expect(normKey({ key: ' ', code: 'Space' })).toBe('Space');
    expect(normKey({ key: 'M' })).toBe('m');
    expect(normKey({ key: '+' })).toBe('=');
    expect(keyLabel('=')).toBe('+');
    expect(keyLabel('m')).toBe('M');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('')).toBe('—');
  });

  it('maps events to actions; never with ⌘, Ctrl or Alt', () => {
    const m = { ...DEFAULT_KEYS };
    expect(eventAction(m, { key: 'm' })).toBe('tab.map');
    expect(eventAction(m, { key: 'M' })).toBe('tab.map');
    expect(eventAction(m, { key: ' ', code: 'Space' })).toBe('pause');
    expect(eventAction(m, { key: '?' })).toBe('keys');
    expect(eventAction(m, { key: '+' })).toBe('zoomIn');
    expect(eventAction(m, { key: '=' })).toBe('zoomIn');
    expect(eventAction(m, { key: 'ArrowRight' })).toBe('boardFwd');
    expect(eventAction(m, { key: 'm', metaKey: true })).toBeUndefined();
    expect(eventAction(m, { key: 'c', ctrlKey: true })).toBeUndefined();
    expect(eventAction(m, { key: 'x' })).toBeUndefined();
    expect(isSaveCombo({ key: 's', metaKey: true })).toBe(true);
    expect(isSaveCombo({ key: 'S', ctrlKey: true })).toBe(true);
    expect(isSaveCombo({ key: 's' })).toBe(false);
  });

  it('refuses keys that cannot be bound, with a reason', () => {
    for (const key of ['Tab', 'Escape', 'Enter', 'Shift', 'Meta', 'Control', 'Alt', 'CapsLock', 'ArrowLeft']) expect(unbindable({ key })).toBeTruthy();
    expect(unbindable({ key: 'k', metaKey: true })).toMatch(/browser/);
    expect(unbindable({ key: 'k', ctrlKey: true })).toMatch(/browser/);
    expect(unbindable({ key: 'k' })).toBeNull();
  });

  it('rebind: a free key binds; a taken key reports the conflict; swap trades keys', () => {
    const m = { ...DEFAULT_KEYS };
    const a = rebind(m, 'tab.finance', '7');
    expect(a.conflict).toBeUndefined();
    expect(a.map['tab.finance']).toBe('7');
    expect(m['tab.finance']).toBe('b');
    const b = rebind(m, 'tab.finance', 'm');
    expect(b.conflict).toBe('tab.map');
    expect(b.map).toBe(m);
    const s = swapKeys(m, 'tab.finance', 'm');
    expect(s['tab.finance']).toBe('m');
    expect(s['tab.map']).toBe('b');
    expect(actionOf(s, 'm')).toBe('tab.finance');
    // The same key again is no conflict.
    expect(rebind(m, 'tab.map', 'm').conflict).toBeUndefined();
  });

  it('reset one and reset all', () => {
    const s = swapKeys({ ...DEFAULT_KEYS }, 'tab.finance', 'm');
    const r = resetKey(s, 'tab.finance');
    expect(r).toEqual(DEFAULT_KEYS);
    const t = rebind({ ...DEFAULT_KEYS }, 'zoomIn', 'z').map;
    expect(resetKey(t, 'zoomIn')).toEqual(DEFAULT_KEYS);
  });

  it('stored shape: older settings get the defaults; unknown actions and bad keys dropped; no key twice', () => {
    expect(keymapFrom(undefined)).toEqual(DEFAULT_KEYS);
    expect(keymapFrom({ 'tab.map': 'q', bogus: 'x', pause: 'Tab' })).toEqual({ ...DEFAULT_KEYS, 'tab.map': 'q' });
    const dup = keymapFrom({ 'tab.map': 'c' });
    expect(dup['tab.map']).toBe('c');
    expect(dup['tab.contracts']).toBe('');
    const s = settingsFrom({});
    expect(s.keys).toEqual(DEFAULT_KEYS);
    expect(settingsFrom({ keys: { ...DEFAULT_KEYS, zoomOut: '_' } }).keys.zoomOut).toBe('_');
  });

  it('nav tooltips name the live key', () => {
    expect(navTitle('Map', DEFAULT_KEYS, 'map')).toBe('Map (M)');
    expect(navTitle('Finance', swapKeys({ ...DEFAULT_KEYS }, 'tab.finance', '7'), 'finance')).toBe('Finance (7)');
  });
});

describe('v0.25 pause key and dialog buttons', () => {
  const el = (tagName: string, role: string | null = null, inDialog = false) => ({
    tagName, getAttribute: (n: string) => (n === 'role' ? role : null), closest: (_s: string) => (inDialog ? {} : null),
  });
  it('Space on a focused button in an open dialog presses the button, not pause', () => {
    expect(pauseYields('Space', true, el('BUTTON'))).toBe(true);
    expect(pauseYields('Space', true, el('DIV', 'button'))).toBe(true);
    expect(pauseYields('Space', false, el('BUTTON', null, true))).toBe(true);
  });
  it('pause still works outside dialogs, with nothing focused, or with another key', () => {
    expect(pauseYields('Space', false, el('BUTTON'))).toBe(false);
    expect(pauseYields('Space', true, el('BODY'))).toBe(false);
    expect(pauseYields('Space', true, null)).toBe(false);
    expect(pauseYields('p', true, el('BUTTON'))).toBe(false);
  });
});
