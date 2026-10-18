// Save games live in localStorage so the game works fully offline.
// Saves can also be exported to / imported from a JSON file.

import LZString from 'lz-string';
import { SAVE_VERSION } from './newGame';
import type { GameState } from './types';

const PREFIX = 'contrail:save:';
export const AUTOSAVE_SLOT = 'auto';
export const SLOTS = ['1', '2', '3', '4', '5'];

export interface SaveMeta {
  slot: string;
  airline: string;
  code: string;
  day: number;
  cash: number;
  fleet: number;
  level: number;
  savedAt: number;
  color: string;
}

interface SaveFile {
  format: 'contrail-save';
  meta: SaveMeta;
  state: GameState;
}

function metaFor(state: GameState, slot: string): SaveMeta {
  return {
    slot,
    airline: state.airline.name,
    code: state.airline.code,
    day: state.day,
    cash: state.cash,
    fleet: state.fleet.length,
    level: state.level,
    savedAt: Date.now(),
    color: state.airline.livery.primary,
  };
}

export function serialize(state: GameState, slot = 'export'): string {
  const file: SaveFile = { format: 'contrail-save', meta: metaFor(state, slot), state };
  return JSON.stringify(file);
}

export function deserialize(text: string): GameState {
  const data = JSON.parse(text) as Partial<SaveFile>;
  if (data.format !== 'contrail-save' || !data.state) throw new Error('This file is not a CONTRAIL save game.');
  return migrate(data.state);
}

function migrate(state: GameState): GameState {
  if (typeof state.version !== 'number') throw new Error('Corrupt save file.');
  if (state.version > SAVE_VERSION) throw new Error('This save was made with a newer version of the game.');
  // Future migrations go here, e.g. if (state.version < 2) { ...; state.version = 2; }
  state.contracts ??= [];
  state.decisions ??= [];
  return state;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function saveToSlot(state: GameState, slot: string): boolean {
  const s = storage();
  if (!s) return false;
  try {
    s.setItem(PREFIX + slot, LZ_MARK + LZString.compressToUTF16(serialize(state, slot)));
    return true;
  } catch {
    return false;
  }
}

const LZ_MARK = 'lz1:';

function readSlot(slot: string): string | null {
  const raw = storage()?.getItem(PREFIX + slot);
  if (!raw) return null;
  return raw.startsWith(LZ_MARK) ? LZString.decompressFromUTF16(raw.slice(LZ_MARK.length)) : raw;
}

export function loadFromSlot(slot: string): GameState | null {
  const text = readSlot(slot);
  if (!text) return null;
  return deserialize(text);
}

export function deleteSlot(slot: string) {
  storage()?.removeItem(PREFIX + slot);
}

export function listSaves(): SaveMeta[] {
  if (!storage()) return [];
  const out: SaveMeta[] = [];
  for (const slot of [AUTOSAVE_SLOT, ...SLOTS]) {
    const text = readSlot(slot);
    if (!text) continue;
    try {
      const file = JSON.parse(text) as SaveFile;
      out.push({ ...file.meta, slot });
    } catch {
      // ignore unreadable saves
    }
  }
  return out;
}

export function latestSave(): SaveMeta | null {
  const saves = listSaves();
  return saves.sort((a, b) => b.savedAt - a.savedAt)[0] ?? null;
}
