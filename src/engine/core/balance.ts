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
  /** Mean new offers per week at reputation 60 (gamma-3 gaps: Poisson-like, steadier); scaled by fleet size and season. */
  offersPerWeek: 3.4,
  /** Share of offers fitted to a real idle window of a fleet aircraft, and of aspirational (bigger-type) jobs. */
  gapFitShare: 0.5,
  aspirationalShare: 0.12,
  brokerCommission: 0.05,
  /** Season-base targetBH = MGH × this range (peak use above MGH earns excess hours). */
  targetOverMgh: [1.08, 1.3] as [number, number],
  /** Client compensation per departure delayed over 3 h / per cancelled leg (narrow, wide). */
  perDelay: [2_500, 6_000] as [number, number],
  perCancelledLeg: [15_000, 40_000] as [number, number],
  /** Charter all-in markup on cost-plus (RESEARCH §4.4). */
  charterMargin: 1.08,
  premium: { peakSummer: 0.15, winter: -0.15, short: 0.25, urgent: 0.35, longTerm: -0.1, oldType: -0.15, vip: 0.35, conflict: 0.6, deportation: 0.4 },
  mgh: { narrow: 200, wide: 250 },
  excessRate: 0.95,
  cycleFee: { narrow: 900, wide: 1800 },
  /** Cancel-by-us scale: [days before start, fraction of value]. */
  cancelScale: [[60, 0.15], [30, 0.35], [14, 0.6], [0, 1]] as [number, number][],
  charterDeposit: 0.3,
  charterBalanceDays: 7,
  /** Counter-offers: client walk-away multiplier range and reply delay (hours). */
  counterFloor: [1.04, 1.18] as [number, number],
  counterReplyHours: [6, 30] as [number, number],

  // ---------- crew & HR (B2) ----------
  /** Monthly gross salary by role (narrowbody / widebody rating), USD, season-averaged. */
  salary: {
    CPT: [9_400, 12_000], FO: [5_300, 7_000], CRP: [4_300, 4_300], PUR: [2_500, 2_900], CC: [1_900, 2_100],
  } as Record<string, [number, number]>,
  /** Employer on-costs on salaries (RESEARCH §5.5: +10–35%; v0.5.1 mid-range, was 0.2). */
  onCosts: 0.25,
  /** Per diem per day away by role (USD; RESEARCH §5.3: CPT €100, FO €70, cabin €50), scaled by policies.perDiemPct. */
  perDiem: { CPT: 108, FO: 76, CRP: 76, PUR: 60, CC: 54 } as Record<string, number>,
  hotelPerNight: { 3: 90, 4: 140, 5: 230 } as Record<number, number>,
  /** Positioning ticket by distance: < 1,500 km, < 4,000 km, beyond. */
  deadheadTicket: [250, 600, 1_300],
  /** Days from order to joining (rated crew), and cost per hire. v0.7.2: cabin crew join in about a week. */
  hireDays: { CPT: 60, FO: 45, CRP: 45, PUR: 7, CC: 7 } as Record<string, number>,
  /** Rated widebody crew come off the market faster (long-haul operators shedding staff), days. */
  hireDaysWide: { CPT: 40, FO: 35, CRP: 35, PUR: 7, CC: 7 } as Record<string, number>,
  hireCost: { pilot: 9_000, cabin: 2_000 },
  /**
   * v0.6 rated pilots on the market per family every 30 days (RESEARCH §5.4: rated captains are scarce). Hires beyond
   * the pool pay an agency / sign-on fee of feePct × annual gross and take daysMult × as long.
   */
  ratedPool: { narrow: { CPT: 3, FO: 5 }, wide: { CPT: 2, FO: 3 }, feePct: 0.2, daysMult: 1.5 },
  typeRating: { pilotDays: 35, pilotCost: 45_000, cabinDays: 7, cabinCost: 3_000 },
  commandUpgrade: { days: 42, cost: 22_000, minHours: 4_000 },
  sccmCourse: { days: 4, cost: 1_500 },
  /** Cross-crew / operator conversion onto a related family (pilots / cabin). */
  conversion: { pilotDays: 14, pilotCost: 12_000, cabinDays: 5, cabinCost: 1_000 },
  startMorale: [58, 76] as [number, number],
  /** Sickness: chance per crew member per month at morale ≥ 60, and days off sick. */
  sickPerMonth: 0.04,
  sickDays: [2, 5] as [number, number],
  /** Sizing (RESEARCH §5.3): productive BH per person-month and reserve factor. */
  pilotBHMonth: 80,
  cabinBHMonth: 85,
  crewReserve: 1.2,
  /** Check-in before a positioning ticket (minutes) and the cap on sets at one deployment. */
  deadheadCheckIn: 60,
  maxSetsOnStation: 10,

  // ---------- operations, maintenance, finance (B3) ----------
  fuelPrice: 750,
  /** Landing, nav and handling per departure on charters (we pay): narrow / wide. */
  airportFees: [3_000, 8_000],
  catering: [600, 2_400],
  /** OCC, CAMO, safety, sales, audits (RESEARCH §4.5: €300–500/BH at 250 BH a month; v0.5.1 nearer the middle, was 110k + 55k). */
  overheadBase: 130_000,
  overheadPerAircraft: 60_000,
  /** Maintenance cost multiplier per year of age above 12. */
  maintAgeFactor: 0.025,
  /** Check cost (narrow, wide). The A-check sits partly inside maintBH (all-in DMC), so it is kept low. */
  checkCost: { A: [25_000, 60_000], C: [1_200_000, 3_500_000] } as Record<'A' | 'C', [number, number]>,
  /** Share of a C-check paid out of maintenance reserves (leased: the lessor reimburses) or the per-BH provision (owned). */
  cReserveCover: 0.5,
  /** AOG chance per departure (one roll, separate from technical delays): base × (1 + age/10) × (1 + 4 × deferred) × outstation 1.5. */
  aogBase: 0.00032,
  delayChance: 0.12,
  /** Operational delay minutes (exponential mean, cap); technical delay chance per departure × age factor, mean minutes.
   *  v0.10.2 0.006 → 0.0035: a 20-year-old aircraft about 1 % of departures (technical dispatch reliability near 98.5–99 %
   *  with its AOGs, as ACMI fleets of old 767s and A320s report; a new one about 99.5 %). */
  delayMean: 25,
  delayCap: 180,
  techDelayChance: 0.0035,
  techDelayMean: 60,
  /** Block time noise (± share) applied at departure (winds). */
  windNoise: 0.04,
  /** Delay messages only from this many minutes. */
  delayMessageMin: 45,
  /** A departure waits this long for re-rostering before the crew-short decision (minutes). */
  crewWaitMin: 120,
  /** AOG downtime (hours, × outstation factor); courier part and AOG team costs; team time factor; decision window (min). */
  aogHours: [12, 72] as [number, number],
  aogOutstation: 1.5,
  courierCost: [2_000, 15_000] as [number, number],
  aogTeamCost: [8_000, 15_000] as [number, number],
  aogTeamFactor: 0.6,
  aogDecisionMin: 120,
  /** Base-programme legs are cancelled rather than held longer than this (minutes); charters always wait. */
  holdMax: 360,
  /** Trips (charters, rotations) run at most this late before recovery cancels a leg (minutes). */
  tripHoldMax: 1440,
  /** Rival price for sub-chartered legs × contract rate (RESEARCH §4.3, §5.7). */
  subcharterFactor: [1.2, 2.0] as [number, number],
  /** A-check calendar limit (days); auto-planning starts at this share used or this many days before due. */
  aCheckDays: 120,
  planAt: 0.85,
  planAheadDays: 14,
  /** A maintenance ferry is planned at least this far ahead, so a crew can position for it (minutes). */
  ferryLeadMin: 540,
  /** Overdue tolerance before grounding; C-check FH limits; notice to drop a base leg for a check (minutes). */
  overdueTolerance: 0.1,
  cCheckFH: { narrow: 7_500, wide: 6_000 },
  maintNotice: 720,
  /** C-check warnings (days before due). */
  cWarnDays: [90, 60, 30],
  /** Solvency: days of negative cash before the rescue offer, investor cash, game-over floor after refusing. */
  rescueDays: 30,
  rescueCash: [2_000_000, 4_000_000] as [number, number],
  bankruptFloor: -2_000_000,
  /** Factoring discount on an overdue invoice. */
  factorDiscount: 0.08,
  /** Client change request chance per active contract per week; extra urgent evacuation offers per day. */
  changeRequestWeekly: 0.5,
  /** Auto-roster margin (min): planned duties may release this late without breaking the next rest or recovery. */
  rosterSlack: 60,
  /** Duties reporting within this many minutes are "on the day": a delay-slipped recovery doesn't unseat the crew. */
  opsWindow: 12 * 60,
  evacuationPerDay: 1 / 45,
  /** Optional decisions only while fewer than this are open, and at most this many a week (more: ops applies the default). */
  maxOpenDecisions: 2,
  maxDecisionsWeek: 3,
  /** Reliability: each revenue leg pulls it toward its outcome (on time 100, late 60, cancelled 0) by this share. */
  reliableStep: 0.01,
  /** Aircraft market: mean new offers per month; lead time (days); offer life (days); lease months. */
  marketPerMonth: 0.8,
  deliveryDays: [30, 90] as [number, number],
  /** Widebody lease delivery (days): ex-airline widebodies are parked and ready. */
  deliveryDaysWide: [30, 60] as [number, number],
  /** Random market offers: widebody weight × this until the guaranteed widebody offer (month 4–6) has come. */
  wideMarketWeight: 0.4,
  marketOfferDays: [14, 30] as [number, number],
  leaseMonths: [36, 96] as [number, number],
  /** Days late a reliable client still pays within (beyond = overdue). */
  graceDays: 3,
  lateInterest: 0.03,

  // ---------- client paint (v0.5.1, ENGINE; LIVERY.md §4) ----------
  paint: {
    /** Per aircraft, USD (narrow, wide) and days in the paint shop. Strip after a full paint = stripFactor × cost, same days. */
    full: { cost: [[150_000, 250_000], [300_000, 500_000]] as [number, number][], days: [[7, 10], [10, 14]] as [number, number][] },
    decals: { cost: [[30_000, 50_000], [50_000, 80_000]] as [number, number][], days: [2, 3] as [number, number] },
    stripFactor: 0.9,
    decalRemoval: { cost: [[8_000, 15_000], [10_000, 20_000]] as [number, number][], days: 1 },
    /** Client share of paint + strip: [share, weight]. Zero share comes with a rate/price bonus. */
    shareFull: [[1, 0.55], [0.5, 0.35], [0, 0.1]] as [number, number][],
    shareDecals: [[1, 0.8], [0, 0.2]] as [number, number][],
    zeroShareBonus: 0.04,
    /** Optional paint declined: rate cut; required paint countered away: the client's cut if it stays. */
    declineOptional: [0.02, 0.05] as [number, number],
    declineRequired: [0.05, 0.08] as [number, number],
    walkAway: 0.5,
    /** Request chances (§4.1). */
    baseShort: 0.08, baseMid: 0.3, baseMidRequired: 0.6, baseLong: 0.75, baseLongFull: 0.8, baseLongRequired: 0.7,
    /** Share of season-base rolls that become the long 120–240-day variant (lead ≥ 30 d). */
    longBaseShare: 0.12,
    unRotation: 0.25, tourSeries: 0.1, sports: 0.02, adhocCorporate: 0.01,
    /** Paint ends this long before the programme's first departure (minutes); strip booked within this many days. */
    readyBefore: 24 * 60,
    stripWithinDays: 30,
    /** Ferry to the shop over this block time (minutes) is a feasibility warning. */
    longFerryMin: 6 * 60,
  },

  // ---------- crew v0.6 (ENGINE; UPDATE-0.6.md §6) ----------
  /** Bulk type-rating conversion: course days and cost per head, class size, staggering, refunds, pilot bond. */
  conv: {
    pilotDays: 42, pilotCost: { narrow: 38_000, wide: 52_000 }, pilotCcqDays: 14, pilotCcqCost: 15_000,
    cabinDays: 8, cabinCost: 1_800, cabinCcqDays: 3, cabinCcqCost: 600,
    classMax: 20, pilotStaggerDays: 14, cabinParallel: 2, leadDays: 2, maxAheadDays: 120,
    refundFull: 14, bondMonths: 24, bondFactor: 0.3,
    ccq: [['A330/340', 'A350'], ['B777', 'B787']] as [string, string][],
  },
  /** Morale: target and drift, daily drivers, shocks, sickness slope, resignations, service quality. */
  morale: {
    target: 65, targetClamp: [45, 80] as [number, number], revert: 0.03,
    perDiemPerPct: 0.3, perDiemMax: 6, tour: { 4: 3, 5: 0, 6: -5 } as Record<number, number>,
    hotelDay: { 3: -0.4, 4: 0, 5: 0.25 } as Record<number, number>,
    awayDays: [[28, -0.15], [42, -0.3]] as [number, number][], offAway: -0.5, heavy28dH: 150, heavy: -0.2,
    lateChange: -2, lateNoticeH: 72, extraDuty: 0.4, career: 4, recognition: 2, salaryLate: -15,
    /** Sick calls rise below sickFrom (×1 + (sickFrom − m)/sickSlope); resignations interpolate between [morale, ×] points. */
    sickFrom: 65, sickSlope: 50, resignPerMonth: 0.008,
    resignMult: [[80, 0.4], [70, 0.6], [60, 0.9], [50, 1.8], [40, 2.5], [30, 3]] as [number, number][],
    noticeDays: { pilot: 60, cabin: 30 }, whyDecay: 29 / 30,
    /** Service → client satisfaction: relation per settled mean score (×2 VIP-like), its pull on offers and price, monthly decay. */
    service: { moraleW: 0.5, extraPer: 0.2, extraMax: 0.4, relation: 10, reliable: 0.5, relationPremium: 0.0005, relationDecay: 2 },
  },
  /** Extra crew above the legal minimum: cabin cap, paid-option chances and price per extra crew member. */
  crewExtra: {
    cabinMax: 4,
    /** Paid-option chances: long sectors (ad hoc, tour series, troops), VIP, season-base / long wet leases. Sports already require theirs (priced in). */
    paidChanceLong: 0.5, paidChanceVip: 0.6, paidChanceWet: 0.25, paidChanceSports: 0, wetMinDays: 60,
    /** The client pays this per extra cabin crew member per block hour (RESEARCH §4.3), as a rate / price uplift. */
    paidPerBH: 75, longBlockMin: 360,
  },

  // ---------- fleet & ladder v0.7 (ENGINE; UPDATE-0.7.md §6) ----------
  /** Aircraft market (supersedes marketPerMonth / marketOfferDays / wideMarketWeight, kept so older code compiles). */
  market7: {
    perMonth: 1.0, maxOpen: 4, offerDays: [7, 21] as [number, number], teaserWeight: 0.3, newBuildChance: 0.1,
    newBuildLead: [180, 420] as [number, number], newBuildMonths: [96, 144] as [number, number], newBuildRent: [1.0, 1.1] as [number, number],
    newBuildDepositMonths: 3, lessorSiteShare: 0.5, wideAfterFilingDays: 45,
  },
  /** Delivery ferry: acceptance hours after handover, ferry-day limits (block min, sectors), fuel-stop turn, night stop, parking/day [NB, WB], no-pilot warning (h). */
  delivery: {
    acceptH: 36, dayBlockMax: 600, daySectorsMax: 3, fuelStopTurn: 60, nightStop: 14 * 60, parkPerDay: [400, 900] as [number, number], warnH: 48,
    /** v0.11 a crossing we may not ferry (ETOPS): a specialist ferry company (or the seller) flies it under its own
     *  approval: fuel and fees at cost + 15%, a day rate for its crew [NB, WB], permits, and the days to arrange it. */
    ferryCo: { margin: 1.15, dayRate: [6_000, 9_000] as [number, number], permits: 12_000, extraDays: 3 },
  },
  /** Lease end: notice and decision days, return check days and cost [NB, WB], half-life share, repaint factor, extension rent factors. */
  leaseReturn: {
    noticeDays: 120, decisionDays: 14, checkDays: [7, 14] as [number, number], checkCost: [180_000, 450_000] as [number, number],
    halfLifeShare: 0.5, repaintFactor: 0.9, extend: { 12: 0.97, 36: 0.92 } as Record<number, number>,
  },
  /**
   * Cabin refits: hangar slot lead (days); [days, cost] by target layout (narrow / wide). v0.7.4 (RESEARCH.md §13): the
   * type's standard layouts are a QUICK reconfiguration with seats we hold (move rows and the class divider, convertible
   * seats, curtains, re-pitch; the LOPA and weight & balance paperwork): about 48 h and 150–250 man-hours (narrow) /
   * 400–700 (wide) plus the paperwork. VIP is a full retrofit with new premium seats ($60–100k a business seat,
   * monuments, wiring, certification): weeks and millions. Was 5–35 days and $120k–3M for everything.
   */
  refit: {
    /** v0.7.2: 0, a refit starts as soon as the aircraft is free (at home base). */
    leadDays: 0,
    nb: { 'all-economy': [2, 30_000], 'two-class': [2, 40_000], vip: [21, 1_600_000] } as Record<string, [number, number]>,
    wb: { 'all-economy': [2, 80_000], 'two-class': [2, 95_000], 'three-class': [3, 140_000], vip: [28, 4_000_000] } as Record<string, [number, number]>,
  },
  /** v0.7.4 client cabin requests (CabinTerms): chances by archetype and term, required share, client share weights, decline cut, change back. */
  clientCabin: {
    baseLong: 0.3, baseMid: 0.15, lease: 0.2, tourSeries: 0.06, twoClass: 0.65, required: 0.5,
    share: [[1, 0.7], [0.5, 0.3]] as [number, number][], declinePct: [0.02, 0.04] as [number, number], revert: 0.7,
    /** The reconfiguration ends this long before the first departure (minutes); the change back is booked within this many days. */
    readyBefore: 24 * 60, revertWithinDays: 30,
  },
  /** Ladder: days an authority finding adds, max findings, incident memory. v0.10.2 technical dispatch reliability (the
   *  AOG count retired): a revenue departure off more than `lateMin` late or cancelled for a technical reason is a
   *  failure; under `minDeps` departures in the window it is not judged yet; the target per approval in %. The ETOPS
   *  maintenance programme (EASA AMC 20-6: ETOPS additions to the approved maintenance programme and the CAME: CMP
   *  standard, oil and engine monitoring, ETOPS reliability reporting, dual-maintenance limits, engineer training):
   *  consultants, manuals and training about $50–150K, the authority's review 30–60 days. */
  ladder: {
    findingDays: 30, maxFindings: 2, incidentKeepDays: 365,
    tech: { lateMin: 15, minDeps: 30, keepDays: 366, target: { etops120: 97, widebody: 97, etops180: 98, etops240: 98, ulr: 98.5 } as Partial<Record<string, number>> },
    etopsMx: { cost: 90_000, days: 45 },
  },
  /** C4 quiet-week floor: days since the last gap-fit offer, idle-window days, open-offer cap. */
  quietFloor: { days: 5, idleDays: 2, maxOpen: 5 },

  // ---------- crew control v0.7.1 (ENGINE; UPDATE-0.7.1.md §14) ----------
  crewControl: {
    amberH: 48, redH: 12,
    /** Call-in: overtime as a multiple of a day's pay (salary / 21); morale shock. Swap: morale for crew moved at short notice. */
    callInPay: 1.5, callInMorale: -4, swapMorale: -2,
    /** Cancel from Crew Control: reputation per leg (max 3), as the decisions. */
    cancelRep: 3,
    jet: {
      rate: { light: 4_500, midsize: 6_000, heavy: 8_500 } as Record<string, number>,
      seats: { light: 6, midsize: 8, heavy: 13 } as Record<string, number>,
      rangeNm: { light: 1_700, midsize: 2_100, heavy: 4_000 } as Record<string, number>,
      cruiseKt: { light: 400, midsize: 430, heavy: 470 } as Record<string, number>,
      positioningH: 1.0, minH: 2, fees: 2_500, fuelStopMin: 45, fuelStopFee: 1_500, fboLeadMin: 150, checkInMin: 30, taxiMin: 25,
    },
    /** Hurt levels: 'low' below these. */
    hurtLowUsd: 10_000, hurtLowPax: 100,
  },

  // ---------- crew rules & fleet v0.7.2 (ENGINE; UPDATE-0.7.2.md §11) ----------
  v072: {
    /** Cabin crew report this much earlier than the pilots (ORO.FTL.205(c)); their FDP and max FDP both grow by it. */
    ftl: { cabinEarlyMin: { narrow: 0, wide: 15 } },
    /** Sub-charter reliability: base … max per leg, by contract share and company count in windowDays; at most capPerClient per client in capDays. */
    sub: { base: 0.3, max: 1.0, shareFrom: 0.1, shareSpan: 0.233, nFrom: 4, nSpan: 16, capPerClient: 8, capDays: 7, relationPerLeg: 0.5, relationCap: 4, windowDays: 90 },
    /** Cabin crew hires: days to join, days and cost share per extra type. */
    cabinHire: { days: 7, extraTypeDays: 3, extraTypeCost: 0.5 },
    /** Captains in an FO seat: free uses per 30 days, then morale each time. */
    asFo: { freePerMonth: 2, morale: -3 },
    /** Crew rest seats (last economy row): refit days and cost; passengers offloaded when a duty becomes augmented. */
    restSeats: { days: 2, cost: 30_000, offloadPerPax: 350 },
    /** Aircraft sale: days to close, quick-sale discount, broker, a first-year cap (share of the price paid), utilisation norms [narrow, wide], VIP cabin adjustment, C-check life share priced in. */
    sale: { daysMin: 10, daysMax: 20, discount: 0.06, broker: 0.02, firstYearCap: 0.97, fhYear: [3_000, 4_500] as [number, number], cyclesYear: [1_500, 700] as [number, number], vipAdj: -0.08, cLifeShare: 0.5 },
    /** Early lease return: notice, minimum lease left, fee (share of the months left, at least feeMinMonths of rent). */
    earlyReturn: { noticeDays: 30, minLeftDays: 90, feeShare: 0.5, feeMinMonths: 3 },
    /** C-check hubs: the ferry home leaves this long after the check ends (minutes). */
    cHub: { homeAfterMin: 180 },
  },

  // ---------- in-flight rest & EASA v0.7.3 (ENGINE; UPDATE-0.7.3.md §6) ----------
  v073: {
    /** Rest plan: cruise from take-off + tocMin to landing − todMin; pilots awake wakeMin before top of descent; cabin crew rest from take-off + cabinAfterTakeoff to landing − cabinBeforeLanding. */
    rest: { tocMin: 40, todMin: 40, wakeMin: 30, cabinAfterTakeoff: 105, cabinBeforeLanding: 70, maxExtraCabin: 2, tightSpare: 30, roundMin: 5 },
    /**
     * Crew rest refits (est.; re-checked v0.7.4, RESEARCH.md §13): home-base days and cost; C-check add-ons: extra days
     * and cost. v0.7.4: curtained business / economy seats need no refit (curtainJ kept for old bookings); bunks come
     * as a pair: fcrc = the pilots' room + a lower-deck module for the cabin crew (A330/A340), overhead = both overhead
     * compartments (777/787/A350/747).
     */
    restRefit: {
      curtainJ: { days: 1, cost: 15_000 }, reclinersNarrow: { days: 3, cost: 100_000 }, reclinersWide: { days: 4, cost: 220_000 },
      removeRecliners: { days: 2, cost: 30_000 }, ldmcr: { days: 6, cost: 950_000 }, fcrc: { addDays: 12, cost: 2_800_000 }, overhead: { addDays: 14, cost: 2_600_000 },
    },
    /** Planned extension (CS FTL.1.205(b)): per crew member in any 7 days; extra rest after (post-flight option). */
    ext: { perWeek: 2, restAfterMin: 240 },
    /** Split duty (CS FTL.1.220): minutes excluded from the break, minimum net break, hotel from, FDP cap, crew room / day room per crew member. */
    split: { excludeMin: 60, minNet: 180, hotelFrom: 360, cap: 960, lounge: 25, dayRoom: 90 },
    /** Delayed reporting: a change made this long (hours) before the notified report is a re-published roster, not a delay. */
    delayed: { republishH: 18 },
    /** Home standby: from 06:00 local for `hours`, per rating family and role, rostered `aheadDays` ahead; woken `wakeMin` before; crew keep `minDaysOff` free days a month; a duty given up to `noticeMin` before the window counts as a call. */
    standby: { fromLocal: 360, hours: 12, perFamily: { CPT: 1, FO: 1, PUR: 1, CC: 1 } as Record<string, number>, aheadDays: 2, wakeMin: 60, minDaysOff: 8, noticeMin: 12 * 60 },
    /** Wet ACMI rate uplift when the longest chain needs 3 (1) or 4 (2) pilots. */
    augRate: { 1: 0.03, 2: 0.06 } as Record<number, number>,
  },

  // ---------- world v0.8 (ENGINE; UPDATE-0.8.md §11) ----------
  v08: {
    /** Relation moves (§1.3): wet month ≥ 90 % / ≥ 75 % / below on time; completion; favours; our failures; monthly drift for idle clients. */
    rel: {
      wetMonth: [4, 1, -2] as [number, number, number], done: 6, doneAog: 10, doneBad: -5, extraLeg: 4, retime: 3, urgentSign: 3, waiveFee: 4, waiveInterest: 3,
      billFee: -1, decline: -2, cancelLeg: -3, lateLeg: -1, lateCap: -4, driftIdleDays: 120, drift: 1, clientFeeWeekly: 0.03,
      fee: { narrow: [4_000, 12_000] as [number, number], wide: [8_000, 25_000] as [number, number] },
    },
    /** Level thresholds (§1.2): relation, and [relation, jobs]; a level drops only `hysteresis` below its threshold. */
    levels: { unhappy: -15, unhappyBack: -5, knownDown: -25, trusted: [30, 2] as [number, number], partner: [60, 4] as [number, number], hysteresis: 10 },
    /** What each level brings (§1.4): rate, offer weight, length/MGH factors, first refusal, days paid sooner, on-time pay boost, delays forgiven a month, repeat chance. */
    perks: {
      unhappy: { rate: -0.05, offers: 0.3, length: 1, mgh: 0, first: false, payDays: 0, payBoost: 0, forgive: 0, repeat: 0 },
      new: { rate: 0, offers: 1, length: 1, mgh: 0, first: false, payDays: 0, payBoost: 0, forgive: 0, repeat: 0 },
      known: { rate: 0.03, offers: 1.3, length: 1, mgh: 0, first: false, payDays: 0, payBoost: 0, forgive: 0, repeat: 0.3 },
      trusted: { rate: 0.08, offers: 1.7, length: 1.25, mgh: 0.1, first: true, payDays: 3, payBoost: 0.1, forgive: 1, repeat: 0.5 },
      partner: { rate: 0.15, offers: 2.2, length: 1.5, mgh: 0.15, first: true, payDays: 5, payBoost: 0.2, forgive: 3, repeat: 0.8 },
    },
    /** First refusal: extra hours on the offer; chance a lapsed one still goes to a rival. */
    firstRefusalH: 48, firstRefusalLost: 0.3,
    /** Company standing (§1.6). */
    standing: {
      est: { done: 3, days: 120, reliable: 55 }, resp: { done: 10, days: 365, reliable: 70, clean: 50 }, respDown: { reliable: 60, clean: 40 },
      newcomerRate: -0.08, respectedRate: 0.04, newcomerBaseDays: [30, 45] as [number, number], newcomerMgh: [160, 200] as [number, number],
      oddHours: 0.4, demandingDelay: 1.5, demandingPay: 1.5, respectedBaseDays: 210,
      /** v0.8 fix pack: a Newcomer without a widebody (fleet, held or pending): the odds of a job it can never fly (widebody, missing approval). */
      newcomerReach: 0.25,
    },
    /** Archetype multipliers (§2; RESEARCH §3). */
    arch: { hajj: [1.2, 1.35] as [number, number], un: 1.1, unLong: -0.1, presidential: 1.75, deportation: 1.4, evacuation: 2.2, medical: 1.7, music: 1.8, musicIdleBH: 2, antarctic: 2.5, humanitarian: 1.6, capacity: 0.92, subIn: [1.1, 1.6] as [number, number] },
    /** Mission effects: deportation clean per flown leg and cap, morale for its crews, refusal below this morale. */
    deport: { cleanPerLeg: -2, cleanCap: -10, morale: -4, refuseBelow: 45 },
    /** Rival bids (§3.3), sub-charter in (§3.5), quotes (§3.4). */
    rivals: { bidBase: 0.25, bidSlope: 0.5, bidMin: 0.15, bidMax: 0.8, askPerDay: 0.03, quotes: 3, quoteLoadMax: 0.9, bidLoadMax: 0.95, closerKm: 1000, cheaperBelow: 0.97 },
    /** Market cycle (§4). */
    market: {
      target: { boom: 1.15, steady: 1, soft: 0.92, slump: 0.82 } as Record<string, number>, pull: 0.25, noise: 0.02, clamp: [0.75, 1.3] as [number, number], fuelHigh: 900,
      months: { boom: [6, 12], steady: [9, 18], soft: [6, 12], slump: [6, 12] } as Record<string, [number, number]>, offset: 0.05,
    },
    /** World events (§5). */
    world: {
      perDay: 0.07, maxActive: 3, sameKindDays: 20, warRisk: { narrow: [8_000, 20_000, 45_000] as [number, number, number], wideMult: 1.8 }, uninsurable: 0.1, injunction: 0.12, whiteout: 0.12, extend: 0.3,
      weights: { strike: 0.22, disaster: 0.14, war: 0.12, airlineFailure: 0.1, unrest: 0.1, coup: 0.08, ash: 0.08, airspace: 0.08, engineCrisis: 0.04, recession: 0.04 } as Record<string, number>,
      days: { strike: [1, 3], ash: [1, 4], coup: [5, 14], war: [10, 40], unrest: [3, 10], disaster: [7, 21], airspace: [7, 30], airlineFailure: [60, 60], engineCrisis: [120, 180], recession: [180, 360] } as Record<string, [number, number]>,
    },
    /** Dry lease out (§6; RESEARCH §4.6). */
    dry: {
      reserves: { narrow: 420, wide: 850 }, fh: { narrow: 230, wide: 330 }, consent: { narrow: 20_000, wide: 40_000 }, late: 0.15, lateDays: [3, 20] as [number, number], holdover: 1.5,
      damage: 0.08, damageCost: [80_000, 600_000] as [number, number], damageDays: [4, 12] as [number, number], lesseeShare: 0.7, inspectionDays: 2, hPerCycle: { narrow: 1.8, wide: 5 },
    },
    /** Mixed crew (§7): the rate falls per client cabin crew member per block hour; offer shares. */
    mixedCrew: { perCabinBH: 75, share: { far: 0.35, eu: 0.1, hajj: 0.5 } },
  },

  // ---------- v0.9 Experience (ENGINE; UPDATE-0.9.md §11) ----------
  v09: {
    heads: {
      // v0.9 fix: RESEARCH §5.5 levels (a crew planner €2.5k; duty managers and analysts about twice that) + 25 % on-costs.
      salary: { opsControl: 7_000, maintPlanner: 5_500, crewDesk: 6_500, analyst: 5_500, credit: 4_000, fleetPlanner: 6_500, watch: 3_500 } as Record<string, number>,
      /** Candidate tiers: [skill min, skill max, salary ×] junior, mid, senior. */
      tiers: [[0.55, 0.65, 0.7], [0.7, 0.8, 1], [0.85, 0.92, 1.45]] as [number, number, number][],
      growth: 0.02, growthDays: 90, cap: 0.95, mistake: 0.35,
      /** v0.9 round 4: the agreed plain counts (achievements.ts reads them); the watch desk at Reliable 90 held 30 days (§5.7 pacing). */
      unlock: { legalSectors: 25, cover: 0.98, coverMonths: 2, contracts: 5, reliable: 90, reliableDays: 30 },
      ops: { maxDelayMin: 120 }, maint: { aAt: 0.75, aDays: 14, outstation: 0.2, cDays: 120 }, desk: { fixMax: 8_000 },
      credit: { remind: [3, 10] as [number, number], base: 0.15, perSkill: 0.25, deposit: 0.3, govDeposit: 0.2, slow: 0.8 },
      /** Fleet planner: a positioning the day before when the same-day crew FDP margin is under marginMin (min), arriving arriveBeforeMin before the leg. */
      fleet: { idleH: 48, freeH: 72, marginMin: 60, arriveBeforeMin: 720 }, proposalH: 72, severanceMonths: 1, rehireDays: 30,
      /** v0.9 round 4: a dismissed proposal stays away this long; the analyst's estimate counts as a mistake from this relative error. */
      dismissDays: 14, analystErr: 0.05,
    },
    slip: { maxPerSector: 1, roomNights: 1 },
    jumbo: { pax: [420, 480] as [number, number], share: 0.2, shareIdle: 0.6, capShare: 0.12, capShareIdle: 0.25 },
    offerLapseH: 6, delayPenaltyMin: 60, holdCancelRiskH: 6,
    /**
     * §R roster planning like an EASA operator (crew/dayPlan.ts; EASA-FTL.md §16). Days off: a month's legal floor, the
     * planner's floor, target and cap, a year's floor, block lengths, due/must after work days in a row, the morning
     * kept free after a day off (min). Leave: days a year by quarter, the share of a family-and-role group away at once,
     * service before a hire's first leave. Windows are base/station-local minutes; shares count towards ORO.FTL.210.
     */
    roster: {
      publishDays: 14,
      off: { legalMonth: 7, minMonth: 8, targetMonth: 9, maxMonth: 10, yearMin: 96, block: [2, 3] as [number, number], dueAfter: 5, mustAfter: 6, morningFree: 360 },
      leave: { days: 28, quarters: [10, 4, 4, 10] as number[], maxShare: 0.1, afterServiceDays: 90 },
      home: { early: [300, 1020] as [number, number], late: [720, 1440] as [number, number], maxH: 16, minH: 4, readyMin: 90 },
      hotel: { from: 360, to: 1080, readyMin: 45 },
      // Round 4: the wave counted station-wide over every family until 12:00 (minWave 3 per family never occurred in a year).
      // Round 5: the wave counted from 03:00 (a base's 04:00 bank never formed one from 05:00).
      airport: { minWave: 2, waveFrom: 180, waveEnd: 720, leadMin: 90, hours: 4, readyMin: 20, per: { CPT: 1, FO: 1, CC: 1 } as Record<string, number> },
      /** Round 5: standby that reaches the station's first report of the day (a report before the default window + response time). */
      earlyCover: { slackMin: 15 },
      reserve: { noticeMin: 600, quiet: [1320, 360] as [number, number], tightShare: 0.95 },
      share: { home: 0.25, hotel: 0.25, airport: 1, reserve: 0 } as Record<string, number>,
      morale: { runFrom: 4, runDay: -0.2, above: 9, aboveEach: 0.5, aboveMax: 1.5, below: 8, belowEach: -1.5, broken: -6 },
      /**
       * v0.9 round 3: crew control asks a crew member to swap a published day off for short-notice work nobody else
       * can take (the day moves inside its month, the count is kept): morale −3, only with morale ≥ 50, at most once
       * in 14 days a person, never for a day off starting within 12 h, and only for work reporting within 72 h (further
       * out the roster may still find someone without a change).
       */
      swap: { morale: -3, minMorale: 50, everyDays: 14, noticeH: 12, horizonH: 72 },
    },
  },
} as const;
