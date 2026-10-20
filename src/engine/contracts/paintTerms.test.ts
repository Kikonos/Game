// Client paint on offers and contracts (v0.5.1, LIVERY.md §4, §6 ENGINE).

import { describe, expect, it } from 'vitest';
import { BAL } from '../core/balance';
import { flightsOf } from '../core/entities';
import { DAY } from '../core/time';
import type { Archetype, ContractOffer, GameState } from '../core/types';
import { acceptOffer, askingPrice, cancelContract, counterOffer, feasibility, generateOffer, type OfferOpts } from './index';
import { paintQuote, paintWindow } from './paintTerms';
import { programmeOf } from './plan';
import { newGame, offer, run } from './testkit';
import { liveryOf } from '../ops/paint';
import { deserialize, serialize } from '../save';

type Opts = OfferOpts;
const line = (g: GameState, cat: 'paint' | 'otherRevenue') =>
  [...g.finance.history, g.finance.current].reduce((s, st) => s + (st.lines[cat] ?? 0), 0);

/** A HAM–PMI season base with forced client paint, starting `lead` days out. */
function paintBase(g: GameState, kind: 'full' | 'decals', required: boolean, lead = 40, days = 60, extra: Opts = {}): ContractOffer {
  return offer(g, 'seasonBase', { airport: 'HAM', dests: ['PMI'], waves: 2, start: g.now + lead * DAY, days, paint: { kind, required }, ...extra });
}

const firstOk = (g: GameState, o: ContractOffer, paint = true) => Object.keys(g.fleet).find((id) => feasibility(g, o.id, id, { paint }).level !== 'no')!;

describe('paint requests on offers', () => {
  it('turn up at the §4.1 rates (±50%), never on AOG cover or repatriation', () => {
    const n = new Map<string, [number, number]>();
    const bump = (k: string, p: boolean) => {
      const v = n.get(k) ?? [0, 0];
      v[0]++;
      if (p) v[1]++;
      n.set(k, v);
    };
    const mix: Archetype[] = ['seasonBase', 'seasonBase', 'seasonBase', 'troopRotation', 'tourSeries', 'aogCover', 'repatriation'];
    for (let seed = 1; seed <= 10; seed++) {
      const g = newGame(seed);
      for (let i = 0; i < 140; i++) {
        const o = generateOffer(g, mix[i % mix.length]);
        if (!o) continue;
        const days = (o.end - o.start) / DAY;
        const k =
          o.archetype === 'seasonBase' ? (days >= 120 ? 'long' : days >= 60 ? 'mid' : 'short')
          : o.archetype === 'troopRotation' ? (/^UN/.test(g.clients[o.clientId].name) ? 'un' : 'gov')
          : o.archetype === 'tourSeries' ? (days >= 56 ? 'tour56' : 'tour')
          : o.archetype;
        bump(k, !!o.paint);
        if (o.paint && k === 'mid') expect(o.paint.kind).toBe('decals');
        delete g.offers[o.id];
      }
    }
    const rate = (k: string) => {
      const [all, p] = n.get(k) ?? [0, 0];
      expect(all, k).toBeGreaterThan(20);
      return p / all;
    };
    const near = (k: string, want: number) => {
      const r = rate(k);
      expect(r, k).toBeGreaterThanOrEqual(want * 0.5);
      expect(r, k).toBeLessThanOrEqual(want * 1.5);
    };
    near('short', BAL.paint.baseShort);
    near('mid', BAL.paint.baseMid);
    near('long', BAL.paint.baseLong);
    near('un', BAL.paint.unRotation);
    near('tour56', BAL.paint.tourSeries);
    for (const k of ['aogCover', 'repatriation', 'gov', 'tour']) expect(rate(k), k).toBe(0);
  });

  it('quotes cost per aircraft, the share and the price without paint', () => {
    const g = newGame(3);
    const o = paintBase(g, 'full', false);
    const t = o.paint!;
    expect(t.cost).toBeGreaterThanOrEqual(BAL.paint.full.cost[0][0]);
    expect(t.cost).toBeLessThanOrEqual(BAL.paint.full.cost[0][1]);
    expect(t.stripCost).toBe(Math.round((t.cost * BAL.paint.stripFactor) / 1000) * 1000);
    expect(o.blurb).toMatch(/Full repaint/);
    const on = paintQuote(o, true);
    expect(on.cost).toBe(t.cost + t.stripCost);
    expect(on.reimbursed).toBe(Math.round(on.cost * t.clientShare));
    const off = paintQuote(o, false);
    expect(askingPrice(off)).toBe(Math.round((askingPrice(o) / (1 + (t.bonusPct ?? 0))) * (1 - t.declinePct)));
    expect(off.cost).toBe(0);
  });
});

