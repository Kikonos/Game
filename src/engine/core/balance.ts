// Balance defaults (DESIGN.md §8). USD. Each block is owned by the builder named in its comment;
// tune values there, keep keys stable (the UI reads some of them).

export const BAL = {
  // ---------- start (architect) ----------
  startCash: 3_000_000,
  startReputation: { reliable: 60, clean: 70 },
  crewSetsPerAircraft: 5,
  /** Rolling horizons: flights for base patterns, published rosters. */
  scheduleHorizonDays: 28,
  rosterHorizonDays: 14,

  // ---------- commercial (B1) ----------
  /** Mean new offers per week at reputation 60 (Poisson); scaled by fleet size and season. */
  offersPerWeek: 4,
  brokerCommission: 0.05,
  premium: { peakSummer: 0.15, winter: -0.15, short: 0.25, urgent: 0.35, longTerm: -0.1, oldType: -0.15, vip: 0.35, conflict: 0.6, deportation: 0.4 },
  mgh: { narrow: 200, wide: 250 },
  excessRate: 0.95,
  cycleFee: { narrow: 900, wide: 1800 },
  /** Cancel-by-us scale: [days before start, fraction of value]. */
  cancelScale: [[60, 0.15], [30, 0.35], [14, 0.6], [0, 1]] as [number, number][],
  charterDeposit: 0.3,
  charterBalanceDays: 7,
  /** All-in charter price ≈ ACMI-equivalent hours × rate × this (fuel, fees, hotels, margin). */
  charterMarkup: 2.2,
  /** Counter-offers: client walk-away multiplier range and reply delay (hours). */
  counterFloor: [1.04, 1.18] as [number, number],
  counterReplyHours: [6, 30] as [number, number],

  // ---------- crew & HR (B2) ----------
  /** Monthly gross salary by role (narrowbody / widebody rating), USD, season-averaged. */
  salary: {
    CPT: [9_400, 12_000], FO: [5_300, 7_000], CRP: [4_300, 4_300], CSD: [2_600, 3_000], SCC: [2_300, 2_600], CC: [1_900, 2_100],
  } as Record<string, [number, number]>,
  /** Employer on-costs on salaries. */
  onCosts: 0.2,
  /** Per diem per day away by role (USD; RESEARCH §5.3: CPT €100, FO €70, cabin €50), scaled by policies.perDiemPct. */
  perDiem: { CPT: 108, FO: 76, CRP: 76, CSD: 60, SCC: 54, CC: 54 } as Record<string, number>,
  hotelPerNight: { 3: 90, 4: 140, 5: 230 } as Record<number, number>,
  /** Positioning ticket by distance: < 1,500 km, < 4,000 km, beyond. */
  deadheadTicket: [250, 600, 1_300],
  /** Days from order to joining (rated crew), and cost per hire. */
  hireDays: { CPT: 60, FO: 45, CRP: 45, CSD: 35, SCC: 35, CC: 50 } as Record<string, number>,
  hireCost: { pilot: 9_000, cabin: 2_000 },
  typeRating: { pilotDays: 35, pilotCost: 45_000, cabinDays: 7, cabinCost: 3_000 },
  commandUpgrade: { days: 42, cost: 22_000, minHours: 4_000 },
  sccmCourse: { days: 4, cost: 1_500 },
  startMorale: [58, 76] as [number, number],

  // ---------- operations, maintenance, finance (B3) ----------
  fuelPrice: 750,
  /** Landing, nav and handling per departure on charters (we pay): narrow / wide. */
  airportFees: [3_000, 8_000],
  catering: [600, 2_400],
  overheadBase: 120_000,
  overheadPerAircraft: 80_000,
  /** Maintenance cost multiplier per year of age above 12. */
  maintAgeFactor: 0.025,
  checkCost: { A: [45_000, 110_000], C: [1_200_000, 3_500_000] } as Record<'A' | 'C', [number, number]>,
  /** AOG chance per departure (one roll, separate from technical delays): base × (1 + age/10) × (1 + 4 × deferred) × outstation 1.5. */
  aogBase: 0.00025,
  delayChance: 0.12,
  /** Days late a reliable client still pays within (beyond = overdue). */
  graceDays: 3,
  lateInterest: 0.03,
} as const;
