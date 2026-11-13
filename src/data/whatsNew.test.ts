import { describe, expect, it } from 'vitest';
import { GLOSSARY } from './glossary';
import { CURRENT, unseenEntries, WHATS_NEW, whatsNewToShow } from './whatsNew';

const v = (xs: { version: string }[]) => xs.map((e) => e.version);

describe("v0.9 What's new catch-up (UPDATE-0.9.md §X)", () => {
  it('first v0.9 launch shows v0.9, v0.8 and v0.7.4 even when v0.8 was seen; then the normal rule', () => {
    // v0.9.1 is the newest now: it comes first and a v0.9 player sees it alone.
    // v0.18 is the newest now: it comes first (v0.17.2 went out with it). v0.18.1 after it.
    expect(CURRENT.version).toBe('v0.23.2');
    expect(v(whatsNewToShow('v0.8', false))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
    expect(v(whatsNewToShow('v0.8', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9']);
    expect(v(whatsNewToShow('v0.9', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1']);
    expect(v(whatsNewToShow('v0.9.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10']);
    expect(v(whatsNewToShow('v0.10', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1']);
    expect(v(whatsNewToShow('v0.10.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11']);
    expect(v(whatsNewToShow('v0.11', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1']);
    expect(v(whatsNewToShow('v0.11.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2']);
    expect(v(whatsNewToShow('v0.11.2', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3']);
    expect(v(whatsNewToShow('v0.11.3', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4']);
    expect(v(whatsNewToShow('v0.11.4', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12']);
    expect(v(whatsNewToShow('v0.12', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13']);
    expect(v(whatsNewToShow('v0.13', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14']);
    expect(v(whatsNewToShow('v0.14', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1']);
    expect(v(whatsNewToShow('v0.14.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15']);
    expect(v(whatsNewToShow('v0.15', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16']);
    expect(v(whatsNewToShow('v0.16', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1']);
    expect(v(whatsNewToShow('v0.16.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2']);
    expect(v(whatsNewToShow('v0.16.2', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3']);
    expect(v(whatsNewToShow('v0.16.3', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4']);
    expect(v(whatsNewToShow('v0.16.4', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17']);
    expect(v(whatsNewToShow('v0.17', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1']);
    expect(v(whatsNewToShow('v0.17.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2']);
    expect(v(whatsNewToShow('v0.17.2', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18']);
    expect(v(whatsNewToShow('v0.18', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1']);
    expect(v(whatsNewToShow('v0.18.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2']);
    expect(v(whatsNewToShow('v0.18.2', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3']);
    expect(v(whatsNewToShow('v0.18.3', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19']);
    expect(v(whatsNewToShow('v0.19', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1']);
    expect(v(whatsNewToShow('v0.19.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2']);
    expect(v(whatsNewToShow('v0.19.2', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3']);
    expect(v(whatsNewToShow('v0.19.3', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4']);
    expect(v(whatsNewToShow('v0.19.4', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5']);
    expect(v(whatsNewToShow('v0.19.5', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20']);
    expect(v(whatsNewToShow('v0.20', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1']);
    expect(v(whatsNewToShow('v0.20.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21']);
    expect(v(whatsNewToShow('v0.21', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22']);
    expect(v(whatsNewToShow('v0.22', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1']);
    expect(v(whatsNewToShow('v0.22.1', true))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23']);
    expect(v(whatsNewToShow('v0.23', true))).toEqual(['v0.23.2', 'v0.23.1']);
    expect(v(whatsNewToShow('v0.23.1', true))).toEqual(['v0.23.2']);
    expect(whatsNewToShow('v0.23.2', true)).toEqual([]);
    expect(v(whatsNewToShow('v0.7.4', false))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4']);
  });
  it('v0.23.2 routes for every start base, on top in short plain lines', () => {
    expect(`${WHATS_NEW[0].version} ${WHATS_NEW[0].name}`).toBe('v0.23.2 Routes for every start base');
    const lines = [...WHATS_NEW[0].features, ...WHATS_NEW[0].improvements, ...(WHATS_NEW[0].fixes ?? [])];
    const txt = lines.join('\n');
    for (const w of ['markets from your own base', 'Malta, Madrid, Vilnius, Riga, Tallinn, Prague and Sofia', 'Some pay and some lose', 'a widebody later', 'Benghazi, Tangier and Marsa Alam']) expect(txt).toContain(w);
    for (const w of ['Worth a study', 'it says why', 'name your own base', 'real runway lengths', 'listed Lisbon and Porto markets', 'ideas at every start base']) expect(txt).toContain(w);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(200);
  });
  it('v0.23.1 the class planner, step two, below it, in short plain lines', () => {
    expect(`${WHATS_NEW[1].version} ${WHATS_NEW[1].name}`).toBe('v0.23.1 Planner step two, stacked work, later report times, tidy bug reports, Network screen');
    const lines = [...WHATS_NEW[1].features, ...WHATS_NEW[1].improvements, ...(WHATS_NEW[1].fixes ?? [])];
    const txt = lines.join('\n');
    for (const w of ['three types', 'drops A320', 'Plan classes', 'Next', 'Inbox', 'hire replacements']) expect(txt).toContain(w);
    expect(txt).toMatch(/hires would join/);
    expect(txt).toMatch(/hiring hold/);
    // The later report time on the roster, and the crew alarm fixes from the player's export.
    for (const w of ['Log a later report time', 'at most an hour', 'once per duty', 'morale', 'Twice in 28 days', 'a fine and an audit finding']) expect(txt).toContain(w);
    for (const w of ['no longer called busy', 'that trip\'s alarm', '10 hours of rest', 'waits for them (up to an hour)']) expect(txt).toContain(w);
    // The bug reports lane: fixed reports cleared on opening, a snapshot for every crew alarm, Expenses and Income, '?' boxes.
    for (const w of ['Fixed bug reports clear themselves', 'Bug reports › Cleared', 'not only the newest 12', 'Expenses', 'Income', 'biggest first', 'whole on the screen', 'Up next', 'after zooming out']) expect(txt).toContain(w);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(240);
  });
  it('v0.23.1 the network on its own screen, a route cabin changed with its comparison, network news that pauses', () => {
    const txt = [...WHATS_NEW[1].features, ...WHATS_NEW[1].improvements, ...(WHATS_NEW[1].fixes ?? [])].join('\n');
    for (const w of ['its own screen', 'between Contracts and Schedule', 'Sales › Cabin', 'economy only', 'a flight, a week or a month', 'part of their fare back', 'Pause for network news']) expect(txt).toContain(w);
  });
  it('v0.23.1 the final debug round, in short plain lines', () => {
    const lines = [...WHATS_NEW[1].features, ...WHATS_NEW[1].improvements, ...(WHATS_NEW[1].fixes ?? [])];
    const txt = lines.join('\n');
    for (const w of ['refunds paid at once', 'your cash after', 'counted in the month it flies', 'less a fee', 'into their rest', 'the others on that duty', 'each person\'s morale cost', 'uses every seat', 'keep their cabin', 'Lisbon–Bissau', 'once your game is open', 'until you export them', '1,445']) expect(txt).toContain(w);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(240);
  });
  it('v0.23 crew planned person by person below it, in short plain lines', () => {
    expect(`${WHATS_NEW[2].version} ${WHATS_NEW[2].name}`).toBe('v0.23 Crew person by person, and a class planner');
    const lines = [...WHATS_NEW[2].features, ...WHATS_NEW[2].improvements, ...(WHATS_NEW[2].fixes ?? [])];
    const txt = lines.join('\n');
    for (const w of ['their own roster', 'A set is no longer a lock', 'Covering', 'XY3120 at Riyadh', 'XY3102', 'when you load your game']) expect(txt).toContain(w);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(240);
  });

  it('v0.23 plan your classes below it, in short plain lines', () => {
    expect(`${WHATS_NEW[2].version} ${WHATS_NEW[2].name}`).toContain('v0.23');
    const lines = [...WHATS_NEW[2].features, ...WHATS_NEW[2].improvements, ...(WHATS_NEW[2].fixes ?? [])];
    const txt = lines.join('\n');
    expect(txt).toMatch(/Plan classes/);
    expect(txt).toMatch(/fewer, bigger classes to least roster disruption/);
    expect(txt).toMatch(/give up a type rating/);
    expect(txt).toMatch(/spec sheet/);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(260);
  });
  it('v0.22.1 crew alarms you can check below it, in short plain lines', () => {
    expect(`${WHATS_NEW[3].version} ${WHATS_NEW[3].name}`).toBe('v0.22.1 Crew alarms you can check');
    const lines = [...WHATS_NEW[3].features, ...WHATS_NEW[3].improvements, ...(WHATS_NEW[3].fixes ?? [])];
    const txt = lines.join('\n');
    expect(txt).toMatch(/Every crew alarm is now kept, quietly/);
    expect(txt).toMatch(/A ferry flight with no pilots simply waits/);
    expect(txt).toMatch(/Refund: crew planning error/);
    expect(txt).toMatch(/CVE166 at Jeddah/);
    expect(txt).toMatch(/Pedro Sousa/);
    expect(txt).toMatch(/dangerous goods application no longer shows under Office & sales/);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(260);
  });

  it('v0.22 cleaner screens below it, in short plain lines', () => {
    expect(`${WHATS_NEW[4].version} ${WHATS_NEW[4].name}`).toBe('v0.22 Cleaner screens');
    const lines = [...WHATS_NEW[4].features, ...WHATS_NEW[4].improvements, ...(WHATS_NEW[4].fixes ?? [])];
    const txt = lines.join('\n');
    for (const w of ['"?"', 'Tidier screens', 'month letters', 'one row a year']) expect(txt).toContain(w);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(160);
  });
  it('v0.21 stopovers and route advice below it, in plain words', () => {
    expect(`${WHATS_NEW[5].version} ${WHATS_NEW[5].name}`).toBe('v0.21 Stopovers and route advice');
    const txt = [...WHATS_NEW[5].features, ...WHATS_NEW[5].improvements, ...(WHATS_NEW[5].fixes ?? [])].join('\n');
    for (const w of ['stopover', 'Fuel stop only', 'fifth-freedom', 'Worth it', 'analyst', 'network planner', 'Show study', 'Valid until', 'Stays at']) expect(txt).toContain(w);
    expect(txt).not.toMatch(/P10|P50|P90|RASK|CASK/);
  });
  it('v0.20.1 below it, v0.20 kept below that, in plain short lines', () => {
    expect(WHATS_NEW.slice(6, 8).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.20.1 Measures, leads & durations', 'v0.20 Finance at a glance']);
    const txt = [...WHATS_NEW[6].features, ...WHATS_NEW[6].improvements, ...(WHATS_NEW[6].fixes ?? [])].join('\n');
    for (const s of ['Measures in place', 'The bank', 'Open tender', 'Exclusive', 'From tender', 'From lead', 'how long a job runs', 'days and in months', 'sub-lease', 'still blocks', '"?"']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|freeUp|blockTier|BAL\.|feasibility/);
    // Short lines: nothing over 260 characters.
    for (const l of [...WHATS_NEW[6].features, ...WHATS_NEW[6].improvements, ...(WHATS_NEW[6].fixes ?? [])]) expect(l.length).toBeLessThanOrEqual(260);
  });
  it('v0.20 finance at a glance below v0.20.1, v0.19.5 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(7, 9).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.20 Finance at a glance', 'v0.19.5 Empty legs']);
    const txt = [...WHATS_NEW[7].features, ...WHATS_NEW[7].improvements, ...(WHATS_NEW[7].fixes ?? [])].join('\n');
    for (const s of ['You made', 'You lost', 'one-off', 'Where the money went', 'Tap a slice', 'Each block hour', 'biggest changes', 'Crew › Utilisation', 'cash line']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|LedgerCat|glance\.ts|BAL\./);
  });
  it('v0.19.5 empty legs below v0.20, v0.19.4 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(8, 10).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.5 Empty legs', 'v0.19.4 Widebody tenders']);
    const txt = [...WHATS_NEW[8].features, ...WHATS_NEW[8].improvements, ...(WHATS_NEW[8].fixes ?? [])].join('\n');
    for (const s of ['empty leg', 'pilots only', 'ride along', 'rated on two', 'day off', 'globe', "airline's name"]) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|ORO\.|BAL\.|MULTI_RATED|pairing/);
  });
  it('v0.19.4 widebody tenders on top, v0.19.3 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(9, 11).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.4 Widebody tenders', 'v0.19.3 Leave from away']);
    const txt = [...WHATS_NEW[9].features, ...WHATS_NEW[9].improvements, ...(WHATS_NEW[9].fixes ?? [])].join('\n');
    for (const s of ['Widebody tenders', 'Hajj', 'Umrah', 'Condor', 'Edelweiss', 'follow your fleet', 'keeps the body', 'double-decker', 'ETOPS 180 is fairer', 'reliability programme']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|wideShare|techAc|BAL\./);
  });
  it('v0.19.3 leave from away on top, v0.19.2 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(10, 12).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.3 Leave from away', 'v0.19.2 Your own routes']);
    const txt = [...WHATS_NEW[10].features, ...WHATS_NEW[10].improvements, ...(WHATS_NEW[10].fixes ?? [])].join('\n');
    for (const s of ['first day of leave', 'last day', 'next duty', 'keeps its days', 'not duty', 'SGN→LIS']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|leaveTrip|FTL\.|horizon/);
  });
  it('v0.19.2 your own routes on top, v0.19.1 kept below it, in plain words', () => {
    expect(WHATS_NEW.slice(11, 13).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19.2 Your own routes', 'v0.19.1 Emergency swap']);
    const txt = [...WHATS_NEW[11].features, ...WHATS_NEW[11].improvements, ...(WHATS_NEW[11].fixes ?? [])].join('\n');
    for (const s of ['Build your own route', 'any airport', 'fuel stops', 'rough guess', 'flat map', 'Range from', '"5 weeks"', 'paint shop']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|O&D|ETOPS cap|customTruth/);
  });
  it('v0.19 scheduled routes on top, v0.18.3 kept below it (one release), in plain words', () => {
    expect(WHATS_NEW.slice(13, 15).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.19 Scheduled routes', 'v0.18.3 Pilot pairs']);
    const txt = [...WHATS_NEW[13].features, ...WHATS_NEW[13].improvements, ...(WHATS_NEW[13].fixes ?? [])].join('\n');
    for (const s of ['Contracts › Network', 'market study', 'recommends', 'load factor', 'live animals', 'drag it: the whole rotation moves', 'sub-charter (no penalty)', 'ticket cash']) expect(txt).toContain(s);
    // The same release: the screen polish, the smooth map and the second bug batch of 8 Nov.
    for (const s of ['Calmer screens', 'Panning and zooming the map is smooth', 'Annual leave starts and ends at home', 'Day off moved', 'stay on standby at the hotel', 'crew out of hours']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/§|EU261|unearned/);
  });
  it('v0.18.3 pilot pairs (no cruise relief rank), Convert, the map strip and the calendar, in plain words', () => {
    expect(WHATS_NEW.slice(14, 16).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.3 Pilot pairs', 'v0.18.2 Crew utilisation']);
    const e183 = WHATS_NEW[14];
    const txt = [...e183.features, ...e183.improvements, ...(e183.fixes ?? [])].join('\n');
    for (const s of ['3 pilots are a captain and 2 first officers', 'pairs A and B', 'sit as first officer', 'at the controls', 'Convert', 'scrolls sideways', 'All aircraft', 'Positioning', 'layover', 'Cruise relief pilots are now first officers']) expect(txt).toContain(s);
    expect(txt).not.toMatch(/\bCRP\b/);
  });
  it('v0.18.2 crew utilisation, in plain words, with the weekly-rest and leave fixes', () => {
    expect(WHATS_NEW.slice(15, 17).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.2 Crew utilisation', 'v0.18.1 Leave & monthly rosters']);
    const v182 = WHATS_NEW[15];
    const txt = [...v182.features, ...v182.improvements, ...(v182.fixes ?? [])].join('\n');
    for (const s of ['Crew › Utilisation', '60–85 h a month', 'unpaid leave', 'redundant', 'follow the flying', 'stands one down', 'stops hiring', '168 h', 'Leave no longer cuts a rotation']) expect(txt).toContain(s);
  });
  it('v0.18.1 leave and the monthly roster, in plain words, with the fixes from the reports', () => {
    expect(WHATS_NEW.slice(16, 19).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18.1 Leave & monthly rosters', 'v0.18 Rosters, maps & spec sheets', 'v0.17.2 Your reports']);
    const v181 = WHATS_NEW[16];
    const txt = [...v181.features, ...v181.improvements, ...(v181.fixes ?? [])].join('\n');
    for (const s of ['yearly allowance', 'Crew › Leave', 'comes out on the 15th', 'layover', 'boarding passes', 'flight numbers']) expect(txt).toContain(s);
  });
  it('v0.18 goes out with v0.17.2: both entries, the spec sheets in v0.18', () => {
    expect(WHATS_NEW.slice(17, 19).map((e) => `${e.version} ${e.name}`)).toEqual(['v0.18 Rosters, maps & spec sheets', 'v0.17.2 Your reports']);
    const v18 = WHATS_NEW[17];
    const all = [...v18.features, ...v18.improvements].join('\n');
    for (const s of ['Aircraft spec sheets', 'A seat map for every type', 'Compare up to three Market offers', 'their own sheet', 'wraps east–west']) expect(all).toContain(s);
  });
  it('a fresh install gets the newest only; an older player everything since their version', () => {
    expect(whatsNewToShow('', false)).toEqual([CURRENT]);
    expect(v(whatsNewToShow('v0.7.2', false))).toEqual(['v0.23.2', 'v0.23.1', 'v0.23', 'v0.22.1', 'v0.22', 'v0.21', 'v0.20.1', 'v0.20', 'v0.19.5', 'v0.19.4', 'v0.19.3', 'v0.19.2', 'v0.19.1', 'v0.19', 'v0.18.3', 'v0.18.2', 'v0.18.1', 'v0.18', 'v0.17.2', 'v0.17.1', 'v0.17', 'v0.16.4', 'v0.16.3', 'v0.16.2', 'v0.16.1', 'v0.16', 'v0.15', 'v0.14.1', 'v0.14', 'v0.13', 'v0.12', 'v0.11.4', 'v0.11.3', 'v0.11.2', 'v0.11.1', 'v0.11', 'v0.10.1', 'v0.10', 'v0.9.1', 'v0.9', 'v0.8', 'v0.7.4', 'v0.7.3', 'v0.7.2.2', 'v0.7.2.1']);
    expect(whatsNewToShow('v0.7.2', true)).toEqual(unseenEntries('v0.7.2'));
  });
  it("v0.9.1: the tuning entry lists the music and the crew changes in plain words", () => {
    const e = WHATS_NEW.find((x) => x.version === 'v0.9.1')!;
    const all = [...e.features, ...e.improvements].join('\n');
    expect(all).toContain('Calm background music (Settings → Sound to change the volume or turn it off).');
    expect(all).toMatch(/can’t be crewed in time/);
  });
});


describe('v0.9 round 4 texts (§V, §Y.2, §R)', () => {
  it("What's new: every 450-seat type, fuel at cost on charters not Hajj, the catch-up rule, one days-off phrase", () => {
    const v09 = WHATS_NEW.find((e) => e.version === 'v0.9')!;
    const all = [...v09.features, ...v09.improvements].join('\n');
    expect(all).toMatch(/Jumbo loads \(420\+ seats\) for the 747-400 and other 450-seat jets, and charters with fuel billed at cost/);
    expect(all).not.toMatch(/Hajj[^.]*with fuel at cost/);
    expect(all).toMatch(/also shows the notes of the versions you skipped, once/);
    expect(all).toMatch(/8–10 days off a month in 2–3-day blocks \(one block a week is the 36 h rest\) and 4 weeks’ leave/);
  });
  it('glossary: the A380 takes a jumbo load, fuel at cost is a government and military term, standby cuts the day that follows', () => {
    expect(GLOSSARY.jumboLoad.short).toMatch(/only a 777-300ER, a 747-400 or an A380 takes it in one go\.$/);
    expect(GLOSSARY.fuelAtCost.short).toMatch(/Common on government and military charters\.$/);
    expect(GLOSSARY.fuelAtCost.short).not.toContain('Hajj');
    expect(GLOSSARY.airportStandby.short).toBe('Standby at the airport, ready at once. It counts in full as duty; called after 4 h, the day that follows is cut by the standby beyond 4 h; standby plus flying stays within 16 h.');
    expect(GLOSSARY.homeStandby.short).toMatch(/called after 6 h, the day is cut by the standby beyond 6 h\.$/);
    expect(GLOSSARY.daysOff.short).toMatch(/8–10 days off a month in 2–3-day blocks \(one block a week is the 36 h rest\) and 4 weeks’ leave/);
  });
});
