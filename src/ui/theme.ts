// v0.11 colour themes: Settings › Appearance (Light / Dark / System). Puts data-theme on <html>, sets color-scheme
// and the PWA theme-color to match, and follows the system setting live while 'system' is chosen. Every colour,
// including the map, charts and SVG drawn from script, comes from the CSS tokens in styles/theme.css.

export type ThemePref = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';

/** The PWA status-bar / browser chrome colour per theme (the page background). */
export const THEME_COLOR: Record<Theme, string> = { dark: '#070b14', light: '#eef2f7' };

const media = (): MediaQueryList | null => {
  try {
    return typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;
  } catch {
    return null;
  }
};

/** The theme a choice shows now ('system' follows the device). */
export function resolveTheme(pref: ThemePref): Theme {
  if (pref !== 'system') return pref;
  return media()?.matches ? 'light' : 'dark';
}

let current: Theme = 'dark';
/** The theme on screen. */
export const activeTheme = (): Theme => current;

let watching: { mq: MediaQueryList; fn: () => void } | null = null;

/** Applies a choice to the document; with 'system', re-applies (and calls onChange) when the device switches. */
export function applyTheme(pref: ThemePref, onChange?: () => void): Theme {
  current = resolveTheme(pref);
  try {
    const root = document.documentElement;
    root.dataset.theme = current;
    root.style.colorScheme = current;
    root.style.background = THEME_COLOR[current];
    for (const m of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) m.content = THEME_COLOR[current];
    const cs = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
    if (cs) cs.content = current;
  } catch {
    // no DOM (tests)
  }
  if (watching) {
    watching.mq.removeEventListener?.('change', watching.fn);
    watching = null;
  }
  const mq = pref === 'system' ? media() : null;
  if (mq) {
    const fn = () => {
      applyTheme('system', onChange);
      onChange?.();
    };
    mq.addEventListener?.('change', fn);
    watching = { mq, fn };
  }
  return current;
}

/** A colour too pale to read on the light theme's map and pages (white, cream, pale grey): luminance above 0.6. */
export function paleOnLight(color: string): boolean {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return false;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4) > 0.6;
}
