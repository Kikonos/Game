import { A350_CUTS, resizeNacelle, stretchTrace } from '../specs/wide-twin';
import { profile as a35k } from './a35k';
import type { TracedProfile } from './types';

// A350-900: the A350-1000 trace less the -1000's two plugs (3.8 m between door 2 and the wing,
// 3.19 m between doors 3 and 4): same nose, cockpit and tail cone. The -900 wing root is 0.4 m
// shorter (no -1000 trailing-edge extension) and the Trent XWB-84 is 3.6 m against 3.75 m.
const L = 66.8;
const base = stretchTrace(a35k, 73.79, 'a359', L, A350_CUTS, `derived from traced/a35k (${a35k.source}), A350-900 length`);

export const profile: TracedProfile = {
  ...base,
  wingRoot: base.wingRoot && { ...base.wingRoot, to: base.wingRoot.to - 0.4 / L },
  engines: base.engines?.map((e) => resizeNacelle(e, 1, 3.6 / 3.75)),
};
