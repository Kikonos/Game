// Approximate local time per airport: standard UTC offset by country (hours), per-airport
// overrides for multi-zone countries, and northern-hemisphere DST rules (EU / US).
// Southern-hemisphere DST is ignored (v0.5). Used for FTL reference times, local nights and labels.

export type DstRule = 'eu' | 'us' | null;

const COUNTRY: Record<string, [number, DstRule]> = {
  GB: [0, 'eu'], IE: [0, 'eu'], PT: [0, 'eu'], IS: [0, null],
  FR: [1, 'eu'], NL: [1, 'eu'], BE: [1, 'eu'], LU: [1, 'eu'], DE: [1, 'eu'], CH: [1, 'eu'], AT: [1, 'eu'], ES: [1, 'eu'], IT: [1, 'eu'],
  MT: [1, 'eu'], DK: [1, 'eu'], SE: [1, 'eu'], NO: [1, 'eu'], PL: [1, 'eu'], CZ: [1, 'eu'], HU: [1, 'eu'], RS: [1, 'eu'], HR: [1, 'eu'], AL: [1, 'eu'],
  GR: [2, 'eu'], CY: [2, 'eu'], FI: [2, 'eu'], RO: [2, 'eu'], BG: [2, 'eu'], LV: [2, 'eu'], LT: [2, 'eu'], EE: [2, 'eu'], LB: [2, 'eu'], IL: [2, 'eu'],
  US: [-5, 'us'], CA: [-5, 'us'], MX: [-6, null], PR: [-4, null], BS: [-5, 'us'], JM: [-5, null], DO: [-4, null], CU: [-5, 'us'], AW: [-4, null],
  CO: [-5, null], PE: [-5, null], EC: [-5, null], PA: [-5, null], CR: [-6, null], SV: [-6, null], GT: [-6, null], VE: [-4, null], BO: [-4, null],
  BR: [-3, null], AR: [-3, null], CL: [-4, null], UY: [-3, null], PY: [-3, null],
  EG: [2, null], MA: [1, null], TN: [1, null], DZ: [1, null], LY: [2, null], NG: [1, null], GH: [0, null], SN: [0, null], CI: [0, null], ML: [0, null],
  GW: [0, null], ST: [0, null], CV: [-1, null], CD: [1, null], CF: [1, null], AO: [1, null], SS: [2, null], SD: [2, null], RW: [2, null],
  ET: [3, null], KE: [3, null], TZ: [3, null], UG: [3, null], SO: [3, null], DJ: [3, null], MG: [3, null],
  ZA: [2, null], NA: [2, null], BW: [2, null], ZW: [2, null], ZM: [2, null], MZ: [2, null], MU: [4, null], SC: [4, null],
  AE: [4, null], OM: [4, null], QA: [3, null], BH: [3, null], KW: [3, null], SA: [3, null], IQ: [3, null], TR: [3, null], JO: [3, null],
  GE: [4, null], AZ: [4, null], AM: [4, null], AF: [4.5, null], SY: [3, null], YE: [3, null], HT: [-5, 'us'], MD: [2, 'eu'], AQ: [0, null],
  // v0.11 Greenland (UTC−2 since 2023, EU summer time from 2024) and Bermuda (Atlantic, US summer time).
  GL: [-2, 'eu'], BM: [-4, 'us'],
  MR: [0, null], NE: [1, null], TD: [1, null], BF: [0, null], CM: [1, null], GA: [1, null], GQ: [1, null], LR: [0, null], SL: [0, null],
  GN: [0, null], GM: [0, null], TG: [0, null], UZ: [5, null], TM: [5, null], TJ: [5, null], IR: [3.5, null],
  IN: [5.5, null], LK: [5.5, null], NP: [5.75, null], BD: [6, null], MV: [5, null], PK: [5, null], MM: [6.5, null],
  TH: [7, null], VN: [7, null], KH: [7, null], ID: [7, null], SG: [8, null], MY: [8, null], PH: [8, null], CN: [8, null], HK: [8, null], MO: [8, null], TW: [8, null],
  TL: [9, null], JP: [9, null], KR: [9, null],
  AU: [10, null], NZ: [12, null], FJ: [12, null], NC: [11, null], GU: [10, null], WS: [13, null], PF: [-10, null], CK: [-10, null],
  // v0.12.1 the new airports' states and territories.
  CW: [-4, null], BQ: [-4, null], SX: [-4, null], SR: [-3, null], FK: [-3, null], SH: [0, null], RE: [4, null], MN: [8, null], LA: [7, null],
  PW: [9, null], MP: [10, null], TO: [13, null], KI: [12, null], VU: [11, null], SB: [11, null], MH: [12, null], FM: [11, null], NF: [11, null],
  CC: [6.5, null], CX: [7, null],
};

/** Airports whose zone differs from their country's default (standard time, hours). */
const AIRPORT: Record<string, number> = {
  // Canaries and Azores
  LPA: 0, TFS: 0, ACE: 0, PDL: -1, TER: -1,
  // Indonesia, Australia, Brazil, DR Congo, Mexico
  DPS: 8, PER: 8, ADL: 9.5, DRW: 9.5, MAO: -4, GOM: 2, FIH: 1, CUN: -5, TIJ: -8,
  // v0.8 Makassar; Antarctic camps keep their gateway's time (Cape Town, Punta Arenas)
  UPG: 8, WFR: 2, TRL: 2, UGL: -3,
  // v0.11 Newfoundland keeps half-hour time (Gander, St. John's)
  YQX: -3.5, YYT: -3.5,
  // v0.12.1 Easter Island and Galápagos run behind the mainland; Kiritimati is UTC+14; Broome and Uluru
  IPC: -6, GPS: -6, CXI: 14, BME: 8, AYQ: 9.5,
};

/** Multi-zone countries use longitude bands (US/Canada). */
function bandOffset(country: string, lon: number): number | null {
  if (country !== 'US' && country !== 'CA') return null;
  if (lon < -150) return -10;
  if (lon < -130) return -9;
  if (lon < -114) return -8;
  if (lon < -101) return -7;
  if (lon < -85) return -6;
  if (lon < -62) return -5;
  return -4;
}

export function standardOffsetHours(code: string, country: string, lon: number): number {
  return AIRPORT[code] ?? bandOffset(country, lon) ?? COUNTRY[country]?.[0] ?? Math.round(lon / 15);
}

export function dstRule(code: string, country: string, lon: number): DstRule {
  // Hawaii and Arizona keep standard time.
  if (country === 'US' && (lon < -150 || (lon > -115 && lon < -109 && code === 'PHX'))) return null;
  return COUNTRY[country]?.[1] ?? null;
}
