// v0.8 (UPDATE-0.8.md §1.7): what a client says when the relationship changes. One line per level, by client kind,
// and for about fifteen named clients. Plain words a crew member would hear in the crew room; no numbers here (the
// message adds what the level brings).

import type { ClientKind, ClientLevel } from '../engine/core/types';

type Lines = Partial<Record<ClientLevel, string>>;

const BY_KIND: Record<ClientKind, Lines> = {
  airline: {
    known: "'You flew our schedule like our own crews would. We'll keep your number.'",
    trusted: "'Not a single lost rotation. Next time we're short, we call you first.'",
    partner: "'You're part of our summer planning now. Let's talk about a whole season, not a few weeks.'",
    unhappy: "'Our passengers noticed. We need to see that it won't happen again.'",
  },
  tourOperator: {
    known: "'Our guests got to the beach on time. That's all we ask.'",
    trusted: "'Our resort reps stopped asking which airline we used. That's the best compliment.'",
    partner: "'We'd like to build next year's programme around your aircraft.'",
    unhappy: "'Three hundred holidaymakers waiting at the gate is our nightmare, and it happened twice.'",
  },
  government: {
    known: "'The delegation arrived as planned. The ministry has noted it.'",
    trusted: "'You are on our short list now. When the phone rings at night, it will be you.'",
    partner: "'The ministry wants a standing arrangement with your company.'",
    unhappy: "'The minister asked why our people were left waiting. We had no good answer.'",
  },
  agency: {
    known: "'The teams got where they needed to be. Thank you.'",
    trusted: "'Our field staff ask for your crews by name.'",
    partner: "'We'd like you on our emergency roster for the next crisis.'",
    unhappy: "'When lives depend on a flight, late is not good enough.'",
  },
  sports: {
    known: "'The squad slept on the way home. The coach was happy.'",
    trusted: "'The players like your cabin crew. The club wants you for the cup run.'",
    partner: "'We'd like you for the whole season, pre-season tour included.'",
    unhappy: "'We missed a training session because of the delay. The manager is furious.'",
  },
  music: {
    known: "'The band made every show. That's the job.'",
    trusted: "'Our tour manager says your crews are the calmest people on the tour.'",
    partner: "'We want you on the next world tour from day one.'",
    unhappy: "'We nearly missed a show. Promoters don't forget that.'",
  },
  corporate: {
    known: "'The board landed relaxed and on time.'",
    trusted: "'Discreet, on time and no fuss: exactly what our executives need.'",
    partner: "'Our travel office wants you as our first call for group travel.'",
    unhappy: "'Our chairman waited an hour on the tarmac. That cannot happen again.'",
  },
  broker: {
    known: "'The client was happy, so we're happy.'",
    trusted: "'You're our safe pair of hands now.'",
    partner: "'We'll send you the jobs we don't give to anyone else.'",
    unhappy: "'Our client complained to us. We had to give money back.'",
  },
  operator: {
    known: "'You covered for us when we were stuck. We owe you one.'",
    trusted: "'When we're short, you're the first operator we call.'",
    partner: "'Let's help each other every summer.'",
    unhappy: "'You let us down in front of our client.'",
  },
};

const BY_NAME: Record<string, Lines> = {
  Condor: { trusted: "'Three summers' worth of Hamburg–Palma without a single lost rotation. We'll call you first next time.'" },
  Eurowings: { trusted: "'Our ops control trusts your crews to fly our schedule as if they were ours.'" },
  'TAP Air Portugal': { trusted: "'Obrigado. You covered our Brazil flying when nobody else could.'" },
  'Air Sénégal': { trusted: "'Our cabin crew enjoy flying with your pursers. Dakar wants you back.'", partner: "'Teranga: you're family now.'" },
  'TAAG Angola Airlines': { trusted: "'Luanda trusts you with our aircraft and our passengers.'" },
  'Royal Air Maroc': { trusted: "'Our hub never noticed it was not our aircraft. That is the point.'" },
  Saudia: { trusted: "'Our pilgrims were looked after with care. Saudia will remember.'" },
  'Garuda Indonesia': { trusted: "'The pilgrims came home safely and on time. Terima kasih.'" },
  'Jet2.com': { trusted: "'Our customers fly Jet2 even when it's you. That's what we pay for.'" },
  'TUI Deutschland': { trusted: "'Our guests never knew. That's what we want.'" },
  'UN Department of Peace Operations (DPO)': { trusted: "'The contingent rotated on time. The mission is grateful.'" },
  'UN World Food Programme (WFP)': { trusted: "'Our people in the field know your aircraft by now.'" },
  'Live Nation': { trusted: "'Seven shows, seven cities, no drama. Book them for the next leg.'" },
  'Real Madrid': { trusted: "'El club está contento. The squad wants the same crew for the cup.'" },
  'Manchester United': { trusted: "'The manager wants the same crew for the Champions League trips.'" },
  'White Desert': { trusted: "'Our guests landed on the ice smiling. That's rare.'" },
};

/** The client's line for a new level ('' when none fits). Pure. */
export function clientVoice(name: string, kind: ClientKind, level: ClientLevel): string {
  return BY_NAME[name]?.[level] ?? BY_KIND[kind]?.[level] ?? '';
}
