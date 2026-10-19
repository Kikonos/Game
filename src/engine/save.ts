// Saves live in localStorage (lz-string) under a new prefix so they never collide with the airline game.
// Export/import as a JSON file. Versioned with step-by-step migrations (DESIGN.md §7.2).

import LZString from 'lz-string';
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

export function serialize(g: GameState, slot = 'export'): string {
  const file: SaveFile = { format: FORMAT, meta: metaFor(g, slot), state: g };
  return JSON.stringify(file);
}

export function deserialize(text: string): GameState {
  const data = JSON.parse(text) as Partial<SaveFile>;
  if (data.format !== FORMAT || !data.state) throw new Error('This file is not a CONTRAIL ACMI save.');
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

export function saveToSlot(g: GameState, slot: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PREFIX + slot, LZ_MARK + LZString.compressToUTF16(serialize(g, slot)));
    return true;
  } catch {
    return false;
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
}

export function listSaves(): SaveMeta[] {
  if (!storage()) return [];
  const out: SaveMeta[] = [];
  for (const slot of [AUTOSAVE_SLOT, ...SLOTS]) {
    const text = readSlot(slot);
    if (!text) continue;
    try {
      out.push({ ...(JSON.parse(text) as SaveFile).meta, slot });
    } catch {
      // unreadable save
    }
  }
  return out;
}

export function latestSave(): SaveMeta | null {
  return listSaves().sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
