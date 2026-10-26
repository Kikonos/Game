import { AIRPORT_BY_CODE, AIRPORTS } from './airports';

// Real airlines our crews deadhead on (v0.5.2). Names and IATA codes only; flight numbers are invented by
// engine/ops/commercial.ts. `hubs` are airports in airports.ts; `markets` (low-cost) are the countries they fly
// point-to-point between.

export type CarrierKind = 'network' | 'regional' | 'lcc';

export interface Carrier {
  iata: string;
  name: string;
  /** Home country (ISO 3166-1 alpha-2, as airports.ts). */
  country: string;
  kind: CarrierKind;
  /** Network/regional: hub airports (first = main). Low-cost: bases (any airport in `markets` is served). */
  hubs: string[];
  /** v0.7: a closed network: the only airports flown from its hubs (hub ↔ dest, plus `routes`). */
  dests?: string[];
  /** Low-cost: countries flown point-to-point. Network/regional: extra countries served domestically. */
  markets?: string[];
  /** Airports it does not use (low-cost carriers away from the slot-bound hubs: Ryanair at CDG, Heathrow…). */
  avoid?: string[];
  /** Longest sector it flies (narrowbody-only network carriers, e.g. GOL). */
  maxKm?: number;
  /** Network/regional: the only countries it flies to abroad (Binter: the Canaries' neighbours). */
  reach?: string[];
  /** v0.6 low-cost: small airports (size < 3) it serves besides its bases and the sun routes. */
  extra?: string[];
  /** v0.6 low-cost: foreign countries where it flies domestic routes between two of its bases (Ryanair LIS–OPO). */
  domestic?: string[];
  /**
   * v0.6 low-cost: the markets flown from its bases in a given country (default: all of `markets`). easyJet's
   * Lisbon base flies to the UK, France, Switzerland, Italy… but not to Scandinavia, Poland or Turkey.
   */
  fromBase?: Record<string, string[]>;
  /** v0.6: extra nonstop pairs it flies away from its hubs ('SPU-FRA': Croatia Airlines' seasonal routes). */
  routes?: string[];
  /** v0.7: nonstop pairs its rules would allow but it does not fly ('LIS-MAD': Ryanair's Lisbon base). */
  noRoutes?: string[];
  /** v0.7 network: flies only from its hubs (no domestic point-to-point: Iberia away from Madrid is Vueling's job). */
  hubOnly?: boolean;
}

type Extra = Pick<Carrier, 'avoid' | 'maxKm' | 'reach' | 'extra' | 'domestic' | 'fromBase' | 'routes' | 'dests' | 'noRoutes' | 'hubOnly'>;

const N = (iata: string, name: string, country: string, hubs: string[], markets?: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'network', hubs, markets, ...x });
const R = (iata: string, name: string, country: string, hubs: string[], markets?: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'regional', hubs, markets, ...x });
/** v0.7: the countries of our European airports (the reach of Europe's network carriers starts there). */
const EUROPE = [...new Set(AIRPORTS.filter((a) => a.continent === 'EU' && !a.enroute).map((a) => a.country))].sort();
/** v0.7: the countries of our airports outside Europe (the Gulf and African super-connectors reach all of them). */
const NON_EUROPE = [...new Set(AIRPORTS.filter((a) => a.continent !== 'EU' && !a.enroute).map((a) => a.country))].sort();
/** v0.7: a closed network keeps only the airports in our list. */
const net = (codes: string): string[] => codes.split(' ').filter((c) => !!AIRPORT_BY_CODE[c]);

const L = (iata: string, name: string, country: string, hubs: string[], markets: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'lcc', hubs, markets, ...x });

/**
 * v0.6: airports only the low-cost carriers use (network and regional airlines stay out unless it is their own
 * hub): Stansted, Luton, Charleroi, Beauvais, Hahn, Bergamo, Ciampino, Treviso, Skavsta, Modlin, Girona, Reus,
 * Eindhoven, Schönefeld. Only the codes present in airports.ts are kept.
 */
export const LCC_ONLY_ALL = ['STN', 'LTN', 'CRL', 'BVA', 'HHN', 'BGY', 'CIA', 'TSF', 'NYO', 'WMI', 'GRO', 'REU', 'EIN', 'SXF'];

/**
 * v0.7 fix: small airports served only on listed `routes` (Shannon and Cork: Aer Lingus to Heathrow and the US,
 * Ryanair to London, the sun and Poland; Tarbes: Air France from Paris, Ryanair's pilgrim flights).
 */
export const ROUTES_ONLY_ALL = ['SNN', 'ORK', 'LDE'];

/** Big slot-bound hubs the European low-cost carriers stay out of (unless one is their own base). */
const HUBS_NO_LCC = ['LHR', 'CDG', 'FRA', 'MUC', 'AMS', 'ZRH', 'IST'];

