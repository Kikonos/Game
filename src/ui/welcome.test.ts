// v0.15 the welcome card of a new game: its text (a new airline; a scenario), and the store's rule: once per new game,
// with the low chime, never on a load, the menus' music until it is put away.
import { describe, expect, it, vi } from 'vitest';
import { createGame } from '../engine/newGame';
import { createScenario, SCENARIOS } from '../engine/scenario';
import { CAT_OF, SOUND_MEANING, soundLength } from './sound';
import { welcomeCard } from './welcome';

const livery = { primary: '#0b1f4d', secondary: '#f5c451', tail: 'sweep' as const };

describe('v0.15 the welcome card', () => {
  it('names the airline and its base, and says how the job works in a few short points', () => {
    const w = welcomeCard(createGame({ name: 'Blue Airlines', code: 'BL', livery, base: 'LIS', seed: 2 }));
    expect(w.title).toBe('Welcome to Blue Airlines, Lisbon');
    expect(w.button).toBe("Let's fly");
    expect(w.points.length).toBeGreaterThanOrEqual(4);
    expect(w.points.length).toBeLessThanOrEqual(6);
    const all = w.points.join(' ');
    for (const s of ['Aircraft', 'Crew', 'Maintenance', 'Insurance', 'block hour', 'Contracts › Market', 'phone in', 'roster', 'pauses itself', 'Contracts › Markets', 'Glossary']) expect(all).toContain(s);
    for (const p of w.points) expect(p.length).toBeLessThan(160);
  });

  it('a scenario gets its own briefing instead (one card, never two)', () => {
    const d = SCENARIOS[0];
    const w = welcomeCard(createScenario(d.id));
    expect(w.lead).toContain(d.name);
    expect(w.points[0]).toBe(d.brief);
    expect(w.points[1]).toMatch(/^Goal: /);
    expect(w.points.length).toBeLessThanOrEqual(6);
  });

  it('its chime is a low chime with its own Test sounds row', () => {
    expect(CAT_OF.welcome).toBe('chimes');
    expect(soundLength('welcome')).toBeGreaterThan(soundLength('lo'));
    expect(SOUND_MEANING.some((m) => m.id === 'welcome')).toBe(true);
  });
});

describe('v0.15 the store opens it once per new game', () => {
  it('a new game and a scenario open it with the chime, the menus\' music stays until it is put away; a load never shows it', async () => {
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const { sound } = await import('./sound');
    const { store } = await import('./store');
    const chime = vi.spyOn(sound, 'welcomeChime').mockImplementation(() => {});
    const scene = vi.spyOn(sound, 'setScene');
    store.startNewGame({ name: 'Blue Airlines', code: 'BL', livery, base: 'LIS', seed: 4 });
    expect(store.screen).toBe('game');
    expect(store.modal).toEqual({ kind: 'welcome' });
    expect(chime).toHaveBeenCalledTimes(1);
    expect(scene).toHaveBeenLastCalledWith(false);
    // The glossary over it keeps the menus' music; back to it, then put away: the game proper starts.
    store.openModal({ kind: 'glossary' });
    expect(scene).toHaveBeenLastCalledWith(false);
    store.closeModal();
    expect(store.modal).toEqual({ kind: 'welcome' });
    store.closeModal();
    expect(store.modal).toBeNull();
    expect(scene).toHaveBeenLastCalledWith(true);
    // Loading that game (or any save): no card, no chime, straight into the game's music.
    const g = store.game!;
    store.quitToTitle();
    expect(scene).toHaveBeenLastCalledWith(false);
    store.loadGame(g);
    expect(store.modal).toBeNull();
    expect(chime).toHaveBeenCalledTimes(1);
    expect(scene).toHaveBeenLastCalledWith(true);
    store.quitToTitle();
    store.startScenario(SCENARIOS[0].id);
    expect(store.modal).toEqual({ kind: 'welcome' });
    expect(chime).toHaveBeenCalledTimes(2);
    store.closeModal();
    store.quitToTitle();
    chime.mockRestore();
    scene.mockRestore();
    vi.unstubAllGlobals();
  });
});
