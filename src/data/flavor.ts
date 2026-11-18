export const LOADING_STEPS = [
  'Loading world map',
  'Filing flight plans',
  'Fuelling aircraft',
  'Briefing the crews',
  'Reading the charter market',
  'Checking the weather',
  'Clearing for take-off',
];

export const AVIATION_FACTS = [
  'At any moment, roughly 10,000 aircraft carrying over a million people are airborne.',
  'The world’s shortest scheduled flight, Westray to Papa Westray in Scotland, lasts about 90 seconds.',
  'Contrails form when hot, humid exhaust meets air colder than −40 °C at cruise altitude.',
  'A Boeing 747 has around six million parts — half of them fasteners.',
  'Jet fuel is about 20–30% of a typical airline’s operating costs.',
  'ACMI stands for Aircraft, Crew, Maintenance and Insurance: what a wet-lease operator provides.',
  'An Airbus A380 can hold 320,000 litres of fuel — enough to fill a small swimming pool.',
  'Aircraft are struck by lightning about once a year on average — and fly on safely.',
];

/**
 * v0.25 why a client asks to move a departure later, by the kind of client (the change request card: "depart 1h 30m
 * later (14:20 local): their hotel transfers run late").
 */
export const RETIME_REASONS: Record<string, readonly string[]> = {
  tourOperator: ['their hotel transfers run late', 'a connecting group arrives late', 'the airport moved their slot', 'a coach group is stuck in traffic'],
  airline: ['their own inbound flight is late', 'their passengers connect from a late flight', 'their station asked for a later slot'],
  sports: ['the match moved to an evening kick-off', 'the team trains on the day', 'the press conference runs late'],
  music: ['the show runs late', 'the stage gear needs more time to load'],
  corporate: ['their board meeting runs over', 'the delegates\' dinner runs late'],
  government: ['the delegation\'s programme changed', 'the minister\'s meeting runs over'],
  other: ['a connecting group arrives late', 'the passengers\' hotel check-out is late'],
};

/** v0.7.3 the aviation authority a discretion report goes to, by the home base's country (else 'the authority'). */
export const AUTHORITY: Record<string, string> = {
  PT: 'ANAC', ES: 'AESA', MT: 'Transport Malta CAD', LT: 'the TKA', LV: 'the CAA Latvia', DE: 'the LBA', IE: 'the IAA', GB: 'the UK CAA', FR: 'the DGAC', IT: 'ENAC',
  // v0.25 the Czech CAA (Úřad pro civilní letectví), Bulgaria's DG Civil Aviation Administration, Estonia's Transport
  // Administration (Transpordiamet), Morocco's Direction Générale de l'Aviation Civile.
  CZ: 'the UCL', BG: 'the DG CAA', EE: 'the Transport Administration', MA: 'the DGAC Morocco',
};
