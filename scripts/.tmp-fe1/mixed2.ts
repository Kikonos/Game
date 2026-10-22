import { createGame } from '/home/user/wt/acmi/src/engine/newGame';
import { devMixedCrew } from '/home/user/wt/acmi/src/engine/dev';
import { advanceTo } from '/home/user/wt/acmi/src/engine/sim';
import { DAY } from '/home/user/wt/acmi/src/engine/core/time';
for (const [lead, n] of [[false, 3], [true, 4], [false, 4]] as const) {
  const g = createGame({ name: 'T', code: 'TT', livery: { primary: '#000', secondary: '#fff', tail: 'sweep' } as any, base: 'LIS', seed: 1 });
  // patch: make devMixedCrew build with chosen split by intercepting acceptOffer requirement via offers proxy
  const did = devMixedCrew(g);
  const p = g.pairings[g.duties[did].pairingId];
  const k = g.contracts[p.contractId!];
  console.log('default', JSON.stringify(k.requirements.clientCabin), 'slots', p.slots.map((s) => s.role).join(','));
  break;
}
