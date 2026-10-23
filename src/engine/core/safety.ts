// v0.8 pre-release: safety nets. When the engine catches itself in a loop that would spin forever (a re-planning
// pass that keeps replacing legs with the same legs, one instant flooded with events), it breaks the loop, keeps the
// game running and reports the trip here. A trip is always a bug: tests (VITEST) throw so they fail, the bot counts
// trips as exceptions, and the browser logs to the console instead of freezing the player's game.

/** Trips this session (most recent last, at most 50). */
export const safetyTrips: string[] = [];

const strictDefault = (): boolean => {
  try {
    return typeof process !== 'undefined' && !!process.env?.VITEST;
  } catch {
    return false;
  }
};

let strict = strictDefault();

/** Tests of the net itself switch strict mode off (and back on) to see the loop broken instead of a throw. */
export function setSafetyStrict(on: boolean): void {
  strict = on;
}

/** Reports a broken loop: logged and kept; thrown in strict mode (tests). */
export function safetyTrip(where: string, detail: string): void {
  const msg = `[safety net] ${where}: ${detail}`;
  safetyTrips.push(msg);
  if (safetyTrips.length > 50) safetyTrips.shift();
  if (strict) throw new Error(msg);
  console.error(msg);
}
