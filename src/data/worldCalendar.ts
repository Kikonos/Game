// v0.8 (UPDATE-0.8.md §2.1, §4.4): the Hajj and the Antarctic season. The Islamic year is about 354.367 days, so
// the Day of Arafah (9 Dhu al-Hijjah) moves about 11 days earlier every year. Anchor: 5 Jun 2025 (9 Dhu al-Hijjah
// 1446). Checked against the published table 2026–2035 within a day (contracts/missions.test.ts).

const DAY = 1440;
const EPOCH = Date.UTC(2000, 0, 1);
const toMin = (ms: number) => Math.round((ms - EPOCH) / 60_000);
const ANCHOR = toMin(Date.UTC(2025, 5, 5));
const ISLAMIC_YEAR = 354.367;
/** Anchor's Hijri year (the Hajj of 1446). */
const ANCHOR_AH = 1446;

export interface HajjDates {
  /** Day of Arafah (00:00 UTC). */
  arafah: number;
  /** Pilgrims flown in: arafah − 32 d … arafah − 4 d. */
  pre: [number, number];
  /** Pilgrims flown home: arafah + 4 d … arafah + 34 d. */
  post: [number, number];
  /** Hijri year ('Hajj 1448'). */
  ah: number;
}

const arafahOf = (k: number) => ANCHOR + Math.round(k * ISLAMIC_YEAR) * DAY;

function datesOf(k: number): HajjDates {
  const arafah = arafahOf(k);
  return { arafah, pre: [arafah - 32 * DAY, arafah - 4 * DAY], post: [arafah + 4 * DAY, arafah + 34 * DAY], ah: ANCHOR_AH + k };
}

const yearOfMin = (t: number) => new Date(EPOCH + t * 60_000).getUTCFullYear();

/** The Hajj whose Day of Arafah falls in `year` (the first one when a year holds two). Pure. */
export function hajjDates(year: number): HajjDates {
  let k = Math.floor(((Date.UTC(year, 0, 1) - Date.UTC(2025, 5, 5)) / 86_400_000) / ISLAMIC_YEAR);
  while (yearOfMin(arafahOf(k)) < year) k++;
  while (yearOfMin(arafahOf(k - 1)) >= year) k--;
  return datesOf(k);
}

/** The next n Hajj seasons whose return phase has not ended at t. Pure. */
export function nextHajj(t: number, n = 3): HajjDates[] {
  let k = Math.floor((t - ANCHOR) / DAY / ISLAMIC_YEAR) - 1;
  while (datesOf(k).post[1] < t) k++;
  return Array.from({ length: n }, (_, i) => datesOf(k + i));
}

/** The Antarctic flying season (1 Nov – 28 Feb) running at t, or the next one. Pure. */
export function antarcticSeason(t: number): [number, number] {
  const d = new Date(EPOCH + t * 60_000);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const startY = m <= 1 ? y - 1 : y;
  return [toMin(Date.UTC(startY, 10, 1)), toMin(Date.UTC(startY + 1, 2, 1))];
}

/** True inside a Hajj phase (either way). Pure. */
export function inHajjPhase(t: number): boolean {
  return nextHajj(t, 1).some((h) => (t >= h.pre[0] && t < h.pre[1]) || (t >= h.post[0] && t < h.post[1]));
}
