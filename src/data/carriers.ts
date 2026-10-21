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
}

type Extra = Pick<Carrier, 'avoid' | 'maxKm' | 'reach' | 'extra' | 'domestic' | 'fromBase' | 'routes'>;

const N = (iata: string, name: string, country: string, hubs: string[], markets?: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'network', hubs, markets, ...x });
const R = (iata: string, name: string, country: string, hubs: string[], markets?: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'regional', hubs, markets, ...x });
const L = (iata: string, name: string, country: string, hubs: string[], markets: string[], x?: Extra): Carrier => ({ iata, name, country, kind: 'lcc', hubs, markets, ...x });

/**
 * v0.6: airports only the low-cost carriers use (network and regional airlines stay out unless it is their own
 * hub): Stansted, Luton, Charleroi, Beauvais, Hahn, Bergamo, Ciampino, Treviso, Skavsta, Modlin, Girona, Reus,
 * Eindhoven, Schönefeld. Only the codes present in airports.ts are kept.
 */
export const LCC_ONLY_ALL = ['STN', 'LTN', 'CRL', 'BVA', 'HHN', 'BGY', 'CIA', 'TSF', 'NYO', 'WMI', 'GRO', 'REU', 'EIN', 'SXF'];

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
  N('TP', 'TAP Air Portugal', 'PT', ['LIS', 'OPO'], undefined, { avoid: ['ZAG'] }),
  R('S4', 'Azores Airlines', 'PT', ['PDL', 'TER']),
  N('IB', 'Iberia', 'ES', ['MAD']),
  N('UX', 'Air Europa', 'ES', ['MAD'], undefined, { avoid: ['LHR'] }),
  R('NT', 'Binter', 'ES', ['LPA', 'TFS', 'ACE', 'FUE'], undefined, { reach: ['PT', 'MA', 'SN', 'CV', 'MR', 'GM', 'FR', 'IT'] }),
  N('LH', 'Lufthansa', 'DE', ['FRA', 'MUC'], undefined, { routes: ['FRA-SPU', 'FRA-DBV', 'MUC-SPU', 'MUC-DBV'] }),
  N('AF', 'Air France', 'FR', ['CDG', 'ORY']),
  N('KL', 'KLM', 'NL', ['AMS']),
  N('BA', 'British Airways', 'GB', ['LHR', 'LGW']),
  N('EI', 'Aer Lingus', 'IE', ['DUB']),
  N('LX', 'SWISS', 'CH', ['ZRH', 'GVA']),
  N('OS', 'Austrian Airlines', 'AT', ['VIE']),
  N('SN', 'Brussels Airlines', 'BE', ['BRU']),
  R('LG', 'Luxair', 'LU', ['LUX']),
  N('AZ', 'ITA Airways', 'IT', ['FCO', 'LIN']),
  R('A3', 'Aegean Airlines', 'GR', ['ATH', 'SKG']),
  R('KM', 'KM Malta Airlines', 'MT', ['MLA']),
  R('CY', 'Cyprus Airways', 'CY', ['LCA']),
  N('SK', 'SAS', 'DK', ['CPH', 'ARN', 'OSL'], ['SE', 'NO']),
  N('AY', 'Finnair', 'FI', ['HEL']),
  N('FI', 'Icelandair', 'IS', ['KEF']),
  N('LO', 'LOT Polish Airlines', 'PL', ['WAW']),
  R('QS', 'Smartwings', 'CZ', ['PRG']),
  R('RO', 'TAROM', 'RO', ['OTP']),
  R('FB', 'Bulgaria Air', 'BG', ['SOF']),
  R('JU', 'Air Serbia', 'RS', ['BEG']),
  R('OU', 'Croatia Airlines', 'HR', ['ZAG'], undefined, { reach: ['DE', 'AT', 'BE', 'CH', 'FR', 'NL', 'IT', 'DK', 'ES', 'IE', 'GB', 'BA', 'MK', 'XK'], routes: ['SPU-FRA', 'SPU-MUC', 'DBV-FRA', 'DBV-MUC'] }),
  R('BT', 'airBaltic', 'LV', ['RIX', 'VNO', 'TLL'], ['LT', 'EE']),
  R('ZB', 'Air Albania', 'AL', ['TIA']),
  N('TK', 'Turkish Airlines', 'TR', ['IST']),
  // Europe: low-cost
  L('FR', 'Ryanair', 'IE', ['DUB', 'STN', 'MAN', 'BCN', 'MAD', 'AGP', 'LIS', 'OPO', 'FAO', 'PMI', 'CRL', 'FCO', 'NAP', 'WAW', 'KRK', 'MLA', 'RIX', 'VNO', 'BUD', 'OTP', 'ZAG', 'ATH', 'BER', 'CPH', 'VIE', 'PRG', 'SOF', 'TLL', 'MRS', 'RAK'], EU_LCC_RYANAIR, { avoid: [...HUBS_NO_LCC, 'LGW', 'ORY', 'LIN', 'MXP', 'DUS', 'GVA', 'CMN'], domestic: ['PT', 'ES', 'IT', 'GB'], fromBase: { PT: ['PT', 'GB', 'IE', 'FR', 'BE', 'DE', 'IT', 'NL', 'PL', 'MA', 'ES'], HR: ['GB', 'IE', 'IT', 'BE', 'DE', 'FR', 'ES', 'SE', 'DK', 'NO', 'PL', 'MT', 'NL'] } }),
  L('U2', 'easyJet', 'GB', ['LGW', 'BRS', 'MAN', 'EDI', 'GLA', 'BFS', 'GVA', 'LIS', 'OPO', 'FAO', 'MXP', 'NAP', 'VCE', 'CDG', 'ORY', 'NCE', 'LYS', 'TLS', 'BOD', 'NTE', 'AMS', 'BER', 'BCN', 'MAD', 'PMI', 'AGP', 'ALC'], EU_LCC_EASYJET, { avoid: [...HUBS_NO_LCC, 'DUB', 'CMN'], domestic: ['FR', 'IT'], fromBase: EASYJET_FROM }),
  L('W6', 'Wizz Air', 'HU', ['BUD', 'OTP', 'CLJ', 'SOF', 'VAR', 'WAW', 'KRK', 'GDN', 'VNO', 'RIX', 'BEG', 'TIA', 'FCO', 'NAP', 'MXP', 'VCE', 'BLQ', 'TBS', 'LCA', 'AUH'], EU_LCC_WIZZ, { avoid: [...HUBS_NO_LCC, 'ORY', 'CMN'], domestic: ['IT'] }),
  L('VY', 'Vueling', 'ES', ['BCN', 'FCO', 'ORY', 'PMI', 'AGP', 'SVQ', 'BIO'], ['ES', 'FR', 'IT', 'PT', 'GB', 'NL', 'BE', 'DE', 'CH', 'GR', 'MA', 'IE', 'DK'], { avoid: [...HUBS_NO_LCC.filter((x) => x !== 'AMS'), 'CMN'] }),
  L('HV', 'Transavia', 'NL', ['AMS', 'EIN', 'ORY', 'NTE', 'LYS'], ['NL', 'FR', 'ES', 'PT', 'IT', 'GR', 'MA', 'TN', 'TR', 'EG', 'IL', 'CV'], { avoid: [...HUBS_NO_LCC, 'CMN'] }),
  L('LS', 'Jet2', 'GB', ['MAN', 'BHX', 'STN', 'BRS', 'NCL', 'GLA', 'EDI'], ['GB', 'ES', 'PT', 'GR', 'CY', 'TR', 'IT', 'HR', 'MT', 'BG'], { avoid: [...HUBS_NO_LCC, 'LGW', 'LCY'] }),
  L('DY', 'Norwegian', 'NO', ['OSL', 'CPH', 'ARN', 'HEL'], ['NO', 'DK', 'SE', 'FI', 'ES', 'PT', 'IT', 'FR', 'GR', 'HR', 'GB', 'DE', 'PL', 'IS'], { avoid: HUBS_NO_LCC }),
  L('EW', 'Eurowings', 'DE', ['DUS', 'CGN', 'HAM', 'STR', 'BER'], ['DE', 'AT', 'ES', 'PT', 'IT', 'GR', 'HR', 'GB', 'FR', 'SE', 'DK', 'CZ', 'PL', 'TR', 'EG'], { avoid: HUBS_NO_LCC.filter((x) => x !== 'LHR') }),
  L('V7', 'Volotea', 'ES', ['BOD', 'NTE', 'VCE'], ['ES', 'FR', 'IT', 'GR', 'HR', 'PT'], { avoid: [...HUBS_NO_LCC, 'LGW', 'ORY'] }),
  L('PC', 'Pegasus', 'TR', ['SAW', 'AYT', 'ADB', 'ESB'], ['TR', 'DE', 'NL', 'GB', 'FR', 'IT', 'ES', 'AT', 'CH', 'GE', 'AZ', 'IL', 'JO', 'SA', 'AE', 'EG'], { avoid: HUBS_NO_LCC }),
  // Africa
  N('AT', 'Royal Air Maroc', 'MA', ['CMN']),
  R('TU', 'Tunisair', 'TN', ['TUN']),
  R('AH', 'Air Algérie', 'DZ', ['ALG']),
  N('MS', 'EgyptAir', 'EG', ['CAI']),
  N('ET', 'Ethiopian Airlines', 'ET', ['ADD']),
  N('KQ', 'Kenya Airways', 'KE', ['NBO']),
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
  R('VR', 'Cabo Verde Airlines', 'CV', ['SID', 'RAI']),
  R('QC', 'Camair-Co', 'CM', ['DLA']),
  R('2J', 'Air Burkina', 'BF', ['OUA']),
  R('L6', 'Mauritania Airlines', 'MR', ['NKC']),
  R('LN', 'Libyan Airlines', 'LY', ['TIP']),
  R('SD', 'Sudan Airways', 'SD', ['KRT']),
  R('8Z', 'Congo Airways', 'CD', ['GOM']),
  // Middle East and Central Asia
  N('EK', 'Emirates', 'AE', ['DXB']),
  N('EY', 'Etihad Airways', 'AE', ['AUH']),
  L('FZ', 'flydubai', 'AE', ['DXB'], ['AE', 'SA', 'OM', 'KW', 'BH', 'QA', 'JO', 'LB', 'EG', 'TR', 'GE', 'AZ', 'AM', 'IN', 'PK', 'BD', 'NP', 'LK', 'MV', 'KE', 'ET', 'TZ', 'UZ', 'TJ', 'AF', 'IR', 'SD', 'DJ', 'SO']),
  L('G9', 'Air Arabia', 'AE', ['SHJ'], ['AE', 'SA', 'OM', 'KW', 'BH', 'QA', 'JO', 'LB', 'EG', 'TR', 'GE', 'AZ', 'AM', 'IN', 'PK', 'BD', 'NP', 'LK', 'KE', 'UZ', 'IR', 'SD', 'MA']),
  N('QR', 'Qatar Airways', 'QA', ['DOH']),
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
  N('GA', 'Garuda Indonesia', 'ID', ['CGK']),
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
  N('AA', 'American Airlines', 'US', ['DFW', 'CLT', 'MIA', 'PHL'], ['PR']),
  N('DL', 'Delta Air Lines', 'US', ['ATL', 'JFK', 'DTW', 'MSP', 'SLC'], ['PR']),
  N('UA', 'United Airlines', 'US', ['EWR', 'IAD', 'DEN', 'IAH', 'SFO'], ['GU']),
  L('WN', 'Southwest Airlines', 'US', ['MDW', 'DEN', 'LAS', 'BWI'], ['US', 'MX', 'PR', 'BS', 'JM', 'AW', 'CR', 'CU']),
  N('B6', 'JetBlue', 'US', ['JFK', 'BOS', 'FLL'], ['PR', 'DO', 'JM', 'BS', 'AW']),
  N('AS', 'Alaska Airlines', 'US', ['SEA', 'ANC', 'PDX']),
  R('HA', 'Hawaiian Airlines', 'US', ['HNL']),
  N('AC', 'Air Canada', 'CA', ['YYZ', 'YUL', 'YVR']),
  R('WS', 'WestJet', 'CA', ['YYC']),
  N('AM', 'Aeroméxico', 'MX', ['MEX']),
  L('Y4', 'Volaris', 'MX', ['GDL', 'TIJ', 'MEX'], ['MX', 'US', 'GT', 'SV', 'CR']),
  N('CM', 'Copa Airlines', 'PA', ['PTY']),
  N('AV', 'Avianca', 'CO', ['BOG', 'SAL'], ['SV', 'GT', 'CR', 'EC']),
  N('LA', 'LATAM', 'CL', ['SCL', 'GRU', 'LIM'], ['BR', 'PE', 'EC', 'CO', 'AR', 'UY', 'PY']),
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
