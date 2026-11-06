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
  /** Charter all-in markup on cost-plus (RESEARCH §4.4). v0.14 1.08 → 1.14: a charter carries the empty legs, the
   *  date risk and the broker's and our sales effort; ad hoc charter quotes carry 10–15 % over the ACMI-plus-costs base. */
  charterMargin: 1.14,
  premium: { peakSummer: 0.15, winter: -0.15, short: 0.25, urgent: 0.35, longTerm: -0.1, oldType: -0.15, vip: 0.35, conflict: 0.6, deportation: 0.4 },
  /**
   * v0.14 widebody MGH 250 → 300 BH a month and widebody wet leases 3–6 months (were 1–3): a long-haul ACMI lease
   * guarantees 300–350 block hours a month (an A330 flies 10–12 BH a day on long sectors) and runs a season, since
   * the client pays to position the aircraft and its crews across the world.
   */
  mgh: { narrow: 200, wide: 300 },
  wideWetDays: [91, 183] as [number, number],
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
  /**
   * Monthly gross salary by role (narrowbody / widebody rating), USD, season-averaged.
   * v0.14 balance (the player, an ex-ACMI flight attendant: "flight attendants earn the same across all aircraft
   * types"): cabin crew and pursers are paid one scale on every type (was PUR 2,500 / 2,900, CC 1,900 / 2,100; now the
   * middle of the two). Widebody pilots: recruiters put the widebody premium at 25–40 %, largest for captains and paid
   * partly through allowances in Europe (aviationcv.com, "Widebody type rating value by region"); European A320
   * captains earn about €9,000–10,500 basic a month and first officers €4,500–6,000 (the same survey), so an ACMI
   * widebody captain earns about €11,500–12,500 and a first officer €6,500–7,000 (+20–30 % on the market's narrowbody
   * pay). Our narrowbody scale sits at the low end of the market, so the widebody scale is set against the market:
   * CPT 12,000 → 13,000 (about €11,300), FO 7,000 → 7,500, a cruise relief pilot (second officer) 4,300 → 5,500 on a
   * widebody (below a widebody FO, above a narrowbody one). B757/767 pilots keep widebody pay while a 767 is in the fleet.
   */
  salary: {
    CPT: [9_400, 13_000], FO: [5_300, 7_500], CRP: [4_300, 5_500], PUR: [2_700, 2_700], CC: [2_000, 2_000],
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
  /**
   * v0.14 insurance (data/acmiTypes insuranceMonth, ops/finance insuranceOf): hull all risks with hull war, a year, on
   * the agreed value up to `tier` and above it, for a small ACMI / charter operator; liability a seat a month.
   */
  insurance: { hull: 0.003, hullAbove: 0.0015, tier: 30_000_000, liabilitySeat: { narrow: 50, wide: 60 } },
  /** Maintenance cost multiplier per year of age above 12. */
  maintAgeFactor: 0.025,
  /**
   * Check cost (narrow, wide). The A-check sits partly inside maintBH (all-in DMC), so it is kept low. C: the gross
   * cost of one C-check averaged over the type's check cycle (light checks and the 6- and 12-year heavy ones);
   * v0.14 the default when a type has no `cCheck` of its own (data/acmiTypes). Was 1.2M / 3.5M: an A320 light C-check
   * costs about $0.3–0.7M and its 6-year heavy check $1.2–2M, about $0.7M a check over the cycle.
   */
  checkCost: { A: [25_000, 60_000], C: [700_000, 2_000_000] } as Record<'A' | 'C', [number, number]>,
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
  /**
   * v0.12.1 an evacuation, a repatriation, a relief or medical flight waits a day longer before recovery or crew control
   * drops it (a ministry would rather its citizens leave late than not at all): its lateness cap and the window in
   * which a delay that gets a legal crew always beats a cancellation (minutes).
   */
  missionHoldExtra: 1440,
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
    // v0.12.1 a pilot CCQ (cross crew qualification onto a common type) takes 10 days (was 14).
    pilotDays: 42, pilotCost: { narrow: 38_000, wide: 52_000 }, pilotCcqDays: 10, pilotCcqCost: 15_000,
    cabinDays: 8, cabinCost: 1_800, cabinCcqDays: 3, cabinCcqCost: 600,
    classMax: 20, pilotStaggerDays: 14, cabinParallel: 2, leadDays: 2, maxAheadDays: 120,
    refundFull: 14, bondMonths: 24, bondFactor: 0.3,
    // v0.12.1 Airbus Mixed Fleet Flying: the A320 family and the A330/340 are common types too (CCQ, both ratings kept).
    ccq: [['A330/340', 'A350'], ['B777', 'B787'], ['A320', 'A330/340']] as [string, string][],
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
    nb: { 'all-economy': [2, 30_000], 'two-class': [2, 40_000] } as Record<string, [number, number]>,
    wb: { 'all-economy': [2, 80_000], 'two-class': [2, 95_000], 'three-class': [3, 140_000] } as Record<string, [number, number]>,
    /**
     * v0.12.1 the VIP cabin (new premium seats) scales with the seats installed (was a flat 21 days / $1.6M narrow,
     * 28 days / $4M wide, whatever the layout). Per seat installed: a narrowbody recliner business seat $25–35K, a
     * widebody lie-flat $70–100K (seat, track and PSU work, wiring, dressing); fixed: engineering, the LOPA, weight and
     * balance and the authority's approval (about $120K narrow, $300K wide); days: 5 + 1 per 6 seats narrow, 10 + 1 per
     * 4 wide. Taking them out again is a quick reconfiguration (the table above). RESEARCH.md §13.
     */
    premium: {
      nb: { seat: 30_000, engineering: 120_000, baseDays: 5, seatsPerDay: 6 },
      wb: { seat: 85_000, engineering: 300_000, baseDays: 10, seatsPerDay: 4 },
    },
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
    // v0.14 Widebody operations at 95 % (was 97: the player's call; the ETOPS levels keep 97–98.5 %).
    tech: { lateMin: 15, minDeps: 30, keepDays: 366, target: { etops120: 97, widebody: 95, etops180: 98, etops240: 98, ulr: 98.5 } as Partial<Record<string, number>> },
    etopsMx: { cost: 90_000, days: 45 },
    /** v0.12.1 legs that need an approval we won't hold by their departure get the card this many days ahead; red inside redH hours. */
    gateWarnDays: 14, gateRedH: 48,
  },
  /** C4 quiet-week floor: days since the last gap-fit offer, idle-window days, open-offer cap. v0.14 (far fewer
   *  offers): days since the last ordinary market offer, 5 → 8; open offers 5 → 3. */
  // v0.16 about half the inbound work (the rest is chased: brokers, pitches, leads): 8 → 12 days; the floor tops up a longer dry spell only.
  // v0.16 balance: tried 10 (seeds 1–5 moved −9…+4 points each way: chaotic divergence, not the floor); kept at 12.
  quietFloor: { days: 12, idleDays: 2, maxOpen: 3 },
  /**
   * v0.14 market offers (the player: "way less contracts, especially in the beginning"). Ordinary offers a week by
   * standing (Newcomer, Established, Respected) for a fleet of `fleetRef` aircraft; each aircraft more or fewer moves
   * it by `fleetSlope` (clamped to `fleetClamp`). They come only on busy days (director.ts QUIET_MARKET_OFFERS).
   * Tenders, phone calls, world-event and crisis jobs, trip leads and repeat business come on top.
   * `unfitDrop`: the share of drafts no aircraft of ours could fly that is drawn again (fit the fleet better).
   */
  marketOffers: {
    // v0.14.1 a Newcomer 1.1 (was 1.5: with the spring season and the quiet-week floor it measured 1.8–2.3 a week, over the
    // promised 1–2).
    // v0.16 inbound cut about in half (1.1 / 3.1 / 4.6 → 0.55 / 1.6 / 2.3): brokers, pitches, leads and sales managers
    // bring the rest (UPDATE-0.16.md §C.1).
    perWeek: [0.55, 1.6, 2.3] as [number, number, number], fleetRef: [2, 3, 5] as [number, number, number], fleetSlope: 0.06, fleetClamp: [0.85, 1.3] as [number, number], unfitDrop: 0.85,
    /** Fewer offers, longer work (the player's call: lean on longer jobs, not more offers): the ordinary draw's mix,
     *  its narrowbody season bases (Newcomer, others) in days, and its share fitted to an aircraft's idle window
     *  (BAL.gapFitShare for the rest). */
    mix: { seasonBase: 1.5, tourSeries: 1.2, troopRotation: 1.1 } as Partial<Record<string, number>>,
    baseDays: [[45, 90], [50, 120]] as [number, number][],
    gapFitShare: 0.7,
    /** Fewer offers, better paid (the player's call: lean on rates, not more offers): an ordinary offer's rate or price. */
    ratePct: 0.04,
  },

  // ---------- crew control v0.7.1 (ENGINE; UPDATE-0.7.1.md §14) ----------
  crewControl: {
    amberH: 48, redH: 12,
    /**
     * Crew-planning round: the early heads-up: a trip inside this many hours (beyond amberH) that the roster cannot
     * crew (no legal crew member for a seat after its own re-plan) is announced once, as soon as that is known.
     */
    earlyH: 10 * 24,
    /** Call-in: overtime as a multiple of a day's pay (salary / 21); morale shock. Swap: morale for crew moved at short notice. */
    callInPay: 1.5, callInMorale: -4, swapMorale: -2,
    /** Cancel from Crew Control: reputation per leg (max 3), as the decisions. */
    cancelRep: 3,
    /**
     * Crew-planning round (private jets, est. 2026 charter market): per flight hour by class (light: CJ3+ / Phenom 300E;
     * midsize: super-midsize Praetor 500 / Challenger 350 / Longitude; heavy: Challenger 650 / Falcon 2000LXS / Legacy
     * 650E; long: Global 6000 / G650 / Falcon 8X), seats with crew bags, range with reserves, cruise. The jet comes from
     * the nearest business-aviation base (`JET_BASES`): callout fboLeadMin (2 h) or its positioning + 1 h, whichever
     * is later; the empty legs there and back are billed at the hourly rate (posShare). Was v0.7.1: a flat 2:30
     * callout, 1 h of positioning, midsize 2,100 nm / heavy 4,000 nm at 430 / 470 kt and no long-range class.
     */
    jet: {
      rate: { light: 5_000, midsize: 7_500, heavy: 10_000, long: 13_000 } as Record<string, number>,
      seats: { light: 6, midsize: 8, heavy: 12, long: 13 } as Record<string, number>,
      rangeNm: { light: 1_800, midsize: 3_000, heavy: 4_000, long: 6_000 } as Record<string, number>,
      cruiseKt: { light: 420, midsize: 460, heavy: 470, long: 485 } as Record<string, number>,
      posShare: 1, minH: 2, fees: 2_500, fuelStopMin: 45, fuelStopFee: 1_500, fboLeadMin: 120, posLeadMin: 60, checkInMin: 30, taxiMin: 25,
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
      newcomerRate: -0.08, respectedRate: 0.04, newcomerBaseDays: [30, 45] as [number, number], newcomerMgh: [160, 300] as [number, number],
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
      /**
       * v0.12.1 a day off bought back (crew/buyBack.ts): worked for twice a day's pay (salary / 21; Portuguese and most
       * EU cabin and flight crew agreements pay a worked day off at 200 %), the day repaid on a free day of the month;
       * only for work reporting within 72 h, at most once a month a person, never from crew whose morale is under 35.
       */
      buyBack: { pay: 2, horizonH: 72, minMorale: 35 },
    },
  },

  // ---------- v0.16 Finance & Sales (UPDATE-0.16.md). Each lane tunes its own sub-block only. ----------
  v016: {
    /** §A finance (lane finance; engine/finance). Rates are a year. */
    finance: {
      /** The bank's benchmark (EURIBOR / SOFR-like) and its move by market phase. */
      benchmark: 0.04, benchmarkByPhase: { boom: 0.0075, steady: 0, soft: -0.005, slump: -0.01 } as Record<string, number>,
      credit: {
        /** Limit = revenueMonths × average monthly revenue (last `revenueWindow` closed months, at least `minStatements`) + bookShare × owned book value; rounded, clamped; a Newcomer's cap. */
        revenueMonths: 1.5, revenueWindow: 6, minStatements: 2, bookShare: 0.1, roundTo: 100_000, limit: [500_000, 20_000_000] as [number, number], newcomerCap: 1_000_000,
        /** Margin over the benchmark by standing (Newcomer, Established, Respected); the step-up after a second breach. */
        margin: [0.04, 0.03, 0.025] as [number, number, number], stepUp: 0.02,
        commitmentFee: 0.005, arrangementFee: 0.005, arrangementMin: 10_000, drawStep: 50_000,
        /** Covenants: liquidity (cash + undrawn ≥ liquidityMonths × next month's bill), leverage (net debt ≤ × EBITDA of the last 12 months); waiver fee (share of the limit); cure days; freeze after this many consecutive breaches, repaid in `repayParts` month ends; margin back after `cleanMonths`. */
        liquidityMonths: 1, leverage: 3.5, waiverFee: 0.0025, cureDays: 30, freezeAfter: 3, repayParts: 3, cleanMonths: 3,
      },
      loan: {
        ltv: 0.6, minLoan: 1_000_000, terms: [3, 5, 7] as number[], maxAgeAtEnd: 25, margin: 0.035, arrangementFee: 0.01,
        /** Early repayment fee: share of the balance, and after half the term. */
        earlyFee: 0.02, earlyFeeLate: 0.01, lateFee: 0.01, callAfterMissed: 2, callDays: 60,
        /** The loanDue card: amber this many days before the 1st when the forecast is short; red inside this many hours. */
        warnDays: 7, redH: 48,
      },
      leaseback: {
        lessors: ['AerCap', 'Avolon', 'SMBC Aviation Capital', 'Air Lease Corporation', 'BOC Aviation', 'Carlyle Aviation Partners'] as string[],
        /** Price as a share of market value (Respected / Established, Newcomer); terms (years); the aircraft's age at lease end. */
        priceShare: 0.97, priceShareNewcomer: 0.94, roundTo: 10_000, terms: [3, 5, 6, 8] as number[], maxAgeAtEnd: 25,
        /** Lease rate factor a month: base + perAgeYear × (age − ageFrom), clamped. */
        lrf: { base: 0.0075, perAgeYear: 0.0004, ageFrom: 5, clamp: [0.0075, 0.011] as [number, number] }, depositMonths: 2,
      },
      factoring: {
        minAmount: 20_000, maxDaysToDue: 90, maxOverdueDays: 30, totalCap: 5_000_000,
        /** Advance share with and without recourse; fee = base + perDay × days to due (overdue: overdueBase + overduePerDay × days overdue); without recourse + nonRecourse (+ government for a ministry); clamped. */
        advance: 0.95, advanceNonRecourse: 0.92, feeBase: 0.01, feePerDay: 0.0004, overdueBase: 0.03, overduePerDay: 0.001, nonRecourse: 0.015, government: 0.03, feeClamp: [0.01, 0.08] as [number, number],
        /** Recourse: bought back this many days past due; the card from. */
        buyBackDays: 90, warnDays: 60,
      },
      deposit: {
        /** Deposit norm by client kind (share of the price); a level 3–4 client's norm is `prestigeLess` lower; the choices offered. */
        norm: { tourOperator: 0.2, airline: 0.2, sports: 0.3, music: 0.4, corporate: 0.1, agency: 0.2, government: 0, broker: 0.2, operator: 0.2 } as Record<string, number>,
        prestigeLess: 0.1, choices: [0, 0.1, 0.2, 0.3, 0.4, 0.5] as number[],
        /** Per 10 points above the norm: acceptance chance (points), the chance a plain accept is signed at the norm; per 10 below: acceptance, the floor eased. */
        abovePer10: -0.06, aboveSignAtNorm: 0.25, belowPer10: 0.04, belowFloorPer10: 0.005,
      },
      /** Money market: cash above the float earns benchmark − spread (at least `floor`). */
      moneyMarket: { float: 250_000, spread: 0.01, floor: 0.015 },
    },
    /** §B prestige (lane clients; contracts/prestige.ts). */
    prestige: {
      /** Visibility per revenue block hour and per completed contract, by the client's level 1–4; a fair; a tender won. */
      perBH: { 1: 0.25, 2: 0.6, 3: 1.2, 4: 2.0 } as Record<number, number>, perContract: { 1: 10, 2: 20, 3: 40, 4: 70 } as Record<number, number>, fair: 15, tenderWon: 40,
      /** To reach level 2, 3, 4: visibility, contracts done, reliable, clean (level 4), IOSA held (3, 4), months on the AOC. */
      levels: {
        2: { visibility: 800, contracts: 3, reliable: 60, clean: 0, iosa: false, months: 6 },
        3: { visibility: 3_000, contracts: 12, reliable: 70, clean: 0, iosa: true, months: 18 },
        4: { visibility: 8_000, contracts: 30, reliable: 78, clean: 60, iosa: true, months: 36 },
      } as Record<number, { visibility: number; contracts: number; reliable: number; clean: number; iosa: boolean; months: number }>,
      /** The rate part by the client's level; penalties and relation hits × by level. */
      payPct: { 1: -0.04, 2: 0, 3: 0.04, 4: 0.08 } as Record<number, number>, penaltyX: { 1: 0.8, 2: 1, 3: 1.3, 4: 1.6 } as Record<number, number>, relationX: { 1: 1, 2: 1, 3: 1.3, 4: 1.5 } as Record<number, number>,
      /** Offer weight by (client level − our level): −3 … +1; +2 and more never. A stretch offer at most once in `stretchDays`. */
      weight: { '-3': 0.1, '-2': 0.25, '-1': 0.5, '0': 1, '1': 0.1 } as Record<string, number>, stretchDays: 30,
      /** What a level 3 / 4 client checks before it signs: reliable, fleet average age (years), clean (4). */
      reqs: { 3: { reliable: 65, maxAge: 22, clean: 0 }, 4: { reliable: 75, maxAge: 18, clean: 60 } } as Record<number, { reliable: number; maxAge: number; clean: number }>,
      /** Far-flung routes (missions.ts farRoute): the archetype multiplier on top. */
      exoticMult: 1.25,
      /** Older saves: a client level counts as reached with this many completed jobs for a client there (one job: the level below). */
      derivedJobs: 2,
    },
    /** §C sales (lane sales; commercial/sales.ts). */
    sales: {
      brokers: {
        acs: { name: 'Air Charter Service', commission: 0.04 }, chapman: { name: 'Chapman Freeborn', commission: 0.05 }, acc: { name: 'ACC Aviation', commission: 0.035 },
        airPartner: { name: 'Air Partner', commission: 0.045 }, huntPalmer: { name: 'Hunt & Palmer', commission: 0.03 },
      } as Record<string, { name: string; commission: number }>,
      /** Relation: at registration; per deal flown well; per deal we cancelled; monthly drift idle; the floor once registered; the most a visit can take it to (deals go beyond); leads a week at relation 100 (× fit), and the share of that a fresh registration already brings (v0.16 balance: a broker on whose list we are sends requests for our types from day one; 0.35 → 0.5 and the floor, since a year of chasing with three brokers at relation 20–40 brought 9–17 offers, too few to replace the halved inbound). */
      relation: { register: 20, deal: 6, cancelled: -10, drift: -1, floor: 10, onTime: 0.9, visitCap: 50, base: 0.25 }, leadsPerWeek: 0.5,
      /** Leads: days before a lead goes cold; the proposal's answer window (days) and its odds of an offer; worked at once (the desk, per sales manager). */
      lead: { coldDays: 14, replyDays: [2, 7] as [number, number], offerChance: 0.55, workedBase: 3, workedPerRep: 3, warnDays: 3, /** v0.16 balance: the share of leads about the client's likeliest kind of work (the rest ask for its other kinds first). */ firstKind: 0.6 },
      /** Pitches: windows (UTC months, 1–12) for summer and winter cover; max a season per desk; cost; reply days; odds maybe / offer / no; the offer's lead before the season (days). */
      pitch: { summerMonths: [10, 11, 12, 1, 2] as number[], winterMonths: [4, 5, 6, 7, 8] as number[], perSeason: 4, cost: 1_500, replyDays: [14, 42] as [number, number], maybe: 0.4, offer: 0.2, offerLead: [60, 120] as [number, number], relation: 1, /** v0.16 balance: an airline is pitched only when its base is within this × the longest range in our fleet from home. */ reachX: 1.2 },
      /** Sales managers: the cap, candidate tiers (skill, salary × mid), mid salary a month, days to join, severance months, re-hire days; leads a month × skill; presence a day in their market; extra pitches a season. */
      reps: { max: 4, tiers: [[0.6, 0.75], [0.75, 1], [0.9, 1.35]] as [number, number][], salary: 6_000, joinDays: 14, severanceMonths: 1, rehireDays: 30, leadsPerMonth: 1.5, presencePerDay: 0.15, pitches: 2 },
      /** Fairs and tenders: leads a fair yields [min, max]; extra RFPs a round at level 2 / 3+; broker relation for a tender won through one. */
      fairLeads: [1, 3] as [number, number], tenderExtra: { 2: 1, 3: 2 } as Record<number, number>, tenderBroker: 4,
    },
    /** §D filter (lane ops; contracts/filter.ts): archetypes that always ring (humanitarian). */
    filter: { alwaysShow: ['evacuation', 'repatriation', 'humanitarian', 'medical'] as string[] },
    /** §F compliance (lane ops; ops/compliance.ts): candidate tiers (skill, salary × mid), mid salary a month, days to join, severance, re-hire days; effects × skill. */
    compliance: {
      tiers: [[0.6, 0.75], [0.75, 1], [0.9, 1.4]] as [number, number][], salary: 8_500, joinDays: 14, severanceMonths: 1, rehireDays: 30,
      /** Ramp finding mean × (1 − rampCut × skill); the audit's random finding × (1 − auditCut × skill); Level 2 deadlines + days; corrective actions × cost. */
      rampCut: 0.4, auditCut: 0.6, deadlinePlusDays: 30, taskCostX: 0.8, rampTaskCostX: 0.5,
    },
  },

  // ---------- v0.16.3 distress finance (engine/finance/distress.ts) ----------
  v0163: {
    /** The secured facility while cash is below zero: borrowing base = recvShare × eligible receivables (open, not sold, due within recvDays or overdue ≤ recvOverdue) + acShare × the market value of owned aircraft without a loan; rounded; clamped; margin over the bank rate by standing; arrangement fee (min); the liquidity covenant wants this many months' bill; drawn above the base is repaid within one month. */
    secured: {
      recvShare: 0.8, recvDays: 90, recvOverdue: 30, acShare: 0.5, roundTo: 50_000, limit: [250_000, 20_000_000] as [number, number],
      margin: [0.09, 0.08, 0.07] as [number, number, number], arrangementFee: 0.02, arrangementMin: 25_000, liquidityMonths: 1.5,
    },
    /** Lessor rent deferral: months offered; premium on the deferred rent; the lease extension asked (× months deferred); the reliability and clean hits; a default (swept below zero) blocks that lessor for `blockDays`. */
    rent: { months: [2, 3] as number[], premium: 0.1, extendX: 2, reliable: -1, clean: -1, defaultReliable: -2, blockDays: 365 },
    /** Creditor payment plans: the share of the last two months' bills a creditor spreads; months offered; fee a month (min); the smallest plan; outstanding deferrals (plans + rent) at most this × the month-end bill; a plan called after this many misses, with this fee. */
    plan: { share: 0.5, months: [3, 4, 6] as number[], feePerMonth: 0.01, feeMin: 0.03, min: 50_000, maxBillX: 2, callAfterMissed: 2, callFee: 0.02 },
    /** An investor sought: the stake relief against the forced rescue (points), the floor; the reliability and clean hits; quarterly reviews (days); targets: cash ≥ 0 at the review and a 3-month operating margin ≥ marginMin; misses before a forced sale and before the board takes over; released after `metToRelease` reviews met in a row. */
    investor: { stakeLess: 5, stakeMin: 20, reliable: -3, clean: -2, reviewDays: 91, marginMin: 0, forceSaleAt: 2, takeOverAt: 3, metToRelease: 4, names: ['Castlelake', 'Indigo Partners', 'Apollo Global Management', 'Bain Capital', 'Cerberus Capital Management', 'Oaktree Capital'] as string[] },
    /** Furlough: shares and weeks offered; morale hits (furloughed, the rest); the days before it starts. */
    furlough: { shares: [0.25, 0.5] as number[], weeks: [4, 8] as number[], morale: -15, moraleOthers: -4, startDays: 2 },
    /** Salary deferral: the share of crew pay deferred (heads in full), months offered, repaid over `repayMonths` after, morale a month. */
    salary: { share: 0.3, months: [1, 2] as number[], repayMonths: 2, morale: -8 },
    /** Checks stretched: days; the A-check planned when this share of the interval is used (tolerance 1.1); deferred-defects added a month (AOG risk). */
    checks: { days: 90, planAt: 0.97, dueX: 1.07, deferredPerMonth: 0.04 },
    /** Early payment: discount = base + perDay × days to the due date, clamped; the relation hit (asked, refused); the chance a client agrees at relation 0 / 100. */
    prepay: { base: 0.02, perDay: 0.0005, clamp: [0.02, 0.06] as [number, number], relation: -3, refusedRelation: -2, agree: [0.55, 0.95] as [number, number] },
    /** PER restructuring: eligible when cash is below −minBillX × the month-end bill or below zero for `minDays`; plan months; the write-off on unsecured claims (the overdraft, plans, rent arrears, an unsecured drawn line); court and adviser fees (share of claims, min); label months after exit; no new credit (months); reputation hits; relation hit with every client we work for; the share of them that cancel at relation < cancelBelow; a lessor repossesses one aircraft with this chance; the deposit demanded while labelled; the rate part while labelled. */
    per: { minBillX: 1, minDays: 20, months: 6, writeOff: 0.3, fee: 0.015, feeMin: 60_000, labelMonths: 12, noCreditMonths: 12, reliable: -10, clean: -10, relation: -15, cancelChance: 0.3, cancelBelow: 30, repossessChance: 0.5, deposit: 0.3, ratePct: -0.05 },
  },

  // ---------- v0.12.1 world tours (contracts/missions.ts worldTour) ----------
  v0121: {
    /**
     * A round-the-world private-jet tour (Les Voyages de TMR's 51st: 21 days, 20 nights, from €21,900 a guest): a day's
     * chance once we fly a widebody with ETOPS 180 (Established, Respected), offered 90–180 days ahead; the archetype
     * multiplier, block-hour equivalents per day the aircraft is held, catering × (five-star), extra cabin crew [min,
     * max], the business-seat bonus (+pctPerJ per J seat above fromJ, capped) and the guests on board [min, max].
     */
    tour: {
      perDay: { 1: 1 / 365, 2: 2.5 / 365 } as Record<number, number>, lead: [90, 180] as [number, number], expires: [10, 21] as [number, number],
      mult: 1.4, idleBH: 3, catering: 4, extraCabin: [2, 4] as [number, number], bizFromJ: 16, bizPctPerJ: 0.004, bizMax: 0.12, pax: [80, 150] as [number, number],
    },
  },

  // ---------- v0.17 "Aircraft market" (UPDATE-0.17.md §M; engine/leasing). Each lane tunes only its own sub-block. ----------
  v017: {
    /** Master switch: false gives the v0.16 market exactly (bot --market=v16, for comparisons). */
    on: true as boolean,
    supply: { // lane supply
      base: {
        a320ceo: 0.45, b738: 0.45, b739: 0.40, a321ceo: 0.55, a321neo: 0.85, a320neo: 0.90, b752: 0.55, b753: 0.80,
        b763: 0.55, a332: 0.70, a333: 0.72, a339: 0.90, a342: 0.80, a343: 0.35, a345: 0.75, a346: 0.45,
        b772: 0.60, b77w: 0.82, b788: 0.85, b789: 0.90, b78x: 0.92, a359: 0.93, a35k: 0.95, a35u: 0.98,
        a388: 0.65, b744: 0.88, b748: 0.95, b741: 0.99, b742: 0.99, b743: 0.99, b779: 0.995, b778: 0.995,
      } as Record<string, number>,
      pull: 0.2, noise: 0.02, clamp: [0.05, 0.99] as [number, number],
      phase: { boom: 0.08, steady: 0, soft: -0.05, slump: -0.10 } as Record<string, number>,
      easing: { types: ['a320ceo', 'b738', 'a321ceo'] as string[], perMonth: -0.01, months: 12, floor: -0.08 },
      seasonNarrow: [0.02, 0.06, 0.06, 0.06, 0.04, 0, -0.02, -0.04, -0.06, -0.06, -0.04, 0] as number[],
      seasonWide: [0, 0.02, 0.02, 0.02, 0.03, 0.03, 0, 0, -0.02, -0.02, -0.02, 0] as number[],
      shock: { failure: [-0.15, 120] as [number, number], gtfNeo: [0.10, 180] as [number, number], gtfCeo: [0.05, 180] as [number, number], delay777x: [0.05, 365] as [number, number], recession: -0.10, airspace: 0.04, hajj: 0.05 },
      words: [[0.3, 'Easy'], [0.5, 'Normal'], [0.7, 'Tight'], [0.85, 'Very tight'], [1.01, 'Almost none']] as [number, string][],
      rfpOnly: ['a320neo'] as string[],
    },
    calls: { // lane supply
      narrowPerMonth: 1.6, widePerMonth: 0.35, maxOpen: 6, maxWide: 2, days: [7, 21] as [number, number], wideDays: [5, 14] as [number, number],
      teaserWeight: 0.3, maxTeasers: 1, newBuildChance: 0.05,
    },
    newBuild: { // lane supply
      lead: { narrow: [540, 1080], a339: [730, 1095], minLead: 540 } as Record<string, number | [number, number]>,
      earliestYear: { b788: 2030, b789: 2030, b78x: 2030, a359: 2030, a35k: 2030, a35u: 2031, b779: 2031, b778: 2032 } as Record<string, number>,
      months: [96, 144] as [number, number], rentX: [1.0, 1.06] as [number, number], grade: { narrow: 'B', wide: 'A' } as Record<string, string>, extraDepositMonths: 1,
    },
    terms: { // lane supply
      term: [[12, 0.18], [24, 0.10], [48, 0.04], [96, 0], [9999, -0.03]] as [number, number][],
      credit: { A: -0.03, B: 0, C: 0.05, D: 0.10 } as Record<string, number>,
      tight: 0.25, noise: [0.95, 1.08] as [number, number],
      batch: [-0.15, -0.08] as [number, number], spot: [0.15, 0.30] as [number, number],
      bands: { young: [0, 8], mid: [8, 16], old: [16, 99] } as Record<string, [number, number]>,
      termsByBand: { new: [96, 144], young: [60, 120], mid: [24, 96], old: [12, 48] } as Record<string, [number, number]>,
      reserveShare: { new: 0.32, young: 0.38, mid: 0.44, old: 0.55, veryOld: 0.65 } as Record<string, number>, veryOldFrom: 20, reserveNoise: 0.05, reserveEsc: 0.03,
      minFH: { narrow: 80, wide: 150 }, reservesDepositMonthsD: 3,
      halfLife: { new: 0.6, young: 0.6, mid: 0.5, old: 0.25 } as Record<string, number>, oldCheckX: 0.6,
      extend: { perTight: 0.12, clamp: [0.95, 1.06] as [number, number], long: -0.04 },
      spotReturn: { inspectCost: [15_000, 30_000] as [number, number], lateX: 2 },
    },
    spot: { // lane supply
      narrowPerMonth: 0.7, widePerMonth: 0.12, maxOpen: 2, days: [5, 10] as [number, number], months: [3, 9] as [number, number],
      askReply: [3, 10] as [number, number], askChance: { narrow: 0.35, wide: 0.15 }, depositMonths: 1, depositMonthsD: 2,
    },
    batch: { // lane supply
      gapDays: 300, size: [3, 6] as [number, number], wideShare: 0.15, buyShare: 0.3, buyDiscount: [0.10, 0.20] as [number, number],
      ready: [30, 120] as [number, number], open: [14, 30] as [number, number], recordsX: 1.3, depositLess: 1, gradeRelief: 1,
    },
    /**
     * Player addition (UPDATE-0.17.md §T): exotic types are hard and expensive, never impossible. Lanes supply (who
     * offers them, sale prices, the chance floor) and deals (the grade and security rule, "What it takes").
     * - types: the exotic list (A380, the 747s, the rare A340s);
     * - minGrade: the lowest grade any lessor deals at for one; securityGrade: one grade lower is accepted with
     *   `securityMonths` more deposit and `reservesDepositMonths` of minimum-hours reserves up front; D never leases one;
     * - floor: a request that meets every requirement and goes to a source holding the type has at least this chance of
     *   a proposal (whatever the tightness): classics (747-100/-200/-300) only from storage, at a lower floor;
     * - sale: retiring airlines and storage owners sell them too (`share` of exotic offers, at `priceX` × the used value),
     *   a purchase skips the lessor's credit check (§F) but not the approvals, the AOC variation or the rated crews;
     * - callsPerYear: lessor calls of exotics once the gate allows the type (rare: about one a year);
     * - crew: rated pilots needed before the AOC variation is granted (more than a common type: 4 + 4).
     */
    exotic: {
      types: ['a388', 'b744', 'b748', 'a345', 'a346', 'a342', 'b741', 'b742', 'b743'] as string[],
      classics: ['b741', 'b742', 'b743'] as string[],
      minGrade: 'B' as string, securityGrade: 'C' as string, securityMonths: 4, reservesDepositMonths: 3,
      floor: { default: 0.12, classic: 0.05 },
      sale: { share: 0.4, priceX: [0.85, 1.10] as [number, number] },
      callsPerYear: 1,
      crew: { CPT: 4, FO: 4 },
    },
    credit: { // lane deals
      base: 40,
      aocMonths: [[12, 8], [24, 14], [36, 20]] as [number, number][],
      fleet: [[3, 6], [6, 10], [11, 14]] as [number, number][],
      cover: { negative: -25, bands: [[1, 6], [2, 10], [4, 14]] as [number, number][] },
      profit: { loss: -8, profit: 6, margin: [0.08, 10] as [number, number], minStatements: 3 },
      distress: { deferral: -10, plan: -5, investor: -5, breach: -8, frozen: -12 },
      stars: { 0: 0, 1: 0, 2: 4, 3: 8, 4: 12, 5: 12 } as Record<number, number>, iosa: 6, reliableHigh: [80, 4] as [number, number], reliableLow: [60, -4] as [number, number],
      returns: { per: 2, max: 6 },
      grades: { A: 85, B: 60, C: 35 } as Record<string, number>,
      deposit: { A: 1, B: 2, C: 3, D: 5, Dlow: 7, DlowBelow: 25 } as Record<string, number>,
      wideTotal: { A: 8, B: 4, C: 2, D: 0 } as Record<string, number>, wideMinAgeC: 15,
      chanceX: { A: 1.1, B: 1.0, C: 0.9, D: 0.8 } as Record<string, number>,
      blockMonths: 24, deferralCapLess: 1,
    },
    rfp: { // lane deals
      maxOpen: 3, maxOpenNewcomer: 2, quietDays: 30, reply: { narrow: [5, 14], wide: [10, 24], newBuild: [14, 28] } as Record<string, [number, number]>, replyXA: 0.7,
      window: [[45, 0.5], [120, 0.9], [365, 1.15], [99999, 1.0]] as [number, number][],
      work: { inHand: 1.4, none: 0.6 }, extra: [0.5, 0.25] as number[], laterShare: 0.3, later: [90, 180] as [number, number],
      valid: { narrow: 10, wide: 7, newBuild: 14 } as Record<string, number>, pMax: 0.95,
      stored: { narrow: 0.45, wide: 0.3 }, freeAt: { narrow: [60, 240], wide: [90, 270] } as Record<string, [number, number]>, freeTight: 0.6, flexDays: 30,
    },
    deal: { // lane deals
      holdingMonths: 1, committee: { narrow: [10, 20], wide: [14, 30], newBuild: [21, 35] } as Record<string, [number, number]>, committeeXA: 0.6,
      condC: 0.15, condMonths: 2, decideDays: 7, signDays: 7, lookAgainDays: 30,
    },
    induction: { // lane deals
      records: { narrow: [21, 35], wide: [28, 56] } as Record<string, [number, number]>, oldX: 1.4, oldFrom: 16, spotRecords: [3, 7] as [number, number],
      check: { narrow: [7, 12], wide: [10, 18] } as Record<string, [number, number]>,
      findings: { narrow: 0.30, wide: 0.35, old: 0.45, days: { narrow: [5, 10], wide: [7, 14] } as Record<string, [number, number]> },
      reg: [7, 12] as [number, number], paint: { narrow: 7, wide: 12 }, acceptance: 1, factory: 5,
      camo: { base: 1, perAircraft: 5, max: 4, wideSlots: 2 },
      techReps: { cost: { narrow: 40_000, wide: 75_000 }, recordsX: 0.8 },
      cost: { narrow: 90_000, wide: 180_000, newFamilyX: 1.5 },
    },
    aoc: { // lane deals
      cost: { narrow: 80_000, wide: 150_000 }, days: { easa: [90, 120], uk: [45, 60], other: [60, 90] } as Record<string, [number, number]>, pilots: { CPT: 2, FO: 2 },
    },
    lc: { fee: 0.0125, grades: { A: 'all', B: 'midEol' } as Record<string, string>, cashDays: 30 }, // lane deals
  },
} as const;
