// v0.11 the registry state's flag by the registration: flat flag artwork (country-flag-icons, MIT, 3:2 SVGs), painted
// into the livery like the other markings. Only the registry states the game knows (src/data/countries.ts with a
// registration prefix) are bundled, each as its own small SVG file loaded when a painted aircraft needs it.

/** The bundled flags (ISO code → asset URL). Keep the list in step with the countries that have a registry prefix
 *  (flags.test.ts checks it). */
const URLS = import.meta.glob<string>(
  '/node_modules/country-flag-icons/3x2/{AE,AF,AL,AM,AO,AR,AT,AU,AW,AZ,BD,BE,BG,BH,BO,BR,BS,BW,CA,CD,CF,CH,CI,CK,CL,CN,CO,CR,CU,CV,CY,CZ,DE,DJ,DK,DO,DZ,EC,EE,EG,ES,ET,FI,FJ,FR,GB,GE,GH,GR,GT,GU,GW,HK,HR,HU,ID,IE,IL,IN,IQ,IS,IT,JM,JO,JP,KE,KH,KR,KW,LB,LK,LT,LU,LV,LY,MA,MG,ML,MM,MO,MT,MU,MV,MX,MY,MZ,NA,NC,NG,NL,NO,NP,NZ,OM,PA,PE,PF,PH,PK,PL,PR,PT,PY,QA,RO,RS,RW,SA,SC,SD,SE,SG,SN,SO,SS,ST,SV,TH,TL,TN,TR,TW,TZ,UG,US,UY,VE,VN,WS,ZA,ZM,ZW}.svg',
  { eager: true, query: '?url&no-inline', import: 'default' },
);
const BY_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(URLS).map(([p, u]) => [/([A-Z]{2})\.svg$/.exec(p)![1], u]),
);

/** The flag's asset URL ('' when not bundled). */
export function flagUrl(code: string): string {
  return BY_CODE[code] ?? '';
}

/** The flag codes bundled. */
export function flagCodes(): string[] {
  return Object.keys(BY_CODE).sort();
}

/** Flags drawn square (their official proportion); the rest at 3:2, as the artwork is drawn. */
const SQUARE = new Set(['CH', 'VA']);

/** Width over height of the flag as painted. */
export function flagRatio(code: string): number {
  return SQUARE.has(code) ? 1 : 1.5;
}
