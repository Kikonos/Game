// v0.11 client liveries as data: each client that can ask for its colours, painted the way its real aircraft (or, for
// governments, agencies, clubs and companies, its real identity) looks in 2025–2026 -- base colours, belly split,
// cheatlines, fin colours and pattern, engines, titles in the client's own lettering, and a tail mark. The marks are
// our own simple shapes (logos.ts) or lettering: recognisable by colour, layout and lettering, never traced artwork.
// `basis` says what a recipe follows; `approx` marks the ones only approximated (patterns we cannot paint, details
// we could not confirm). Resolved by the client's name at render time (engine/ops/paint.ts clientLivery). Pure data.

import type { LiveryBody, LiveryLogo, TailStyle } from '../engine/core/types';
import type { LogoId } from './livery';

export interface ClientLiveryRecipe {
  basis: string;
  approx?: boolean;
  /** Fin: colour, second colour, scheme. */
  fin: [string, string, TailStyle];
  /** Fuselage, belly, lines, engines (LiveryBody). */
  body?: LiveryBody;
  /** Titles as printed (upper case), colour, weight. */
  titles: [string, string, (500 | 700)?];
  /** Tail mark: a logo [id, colour, second colour] or lettering [text, colour]. */
  mark: { logo: [LogoId | 'mono', string, string?, string?] } | { code: [string, string] };
  /** Decals-only (white aircraft): the lettering and mark colour when it differs from the titles'. */
  decalInk?: string;
  /** The client repeats a short fleet code at the top of the fin (the registration's last three). */
  fleet?: boolean;
}

const W = '#ffffff';
const under = (color: string, line?: [string, number]): LiveryBody['belly'] => ({ color, split: 0.62, tilt: 0, windows: true, ...(line ? { line: { color: line[0], h: line[1] } } : {}) });
/** A cheatline pair under the windows (share of the tube, thickness). */
const cheat = (a: string, b?: string): LiveryBody['stripes'] => [{ color: a, y: 0.56, h: 0.035 }, ...(b ? [{ color: b, y: 0.6, h: 0.02 }] : [])];
/** National colours as fin bands from the tip down (t ranges of the fin's height). */
const flagFin = (...c: string[]): LiveryBody['finBands'] => c.map((color, i) => ({ color, t0: 0.18 + (i * 0.6) / c.length, t1: 0.18 + ((i + 1) * 0.6) / c.length }));

/** Government / state aircraft: white, a national-colour cheatline, the fin in the national colours, titles dark. */
function state(basis: string, titles: string, colours: string[], ink = '#1d2433', mark: ClientLiveryRecipe['mark'] = { code: ['', ink] }): ClientLiveryRecipe {
  return {
    basis, fin: [W, colours[0], 'solid'],
    body: { stripes: cheat(colours[0], colours[1]), finBands: flagFin(...colours.slice(0, 3)), engines: W },
    titles: [titles, ink, 700], mark, decalInk: ink,
  };
}
/** Agency / UN family: white, titles and mark in their colour. */
function agency(basis: string, titles: string, color: string, code: string): ClientLiveryRecipe {
  return { basis, fin: [W, color, 'solid'], body: { engines: W, stripes: [{ color, y: 0.6, h: 0.02 }] }, titles: [titles, color, 700], mark: { code: [code, color] }, decalInk: color };
}
/** Clubs, companies, promoters (decals: their lettering and colours on white). */
function brand(basis: string, titles: string, color: string, code: string, second?: string): ClientLiveryRecipe {
  return { basis, fin: [color, second ?? W, 'solid'], body: { engines: color }, titles: [titles, color, 700], mark: { code: [code, second ?? W] }, decalInk: color };
}

/** v0.14 the market-presence airlines (data/naming.ts CLIENT_SEEDS_V014): white fuselage, the fin in the airline's
 *  colours with its code, titles in its main colour. Approximated from their 2025 liveries. */
function simple(basis: string, titles: string, color: string, code: string, second?: string, style: TailStyle = 'solid', ink = W): ClientLiveryRecipe {
  return { basis, approx: true, fin: [color, second ?? color, style], body: { engines: color }, titles: [titles, color, 700], mark: { code: [code, ink] }, decalInk: color };
}

