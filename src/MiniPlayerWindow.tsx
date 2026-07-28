import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  Maximize2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  MINI_PLAYER_COMMAND_EVENT,
  MINI_PLAYER_REQUEST_STATE_EVENT,
  MINI_PLAYER_STATE_EVENT,
  parseMiniPlayerSnapshot,
  type MiniPlayerCommand,
  type MiniPlayerSnapshot,
  type MiniPlayerTrack,
} from "./miniPlayer";

const EMPTY_SNAPSHOT: MiniPlayerSnapshot = {
  playing: false,
  positionSeconds: 0,
  durationSeconds: 0,
  volume: 0.72,
  canPrevious: false,
  canNext: false,
};

function formatTime(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function initials(value: string): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase() ?? "").join("") || "C";
}

function MiniArtwork({ track }: { track: MiniPlayerTrack }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const artworkAvailable = Boolean(
    track.artworkUrl && failedUrl !== track.artworkUrl,
  );
  return (
    <div
      className="mini-player__artwork"
      style={
        {
          "--mini-cover-accent": track.palette[0],
          "--mini-cover-base": track.palette[1],
        } as CSSProperties
      }
    >
      {artworkAvailable ? (
        <img
          src={track.artworkUrl}
          alt={`${track.album || track.title} cover`}
          draggable={false}
          onError={() => setFailedUrl(track.artworkUrl)}
        />
      ) : (
        <>
          <span className="mini-player__artwork-rule" aria-hidden="true" />
          <strong>{initials(track.title)}</strong>
        </>
      )}
    </div>
  );
}

