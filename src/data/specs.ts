// v0.18 aircraft spec sheets: published figures per type beyond what the game flies with (data/aircraft.ts has
// MTOW, span, length and the brochure range; data/acmiTypes.ts the full-payload range, cruise, runway, ETOPS and
// crew the game uses). Sources: Airbus "Aircraft characteristics – airport and maintenance planning" (A320 rev.
// 2020+, A321, A330, A340, A350, A380) and Boeing "Airplane characteristics for airport planning" (ACAPS 737, 757,
// 767, 777, 787, 747-400/-8) for maximum landing weight, usable fuel and lower-deck volume; engine makers' type
// certificates (EASA TCDS-E) for take-off thrust; ICAO Annex 16 noise chapters. Euro Atlantic Airways' spec sheets
// (767-300ER CS-TSU 4,580 cu ft, A330-200 CS-TGD 110 m³, A330-300 CS-TGI 150 m³, 777-200ER CS-TSW 5,330 cu ft) give the
// cargo volume as an operator quotes it (containers loaded, bulk less the crew rest module); those types use them.
// `est`: no published figure found (777-8/-9 not certified yet).

export interface TypeSpec {
  /** Maximum landing weight, kg. */
  mlwKg: number;
  /** Usable fuel, litres (the standard tanks; the A321LR with its three extra tanks). */
  fuelL: number;
  /** Lower-deck cargo volume, m³. */
  cargoM3: number;
  /** Take-off thrust per engine, kN (the range of the engine options). */
  thrustKN: [number, number];
  /** ICAO Annex 16 noise chapter of the type as flown today. */
  noise: 3 | 4 | 14;
  /** Typical in-seat entertainment on the used market: 'none' (narrowbody charter), 'byod' streamed to phones, 'avod' seat-back screens. */
  ife: 'none' | 'byod' | 'avod';
  /** Power at the seats on the used market: none, USB, or AC and USB. */
  power: 'none' | 'usb' | 'ac';
  /** Typical Wi-Fi fit on the used market. */
  wifi: boolean;
  est?: true;
}

