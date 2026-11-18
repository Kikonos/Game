// Off-main-thread saves (DESIGN §3.6, < 100 ms per save): serialize() on the main thread takes a few ms,
// lz-string runs in a worker and the slot is written when it replies (engine/save.ts writeCompressedSlot: the same
// format and list line as saveToSlot). v0.25 (perf) manual saves too; each slot has its own newest write.

import { writeCompressedSlot, type SaveMeta } from '../engine/save';

/** ok: written or superseded; latest: this write is the newest one. */
type Done = (ok: boolean, latest: boolean) => void;

let worker: Worker | null | undefined;
let seq = 0;
/** The newest write per slot: an older reply for that slot is dropped (a newer write, sync or async, supersedes it). */
const newest = new Map<string, number>();
const pending = new Map<number, { slot: string; meta: SaveMeta; done: Done }>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./saveWorker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<{ id: number; data: string }>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      if (!p || newest.get(p.slot) !== e.data.id) return p?.done(true, false);
      const ok = writeCompressedSlot(p.slot, e.data.data, p.meta);
      p.done(ok, ok);
    };
    worker.onerror = () => {
      // Worker unavailable (e.g. its chunk is gone after an update): callers fall back to the sync path.
      worker = null;
      for (const p of pending.values()) p.done(false, false);
      pending.clear();
    };
  }
  return worker;
}

/** Warms the worker up so it is loaded before the first save. */
export function prepareAsyncSave() {
  getWorker();
}

/** Invalidates in-flight writes to `slot` (every slot when omitted); call before any synchronous save. */
export function supersedeAsyncSave(slot?: string) {
  if (slot !== undefined) newest.set(slot, ++seq);
  else for (const k of newest.keys()) newest.set(k, ++seq);
}

/** Compresses `text` (a serialize() result with `meta`) in the worker and writes the slot. False when no worker is available. */
export function saveTextAsync(text: string, slot: string, meta: SaveMeta, done: Done): boolean {
  const w = getWorker();
  if (!w) return false;
  const id = ++seq;
  newest.set(slot, id);
  pending.set(id, { slot, meta, done });
  w.postMessage({ id, text });
  return true;
}
