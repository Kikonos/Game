// The save list reads small meta keys instead of decompressing every slot; a slot rewritten elsewhere
// (the UI's async autosave) is detected by its size and read in full once.

import { afterEach, describe, expect, it } from 'vitest';
import { createGame } from './newGame';
import { listSaves, saveToSlot } from './save';

class MemStorage {
  m = new Map<string, string>();
  reads = 0;
  getItem(k: string) {
    if (k.includes(':save:')) this.reads++;
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const g = () => createGame({ name: 'Meta Air', code: 'MA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 5 });

describe('save list', () => {
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  it('lists slots from their meta keys and notices a slot written without one', () => {
    const st = new MemStorage();
    (globalThis as { localStorage?: unknown }).localStorage = st;
    const a = g();
    expect(saveToSlot(a, '1')).toBe(true);
    const list = listSaves();
    expect(list.map((m) => [m.slot, m.company])).toEqual([['1', 'Meta Air']]);
    // Rewritten elsewhere (different size): the full save is read again and the meta refreshed.
    a.company.name = 'Meta Air Two';
    const raw = st.m.get('contrail-acmi:save:1')!;
    saveToSlot(a, '2');
    st.m.set('contrail-acmi:save:1', st.m.get('contrail-acmi:save:2')!);
    expect(raw).not.toBe(st.m.get('contrail-acmi:save:1'));
    expect(listSaves().find((m) => m.slot === '1')?.company).toBe('Meta Air Two');
  });
});
