// v0.8 (UPDATE-0.8.md §5.1): airspace shapes for world events. Rings are simple outlines (lon, lat) of a country's
// airspace, good enough for "does this great circle cross it" and a calm shaded shape on the map. Staging pairs are
// [conflict airport, safe hub] for evacuations. Base war risk applies without an event (insurers' listed areas).

export interface WorldZone {
  id: string;
  /** 'Sudan', 'Yemen and the southern Red Sea'. */
  name: string;
  /** Adjective for titles: 'Sudanese airspace'. */
  adj: string;
  countries: string[];
  ring: [number, number][];
  /** Extra minutes a flight crossing it flies around. */
  detourMin: number;
  /** Airports inside (closed with the airspace); the first is the focus (map pin). */
  airports: string[];
  /** [conflict airport, safe staging hub] for evacuation shuttles. */
  staging?: [string, string][];
  baseWarRisk?: 1 | 2 | 3;
}

export const WORLD_ZONES: WorldZone[] = [
  {
    id: 'sudan', name: 'Sudan', adj: 'Sudanese', countries: ['SD'], detourMin: 40, airports: ['PZU', 'KRT', 'ELF'], staging: [['PZU', 'JED']], baseWarRisk: 2,
    ring: [[22, 9], [27, 9.5], [33, 9.5], [34, 10.5], [35.5, 12], [36.5, 14], [38.5, 18], [37, 22], [31, 22], [25, 22], [24, 20], [22, 15]],
  },
  {
    id: 'southSudan', name: 'South Sudan', adj: 'South Sudanese', countries: ['SS'], detourMin: 30, airports: ['JUB'], staging: [['JUB', 'NBO']],
    ring: [[24, 8.5], [27, 5], [30, 3.6], [34, 4], [35.9, 4.6], [34, 8], [33, 10], [32, 12], [28, 10], [25, 10]],
  },
  {
    id: 'libya', name: 'Libya', adj: 'Libyan', countries: ['LY'], detourMin: 35, airports: ['MJI', 'TIP', 'KUF'], staging: [['MJI', 'MLA']], baseWarRisk: 2,
    ring: [[9.5, 30], [10, 25], [12, 23], [15, 23], [24, 20], [25, 20], [25, 31.5], [20, 32.5], [15, 32.5], [11.5, 33]],
  },
  {
    id: 'levant', name: 'Lebanon and Israel', adj: 'Lebanese and Israeli', countries: ['LB', 'IL'], detourMin: 25, airports: ['BEY', 'TLV'], staging: [['BEY', 'LCA']],
    ring: [[34.2, 31.2], [34.9, 29.5], [35.5, 31], [35.6, 32.5], [36.6, 34.6], [35.9, 34.7], [35.1, 33.1], [34.5, 31.6]],
  },
  {
    id: 'syria', name: 'Syria', adj: 'Syrian', countries: ['SY'], detourMin: 35, airports: ['DAM'], staging: [['DAM', 'AMM']], baseWarRisk: 3,
    ring: [[35.7, 32.7], [36.8, 32.3], [38.8, 33.4], [41, 34.4], [41.2, 36.6], [42.4, 37.1], [40, 37], [36.6, 36.8], [35.8, 35.8], [35.9, 34.6]],
  },
  {
    id: 'iraq', name: 'Iraq', adj: 'Iraqi', countries: ['IQ'], detourMin: 50, airports: ['BGW', 'EBL', 'NJF'], staging: [['EBL', 'AMM'], ['BGW', 'AMM']],
    ring: [[38.8, 33.4], [39.2, 32.2], [44.7, 29.2], [46.5, 29.1], [48.5, 29.9], [47.5, 31.5], [46, 33], [45.5, 35.8], [44.8, 37.2], [42.4, 37.1], [41.2, 36.6], [41, 34.4]],
  },
  {
    id: 'iran', name: 'Iran', adj: 'Iranian', countries: ['IR'], detourMin: 70, airports: ['IKA', 'MHD'], staging: [['IKA', 'IST']],
    ring: [[44, 39.5], [48, 38.5], [53, 37.3], [56, 38], [61, 36.6], [61.6, 31.4], [63, 29], [61.6, 25.2], [57, 25.6], [54, 26.5], [50, 30], [48.5, 30], [46, 33], [45.5, 35.8]],
  },
  {
    id: 'yemen', name: 'Yemen and the southern Red Sea', adj: 'Yemeni', countries: ['YE'], detourMin: 45, airports: ['SAH', 'ADE'], staging: [['ADE', 'DXB']], baseWarRisk: 3,
    ring: [[42.5, 16.5], [43.5, 12.6], [45, 12.8], [49, 14], [52.2, 15.6], [53, 16.6], [52, 19], [49, 18.6], [46.5, 17.3], [43.3, 17.5], [38, 20], [40, 15]],
  },
  {
    id: 'niger', name: 'Niger', adj: 'Nigerien', countries: ['NE'], detourMin: 40, airports: ['NIM'], staging: [['NIM', 'ABJ']],
    ring: [[0, 13.5], [1, 15], [4, 15.4], [4.3, 19.1], [6, 19.5], [11.9, 23.5], [15, 23], [16, 20.3], [15.5, 16.9], [13.6, 13.5], [12, 13], [8, 13.2], [4, 13.5], [3, 11.7], [2, 12.3]],
  },
  {
    id: 'mali', name: 'Mali', adj: 'Malian', countries: ['ML'], detourMin: 40, airports: ['BKO'], staging: [['BKO', 'DSS']],
    ring: [[-12, 14.5], [-11.5, 15.5], [-5.5, 15.5], [-6, 25], [-4.8, 25], [1.2, 21], [4.2, 19], [4.2, 16.5], [1, 15], [-3, 13.5], [-5.5, 10.5], [-8, 10.5], [-11, 12.5]],
  },
  {
    id: 'burkina', name: 'Burkina Faso', adj: 'Burkinabè', countries: ['BF'], detourMin: 25, airports: ['OUA'], staging: [['OUA', 'ABJ']],
    ring: [[-5.5, 10.5], [-3, 13.5], [0, 15], [1, 15], [2, 12.5], [2.3, 11.5], [0, 11], [-3, 9.5]],
  },
  {
    id: 'chad', name: 'Chad', adj: 'Chadian', countries: ['TD'], detourMin: 35, airports: ['NDJ'], staging: [['NDJ', 'CAI']],
    ring: [[13.6, 13.5], [15.5, 16.9], [16, 20.3], [15, 23], [24, 19.5], [24, 15.5], [22.5, 14], [22, 11], [18.5, 8], [15.5, 8], [14.5, 11], [14, 12.7]],
  },
  {
    id: 'haiti', name: 'Haiti', adj: 'Haitian', countries: ['HT'], detourMin: 20, airports: ['PAP'], staging: [['PAP', 'SDQ']],
    ring: [[-74.5, 18.4], [-73.4, 19.9], [-72.8, 19.9], [-71.7, 19.7], [-71.7, 18], [-72, 18], [-74.4, 18.1]],
  },
  {
    id: 'myanmar', name: 'Myanmar', adj: 'Myanmar', countries: ['MM'], detourMin: 45, airports: ['RGN'], staging: [['RGN', 'BKK']],
    ring: [[92.2, 21], [93.2, 22.3], [93.4, 24], [94.2, 25.5], [95.2, 26.6], [97.4, 28.2], [98.7, 27.5], [98.7, 25], [97.7, 24], [99.5, 22.1], [101.1, 21.5], [100, 20.3], [98.5, 17], [98.2, 10.5], [97.3, 16], [94.3, 16], [94.2, 18.7]],
  },
  {
    id: 'pakistan', name: 'Pakistan', adj: 'Pakistani', countries: ['PK'], detourMin: 60, airports: ['ISB', 'LHE', 'KHI'], staging: [['ISB', 'DXB']],
    ring: [[61, 25], [66, 25.4], [68, 23.7], [71.1, 24.4], [70.6, 27.8], [74.6, 31], [74.5, 32.6], [75.4, 32.3], [77.8, 35.5], [74.6, 37], [71.2, 36.1], [69.3, 33], [66, 29.5], [62.5, 29.4], [61.5, 26]],
  },
  {
    id: 'iceland', name: 'Iceland', adj: 'Icelandic', countries: ['IS'], detourMin: 30, airports: ['KEF'],
    ring: [[-24.5, 63.3], [-22, 66.6], [-16, 66.6], [-13.4, 65.3], [-14.5, 64.4], [-18, 63.4], [-22.7, 63.8]],
  },
  {
    id: 'etna', name: 'eastern Sicily', adj: 'Sicilian', countries: [], detourMin: 20, airports: ['CTA'],
    ring: [[14.5, 37.2], [15.7, 36.7], [15.7, 37.5], [15.4, 38.3], [14.5, 38], [14.2, 37.6]],
  },
  {
    id: 'javaBali', name: 'East Java and Bali', adj: 'East Javan', countries: [], detourMin: 25, airports: ['DPS', 'SUB'],
    ring: [[111, -8.5], [115.8, -8.9], [115.8, -8], [114.5, -7.6], [112.5, -6.8], [111, -6.9]],
  },
  {
    id: 'ethiopia', name: 'Ethiopia', adj: 'Ethiopian', countries: ['ET'], detourMin: 40, airports: ['ADD'], staging: [['ADD', 'NBO']],
    ring: [[33, 8], [34, 10.5], [35.3, 12.5], [36.5, 14.3], [38.5, 14.4], [40.2, 14.6], [42.4, 12.5], [41.8, 11], [44, 9], [47.9, 8], [45, 5], [42, 4], [39.5, 3.5], [37.5, 4.5], [35.5, 5], [34.5, 6.5]],
  },
  {
    id: 'eastCongo', name: 'eastern DR Congo', adj: 'eastern Congolese', countries: [], detourMin: 30, airports: ['GOM'], staging: [['GOM', 'KGL']],
    ring: [[26, -12], [29, -12.5], [29.5, -8.5], [29.2, -5], [29.6, -1.5], [30.8, 1.3], [31, 2.8], [27.5, 5], [26, 4], [26, -3]],
  },
  {
    id: 'somalia', name: 'Somalia', adj: 'Somali', countries: ['SO'], detourMin: 35, airports: ['MGQ'], staging: [['MGQ', 'NBO']], baseWarRisk: 2,
    ring: [[41, -1.7], [44, 2], [48, 5], [51.4, 11.8], [49, 11.3], [45, 10.5], [43.3, 11], [42.8, 10.9], [44, 9], [47.9, 8], [45, 5], [41, 3.9]],
  },
];

