// v0.14.1 (merge) the map's safe(): a failure falls back, and is logged to the console once per distinct failure, on the
// Ops Map as on its panels (OpsMap kept a silent copy).

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { safe } from './safe';

describe('v0.14.1 map safe()', () => {
  it('falls back and logs each distinct failure once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const boom = () => { throw new Error('half-built view'); };
      expect(safe(boom, 7)).toBe(7);
      expect(safe(boom, 7)).toBe(7);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(safe(() => { throw new Error('another'); }, [] as number[])).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(2);
      expect(safe(() => 3, 0)).toBe(3);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
  it('the Ops Map and its panels use it (no silent catch of their own)', () => {
    for (const f of ['OpsMap.tsx', 'MapPanels.tsx']) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');
      expect(src, f).toContain("import { safe } from './safe';");
      expect(src, f).not.toMatch(/function safe</);
    }
  });
});
