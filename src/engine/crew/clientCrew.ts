// v0.8 mixed-crew contracts (UPDATE-0.8.md §7): the client provides n of M cabin crew (never pilots); our roster
// fills only our share, cabin crew seats first, the purser seat only when the client's senior cabin crew member
// leads. The rest plan and cabin legality still count the full complement. Pure.

import { BAL } from '../core/balance';
import { fmtDateTime } from '../core/time';
import type { Contract, ContractOffer, GameState, Minute, Requirements, Role } from '../core/types';
import type { CalBlock } from './calendar';

const N_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const word = (n: number) => N_WORD[n] ?? String(n);

/** The client's cabin crew in a complement: n seats, CC first, the PUR seat only when their SCCM leads. Pure. */
export function clientRoles(cc: Requirements['clientCabin']): Role[] {
  if (!cc || cc.n <= 0) return [];
  const out: Role[] = [];
  if (cc.leads) out.push('PUR');
  while (out.length < cc.n) out.push('CC');
  return out;
}

/** Drops the client's seats from a role list (CC first; PUR only when they lead). Pure. */
export function dropClientSeats<T extends { role: Role }>(seats: T[], cc: Requirements['clientCabin']): T[] {
  if (!cc || cc.n <= 0) return seats;
  const out = [...seats];
  let n = cc.n;
  if (cc.leads) {
    const i = out.findIndex((s) => s.role === 'PUR');
    if (i >= 0) {
      out.splice(i, 1);
      n--;
    }
  }
  for (let i = out.length - 1; i >= 0 && n > 0; i--) {
    if (out[i].role === 'CC') {
      out.splice(i, 1);
      n--;
    }
  }
  return out;
}

const contractOfDuty = (g: GameState, id: string): Contract | undefined => {
  const d = g.duties[id];
  const p = d ? g.pairings[d.pairingId] : g.pairings[id];
  let cid = p?.contractId ?? null;
  if (!cid && d) for (const fid of d.flightIds) if (g.flights[fid]?.contractId) cid = g.flights[fid].contractId;
  return cid ? g.contracts[cid] : undefined;
};

/** The client's cabin crew on a duty or pairing: how many, whether they lead, the row label and their seats. Pure. */
export function clientCrewOf(g: GameState, id: string): { n: number; leads: boolean; label: string; roles: Role[] } | null {
  const k = contractOfDuty(g, id);
  const cc = k?.requirements.clientCabin;
  if (!k || !cc || cc.n <= 0) return null;
  const name = g.clients[k.clientId]?.name ?? 'Client';
  return { n: cc.n, leads: cc.leads, label: `${name} cabin crew`, roles: clientRoles(cc) };
}

/** Grey rows for the roster board: one per mixed-crew contract, its duties as blocks (no names, not draggable). Pure. */
export function clientCrewRows(g: GameState, from: Minute, to: Minute): { key: string; label: string; n: number; blocks: CalBlock[] }[] {
  const out: { key: string; label: string; n: number; blocks: CalBlock[] }[] = [];
  for (const k of Object.values(g.contracts)) {
    const cc = k.requirements.clientCabin;
    if (!cc || cc.n <= 0 || k.status === 'cancelled' || k.end < from || k.start > to) continue;
    const name = g.clients[k.clientId]?.name ?? 'Client';
    const blocks: CalBlock[] = [];
    for (const p of Object.values(g.pairings)) {
      if (p.contractId !== k.id) continue;
      for (const did of p.dutyIds) {
        const d = g.duties[did];
        if (!d || d.release < from || d.report > to || !d.flightIds.length) continue;
        const f0 = g.flights[d.flightIds[0]];
        const fl = g.flights[d.flightIds[d.flightIds.length - 1]];
        blocks.push({
          kind: 'duty', start: d.report, end: d.release, label: `${name} crew`, dutyId: d.id, flightIds: [...d.flightIds],
          detail: `${name} cabin crew ×${cc.n}${cc.leads ? ' (their senior leads)' : ''} · ${f0 ? `${f0.no} ${f0.from}` : ''}${fl ? `–${fl.to}` : ''} · ${fmtDateTime(d.report)}`,
        });
      }
    }
    blocks.sort((a, b) => a.start - b.start);
    out.push({ key: k.id, label: `${name} · ${cc.n} per flight`, n: cc.n, blocks });
  }
  return out;
}

/** 'Air Sénégal provides 6 of 8 cabin crew; we fly the purser and one cabin crew. −$450 a block hour.' Pure. */
export function mixedCrewText(g: GameState, offerOrContractId: string): string | null {
  const x: ContractOffer | Contract | undefined = g.offers[offerOrContractId] ?? g.contracts[offerOrContractId];
  const cc = x?.requirements.clientCabin;
  if (!x || !cc || cc.n <= 0) return null;
  const name = g.clients[x.clientId]?.name ?? 'The client';
  const ours = cc.of - cc.n;
  const oursCc = cc.leads ? ours : ours - 1;
  const we = cc.leads
    ? `their senior cabin crew member leads; we fly ${word(ours)} cabin crew`
    : `we fly the purser${oursCc > 0 ? ` and ${word(oursCc)} cabin crew` : ''}`;
  const cut = BAL.v08.mixedCrew.perCabinBH * cc.n;
  return `${name} provides ${cc.n} of ${cc.of} cabin crew; ${we}. −$${cut.toLocaleString('en-US')} a block hour.`;
}

/** Flavour lines (language by client country, SEP cards). Pure. */
export function mixedCrewFlavour(g: GameState, offerOrContractId: string): string[] {
  const x = g.offers[offerOrContractId] ?? g.contracts[offerOrContractId];
  const cc = x?.requirements.clientCabin;
  if (!x || !cc) return [];
  const c = g.clients[x.clientId];
  const lang = LANG[c?.country ?? ''] ?? null;
  const name = c?.name ?? 'The client';
  return [
    lang ? `${name}'s crew brief in ${lang}; our purser runs the cabin in ${lang} and English.` : `${name}'s crew brief in English with ours.`,
    'Their uniform, our safety procedures: our purser checks their SEP cards at the first briefing.',
  ];
}

const LANG: Record<string, string> = {
  SN: 'French', MA: 'French', DZ: 'French', TN: 'French', CI: 'French', FR: 'French', BE: 'French', AO: 'Portuguese', BR: 'Portuguese', PT: 'Portuguese',
  ES: 'Spanish', PE: 'Spanish', MX: 'Spanish', SA: 'Arabic', JO: 'Arabic', AE: 'Arabic', DE: 'German', PL: 'Polish', ID: 'Indonesian', VN: 'Vietnamese', TR: 'Turkish',
};

/** The mixed-crew rate cut: $75 per client cabin crew member per block hour. Pure. */
export const mixedCrewCut = (cc: Requirements['clientCabin']): number => (cc && cc.n > 0 ? BAL.v08.mixedCrew.perCabinBH * cc.n : 0);
