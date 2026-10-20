// Layout tiers and input mode, shared by the CSS (see src/styles/touch/README.md) and React.
//
//   wide     >= 1100px wide (and >= 500px tall): sidebar with labels — desktop, iPad landscape
//   medium   700–1099px wide (and >= 500px tall): 76px icon + label rail — iPad portrait
//   compact  < 700px wide or < 500px tall: top bar + bottom tabs + More sheet — Split View, Slide Over, phones
//
// Touch is a separate axis: html.touch is set while (hover: none) and (pointer: coarse) matches,
// or when forced for testing with ?touch in the URL or window.__CONTRAIL_FORCE_TOUCH__ = true.

import { useSyncExternalStore } from 'react';

export const WIDE = '(min-width: 1100px) and (min-height: 500px)';
export const MEDIUM = '(min-width: 700px) and (max-width: 1099.98px) and (min-height: 500px)';
export const COMPACT = '(max-width: 699.98px), (max-height: 499.98px)';
/** Compact and short (a phone on its side): the compact shell swaps the bottom tabs for a side rail. */
export const COMPACT_SHORT = '(max-height: 499.98px)';
export const TOUCH = '(hover: none) and (pointer: coarse)';
export const PORTRAIT = '(orientation: portrait)';

export type Tier = 'wide' | 'medium' | 'compact';

// One MediaQueryList and one stable subscribe/getSnapshot pair per query: inline functions would make
// useSyncExternalStore resubscribe (and call matchMedia) on every render.
const lists = new Map<string, MediaQueryList | null>();
const mql = (q: string): MediaQueryList | null => {
  let m = lists.get(q);
  if (m === undefined) {
    m = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(q) : null;
    lists.set(q, m);
  }
  return m;
};

interface QueryStore { subscribe: (cb: () => void) => () => void; get: () => boolean }
const stores = new Map<string, QueryStore>();

function queryStore(query: string): QueryStore {
  let s = stores.get(query);
  if (!s) {
    s = {
      subscribe: (cb) => {
        const m = mql(query);
        m?.addEventListener('change', cb);
        return () => m?.removeEventListener('change', cb);
      },
      get: () => !!mql(query)?.matches,
    };
    stores.set(query, s);
  }
  return s;
}

const serverFalse = () => false;

export function useMedia(query: string): boolean {
  const s = queryStore(query);
  return useSyncExternalStore(s.subscribe, s.get, serverFalse);
}

/** Current tier outside React (event handlers, the store). */
export function tierNow(): Tier {
  if (mql(COMPACT)?.matches) return 'compact';
  if (mql(MEDIUM)?.matches) return 'medium';
  return 'wide';
}

/** 'wide' | 'medium' | 'compact'; re-renders on rotation, Split View and window resizes. */
export function useTier(): Tier {
  const compact = useMedia(COMPACT);
  const medium = useMedia(MEDIUM);
  return compact ? 'compact' : medium ? 'medium' : 'wide';
}

export function usePortrait(): boolean {
  return useMedia(PORTRAIT);
}

// ---------- touch ----------

declare global {
  interface Window { __CONTRAIL_FORCE_TOUCH__?: boolean }
}

function forcedTouch(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.__CONTRAIL_FORCE_TOUCH__) return true;
  try {
    return new URLSearchParams(window.location.search).has('touch');
  } catch {
    return false;
  }
}

/** True when the primary input is a finger (iPad, phones); mirrors html.touch. */
export function isTouch(): boolean {
  return forcedTouch() || !!mql(TOUCH)?.matches;
}

export function useTouch(): boolean {
  return useSyncExternalStore(queryStore(TOUCH).subscribe, isTouch, serverFalse);
}

/** Keeps html.touch in sync with the input mode (called once from main.tsx). */
export function installTouchClass() {
  const apply = () => document.documentElement.classList.toggle('touch', isTouch());
  apply();
  mql(TOUCH)?.addEventListener('change', apply);
}