const EU_LCC_RYANAIR = ['IE', 'GB', 'ES', 'PT', 'IT', 'FR', 'BE', 'DE', 'NL', 'PL', 'MT', 'GR', 'HR', 'LV', 'LT', 'EE', 'CZ', 'HU', 'RO', 'BG', 'SE', 'DK', 'NO', 'FI', 'AT', 'MA', 'CY', 'JO', 'AL'];
const EU_LCC_EASYJET = ['GB', 'FR', 'CH', 'IT', 'PT', 'ES', 'NL', 'DE', 'AT', 'GR', 'HR', 'MT', 'CY', 'BE', 'DK', 'IS', 'MA', 'EG', 'TR', 'CZ', 'HU', 'PL', 'IE', 'IL', 'JO', 'NO', 'SE', 'FI', 'BG', 'AL', 'CV'];
/** easyJet by base country (UK bases fly the whole network; Turkey and the long sun routes only from the UK). */
const EASYJET_FROM: Record<string, string[]> = {
  PT: ['GB', 'FR', 'CH', 'IT', 'ES', 'NL', 'DE', 'MA'],
  ES: ['GB', 'FR', 'CH', 'IT', 'PT', 'NL', 'DE', 'BE', 'DK', 'IE'],
  FR: ['GB', 'FR', 'CH', 'IT', 'PT', 'ES', 'DE', 'GR', 'HR', 'MT', 'MA', 'EG', 'IL', 'JO', 'IS', 'CV', 'AL', 'HU', 'DK', 'NO', 'FI'],
  NL: ['GB', 'FR', 'CH', 'IT', 'PT', 'ES', 'DE', 'GR', 'HR', 'MT', 'CY', 'AT', 'HU', 'CZ', 'IL', 'MA', 'EG'],
  CH: ['GB', 'FR', 'IT', 'PT', 'ES', 'NL', 'DE', 'AT', 'GR', 'HR', 'MT', 'CY', 'BE', 'DK', 'IS', 'MA', 'EG', 'CZ', 'HU', 'PL', 'IE', 'IL', 'NO', 'SE', 'FI', 'AL'],
  IT: ['GB', 'FR', 'CH', 'PT', 'ES', 'NL', 'DE', 'AT', 'GR', 'HR', 'MT', 'CY', 'BE', 'DK', 'IS', 'MA', 'EG', 'CZ', 'HU', 'PL', 'IL', 'JO', 'NO', 'SE', 'FI', 'AL'],
  DE: ['GB', 'FR', 'CH', 'IT', 'PT', 'ES', 'NL', 'AT', 'GR', 'HR', 'MT', 'CY', 'DK', 'IS', 'MA', 'EG', 'IL', 'JO', 'SE', 'NO', 'FI', 'HU', 'CZ', 'PL', 'BG', 'AL', 'IE'],
};
const EU_LCC_WIZZ = ['HU', 'PL', 'RO', 'BG', 'RS', 'LT', 'LV', 'EE', 'CZ', 'GB', 'IT', 'MT', 'ES', 'PT', 'DE', 'FR', 'NL', 'BE', 'GR', 'CY', 'IL', 'AE', 'SA', 'AL', 'GE', 'AM', 'AT', 'NO', 'SE', 'DK', 'IS'];

