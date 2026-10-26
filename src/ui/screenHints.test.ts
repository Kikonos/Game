// v0.12 Visual B: first-time screen hints fold into the screen's '?' once seen.
import { describe, expect, it } from 'vitest';
import { foldHint, hintMode } from './screenHints';
import { settingsFrom } from './store';

describe('screen hint fold', () => {
  it('shows the strip to a new player, folds it once seen, and Don\'t show again removes it', () => {
    expect(hintMode('fleet', { screenHintsSeen: [], screenHintsFolded: [] })).toBe('strip');
    expect(hintMode('fleet', { screenHintsSeen: [], screenHintsFolded: ['fleet'] })).toBe('fold');
    expect(hintMode('finance', { screenHintsSeen: [], screenHintsFolded: ['fleet'] })).toBe('strip');
    expect(hintMode('fleet', { screenHintsSeen: ['fleet'], screenHintsFolded: ['fleet'] })).toBe('off');
    expect(hintMode('fleet', { screenHintsSeen: ['fleet'] })).toBe('off');
  });
  it('adds a hint to the folded list once', () => {
    expect(foldHint(undefined, 'map')).toEqual(['map']);
    expect(foldHint(['map'], 'map')).toEqual(['map']);
    expect(foldHint(['map'], 'inbox')).toEqual(['map', 'inbox']);
  });
  it('gives settings saved before v0.12 an empty folded list (every hint shows its strip once more)', () => {
    const s = settingsFrom({ screenHintsSeen: ['map'] } as never);
    expect(s.screenHintsFolded).toEqual([]);
    expect(hintMode('map', s)).toBe('off');
    expect(hintMode('schedule', s)).toBe('strip');
  });
});
