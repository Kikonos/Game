import { describe, expect, it } from 'vitest';
import { GLOSSARY, type TermId } from '../../data/glossary';
import { glossarySearch } from './glossarySearch';

const all = Object.keys(GLOSSARY) as TermId[];

describe('v0.25 r2 glossary search', () => {
  it('an empty search keeps every term in order', () => {
    expect(glossarySearch(all, '  ')).toEqual(all);
  });
  it('finds a term by its name in any case, name matches first', () => {
    const id = all[0];
    const name = GLOSSARY[id].term;
    const r = glossarySearch(all, name.toUpperCase());
    expect(r).toContain(id);
    expect(GLOSSARY[r[0]].term.toLowerCase()).toContain(name.toLowerCase());
  });
  it('every word must match; nonsense finds nothing', () => {
    expect(glossarySearch(all, 'zzqx')).toEqual([]);
    for (const id of glossarySearch(all, 'crew rest')) {
      const t = `${GLOSSARY[id].term} ${GLOSSARY[id].short}`.toLowerCase();
      expect(t).toContain('crew');
      expect(t).toContain('rest');
    }
  });
});
