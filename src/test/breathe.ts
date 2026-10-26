// Long scenario tests (a season played, a sweep over many seeds) run synchronously for many seconds. Vitest's worker
// talks to the main process over RPC with a 60 s timeout per call, and a reply can only be read when the worker's
// event loop turns: a test blocking it for a minute on a slow or loaded machine (CI) failed the run with "Timeout
// calling onTaskUpdate" although every test passed. Such tests are async and call breathe() in their loops.

import { setImmediate as nextTurn } from 'node:timers/promises';

let last = 0;

/** Lets the event loop turn (pending RPC replies are read) when ~200 ms of work went by since the last turn. */
export async function breathe(): Promise<void> {
  const now = performance.now();
  if (now - last < 200) return;
  await nextTurn();
  last = performance.now();
}
