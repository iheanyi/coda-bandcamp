import { createPlayerStateAsync } from "./playerState";
import type { PlayerStateInput, PlayerStateSnapshot } from "./types";

const PLAYER_STATE_IDLE_TIMEOUT_MS = 250;

export type PlayerStateIdleScheduler = (callback: () => void) => void;

function defaultIdleScheduler(callback: () => void): void {
  if (globalThis.requestIdleCallback) {
    globalThis.requestIdleCallback(
      () => callback(),
      { timeout: PLAYER_STATE_IDLE_TIMEOUT_MS },
    );
    return;
  }

  // WebViews without requestIdleCallback still get a task boundary instead of
  // running multi-megabyte persistence work in the caller's interaction task.
  setTimeout(callback, 0);
}

export function waitForPlayerStateIdle(
  schedule: PlayerStateIdleScheduler = defaultIdleScheduler,
): Promise<void> {
  return new Promise((resolve) => schedule(resolve));
}

export class PlayerStatePreparationClient {
  constructor(
    private readonly schedule: PlayerStateIdleScheduler = defaultIdleScheduler,
    private readonly prepareState: (
      input: PlayerStateInput,
      now: number,
    ) => Promise<PlayerStateSnapshot> = createPlayerStateAsync,
  ) {}

  async prepare(
    input: PlayerStateInput,
    now = Date.now(),
  ): Promise<PlayerStateSnapshot> {
    await waitForPlayerStateIdle(this.schedule);
    return this.prepareState(input, now);
  }
}

const playerStatePreparationClient = new PlayerStatePreparationClient();

export function preparePlayerStateSnapshot(
  input: PlayerStateInput,
  now = Date.now(),
): Promise<PlayerStateSnapshot> {
  return playerStatePreparationClient.prepare(input, now);
}
