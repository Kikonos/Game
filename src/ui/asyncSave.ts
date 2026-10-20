// Off-main-thread autosave (DESIGN §3.6, < 100 ms per save): serialize() on the main thread takes a few ms,
// lz-string runs in a worker and the slot is written when it replies. Mirrors engine/save.ts saveToSlot;
// KEY_PREFIX and LZ_MARK must match it (TODO: import them once save.ts exports a slot encoder).

const KEY_PREFIX = 'contrail-acmi:save:';
const LZ_MARK = 'lz1:';

/** ok: written or superseded; latest: this write is the newest one. */
type Done = (ok: boolean, latest: boolean) => void;

let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { slot: string; done: Done }>();

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
      // A newer write (sync or async) supersedes this one.
      if (!p || e.data.id !== seq) return p?.done(true, false);
      try {
        localStorage.setItem(KEY_PREFIX + p.slot, LZ_MARK + e.data.data);
        p.done(true, true);
      } catch {
        p.done(false, false);
      }
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

/** Invalidates in-flight writes (call before any synchronous save). */
export function supersedeAsyncSave() {
  seq++;
}

/** Compresses `text` (a serialize() result) in the worker and writes the slot. False when no worker is available. */
export function saveTextAsync(text: string, slot: string, done: Done): boolean {
  const w = getWorker();
  if (!w) return false;
  const id = ++seq;
  pending.set(id, { slot, done });
  w.postMessage({ id, text });
  return true;
}
