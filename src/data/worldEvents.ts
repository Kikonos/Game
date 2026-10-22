// v0.8 (UPDATE-0.8.md §5.1): invented world events in real places with real airlines and governments (BRIEF
// "Player decisions": invented events allowed). Plausible, varied, never blaming a named private person. Texts are
// templates: {until} is the expected end ('9 Aug'), {entity} the airline or rival involved.

import type { WorldEventKind } from '../engine/core/types';

/** Work an event creates within 48 h (contracts/missions.ts builds it). */
export type EventWork = 'evacuation' | 'repatriation' | 'humanitarian' | 'medical' | 'aogCover' | 'acmi';

export interface WorldEventTpl {
  id: string;
  kind: WorldEventKind;
  /** Focus airport (map pin) and its country. */
  at: string;
  country: string;
  zoneId?: string;
  /** Chance the zone's airspace closes (0 = never, 1 = always). */
  closeP?: number;
  /** The focus airport closes for [min, max] days (disasters, national strikes). */
  airportDays?: [number, number];
  warRisk?: 1 | 2 | 3;
  /** Flights touching these countries' airports run late by this many minutes (ATC strikes). */
  delayCountries?: string[];
  delayMin?: number;
  /** What delays them ('ATC strike' when unset). */
  delayWhat?: string;
  /** Length in days [min, max] (else the kind's). */
  days?: [number, number];
  /** Months it can happen in (0 = Jan; else any). */
  months?: number[];
  /** The airline or body involved; an airline client in trouble (strikes), or a fragile carrier (failures). */
  entity?: string;
  /** Clients that need cover because of it (by name, first that exists). */
  coverFor?: string[];
  work: EventWork[];
  /** Demand shock on a segment. */
  shock?: { seg: 'narrow' | 'wide' | 'all'; delta: number; text: string };
  /** Fuel price jump [min, max] share. */
  fuel?: [number, number];
  title: string;
  body: string;
  /** Text when the closure roll fails (templates with 0 < closeP < 1): title and body never promise a closure. */
  open?: { title: string; body: string };
  /** Reopening message (closures only). */
  reopen?: string;
}

