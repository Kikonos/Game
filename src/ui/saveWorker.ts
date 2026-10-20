// Compresses an autosave off the main thread (lz-string, the same format as engine/save.ts saveToSlot).

import LZString from 'lz-string';

const ctx = self as unknown as { onmessage: ((e: MessageEvent<{ id: number; text: string }>) => void) | null; postMessage(m: unknown): void };

ctx.onmessage = (e) => {
  ctx.postMessage({ id: e.data.id, data: LZString.compressToUTF16(e.data.text) });
};
