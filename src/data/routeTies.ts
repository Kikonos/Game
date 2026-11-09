// v0.19.2 custom routes: what ties two countries (engine/network/custom.ts builds a market for any city pair from
// these and the airports' own size, business and tourism figures). Data only. [E] estimates from published 2023–25
// traffic, diaspora and migration figures, rounded; they set the scale, the study finds the real number.

/**
 * Travellers a year, both ways and all airports, that family, diaspora, students and the old links bring between
 * two countries (thousands; tourism and plain business are counted apart). A pair missing here falls back on the
 * historic links (ops/commercial.ts LINKS) or on nothing.
 */
const TIE_ROWS = `
PT-BR 1600 PT-AO 330 PT-CV 300 PT-GW 65 PT-ST 55 PT-MZ 65 PT-TL 7 PT-VE 90 PT-MO 15 PT-IN 30 PT-GN 8 PT-SN 20
PT-FR 1300 PT-CH 450 PT-LU 280 PT-GB 500 PT-DE 300 PT-BE 140 PT-NL 70 PT-ES 600 PT-US 300 PT-CA 200 PT-ZA 70
PT-IT 120 PT-IE 30 PT-AD 40 PT-MA 40 PT-UA 30 PT-RO 40 PT-NP 15 PT-CN 25
ES-MX 900 ES-CO 700 ES-VE 450 ES-AR 500 ES-PE 350 ES-EC 400 ES-DO 300 ES-CU 250 ES-BO 150 ES-PY 120 ES-UY 120
ES-CL 200 ES-MA 1400 ES-GQ 40 ES-RO 900 ES-GB 1800 ES-FR 1500 ES-DE 900 ES-IT 800 ES-US 600 ES-SN 80 ES-DZ 300
FR-DZ 2200 FR-MA 2600 FR-TN 1500 FR-SN 450 FR-CI 350 FR-ML 200 FR-CM 250 FR-MG 150 FR-BF 80 FR-GN 120 FR-TG 60
FR-NE 40 FR-GA 80 FR-CD 90 FR-MU 200 FR-RE 1000 FR-GP 900 FR-MQ 900 FR-GF 250 FR-NC 150 FR-PF 120 FR-YT 120
FR-SC 40 FR-DJ 40 FR-VN 120 FR-LB 250 FR-TR 400 FR-US 800 FR-CA 900 FR-BE 900 FR-CH 900 FR-GB 2200 FR-DE 1200
FR-IT 1400
GB-IN 1600 GB-PK 900 GB-BD 350 GB-NG 450 GB-GH 220 GB-JM 250 GB-IE 2500 GB-PL 1500 GB-US 2500 GB-CA 900 GB-AU 900
GB-NZ 250 GB-ZA 500 GB-KE 180 GB-LK 150 GB-HK 400 GB-CY 700 GB-MT 250 GB-RO 700 GB-LT 250 GB-TT 80 GB-BB 120
GB-AE 1200 GB-DE 1500 GB-IT 1500 GB-NL 1300 GB-UG 60 GB-ZW 70
DE-TR 3500 DE-PL 1500 DE-RO 900 DE-IT 1800 DE-GR 900 DE-HR 600 DE-RS 400 DE-RU 0 DE-US 1600 DE-AT 1200 DE-CH 1500
DE-BA 250 DE-KZ 120 DE-ES 900 DE-IR 0 DE-SY 0 DE-AF 0 DE-VN 150 DE-TH 300 DE-CN 400 DE-IN 350 DE-BR 250
NL-SR 350 NL-TR 600 NL-MA 700 NL-ID 250 NL-CW 300 NL-AW 200 NL-BQ 60 NL-SX 80 NL-US 700 NL-GB 1300 NL-PL 400
BE-CD 180 BE-MA 600 BE-TR 300 BE-RW 40 BE-PL 150
IT-AL 900 IT-RO 1100 IT-MA 500 IT-TN 300 IT-EG 250 IT-US 900 IT-BR 300 IT-AR 300 IT-UA 300 IT-PH 150 IT-CN 250
IE-US 1200 IE-PL 400 IE-AU 150 IE-CA 150
CH-IT 900 CH-XK 200 CH-RS 200 CH-TR 250 CH-US 400
PL-US 300 PL-UA 900 PL-NO 300 PL-IE 400
RO-MD 600 RO-US 150
SE-FI 600 SE-NO 900 SE-DK 900 SE-IQ 150 SE-SY 0 SE-TR 200 NO-DK 600 FI-EE 600
GR-CY 900 GR-US 300 GR-AU 200 GR-AL 400
TR-AZ 600 TR-IQ 700 TR-NL 600 TR-US 400 TR-SA 900 TR-GE 400
US-MX 9000 US-CA 12000 US-IN 1500 US-CN 900 US-PH 1300 US-DO 2600 US-JM 900 US-HT 450 US-CO 1500 US-SV 900
US-GT 900 US-VN 600 US-KR 1200 US-JP 1800 US-IL 1400 US-PR 3500 US-BR 900 US-NG 300 US-GH 150 US-CU 500 US-PE 500
US-EC 600 US-TT 300 US-BS 600 US-HN 400 US-ET 120 US-PK 250 US-BD 150 US-AU 700 US-TW 500 US-HK 300 US-AR 300
CA-IN 900 CA-CN 600 CA-PH 400 CA-HK 250 CA-PK 150 CA-MX 900 CA-JM 200 CA-HT 120 CA-LB 120
AE-IN 9000 AE-PK 3500 AE-BD 1200 AE-PH 1500 AE-LK 700 AE-NP 600 AE-EG 1500 AE-GB 1200 AE-SA 2500 AE-KE 200 AE-ET 200
QA-IN 2500 QA-PK 700 QA-NP 700 QA-PH 500 QA-BD 500 QA-EG 400
SA-IN 4500 SA-PK 3500 SA-EG 3500 SA-BD 1200 SA-ID 1500 SA-PH 900 SA-JO 900 SA-SD 0 SA-YE 0 SA-MY 400 SA-NG 200
EG-LY 0 EG-JO 300 MA-SN 120 MA-CI 90 SN-CI 80
ZA-ZW 900 ZA-MZ 700 ZA-LS 300 ZA-BW 400 ZA-NA 300 ZA-ZM 300 ZA-MW 150 ZA-NG 150 ZA-GB 500 ZA-AU 150
NG-GH 600 NG-KE 80 KE-TZ 400 KE-UG 400 ET-KE 150
IN-NP 600 IN-LK 900 IN-BD 1200 IN-MV 400 IN-SG 1500 IN-MY 900 IN-TH 900 IN-AU 700 IN-OM 1500 IN-KW 1200 IN-BH 600
CN-HK 9000 CN-TW 2500 CN-MO 1500 CN-SG 900 CN-TH 1500 CN-JP 2000 CN-KR 2000 CN-MY 900 CN-ID 400 CN-VN 900 CN-AU 900
JP-KR 6000 JP-TW 2500 JP-US 1800 KR-VN 900 KR-PH 400 KR-US 1200
SG-MY 3500 SG-ID 4000 MY-ID 3000 TH-MY 900 PH-SG 400 VN-TW 400
AU-NZ 4000 AU-GB 900 AU-FJ 250 AU-PG 150 NZ-WS 120 NZ-TO 80 NZ-CK 60 NZ-FJ 150
BR-AR 900 BR-US 900 BR-PY 300 BR-JP 120 AR-PY 300 AR-BO 300 AR-CL 600 CL-PE 400 CO-VE 400 CO-PE 300
`;

