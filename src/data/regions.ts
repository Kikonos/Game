export type ContinentId = 'EU' | 'NA' | 'SA' | 'AF' | 'ME' | 'AS' | 'OC';

export interface Continent {
  id: ContinentId;
  name: string;
  color: string;
}

export interface Region {
  id: string;
  name: string;
  continent: ContinentId;
  blurb: string;
}

export const CONTINENTS: Record<ContinentId, Continent> = {
  EU: { id: 'EU', name: 'Europe', color: '#5b8cff' },
  NA: { id: 'NA', name: 'North America', color: '#ff7a59' },
  SA: { id: 'SA', name: 'South America', color: '#3ddc97' },
  AF: { id: 'AF', name: 'Africa', color: '#f5b83d' },
  ME: { id: 'ME', name: 'Middle East', color: '#d77bff' },
  AS: { id: 'AS', name: 'Asia', color: '#ff5d8f' },
  OC: { id: 'OC', name: 'Oceania', color: '#35d0ff' },
};

export const CONTINENT_ORDER: ContinentId[] = ['EU', 'NA', 'SA', 'AF', 'ME', 'AS', 'OC'];

export const REGIONS: Region[] = [
  { id: 'UKI', name: 'UK & Ireland', continent: 'EU', blurb: 'Wealthy, business-heavy markets anchored by London — the most competitive airspace in Europe.' },
  { id: 'WEU', name: 'France & Benelux', continent: 'EU', blurb: 'Paris, Amsterdam and Brussels: dense business corridors with Riviera sunshine on the side.' },
  { id: 'CEU', name: 'Central Europe', continent: 'EU', blurb: 'Germany, Switzerland and Austria. Premium travellers, strong economies, high airport fees.' },
  { id: 'IBE', name: 'Iberia', continent: 'EU', blurb: 'Spain and Portugal: sun-soaked leisure islands and a booming Madrid–Lisbon business axis.' },
  { id: 'MED', name: 'Italy & Greece', continent: 'EU', blurb: 'Rome, Milan and the Greek islands — huge summer peaks, quiet winters.' },
  { id: 'NOR', name: 'Nordics', continent: 'EU', blurb: 'Long distances, wealthy travellers and few roads between cities. Aviation is essential here.' },
  { id: 'EEU', name: 'Eastern Europe', continent: 'EU', blurb: 'Fast-growing economies and price-sensitive travellers. Perfect low-cost territory.' },
  { id: 'USNE', name: 'US Northeast', continent: 'NA', blurb: 'New York, Boston and Washington: the richest shuttle markets on the planet.' },
  { id: 'USSE', name: 'US Southeast', continent: 'NA', blurb: 'Atlanta, Miami and Orlando — the world’s busiest hub and endless Florida sunshine.' },
  { id: 'USC', name: 'US Central', continent: 'NA', blurb: 'Chicago, Dallas, Houston and Denver. Massive hubs at the crossroads of America.' },
  { id: 'USW', name: 'US West', continent: 'NA', blurb: 'California tech money, Las Vegas weekends and the gateway to Hawaii.' },
  { id: 'CAN', name: 'Canada', continent: 'NA', blurb: 'Vast distances between a handful of rich cities. Long thin routes and tough winters.' },
  { id: 'MXC', name: 'Mexico & Caribbean', continent: 'NA', blurb: 'Mexico City’s giant market plus beach paradises from Cancún to Aruba.' },
  { id: 'SAN', name: 'Andes & Central America', continent: 'SA', blurb: 'Mountain capitals where flying beats 20-hour bus rides. Panama is the crossroads.' },
  { id: 'BRA', name: 'Brazil', continent: 'SA', blurb: 'A continent-sized domestic market with São Paulo at its heart.' },
  { id: 'SCO', name: 'Southern Cone', continent: 'SA', blurb: 'Buenos Aires and Santiago, Patagonian adventure and wine country.' },
  { id: 'NAF', name: 'North Africa', continent: 'AF', blurb: 'Cairo’s megacity and Red Sea resorts loved by European holidaymakers.' },
  { id: 'WEA', name: 'West & East Africa', continent: 'AF', blurb: 'Lagos, Nairobi and Addis Ababa — the fastest-growing aviation markets on Earth.' },
  { id: 'SAF', name: 'Southern Africa', continent: 'AF', blurb: 'Johannesburg business, Cape Town glamour and Indian Ocean islands.' },
  { id: 'GULF', name: 'Arabian Gulf', continent: 'ME', blurb: 'Super-connector territory: Dubai and Doha link the whole world within one stop.' },
  { id: 'LEV', name: 'Türkiye & Levant', continent: 'ME', blurb: 'Istanbul bridges continents; Antalya fills with sun-seekers every summer.' },
  { id: 'SAS', name: 'South Asia', continent: 'AS', blurb: 'Over a billion people discovering air travel. Enormous volume, razor-thin fares.' },
  { id: 'SEA', name: 'Southeast Asia', continent: 'AS', blurb: 'Island nations, tourist paradises and Singapore’s world-class hub.' },
  { id: 'CHN', name: 'Greater China', continent: 'AS', blurb: 'The largest domestic aviation market after the USA, plus Hong Kong and Taipei.' },
  { id: 'JKR', name: 'Japan & Korea', continent: 'AS', blurb: 'Tokyo–Sapporo and Seoul–Jeju are among the busiest routes in the world.' },
  { id: 'AUS', name: 'Australia', continent: 'OC', blurb: 'A rich, isolated market where the Sydney–Melbourne “kangaroo shuttle” rules.' },
  { id: 'PAC', name: 'New Zealand & Pacific', continent: 'OC', blurb: 'Island hopping across the world’s biggest ocean. Thin routes, epic scenery.' },
];

export const REGION_BY_ID: Record<string, Region> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));