export const TYPE_SPECS: Record<string, TypeSpec> = {
  a320ceo: { mlwKg: 66_000, fuelL: 24_210, cargoM3: 37.4, thrustKN: [111, 120], noise: 4, ife: 'none', power: 'none', wifi: false },
  a320neo: { mlwKg: 67_400, fuelL: 26_730, cargoM3: 37.4, thrustKN: [120, 121], noise: 14, ife: 'byod', power: 'usb', wifi: false },
  a321ceo: { mlwKg: 77_800, fuelL: 24_050, cargoM3: 51.7, thrustKN: [142, 147], noise: 4, ife: 'none', power: 'none', wifi: false },
  a321neo: { mlwKg: 79_200, fuelL: 32_940, cargoM3: 41.7, thrustKN: [143, 147], noise: 14, ife: 'byod', power: 'usb', wifi: false },
  b738: { mlwKg: 66_361, fuelL: 26_020, cargoM3: 44.0, thrustKN: [117, 121], noise: 4, ife: 'none', power: 'none', wifi: false },
  b739: { mlwKg: 71_350, fuelL: 29_660, cargoM3: 51.7, thrustKN: [121, 121], noise: 4, ife: 'none', power: 'none', wifi: false },
  b752: { mlwKg: 89_800, fuelL: 43_490, cargoM3: 50.7, thrustKN: [178, 185], noise: 4, ife: 'none', power: 'none', wifi: false },
  b753: { mlwKg: 101_600, fuelL: 43_400, cargoM3: 67.1, thrustKN: [191, 192], noise: 4, ife: 'none', power: 'none', wifi: false },
  // Euro Atlantic CS-TSU: 4,580 cu ft, MTOW 184,612 kg, PW4000.
  b763: { mlwKg: 145_150, fuelL: 91_380, cargoM3: 129.7, thrustKN: [267, 270], noise: 4, ife: 'avod', power: 'ac', wifi: false },
  // Euro Atlantic CS-TGD: 110 m³, MLW 187,000 kg (the 242 t weight variant), CF6-80E1.
  a332: { mlwKg: 187_000, fuelL: 139_090, cargoM3: 110, thrustKN: [300, 316], noise: 4, ife: 'byod', power: 'usb', wifi: false },
  // Euro Atlantic CS-TGI: 150 m³, MLW 187,000 kg, PW4170.
  a333: { mlwKg: 187_000, fuelL: 97_530, cargoM3: 150, thrustKN: [300, 316], noise: 4, ife: 'avod', power: 'ac', wifi: false },
  a339: { mlwKg: 191_000, fuelL: 139_090, cargoM3: 158, thrustKN: [320, 320], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  a342: { mlwKg: 181_000, fuelL: 155_040, cargoM3: 136, thrustKN: [139, 151], noise: 4, ife: 'avod', power: 'usb', wifi: false },
  a343: { mlwKg: 192_000, fuelL: 147_850, cargoM3: 158, thrustKN: [151, 151], noise: 4, ife: 'avod', power: 'usb', wifi: false },
  a345: { mlwKg: 246_000, fuelL: 214_810, cargoM3: 149, thrustKN: [236, 236], noise: 4, ife: 'avod', power: 'ac', wifi: false },
  a346: { mlwKg: 265_000, fuelL: 195_620, cargoM3: 201.7, thrustKN: [249, 249], noise: 4, ife: 'avod', power: 'ac', wifi: false },
  a359: { mlwKg: 207_000, fuelL: 141_000, cargoM3: 172.4, thrustKN: [374, 374], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  a35u: { mlwKg: 207_000, fuelL: 165_000, cargoM3: 172.4, thrustKN: [374, 374], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  a35k: { mlwKg: 236_000, fuelL: 159_000, cargoM3: 208.2, thrustKN: [431, 431], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  a388: { mlwKg: 394_000, fuelL: 323_546, cargoM3: 175.2, thrustKN: [311, 332], noise: 4, ife: 'avod', power: 'ac', wifi: true },
  // Euro Atlantic CS-TSW: 5,330 cu ft, MTOW 297,557 kg, GE90-94B.
  b772: { mlwKg: 213_180, fuelL: 171_170, cargoM3: 150.9, thrustKN: [400, 417], noise: 4, ife: 'avod', power: 'ac', wifi: false },
  b77w: { mlwKg: 251_290, fuelL: 181_280, cargoM3: 201.6, thrustKN: [513, 513], noise: 4, ife: 'avod', power: 'ac', wifi: true },
  b778: { mlwKg: 266_000, fuelL: 197_977, cargoM3: 191, thrustKN: [467, 467], noise: 14, ife: 'avod', power: 'ac', wifi: true, est: true },
  b779: { mlwKg: 266_000, fuelL: 197_977, cargoM3: 226, thrustKN: [467, 467], noise: 14, ife: 'avod', power: 'ac', wifi: true, est: true },
  b788: { mlwKg: 172_365, fuelL: 126_206, cargoM3: 136.7, thrustKN: [280, 285], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  b789: { mlwKg: 192_777, fuelL: 126_372, cargoM3: 172.4, thrustKN: [320, 324], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  b78x: { mlwKg: 201_849, fuelL: 126_372, cargoM3: 190.3, thrustKN: [340, 340], noise: 14, ife: 'avod', power: 'ac', wifi: true },
  b741: { mlwKg: 255_830, fuelL: 183_380, cargoM3: 147, thrustKN: [205, 205], noise: 3, ife: 'none', power: 'none', wifi: false },
  b742: { mlwKg: 285_700, fuelL: 198_385, cargoM3: 147, thrustKN: [233, 243], noise: 3, ife: 'none', power: 'none', wifi: false },
  b743: { mlwKg: 260_320, fuelL: 199_158, cargoM3: 147, thrustKN: [236, 243], noise: 3, ife: 'none', power: 'none', wifi: false },
  b744: { mlwKg: 295_750, fuelL: 216_840, cargoM3: 158.6, thrustKN: [252, 265], noise: 4, ife: 'avod', power: 'usb', wifi: false },
  b748: { mlwKg: 312_072, fuelL: 243_120, cargoM3: 161.5, thrustKN: [296, 296], noise: 14, ife: 'avod', power: 'ac', wifi: true },
};

export interface ClassAmenity {
  /** 'Lie-flat (76 in bed)', 'Recliner', 'Slimline'. */
  seat: string;
  /** Seat width, inches. */
  width: number;
  /** Recline in words ('6 in', 'flat'). */
  recline: string;
  /** Seat-back screen size, inches; null: none (or streamed). */
  screen: number | null;
  power: 'none' | 'usb' | 'ac';
}

/**
 * The amenities of a class on a type in a layout, as a typical used-market cabin has them (Euro Atlantic's sheets for
 * the 767-300ER, 777-200ER and A330: business 76 in lie-flat beds with 15-16 in screens, AC and USB; premium economy
 * 12 in screens; economy 9-10 in screens and USB, the A330-200's economy streamed to phones). Widths from the seat
 * makers' figures for the abreast (A320 3-3 18 in, 737 17 in, 777 3-3-3 18.5 in, 3-4-3 17.2 in, A350 18 in).
 */
export function amenity(typeId: string, cls: 'J' | 'W' | 'Y', abreast: string, pitch: number, layout: string): ClassAmenity {
  const sp = TYPE_SPECS[typeId];
  const wide = !['a320ceo', 'a320neo', 'a321ceo', 'a321neo', 'b738', 'b739', 'b752', 'b753'].includes(typeId);
  const pw = sp?.power ?? 'none';
  if (cls === 'J') {
    if (!wide) return { seat: layout === 'vip' ? 'Wide recliner' : 'Recliner', width: 21, recline: layout === 'vip' ? '9 in' : '7 in', screen: null, power: pw === 'none' ? 'usb' : pw };
    if (abreast === '2-2' && (typeId === 'b741' || typeId === 'b742' || typeId === 'b743')) return { seat: 'Recliner', width: 21, recline: '10 in', screen: null, power: 'usb' };
    const modern = ['a359', 'a35u', 'a35k', 'b788', 'b789', 'b78x', 'a339', 'a388', 'b748', 'b77w'].includes(typeId);
    return { seat: modern ? 'Full-flat (78 in bed)' : 'Lie-flat (76 in bed)', width: modern ? 21 : 20.5, recline: 'flat', screen: modern ? 18 : typeId === 'b763' ? 15 : 16, power: 'ac' };
  }
  if (cls === 'W') return { seat: 'Recliner', width: 19, recline: '7 in', screen: 12, power: 'ac' };
  const width: Record<string, number> = { '3-3': typeId.startsWith('b7') ? 17 : 18, '2-4-2': typeId === 'b763' ? 16.5 : 18, '3-3-3': typeId.startsWith('a33') ? 16.5 : typeId.startsWith('b78') ? 17.3 : typeId.startsWith('b77') ? 18.5 : 18, '3-4-3': typeId === 'a388' ? 18 : 17.2, '2-3-2': 18 };
  const screen = sp?.ife === 'avod' ? (typeId === 'b763' ? 10 : typeId.startsWith('b74') && typeId !== 'b748' ? 8.9 : ['a359', 'a35u', 'a35k', 'b789', 'b78x', 'a339', 'b748'].includes(typeId) ? 11.6 : 9) : null;
  return { seat: pitch < 29.5 ? 'Slimline' : 'Standard', width: width[abreast] ?? 17.5, recline: pitch < 29.5 ? '3 in' : pitch >= 32 ? '6 in' : '5 in', screen, power: pw };
}
