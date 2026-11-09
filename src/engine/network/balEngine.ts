// v0.19 scheduled routes: the balance numbers of lane net-engine (UPDATE-0.19.md §C, §E, §F, §I, §J; owner net-engine).
// core/balance.ts spreads them into BAL.v019 with network/balOps.ts. [F] sourced (research-econ/regops), [E] estimate.
// No imports: core/balance.ts reads this file.

export const NET_ENGINE_BAL = {
  /** §C the launch: stage durations (days), costs (USD) and setback odds. */
  launch: {
    study: {
      desk: { days: [12, 16] as [number, number], cost: 15_000, sigma: 0.18, accuracy: 0.35 },
      full: { days: [32, 38] as [number, number], cost: 60_000, sigma: 0.10, accuracy: 0.15 },
      survey: { days: [46, 52] as [number, number], cost: 90_000, sigma: 0.10, accuracy: 0.10 },
    } as Record<'desk' | 'full' | 'survey', { days: [number, number]; cost: number; sigma: number; accuracy: number }>,
    /** A study stays good for this long after it is done (a shelved case can be reopened). */
    validDays: 365,
    /** A card reminds the player of a waiting decision after this many days; slot offers are taken as given after 14. */
    remindDays: 7,
    autoAcceptDays: 14,
    rights: {
      own: { days: [42, 84] as [number, number], cost: 2_000 + 6_000 },
      partner: { days: [28, 56] as [number, number], cost: 5_000 },
      tour: { days: [14, 28] as [number, number], cost: 3_000 },
      /** UAE GCAA (or Malaysia CAAM) seasonal tech-stop permit per stop. */
      techStop: { days: [7, 14] as [number, number], cost: 1_500 },
      delay: { p: 0.25, days: [21, 56] as [number, number] },
      papers: { p: 0.15, days: 14, cost: 4_000 },
      refused: 0.02,
    },
    slots: {
      /** Ad hoc request for this season: an answer in 1–3 weeks. */
      days: [7, 21] as [number, number],
      /** Chance the time offered is 1–3 h from the time asked: normal hours / the 06–10 and 17–21 banks [F 12 %, E 35 %]. */
      offPeak: 0.12, peakBank: 0.35, shift: [60, 180] as [number, number],
    },
    brand: {
      own: { days: [14, 28] as [number, number], cost: 6_700 },
      partner: { days: [14, 42] as [number, number], cost: 5_000, betterFee: 0.2, feeUp: 0.04 },
      tour: { days: [35, 49] as [number, number], cost: 25_000 },
    },
    distribution: { days: [42, 70] as [number, number], cost: 35_000, laterX: 0.5, bspHold: 50_000, bspMonths: 12 },
    /** Sales should open 6–11 months before the first flight; under 12 weeks the first weeks lose demand (§E.5). */
    filing: { idealDays: 200, minDays: 56, shortDays: 84 },
    campaign: { cost: { low: 50_000, normal: 100_000, high: 150_000 } as Record<string, number>, days: [42, 84] as [number, number], rival: 0.3 },
    stations: { days: [21, 56] as [number, number], outstation: 25_000, techStop: 8_000, noCaterer: 0.4, cashFuel: 0.15 },
    familiarisation: { B: 800, C: 3_500 } as Record<string, number>,
    inaugural: 5_000,
  },

  /** UPDATE-0.19 additions 3: the study recommends a timetable (searched for the best fully costed profit at mid demand). */
  study: {
    /** Weekly frequencies tried, and every-N-weeks for a thin market (DIL: every 2–4 weeks). */
    freqs: [1, 2, 3] as number[], thinEvery: [2, 3, 4] as number[],
    /** Local departure times tried for the first out sector (min after midnight). */
    times: [400, 600, 840, 1_320] as number[],
    /** Demand by departure weekday (Mon … Sun): Friday and Saturday best for VFR, Tuesday weakest [E]. */
    dayX: [0.97, 0.91, 0.95, 0.99, 1.06, 1.05, 1.03] as number[],
    /** Departure-time appeal: early morning loses a little, late evening loses more on short sectors [E]. */
    timeX: [[0, 0.93], [360, 1.0], [600, 1.0], [960, 0.98], [1_200, 0.95]] as [number, number][],
    /** Gauges searched: a narrowbody, the mid widebody (767), a big widebody (A330/A340). */
    gauges: { narrow: ['a321neo', 'a321ceo', 'b752'] as string[], mid: ['b763', 'a332'] as string[], big: ['a333', 'a343'] as string[] },
    /** All-economy cabin: the government segment mostly goes elsewhere. */
    allYGovLoss: 0.5,
  },

  /** §E.1–E.3 demand: market size, season, segments, our share. */
  demand: {
    /** The balance lever on every market's size. */
    scale: 1.4,
    /** The VFR season index Jan … Dec [F/E research §2.4]. */
    season: [0.80, 0.60, 0.70, 0.85, 0.70, 0.85, 1.15, 1.20, 0.90, 0.70, 0.80, 1.30] as number[],
    /** The back (northbound) direction: early January and late August/September peaks (students). */
    seasonBack: [1.20, 0.70, 0.70, 0.80, 0.70, 0.80, 0.95, 1.10, 1.15, 0.75, 0.75, 0.95] as number[],
    growth: 0.03,
    /** Logit weights [E]. */
    beta: { fare: 2.0, nonstop: 1.2, freq: 0.35, rep: 0.5, bags: 0.3, mkt: 0.4, hours: 0.08 },
    /** Fare elasticity by segment (bucket choice) and how far each segment moves its date (± days) to fly with us. */
    elasticity: { vfr: 1.2, gov: 0.6, ngo: 0.7, biz: 0.6, students: 1.4, tourism: 1.3, teachers: 0.8 } as Record<string, number>,
    flex: { vfr: 0.5, gov: 0.2, ngo: 0.3, biz: 0.1, students: 0.5, tourism: 0.4, teachers: 0.6 } as Record<string, number>,
    /** Share of each segment that wants business class. */
    wantsJ: { vfr: 0.02, gov: 0.25, ngo: 0.08, biz: 0.30, students: 0, tourism: 0.03, teachers: 0.04 } as Record<string, number>,
    /** Of those, without a J cabin: the share that flies Y with us anyway (the rest goes to a rival). */
    jToY: 0.35,
    /** Rival seats a departure (typical cabin) and how much of what their full flights spill comes to us. */
    rivalSeats: { narrow: 170, wide: 260 }, spill: 0.7, rivalFull: 0.92,
    /** Awareness: the launch campaign lifts it, marketing keeps it, it fades with a 120-day half-life. */
    awareness: { campaign: { low: 0.35, normal: 0.55, high: 0.7 } as Record<string, number>, perMonth: { low: 0.04, normal: 0.08, high: 0.13 } as Record<string, number>, halfLife: 120, start: 0.1 },
    /** §E.5 the launch ramp: share × 0.7 → 1 over 8 weeks (× 0.85 more when sales opened under 12 weeks before). */
    ramp: { from: 0.7, weeks: 8, late: 0.85 },
    /** §E.3 a rival's reaction: fare cut and length. */
    rivalCut: { fare: 0.15, days: [90, 180] as [number, number], freq: 1 },
    /** Monthly drift of rival fares (±). */
    rivalDrift: 0.05,
  },

  /** §E.4 the booking curve, buckets, no-shows, groups. */
  sales: {
    /** Share of final bookings by days out: >180, 180–90, 90–60, 60–30, 30–14, 14–4, 3–0. */
    curve: [0.08, 0.15, 0.15, 0.22, 0.17, 0.13, 0.10] as number[],
    edges: [331, 180, 90, 60, 30, 14, 4, 0] as number[],
    /** Holidays (Dec, Jul, Aug) book 15 points earlier; government books half inside 14 days. */
    peakShift: 0.15, govLate: 0.5,
    buckets: { saver: 0.75, classic: 1.0, flex: 1.5 },
    /** Close Saver when booked LF is this far above the curve, Classic above `classicAhead`; reopen Saver inside 21 days when behind. */
    saverAhead: 0.05, classicAhead: 0.15, reopenDays: 21,
    noShow: 0.05, overbook: 0.03,
    /** A sale: −25 % Saver for 10 days, $5k, at most once a month; a burst of bookings. */
    sale: { cut: 0.25, days: 10, cost: 5_000, burst: 1.35, everyDays: 30 },
    /** Share of ticket cash that comes through agents (BSP, paid on the 15th and the last day) vs paid at once (web, cards). */
    bspShare: 0.55,
    /** Weak pace card: under this share of the curve at 21 days out. */
    weakPace: 0.7, weakDays: 21,
    /** Groups and blocks: offered 30–150 days out, 10–60 seats, fare −10 %, 25 % deposit, unsold released 21 days out. */
    groups: { chance: 0.05, seats: [10, 60] as [number, number], days: [30, 150] as [number, number], fareCut: 0.10, deposit: 0.25, releaseDays: 21, sellThrough: 0.85 },
    /** DIL: 60 % of the seats sold as anchor blocks months ahead. */
    anchors: { share: 0.6, fareCut: 0.08 },
  },

  /** §E.4 fares: the player's level and the tour operator's margin; partner terms (§A). */
  fares: {
    /** The balance lever on every market's fares (the catalogue's are the published ones; ours sell under them). */
    scale: 0.57 as number,
    /**
     * Realised yield against the catalogue's published fares, per market (balance step; absent = 1). Tuned on the
     * business-case projection with a 767-300ER: OXB own brand ~5 % after aircraft and crew time, DIL open sale ~0 %,
     * RAI a hard market (TAP daily), LAD high fares but kwanza risk, the Brazil routes full.
     */
    marketX: { 'LIS-OXB': 1.05, 'LIS-DIL': 1.75, 'LIS-RAI': 1.05, 'LIS-BVC': 1.2, 'LIS-LAD': 0.7, 'LIS-MPM': 1.15, 'LIS-REC': 0.92, 'LIS-FOR': 0.93, 'OPO-RAI': 1.12, 'OPO-OXB': 1.05 } as Record<string, number>,
    /** The business case's average economy bucket (the mix of Saver, Classic and Flex sold). */
    caseBucket: 0.8,
    level: { low: -0.12, market: 0, high: 0.12 } as Record<string, number>,
    /** Demand at each level against Market (fare elasticity around −1.1 on these routes). */
    levelDemand: { low: 1.14, market: 1.0, high: 0.87 } as Record<string, number>,
    tourMargin: 0.08,
    partner: { feeOfRate: 0.8, shareAbove: 0.70, share: 0.5, cargoShare: 0.5 },
  },

  /** §F revenue: cargo, ancillaries, payload. */
  cargo: {
    rate: { general: 1.9, generalNorth: 1.2, mail: 3.0, perishables: 2.4, ngo: 1.6, avi: 3.6 } as Record<string, number>,
    /** Christmas southbound +30 %, a weekly noise of ±25 %. */
    xmas: 0.3, noise: 0.25,
    /** AVI: heated bulk hold only, at most this much on a widebody (narrowbody half). */
    aviMax: 1_200,
    /** Passenger + bags (kg) and structural payload (kg) by body when the type has no figure. */
    /** Passenger + bags (kg): VFR travellers fly with two full bags (the allowance is the selling point). */
    paxKg: 108, payload: { narrow: 20_000, wide: 40_000 },
    /** Structural payload (kg) by type where known [E]. */
    payloadType: { b763: 40_000, b752: 25_000, a332: 45_000, a333: 48_000, a343: 46_000, a321neo: 22_000, a321ceo: 21_000, a320ceo: 18_000, a320neo: 19_000, b738: 19_000, b739: 20_000, b772: 55_000, b77w: 65_000 } as Record<string, number>,
    /** Range: a sector at the range limit keeps this share of payload. Runway: (available ÷ needed)^exp. */
    rangeKeep: 0.7, runwayExp: 1.5,
    /** Cargo left behind: share that waits for the next rotation. */
    waits: 0.5,
    /** OXB ACC3 certification project. */
    certify: { cost: 60_000, days: 180 },
    /** Ancillaries: extra bags on VFR routes (share × price), seats, onboard. */
    bags: { share: 0.35, price: [95, 130] as [number, number] }, seats: { share: 0.08, price: 15 }, onboard: 2.5,
  },

  /** §I route reputation. */
  rep: {
    start: 60, halfLife: 180, avgDays: 30,
    onTime: 0.3, late: -0.5, late3h: -2, cancelDay: -4, deniedPer10: -1, baggage: -1, baggageP: 0.015, recovery: 0.5, consistent: 1, consistentRuns: 8,
    words: [[40, 'Poor'], [55, 'Mixed'], [75, 'Good'], [101, 'Very good']] as [number, string][],
  },

  /** §J the route P&L: aircraft and crew time at cost. */
  pnl: {
    /** Monthly block hours an aircraft's rent and insurance are spread over (route P&L only). */
    utilBH: 250,
    /** Block hours a month a crew member is paid for (salaries per BH). */
    crewBH: 75,
  },
};
