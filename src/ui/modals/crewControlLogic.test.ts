import { describe, expect, it } from 'vitest';
import { canTake, chooseWord, defaultPicks, goneText, seatPlan } from './crewControlLogic';

describe('Crew Control candidates: seats and wording', () => {
  const missing = [{ role: 'CPT' as const, n: 1 }, { role: 'CC' as const, n: 2 }];
  it('fills seats in pick order, exact role first, and blocks a second tick on a taken seat', () => {
    const plan = seatPlan(missing, [{ id: 'a', role: 'CPT' }, { id: 'b', role: 'FO' }, { id: 'c', role: 'SCC' }]);
    expect(plan.seat).toEqual({ a: 'CPT', c: 'CC' });
    expect(plan.open).toEqual([{ role: 'CC', n: 1 }]);
    expect(canTake(plan, 'CPT')).toBe(false);
    expect(canTake(plan, 'CC')).toBe(true);
    expect(canTake(plan, 'CSD')).toBe(true);
    expect(canTake(seatPlan(missing, [{ id: 'a', role: 'CPT' }, { id: 'c', role: 'CC' }, { id: 'd', role: 'CC' }]), 'CC')).toBe(false);
  });
  it('lets a captain take an FO seat', () => {
    expect(seatPlan([{ role: 'FO', n: 1 }], [{ id: 'a', role: 'CPT' }]).seat).toEqual({ a: 'FO' });
  });
  it('ticks the best person per missing seat by default', () => {
    const opts = [{ id: 'cpt1', role: 'CPT' as const }, { id: 'cpt2', role: 'CPT' as const }, { id: 'cc1', role: 'CC' as const }, { id: 'cc2', role: 'CC' as const }, { id: 'cc3', role: 'CC' as const }];
    expect(defaultPicks(missing, opts)).toEqual(['cpt1', 'cc1', 'cc2']);
    expect(defaultPicks([{ role: 'FO', n: 1 }], [{ id: 'cc1', role: 'CC' }])).toEqual(['cc1']);
    expect(defaultPicks(missing, [])).toEqual([]);
  });
  it('words call-in and deadhead differently', () => {
    expect(chooseWord('callIn')).toBe('Choose who comes in');
    expect(chooseWord('deadhead')).toBe('Choose who flies in');
  });
  it('says a cancelled or sub-chartered flight is gone, not crewed', () => {
    expect(goneText('cancel', 'AT1040', [])).toBe('AT1040 is cancelled');
    expect(goneText('subcharter', 'AT1040', ['Airhub Airlines flies 2 legs; no reliability hit'])).toBe('AT1040 is flown by Airhub Airlines');
    expect(goneText('subcharter', 'AT1040', [])).toBe('AT1040 is flown by the rival');
    expect(goneText('deadhead', 'AT1040', [])).toBeNull();
  });
});
