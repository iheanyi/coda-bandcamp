import {
  useCallback,
  useEffect,
  useState,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
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
import { Button } from "./components/ui/button";
import { Slider } from "./components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "./components/ui/tooltip";
import { cn } from "./lib/utils";
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

type MiniIconButtonProps = Omit<
  ComponentProps<typeof Button>,
  "aria-label" | "children" | "size" | "variant"
> & {
  children: ReactNode;
  label: string;
  tooltip?: string;
};

function MiniIconButton({
  children,
  className,
  label,
  tooltip = label,
  ...props
}: MiniIconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={(
          <Button
            {...props}
            aria-label={label}
            className={cn(
              "size-7 rounded-full border-0 bg-transparent p-0 text-[#8f928d] transition-[color,background-color,transform] hover:bg-white/[0.07] hover:text-[#f1eee8] active:scale-95 motion-reduce:transform-none motion-reduce:transition-none",
              className,
            )}
            size="icon-compact"
            variant="ghost"
          />
        )}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function MiniArtwork({ track }: { track: MiniPlayerTrack }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const artworkAvailable = Boolean(
    track.artworkUrl && failedUrl !== track.artworkUrl,
  );
  return (
    <div
      className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg shadow-[0_7px_18px_rgba(0,0,0,0.28)] [background:linear-gradient(145deg,var(--mini-cover-accent),var(--mini-cover-base))]"
      style={
        {
          "--mini-cover-accent": track.palette[0],
          "--mini-cover-base": track.palette[1],
        } as CSSProperties
      }
    >
      {artworkAvailable ? (
        <img
          className="size-full object-cover"
          src={track.artworkUrl}
          alt={`${track.album || track.title} cover`}
          draggable={false}
          onError={() => setFailedUrl(track.artworkUrl)}
        />
      ) : (
        <>
          <span
            className="absolute inset-x-0 bottom-3 h-0.5 bg-white/40"
            aria-hidden="true"
          />
          <strong className="relative z-1 text-base font-extrabold tracking-widest text-white/90">
            {initials(track.title)}
          </strong>
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
  return (
    <div className="size-full bg-transparent p-2">
      <section
        className="relative isolate grid size-full grid-rows-[1.75rem_minmax(4.5rem,1fr)_2.5rem_auto_1.5rem] overflow-hidden rounded-xl border border-white/[0.12] bg-coda-player text-foreground shadow-[0_18px_50px_rgba(0,0,0,0.45),0_2px_10px_rgba(0,0,0,0.32)] before:pointer-events-none before:absolute before:-top-20 before:-right-12 before:-z-10 before:h-36 before:w-48 before:rounded-full before:bg-primary/[0.08] before:blur-2xl before:content-['']"
        role="region"
        aria-label="Coda mini player"
      >
        <header className="flex min-w-0 items-center justify-between pt-1 pr-2 pl-3">
          <div
            className="flex min-w-0 items-center gap-1.5 text-xs font-bold tracking-widest text-sidebar-foreground uppercase [&_svg]:shrink-0 [&_svg]:text-primary"
            aria-label="Coda"
          >
            <Music2 size={15} aria-hidden="true" />
            <span>Coda</span>
          </div>
          <div className="flex items-center gap-px">
            <MiniIconButton
              type="button"
              onClick={() => onCommand({ type: "show-main" })}
              label="Open Coda"
            >
              <Maximize2 size={15} aria-hidden="true" />
            </MiniIconButton>
            <MiniIconButton
              type="button"
              onClick={onDismiss}
              label="Close mini player"
            >
              <X size={16} aria-hidden="true" />
            </MiniIconButton>
          </div>
        </header>

        <div
          className={cn(
            "flex min-w-0 items-center gap-3 px-4 py-1.5",
            !track && "justify-center",
          )}
        >
          {track ? (
            <>
              <MiniArtwork
                key={`${track.id}:${track.artworkUrl ?? ""}`}
                track={track}
              />
              <div className="min-w-0" aria-live="polite">
                <h1 className="truncate text-xs leading-4 font-bold text-foreground">
                  {track.title}
                </h1>
                <p className="mt-1 truncate text-xs leading-4 font-semibold text-[#b7b9b3]">
                  {track.artist}
                  {track.album ? ` · ${track.album}` : ""}
                </p>
              </div>
            </>
          ) : (
            <>
              <div
                className="grid size-12 shrink-0 place-items-center rounded-full border border-white/[0.08] bg-white/[0.035] text-[#686c68]"
                aria-hidden="true"
              >
                <Music2 size={22} />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-xs leading-4 font-bold text-foreground">
                  Nothing queued
                </h1>
                <p className="mt-1 max-w-52 text-xs leading-3 text-[#777b76]">
                  Choose something in Coda to start listening.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-center gap-3">
          <MiniIconButton
            type="button"
            onClick={() => onCommand({ type: "previous" })}
            disabled={!snapshot.canPrevious}
            label="Previous"
          >
            <SkipBack size={17} fill="currentColor" aria-hidden="true" />
          </MiniIconButton>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  className="size-9 rounded-full border-0 bg-[#f0ede6] p-0 text-[#17191b] shadow-[0_5px_14px_rgba(0,0,0,0.24)] transition-[background-color,transform] hover:scale-105 hover:bg-white active:scale-95 motion-reduce:transform-none motion-reduce:transition-none"
                  type="button"
                  onClick={() => onCommand({ type: "play-pause" })}
                  disabled={!track}
                  aria-label={snapshot.playing ? "Pause" : "Play"}
                  size="icon"
                />
              )}
            >
              {snapshot.playing ? (
                <Pause size={19} fill="currentColor" aria-hidden="true" />
              ) : (
                <Play size={19} fill="currentColor" aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent>{snapshot.playing ? "Pause" : "Play"}</TooltipContent>
          </Tooltip>
          <MiniIconButton
            type="button"
            onClick={() => onCommand({ type: "next" })}
            disabled={!snapshot.canNext}
            label="Skip track"
          >
            <SkipForward size={17} fill="currentColor" aria-hidden="true" />
          </MiniIconButton>
        </div>

        {track ? (
          <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_1.75rem] items-center gap-2 px-4">
            <span className="text-xs text-[#6f736e] tabular-nums">
              {formatTime(snapshot.positionSeconds)}
            </span>
            <Slider
              className="min-w-0 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:bg-[#efede7]"
              min={0}
              max={snapshot.durationSeconds || 1}
              step={1}
              value={[
                Math.min(
                  snapshot.positionSeconds,
                  snapshot.durationSeconds || 1,
                ),
              ]}
              aria-label="Track position"
              onValueChange={([positionSeconds]) => {
                if (positionSeconds === undefined) return;
                onCommand({ type: "seek", positionSeconds });
              }}
            />
            <span className="text-right text-xs text-[#6f736e] tabular-nums">
              {formatTime(snapshot.durationSeconds)}
            </span>
          </div>
        ) : null}

        <div className="flex items-center justify-end gap-1 px-4 pb-2">
          <MiniIconButton
            className="size-6"
            type="button"
            onClick={() =>
              onCommand({
                type: "volume",
                volume: snapshot.volume ? 0 : 0.72,
              })}
            label={snapshot.volume ? "Mute" : "Unmute"}
          >
            {snapshot.volume ? (
              <Volume2 size={16} aria-hidden="true" />
            ) : (
              <VolumeX size={16} aria-hidden="true" />
            )}
          </MiniIconButton>
          <Slider
            className="min-w-0 data-horizontal:w-16 [&_[data-slot=slider-range]]:bg-primary [&_[data-slot=slider-thumb]]:bg-[#efede7] [&_[data-slot=slider-track]]:h-0.5"
            min={0}
            max={1}
            step={0.01}
            value={[snapshot.volume]}
            aria-label="Volume"
            onValueChange={([volume]) => {
              if (volume === undefined) return;
              onCommand({ type: "volume", volume });
            }}
          />
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
