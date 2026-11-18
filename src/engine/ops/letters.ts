// v0.25 r2 passenger letters (immersion): now and then a passenger writes in after a flight. A thank-you names the
// crew member it is about; a complaint follows only a leg 3 hours or more late. Text only: no money, no morale, no
// draws from the game RNG (the pick is a hash of the flight number and the day), no ids from g.seq (the game plays
// on exactly as without it), at most one letter in 10 days.

import { AIRPORT_BY_CODE } from '../../data/airports';
import { pushMessage } from '../core/messages';
import { DAY, fmtDay, fmtDuration } from '../core/time';
import type { Aircraft, CrewMember, Flight, GameState, Role } from '../core/types';
import { hashUnit } from '../core/util';

const GAP = 10 * DAY;
/** Chance a leg on time brings a thank-you; a leg 3 h late brings a complaint more often. */
const THANKS = 1 / 120;
const GRUMBLE = 1 / 4;
const LATE = 3 * 60;

const city = (code: string) => AIRPORT_BY_CODE[code]?.city ?? code;
const full = (c: CrewMember) => `${c.first} ${c.last}`;

/** Thank-you lines, each about one crew member of the given role ('any': the cabin crew as a whole). */
const THANK: { role: Role | 'any'; text: (name: string, to: string) => string }[] = [
  { role: 'PUR', text: (n) => `A passenger thanked purser ${n} for looking after their father, who needed oxygen on board.` },
  { role: 'PUR', text: (n) => `A passenger left their passport in the seat pocket. Purser ${n} found it and got it back to them at the gate.` },
  { role: 'CC', text: (n) => `A nervous flyer thanked ${n}, who sat with them through the turbulence.` },
  { role: 'CC', text: (n) => `A family thanked ${n} for warming the baby's bottles and carrying the car seat off.` },
  { role: 'CC', text: (n) => `A passenger with a nut allergy thanked ${n} for the announcement and for taking the nuts off the trolley.` },
  { role: 'CPT', text: (n) => `A boy and his parents thanked Captain ${n} for showing him the flight deck after landing.` },
  { role: 'CPT', text: (n, to) => `A passenger thanked Captain ${n} for the clear updates during the hold before ${to}.` },
  { role: 'any', text: () => `A couple on honeymoon thanked the cabin crew for the card the whole crew signed.` },
  { role: 'any', text: () => `A passenger in a wheelchair thanked the crew for boarding them first and checking on them all flight.` },
];

const GRUMBLES: ((to: string) => string)[] = [
  () => 'Nobody told them anything for the first hour at the gate.',
  (to) => `They missed their connection in ${to} and ask who pays for the hotel.`,
  () => 'The meal vouchers ran out before the second delay was announced.',
  () => 'They sat on board with no air conditioning while the delay went on.',
];

/** On a revenue leg's arrival: a passenger letter, rarely. */
export function passengerLetter(g: GameState, f: Flight, ac: Aircraft): void {
  if (f.kind !== 'revenue' || ac.cabin.total <= 0 || f.pax === 0 || g.scen) return;
  const s = g.stats;
  if (s.letterAt !== undefined && g.now - s.letterAt < GAP) return;
  const day = Math.floor(g.now / DAY);
  const u = hashUnit(`letter|${f.no}|${f.from}|${day}`);
  const late = (f.ata ?? g.now) - (f.sta - (f.std - (f.schedStd ?? f.std)));
  const leg = `${f.no} ${f.from}–${f.to}, ${fmtDay(f.std)}`;
  const client = f.contractId ? g.clients[g.contracts[f.contractId]?.clientId ?? '']?.name : undefined;
  if (late >= LATE) {
    if (u >= GRUMBLE) return;
    const line = GRUMBLES[Math.floor(hashUnit(`grumble|${f.no}|${day}`) * GRUMBLES.length)](city(f.to));
    const who = f.sched || !client ? 'Customer relations will answer it.' : `${client} sent it on; they answer their passengers.`;
    s.letterAt = g.now;
    pushMessage(g, { id: `pl:${f.id}`, tone: 'info', cat: 'commercial', title: `Passenger complaint: ${f.no}`, body: `${leg}, ${fmtDuration(late)} late. ${line} ${who}` });
    return;
  }
  if (late > 15 || u >= THANKS) return;
  const crew = f.crewIds.map((id) => g.crew[id]).filter((c): c is CrewMember => !!c);
  const fits = THANK.filter((t) => t.role === 'any' || crew.some((c) => c.role === t.role));
  if (!fits.length) return;
  const t = fits[Math.floor(hashUnit(`thanks|${f.no}|${day}`) * fits.length)];
  const pool = crew.filter((c) => c.role === t.role);
  const named = t.role === 'any' ? undefined : pool[Math.floor(hashUnit(`named|${f.no}|${day}`) * pool.length)];
  const name = named ? (t.role === 'CPT' ? named.last : full(named)) : '';
  const via = !f.sched && client ? ` ${client} passed it on.` : '';
  s.letterAt = g.now;
  pushMessage(g, {
    id: `pl:${f.id}`, tone: 'good', cat: 'crew', title: `Thank-you letter: ${f.no}`, body: `${t.text(name, city(f.to))} (${leg}.)${via}`,
    ...(named ? { ref: { kind: 'crew' as const, id: named.id } } : {}),
  });
}
