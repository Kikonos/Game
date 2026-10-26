// v0.10.2 registering and naming a new aircraft: each registry's format after the fixed prefix, unique in the game,
// the suggestion in format and free; signing with the player's registration and name, the default path unchanged,
// renaming later; the name kept through a save.

import { describe, expect, it } from 'vitest';
import { newGame } from '../contracts/testkit';
import { deserialize, serialize } from '../save';
import { acquireAircraft, devMarketOffer, renameAircraft } from './market';
import { checkRegistration, cleanAircraftName, cleanRegInput, regFormat, suggestRegistration } from './registration';

describe('registration formats', () => {
  const ok = (prefix: string, s: string, country?: string) => regFormat(prefix, country).re.test(s);
  it('knows the real formats after the prefix', () => {
    // three letters
    for (const p of ['EI-', 'EC-', 'PH-', '9H-', 'SE-', 'OE-', 'A6-', 'VH-', '9V-']) {
      expect(ok(p, 'ABC'), p).toBe(true);
      expect(ok(p, 'AB'), p).toBe(false);
      expect(ok(p, 'AB1'), p).toBe(false);
    }
    // Portugal's airline series, Germany's over-20 t series, Swiss jets
    expect(ok('CS-', 'TQM')).toBe(true);
    expect(ok('CS-', 'AQM')).toBe(false);
    expect(ok('D-', 'AIBA')).toBe(true);
    expect(ok('D-', 'EIBA')).toBe(false);
    expect(ok('HB-', 'JNA')).toBe(true);
    expect(ok('HB-', 'INA')).toBe(false);
    // four letters after a one-letter prefix
    expect(ok('G-', 'EUPA')).toBe(true);
    expect(ok('F-', 'GKXA')).toBe(true);
    expect(ok('G-', 'EUP')).toBe(false);
    expect(ok('C-', 'FTJP')).toBe(true);
    expect(ok('C-', 'ATJP')).toBe(false);
    // FAA: 1–5 characters, a digit 1–9 first, letters only at the end (at most two), no I or O
    for (const s of ['1', '12345', '321AB', '9876A', '1A']) expect(ok('N', s), s).toBe(true);
    for (const s of ['0123', '123456', 'A123', '12A3', '12ABC', '123IO', '1234AB']) expect(ok('N', s), s).toBe(false);
    // Japan, Korea, China, Hong Kong
    expect(ok('JA', '801A')).toBe(true);
    expect(ok('JA', '13AN')).toBe(true);
    expect(ok('JA', 'A801')).toBe(false);
    expect(ok('HL', '7782')).toBe(true);
    expect(ok('B-', '1234', 'CN')).toBe(true);
    expect(ok('B-', 'HKX', 'HK')).toBe(true);
    expect(ok('B-', '1234', 'HK')).toBe(false);
  });

  it('tidies the input: upper case, prefix pasted in dropped, only the allowed characters, the length', () => {
    expect(cleanRegInput('CS-', 'tqm')).toBe('TQM');
    expect(cleanRegInput('CS-', 'cs-tqmx')).toBe('TQM');
    expect(cleanRegInput('CS-', 't 1q')).toBe('TQ');
    expect(cleanRegInput('N', 'n321ab')).toBe('321AB');
  });

  it('cleans a name: trimmed, single spaces, at most 24 characters', () => {
    expect(cleanAircraftName('  Vasco   da  Gama ')).toBe('Vasco da Gama');
    expect(cleanAircraftName('   ')).toBe('');
    expect(cleanAircraftName('x'.repeat(40)).length).toBe(24);
  });
});

describe('registering a new aircraft', () => {
  const game = () => {
    const g = newGame(4);
    g.company.cash = 50_000_000;
    return g;
  };

  it('checks the format and that the registration is free in the game, with a short reason', () => {
    const g = game();
    const ours = Object.values(g.fleet)[0].reg;
    expect(g.company.regPrefix).toBe('CS-');
    expect(checkRegistration(g, 'TZZ')).toEqual({ ok: true, reg: 'CS-TZZ' });
    expect(checkRegistration(g, 'ZZ')).toEqual({ ok: false, reason: 'T + 2 letters' });
    expect(checkRegistration(g, '')).toEqual({ ok: false, reason: 'Enter the registration' });
    expect(checkRegistration(g, ours.slice(3))).toEqual({ ok: false, reason: `Already used by our ${ours}` });
  });

  it('suggests a free registration in format, the same for the same offer, without touching the random sequence', () => {
    const g = game();
    const id = devMarketOffer(g, 'a320ceo', { site: 'LIS' });
    const rng = g.rng;
    const s = suggestRegistration(g, id);
    expect(g.rng).toBe(rng);
    expect(s).toBe(suggestRegistration(g, id));
    expect(checkRegistration(g, s.slice(3)).ok).toBe(true);
  });

  it('signs with the chosen registration and name; refuses one taken or out of format', () => {
    const g = game();
    const ours = Object.values(g.fleet)[0].reg;
    const id = devMarketOffer(g, 'a320ceo', { site: 'LIS' });
    expect(acquireAircraft(g, id, { reg: ours })).toEqual({ ok: false, error: `Already used by our ${ours}` });
    expect(acquireAircraft(g, id, { reg: 'CS-AB' })).toEqual({ ok: false, error: 'T + 2 letters' });
    const r = acquireAircraft(g, id, { reg: 'CS-TVG', name: '  Vasco da Gama ' });
    if (!r.ok) throw new Error(r.error);
    const ac = g.fleet[r.data!.aircraftId];
    expect(ac.reg).toBe('CS-TVG');
    expect(ac.name).toBe('Vasco da Gama');
    // renamed later (the registration stays); empty clears it
    expect(renameAircraft(g, ac.id, 'Infante D. Henrique').ok).toBe(true);
    expect(ac.name).toBe('Infante D. Henrique');
    expect(ac.reg).toBe('CS-TVG');
    // kept through a save
    const back = deserialize(serialize(g));
    expect(back.fleet[ac.id].name).toBe('Infante D. Henrique');
    expect(renameAircraft(g, ac.id, '  ').ok).toBe(true);
    expect('name' in ac).toBe(false);
    expect(renameAircraft(g, 'nope', 'X').ok).toBe(false);
  });

  it('the default path is unchanged: no options = the generated registration and no name, same as before', () => {
    const a = game(), b = game();
    const ia = devMarketOffer(a, 'a320ceo', { site: 'LIS' }), ib = devMarketOffer(b, 'a320ceo', { site: 'LIS' });
    const ra = acquireAircraft(a, ia), rb = acquireAircraft(b, ib, {});
    const x = a.fleet[ra.ok ? ra.data!.aircraftId : ''], y = b.fleet[rb.ok ? rb.data!.aircraftId : ''];
    expect(x.reg).toBe(y.reg);
    expect(x.reg).toMatch(/^CS-T[A-Z]{2}$/);
    expect(x.name).toBeUndefined();
    expect(a.rng).toBe(b.rng);
  });
});
