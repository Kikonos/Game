// Saves live in localStorage (lz-string) under a new prefix so they never collide with the airline game.
// Export/import as a JSON file. Versioned with step-by-step migrations (DESIGN.md §7.2).

import LZString from 'lz-string';
import { compactQueue } from './core/queue';
import { fmtDate } from './core/time';
import type { GameState } from './core/types';
import { SAVE_VERSION } from './newGame';
import { onLoad } from './sim';

const PREFIX = 'contrail-acmi:save:';
const FORMAT = 'contrail-acmi-save';
export const AUTOSAVE_SLOT = 'auto';
export const SLOTS = ['1', '2', '3', '4', '5'];

export interface SaveMeta {
  slot: string;
  company: string;
  code: string;
  now: number;
  date: string;
  cash: number;
  fleet: number;
  savedAt: number;
  color: string;
}

interface SaveFile {
  format: typeof FORMAT;
  meta: SaveMeta;
  state: GameState;
}

function metaFor(g: GameState, slot: string): SaveMeta {
  return {
    slot,
    company: g.company.name,
    code: g.company.code,
    now: g.now,
    date: fmtDate(g.now),
    cash: g.company.cash,
    fleet: Object.keys(g.fleet).length,
    savedAt: Date.now(),
    color: g.company.livery.primary,
  };
}

/** Stale queue events are dropped (handlers would ignore them anyway), which keeps saves small. */
export function serialize(g: GameState, slot = 'export', meta = metaFor(g, slot)): string {
  const file: SaveFile = { format: FORMAT, meta, state: { ...g, queue: compactQueue(g) } };
  return JSON.stringify(file);
}

export function deserialize(text: string): GameState {
  const data = JSON.parse(text) as Partial<SaveFile>;
  if (data.format !== FORMAT || !data.state) throw new Error('This file is not a BLOCK HOURS save.');
  const g = migrate(data.state);
  onLoad(g);
  return g;
}

/** Each step upgrades version n → n + 1; add a case per schema change. */
const MIGRATIONS: Record<number, (g: GameState) => void> = {
  // 1: (g) => { ...; },
};

export function migrate(g: GameState): GameState {
  if (typeof g.version !== 'number') throw new Error('Corrupt save file.');
  if (g.version > SAVE_VERSION) throw new Error('This save was made with a newer version of the game.');
  while (g.version < SAVE_VERSION) {
    MIGRATIONS[g.version]?.(g);
    g.version++;
  }
  return g;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const LZ_MARK = 'lz1:';
/** Uncompressed meta per slot, so the save list never decompresses whole games. */
const META = 'contrail-acmi:meta:';

/** False when storage is unavailable or full (QuotaExceededError); callers toast. */
export function saveToSlot(g: GameState, slot: string): boolean {
  const s = storage();
  if (!s) return false;
  const meta = metaFor(g, slot);
  const value = LZ_MARK + LZString.compressToUTF16(serialize(g, slot, meta));
  try {
    s.setItem(PREFIX + slot, value);
  } catch {
    return false;
  }
  writeMeta(s, slot, meta, value);
  return true;
}

/**
 * A cheap fingerprint of a stored save: its length and a hash of its head, tail and a strided sample (a slot
 * rewritten elsewhere with the same compressed length still differs).
 */
function fingerprint(raw: string): string {
  let h = 0x811c9dc5;
  const mix = (i: number) => {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  };
  const n = raw.length;
  for (let i = 0; i < Math.min(n, 256); i++) mix(i);
  for (let i = Math.max(0, n - 256); i < n; i++) mix(i);
  const step = Math.max(1, Math.floor(n / 512));
  for (let i = 0; i < n; i += step) mix(i);
  return `${n}:${(h >>> 0).toString(36)}`;
}

/** The meta key remembers the fingerprint of the save it describes: a slot written elsewhere (async autosave) is re-read. */
function writeMeta(s: Storage, slot: string, meta: SaveMeta, raw: string): void {
  try {
    s.setItem(META + slot, JSON.stringify({ meta, fp: fingerprint(raw) }));
  } catch {
    s.removeItem(META + slot);
  }
}

function readSlot(slot: string): string | null {
  const raw = storage()?.getItem(PREFIX + slot);
  if (!raw) return null;
  return raw.startsWith(LZ_MARK) ? LZString.decompressFromUTF16(raw.slice(LZ_MARK.length)) : raw;
}

export function loadFromSlot(slot: string): GameState | null {
  const text = readSlot(slot);
  return text ? deserialize(text) : null;
}

export function deleteSlot(slot: string): void {
  storage()?.removeItem(PREFIX + slot);
  storage()?.removeItem(META + slot);
}

/** Save metadata per slot from the small meta keys; older saves without one are read in full once (and cached). */
export function listSaves(): SaveMeta[] {
  const s = storage();
  if (!s) return [];
  const out: SaveMeta[] = [];
  for (const slot of [AUTOSAVE_SLOT, ...SLOTS]) {
    const raw = s.getItem(PREFIX + slot);
    if (!raw) continue;
    try {
      const m = JSON.parse(s.getItem(META + slot) ?? 'null') as { meta: SaveMeta; fp?: string } | null;
      if (m && m.fp === fingerprint(raw)) {
        out.push({ ...m.meta, slot });
        continue;
      }
    } catch {
      // fall back to the full save
    }
    const text = raw.startsWith(LZ_MARK) ? LZString.decompressFromUTF16(raw.slice(LZ_MARK.length)) : raw;
    if (!text) continue;
    try {
      const meta = { ...(JSON.parse(text) as SaveFile).meta, slot };
      out.push(meta);
      writeMeta(s, slot, meta, raw);
    } catch {
      // unreadable save
    }
  }
  return out;
}

export function latestSave(): SaveMeta | null {
  return listSaves().sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
