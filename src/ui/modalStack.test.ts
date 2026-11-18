// v0.25 dialogs opened from Settings or the menu (Key bindings, What's new) go back there when closed.
import { describe, expect, it } from 'vitest';
import { modalUnder } from './store';

describe('v0.25 dialogs return to Settings or the menu', () => {
  it('Key bindings and What\'s new opened over Settings or the menu sit over it', () => {
    expect(modalUnder({ kind: 'keys' }, { kind: 'settings' })).toEqual({ kind: 'settings' });
    expect(modalUnder({ kind: 'whatsNew' }, { kind: 'menu' })).toEqual({ kind: 'menu' });
  });
  it('the glossary keeps its rule; nothing else stacks', () => {
    expect(modalUnder({ kind: 'glossary' }, { kind: 'settings' })).toEqual({ kind: 'settings' });
    expect(modalUnder({ kind: 'glossary' }, { kind: 'glossary' })).toBeNull();
    expect(modalUnder({ kind: 'keys' }, null)).toBeNull();
    expect(modalUnder({ kind: 'settings' }, { kind: 'menu' })).toBeNull();
  });
});
