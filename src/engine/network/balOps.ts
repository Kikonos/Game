// v0.19 scheduled routes: the balance numbers of lane net-ops (UPDATE-0.19.md §D, §G, §H; owner net-ops). Written by
// step 0 with the design's numbers; core/balance.ts spreads them into BAL.v019. No imports: core/balance.ts reads it.

export const NET_OPS_BAL = {
  /** §D flights and timetable. */
  ops: {
    /** Route flights are created this many days before departure (they then block the aircraft and get crewed). */
    materialiseDays: 120,
    /** Rotations exist in the route state up to this far ahead (one IATA season filed). */
    horizonDays: 331,
    /** Tech-stop ground time (min): 767 / bigger widebodies. */
    techStop: 60, techStopBig: 75,
    /** A move within ±60 min of the slot held at the route's base is free; more asks for a new slot. */
    slotFreeMin: 60,
    /** 80 % use-it-or-lose-it. */
    slotUse: 0.8,
    /** No aircraft for a rotation: the red card this many days out. */
    noAircraftDays: 10,
  },
  /** §G costs per sector and per month (USD). */
  cost: {
    /** Catering per passenger per sector: ≤5 h, 5–9 h, >9 h. */
    cateringY: [10, 16, 28] as number[], cateringJ: [45, 60, 115] as number[], crewMeal: 18, doubleCatering: 0.3,
    /** Passenger services per boarded passenger (PSS + services + insurance) and the J lounge at the home base. */
    pss: 3, services: 3, insurance: 1.5, lounge: 30,
    /** Distribution: GDS per segment on agency bookings, card fees on direct, agent commission; monthly fixed. */
    gds: 13, agencyShare: 0.55, cardFee: 0.018, commission: 0.035, distributionMonth: 3_000,
    /** Ongoing marketing per route per month by level. */
    marketing: { low: 3_000, normal: 8_000, high: 15_000 } as Record<string, number>,
    /** Station overhead a month: an outstation, a tech stop; per DIL operation (permit team). */
    overhead: 10_000, techStopOverhead: 2_000, perOperation: 12_000, perFlightPermit: 1_500,
    /** Cargo handling per kg at each end. */
    cargoHandling: 0.25,
    /** Narrowbody handling and airport charges × this. */
    narrowX: 0.5,
    /** Tankering burn: share of the extra fuel per block hour. */
    tankerBurn: 0.035,
  },
  /** §H passengers: planned changes (small, by notice), downgrades, denied boarding, EU261 on the day. */
  pax: {
    /** Notice bands (days): ≥14, 7–13, 2–6, <2 → move cost / cancel extra per passenger, re-protection share and price, reputation. */
    change: {
      days: [14, 7, 2, 0] as number[],
      move: [3, 8, 20, 40] as number[],
      cancel: [3, 12, 35, 60] as number[],
      reprotect: [0, 0, 0.3, 0.5] as number[],
      reprotectFare: [0, 0, 350, 450] as number[],
      rep: [0, -0.5, -1, -2] as number[],
      /** Final debug round: a rotation another operator flies for us, cancelled: its fee (share of the price kept) by notice. */
      subCancelFee: [0.1, 0.25, 0.5, 1] as number[],
    },
    /** EU261 Art. 10 downgrade refund by distance (≤1,500 km, ≤3,500 km, more). */
    downgrade: [0.3, 0.5, 0.75] as number[],
    voucher: 100, voucherCost: 0.6, jDent: 0.15, jDentDays: 60, downgradeRep: -2, downgradeLateRep: -1, earlyNoticeDays: 14,
    /** Seats short: volunteers take a voucher; the rest are denied (EU261 + re-protection). */
    volunteers: 0.6, volunteerVoucher: 250,
    /** EU261 compensation (USD, ≈ €250 / €400 / €600) by distance band; halved with re-protection inside 3–4 h. */
    eu261: [290, 465, 700] as number[],
    /** Care: meals per passenger, hotel + transfer per passenger overnight. */
    meals: 25, hotel: 180,
  },
};