/** Country pair → travellers a year (both ways). Pure lookup in either order. */
const TIES = new Map<string, number>();
{
  // tokens alternate: 'PT-BR', '1600'
  const parts = TIE_ROWS.trim().split(/\s+/);
  for (let i = 0; i + 1 < parts.length; i += 2) TIES.set(parts[i], Number(parts[i + 1]) * 1000);
}

/** Family, diaspora and old-link travellers a year between two countries (both ways), or undefined when not listed. */
export function tieBetween(a: string, b: string): number | undefined {
  return TIES.get(`${a}-${b}`) ?? TIES.get(`${b}-${a}`);
}

/**
 * Airports where a country's people abroad cluster, by home country (a multiplier on that airport's share of the
 * country's tie): Portuguese New England, New Jersey, Toronto, Geneva, Paris, Johannesburg's Madeirans.
 */
export const TIE_HOTSPOTS: Record<string, Record<string, number>> = {
  PT: { BOS: 5, EWR: 4, PVD: 4, YYZ: 3, GVA: 2.5, ORY: 1.6, JNB: 2.5, CCS: 1.5, FNC: 1, LUX: 1 },
  CV: { BOS: 5, PVD: 5 },
  ES: { MIA: 2.5, EZE: 1.2 },
  FR: { YUL: 3, CMN: 1.5, ALG: 1.5, TUN: 1.2 },
  GB: { JFK: 1.5, YYZ: 1.5, DXB: 1.5 },
  IN: { DXB: 2, LHR: 1.5, EWR: 1.5 },
};

