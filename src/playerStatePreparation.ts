import { createPlayerStateAsync } from "./playerState";
import type { PlayerStateInput, PlayerStateSnapshot } from "./types";

const PLAYER_STATE_IDLE_TIMEOUT_MS = 250;

export type PlayerStateIdleScheduler = (callback: () => void) => void;

/**
 * WebViews may lack requestIdleCallback, and a spoofed non-callable global must
 * not be invoked, so feature detection keeps the callability strictness of a
 * `typeof` check.
 */
function isRequestIdleCallback(
  value: typeof globalThis.requestIdleCallback,
): value is typeof globalThis.requestIdleCallback {
  return typeof value === "function";
}

function defaultIdleScheduler(callback: () => void): void {
  const requestIdle = globalThis.requestIdleCallback;
  if (isRequestIdleCallback(requestIdle)) {
    requestIdle(
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