export function MiniPlayerView({
  snapshot,
  onCommand,
  onDismiss,
}: {
  snapshot: MiniPlayerSnapshot;
  onCommand: (command: MiniPlayerCommand) => void;
  onDismiss: () => void;
}) {
  const { track } = snapshot;
  const progress = snapshot.durationSeconds
    ? Math.min(100, (snapshot.positionSeconds / snapshot.durationSeconds) * 100)
    : 0;

  return (
    <div className="mini-player-canvas">
      <section className="mini-player" role="region" aria-label="Coda mini player">
        <header className="mini-player__header">
          <div className="mini-player__brand" aria-label="Coda">
            <Music2 size={15} aria-hidden="true" />
            <span>Coda</span>
          </div>
          <div className="mini-player__window-actions">
            <button
              className="mini-player__icon-button"
              type="button"
              onClick={() => onCommand({ type: "show-main" })}
              aria-label="Open Coda"
              title="Open Coda"
            >
              <Maximize2 size={15} aria-hidden="true" />
            </button>
            <button
              className="mini-player__icon-button"
              type="button"
              onClick={onDismiss}
              aria-label="Close mini player"
              title="Close mini player"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className={`mini-player__content ${track ? "" : "is-empty"}`}>
          {track ? (
            <>
              <MiniArtwork key={`${track.id}:${track.artworkUrl ?? ""}`} track={track} />
              <div className="mini-player__metadata" aria-live="polite">
                <h1>{track.title}</h1>
                <p>{track.artist}</p>
                {track.album ? <span>{track.album}</span> : null}
              </div>
            </>
          ) : (
            <>
              <div className="mini-player__empty-mark" aria-hidden="true">
                <Music2 size={22} />
              </div>
              <div className="mini-player__empty-copy">
                <h1>Nothing queued</h1>
                <p>Choose something in Coda to start listening.</p>
              </div>
            </>
          )}
        </div>

        <div className="mini-player__transport">
          <button
            className="mini-player__icon-button"
            type="button"
            onClick={() => onCommand({ type: "previous" })}
            disabled={!snapshot.canPrevious}
            aria-label="Previous"
            title="Previous"
          >
            <SkipBack size={17} fill="currentColor" aria-hidden="true" />
          </button>
          <button
            className="mini-player__play-button"
            type="button"
            onClick={() => onCommand({ type: "play-pause" })}
            disabled={!track}
            aria-label={snapshot.playing ? "Pause" : "Play"}
          >
            {snapshot.playing ? (
              <Pause size={19} fill="currentColor" aria-hidden="true" />
            ) : (
              <Play size={19} fill="currentColor" aria-hidden="true" />
            )}
          </button>
          <button
            className="mini-player__icon-button"
            type="button"
            onClick={() => onCommand({ type: "next" })}
            disabled={!snapshot.canNext}
            aria-label="Skip track"
            title="Skip track"
          >
            <SkipForward size={17} fill="currentColor" aria-hidden="true" />
          </button>
        </div>

        {track ? (
          <div className="mini-player__progress">
            <span>{formatTime(snapshot.positionSeconds)}</span>
            <label
              className="mini-player__range"
              style={{ "--mini-range-value": `${progress}%` } as CSSProperties}
            >
              <span className="sr-only">Track position</span>
              <input
                type="range"
                min="0"
                max={snapshot.durationSeconds || 1}
                step="1"
                value={Math.min(
                  snapshot.positionSeconds,
                  snapshot.durationSeconds || 1,
                )}
                aria-label="Track position"
                onChange={(event) =>
                  onCommand({
                    type: "seek",
                    positionSeconds: Number(event.currentTarget.value),
                  })}
              />
            </label>
            <span>{formatTime(snapshot.durationSeconds)}</span>
          </div>
        ) : null}

        <div className="mini-player__volume">
          <button
            className="mini-player__icon-button"
            type="button"
            onClick={() =>
              onCommand({
                type: "volume",
                volume: snapshot.volume ? 0 : 0.72,
              })}
            aria-label={snapshot.volume ? "Mute" : "Unmute"}
            title={snapshot.volume ? "Mute" : "Unmute"}
          >
            {snapshot.volume ? (
              <Volume2 size={16} aria-hidden="true" />
            ) : (
              <VolumeX size={16} aria-hidden="true" />
            )}
          </button>
          <label
            className="mini-player__range mini-player__range--volume"
            style={
              {
                "--mini-range-value": `${snapshot.volume * 100}%`,
              } as CSSProperties
            }
          >
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={snapshot.volume}
              aria-label="Volume"
              onChange={(event) =>
                onCommand({
                  type: "volume",
                  volume: Number(event.currentTarget.value),
                })}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

export default function MiniPlayerWindow() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void import("@tauri-apps/api/event")
      .then(async ({ emitTo, listen }) => {
        const dispose = await listen<unknown>(
          MINI_PLAYER_STATE_EVENT,
          ({ payload }) => {
            const nextSnapshot = parseMiniPlayerSnapshot(payload);
            if (nextSnapshot) setSnapshot(nextSnapshot);
          },
        );
        if (disposed) {
          dispose();
          return;
        }
        unlisten = dispose;
        await emitTo("main", MINI_PLAYER_REQUEST_STATE_EVENT);
      })
      .catch(() => {
        // The native bridge is optional; keep the empty state usable.
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const dismiss = useCallback(() => {
    void import("@tauri-apps/api/window")
      .then(({ getCurrentWindow }) => getCurrentWindow().hide())
      .catch(() => {
        // Native window dismissal is unavailable in browser-only previews.
      });
  }, []);

  const command = useCallback((value: MiniPlayerCommand) => {
    void import("@tauri-apps/api/event")
      .then(({ emitTo }) => emitTo("main", MINI_PLAYER_COMMAND_EVENT, value))
      .then(() => {
        if (value.type === "show-main") dismiss();
      })
      .catch(() => {
        // The main player remains available if cross-window events fail.
      });
  }, [dismiss]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    const closeOnBlur = () => dismiss();
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", closeOnBlur);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", closeOnBlur);
    };
  }, [dismiss]);

  return (
    <MiniPlayerView
      snapshot={snapshot}
      onCommand={command}
      onDismiss={dismiss}
    />
  );
}
