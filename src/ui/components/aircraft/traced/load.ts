// Every traced/<typeId>.ts in this folder, keyed by file name (= type id). No
// index to maintain: dropping a file here is enough for the renderer to use it.

import type { TracedProfile } from './types';

const files = import.meta.glob<{ profile?: TracedProfile }>(['./*.ts', '!./types.ts', '!./load.ts'], { eager: true });

export const TRACED: ReadonlyMap<string, TracedProfile> = new Map(
  Object.entries(files).flatMap(([file, mod]) => {
    const p = mod?.profile;
    const id = file.replace(/^.*\//, '').replace(/\.ts$/, '');
    return p && Array.isArray(p.top) && Array.isArray(p.bottom) ? [[id, p] as const] : [];
  }),
);

export function tracedFor(...ids: (string | undefined)[]): TracedProfile | undefined {
  for (const id of ids) if (id && TRACED.has(id)) return TRACED.get(id);
  return undefined;
}
