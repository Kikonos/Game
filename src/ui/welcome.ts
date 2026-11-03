// v0.15 the welcome card of a new game (the player: "show a welcome pop-up with a short introduction to how things
// work"): once, when a new airline or a scenario starts (never on a load), with a low chime as it appears (the card is
// that chime's notification). A new airline gets the six points of how the job works; a scenario gets its own briefing
// (the story, the goal, the days) and the two points that still apply, so there is only ever one card. Pure text.

import { AIRPORT_BY_CODE } from '../data/airports';
import type { GameState } from '../engine/core/types';
import { goalLine, scenarioDef } from '../engine/scenario';

export interface WelcomeCard {
  title: string;
  /** A short line under the title. */
  lead: string;
  points: string[];
  /** The one button. */
  button: string;
}

/** The welcome card for this new game (pure). */
export function welcomeCard(g: GameState): WelcomeCard {
  const city = AIRPORT_BY_CODE[g.company.homeBase]?.city ?? g.company.homeBase;
  const title = `Welcome to ${g.company.name}, ${city}`;
  const time = 'Time runs at 1×, 2× or 4×, and you can pause whenever you like. The game pauses itself when a decision needs you.';
  const help = 'Not sure? The ? on each screen explains it, and Settings › Glossary explains the words.';
  const d = scenarioDef(g);
  if (d) {
    return {
      title,
      lead: `Scenario: ${d.name}. ${d.days} days.`,
      points: [d.brief, `Goal: ${goalLine(d)}`, time, help],
      button: "Let's fly",
    };
  }
  return {
    title,
    lead: 'You run an ACMI operator. Here is how it works.',
    points: [
      'Airlines lease your Aircraft with Crew, Maintenance and Insurance (ACMI), and pay you by the block hour.',
      'Offers arrive in Contracts › Market. Urgent ones phone in.',
      'The roster keeps crew within their duty and rest rules. When something goes wrong, a card says what happened and what you can do.',
      time,
      'Grow by building your name: market presence and trade fairs are in Contracts › Markets.',
      help,
    ],
    button: "Let's fly",
  };
}
