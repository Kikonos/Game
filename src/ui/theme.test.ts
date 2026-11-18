// v0.11 colour themes: the Appearance setting's defaults (dark for players from before, system for new installs),
// what each choice shows, and the pale-livery check the map uses on the light theme.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingsFrom } from './store';
import { paleOnLight, resolveTheme, STATUS_BAR, THEME_COLOR } from './theme';

describe('Appearance (v0.11)', () => {
  it('settings saved before themes keep the dark look; a stored choice stays', () => {
    expect(settingsFrom({ sound: true }).theme).toBe('dark');
    expect(settingsFrom({}).theme).toBe('dark');
    expect(settingsFrom({ theme: 'light' }).theme).toBe('light');
    expect(settingsFrom({ theme: 'system' }).theme).toBe('system');
  });

  it('light and dark are what they say; system follows the device (dark without one)', () => {
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
    expect(['light', 'dark']).toContain(resolveTheme('system'));
    expect(THEME_COLOR.dark).toBe('#070b14');
  });

  it('v0.25 the iOS home-screen status bar follows the theme: dark text on light, white on dark (the inline script too)', () => {
    expect(STATUS_BAR).toEqual({ light: 'default', dark: 'black' });
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    expect(html).toMatch(/apple-mobile-web-app-status-bar-style"\]'\)\.content = th === 'light' \? 'default' : 'black'/);
  });

  it('pale livery colours (white, cream) are swapped for the accent on the light map', () => {
    expect(paleOnLight('#ffffff')).toBe(true);
    expect(paleOnLight('#fff')).toBe(true);
    expect(paleOnLight('#f5f0d8')).toBe(true);
    expect(paleOnLight('#0b1f4d')).toBe(false);
    expect(paleOnLight('#f5c451')).toBe(false);
    expect(paleOnLight('var(--accent)')).toBe(false);
  });

  it('every token has a dark and a light value, and the dark ones are the original look', () => {
    const css = readFileSync(new URL('../styles/theme.css', import.meta.url), 'utf8');
    const block = (sel: string) => {
      const i = css.indexOf(sel);
      return new Set([...css.slice(i, css.indexOf('\n}', i)).matchAll(/^\s*(--[\w-]+):/gm)].map((m) => m[1]));
    };
    const dark = block(":root, :root[data-theme='dark'] {");
    const light = block(":root[data-theme='light'] {");
    expect(dark.size).toBeGreaterThan(100);
    for (const t of dark) expect(light.has(t), t).toBe(true);
    expect(css).toContain('--bg: #070b14;');
    expect(css).toContain('--accent: #3ee6ff;');
  });
});
