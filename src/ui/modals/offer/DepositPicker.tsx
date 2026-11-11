// v0.16 the offer dialog's Deposit row (UPDATE-0.16.md §A.6; lane finance): 0 / 10 / 20 / 30 / 40 / 50 % with what it
// does to the client's answer in words. Only on a full charter; fixed once a counter carried a deposit.

import { BAL } from '../../../engine/core/balance';
import type { ContractOffer, GameState } from '../../../engine/core/types';
import { depositEffect } from '../../../engine/finance';
import { Seg } from '../../components/ui';
import { Help } from '../../components/Help';

export function DepositPicker({ g, o, value, onChange, fixed }: { g: GameState; o: ContractOffer; value: number; onChange: (pct: number) => void; fixed?: boolean }) {
  if (o.product.kind !== 'charter') return null;
  const choices = BAL.v016.finance.deposit.choices;
  const eff = depositEffect(g, o.id, value);
  const tone = eff.acceptDelta < 0 ? 'warn' : eff.acceptDelta > 0 ? 'good' : 'muted';
  return (
    <div className="dp-row">
      <div className="row between gap-8 wrap">
        <span className="upper dim row gap-6" style={{ alignItems: 'center' }}>Deposit on signing{!fixed && <Help title="Deposit on signing">More deposit: cash sooner and less payment risk. Less: a keener client.</Help>}</span>
        {fixed
          ? <b className="num">{Math.round(value * 100)} %{o.depositAsk ? ' · sent with the counter' : ''}</b>
          : <Seg value={Math.round(value * 100)} options={choices.map((c) => ({ value: Math.round(c * 100), label: `${Math.round(c * 100)} %` }))} onChange={(v) => onChange(v / 100)} />}
      </div>
      <div className={`small ${tone}`}>{eff.text}</div>
    </div>
  );
}