/**
 * v0.12 Scenarios only (Ash Cloud): the airspace an Icelandic ash cloud closes, roughly as in April 2010: the UK and
 * Ireland, the Netherlands, northern Germany, Denmark, Norway, Sweden, Finland and the Baltic coast. Paris, Brussels,
 * Düsseldorf, Frankfurt and Berlin stay open. Not in WORLD_ZONES (no standing war risk, never drawn).
 */
export const SCENARIO_ZONES: WorldZone[] = [
  {
    id: 'northEurope', name: 'northern Europe', adj: 'Northern European', countries: [], detourMin: 45, airports: ['LHR', 'DUB', 'AMS', 'CPH', 'OSL', 'ARN'],
    ring: [[-11, 51.3], [-5, 49.9], [1.6, 50.9], [3.3, 51.4], [6, 51.8], [10, 52.6], [15, 53.3], [21, 54.3], [28, 55.6], [31, 60], [30, 70], [15, 71], [5, 62], [-8, 60], [-14, 57]],
  },
];

export const ZONE_BY_ID: Record<string, WorldZone> = Object.fromEntries([...WORLD_ZONES, ...SCENARIO_ZONES].map((z) => [z.id, z]));

/** Point in polygon (ray casting, lon/lat plane; fine for these small shapes). Pure. */
export function inRing(ring: [number, number][], lon: number, lat: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
