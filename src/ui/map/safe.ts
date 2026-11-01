// v0.14.1 (CODE-06; merge: the Ops Map too) never let a module stub or a half-built engine view take the map down, and
// never hide the bug: each distinct failure is logged to the console once (it was silent: a bug read as a plausible
// 'nothing here').

const logged = new Set<string>();

/** fn(), or `fallback` when it throws (the failure logged once per message and call site). */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (e) {
    const key = `${e instanceof Error ? e.message : String(e)}|${fn.toString().slice(0, 80)}`;
    if (!logged.has(key)) {
      logged.add(key);
      console.warn('[Block Hours] a map read failed; showing a fallback', e);
    }
    return fallback;
  }
}
