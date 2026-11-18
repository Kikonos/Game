// v0.25 Hangar › From above: each aircraft in its own livery colours.
import { describe, expect, it } from 'vitest';
import { topLivery } from './Hangar';

describe('hangar from above', () => {
  it('the fuselage, tail and cowls take the livery; an unpainted airframe stays white with grey cowls', () => {
    expect(topLivery({ primary: '#0b3d91', secondary: '#fff', tail: 'solid', body: { color: '#ffffff', engines: '#d6283c' } })).toEqual({ body: '#ffffff', tail: '#0b3d91', engines: '#d6283c' });
    expect(topLivery({ primary: '#0b3d91', secondary: '#fff', tail: 'solid' })).toEqual({ body: '#f4f6f9', tail: '#0b3d91', engines: '#0b3d91' });
    expect(topLivery({ primary: '#d6283c', secondary: '#fff', tail: 'sweep', plain: true })).toEqual({ body: '#f4f6f9', tail: '#f4f6f9', engines: '#9aa3b2' });
  });
});