/**
 * Countries no permit or insurer allows now (the reason the builder shows). Venezuela as the catalogue: revoked
 * foreign airlines' permits in November 2025.
 */
export const CLOSED_COUNTRY: Record<string, string> = {
  VE: 'Venezuela revoked foreign airlines’ permits in Nov 2025.',
  RU: 'EU sanctions: no flights to or over Russia.',
  BY: 'EU sanctions: no flights to Belarus.',
  UA: 'Ukrainian airspace is closed by the war.',
  KP: 'No permits for North Korea.',
  IR: 'Sanctions: no permits or insurance for Iran.',
  AF: 'No insurer covers flights to Afghanistan.',
  SY: 'No insurer covers flights to Syria.',
  YE: 'No insurer covers flights to Yemen.',
  LY: 'EU air safety list: no flights to Libya.',
  SD: 'The war in Sudan: airports closed.',
  SS: 'No insurer covers flights to South Sudan.',
  SO: 'No insurer covers flights to Somalia.',
  AQ: 'Antarctica: expedition flights only, never a market.',
};

/** EU single aviation market (and the EEA, Switzerland): open skies and no traffic rights to ask. */
export const EU_OPEN = new Set([
  'PT', 'ES', 'FR', 'DE', 'IT', 'NL', 'BE', 'LU', 'IE', 'AT', 'DK', 'SE', 'FI', 'GR', 'CY', 'MT', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR',
  'SI', 'LV', 'LT', 'EE', 'NO', 'IS', 'CH', 'LI',
  // French, Dutch and Portuguese territories inside the EU market
  'RE', 'GP', 'MQ', 'GF', 'YT',
]);
/** Agreements that open the market almost as wide (ECAA, Euro-Med, EU–US and EU–Canada open skies, the UK's TCA). */
export const EU_NEAR_OPEN = new Set(['GB', 'AL', 'BA', 'ME', 'MK', 'RS', 'XK', 'GE', 'MD', 'MA', 'JO', 'IL', 'US', 'CA', 'QA', 'AM', 'TN']);
/** Hard bilateral regimes: few designations, slots or long waits for a newcomer. */
export const HARD_RIGHTS: Record<string, number> = {
  CN: 0.65, IN: 0.55, JP: 0.45, SA: 0.45, AE: 0.4, KR: 0.4, ID: 0.4, PK: 0.45, BD: 0.4, NG: 0.45, DZ: 0.45, EG: 0.35, TR: 0.3,
  AU: 0.35, NZ: 0.3, AR: 0.3, BR: 0.25, MX: 0.3, CU: 0.5, MM: 0.5, LA: 0.45, TM: 0.6, UZ: 0.45, TJ: 0.5, IQ: 0.55, LB: 0.4, KW: 0.4,
};

/** Coup or closure risk a year, and the share of ticket cash that can get stuck (currency controls). */
export const COUNTRY_RISK: Record<string, { coup?: number; fx?: number }> = {
  GW: { coup: 0.12 }, ML: { coup: 0.12 }, BF: { coup: 0.12 }, NE: { coup: 0.12 }, GN: { coup: 0.08 }, TD: { coup: 0.08 }, CF: { coup: 0.1 },
  HT: { coup: 0.1 }, MM: { coup: 0.08 }, SL: { coup: 0.04 }, CD: { coup: 0.05 }, GA: { coup: 0.05 }, MG: { coup: 0.04 }, BO: { coup: 0.03, fx: 0.1 },
  AO: { fx: 0.3 }, NG: { fx: 0.3 }, EG: { fx: 0.15 }, AR: { fx: 0.2 }, LB: { fx: 0.3 }, ET: { fx: 0.2, coup: 0.03 }, ZW: { fx: 0.4 }, MZ: { coup: 0.02, fx: 0.1 },
  PK: { fx: 0.1, coup: 0.03 }, BD: { fx: 0.1 }, DZ: { fx: 0.15 }, CU: { fx: 0.3 }, ZM: { fx: 0.1 }, MW: { fx: 0.2 }, TN: { fx: 0.05 }, IQ: { coup: 0.05, fx: 0.1 },
};