describe('paint in feasibility', () => {
  it('needs a paint-shop slot: no when the paint cannot end a day before the job', () => {
    const g = newGame(4);
    const o = paintBase(g, 'decals', true, 20);
    const id = firstOk(g, o);
    const rep = feasibility(g, o.id, id);
    expect(rep.checks.find((c) => c.id === 'paint')?.level).toBe('ok');
    expect(rep.paint!.end).toBeLessThanOrEqual(programmeOf(o, g.fleet[id].typeId).trips[0].std - BAL.paint.readyBefore);
    o.paint!.days = 25;
    const no = feasibility(g, o.id, id);
    expect(no.checks.find((c) => c.id === 'paint')?.level).toBe('no');
    expect(no.paint).toBeUndefined();
    // Paint costs show in the contribution estimate (our share only).
    o.paint!.days = 2;
    o.paint!.clientShare = 0;
    const cost = feasibility(g, o.id, id).estCost;
    expect(cost - feasibility(g, o.id, id, { paint: false }).estCost).toBeGreaterThanOrEqual(o.paint!.cost + o.paint!.stripCost);
  });

  it('required paint cannot be switched off at signing; optional paint off cuts the rate', () => {
    const g = newGame(5);
    const req = paintBase(g, 'decals', true);
    const id = firstOk(g, req);
    expect(feasibility(g, req.id, id, { paint: false }).checks.find((c) => c.id === 'paint')?.level).toBe('no');
    const r = acceptOffer(g, req.id, [id], { paint: false });
    expect(r.ok).toBe(false);
    const g2 = newGame(5);
    const opt = paintBase(g2, 'decals', false);
    const want = askingPrice(paintQuote(opt, false));
    const ok = acceptOffer(g2, opt.id, [firstOk(g2, opt, false)], { paint: false });
    expect(ok.ok).toBe(true);
    const c = g2.contracts[ok.ok ? ok.data!.contractId : ''];
    expect(askingPrice(c)).toBe(want);
    expect(c.paint?.accepted).toBe(false);
    expect(Object.values(g2.maintenance).some((m) => m.kind === 'paint')).toBe(false);
  });
});

