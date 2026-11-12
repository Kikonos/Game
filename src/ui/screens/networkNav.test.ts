// v0.23.1 the Network on its own screen (report bmwdolc94ctrb): the rail item between Contracts and Schedule, and every
// way in (an Inbox line's route, the glossary, an old Contracts › Network link) lands there.

import { describe, expect, it } from 'vitest';
import { newGame } from '../../engine/contracts/testkit';
import { glossaryTarget } from '../components/problemLogic';
import { NAV } from '../shell/Shell';
import { store } from '../store';
import { refTarget } from './screenLogic';

describe('v0.23.1 the Network screen', () => {
  it('sits on the rail between Contracts and Schedule', () => {
    const tabs = NAV.map((n) => n.tab);
    expect(tabs.indexOf('network')).toBe(tabs.indexOf('contracts') + 1);
    expect(tabs.indexOf('schedule')).toBe(tabs.indexOf('network') + 1);
    expect(NAV.find((n) => n.tab === 'network')!.label).toBe('Network');
  });

  it('a route reference, the glossary and an old Contracts › Network link open it', () => {
    const g = newGame();
    expect(refTarget(g, { kind: 'route', id: 'rt1' })).toEqual({ tab: 'network', sel: { kind: 'route', id: 'rt1' } });
    expect(glossaryTarget({ tab: 'network' })).toEqual({ tab: 'network', view: undefined, label: 'Network' });
    expect(glossaryTarget({ tab: 'contracts', view: 'network' })).toEqual({ tab: 'network', view: undefined, label: 'Network' });
    // navigate scrolls the screen to the top (no DOM here).
    (globalThis as { document?: unknown }).document ??= { querySelector: () => null };
    store.navigate('contracts', { view: 'network' });
    expect(store.nav.tab).toBe('network');
    expect(store.nav.view).toBeUndefined();
    store.navigate('contracts', { view: 'market' });
    expect(store.nav).toMatchObject({ tab: 'contracts', view: 'market' });
  });
});
