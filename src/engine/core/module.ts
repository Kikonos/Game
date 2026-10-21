// Contract between the simulation core and the builder modules (contracts, crew, ops).

import type { GameState, SimEvent, SimEventType } from './types';

export type SimHandler = (g: GameState, ev: SimEvent) => void;

export interface SimModule {
  name: string;
  /** New game: seed data and queue the module's first events. */
  init?(g: GameState): void;
  /** After loading a save (rebuild runtime caches). */
  load?(g: GameState): void;
  /**
   * After every event and player action: react to changes other modules made (DESIGN.md §4.2). v0.7: `full` is
   * false between two events inside advanceTo (cheaper work may wait for the next full settle).
   */
  settle?(g: GameState, full: boolean): void;
  /** Handlers by event type; for each event the core calls ops → contracts → crew (DESIGN.md §3.3). */
  handlers: Partial<Record<SimEventType, SimHandler>>;
}
