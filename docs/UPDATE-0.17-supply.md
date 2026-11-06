# BLOCK HOURS v0.17 lane `supply`: as built

Companion to UPDATE-0.17.md (§A, §B, §E, §I, §J, §T supply side). Where the build differs from the design, and what lanes deals and market-ui can call.

## Differences from the design

- **Reference rents (§E.1)** are `RENT_V017` in data/acmiTypes.ts, read through `refType(t)` by v0.17 pricing only. `rentMonth` / `rentNew` are untouched, so the v0.16 market (`--market=v16`), the start fleets, dry-lease-out quotes, sales and insurance keep their numbers (§P.3 holds: `bot 1 120 --market=v16` is the step-0 table line for line). Nothing else moved.
- **TEV, MZJ, HAJ (§B, §I.1)** are not added to airports.ts: an airport row becomes a fuel-stop and alternate candidate in core/perf.ts for every route, which would move the v0.16 table. `STORAGE_SITES` lists TEV and MZJ and drops them where used (as LESSOR_SITES does); TUI fly Deutschland sublets from FRA.
- **delay777x (§A.3)** is `SUPPLY_EVENT_TPLS` in data/worldEvents.ts, fired once in 2027–28 by the monthly tightness step (an even hazard to December 2028), a supply shock and a message; it is not in the world roll, so the world's other events stay as they were.
- **The start's tightness** moves once at a new game (refreshMarket at init runs the monthly step); an old save starts at the base values (loadLeasing, lane deals) and moves at its first month end.
- **Lessor calls** keep a 30 % sale share for narrowbodies and out-of-production types (as v0.16); the guaranteed early offers come from a lessor that fits our grade, else a keen mid-life lessor (Aircastle, Carlyle, Vallair) at our grade's deposit; the post-filing widebody keeps 1 month.
- **Exotics (§T)**: kept out of the ordinary widebody roll; `exoticCall` about once a year once the gate allows one: a lease from Doric / Amedeo / the retiring airline at B, at C with 4 more months' deposit and 3 months of reserves up front, at D (or no lessor with room) a sale; the 747 classics only as sales from storage. `supplyFloor(typeId)` gives lane deals the request floor (12 %, classics 5 %).
- **Minimum hours (§E.3)** are posted as `reserves` by refreshMarket at the month end (it runs before the close), from `bhDays` block hours; an aircraft leased out counts as flown. Escalation +3 % on each anniversary, daily in dailyCalls.
- **Short-term (§I)**: requests are `Rfp` with `spot: true` answered by spot.ts (lane deals' dailyRfps must skip them); offers sign on the legacy path (no letter of intent); the return is booked 21 days before the date; late = twice the rent a week at a time; the transition cost is half.
- **Batches (§J.3)**: the failure shock goes on the failed airline's families; offers carry `batchOf`; the 'mid-life lessor accepts grade C' rule is `BAL.v017.batch.gradeRelief`, for lane deals' credit check.

## API for lanes deals and market-ui
    v0.17 lane SUPPLY → what lanes deals and market-ui can call (branch v017-supply). All v0.17 behaviour is gated on BAL.v017.on.
    
    OFFERS (ops/market.ts)
    - makeOffer(g, t, OfferOpts): with BAL.v017.on and opts.source → a v0.17 offer (makeOffer017). OfferOpts:
        source ('call'|'proposal'|'batch'|'spot'|'newBuild'), lessorId, band ('new'|'young'|'mid'|'old'), months (term asked),
        grade, rfpId, batchId, days [min,max] open (else calls' 7–21 / wide 5–14), lead [min,max] days to handover,
        kind 'buy' + seller (a sale), exOperator, spot {airline, base, returnAt}, newBuild, depositMonths, handoverAt.
      The offer carries: source, band, lessorId, grade, depositMonths, holding (1 month), minFH, halfLifeShare, why[], transition,
        exoticSecurity (§T at C), reservesDeposit (grade D / exotic at C), freeAt (= now; a proposal sets its own), rfpId/batchId/spot.
      → A PROPOSAL (deals rfp.ts): makeOffer(g, typeOf(rfp.typeId), { source: 'proposal', lessorId, band: rfp.band, months: rfp.months,
        grade, rfpId: rfp.id, days: [valid, valid] }) then set o.freeAt / o.validUntil and push to g.market.aircraft
        (or postOffer(g, o, { quiet: true }) – proposals are not counted in the 6-call cap).
    - postOffer(g, o, { quiet? }): v0.17 caps only lessor calls (isCall: no source | 'call' | 'newBuild') at 6 open, 2 wide.
    - bandsFor(g, t), bandYears(g, t, band): the bands a type exists in now.
    - signOffer(g, o, SignOpts): SignOpts.transition = transition cost to POST NOW (category 'transition'); pass it unless deals posts it.
      signOffer ALWAYS pays o.reservesDeposit (cashOnly) and copies leaseTerms017(o, handover) onto the lease: lessorId, minFH,
      reservesEscAt (+12 months), halfLifeShare, grade, reservesDeposit, spot. Deals adds ownership.lc itself.
    - acquireAircraft (legacy path, also used when usesLoi(o) is false): cash check = deposit + fee + transition + reservesDeposit.
    - marketOutlook(g).supply / .supplyText (§A.4).
    
    LEASING (engine/leasing)
    - calls.ts: callLessors(g, t, {newBuild?, grade?}) → lessors that would place t with us + their bands (minGrade, exotic at C,
        caps via exposureOf, grade's wide total incl. deals in committee/conditions/approved, wides at C only 'old').
        widebodiesHeld(g), newBuildLead(g, typeId, r), newBuildEarliest(typeId) (null or Jan 1 of the placed-until year → the
        'placed' answer), supplyFloor(typeId) (§T floor 0.12 / classic 0.05, 0 for common types), isCall(o), exoticCall(g, r).
    - terms.ts: quoteTerms, gradeNow(g) (uses g.leasing.credit if cached within a day, else lessorRating), gradeDepositMonths,
        termFor, whyText(why) → 'Mid-life A320ceo $220K · 36 months +4 % · normal market −1 % · rating C +5 %',
        transitionCost(g, t, source), extensionRentX, minHoursBill / minHoursLines (posted at month end by refreshMarket).
    - tightness.ts: tightNow(g, typeId, t?), tightWord, supplyOutlook, supplyText, addSupplyShock, onSupplyEvent.
    - spot.ts: askSpot(g, {family, months, from}), spotSources(g, draft), windowMonthsLeft; dailySpot handles rfps with spot: true.
        → DEALS: dailyRfps must SKIP rfps with `spot: true` (spot.ts answers them). Spot offers need no LOI/credit check:
          usesLoi(g, o) should be false for source 'spot' (signed via acquireAircraft; deposit 1 month, 2 at D).
    - batches.ts: onAirlineFailure; batch offers: source 'batch', batchId, batchOf; a mid-life lessor accepts one grade lower
        for them (BAL.v017.batch.gradeRelief: deals' credit check should relax by 1 for source 'batch').
    - Lease returns (ops/leaseReturn.ts): extension rent from extensionRentX; returnQuote uses ownership.halfLifeShare and
        ×0.6 check for old; spot: 1-day inspection at the airline's base, no extension, booked 21 days before; late = 2× rent
        weekly (onLeaseEnd); reservesDeposit refunded at return.
    NOT DONE BY SUPPLY (deals): the LOI path for calls/batches/new builds, the transition plan (inductionPlan uses o.leadDays;
      batch leadDays = 30–120 ready, spot 7–14), records ×1.3 for batch, the 'moved once toward the phase target' at load
      (a new game moves at init via refreshMarket; old saves start at base).
