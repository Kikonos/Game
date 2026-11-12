// v0.23.1 crew-alarm snapshots as changes (the player's export kept a snapshot for only the newest 12 of 60 crew alarm
// records, so 56 could not be checked). Two games a few hours or days apart differ in a small part: the crew who flew,
// the flights that moved, the new Inbox lines. A record now keeps the changes since the record before it (a "delta"),
// and only every so often the whole game (a "keyframe"): 60 records fit in about what 12 whole snapshots took.
// The delta is lossless: the game it rebuilds is the very same save text, character for character, so the
// cross-check (scripts/crewcheck.ts) judges each alarm on the game exactly as it was.
//
// Patch format (JSON, compact):
//   absent         unchanged
//   { v: x }       replaced by x
//   { o: {k: p}, x?: [keys] }   an object: keys patched (a new key is { v }), keys in x deleted
//   { a: ops }     an array: ops is a list of [j, n] runs copied from the old array (two numbers) and arrays of new items
// Pure.

type J = unknown;
type Obj = Record<string, J>;
export type Patch = { v: J } | { o: Record<string, Patch>; x?: string[] } | { a: (number | J[])[] };

const isObj = (x: J): x is Obj => x !== null && typeof x === 'object' && !Array.isArray(x);

/** The key order a rebuilt object gets: the old keys kept, then the new ones (JS orders integer keys first). */
function rebuiltOrder(kept: string[], added: string[]): string[] {
  const o: Obj = {};
  for (const k of kept) o[k] = 0;
  for (const k of added) o[k] = 0;
  return Object.keys(o);
}

/** The changes that turn `a` into `b` (undefined: none). */
export function diffJson(a: J, b: J): Patch | undefined {
  if (a === b) return undefined;
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    const kept = ka.filter((k) => Object.prototype.hasOwnProperty.call(b, k));
    const added = kb.filter((k) => !Object.prototype.hasOwnProperty.call(a, k));
    const order = rebuiltOrder(kept, added);
    if (order.length !== kb.length || order.some((k, i) => k !== kb[i])) return { v: b };
    const o: Record<string, Patch> = {};
    let n = 0;
    for (const k of kb) {
      const p = Object.prototype.hasOwnProperty.call(a, k) ? diffJson(a[k], b[k]) : { v: b[k] };
      if (p !== undefined) { o[k] = p; n++; }
    }
    const x = ka.filter((k) => !Object.prototype.hasOwnProperty.call(b, k));
    if (!n && !x.length) return undefined;
    return x.length ? { o, x } : { o };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ea = a.map((e) => JSON.stringify(e));
    const eb = b.map((e) => JSON.stringify(e));
    if (ea.length === eb.length && ea.every((e, i) => e === eb[i])) return undefined;
    const at = new Map<string, number[]>();
    ea.forEach((e, j) => { const l = at.get(e); if (l) l.push(j); else at.set(e, [j]); });
    const ops: (number | J[])[] = [];
    let lit: J[] = [];
    let next = 0;
    let i = 0;
    while (i < eb.length) {
      const c = at.get(eb[i]);
      if (!c) { lit.push(b[i]); i++; continue; }
      // Prefer the run that continues the last one (the usual case: items added before or after, a few changed).
      const j = ea[next] === eb[i] ? next : c[0];
      let n = 0;
      while (i + n < eb.length && j + n < ea.length && ea[j + n] === eb[i + n]) n++;
      if (lit.length) { ops.push(lit); lit = []; }
      ops.push(j, n);
      i += n;
      next = j + n;
    }
    if (lit.length) ops.push(lit);
    return { a: ops };
  }
  // Numbers, strings, booleans, null, or a change of kind.
  if (typeof a === 'number' && typeof b === 'number' && Object.is(a, b)) return undefined;
  return { v: b };
}

/** `a` with the changes applied (a new value; `a` is not changed). */
export function applyJson(a: J, p: Patch | undefined): J {
  if (p === undefined) return a;
  if ('v' in p) return p.v;
  if ('o' in p) {
    if (!isObj(a)) throw new Error('The snapshot changes do not fit the game they were made for.');
    const del = new Set(p.x ?? []);
    const out: [string, J][] = [];
    for (const k of Object.keys(a)) if (!del.has(k)) out.push([k, Object.prototype.hasOwnProperty.call(p.o, k) ? applyJson(a[k], p.o[k]) : a[k]]);
    for (const k of Object.keys(p.o)) if (!Object.prototype.hasOwnProperty.call(a, k)) out.push([k, applyJson(undefined, p.o[k])]);
    return Object.fromEntries(out);
  }
  if (!Array.isArray(a)) throw new Error('The snapshot changes do not fit the game they were made for.');
  const out: J[] = [];
  const ops = p.a;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (Array.isArray(op)) { out.push(...op); continue; }
    const n = ops[++i] as number;
    for (let k = 0; k < n; k++) out.push(a[op + k]);
  }
  return out;
}

/** The save text `next` as changes against the save text `base` (JSON of the patch). */
export const deltaText = (base: string, next: string): string => JSON.stringify(diffJson(JSON.parse(base), JSON.parse(next)) ?? null);

/** The save text rebuilt from `base` and a delta made by deltaText. */
export function applyDeltaText(base: string, delta: string): string {
  const p = JSON.parse(delta) as Patch | null;
  return p === null ? base : JSON.stringify(applyJson(JSON.parse(base), p));
}
