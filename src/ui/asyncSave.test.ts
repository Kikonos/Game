// v0.25 (perf, core-i2 part) saves compressed in the worker: each slot keeps its own newest write (an autosave no
// longer drops a manual save to another slot in flight), the save list line is written with it, and the slot loads.

import LZString from 'lz-string';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createGame } from '../engine/newGame';
import { listSaves, loadFromSlot, metaFor, serialize } from '../engine/save';

class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

/** A worker that answers when told to (in the order asked). */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: { id: number; data: string } }) => void) | null = null;
  onerror: (() => void) | null = null;
  queue: { id: number; text: string }[] = [];
  constructor() {
    FakeWorker.last = this;
  }
  postMessage(m: { id: number; text: string }) {
    this.queue.push(m);
  }
  reply() {
    const m = this.queue.shift()!;
    this.onmessage?.({ data: { id: m.id, data: LZString.compressToUTF16(m.text) } });
  }
}

const game = () => createGame({ name: 'Async Air', code: 'AA', livery: { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' }, base: 'LIS', seed: 3 });

describe('async saves', () => {
  let mod: typeof import('./asyncSave');
  beforeAll(async () => {
    (globalThis as { Worker?: unknown }).Worker = FakeWorker;
    mod = await import('./asyncSave');
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    vi.restoreAllMocks();
  });

  it('a manual save survives an autosave started after it, and lists without reading the save', () => {
    const st = new MemStorage();
    (globalThis as { localStorage?: unknown }).localStorage = st;
    const g = game();
    const done: string[] = [];
    const m2 = metaFor(g, '2');
    expect(mod.saveTextAsync(serialize(g, '2', m2), '2', m2, (ok, latest) => done.push(`2:${ok}:${latest}`))).toBe(true);
    const ma = metaFor(g, 'auto');
    mod.saveTextAsync(serialize(g, 'auto', ma), 'auto', ma, (ok, latest) => done.push(`auto:${ok}:${latest}`));
    FakeWorker.last.reply();
    FakeWorker.last.reply();
    expect(done).toEqual(['2:true:true', 'auto:true:true']);
    const unzip = vi.spyOn(LZString, 'decompressFromUTF16');
    expect(listSaves().map((x) => x.slot).sort()).toEqual(['2', 'auto']);
    expect(unzip).not.toHaveBeenCalled(); // the list line was written with the save: nothing is decompressed
    st.removeItem('contrail-acmi:meta:2');
    expect(listSaves().find((x) => x.slot === '2')?.company).toBe('Async Air');
    expect(unzip).toHaveBeenCalledTimes(1); // (an older autosave without its line: read in full once)
    expect(loadFromSlot('2')?.company.name).toBe('Async Air');
  });

  it('a newer write to the same slot, or a sync save there, supersedes the older one', () => {
    const st = new MemStorage();
    (globalThis as { localStorage?: unknown }).localStorage = st;
    const g = game();
    const done: string[] = [];
    const m = metaFor(g, '3');
    mod.saveTextAsync(serialize(g, '3', m), '3', m, (ok, latest) => done.push(`a:${ok}:${latest}`));
    g.company.name = 'Async Air Two';
    const m2 = metaFor(g, '3');
    mod.saveTextAsync(serialize(g, '3', m2), '3', m2, (ok, latest) => done.push(`b:${ok}:${latest}`));
    FakeWorker.last.reply();
    FakeWorker.last.reply();
    expect(done).toEqual(['a:true:false', 'b:true:true']);
    expect(loadFromSlot('3')?.company.name).toBe('Async Air Two');
    mod.saveTextAsync(serialize(g, '3', m2), '3', m2, (ok, latest) => done.push(`c:${ok}:${latest}`));
    mod.supersedeAsyncSave('3');
    FakeWorker.last.reply();
    expect(done.at(-1)).toBe('c:true:false');
  });
});
