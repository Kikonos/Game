// v0.25 (comm-tail) a client's payment behaviour by its country's risk. A leaf module (no engine imports), so the
// load repair in relations.ts can use it without an import cycle.

import type { Client } from '../core/types';

/**
 * Low risk: the EU/EEA, the UK and Switzerland (the EU late-payment directive holds public bodies to 30 days), North
 * America, Australia and New Zealand, Japan, Korea, Singapore, the UAE and Qatar. Higher everywhere else.
 */
const LOW_RISK = new Set([
  'PT', 'ES', 'LT', 'LV', 'MT', 'DE', 'IE', 'SE', 'HR', 'FR', 'GB', 'CH', 'NO', 'IT', 'NL', 'BE', 'AT', 'DK', 'FI', 'PL', 'CZ', 'BG', 'EE', 'SK',
  'RO', 'HU', 'IS', 'LU', 'GR', 'CY', 'SI', 'LI', 'US', 'CA', 'AU', 'NZ', 'JP', 'KR', 'SG', 'AE', 'QA',
]);
export type RiskTier = 'low' | 'high';
export const riskTier = (country: string): RiskTier => (LOW_RISK.has(country) ? 'low' : 'high');

/** On-time odds and days late for an airline or a government of that country (RESEARCH §4.3: governments 30–90 days late; a low-risk state mostly on time). Pure. */
export function riskPay(kind: 'airline' | 'government', country: string): Pick<Client, 'payReliability' | 'lateDays'> {
  const low = riskTier(country) === 'low';
  if (kind === 'airline') return low ? { payReliability: 0.92, lateDays: [3, 12] } : { payReliability: 0.7, lateDays: [7, 40] };
  return low ? { payReliability: 0.85, lateDays: [0, 15] } : { payReliability: 0.2, lateDays: [25, 90] };
}

/** Load: a client from an older save gets its country's tier and, for an airline or a government, the payment
 *  behaviour that goes with it. Once: the tier marks it done. */
export function seedRisk(c: Client): void {
  if (c.risk !== undefined) return;
  c.risk = riskTier(c.country);
  if (c.kind === 'airline' || c.kind === 'government') Object.assign(c, riskPay(c.kind, c.country));
}
