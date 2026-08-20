import {
  createPlayerStateCheckpoint,
  parsePlayerStateAsync,
  PLAYER_STATE_CONTRACT_VERSION,
} from "../playerState";
import {
  preparePlayerStateSnapshot,
  waitForPlayerStateIdle,
} from "../playerStatePreparation";
import type {
  PlayerStateCheckpoint,
  PlayerStateInput,
  PlayerStateSnapshot,
} from "../types";
import { isDesktop } from "./desktop";
import {
  decodeNativeBoolean,
  decodeNativeInteger,
  decodeNativeVoid,
  invokeNative,
  type NativeValue,
} from "./native";

let playerStateContractVersionRequest: Promise<number> | undefined;

async function nativePlayerStateContractVersion(): Promise<number> {
  if (!playerStateContractVersionRequest) {
    playerStateContractVersionRequest = invokeNative(
      "player_state_contract_version",
    )
      .then((value) =>
        decodeNativeInteger(
          value,
          "player_state_contract_version",
          255,
          1,
        ),
      )
      // An older native process will not know this command while Tauri is
      // rebuilding. Keep the durable queue compatible until it restarts.
      .catch(() => 1);
  }
  return playerStateContractVersionRequest;
}

function forNativePlayerStateContract<
  T extends { radioScrobbleProgress?: unknown },
>(value: T, contractVersion: number): T | Omit<T, "radioScrobbleProgress"> {
  if (contractVersion >= PLAYER_STATE_CONTRACT_VERSION) return value;
  const { radioScrobbleProgress: _unsupported, ...legacy } = value;
  return legacy;
}

function recordPlayerStateDiagnostic(event: string): void {
  void invokeNative("record_player_state_diagnostic", { event })
    .then((value) =>
      decodeNativeVoid(value, "record_player_state_diagnostic"),
    )
    .catch(() => undefined);
}

export async function loadPlayerState(): Promise<
  PlayerStateSnapshot | undefined
> {
  if (!isDesktop()) return undefined;
  let value: NativeValue;
  try {
    value = await invokeNative("load_player_state");
  } catch (cause) {
    recordPlayerStateDiagnostic("renderer.load.native-error");
    throw cause;
  }
  if (value === null) {
    recordPlayerStateDiagnostic("renderer.load.none");
    return undefined;
  }
  const state = await parsePlayerStateAsync(value);
  if (!state) {
    recordPlayerStateDiagnostic("renderer.load.invalid");
    throw new Error("Coda ignored an invalid saved player state.");
  }
  recordPlayerStateDiagnostic("renderer.load.ok");
  return state;
}

export type PlaybackDiagnosticEvent =
  | "renderer.play.request"
  | "renderer.stream.request"
  | "renderer.stream.ready"
  | "renderer.stream.error"
  | "renderer.audio.play-request"
  | "renderer.audio.play-ready"
  | "renderer.audio.play-error"
  | "renderer.audio.media-error";

export function recordPlaybackDiagnostic(event: PlaybackDiagnosticEvent): void {
  if (!isDesktop()) return;
  recordPlayerStateDiagnostic(event);
}

export async function savePlayerState(input: PlayerStateInput): Promise<void> {
  const [state, contractVersion] = await Promise.all([
    preparePlayerStateSnapshot(input),
    nativePlayerStateContractVersion(),
  ]);
  await waitForPlayerStateIdle();
  decodeNativeVoid(
    await invokeNative("save_player_state", {
      state: forNativePlayerStateContract(state, contractVersion),
    }),
    "save_player_state",
  );
}

export async function checkpointPlayerState(
  checkpoint: PlayerStateCheckpoint,
): Promise<boolean> {
  const [validated, contractVersion] = await Promise.all([
    Promise.resolve(createPlayerStateCheckpoint(checkpoint)),
    nativePlayerStateContractVersion(),
  ]);
  return decodeNativeBoolean(
    await invokeNative("checkpoint_player_state", {
      checkpoint: forNativePlayerStateContract(validated, contractVersion),
    }),
    "checkpoint_player_state",
  );
}

export async function clearPlayerState(): Promise<void> {
  decodeNativeVoid(
    await invokeNative("clear_player_state"),
    "clear_player_state",
  );
}
