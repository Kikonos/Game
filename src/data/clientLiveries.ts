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

export const CLIENT_LIVERIES: Record<string, ClientLiveryRecipe> = {
  // ---------- airlines ----------
  'SAS Scandinavian Airlines': {
    basis: 'SAS 2019 livery: silver-grey fuselage, dark blue tail running onto the rear fuselage with the white SAS logotype, blue engines',
    fin: ['#000a5a', '#000a5a', 'solid'], body: { color: '#d9dde3', engines: '#000a5a', tailWrap: '#000a5a' },
    titles: ['SCANDINAVIAN', '#000a5a', 700], mark: { code: ['SAS', W] }, approx: true,
  },
  'Aer Lingus': {
    basis: 'Aer Lingus 2019: white top, teal belly, tail and engines, light-green ring at the tail base, light-green shamrock on the fin',
    fin: ['#006272', '#006272', 'solid'], body: { belly: under('#006272'), finRoot: '#7ac143' },
    titles: ['AER LINGUS', '#006272', 500], mark: { logo: ['trefoil', '#7ac143', W] },
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
    basis: 'Air Canada 2017: white top, black belly, tail and engines, the red leaf on the fin, black titles',
    fin: ['#000000', '#000000', 'solid'], body: { belly: under('#000000') }, titles: ['AIR CANADA', '#000000', 700], mark: { logo: ['leaf', '#d22630', '#d22630'] },
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
};

/** The logo of a recipe's mark (undefined for lettering). */
export function recipeLogo(r: ClientLiveryRecipe): LiveryLogo | undefined {
  if (!('logo' in r.mark)) return undefined;
  const [id, color, color2, text] = r.mark.logo;
  return { id, color, ...(color2 ? { color2 } : {}), ...(text ? { text } : {}) };
}
