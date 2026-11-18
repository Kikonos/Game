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
  it('v0.25 the cancel confirm and the sub-charter dialog open over the contract sheet and go back to it', () => {
    const sheet = { kind: 'contract', contractId: 'c1' } as const;
    expect(modalUnder({ kind: 'confirm' }, sheet)).toEqual(sheet);
    expect(modalUnder({ kind: 'subcharter' }, sheet)).toEqual(sheet);
    expect(modalUnder({ kind: 'confirm' }, { kind: 'settings' })).toBeNull();
    expect(modalUnder({ kind: 'client' }, sheet)).toBeNull();
  });
});