export const WORLD_EVENT_TPLS: WorldEventTpl[] = [
  // ---------- coups ----------
  {
    id: 'coupNiger', kind: 'coup', at: 'NIM', country: 'NE', zoneId: 'niger', closeP: 1, warRisk: 2, work: ['evacuation', 'repatriation'],
    title: 'Coup in Niger', reopen: "Niger's airspace has reopened",
    body: "Soldiers have taken over in Niamey and closed the airport and Niger's airspace until at least {until}. Europeans are being told to leave: foreign ministries are asking for evacuation flights from Niamey via Abidjan.",
  },
  {
    id: 'coupBurkina', kind: 'coup', at: 'OUA', country: 'BF', zoneId: 'burkina', closeP: 1, warRisk: 2, work: ['evacuation'],
    title: 'Military takeover in Ouagadougou', reopen: "Burkina Faso's airspace has reopened",
    body: "Gunfire around the presidency and the state broadcaster: the army has suspended the government and closed Burkina Faso's borders and airspace until at least {until}. Embassies are counting their citizens.",
  },
  {
    id: 'coupMali', kind: 'coup', at: 'BKO', country: 'ML', zoneId: 'mali', closeP: 1, warRisk: 2, work: ['evacuation', 'repatriation'],
    title: "Junta closes Mali's airspace", reopen: "Mali's airspace has reopened",
    body: "A new military council in Bamako has closed the airport and Mali's airspace until at least {until}. Dakar is the nearest way out for foreigners.",
  },
  {
    id: 'coupChad', kind: 'coup', at: 'NDJ', country: 'TD', zoneId: 'chad', closeP: 0.6, warRisk: 2, work: ['evacuation'],
    title: "Soldiers seize N'Djamena", reopen: "Chad's airspace has reopened",
    body: "Troops hold the airport and the radio in N'Djamena. Flights are suspended until at least {until}; aid agencies want their staff out through Cairo.",
    open: { title: "Soldiers seize N'Djamena", body: "Troops hold the presidency and the radio in N'Djamena. The airport stays open under military control until at least {until}; aid agencies want their staff out through Cairo." },
  },
  // ---------- strikes ----------
  {
    id: 'strikeDsna', kind: 'strike', at: 'CDG', country: 'FR', delayCountries: ['FR'], delayMin: 45, work: ['aogCover'], coverFor: ['TUI fly Belgium', 'Jet2.com', 'Eurowings'],
    title: 'French air traffic controllers strike (DSNA)',
    body: "French controllers walk out until {until}: about 30 % of overflights are cut and flights to and from France run late. Airlines are scrambling for spare aircraft and slots.",
    shock: { seg: 'narrow', delta: 0.03, text: 'French ATC strike' },
  },
  {
    id: 'strikeLhPilots', kind: 'strike', at: 'FRA', country: 'DE', entity: 'Lufthansa', work: ['aogCover', 'acmi'], coverFor: ['Eurowings', 'Condor', 'Lufthansa'],
    title: 'Lufthansa pilots strike (Vereinigung Cockpit)',
    body: "Lufthansa's pilots are out until {until}. Eurowings and Condor are short of aircraft for the extra passengers and want wet-leased cover at short notice.",
    shock: { seg: 'narrow', delta: 0.08, text: "Lufthansa pilots' strike" },
  },
  {
    id: 'strikeBelgium', kind: 'strike', at: 'BRU', country: 'BE', airportDays: [1, 1], work: ['aogCover'], coverFor: ['TUI fly Belgium'],
    title: 'Belgian national strike closes Brussels Airport',
    body: "Security and handling staff join a national strike: Brussels Airport is closed until {until}. Flights into Brussels wait; TUI fly Belgium is moving its holiday flights to other airports.",
  },
  {
    id: 'strikeEnav', kind: 'strike', at: 'FCO', country: 'IT', delayCountries: ['IT'], delayMin: 40, work: ['aogCover'], coverFor: ['Aegean Airlines', 'Eurowings'],
    title: 'Italian air traffic controllers strike (ENAV)',
    body: "Italian controllers strike until {until}: flights to and from Italy run late or are cut. Airlines want spare capacity for the days after.",
  },
  // ---------- European operations (short, close to home: they touch our own flying) ----------
  {
    id: 'strikeEnaire', kind: 'strike', at: 'MAD', country: 'ES', delayCountries: ['ES'], delayMin: 30, days: [1, 2], work: [],
    title: 'Spanish air traffic controllers stop work in rolling shifts',
    body: "Controllers at several Spanish centres stop work in rolling shifts until {until}. Flights to and from Spain run about half an hour late; nothing is cancelled.",
  },
  {
    id: 'strikeGreekAtc', kind: 'strike', at: 'ATH', country: 'GR', delayCountries: ['GR'], delayMin: 40, days: [1, 3], work: [],
    title: 'Greek controllers work to rule',
    body: "Greek air traffic controllers are working to rule over staffing until {until}: flow restrictions add about 40 minutes to flights to and from Greece and the islands.",
  },
  {
    id: 'strikePtHandling', kind: 'strike', at: 'LIS', country: 'PT', delayCountries: ['PT'], delayMin: 60, delayWhat: 'Ground handling strike', days: [1, 3], work: [],
    title: 'Ground handling strike at Lisbon, Porto and Faro',
    body: "Ground staff at Portugal's main airports strike until {until}. Minimum services keep flights moving, but turnarounds take about an hour longer.",
  },
  {
    id: 'windMadeira', kind: 'disaster', at: 'FNC', country: 'PT', airportDays: [1, 2], days: [1, 2], work: [],
    title: 'Strong winds close Madeira airport',
    body: "Gusts over the limits at Funchal: flights to Madeira wait or divert to Porto Santo until {until}.",
  },
  {
    id: 'calimaCanaries', kind: 'disaster', at: 'LPA', country: 'ES', airportDays: [1, 1], days: [1, 1], work: [],
    title: 'Calima: Saharan dust closes Gran Canaria',
    body: "A thick calima from the Sahara has cut visibility at Gran Canaria below the minimums until {until}. Flights there wait for it to clear.",
  },
  {
    id: 'wildfireRhodes', kind: 'disaster', at: 'RHO', country: 'GR', days: [3, 6], months: [6, 7], work: ['repatriation'], coverFor: ['TUI Deutschland', 'Jet2holidays'],
    title: 'Wildfires on Rhodes: holidaymakers evacuated',
    body: "Wildfires have forced hotels in the south of Rhodes to evacuate until at least {until}. The airport stays open; tour operators want extra flights to bring their guests home.",
  },
  // ---------- ash ----------
  {
    id: 'ashReykjanes', kind: 'ash', at: 'KEF', country: 'IS', zoneId: 'iceland', closeP: 1, work: ['acmi'], coverFor: ['SAS Scandinavian Airlines', 'Aer Lingus'],
    title: 'Reykjanes eruption: ash closes Keflavík and Icelandic airspace', reopen: 'Icelandic airspace has reopened',
    body: "A new fissure on the Reykjanes peninsula is throwing ash high enough to close Keflavík and Icelandic airspace until at least {until}. North Atlantic flights route around it.",
  },
  {
    id: 'ashEtna', kind: 'ash', at: 'CTA', country: 'IT', zoneId: 'etna', closeP: 1, work: [],
    title: 'Etna ash closes Catania', reopen: 'Catania has reopened after the Etna ash',
    body: "Etna's ash plume has closed Catania and the airspace over eastern Sicily until at least {until}. Holiday flights to Catania wait or go to Palermo.",
  },
  {
    id: 'ashLewotobi', kind: 'ash', at: 'DPS', country: 'ID', zoneId: 'javaBali', closeP: 1, work: ['repatriation'],
    title: 'Lewotobi ash closes Bali', reopen: 'Bali has reopened after the Lewotobi ash',
    body: "Mount Lewotobi Laki-laki is erupting again: ash closes Bali and East Java's airspace until at least {until}. Thousands of tourists are stuck.",
  },
  // ---------- disasters ----------
  {
    id: 'quakeAdana', kind: 'disaster', at: 'ADA', country: 'TR', airportDays: [1, 2], work: ['humanitarian', 'medical'],
    title: '7.1 earthquake near Adana',
    body: "A 7.1 earthquake has hit south-east Türkiye near Adana. The runway is being inspected; aid agencies are chartering aircraft for rescue teams, tents and field hospitals.",
  },
  {
    id: 'hurricanePuj', kind: 'disaster', at: 'PUJ', country: 'DO', airportDays: [1, 2], work: ['repatriation', 'humanitarian'],
    title: 'Hurricane in the Caribbean: Punta Cana closed',
    body: "A category 4 hurricane has crossed the eastern Dominican Republic. Punta Cana is closed until {until}; tour operators and ministries want their holidaymakers home.",
  },
  {
    id: 'floodsSindh', kind: 'disaster', at: 'KHI', country: 'PK', work: ['humanitarian', 'medical'],
    title: 'Floods in Sindh',
    body: "Monsoon floods cover a third of Sindh. The WFP and the WHO are chartering aircraft for food, tents and medical teams into Karachi.",
  },
  {
    id: 'quakeMorocco', kind: 'disaster', at: 'RAK', country: 'MA', airportDays: [1, 1], work: ['humanitarian', 'medical'],
    title: 'Earthquake in the High Atlas',
    body: "A strong earthquake south of Marrakesh has flattened mountain villages. Rescue teams and field hospitals are flying in through Marrakesh.",
  },
  // ---------- airline failures (an airline client or a rival is picked at run time when listed) ----------
  {
    id: 'failAirMoldova', kind: 'airlineFailure', at: 'KIV', country: 'MD', entity: 'Air Moldova', work: ['repatriation', 'acmi'],
    title: 'Air Moldova stops flying',
    body: "Air Moldova has suspended all flights and filed for insolvency. Passengers are stranded across Europe; airlines in the region want aircraft to take over its routes.",
    shock: { seg: 'narrow', delta: 0.08, text: "Air Moldova's failure" },
  },
  {
    id: 'failTarom', kind: 'airlineFailure', at: 'OTP', country: 'RO', entity: 'TAROM', work: ['acmi'],
    title: 'TAROM grounds its fleet',
    body: "TAROM has grounded its fleet after the state stopped its rescue aid. Its summer flying is up for grabs, and airlines want wet-leased aircraft fast.",
    shock: { seg: 'narrow', delta: 0.08, text: "TAROM's grounding" },
  },
  {
    id: 'failRival', kind: 'airlineFailure', at: 'VNO', country: 'LT', entity: '{rival}', work: ['acmi', 'aogCover'],
    title: '{rival} ceases operations',
    body: "{rival} has handed back its air operator certificate after its lessors took back their aircraft. Its clients need cover now, and its crews are looking for work.",
    shock: { seg: 'all', delta: 0.08, text: '{rival} ceasing operations' },
  },
  // ---------- wars ----------
  {
    id: 'warSudan', kind: 'war', at: 'PZU', country: 'SD', zoneId: 'sudan', closeP: 0.5, warRisk: 3, work: ['evacuation'],
    title: 'Fighting reaches Khartoum: Sudan closes its airspace', reopen: "Sudan's airspace has reopened",
    body: "Heavy fighting has spread from Khartoum. Sudan's airspace is closed to overflights until at least {until}; foreign ministries are evacuating through Port Sudan to Jeddah.",
    open: { title: "Fighting reaches Khartoum: insurers pull cover for Sudan", body: "Heavy fighting has spread from Khartoum. Sudan's airspace stays open, but war-risk insurers list the whole country until at least {until}; foreign ministries are evacuating through Port Sudan to Jeddah." },
  },
  {
    id: 'warLebanon', kind: 'war', at: 'BEY', country: 'LB', zoneId: 'levant', closeP: 0.3, warRisk: 3, work: ['evacuation'],
    title: 'Israel–Lebanon escalation: Lebanese airspace closes', reopen: 'Beirut and Tel Aviv airspace has reopened',
    body: "Strikes and rocket fire across the border: Lebanon's airspace is closed until at least {until} and war-risk insurers have re-priced Beirut and Tel Aviv. Foreign ministries want their citizens out via Larnaca.",
    open: { title: 'Israel–Lebanon escalation: insurers re-price Beirut', body: "Strikes and rocket fire across the border: war-risk insurers have re-priced Beirut and Tel Aviv until at least {until}. Foreign ministries want their citizens out via Larnaca." },
  },
  {
    id: 'warRedSea', kind: 'war', at: 'ADE', country: 'YE', zoneId: 'yemen', closeP: 1, warRisk: 3, work: [], fuel: [0.12, 0.25],
    title: 'Red Sea strikes: carriers avoid Yemeni airspace', reopen: 'Yemeni airspace is open again',
    body: "Missile strikes around the southern Red Sea: airlines are avoiding Yemeni airspace until at least {until} and jet fuel has jumped.",
  },
  {
    id: 'warLibya', kind: 'war', at: 'MJI', country: 'LY', zoneId: 'libya', closeP: 0.5, warRisk: 3, work: ['evacuation'],
    title: 'Clashes in Tripoli close Mitiga', reopen: 'Libyan airspace has reopened',
    body: "Militias are fighting around Mitiga airport. Libya's airspace is closed until at least {until}; Malta is the staging point for evacuations.",
    open: { title: "Clashes around Mitiga: insurers list Libya", body: "Militias are fighting near Mitiga airport. Libya's airspace stays open, but insurers list it as a war zone until at least {until}; Malta is the staging point for evacuations." },
  },
  {
    id: 'warIraq', kind: 'war', at: 'EBL', country: 'IQ', zoneId: 'iraq', closeP: 0.5, warRisk: 2, work: ['evacuation'], fuel: [0.08, 0.15],
    title: 'Drone strikes on Erbil: Iraq closes its airspace', reopen: 'Iraqi airspace has reopened',
    body: "Drone and missile strikes around Erbil: Iraqi airspace is closed until at least {until}. Oil companies and ministries want staff out through Amman.",
    open: { title: 'Drone strikes on Erbil', body: "Drone and missile strikes around Erbil: Iraqi airspace may close at short notice until at least {until}. Oil companies and ministries want staff out through Amman." },
  },
  // ---------- unrest ----------
  {
    id: 'unrestHaiti', kind: 'unrest', at: 'PAP', country: 'HT', zoneId: 'haiti', closeP: 0.7, warRisk: 1, work: ['evacuation'],
    title: 'Gang violence closes Port-au-Prince airport', reopen: 'Port-au-Prince airport has reopened',
    body: "Gunfire near Toussaint Louverture has closed the airport until at least {until}. Embassies are moving their staff to Santo Domingo.",
    open: { title: "Gang violence around Port-au-Prince airport", body: "Gunfire near Toussaint Louverture: the airport stays open under armed guard until at least {until}, and embassies are moving their staff to Santo Domingo." },
  },
  {
    id: 'unrestEthiopia', kind: 'unrest', at: 'ADD', country: 'ET', zoneId: 'ethiopia', warRisk: 1, work: ['repatriation'],
    title: 'State of emergency in Ethiopia',
    body: "A state of emergency has been declared after clashes in several regions. Addis Ababa airport stays open, but insurers list Ethiopia as a war-risk area until {until}.",
  },
  {
    id: 'unrestGoma', kind: 'unrest', at: 'GOM', country: 'CD', zoneId: 'eastCongo', closeP: 1, warRisk: 2, work: ['evacuation', 'humanitarian'],
    title: 'Fighting near Goma', reopen: 'Goma airport has reopened',
    body: "Rebel forces are closing in on Goma; the airport is closed until at least {until}. UN agencies want staff out through Kigali and supplies in once it reopens.",
  },
  {
    id: 'unrestMyanmar', kind: 'unrest', at: 'RGN', country: 'MM', zoneId: 'myanmar', warRisk: 1, work: ['repatriation'],
    title: 'Curfew in Yangon',
    body: "Protests and a curfew in Yangon: insurers list Myanmar as a war-risk area until {until} and some foreign ministries advise their citizens to leave.",
  },
  // ---------- airspace ----------
  {
    id: 'airspacePakistan', kind: 'airspace', at: 'ISB', country: 'PK', zoneId: 'pakistan', closeP: 1, work: [],
    title: 'Pakistan closes its airspace after border clashes', reopen: "Pakistan's airspace has reopened",
    body: "After clashes on the border with India, Pakistan has closed its airspace until at least {until}. Flights between Europe and South Asia route around it.",
  },
  {
    id: 'airspaceIran', kind: 'airspace', at: 'IKA', country: 'IR', zoneId: 'iran', closeP: 1, work: [], fuel: [0.1, 0.2],
    title: 'Iran closes its airspace', reopen: "Iran's airspace has reopened",
    body: "Iran has closed its airspace to all traffic until at least {until}. Gulf and Asia flights take long detours, and jet fuel has jumped.",
  },
  {
    id: 'airspaceIraq', kind: 'airspace', at: 'BGW', country: 'IQ', zoneId: 'iraq', closeP: 1, work: [],
    title: 'Iraq closes its airspace after missile launches', reopen: "Iraq's airspace has reopened",
    body: "Iraq has closed its airspace until at least {until} after missile launches across the region. Europe–Gulf flights route over Saudi Arabia.",
  },
  // ---------- engine crisis, recession ----------
  {
    id: 'engineGtf', kind: 'engineCrisis', at: 'BUD', country: 'HU', entity: 'Wizz Air', work: ['acmi', 'aogCover'], coverFor: ['Aegean Airlines', 'LOT Polish Airlines', 'airBaltic'],
    title: 'Pratt & Whitney orders more GTF inspections: 40 A320neos grounded across Wizz Air and IndiGo',
    body: "Another round of engine inspections grounds about 40 A320neo-family aircraft for months. Airlines with neos want wet-leased A320s and 737s, and ACMI rates for narrowbodies are rising.",
    shock: { seg: 'narrow', delta: 0.12, text: 'GTF engine inspections' },
  },
  {
    id: 'recessionEuro', kind: 'recession', at: 'FRA', country: 'DE', work: [],
    title: 'Eurozone slips into recession',
    body: "Two quarters of shrinking output: airlines are cutting capacity and tour operators are cautious. Expect fewer ACMI requests and softer rates for months.",
  },
];

export const TPL_BY_ID: Record<string, WorldEventTpl> = Object.fromEntries(WORLD_EVENT_TPLS.map((t) => [t.id, t]));
