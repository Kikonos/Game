// v0.15.1 (perf) two runtime marks the read-side caches key on (never saved):
// - `stepping`: the engine is changing the state (an event step, a player action). Read APIs the UI caches by state
//   revision (problem cards, quick feasibility) compute afresh while it is set, so the simulation never reads a value
//   that a screen computed a moment earlier from a state since changed in a way the revision keys do not count.
// - `uiRev`: bumped after every player action, so the screens' caches start over even when an action changed nothing the
//   revision keys count (a counter-offer, an approval bought).

let depth = 0;
let rev = 0;
let cacheOn = false;

/** The app switches the read-side caches on at start (main.tsx); the engine, the bot and the tests never see them. */
export function enableReadCache(): void {
  cacheOn = true;
}

/** Whether a read API may answer from its cache now: switched on by the app, and not inside an engine step. */
export const readCache = (): boolean => cacheOn && depth === 0;

/** Runs `fn` as an engine step: the read-side caches are bypassed inside it. */
export function asStep<T>(fn: () => T): T {
  depth++;
  try {
    return fn();
  } finally {
    depth--;
  }
}

export const stepping = (): boolean => depth > 0;

/** The player changed something: the read-side caches start over. */
export function touchUi(): void {
  rev++;
}

export const uiRev = (): number => rev;
