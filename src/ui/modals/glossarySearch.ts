// v0.25 r2 the glossary's search (pure): every word of the search in a term's name or meaning, name matches first.

import { GLOSSARY, type TermId } from '../../data/glossary';

/** v0.25 r2: lower case, no accents, so 'etops' finds ETOPS and 'cafe' finds café. */
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** The terms whose name or meaning holds every word of the search, name matches first (pure). */
export function glossarySearch(ids: TermId[], q: string): TermId[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return ids;
  const hit = ids.filter((id) => { const t = fold(`${GLOSSARY[id].term} ${GLOSSARY[id].short}`); return words.every((w) => t.includes(w)); });
  const inName = (id: TermId) => words.every((w) => fold(GLOSSARY[id].term).includes(w));
  return [...hit.filter(inName), ...hit.filter((id) => !inName(id))];
}