export const CLIENT_LIVERIES: Record<string, ClientLiveryRecipe> = {
  // ---------- airlines ----------
  'SAS Scandinavian Airlines': {
    basis: 'SAS 2019 livery: silver-grey fuselage, dark blue tail running onto the rear fuselage with the white SAS logotype, blue engines',
    fin: ['#000a5a', '#000a5a', 'solid'], body: { color: '#d9dde3', engines: '#000a5a', tailWrap: '#000a5a' },
    titles: ['SCANDINAVIAN', '#000a5a', 700], mark: { code: ['SAS', W] }, approx: true,
  },
  'Aer Lingus': {
    basis: 'Aer Lingus 2019: white top, teal belly, tail and engines, light-green ring at the tail base, light-green shamrock on the fin, the registration\'s last letters at the fin top',
    fin: ['#006272', '#006272', 'solid'], body: { belly: under('#006272'), finRoot: '#7ac143' },
    titles: ['AER LINGUS', '#006272', 500], mark: { logo: ['trefoil', '#7ac143', W] }, fleet: true,
  },
  airBaltic: {
    basis: 'airBaltic: white fuselage, lime-green tail and engines, grey titles',
    fin: ['#c4d600', '#c4d600', 'solid'], body: { engines: '#c4d600' }, titles: ['AIRBALTIC', '#4b4f54', 700], mark: { code: ['BT', W] }, approx: true,
  },
  'Croatia Airlines': {
    basis: 'Croatia Airlines: white fuselage, tail in dark blue and red (the chequerboard reduced to a red split), blue titles',
    fin: ['#1b3c7a', '#e2231a', 'split'], body: { engines: '#1b3c7a' }, titles: ['CROATIA AIRLINES', '#1b3c7a', 700], mark: { code: ['OU', W] }, approx: true,
  },
  'LOT Polish Airlines': {
    basis: 'LOT: white fuselage, navy tail with the white roundel (here a plain ring), navy engines, large LOT titles',
    fin: ['#102b5c', '#102b5c', 'solid'], body: { engines: '#102b5c' }, titles: ['LOT POLISH AIRLINES', '#102b5c', 700], mark: { logo: ['ring', W, '#102b5c'] },
  },
  Condor: {
    basis: 'Condor 2022 stripes ("Sunshine" yellow variant): vertical stripes over fuselage and fin, black lettering',
    fin: [W, W, 'solid'], body: { vstripes: { color: '#ffcd00', w: 0.028 }, engines: '#ffcd00' }, titles: ['CONDOR', '#1d1d1b', 500], mark: { code: ['C', '#1d1d1b'] },
  },
  Eurowings: {
    basis: 'Eurowings: white fuselage, berry tail with the white W, berry engines and titles',
    fin: ['#8f1d4f', '#8f1d4f', 'solid'], body: { engines: '#8f1d4f' }, titles: ['EUROWINGS', '#8f1d4f', 500], mark: { code: ['W', W] },
  },
  Lufthansa: {
    basis: 'Lufthansa 2018: all-white fuselage and engines, dark blue tail running onto the rear fuselage, white roundel (a plain ring here)',
    fin: ['#05164d', '#05164d', 'solid'], body: { engines: W, tailWrap: '#05164d' },
    titles: ['LUFTHANSA', '#05164d', 500], mark: { logo: ['ring', W, '#05164d'] },
  },
  'TAP Air Portugal': {
    basis: 'TAP: white fuselage and engines, fin white with green and red sweeps, green TAP lettering, titles TAP AIR PORTUGAL',
    fin: [W, '#00a14b', 'sweep'], body: { engines: W, finRoot: '#e4202f' }, titles: ['TAP AIR PORTUGAL', '#00a14b', 700], mark: { code: ['TAP', '#00a14b'] }, approx: true,
  },
  'Royal Air Maroc': {
    basis: 'Royal Air Maroc: white fuselage, red and green cheatlines, red tail with the green star, red titles',
    fin: ['#c1272d', '#c1272d', 'solid'], body: { stripes: cheat('#c1272d', '#006233'), engines: W }, titles: ['ROYAL AIR MAROC', '#c1272d', 700], mark: { logo: ['star', '#006233'] },
  },
  'Royal Jordanian': {
    basis: 'Royal Jordanian: white fuselage, charcoal tail with the gold crown, charcoal engines and titles',
    fin: ['#2b2b2b', '#2b2b2b', 'solid'], body: { engines: '#2b2b2b' }, titles: ['ROYAL JORDANIAN', '#2b2b2b', 700], mark: { logo: ['crown', '#c6a15b', '#c6a15b'] }, approx: true,
  },
  'Air Sénégal': {
    basis: 'Air Sénégal: white fuselage, tail in the flag\'s green, yellow and red, the same on the engines',
    fin: ['#00853f', '#00853f', 'solid'], body: { finBands: [{ color: '#fdef42', t0: 0.45, t1: 0.62 }, { color: '#e31b23', t0: 0.62, t1: 0.8 }], engines: '#00853f' },
    titles: ['AIR SÉNÉGAL', '#00853f', 700], mark: { logo: ['star', '#00853f'] }, approx: true,
  },
  'TAAG Angola Airlines': {
    basis: 'TAAG: white fuselage, red tail (the palanca reduced to a star), red titles',
    fin: ['#e30613', '#1d1d1b', 'solid'], body: { engines: '#e30613', stripes: cheat('#e30613', '#1d1d1b') }, titles: ['TAAG ANGOLA AIRLINES', '#e30613', 700], mark: { logo: ['star', '#ffcd00'] }, approx: true,
  },
  Airlink: {
    basis: 'Airlink 2020: white fuselage, tail with a sunbird on a sunrise sky (here sun on orange and navy), navy titles',
    fin: ['#1b2b5e', '#f28c28', 'split'], body: { engines: '#1b2b5e' }, titles: ['AIRLINK', '#1b2b5e', 700], mark: { logo: ['sun', '#ffcd00', '#f28c28'] }, approx: true,
  },
  'LATAM Brasil': {
    basis: 'LATAM: white fuselage, indigo tail with a coral sweep, indigo titles',
    fin: ['#1b0088', '#ed1650', 'sweep'], body: { engines: '#1b0088' }, titles: ['LATAM', '#1b0088', 700], mark: { logo: ['star', W] },
  },
  'LATAM Perú': {
    basis: 'LATAM: white fuselage, indigo tail with a coral sweep, indigo titles',
    fin: ['#1b0088', '#ed1650', 'sweep'], body: { engines: '#1b0088' }, titles: ['LATAM', '#1b0088', 700], mark: { logo: ['star', W] },
  },
  'GOL Linhas Aéreas': {
    basis: 'GOL: white fuselage, orange tail and engines with the GOL lettering, orange titles',
    fin: ['#ff6b00', '#ff6b00', 'solid'], body: { engines: '#ff6b00' }, titles: ['GOL', '#ff6b00', 700], mark: { code: ['GOL', W] },
  },
  'Azul Brazilian Airlines': {
    basis: 'Azul: white fuselage, dark blue tail with a light-blue sweep, blue titles',
    fin: ['#0b2e7b', '#00a8e1', 'sweep'], body: { engines: '#0b2e7b' }, titles: ['AZUL', '#0b2e7b', 700], mark: { code: ['AZ', W] }, approx: true,
  },
  'Air Canada': {
    basis: 'Air Canada 2017: white top, black belly, tail and engines, the red leaf on the fin, black titles, a fin number (ours: the registration\'s last three)',
    fin: ['#000000', '#000000', 'solid'], body: { belly: under('#000000') }, titles: ['AIR CANADA', '#000000', 700], mark: { logo: ['leaf', '#d22630', '#d22630'] }, fleet: true,
  },
  'Vietnam Airlines': {
    basis: 'Vietnam Airlines: white fuselage, teal tail with the gold lotus, teal engines and titles',
    fin: ['#006885', '#006885', 'solid'], body: { engines: '#006885' }, titles: ['VIETNAM AIRLINES', '#006885', 700], mark: { logo: ['lotus', '#d4a843', '#d4a843'] },
  },
  Saudia: {
    basis: 'Saudia 2023: white fuselage, green and blue cheatline under the windows, green tail with the sand palm, green titles',
    fin: ['#00703c', '#00703c', 'solid'], body: { stripes: cheat('#00703c', '#0067b1'), engines: W }, titles: ['SAUDIA', '#00703c', 700], mark: { logo: ['palm', '#d6c49b', '#d6c49b'] },
  },
  flynas: {
    basis: 'flynas: white fuselage, teal tail and lettering',
    fin: ['#00a19a', '#00a19a', 'solid'], body: { engines: '#00a19a' }, titles: ['FLYNAS', '#00a19a', 700], mark: { code: ['XY', W] }, approx: true,
  },
  'Bulgaria Air': {
    basis: 'Bulgaria Air: white fuselage, tail in red with a green split, red titles',
    fin: ['#c8102e', '#00966e', 'split'], body: { engines: '#c8102e' }, titles: ['BULGARIA AIR', '#c8102e', 700], mark: { code: ['FB', W] }, approx: true,
  },
  'Fiji Airways': {
    basis: 'Fiji Airways: white fuselage, dark tail with the masi (tapa) pattern (here two cream bands), dark titles',
    fin: ['#2b211b', '#c9a77c', 'stripe'], body: { engines: '#2b211b' }, titles: ['FIJI AIRWAYS', '#2b211b', 700], mark: { code: ['FJ', '#c9a77c'] }, approx: true,
  },
  'Jet2.com': {
    basis: 'Jet2: white fuselage, red tail and engines with the white Jet2 lettering, red titles',
    fin: ['#e3001b', '#e3001b', 'solid'], body: { engines: '#e3001b' }, titles: ['JET2.COM', '#e3001b', 700], mark: { code: ['JET2', W] },
  },
  'TUI fly Belgium': {
    basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles',
    fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] },
  },
  'Corendon Airlines': {
    basis: 'Corendon: white fuselage, red tail and lettering',
    fin: ['#e30613', '#e30613', 'solid'], body: { engines: '#e30613' }, titles: ['CORENDON', '#e30613', 700], mark: { code: ['XC', W] }, approx: true,
  },
  'Aegean Airlines': {
    basis: 'Aegean: white fuselage, dark blue tail with a light-blue mark, blue engines and titles',
    fin: ['#0d2d6c', '#0d2d6c', 'solid'], body: { engines: '#0d2d6c' }, titles: ['AEGEAN', '#0d2d6c', 700], mark: { logo: ['swift', '#8ec5e8', W] }, approx: true,
  },
  'Garuda Indonesia': {
    basis: 'Garuda: white fuselage, tail in blue with a light-blue sweep, dark blue titles',
    fin: ['#0d6eb0', '#59c1e8', 'sweep'], body: { engines: W }, titles: ['GARUDA INDONESIA', '#003d79', 700], mark: { logo: ['swift', W, '#59c1e8'] }, approx: true,
  },
  'Biman Bangladesh Airlines': {
    basis: 'Biman: white fuselage, red and green cheatline, red tail, red titles',
    fin: ['#da291c', '#006a4e', 'solid'], body: { stripes: cheat('#da291c', '#006a4e'), engines: W }, titles: ['BIMAN', '#da291c', 700], mark: { logo: ['swift', W, '#006a4e'] }, approx: true,
  },
  'Air Algérie': {
    basis: 'Air Algérie: white fuselage, red tail with the white mark, red titles',
    fin: ['#e2001a', '#e2001a', 'solid'], body: { engines: W, stripes: [{ color: '#e2001a', y: 0.58, h: 0.025 }] }, titles: ['AIR ALGÉRIE', '#e2001a', 700], mark: { logo: ['swift', W, W] }, approx: true,
  },

  // ---------- v0.14 market-presence airlines (approximated) ----------
  'Air Peace': simple('Air Peace: white fuselage, blue tail, blue titles', 'AIR PEACE', '#1b3f8b', 'P4', '#d71920', 'split'),
  'Air Côte d’Ivoire': simple('Air Côte d’Ivoire: white fuselage, orange and green tail (the flag), green titles', 'AIR COTE D’IVOIRE', '#f77f00', 'HF', '#009e60', 'split'),
  'ASKY Airlines': simple('ASKY: white fuselage, blue tail, blue titles', 'ASKY', '#00539b', 'KP', '#7ab800', 'sweep'),
  'Africa World Airlines': simple('Africa World Airlines: white fuselage, red tail with gold, red titles', 'AFRICA WORLD AIRLINES', '#b5121b', 'AW', '#d4a843', 'split'),
  'Kenya Airways': simple('Kenya Airways: white fuselage, red and black tail, red titles', 'KENYA AIRWAYS', '#c8102e', 'KQ', '#1d1d1b', 'stripe'),
  RwandAir: simple('RwandAir: white fuselage, light blue tail with the yellow sun, blue titles', 'RWANDAIR', '#00a1de', 'WB', '#fad201', 'sweep'),
  'Air Tanzania': simple('Air Tanzania: white fuselage, green and blue tail, blue titles', 'AIR TANZANIA', '#00a3dd', 'TC', '#1eb53a', 'split'),
  IndiGo: simple('IndiGo: white fuselage, indigo tail and titles', 'INDIGO', '#001b94', '6E'),
  SpiceJet: simple('SpiceJet: white fuselage, red tail and titles', 'SPICEJET', '#e2231a', 'SG', '#f7a600', 'sweep'),
  'SriLankan Airlines': simple('SriLankan: white fuselage, blue and green peacock tail, blue titles', 'SRILANKAN', '#004b8d', 'UL', '#00a651', 'sweep'),
  'US-Bangla Airlines': simple('US-Bangla: white fuselage, blue tail and titles', 'US-BANGLA', '#1d4f91', 'BS', '#e31b23', 'split'),
  'Jeju Air': simple('Jeju Air: white fuselage, orange tail and titles', 'JEJU AIR', '#ff5000', '7C'),
  'Hong Kong Airlines': simple('Hong Kong Airlines: white fuselage, red tail with the gold mark, red titles', 'HONG KONG AIRLINES', '#c8102e', 'HX', undefined, 'solid', '#d4a843'),
  'Juneyao Air': simple('Juneyao: white fuselage, red tail, red titles', 'JUNEYAO AIR', '#c8102e', 'HO', '#f2a900', 'split'),
  'Cebu Pacific': simple('Cebu Pacific: white fuselage, yellow and blue tail, blue titles', 'CEBU PACIFIC', '#0072bc', '5J', '#fdb913', 'split'),
  AirAsia: simple('AirAsia: white fuselage, red tail and titles', 'AIRASIA', '#ed1c24', 'AK'),
  'VietJet Air': simple('VietJet: white fuselage, red and yellow tail, red titles', 'VIETJET', '#ed1c24', 'VJ', '#fcd116', 'split'),
  Qantas: simple('Qantas: white fuselage, red tail with the white kangaroo, red titles', 'QANTAS', '#e40000', 'QF'),
  'Virgin Australia': simple('Virgin Australia: white fuselage, red tail, red titles', 'VIRGIN AUSTRALIA', '#e10a0a', 'VA', '#5b2c86', 'sweep'),
  'Jetstar Airways': simple('Jetstar: white fuselage, black tail with the orange star, orange titles', 'JETSTAR', '#ff5a00', 'JQ', '#1f1f1f', 'split'),
  'Air Transat': simple('Air Transat: white fuselage, blue tail, blue titles', 'AIR TRANSAT', '#1a3d7c', 'TS', '#00a3e0', 'sweep'),
  WestJet: simple('WestJet: white fuselage, teal and blue tail, teal titles', 'WESTJET', '#00a5b5', 'WS', '#003a70', 'split'),
  'Sun Country Airlines': simple('Sun Country: white fuselage, navy and orange tail, navy titles', 'SUN COUNTRY', '#0a2240', 'SY', '#f15a22', 'sweep'),
  Avianca: simple('Avianca 2023: white fuselage, red tail and titles', 'AVIANCA', '#da291c', 'AV'),
  'Viva Aerobus': simple('Viva Aerobus: white fuselage, green tail and titles', 'VIVA', '#00a650', 'VB'),
  'Aerolíneas Argentinas': simple('Aerolíneas Argentinas: white fuselage, navy and light blue tail, navy titles', 'AEROLINEAS ARGENTINAS', '#003c71', 'AR', '#74acdf', 'split'),
  'Sky Airline': simple('Sky Airline: white fuselage, purple tail and titles', 'SKY', '#5a2d81', 'H2'),
  Arajet: simple('Arajet: white fuselage, light blue tail and titles', 'ARAJET', '#00a3e0', 'DM', '#003a70', 'split'),
  'Kuwait Airways': simple('Kuwait Airways: white fuselage, blue tail and titles', 'KUWAIT AIRWAYS', '#0f4c81', 'KU'),
  'Oman Air': simple('Oman Air: white fuselage, teal tail with gold, teal titles', 'OMAN AIR', '#00a3ad', 'WY', undefined, 'solid', '#d4a843'),
  Tunisair: simple('Tunisair: white fuselage, red tail and titles', 'TUNISAIR', '#e70013', 'TU'),
  EgyptAir: simple('EgyptAir: white fuselage, navy tail with the gold mark, navy titles', 'EGYPTAIR', '#002d6b', 'MS', undefined, 'solid', '#d4a843'),
  // ---------- tour operators ----------
  'TUI Deutschland': {
    basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles',
    fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] },
  },
  Jet2holidays: {
    basis: 'Jet2 aircraft with Jet2holidays titles: white fuselage, red tail and engines',
    fin: ['#e3001b', '#e3001b', 'solid'], body: { engines: '#e3001b' }, titles: ['JET2HOLIDAYS', '#e3001b', 700], mark: { code: ['JET2', W] },
  },
  Sunweb: { basis: 'Sunweb brand: orange and white', fin: ['#f39200', '#f39200', 'solid'], body: { engines: '#f39200' }, titles: ['SUNWEB', '#f39200', 700], mark: { logo: ['sun', W, W] }, approx: true },
  Corendon: { basis: 'Corendon: white fuselage, red tail and lettering', fin: ['#e30613', '#e30613', 'solid'], body: { engines: '#e30613' }, titles: ['CORENDON', '#e30613', 700], mark: { code: ['XC', W] }, approx: true },
  Čedok: { basis: 'Čedok brand: blue with red', fin: ['#0055a4', '#d7141a', 'split'], body: { engines: '#0055a4' }, titles: ['ČEDOK', '#0055a4', 700], mark: { code: ['Č', W] }, approx: true },
  Novatours: { basis: 'Novatours brand: orange', fin: ['#ef7d00', '#ef7d00', 'solid'], body: { engines: '#ef7d00' }, titles: ['NOVATOURS', '#ef7d00', 700], mark: { logo: ['sun', W, W] }, approx: true },
  'Schauinsland-Reisen': { basis: 'Schauinsland-Reisen brand: blue and yellow sun', fin: ['#004f9f', '#ffd400', 'split'], body: { engines: '#004f9f' }, titles: ['SCHAUINSLAND-REISEN', '#004f9f', 700], mark: { logo: ['sun', '#ffd400', '#ffd400'] }, approx: true },
  'Sunwing Vacations': {
    basis: 'Sunwing: white fuselage, tail in blue with the orange-yellow sun, blue titles',
    fin: ['#0a3a7c', '#f7941d', 'sweep'], body: { engines: '#0a3a7c' }, titles: ['SUNWING', '#0a3a7c', 700], mark: { logo: ['sun', '#ffcd00', '#f7941d'] }, approx: true,
  },
  'Abercrombie & Kent': { basis: 'Abercrombie & Kent brand: dark green and gold', fin: ['#1f3b2d', '#b8975a', 'solid'], body: { belly: under('#1f3b2d', ['#b8975a', 0.012]), finRoot: '#b8975a' }, titles: ['ABERCROMBIE & KENT', '#1f3b2d', 500], mark: { code: ['A&K', '#b8975a'] }, approx: true },
  'White Desert': { basis: 'White Desert brand: white and ice blue', fin: ['#cfe8f3', '#7fa9bd', 'split'], body: { engines: W }, titles: ['WHITE DESERT', '#33424d', 500], mark: { logo: ['peaks', '#33424d', '#7fa9bd'] }, approx: true },

  // ---------- UN and agencies ----------
  'UN Department of Peace Operations (DPO)': {
    basis: 'UN aircraft: all white, black UN titles on the fuselage and the fin', fin: [W, W, 'solid'], body: { engines: W }, titles: ['UNITED NATIONS', '#000000', 700], mark: { code: ['UN', '#000000'] }, decalInk: '#000000',
  },
  'UN World Food Programme (WFP)': agency('WFP / UNHAS aircraft: white with blue lettering', 'UNHAS WFP', '#007dbc', 'WFP'),
  UNHCR: agency('UNHCR: white with UNHCR blue', 'UNHCR', '#0072bc', 'UN'),
  'International Organization for Migration (IOM)': agency('IOM: white with IOM blue', 'IOM', '#0033a0', 'IOM'),
  'World Health Organization (WHO)': agency('WHO: white with WHO blue', 'WORLD HEALTH ORGANIZATION', '#009ade', 'WHO'),
  'EU Civil Protection and Humanitarian Aid (ECHO)': { basis: 'EU: white with EU blue and the gold star', fin: ['#003399', '#003399', 'solid'], body: { engines: W, stripes: [{ color: '#003399', y: 0.6, h: 0.02 }] }, titles: ['EUROPEAN UNION', '#003399', 700], mark: { logo: ['star', '#ffcc00'] }, decalInk: '#003399' },
  Frontex: agency('Frontex: white with Frontex blue', 'FRONTEX', '#0e47cb', 'FX'),

  // ---------- governments ----------
  'Portuguese Ministry of Foreign Affairs': state('Portuguese state: white, national green and red', 'REPÚBLICA PORTUGUESA', ['#006600', '#ff0000']),
  'Portuguese Ministry of National Defence': state('Portuguese state: white, national green and red', 'REPÚBLICA PORTUGUESA', ['#006600', '#ff0000']),
  'Spanish Ministry of Foreign Affairs': state('Spanish state: white, national red and yellow', 'REINO DE ESPAÑA', ['#aa151b', '#f1bf00', '#aa151b']),
  'Spanish Ministry of Defence': state('Spanish state: white, national red and yellow', 'REINO DE ESPAÑA', ['#aa151b', '#f1bf00', '#aa151b']),
  'Spanish Ministry of the Interior': state('Spanish state: white, national red and yellow', 'REINO DE ESPAÑA', ['#aa151b', '#f1bf00', '#aa151b']),
  'Lithuanian Ministry of Foreign Affairs': state('Lithuanian state: white, national yellow, green, red', 'LIETUVOS RESPUBLIKA', ['#fdb913', '#006a44', '#c1272d']),
  'Lithuanian Ministry of National Defence': state('Lithuanian state: white, national yellow, green, red', 'LIETUVOS RESPUBLIKA', ['#fdb913', '#006a44', '#c1272d']),
  'UK Foreign Office (FCDO)': state('UK government: white, navy and red', 'UNITED KINGDOM', ['#012169', '#c8102e']),
  'UK Home Office': state('UK government: white, navy and red', 'UNITED KINGDOM', ['#012169', '#c8102e']),
  'German Federal Foreign Office': state('German state (Flugbereitschaft): white, grey belly, black-red-gold', 'BUNDESREPUBLIK DEUTSCHLAND', ['#000000', '#dd0000', '#ffce00']),
  'German Federal Police': { basis: 'Bundespolizei: white and blue', fin: ['#004b93', '#004b93', 'solid'], body: { stripes: cheat('#004b93'), engines: W }, titles: ['BUNDESPOLIZEI', '#004b93', 700], mark: { code: ['BP', W] }, decalInk: '#004b93' },
  'Maltese Ministry for Foreign Affairs': state('Maltese state: white and red', 'REPUBLIC OF MALTA', ['#cf142b', '#cf142b']),
  'Armed Forces of Malta': state('Maltese state: white and red', 'ARMED FORCES OF MALTA', ['#cf142b', '#cf142b']),
  'Latvian Ministry of Foreign Affairs': state('Latvian state: white and carmine', 'LATVIJAS REPUBLIKA', ['#9e3039', '#9e3039']),
  'Latvian Ministry of Defence': state('Latvian state: white and carmine', 'LATVIJAS REPUBLIKA', ['#9e3039', '#9e3039']),
  'Czech Ministry of Foreign Affairs': state('Czech state: white, blue and red', 'ČESKÁ REPUBLIKA', ['#11457e', '#d7141a']),
  'Czech Ministry of Defence': state('Czech state: white, blue and red', 'ČESKÁ REPUBLIKA', ['#11457e', '#d7141a']),
  'Bulgarian Ministry of Foreign Affairs': state('Bulgarian state: white, green and red', 'REPUBLIC OF BULGARIA', ['#00966e', '#d62612']),
  'Bulgarian Ministry of Defence': state('Bulgarian state: white, green and red', 'REPUBLIC OF BULGARIA', ['#00966e', '#d62612']),
  'Estonian Ministry of Foreign Affairs': state('Estonian state: white, blue and black', 'EESTI VABARIIK', ['#0072ce', '#000000']),
  'Estonian Ministry of Defence': state('Estonian state: white, blue and black', 'EESTI VABARIIK', ['#0072ce', '#000000']),
  'National Hajj Commission of Nigeria': state('Nigerian state: white and green', 'FEDERAL REPUBLIC OF NIGERIA', ['#008751', '#008751']),
  'Presidency of Nigeria': state('Nigerian presidential fleet: white and green', 'FEDERAL REPUBLIC OF NIGERIA', ['#008751', '#008751']),
  'Pakistan Ministry of Religious Affairs': state('Pakistani state: white and green', 'PAKISTAN', ['#01411c', '#01411c']),
  'Presidência da República de Angola': state('Angolan state: white, red and black, the gold star', 'REPÚBLICA DE ANGOLA', ['#cc092f', '#000000'], '#1d2433', { logo: ['star', '#ffcb00'] }),
  'Présidence de la République du Sénégal': state('Senegalese state: white, green, yellow, red', 'RÉPUBLIQUE DU SÉNÉGAL', ['#00853f', '#fdef42', '#e31b23']),
  'Office of the President of Ghana': state('Ghanaian state: white, red, gold, green, the black star', 'REPUBLIC OF GHANA', ['#ce1126', '#fcd116', '#006b3f'], '#1d2433', { logo: ['star', '#000000'] }),
  'Norwegian Polar Institute (DROMLAN)': state('Norwegian state: white, red and blue', 'NORSK POLARINSTITUTT', ['#ba0c2f', '#00205b']),

  // ---------- clubs, companies, promoters (decals) ----------
  'Sporting CP': brand('Sporting CP: green and white', 'SPORTING CP', '#008057', 'SCP'),
  'SL Benfica': brand('SL Benfica: red and white', 'SL BENFICA', '#e20e0e', 'SLB'),
  'Real Madrid': brand('Real Madrid: white with gold and navy lettering', 'REAL MADRID', '#00529f', 'RM', '#febe10'),
  'Olympique de Marseille': brand('Olympique de Marseille: white and sky blue', 'OLYMPIQUE DE MARSEILLE', '#2faee0', 'OM'),
  'Fortuna Düsseldorf': brand('Fortuna Düsseldorf: red and white', 'FORTUNA DÜSSELDORF', '#d50c2f', 'F95'),
  'Manchester United': brand('Manchester United: red, black and white', 'MANCHESTER UNITED', '#da291c', 'MU', '#000000'),
  'FC Barcelona': brand('FC Barcelona: blaugrana', 'FC BARCELONA', '#a50044', 'FCB', '#004d98'),
  Ajax: brand('Ajax: white with the red band', 'AJAX', '#d2122e', 'AFC'),
  'Riga FC': brand('Riga FC: blue', 'RIGA FC', '#003c8f', 'RFC'),
  'Floriana FC': brand('Floriana FC: green and white', 'FLORIANA FC', '#007a3d', 'FFC'),
  'FK Žalgiris': brand('FK Žalgiris: green and white', 'FK ŽALGIRIS', '#00843d', 'FKŽ'),
  'Formula 1': brand('Formula 1: red and black', 'FORMULA 1', '#e10600', 'F1', '#15151e'),
  Novartis: brand('Novartis: blue', 'NOVARTIS', '#0460a9', 'N'),
  'American Express Global Business Travel': brand('Amex GBT: Amex blue', 'AMEX GBT', '#006fcf', 'GBT'),
  'BBC Studios': brand('BBC Studios: black and white', 'BBC STUDIOS', '#000000', 'BBC'),
  'Live Nation': brand('Live Nation: red', 'LIVE NATION', '#e21836', 'LN'),
  'AEG Presents': brand('AEG Presents: black', 'AEG PRESENTS', '#1d1d1b', 'AEG'),
  'Wasserman Music': brand('Wasserman: blue', 'WASSERMAN', '#1d3c8f', 'W'),

  // ---------- v0.16 (UPDATE-0.16.md §B.5): the new airlines, approximated from their 2025–26 liveries ----------
  'Air France': {
    basis: 'Air France 2009: all-white fuselage and engines, the fin white with the blue "hippocampe" stripes and a small red one, blue titles',
    fin: [W, '#002157', 'stripe'], body: { engines: W, finBands: [{ color: '#ed1b2f', t0: 0.3, t1: 0.36 }] }, titles: ['AIR FRANCE', '#002157', 700], mark: { code: ['AF', '#002157'] }, approx: true,
  },
  KLM: {
    basis: 'KLM: light-blue upper fuselage, white belly below the windows, blue tail with the white crown, white KLM titles',
    fin: ['#00a1de', '#00a1de', 'solid'], body: { color: '#00a1de', belly: under(W), engines: W }, titles: ['KLM', W, 700], mark: { logo: ['crown', W, W] }, approx: true,
  },
  'British Airways': {
    basis: 'British Airways Chatham Dockyard: white fuselage, dark-blue belly, the union-flag ribbon in red, white and blue on the fin, dark-blue titles with the red speedmarque',
    fin: ['#075aaa', '#eb2226', 'sweep'], body: { belly: under('#002a5c'), engines: W }, titles: ['BRITISH AIRWAYS', '#002a5c', 500], mark: { logo: ['ribbon', '#eb2226', W] }, approx: true,
  },
  'Virgin Atlantic': {
    basis: 'Virgin Atlantic: white fuselage, red tail with the white Virgin script, red engines, the titles along the fuselage',
    fin: ['#e10a0a', '#e10a0a', 'solid'], body: { engines: '#e10a0a' }, titles: ['VIRGIN ATLANTIC', '#5a2d82', 500], mark: { code: ['VS', W] }, approx: true,
  },
  Iberia: {
    basis: 'Iberia 2013: white fuselage and engines, the fin red with the yellow sweep, red titles',
    fin: ['#d7192d', '#f9b400', 'sweep'], body: { engines: W }, titles: ['IBERIA', '#d7192d', 700], mark: { code: ['IB', W] },
  },
  SWISS: {
    basis: 'SWISS: white fuselage, red tail with the white cross, dark titles',
    fin: ['#e30613', '#e30613', 'solid'], body: { engines: W }, titles: ['SWISS', '#1d1d1b', 700], mark: { code: ['LX', W] },
  },
  'Turkish Airlines': {
    basis: 'Turkish Airlines 2010: white fuselage, light-grey belly, red tail with the white wild goose, red titles',
    fin: ['#c70a0c', '#c70a0c', 'solid'], body: { belly: under('#c9cdd2'), engines: W }, titles: ['TURKISH AIRLINES', '#c70a0c', 700], mark: { logo: ['swift', W] }, approx: true,
  },
  'Air New Zealand': {
    basis: 'Air New Zealand: white fuselage, black tail with the white koru, black titles',
    fin: ['#000000', '#000000', 'solid'], body: { engines: W }, titles: ['AIR NEW ZEALAND', '#000000', 700], mark: { logo: ['wave', W, W] }, approx: true,
  },
  'French bee': simple('French bee: white fuselage, blue tail with the pink bee, blue titles', 'FRENCH BEE', '#0094d4', 'BF', '#e94e8f', 'sweep'),
  'Air Caraïbes': {
    basis: 'Air Caraïbes: white fuselage, blue tail with the sun-and-palm mark in yellow and orange, blue titles',
    fin: ['#0066b3', '#f59e0b', 'sweep'], body: { engines: '#0066b3' }, titles: ['AIR CARAÏBES', '#0066b3', 700], mark: { logo: ['palm', '#ffd166', '#f59e0b'] }, approx: true,
  },
  'Austrian Airlines': {
    basis: 'Austrian 2015: white fuselage, red tail with the white chevron, red engines and titles',
    fin: ['#e2001a', '#e2001a', 'solid'], body: { engines: '#e2001a' }, titles: ['AUSTRIAN', '#e2001a', 700], mark: { logo: ['chevrons', W] },
  },
  'Brussels Airlines': {
    basis: 'Brussels Airlines 2021: white fuselage, dark-blue tail with the red-dotted b, blue engines and titles',
    fin: ['#00357f', '#00357f', 'solid'], body: { engines: '#00357f' }, titles: ['BRUSSELS AIRLINES', '#00357f', 700], mark: { code: ['SN', '#e4002b'] }, approx: true,
  },
  Luxair: simple('Luxair: white fuselage, light-blue tail and titles', 'LUXAIR', '#00a0e0', 'LG'),
  'ITA Airways': {
    basis: 'ITA Airways: Savoy-blue fuselage and engines, the tricolour on the fin, white titles',
    fin: ['#0a2d6e', '#0a2d6e', 'solid'], body: { color: '#0a2d6e', engines: '#0a2d6e', finBands: [{ color: '#009246', t0: 0.3, t1: 0.42 }, { color: W, t0: 0.42, t1: 0.54 }, { color: '#ce2b37', t0: 0.54, t1: 0.66 }] },
    titles: ['ITA AIRWAYS', W, 700], mark: { code: ['ITA', W] }, approx: true,
  },
  Finnair: {
    basis: 'Finnair: white fuselage, dark-blue tail with the white stylised F, dark-blue titles',
    fin: ['#0b1560', '#0b1560', 'solid'], body: { engines: W }, titles: ['FINNAIR', '#0b1560', 700], mark: { code: ['F', W] },
  },
  Icelandair: simple('Icelandair 2022: white fuselage, a coloured tail (here Boreal blue), dark-blue titles', 'ICELANDAIR', '#0070b8', 'FI', undefined, 'solid', W),
  'Air Europa': simple('Air Europa: white fuselage, dark-blue tail with the red and light-blue stripes, blue titles', 'AIR EUROPA', '#002d72', 'UX', '#e30613', 'stripe'),
  'Air Serbia': simple('Air Serbia: white fuselage, red and blue tail, blue titles', 'AIR SERBIA', '#d31e36', 'JU', '#003a79', 'split'),
  TAROM: {
    basis: 'TAROM: white fuselage, blue cheatline, dark-blue tail with the white swallow, blue titles',
    fin: ['#1d3f8c', '#1d3f8c', 'solid'], body: { stripes: cheat('#1d3f8c', '#d22630'), engines: W }, titles: ['TAROM', '#1d3f8c', 700], mark: { logo: ['swift', W] }, approx: true,
  },
  'KM Malta Airlines': simple('KM Malta Airlines: white fuselage, red tail with the white Maltese cross, red titles', 'KM MALTA AIRLINES', '#c8102e', 'KM'),
  'Cyprus Airways': simple('Cyprus Airways: white fuselage, dark-blue tail with a gold sweep, blue titles', 'CYPRUS AIRWAYS', '#0a3161', 'CY', '#f5b335', 'sweep'),
  'El Al': {
    basis: 'El Al: white fuselage, blue and light-blue cheatline, blue tail with the flag stripes, blue titles',
    fin: ['#0032a0', '#0032a0', 'solid'], body: { stripes: cheat('#0032a0', '#8fb8de'), engines: W, finBands: [{ color: W, t0: 0.4, t1: 0.48 }] }, titles: ['EL AL', '#0032a0', 700], mark: { code: ['ELAL', W] }, approx: true,
  },
  Aircalin: simple('Aircalin: white fuselage, dark-blue tail with a teal sweep and the white bird, blue titles', 'AIRCALIN', '#004b8d', 'SB', '#00a7b5', 'sweep'),
  'Air Tahiti Nui': {
    basis: 'Air Tahiti Nui: the whole fuselage in Tahitian blue, the white tiare flower on the fin, white titles',
    fin: ['#1f5aa6', '#2a9fd6', 'solid'], body: { color: '#2a9fd6', engines: '#2a9fd6' }, titles: ['AIR TAHITI NUI', W, 700], mark: { logo: ['lotus', W, W] }, approx: true,
  },
  'Air Austral': simple('Air Austral: white fuselage, dark-blue tail with a light-blue sweep, blue titles', 'AIR AUSTRAL', '#0d2b6b', 'UU', '#00a0e3', 'sweep'),
  'Caribbean Airlines': {
    basis: 'Caribbean Airlines: white fuselage, teal tail with the gold hummingbird, teal titles',
    fin: ['#006d77', '#d4af37', 'sweep'], body: { engines: W }, titles: ['CARIBBEAN AIRLINES', '#006d77', 700], mark: { logo: ['swift', '#d4af37', '#d4af37'] }, approx: true,
  },
  'Ethiopian Airlines': {
    basis: 'Ethiopian: white fuselage, the fin in green, yellow and red sweeps, green titles',
    fin: ['#009a44', '#fcd116', 'sweep'], body: { engines: W, finBands: [{ color: '#da121a', t0: 0.2, t1: 0.3 }] }, titles: ['ETHIOPIAN', '#009a44', 700], mark: { code: ['ET', W] }, approx: true,
  },
  'South African Airways': {
    basis: 'South African Airways: white fuselage, the fin in the flag colours (blue with a green sweep, yellow and red bands), blue titles',
    fin: ['#00247d', '#009a44', 'sweep'], body: { engines: W, finBands: [{ color: '#ffb81c', t0: 0.3, t1: 0.36 }, { color: '#de3831', t0: 0.36, t1: 0.42 }] }, titles: ['SOUTH AFRICAN', '#00247d', 700], mark: { code: ['SA', W] }, approx: true,
  },
  'Air Mauritius': simple('Air Mauritius: white fuselage, red tail with the white paille-en-queue, red titles', 'AIR MAURITIUS', '#e4002b', 'MK', undefined, 'solid', W),
  'Air Seychelles': simple('Air Seychelles: white fuselage, blue tail with red and green stripes, blue titles', 'AIR SEYCHELLES', '#0054a6', 'HM', '#d62828', 'stripe'),
  'Cabo Verde Airlines': {
    basis: 'Cabo Verde Airlines: white fuselage, blue tail with a yellow band and the gold star, blue titles',
    fin: ['#003f87', '#003f87', 'solid'], body: { engines: W, finBands: [{ color: '#ffd700', t0: 0.46, t1: 0.52 }] }, titles: ['CABO VERDE AIRLINES', '#003f87', 700], mark: { logo: ['star', '#ffd700'] }, approx: true,
  },
  'Air Niugini': {
    basis: 'Air Niugini: white fuselage, red tail with the yellow bird of paradise, red titles',
    fin: ['#d71920', '#d71920', 'solid'], body: { engines: W }, titles: ['AIR NIUGINI', '#d71920', 700], mark: { logo: ['feather', '#ffd200', '#ffd200'] }, approx: true,
  },
  'Solomon Airlines': simple('Solomon Airlines: white fuselage, blue and green tail, blue titles', 'SOLOMON AIRLINES', '#0051ba', 'IE', '#215b33', 'split'),
  'Copa Airlines': {
    basis: 'Copa: white fuselage, dark-blue tail with the white and light-blue globe, blue titles',
    fin: ['#003d7c', '#003d7c', 'solid'], body: { engines: W }, titles: ['COPA AIRLINES', '#003d7c', 700], mark: { logo: ['globe', W, '#8db9e6'] }, approx: true,
  },
  Bahamasair: simple('Bahamasair: white fuselage, aquamarine and yellow tail, dark-blue titles', 'BAHAMASAIR', '#00a9ce', 'UP', '#ffc72c', 'split', '#003a70'),
  'Cayman Airways': simple('Cayman Airways: white fuselage, blue tail with a green sweep (the turtle), blue titles', 'CAYMAN AIRWAYS', '#0b3d91', 'KX', '#2bb673', 'sweep'),
  Corsair: simple('Corsair 2019: white fuselage, dark-blue tail with a turquoise sweep, dark-blue titles', 'CORSAIR', '#0b2d5c', 'SS', '#3cc3dc', 'sweep'),
  'TUI Airways': {
    basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles',
    fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] },
  },
  World2fly: simple('World2fly: white fuselage, pink and blue tail, blue titles', 'WORLD2FLY', '#2b6cd9', 'W2', '#ff4f9a', 'sweep'),
  Iberojet: simple('Iberojet: white fuselage, dark-blue tail with an orange sweep, dark-blue titles', 'IBEROJET', '#1c2b6b', 'E9', '#ff7f41', 'sweep'),
  'Edelweiss Air': {
    basis: 'Edelweiss: white fuselage, red tail with the white edelweiss flower, red engines and titles',
    fin: ['#e2001a', '#e2001a', 'solid'], body: { engines: '#e2001a' }, titles: ['EDELWEISS', '#e2001a', 700], mark: { logo: ['spark', W, W] }, approx: true,
  },
  'Discover Airlines': {
    basis: 'Discover Airlines: white fuselage, dark-blue tail with the gold compass, dark-blue engines and titles',
    fin: ['#0a1f44', '#0a1f44', 'solid'], body: { engines: '#0a1f44' }, titles: ['DISCOVER', '#0a1f44', 700], mark: { logo: ['compass', '#f2a900', W] }, approx: true,
  },
  Marabu: simple('Marabu: white fuselage, turquoise and dark-blue tail, dark-blue titles', 'MARABU', '#00b1b0', 'M', '#1a2b4b', 'split', W),
  Neos: simple('Neos: white fuselage, dark-blue tail with a light-blue sweep, dark-blue engines and titles', 'NEOS', '#003b71', 'NEOS', '#56a0d3', 'sweep'),
  'Norse Atlantic Airways': simple('Norse Atlantic: white fuselage, dark-blue tail with the red longship sail, dark-blue titles', 'NORSE', '#0a2240', 'N0', '#c8102e', 'sweep'),
  'Sunclass Airlines': {
    basis: 'Sunclass: white fuselage, dark-blue tail with the orange sun, dark-blue titles',
    fin: ['#0b2340', '#f5a623', 'sweep'], body: { engines: '#0b2340' }, titles: ['SUNCLASS', '#0b2340', 700], mark: { logo: ['sun', '#f5a623', '#f5a623'] }, approx: true,
  },
  SunExpress: {
    basis: 'SunExpress: white fuselage, red tail with the yellow sun, red engines and titles',
    fin: ['#d4002a', '#f6a800', 'sweep'], body: { engines: '#d4002a' }, titles: ['SUNEXPRESS', '#d4002a', 700], mark: { logo: ['sun', '#f6a800', '#f6a800'] }, approx: true,
  },
  'Enter Air': simple('Enter Air: white fuselage, blue and orange tail, blue titles', 'ENTER AIR', '#004a99', 'E4', '#f58220', 'split'),
  Transavia: simple('Transavia: white fuselage, green tail and engines, green titles', 'TRANSAVIA', '#00c66e', 'HV'),
  easyJet: simple('easyJet: white fuselage, orange tail and engines, orange titles', 'EASYJET', '#ff6600', 'U2'),
  Ryanair: {
    basis: 'Ryanair: white upper fuselage, dark-blue belly and tail, the yellow harp on the fin, dark-blue titles',
    fin: ['#073590', '#073590', 'solid'], body: { belly: under('#073590'), engines: '#073590' }, titles: ['RYANAIR', '#073590', 700], mark: { logo: ['feather', '#f1c933', '#f1c933'] }, approx: true,
  },
  Vueling: simple('Vueling: white fuselage, yellow tail and engines, grey titles', 'VUELING', '#ffcc00', 'VY', undefined, 'solid', '#4a4a4a'),
  Volotea: simple('Volotea: white fuselage, red tail and engines, red titles', 'VOLOTEA', '#d4002a', 'V7'),
  Norwegian: {
    basis: 'Norwegian: white fuselage, the red nose, a thin dark-blue line, white tail with red and blue bands (a tail hero in real life), red titles',
    fin: [W, '#d81e05', 'solid'], body: { noseBand: { color: '#d81e05' }, stripes: [{ color: '#0b1f66', y: 0.6, h: 0.02 }], engines: W, finBands: [{ color: '#d81e05', t0: 0.2, t1: 0.3 }, { color: '#0b1f66', t0: 0.3, t1: 0.36 }] },
    titles: ['NORWEGIAN', '#d81e05', 700], mark: { code: ['DY', '#0b1f66'] }, approx: true,
  },
  'Wizz Air': simple('Wizz Air: white fuselage, magenta and purple tail sweep, magenta engines and titles', 'WIZZ', '#c6007e', 'W6', '#06038d', 'sweep'),
  'Pegasus Airlines': simple('Pegasus: white fuselage, yellow and red tail, dark titles', 'PEGASUS', '#f6b700', 'PC', '#e2001a', 'sweep', '#3b3b3b'),
  flyadeal: simple('flyadeal: white fuselage, violet tail with yellow, violet titles', 'FLYADEAL', '#5c2d91', 'F3', '#ffd200', 'sweep'),

  // ---------- v0.16 tour operators (brand colours on white) ----------
  'TUI UK & Ireland': { basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles', fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] } },
  'TUI Nederland': { basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles', fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] } },
  'TUI France': { basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles', fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] } },
  'TUI Nordic': { basis: 'TUI: white fuselage, light-blue tail and engines with the red smile, blue titles', fin: ['#70cbf4', '#70cbf4', 'solid'], body: { engines: '#70cbf4' }, titles: ['TUI', '#092a5e', 700], mark: { logo: ['smile', '#d40e14', '#d40e14'] } },
  'DER Touristik': brand('DER Touristik: red lettering', 'DER TOURISTIK', '#e2001a', 'DER'),
  alltours: brand('alltours: blue and yellow', 'ALLTOURS', '#004a99', 'AT', '#ffd500'),
  'Coral Travel': brand('Coral Travel: turquoise and coral', 'CORAL TRAVEL', '#00a3ad', 'CT', '#ff6f61'),
  'Anex Tour': brand('Anex Tour: red and blue', 'ANEX TOUR', '#d7141a', 'AX', '#1d4f91'),
  'Apollo (DER Touristik Nordic)': brand('Apollo: blue and orange', 'APOLLO', '#00539f', 'AP', '#f7941d'),
  'Rainbow Tours': brand('Rainbow Tours: blue with the rainbow', 'RAINBOW', '#0057b8', 'RT', '#f7941d'),
  Itaka: brand('Itaka: blue', 'ITAKA', '#0b3d91', 'IT', '#4fb3e8'),
  'Exim Tours': brand('Exim Tours: blue and orange', 'EXIM TOURS', '#1b4f9c', 'EX', '#f58220'),
  Soltour: brand('Soltour: a yellow sun on blue', 'SOLTOUR', '#004b8d', 'ST', '#ffd500'),
  Travelplan: brand('Travelplan: blue and red', 'TRAVELPLAN', '#0b4ea2', 'TP', '#e30613'),
  Alpitour: brand('Alpitour: blue and orange', 'ALPITOUR', '#0a4f9e', 'AL', '#f58220'),
  Aurinkomatkat: brand('Aurinkomatkat: the orange sun', 'AURINKOMATKAT', '#f58220', 'AM'),
  'Club Med': brand('Club Med: trident blue', 'CLUB MED', '#0a3d91', 'CM'),

  // ---------- v0.16 governments and ministries (white, the national colours, titles dark) ----------
  'French Ministry of the Armed Forces': state('French state (Armée de l’air et de l’espace charters): white, blue-white-red', 'RÉPUBLIQUE FRANÇAISE', ['#0055a4', '#ef4135', '#0055a4']),
  'French Ministry for Europe and Foreign Affairs': state('French state: white, blue-white-red', 'RÉPUBLIQUE FRANÇAISE', ['#0055a4', '#ef4135', '#0055a4']),
  'Italian Ministry of Defence': state('Italian state: white, green and red', 'REPUBBLICA ITALIANA', ['#009246', '#ce2b37']),
  'Italian Ministry of Foreign Affairs': state('Italian state: white, green and red', 'REPUBBLICA ITALIANA', ['#009246', '#ce2b37']),
  'Dutch Ministry of Defence': state('Dutch state: white, red and blue', 'KONINKRIJK DER NEDERLANDEN', ['#ae1c28', '#21468b']),
  'Dutch Ministry of Foreign Affairs': state('Dutch state: white, red and blue', 'KONINKRIJK DER NEDERLANDEN', ['#ae1c28', '#21468b']),
  'Belgian Ministry of Defence': state('Belgian state: white, black, yellow and red', 'BELGIAN DEFENCE', ['#000000', '#fdda24', '#ef3340']),
  'Norwegian Ministry of Defence': state('Norwegian state: white, red and blue', 'FORSVARET', ['#ba0c2f', '#00205b']),
  'Swedish Armed Forces': state('Swedish state: white, blue and yellow', 'FÖRSVARSMAKTEN', ['#006aa7', '#fecc02']),
  'Danish Ministry of Defence': state('Danish state: white and red', 'FORSVARET', ['#c8102e', '#c8102e']),
  'Finnish Defence Forces': state('Finnish state: white and blue', 'PUOLUSTUSVOIMAT', ['#002f6c', '#002f6c']),
  'Polish Ministry of National Defence': state('Polish state: white and red', 'RZECZPOSPOLITA POLSKA', ['#dc143c', '#dc143c']),
  'UK Ministry of Defence': state('UK government: white, navy and red', 'UNITED KINGDOM', ['#012169', '#c8102e']),
  'NATO Support and Procurement Agency (NSPA)': agency('NATO: white with NATO blue', 'NSPA', '#003f87', 'NATO'),
  'Irish Department of Defence': state('Irish state: white, green and orange', 'IRELAND', ['#169b62', '#ff883e']),
  'Irish Department of Foreign Affairs': state('Irish state: white, green and orange', 'IRELAND', ['#169b62', '#ff883e']),
  'Austrian Ministry of Defence': state('Austrian state: white and red', 'REPUBLIK ÖSTERREICH', ['#ed2939', '#ed2939']),
  'Romanian Ministry of National Defence': state('Romanian state: white, blue, yellow and red', 'ROMÂNIA', ['#002b7f', '#fcd116', '#ce1126']),
  'Hungarian Defence Forces': state('Hungarian state: white, red and green', 'MAGYAR HONVÉDSÉG', ['#ce2939', '#477050']),
  'Greek Ministry of National Defence': state('Greek state: white and blue', 'HELLENIC REPUBLIC', ['#0d5eaf', '#0d5eaf']),
  'Croatian Ministry of Defence': state('Croatian state: white, red and blue', 'REPUBLIKA HRVATSKA', ['#ff0000', '#171796']),
  'Australian Department of Defence': state('Australian government: white, navy and red', 'AUSTRALIA', ['#00008b', '#ff0000']),
  'Australian Department of Foreign Affairs and Trade': state('Australian government: white, navy and red', 'AUSTRALIA', ['#00008b', '#ff0000']),
  'New Zealand Defence Force': state('New Zealand government: white, navy and red', 'NEW ZEALAND', ['#00247d', '#cc142b']),
  'New Zealand Ministry of Foreign Affairs and Trade': state('New Zealand government: white, navy and red', 'NEW ZEALAND', ['#00247d', '#cc142b']),
  'Canadian Department of National Defence': state('Canadian government: white and red', 'CANADA', ['#ff0000', '#ff0000']),
  'Global Affairs Canada': state('Canadian government: white and red', 'CANADA', ['#ff0000', '#ff0000']),
  'US Department of State': state('US government: white, blue and red', 'UNITED STATES OF AMERICA', ['#3c3b6e', '#b22234', '#3c3b6e']),

  // ---------- v0.16 UN and aid agencies ----------
  UNICEF: agency('UNICEF: white with UNICEF cyan', 'UNICEF', '#1cabe2', 'UNI'),
  'UN OCHA': agency('UN OCHA: white with UN blue', 'UNITED NATIONS OCHA', '#1f5fa6', 'UN'),
  UNDP: agency('UNDP: white with UN blue', 'UNDP', '#006eb5', 'UNDP'),
  'International Committee of the Red Cross (ICRC)': agency('ICRC: white with the red cross', 'ICRC', '#e30613', 'ICRC'),
  IFRC: agency('IFRC: white with the red cross and crescent', 'IFRC', '#e30613', 'IFRC'),
  'Médecins Sans Frontières (MSF)': agency('MSF: white with the red lettering', 'MÉDECINS SANS FRONTIÈRES', '#e2231a', 'MSF'),

  // ---------- v0.16 clubs and federations (decals in their colours) ----------
  'Paris Saint-Germain': brand('Paris Saint-Germain: navy and red', 'PARIS SAINT-GERMAIN', '#004170', 'PSG', '#da291c'),
  'FC Bayern München': brand('FC Bayern: red and white', 'FC BAYERN MÜNCHEN', '#dc052d', 'FCB'),
  Juventus: brand('Juventus: black and white', 'JUVENTUS', '#000000', 'JUVE'),
  'Borussia Dortmund': brand('Borussia Dortmund: yellow and black', 'BORUSSIA DORTMUND', '#fde100', 'BVB', '#000000'),
  Inter: brand('Inter: blue and black', 'INTER', '#010e80', 'INT', '#000000'),
  'AC Milan': brand('AC Milan: red and black', 'AC MILAN', '#fb090b', 'ACM', '#000000'),
  'Atlético de Madrid': brand('Atlético de Madrid: red and white, navy', 'ATLÉTICO DE MADRID', '#cb3524', 'ATM', '#272e61'),
  'FC Porto': brand('FC Porto: blue and white', 'FC PORTO', '#003f8f', 'FCP'),
  'Liverpool FC': brand('Liverpool FC: red', 'LIVERPOOL FC', '#c8102e', 'LFC'),
  Arsenal: brand('Arsenal: red and white', 'ARSENAL', '#ef0107', 'AFC'),
  'Chelsea FC': brand('Chelsea FC: blue', 'CHELSEA FC', '#034694', 'CFC'),
  'Manchester City': brand('Manchester City: sky blue', 'MANCHESTER CITY', '#6cabdd', 'MCFC'),
  'Celtic FC': brand('Celtic FC: green and white', 'CELTIC FC', '#018749', 'CFC'),
  'Rangers FC': brand('Rangers FC: royal blue', 'RANGERS FC', '#1b458f', 'RFC'),
  'Tottenham Hotspur': brand('Tottenham Hotspur: navy and white', 'TOTTENHAM HOTSPUR', '#132257', 'THFC'),
  'Newcastle United': brand('Newcastle United: black and white', 'NEWCASTLE UNITED', '#241f20', 'NUFC'),
  'AS Roma': brand('AS Roma: maroon and gold', 'AS ROMA', '#8e1f2f', 'ROMA', '#f0bc42'),
  'SSC Napoli': brand('SSC Napoli: sky blue', 'SSC NAPOLI', '#12a0d7', 'SSCN'),
  'Sevilla FC': brand('Sevilla FC: white and red', 'SEVILLA FC', '#d4021d', 'SFC'),
  'Athletic Club': brand('Athletic Club: red and white', 'ATHLETIC CLUB', '#ee2523', 'ATH'),
  'SC Braga': brand('SC Braga: red and white', 'SC BRAGA', '#e30613', 'SCB'),
  'Olympique Lyonnais': brand('Olympique Lyonnais: white, blue and red', 'OLYMPIQUE LYONNAIS', '#1d2f6b', 'OL', '#da291c'),
  'AS Monaco': brand('AS Monaco: red and white', 'AS MONACO', '#e63312', 'ASM'),
  Feyenoord: brand('Feyenoord: red and white', 'FEYENOORD', '#e4002b', 'FEY'),
  PSV: brand('PSV: red and white', 'PSV', '#ed1c24', 'PSV'),
  'Club Brugge': brand('Club Brugge: blue and black', 'CLUB BRUGGE', '#0057a8', 'CLUB', '#000000'),
  Galatasaray: brand('Galatasaray: red and yellow', 'GALATASARAY', '#a90432', 'GS', '#fdb912'),
  Fenerbahçe: brand('Fenerbahçe: navy and yellow', 'FENERBAHÇE', '#002b5c', 'FB', '#ffed00'),
  Olympiacos: brand('Olympiacos: red and white', 'OLYMPIACOS', '#c8102e', 'OLY'),
  'FC Red Bull Salzburg': brand('FC Red Bull Salzburg: red and white', 'FC RED BULL SALZBURG', '#dd1a2a', 'RBS'),
  'GNK Dinamo Zagreb': brand('GNK Dinamo Zagreb: blue', 'DINAMO ZAGREB', '#1e4e9f', 'GNK'),
  'Legia Warszawa': brand('Legia Warszawa: green, white and red', 'LEGIA WARSZAWA', '#007a3d', 'LEG', '#e4002b'),
  'SK Slavia Praha': brand('SK Slavia Praha: red and white', 'SK SLAVIA PRAHA', '#c8102e', 'SKS'),
  'FC København': brand('FC København: navy and white', 'FC KØBENHAVN', '#0c2340', 'FCK'),
  'Portuguese Football Federation (FPF)': brand('FPF: red and green', 'FPF', '#c8102e', 'FPF', '#006600'),
  'Royal Spanish Football Federation (RFEF)': brand('RFEF: red and yellow', 'RFEF', '#aa151b', 'RFEF', '#f1bf00'),
  'French Football Federation (FFF)': brand('FFF: blue', 'FFF', '#0055a4', 'FFF'),
  'German Football Association (DFB)': brand('DFB: black and white', 'DFB', '#000000', 'DFB'),
  'The Football Association (FA)': brand('The FA: navy', 'THE FA', '#0f1f5c', 'FA'),
  'Italian Football Federation (FIGC)': brand('FIGC: azure', 'FIGC', '#0066cc', 'FIGC'),
  'Royal Dutch Football Association (KNVB)': brand('KNVB: orange', 'KNVB', '#ff7f00', 'KNVB'),
  'Irish Rugby Football Union (IRFU)': brand('IRFU: green', 'IRFU', '#0b6623', 'IRFU'),
  'Rugby Football Union (RFU)': brand('RFU: white and navy', 'ENGLAND RUGBY', '#002147', 'RFU'),
  'French Rugby Federation (FFR)': brand('FFR: blue', 'FFR', '#0055a4', 'FFR'),
  'Lithuanian Basketball Federation': brand('Lithuanian basketball: green and yellow', 'LIETUVA', '#006a44', 'LTU', '#fdb913'),

  // ---------- v0.16 promoters and companies (decals) ----------
  'CAA Touring': brand('CAA: black', 'CAA TOURING', '#000000', 'CAA'),
  'Semmel Concerts': brand('Semmel Concerts: red', 'SEMMEL CONCERTS', '#e30613', 'SC'),
  DEAG: brand('DEAG: black', 'DEAG', '#000000', 'DEAG'),
  'FKP Scorpio': brand('FKP Scorpio: red', 'FKP SCORPIO', '#e2001a', 'FKP'),
  'Mojo Concerts': brand('Mojo Concerts: black', 'MOJO', '#000000', 'MOJO'),
  'Gérard Drouot Productions': brand('GDP: black', 'GDP', '#1d1d1b', 'GDP'),
  'Everything Is New': brand('Everything Is New: black', 'EVERYTHING IS NEW', '#000000', 'EIN'),
  'Doctor Music': brand('Doctor Music: red', 'DOCTOR MUSIC', '#c8102e', 'DM'),
  'SJM Concerts': brand('SJM Concerts: black', 'SJM CONCERTS', '#000000', 'SJM'),
  'Kilimanjaro Live': brand('Kilimanjaro Live: orange', 'KILIMANJARO LIVE', '#f58220', 'KILI'),
  'Vivo Concerti': brand('Vivo Concerti: red', 'VIVO CONCERTI', '#e30613', 'VIVO'),
  Airbus: brand('Airbus: dark blue', 'AIRBUS', '#00205b', 'AIB'),
  Shell: brand('Shell: red and yellow', 'SHELL', '#dd1d21', 'SH', '#fbce07'),
  Siemens: brand('Siemens: petrol', 'SIEMENS', '#009999', 'SIE'),
  TotalEnergies: brand('TotalEnergies: red and blue', 'TOTALENERGIES', '#ed1c24', 'TE', '#0b4ea2'),
  Maersk: brand('Maersk: light blue', 'MAERSK', '#42b0d5', 'MSK'),
  Equinor: brand('Equinor: coral red', 'EQUINOR', '#ff1243', 'EQNR'),
  Nestlé: brand('Nestlé: brown', 'NESTLÉ', '#63513d', 'NES'),
  Eni: brand('Eni: black and yellow', 'ENI', '#000000', 'ENI', '#ffd200'),
  BHP: brand('BHP: orange', 'BHP', '#e65400', 'BHP'),
  'Rio Tinto': brand('Rio Tinto: red', 'RIO TINTO', '#e60d2e', 'RIO'),
};

/** The logo of a recipe's mark (undefined for lettering). */
export function recipeLogo(r: ClientLiveryRecipe): LiveryLogo | undefined {
  if (!('logo' in r.mark)) return undefined;
  const [id, color, color2, text] = r.mark.logo;
  return { id, color, ...(color2 ? { color2 } : {}), ...(text ? { text } : {}) };
}