describe('paint on contracts', () => {
  it('books the paint-in before the job, paints, invoices, then strips after it', () => {
    const g = newGame(6);
    const o = paintBase(g, 'full', true, 21, 45);
    const id = firstOk(g, o);
    const r = acceptOffer(g, o.id, [id]);
    expect(r.ok).toBe(true);
    const c = g.contracts[r.ok ? r.data!.contractId : ''];
    const m = g.maintenance[c.paint!.inMx![id]];
    expect(m).toMatchObject({ kind: 'paint', status: 'planned', paint: { phase: 'in', contractId: c.id } });
    const legs = flightsOf(g, id).filter((f) => f.contractId === c.id && f.kind === 'revenue');
    expect(legs.length).toBeGreaterThan(0);
    expect(m.end).toBeLessThanOrEqual(legs[0].std - BAL.paint.readyBefore);
    expect(flightsOf(g, id).some((f) => f.status === 'scheduled' && f.std < m.end && f.sta > m.start)).toBe(false);
    const paint0 = line(g, 'paint');
    const other0 = line(g, 'otherRevenue');
    run(g, m.end + 60);
    expect(m.status).toBe('done');
    expect(g.fleet[id].paintedFor).toBe(c.id);
    expect(liveryOf(g, id)).toMatchObject({ source: 'client', contractId: c.id });
    expect(line(g, 'paint') - paint0).toBe(-m.cost);
    expect(line(g, 'otherRevenue') - other0).toBe(Math.round(m.cost * c.paint!.clientShare));
    run(g, c.end + 25 * DAY);
    expect(c.status).toBe('completed');
    const out = g.maintenance[c.paint!.outMx![id]];
    expect(out).toMatchObject({ kind: 'paint', paint: { phase: 'out' } });
    run(g, out.end + 60);
    expect(out.status).toBe('done');
    expect(g.fleet[id].paintedFor).toBeUndefined();
    expect(liveryOf(g, id).source).toBe('company');
    expect(line(g, 'paint') - paint0).toBe(-(m.cost + out.cost));
    expect(line(g, 'otherRevenue') - other0).toBe(Math.round(m.cost * c.paint!.clientShare) + Math.round(out.cost * c.paint!.clientShare));
  });

  it('cancelling calls off a paint-in not started, and strips a finished one without reimbursement', () => {
    const g = newGame(8);
    const a = paintBase(g, 'decals', true, 40);
    const id = firstOk(g, a);
    const ra = acceptOffer(g, a.id, [id]);
    const ca = g.contracts[ra.ok ? ra.data!.contractId : ''];
    const ma = g.maintenance[ca.paint!.inMx![id]];
    expect(cancelContract(g, ca.id).ok).toBe(true);
    expect(ma.status).toBe('cancelled');

    const g2 = newGame(8);
    const b = paintBase(g2, 'decals', true, 40);
    const id2 = firstOk(g2, b);
    const rb = acceptOffer(g2, b.id, [id2], {});
    const cb = g2.contracts[rb.ok ? rb.data!.contractId : ''];
    const mb = g2.maintenance[cb.paint!.inMx![id2]];
    run(g2, mb.end + 60);
    expect(g2.fleet[id2].paintedFor).toBe(cb.id);
    const other0 = line(g2, 'otherRevenue');
    expect(cancelContract(g2, cb.id).ok).toBe(true);
    run(g2, g2.now + 3 * DAY);
    const out = g2.maintenance[cb.paint!.outMx![id2]];
    expect(out?.paint?.phase).toBe('out');
    run(g2, out.end + 60);
    expect(g2.fleet[id2].paintedFor).toBeUndefined();
    expect(line(g2, 'otherRevenue')).toBe(other0);
  });

  it('a counter without required paint is either lost or signed at a rate cut', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed);
      const o = paintBase(g, 'decals', true, 40);
      const id = firstOk(g, o);
      const asking = askingPrice(o);
      expect(counterOffer(g, o.id, asking, [id], { paint: false }).ok).toBe(true);
      expect(o.counter?.paint).toBe(false);
      run(g, o.counter!.replyAt + 1);
      if (o.status === 'lost') {
        seen.add('lost');
        expect(g.messages.some((m) => m.title.endsWith('walked away') && m.body.includes(o.title))).toBe(true);
      } else {
        seen.add('cut');
        const c = Object.values(g.contracts).find((x) => x.offerId === o.id)!;
        expect(askingPrice(c)).toBe(Math.round(asking * (1 - o.paint!.declinePct)));
        expect(c.paint?.accepted).toBe(false);
        expect(Object.values(g.maintenance).some((m) => m.kind === 'paint')).toBe(false);
      }
    }
    expect(seen.size).toBe(2);
  });

  it('is deterministic: same seed, same paint; a save mid-paint plays on identically', () => {
    const play = (save?: number) => {
      let g = newGame(9);
      const o = paintBase(g, 'full', true, 40);
      acceptOffer(g, o.id, [firstOk(g, o)]);
      const end = g.now + 70 * DAY;
      if (save) {
        run(g, g.now + save * DAY);
        g = deserialize(serialize(g));
      }
      run(g, end);
      return JSON.stringify(JSON.parse(serialize(g)).state);
    };
    const a = play();
    expect(play()).toBe(a);
    expect(play(35)).toBe(a);
  });

  it('paintWindow is pure and finds a strip slot after the job', () => {
    const g = newGame(10);
    const id = Object.keys(g.fleet)[0];
    const before = JSON.stringify(g);
    const s = paintWindow(g, id, { days: 3 }, g.now + 40 * DAY, g.now + 10 * DAY);
    expect(s).not.toBeNull();
    expect(s!.start).toBeGreaterThanOrEqual(g.now + 10 * DAY);
    expect(s!.end - s!.start).toBe(3 * DAY);
    expect(JSON.stringify(g)).toBe(before);
  });
});