export const CARRIERS: Carrier[] = [
  // Europe: network and flag carriers
  // v0.7: TAP's long haul is the Atlantic and Lusophone Africa (no Gulf, no Asia); no Sofia or Zagreb.
  // v0.7 fix: no Shannon, Cork or Tarbes (Dublin only in Ireland).
  N('TP', 'TAP Air Portugal', 'PT', ['LIS', 'OPO'], undefined, { avoid: ['ZAG', 'SOF', 'SNN', 'ORK', 'LDE'], reach: [...EUROPE, 'BR', 'AO', 'MZ', 'CV', 'ST', 'GW', 'US', 'CA', 'VE', 'MA', 'SN', 'IL', 'GN', 'CI', 'GM', 'TG'] }),
  R('S4', 'Azores Airlines', 'PT', ['PDL', 'TER'], undefined, { dests: net('LIS OPO FNC BOS JFK YYZ FRA LGW CDG') }),
  N('IB', 'Iberia', 'ES', ['MAD'], undefined, { hubOnly: true, reach: [...EUROPE, 'MX', 'CO', 'PE', 'AR', 'CU', 'DO', 'EC', 'CL', 'UY', 'PA', 'GT', 'SV', 'CR', 'VE', 'BO', 'PY', 'US', 'GQ', 'BR', 'PR', 'MA', 'SN', 'IL', 'EG'] }),
  // v0.7 fix: Air Europa's long haul is the Americas (no Africa beyond Morocco, no Asia).
  N('UX', 'Air Europa', 'ES', ['MAD'], undefined, { avoid: ['LHR', 'SNN', 'ORK', 'LDE'], reach: [...EUROPE, 'US', 'MX', 'CU', 'DO', 'PR', 'PA', 'CO', 'VE', 'EC', 'PE', 'BO', 'PY', 'UY', 'AR', 'BR', 'HN', 'SV', 'GT', 'CR', 'MA', 'IL'] }),
  R('NT', 'Binter', 'ES', ['LPA', 'TFS', 'ACE', 'FUE'], undefined, { reach: ['PT', 'MA', 'SN', 'CV', 'MR', 'GM', 'FR', 'IT'] }),
  N('LH', 'Lufthansa', 'DE', ['FRA', 'MUC'], undefined, { avoid: ['LGW', 'STN'], routes: ['FRA-SPU', 'FRA-DBV', 'MUC-SPU', 'MUC-DBV'] }),
  // v0.7: Air France has left Orly (Transavia flies Orly); Paris is Charles de Gaulle.
  N('AF', 'Air France', 'FR', ['CDG'], undefined, { routes: ['CDG-LDE'] }),
  N('KL', 'KLM', 'NL', ['AMS']),
  N('BA', 'British Airways', 'GB', ['LHR', 'LGW'], undefined, { avoid: ['STN', 'LTN', 'SNN', 'ORK'], routes: ['LHR-CHS'] }),
  // v0.7 fix: Shannon and Cork are Heathrow (and the seasonal US) shuttles; nobody flies Dublin–Shannon or Dublin–Cork.
  N('EI', 'Aer Lingus', 'IE', ['DUB'], undefined, { avoid: ['LGW', 'SNN', 'ORK'], reach: [...EUROPE, 'US', 'CA'], routes: ['SNN-LHR', 'ORK-LHR', 'SNN-JFK', 'SNN-BOS'] }),
  // v0.7: SWISS's Geneva flying is a few trunk routes (London); easyJet is Geneva's airline.
  N('LX', 'SWISS', 'CH', ['ZRH'], undefined, { avoid: ['LGW', 'STN', 'LTN'], routes: ['GVA-LHR', 'GVA-LCY'], reach: [...EUROPE, 'US', 'CA', 'BR', 'ZA', 'IN', 'TH', 'SG', 'JP', 'CN', 'HK', 'KR', 'IL', 'AE', 'EG', 'MV', 'MU', 'MA', 'TN'] }),
  N('OS', 'Austrian Airlines', 'AT', ['VIE'], undefined, { reach: [...EUROPE, 'US', 'CA', 'TH', 'JP', 'IL', 'JO', 'EG', 'GE', 'AM', 'AZ', 'MV', 'MU', 'IR', 'LB'] }),
  N('SN', 'Brussels Airlines', 'BE', ['BRU'], undefined, { reach: [...EUROPE, 'US', 'CA', 'IL', 'MA', 'SN', 'SL', 'LR', 'CI', 'GH', 'TG', 'BJ', 'BF', 'ML', 'CM', 'GN', 'NE', 'AO', 'CD', 'RW', 'UG', 'KE'] }),
  R('LG', 'Luxair', 'LU', ['LUX'], undefined, { dests: net('LIS OPO FAO FNC BCN AGP PMI ALC TFS LPA HER NCE FCO LIN VCE VIE MUC BER HAM DUB GVA LCY') }),
  N('AZ', 'ITA Airways', 'IT', ['FCO', 'LIN'], undefined, { reach: [...EUROPE, 'US', 'CA', 'BR', 'AR', 'JP', 'IN', 'IL', 'EG', 'TN', 'MA', 'MV'] }),
  R('A3', 'Aegean Airlines', 'GR', ['ATH', 'SKG'], undefined, { reach: [...EUROPE, 'IL', 'EG', 'JO', 'LB', 'SA', 'AE', 'KW', 'GE', 'AM', 'IN'] }),
  R('KM', 'KM Malta Airlines', 'MT', ['MLA'], undefined, { dests: net('LHR LGW CDG FCO LIN MXP CTA FRA MUC BRU AMS VIE ZRH DUS') }),
  R('CY', 'Cyprus Airways', 'CY', ['LCA'], undefined, { dests: net('ATH SKG HER BEY TLV AMM CDG FCO MXP') }),
  N('SK', 'SAS', 'DK', ['CPH', 'ARN', 'OSL'], ['SE', 'NO'], { reach: [...EUROPE, 'US', 'CA', 'JP', 'CN', 'KR', 'TH', 'IL'] }),
  N('AY', 'Finnair', 'FI', ['HEL'], undefined, { reach: [...EUROPE, 'JP', 'KR', 'CN', 'TH', 'SG', 'IN', 'US', 'IL', 'AE', 'QA'] }),
  N('FI', 'Icelandair', 'IS', ['KEF']),
  N('LO', 'LOT Polish Airlines', 'PL', ['WAW'], undefined, { reach: [...EUROPE, 'US', 'CA', 'KR', 'JP', 'IN', 'CN', 'IL', 'UZ', 'GE', 'AM', 'AZ', 'LK'] }),
  // v0.7 closed networks of the small flag carriers (their real current routes, our airports only).
  R('QS', 'Smartwings', 'CZ', ['PRG'], undefined, { dests: net('BCN CDG FCO LCA TLV ATH HER RHO CFU KGS CHQ ZTH AYT HRG SSH TFS LPA PMI AGP FAO SPU DBV BOJ VAR') }),
  R('RO', 'TAROM', 'RO', ['OTP'], undefined, { dests: net('AMS ATH BCN BEY BRU CAI CDG FCO FRA IST LCA LHR MAD MXP TLV VIE CLJ') }),
  R('FB', 'Bulgaria Air', 'BG', ['SOF'], undefined, { dests: net('LHR CDG FRA MUC AMS BRU MAD BCN FCO MXP ATH VIE ZRH TLV BER LCA BOJ VAR') }),
  R('JU', 'Air Serbia', 'RS', ['BEG'], undefined, { dests: net('AMS ATH BCN BER BRU CDG CPH DUS FCO FRA GVA HAM IST LCA LHR LJU MAD MUC MXP NCE OTP PRG SKG SKP STR TGD TIV TLV VIE ZRH JFK') }),
  R('OU', 'Croatia Airlines', 'HR', ['ZAG'], undefined, { reach: ['DE', 'AT', 'BE', 'CH', 'FR', 'NL', 'IT', 'DK', 'ES', 'IE', 'GB', 'BA', 'MK', 'XK'], routes: ['SPU-FRA', 'SPU-MUC', 'DBV-FRA', 'DBV-MUC'] }),
  // v0.7 fix: no Shannon, Cork or Tarbes; the seasonal Riga–Dubai.
  R('BT', 'airBaltic', 'LV', ['RIX', 'VNO', 'TLL'], ['LT', 'EE'], { avoid: ['SNN', 'ORK', 'LDE'], routes: ['RIX-DXB'] }),
  R('ZB', 'Air Albania', 'AL', ['TIA'], undefined, { dests: net('IST FCO MXP BLQ BGY LIN') }),
  N('TK', 'Turkish Airlines', 'TR', ['IST']),
  // Europe: low-cost
  L('FR', 'Ryanair', 'IE', ['DUB', 'STN', 'MAN', 'BCN', 'MAD', 'AGP', 'LIS', 'OPO', 'FAO', 'PMI', 'CRL', 'FCO', 'NAP', 'WAW', 'KRK', 'MLA', 'RIX', 'VNO', 'BUD', 'OTP', 'ZAG', 'ATH', 'BER', 'CPH', 'VIE', 'PRG', 'SOF', 'TLL', 'MRS', 'RAK'], EU_LCC_RYANAIR, {
    avoid: [...HUBS_NO_LCC, 'LGW', 'ORY', 'LIN', 'MXP', 'DUS', 'GVA', 'CMN'], domestic: ['PT', 'ES', 'IT', 'GB'],
    // v0.7 fix: Shannon, Cork and Lourdes are a few listed routes (London, the sun, Poland; the pilgrim flights).
    routes: ['SNN-STN', 'SNN-AGP', 'SNN-ALC', 'SNN-FAO', 'SNN-ACE', 'SNN-TFS', 'SNN-KRK', 'ORK-STN', 'ORK-AGP', 'ORK-ALC', 'ORK-FAO', 'ORK-KRK', 'ORK-GDN', 'LDE-CRL', 'LDE-BGY'],
    fromBase: {
      PT: ['PT', 'GB', 'IE', 'FR', 'BE', 'DE', 'IT', 'NL', 'PL', 'MA', 'ES'], HR: ['GB', 'IE', 'IT', 'BE', 'DE', 'FR', 'ES', 'SE', 'DK', 'NO', 'PL', 'MT', 'NL'],
      // v0.7: Budapest and Bucharest bases fly west (Wizz Air links the two).
      HU: ['GB', 'IE', 'IT', 'ES', 'PT', 'FR', 'BE', 'DE', 'NL', 'MT', 'GR', 'HR', 'CY', 'SE', 'DK', 'PL', 'MA'],
      RO: ['GB', 'IE', 'IT', 'ES', 'PT', 'FR', 'BE', 'DE', 'NL', 'MT', 'GR', 'CY', 'SE', 'DK', 'AT', 'PL'],
    },
    // v0.7: Lisbon base spot checks (TAP, Iberia and Air Europa fly Madrid; TAP and easyJet Toulouse; TAP and Eurowings Hamburg).
    noRoutes: ['LIS-MAD', 'LIS-TLS', 'LIS-HAM', 'LIS-FAO', 'MAD-AGP'],
  }),
  L('U2', 'easyJet', 'GB', ['LGW', 'LTN', 'BRS', 'MAN', 'EDI', 'GLA', 'BFS', 'GVA', 'LIS', 'OPO', 'FAO', 'MXP', 'NAP', 'VCE', 'CDG', 'ORY', 'NCE', 'LYS', 'TLS', 'BOD', 'NTE', 'AMS', 'BER', 'BCN', 'MAD', 'PMI', 'AGP', 'ALC'], EU_LCC_EASYJET, { avoid: [...HUBS_NO_LCC, 'DUB', 'CMN'], domestic: ['FR', 'IT'], fromBase: EASYJET_FROM, noRoutes: ['LIS-MAD', 'LIS-HAM', 'ORY-AGP'] }),
  L('W6', 'Wizz Air', 'HU', ['BUD', 'OTP', 'CLJ', 'SOF', 'VAR', 'WAW', 'KRK', 'GDN', 'VNO', 'RIX', 'BEG', 'TIA', 'FCO', 'NAP', 'MXP', 'VCE', 'BLQ', 'TBS', 'LCA', 'AUH'], EU_LCC_WIZZ, {
    avoid: [...HUBS_NO_LCC, 'ORY', 'CMN'], domestic: ['IT'],
    // v0.7: the Baltic bases are small (London, Norway, Italy, Germany, Georgia…).
    fromBase: { LV: ['GB', 'NO', 'HU', 'IT', 'DE', 'GE'], LT: ['GB', 'NO', 'IT', 'DE', 'ES', 'FR', 'NL', 'BE', 'SE', 'DK', 'IS', 'HU', 'GE', 'IL', 'AE', 'CY', 'GR'] },
  }),
  L('VY', 'Vueling', 'ES', ['BCN', 'FCO', 'ORY', 'PMI', 'AGP', 'SVQ', 'BIO'], ['ES', 'FR', 'IT', 'PT', 'GB', 'NL', 'BE', 'DE', 'CH', 'GR', 'MA', 'IE', 'DK'], { avoid: [...HUBS_NO_LCC.filter((x) => x !== 'AMS'), 'CMN'] }),
  L('HV', 'Transavia', 'NL', ['AMS', 'EIN', 'ORY', 'NTE', 'LYS'], ['NL', 'FR', 'ES', 'PT', 'IT', 'GR', 'MA', 'TN', 'TR', 'EG', 'IL', 'CV'], { avoid: [...HUBS_NO_LCC, 'CMN'] }),
  L('LS', 'Jet2', 'GB', ['MAN', 'BHX', 'STN', 'BRS', 'NCL', 'GLA', 'EDI'], ['GB', 'ES', 'PT', 'GR', 'CY', 'TR', 'IT', 'HR', 'MT', 'BG'], { avoid: [...HUBS_NO_LCC, 'LGW', 'LCY'] }),
  L('DY', 'Norwegian', 'NO', ['OSL', 'CPH', 'ARN', 'HEL'], ['NO', 'DK', 'SE', 'FI', 'ES', 'PT', 'IT', 'FR', 'GR', 'HR', 'GB', 'DE', 'PL', 'IS'], { avoid: HUBS_NO_LCC }),
  L('EW', 'Eurowings', 'DE', ['DUS', 'CGN', 'HAM', 'STR', 'BER'], ['DE', 'AT', 'ES', 'PT', 'IT', 'GR', 'HR', 'GB', 'FR', 'SE', 'DK', 'CZ', 'PL', 'TR', 'EG', 'BG', 'CY'], { avoid: HUBS_NO_LCC.filter((x) => x !== 'LHR') }),
  L('V7', 'Volotea', 'ES', ['BOD', 'NTE', 'VCE'], ['ES', 'FR', 'IT', 'GR', 'HR', 'PT'], { avoid: [...HUBS_NO_LCC, 'LGW', 'ORY'] }),
  L('PC', 'Pegasus', 'TR', ['SAW', 'AYT', 'ADB', 'ESB'], ['TR', 'DE', 'NL', 'GB', 'FR', 'IT', 'ES', 'AT', 'CH', 'GE', 'AZ', 'IL', 'JO', 'SA', 'AE', 'EG'], { avoid: HUBS_NO_LCC }),
  // Africa
  N('AT', 'Royal Air Maroc', 'MA', ['CMN']),
  R('TU', 'Tunisair', 'TN', ['TUN'], undefined, { dests: net('CDG ORY LYS MRS NCE FRA MUC DUS BRU AMS FCO MXP GVA ZRH VIE IST LHR ALG CMN CAI JED MED DSS ABJ BKO NKC TIP') }),
  R('AH', 'Air Algérie', 'DZ', ['ALG'], undefined, { dests: net('CDG ORY LYS MRS NCE TLS BOD FRA BRU LHR BCN ALC MAD FCO MXP IST TUN CAI DXB JED MED YUL PEK DSS ABJ BKO NIM NKC OUA') }),
  N('MS', 'EgyptAir', 'EG', ['CAI']),
  // v0.7 fix: Ethiopian's Europe is a handful of capitals and trunk cities (no Lisbon, Amsterdam or Eastern Europe).
  N('ET', 'Ethiopian Airlines', 'ET', ['ADD'], undefined, { reach: [...NON_EUROPE, 'DE', 'GB', 'IE', 'FR', 'BE', 'IT', 'ES', 'AT', 'SE', 'NO', 'DK', 'GR', 'CH', 'TR'], avoid: ['BCN', 'MUC', 'BER', 'DUS', 'NAP', 'CTA', 'PMO', 'CAG', 'SKG', 'HER', 'RHO', 'CFU', 'KGS', 'CHQ', 'LGW', 'ORY', 'ZRH'] }),
  // v0.7 fix: Kenya Airways' Europe is Amsterdam, London and Paris.
  N('KQ', 'Kenya Airways', 'KE', ['NBO'], undefined, { reach: [...NON_EUROPE, 'NL', 'GB', 'FR'], avoid: ['LGW', 'MAN', 'ORY', 'NCE', 'LYS'] }),
  N('SA', 'South African Airways', 'ZA', ['JNB']),
  R('WB', 'RwandAir', 'RW', ['KGL']),
  R('KP', 'ASKY Airlines', 'TG', ['LFW']),
  R('HF', "Air Côte d'Ivoire", 'CI', ['ABJ']),
  R('P4', 'Air Peace', 'NG', ['LOS', 'ABV']),
  R('HC', 'Air Senegal', 'SN', ['DSS']),
  N('DT', 'TAAG Angola Airlines', 'AO', ['LAD']),
  R('TM', 'LAM Mozambique', 'MZ', ['MPM']),
  R('MK', 'Air Mauritius', 'MU', ['MRU']),
  R('UR', 'Uganda Airlines', 'UG', ['EBB']),
  R('TC', 'Air Tanzania', 'TZ', ['DAR']),
  R('UM', 'Air Zimbabwe', 'ZW', ['HRE']),
  R('BP', 'Air Botswana', 'BW', ['GBE']),
  R('HM', 'Air Seychelles', 'SC', ['SEZ']),
  R('MD', 'Madagascar Airlines', 'MG', ['TNR']),
  R('VR', 'Cabo Verde Airlines', 'CV', ['SID', 'RAI'], undefined, { dests: net('LIS OPO BOS DSS BVC') }),
  R('QC', 'Camair-Co', 'CM', ['DLA']),
  R('2J', 'Air Burkina', 'BF', ['OUA']),
  R('L6', 'Mauritania Airlines', 'MR', ['NKC']),
  R('LN', 'Libyan Airlines', 'LY', ['TIP']),
  R('SD', 'Sudan Airways', 'SD', ['KRT']),
  R('8Z', 'Congo Airways', 'CD', ['GOM']),
  // Middle East and Central Asia
  // v0.7: flydubai's cities, not Emirates' (Sofia, Bucharest, Kabul…).
  // v0.7 fix: Emirates, Etihad and Qatar fly their real networks (our airports): no Charleston, Santiago, Vilnius or Shannon.
  N('EK', 'Emirates', 'AE', ['DXB'], undefined, {
    dests: net('LHR LGW MAN BHX NCL GLA EDI DUB CDG NCE LYS AMS BRU FRA MUC HAM DUS ZRH GVA VIE MAD BCN LIS FCO MXP VCE BLQ NAP ATH LCA MLA CPH ARN OSL WAW PRG BUD ZAG IST ' +
      'JFK EWR BOS IAD ORD DFW IAH MIA MCO LAX SFO SEA YYZ MEX BOG GRU GIG EZE CAI CMN TUN ALG ADD NBO DAR EBB ACC LOS ABV DSS ABJ LAD LUN HRE JNB CPT DUR MRU SEZ ' +
      'DOH BAH KWI MCT RUH JED DMM MED AMM BEY TLV IKA BGW DEL BOM BLR MAA HYD CCU COK AMD TRV CMB DAC KHI LHE ISB KTM MLE ' +
      'SIN BKK HKT KUL CGK DPS MNL SGN HAN PEK PVG CAN HKG TPE HND NRT KIX ICN SYD MEL BNE PER ADL AKL CHC'),
    routes: ['MXP-JFK', 'ATH-EWR', 'LCA-MLA', 'BCN-MEX'],
  }),
  N('EY', 'Etihad Airways', 'AE', ['AUH'], undefined, {
    dests: net('LHR MAN EDI DUB CDG NCE AMS BRU FRA MUC DUS ZRH GVA VIE MAD BCN LIS FCO MXP ATH CPH WAW PRG IST TLV JFK ORD IAD BOS YYZ CMN RAK CAI NBO ' +
      'BAH KWI MCT RUH JED DMM MED AMM BEY DEL BOM BLR MAA HYD COK CCU AMD TRV CMB DAC KHI LHE ISB KTM MLE SIN BKK HKT KUL CGK DPS MNL HAN PEK PVG HKG TPE NRT ICN SYD MEL PER'),
  }),
  L('FZ', 'flydubai', 'AE', ['DXB'], ['BG', 'RO', 'PL', 'CZ', 'AE', 'SA', 'OM', 'KW', 'BH', 'QA', 'JO', 'LB', 'EG', 'TR', 'GE', 'AZ', 'AM', 'IN', 'PK', 'BD', 'NP', 'LK', 'MV', 'KE', 'ET', 'TZ', 'UZ', 'TJ', 'AF', 'IR', 'SD', 'DJ', 'SO'], { noRoutes: ['DXB-AUH', 'DXB-SHJ'] }),
  L('G9', 'Air Arabia', 'AE', ['SHJ'], ['AE', 'SA', 'OM', 'KW', 'BH', 'QA', 'JO', 'LB', 'EG', 'TR', 'GE', 'AZ', 'AM', 'IN', 'PK', 'BD', 'NP', 'LK', 'KE', 'UZ', 'IR', 'SD', 'MA'], { noRoutes: ['SHJ-AUH', 'SHJ-DXB'] }),
  N('QR', 'Qatar Airways', 'QA', ['DOH'], undefined, {
    dests: net('LHR LGW MAN EDI BHX DUB CDG NCE LYS AMS BRU FRA MUC BER DUS ZRH GVA VIE MAD BCN LIS FCO MXP VCE ATH CPH ARN OSL HEL WAW KRK PRG BUD OTP SOF BEG ZAG SKP IST SAW TBS GYD EVN ' +
      'JFK BOS PHL IAD ORD DFW IAH MIA ATL LAX SFO SEA YUL GRU EZE BOG CAI CMN RAK TUN ALG ADD NBO MBA DAR ZNZ JRO EBB KGL LOS ABV ACC DSS ABJ KAN MPM LAD JNB CPT DUR SEZ ' +
      'DXB SHJ BAH KWI MCT RUH JED DMM MED AMM BEY BGW IKA MHD DEL BOM BLR MAA HYD COK CCU AMD GOI TRV CMB DAC KTM MLE KHI LHE ISB TAS ALA ' +
      'SIN BKK HKT KUL PEN CGK DPS MNL CEB SGN HAN PEK PKX PVG CAN HKG TPE HND NRT KIX ICN SYD MEL BNE PER ADL AKL'),
  }),
  R('GF', 'Gulf Air', 'BH', ['BAH']),
  R('KU', 'Kuwait Airways', 'KW', ['KWI']),
  R('WY', 'Oman Air', 'OM', ['MCT']),
  N('SV', 'Saudia', 'SA', ['JED', 'RUH']),
  L('XY', 'flynas', 'SA', ['RUH', 'JED', 'DMM', 'MED'], ['SA', 'AE', 'EG', 'TR', 'JO', 'KW', 'BH', 'PK', 'IN', 'SD', 'GE', 'AZ']),
  N('LY', 'El Al', 'IL', ['TLV']),
  R('RJ', 'Royal Jordanian', 'JO', ['AMM']),
  R('ME', 'Middle East Airlines', 'LB', ['BEY']),
  R('A9', 'Georgian Airways', 'GE', ['TBS']),
  R('J2', 'AZAL', 'AZ', ['GYD']),
  R('IR', 'Iran Air', 'IR', ['IKA']),
  R('FG', 'Ariana Afghan Airlines', 'AF', ['KBL']),
  R('HY', 'Uzbekistan Airways', 'UZ', ['TAS']),
  R('T5', 'Turkmenistan Airlines', 'TM', ['ASB']),
  R('SZ', 'Somon Air', 'TJ', ['DYU']),
  // South Asia
  N('AI', 'Air India', 'IN', ['DEL', 'BOM']),
  L('6E', 'IndiGo', 'IN', ['DEL', 'BOM', 'BLR', 'HYD'], ['IN', 'AE', 'SA', 'OM', 'QA', 'KW', 'BH', 'TH', 'SG', 'MY', 'VN', 'LK', 'NP', 'BD', 'MV', 'TR']),
  R('UL', 'SriLankan Airlines', 'LK', ['CMB']),
  R('PK', 'PIA', 'PK', ['KHI', 'ISB', 'LHE']),
  R('BG', 'Biman Bangladesh', 'BD', ['DAC']),
  R('RA', 'Nepal Airlines', 'NP', ['KTM']),
  // East and South-East Asia
  N('SQ', 'Singapore Airlines', 'SG', ['SIN']),
  N('TG', 'Thai Airways', 'TH', ['BKK']),
  N('MH', 'Malaysia Airlines', 'MY', ['KUL']),
  L('AK', 'AirAsia', 'MY', ['KUL', 'DMK', 'CGK'], ['MY', 'TH', 'ID', 'PH', 'VN', 'SG', 'KH', 'MM', 'IN', 'CN', 'HK', 'MO', 'TW']),
  // v0.7 fix: Garuda's long haul is Amsterdam and the Hajj (Jeddah, Medina); the rest is Asia and Australia.
  N('GA', 'Garuda Indonesia', 'ID', ['CGK'], undefined, { dests: net('AMS JED MED SIN KUL BKK HKG PVG PEK CAN NRT HND KIX ICN SYD MEL PER DPS SUB KNO UPG BPN PDG PLM BTH') }),
  N('PR', 'Philippine Airlines', 'PH', ['MNL']),
  N('VN', 'Vietnam Airlines', 'VN', ['HAN', 'SGN']),
  R('UB', 'Myanmar National Airlines', 'MM', ['RGN']),
  N('CA', 'Air China', 'CN', ['PEK']),
  N('MU', 'China Eastern', 'CN', ['PVG']),
  N('CZ', 'China Southern', 'CN', ['CAN']),
  N('CX', 'Cathay Pacific', 'HK', ['HKG']),
  R('NX', 'Air Macau', 'MO', ['MFM']),
  N('BR', 'EVA Air', 'TW', ['TPE']),
  N('NH', 'ANA', 'JP', ['HND', 'NRT']),
  N('JL', 'Japan Airlines', 'JP', ['HND', 'NRT']),
  N('KE', 'Korean Air', 'KR', ['ICN']),
  // Oceania
  N('QF', 'Qantas', 'AU', ['SYD', 'MEL']),
  N('VA', 'Virgin Australia', 'AU', ['BNE']),
  N('NZ', 'Air New Zealand', 'NZ', ['AKL']),
  R('FJ', 'Fiji Airways', 'FJ', ['NAN']),
  R('SB', 'Aircalin', 'NC', ['NOU']),
  R('OL', 'Samoa Airways', 'WS', ['APW']),
  // Americas
  N('AA', 'American Airlines', 'US', ['DFW', 'CLT', 'MIA', 'PHL'], ['PR'], { routes: ['PHL-SNN'] }),
  N('DL', 'Delta Air Lines', 'US', ['ATL', 'JFK', 'DTW', 'MSP', 'SLC'], ['PR'], { routes: ['JFK-SNN'] }),
  N('UA', 'United Airlines', 'US', ['EWR', 'IAD', 'DEN', 'IAH', 'SFO'], ['GU'], { routes: ['EWR-SNN'] }),
  L('WN', 'Southwest Airlines', 'US', ['MDW', 'DEN', 'LAS', 'BWI'], ['US', 'MX', 'PR', 'BS', 'JM', 'AW', 'CR', 'CU']),
  // v0.7: JetBlue's transatlantic flying is London, Paris, Amsterdam, Dublin and Edinburgh.
  N('B6', 'JetBlue', 'US', ['JFK', 'BOS', 'FLL'], ['PR', 'DO', 'JM', 'BS', 'AW'], { reach: ['GB', 'FR', 'NL', 'IE', 'MX', 'CO', 'PE', 'EC', 'CR', 'GT', 'SV', 'HN', 'CU', 'HT', 'TT', 'BB', 'LC', 'KY', 'TC'] }),
  N('AS', 'Alaska Airlines', 'US', ['SEA', 'ANC', 'PDX']),
  R('HA', 'Hawaiian Airlines', 'US', ['HNL']),
  N('AC', 'Air Canada', 'CA', ['YYZ', 'YUL', 'YVR']),
  R('WS', 'WestJet', 'CA', ['YYC']),
  N('AM', 'Aeroméxico', 'MX', ['MEX']),
  L('Y4', 'Volaris', 'MX', ['GDL', 'TIJ', 'MEX'], ['MX', 'US', 'GT', 'SV', 'CR']),
  N('CM', 'Copa Airlines', 'PA', ['PTY']),
  N('AV', 'Avianca', 'CO', ['BOG', 'SAL'], ['SV', 'GT', 'CR', 'EC']),
  // v0.7 fix: LATAM leaves South America only for Europe's trunk cities, North America, Oceania and Johannesburg.
  N('LA', 'LATAM', 'CL', ['SCL', 'GRU', 'LIM'], ['BR', 'PE', 'EC', 'CO', 'AR', 'UY', 'PY'], {
    reach: ['BO', 'VE', 'GY', 'SR', 'ES', 'PT', 'DE', 'GB', 'IT', 'US', 'MX', 'CU', 'DO', 'CR', 'PA', 'AU', 'NZ', 'ZA'],
    avoid: ['PMI', 'AGP', 'VLC', 'ALC', 'SVQ', 'BIO', 'IBZ', 'LPA', 'TFS', 'ACE', 'FUE', 'MAH', 'MUC', 'EWR', 'ATL', 'ORD', 'DFW', 'IAH', 'DEN', 'SFO', 'YYZ'],
  }),
  N('AR', 'Aerolíneas Argentinas', 'AR', ['AEP', 'EZE']),
  N('G3', 'GOL', 'BR', ['CGH', 'GRU', 'GIG', 'BSB'], undefined, { maxKm: 4_000 }),
  N('AD', 'Azul', 'BR', ['CNF', 'REC']),
  R('OB', 'Boliviana de Aviación', 'BO', ['VVI', 'LPB']),
  R('V0', 'Conviasa', 'VE', ['CCS']),
  R('CU', 'Cubana', 'CU', ['HAV']),
  R('UP', 'Bahamasair', 'BS', ['NAS']),
  L('DM', 'Arajet', 'DO', ['SDQ'], ['DO', 'US', 'CA', 'MX', 'CO', 'PE', 'JM', 'AW', 'PR', 'GT', 'SV', 'CR', 'EC', 'BR', 'AR']),
];

export const CARRIER_BY_IATA: Record<string, Carrier> = Object.fromEntries(CARRIERS.map((c) => [c.iata, c]));

/** Big connecting hubs used when no carrier flies a pair direct (besides the origin/destination flag hubs). */
export const WORLD_HUBS = ['FRA', 'MUC', 'CDG', 'AMS', 'LHR', 'MAD', 'LIS', 'IST', 'DXB', 'DOH', 'ADD', 'NBO', 'JNB', 'CMN', 'CAI', 'DEL', 'SIN', 'BKK', 'HKG', 'ICN', 'SYD', 'JFK', 'ATL', 'MIA', 'YYZ', 'PTY', 'BOG', 'GRU', 'SCL'];
