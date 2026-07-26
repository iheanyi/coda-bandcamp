import {
  Airplay,
  ArrowLeft,
  Clock3,
  ExternalLink,
  Heart,
  ListPlus,
  ListMusic,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  memo,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { formatTime, openBandcampUrl } from "./lib";
import { countLabel } from "./countLabel";
import {
  RadioChapterArtwork,
  RadioChapterCopy,
  type RadioChapterLocalLinks,
} from "./RadioChapterMetadata";
import {
  nextRadioChapterTimeInTimeline,
  previousRadioChapterTimeInTimeline,
  radioAiringIndexesAt,
  radioShowIdFromTrackId,
} from "./radioPlayback";
import type { PlaybackClock } from "./playbackClock";
import type { RadioChapter, RepeatMode, Track } from "./types";

type NowPlayingViewProps = {
  track: Track;
  radioTimeline: readonly RadioChapter[];
  queue: Track[];
  currentIndex: number;
  playing: boolean;
  playbackClock: PlaybackClock;
  duration: number;
  volume: number;
  repeat: RepeatMode;
  artwork: ReactNode;
  airPlayAvailable: boolean;
  queueOpen: boolean;
  onBack: () => void;
  onToggle: () => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onVolume: (value: number) => void;
  onRepeat: () => void;
  onAirPlay: () => void;
  onToggleQueue: () => void;
  onArtist: (artist: string) => void;
  onAlbum: (track: Track) => void;
  onPlayQueueIndex: (index: number) => void;
  getRadioChapterLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
  favorite?: boolean;
  onToggleFavorite?: () => void;
  onAddToPlaylist?: () => void;
};

const UPCOMING_PREVIEW_LIMIT = 4;

function useCurrentRadioIndex(
  playbackClock: PlaybackClock,
  timeline: readonly RadioChapter[],
): number {
  const getCurrentIndex = useCallback(
    () =>
      radioAiringIndexesAt(timeline, playbackClock.getSnapshot()).currentIndex,
    [playbackClock, timeline],
  );
  return useSyncExternalStore(
    playbackClock.subscribe,
    getCurrentIndex,
    getCurrentIndex,
  );
}

const NowPlayingRadioSummary = memo(function NowPlayingRadioSummary({
  playbackClock,
  timeline,
  onOpen,
  getLocalLinks,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  onOpen: (url: string) => void;
  getLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
}) {
  const currentIndex = useCurrentRadioIndex(playbackClock, timeline);
  const current = currentIndex >= 0 ? timeline[currentIndex] : undefined;
  const next = currentIndex + 1 < timeline.length
    ? timeline[currentIndex + 1]
    : undefined;

  if (current) {
    return (
      <section
        className="now-playing__radio-chapter"
        aria-label="Currently airing on Bandcamp Radio"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="eyebrow">On air now</span>
        <RadioChapterCopy
          chapter={current}
          className="now-playing__radio-live-copy"
          onOpen={onOpen}
          localLinks={getLocalLinks?.(current)}
        />
        {next ? (
          <small>
            Up next: {next.title} by {next.artist}
          </small>
        ) : null}
      </section>
    );
  }

  return next ? (
    <p className="now-playing__radio-waiting" aria-live="polite">
      Up next: {next.title} by {next.artist}
    </p>
  ) : null;
});

const NowPlayingPlaybackControls = memo(function NowPlayingPlaybackControls({
  playbackClock,
  timeline,
  duration,
  playing,
  repeat,
  queueOpen,
  canPrevious,
  canNext,
  onSeek,
  onRepeat,
  onPrevious,
  onToggle,
  onNext,
  onToggleQueue,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  duration: number;
  playing: boolean;
  repeat: RepeatMode;
  queueOpen: boolean;
  canPrevious: boolean;
  canNext: boolean;
  onSeek: (value: number) => void;
  onRepeat: () => void;
  onPrevious: () => void;
  onToggle: () => void;
  onNext: () => void;
  onToggleQueue: () => void;
}) {
  const currentTime = useSyncExternalStore(
    playbackClock.subscribe,
    playbackClock.getSnapshot,
    playbackClock.getSnapshot,
  );
  const safeDuration = Math.max(0, duration);
  const progress = safeDuration
    ? Math.min(100, (Math.max(0, currentTime) / safeDuration) * 100)
    : 0;
  const remaining = Math.max(0, safeDuration - currentTime);
  const repeatLabel =
    repeat === "off"
      ? "Repeat off"
      : repeat === "all"
        ? "Repeat queue"
        : "Repeat current track";
  const positionCanPrevious =
    currentTime > 4 ||
    previousRadioChapterTimeInTimeline(timeline, currentTime) !== undefined;
  const positionCanNext =
    nextRadioChapterTimeInTimeline(timeline, currentTime) !== undefined;

  return (
    <>
      <div className="now-playing__timeline">
        <label
          className="range now-playing__range"
          style={{ "--range-value": `${progress}%` } as CSSProperties}
        >
          <span className="sr-only">Now playing position</span>
          <input
            type="range"
            min="0"
            max={safeDuration || 1}
            step="1"
            value={Math.min(Math.max(0, currentTime), safeDuration || 1)}
            onChange={(event) => onSeek(Number(event.target.value))}
          />
        </label>
        <div className="now-playing__times" aria-hidden="true">
          <span>{formatTime(currentTime)}</span>
          <span>−{formatTime(remaining)}</span>
        </div>
      </div>

      <div className="now-playing__controls" aria-label="Playback controls">
        <button
          className={`icon-button now-playing__mode ${repeat !== "off" ? "is-active" : ""}`}
          onClick={onRepeat}
          title={repeatLabel}
          aria-label={repeatLabel}
          aria-pressed={repeat !== "off"}
        >
          {repeat === "one" ? <Repeat1 size={20} /> : <Repeat size={20} />}
        </button>
        <button
          className="icon-button now-playing__skip"
          onClick={onPrevious}
          disabled={!canPrevious && !positionCanPrevious}
          title="Previous"
          aria-label="Previous"
        >
          <SkipBack size={24} fill="currentColor" />
        </button>
        <button
          className="now-playing__play"
          onClick={onToggle}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing
            ? <Pause size={29} fill="currentColor" />
            : <Play size={29} fill="currentColor" />}
        </button>
        <button
          className="icon-button now-playing__skip"
          onClick={onNext}
          disabled={!canNext && !positionCanNext}
          title="Next"
          aria-label="Next"
        >
          <SkipForward size={24} fill="currentColor" />
        </button>
        <button
          className={`icon-button now-playing__mode ${queueOpen ? "is-active" : ""}`}
          onClick={onToggleQueue}
          title={queueOpen ? "Hide queue" : "Show queue"}
          aria-label={queueOpen ? "Hide queue" : "Show queue"}
          aria-pressed={queueOpen}
        >
          <ListMusic size={20} />
        </button>
      </div>
    </>
  );
});

const NowPlayingRadioTimeline = memo(function NowPlayingRadioTimeline({
  playbackClock,
  timeline,
  playing,
  radioLinkError,
  onSeek,
  onOpen,
  getLocalLinks,
}: {
  playbackClock: PlaybackClock;
  timeline: readonly RadioChapter[];
  playing: boolean;
  radioLinkError: string;
  onSeek: (value: number) => void;
  onOpen: (url: string) => void;
  getLocalLinks?: (chapter: RadioChapter) => RadioChapterLocalLinks;
}) {
  const currentIndex = useCurrentRadioIndex(playbackClock, timeline);
  const nextIndex = currentIndex + 1 < timeline.length
    ? currentIndex + 1
    : -1;

  if (!timeline.length) return null;

  return (
    <section
      className="now-playing__radio-timeline"
      aria-labelledby="radio-timeline-heading"
    >
      <div className="now-playing__radio-timeline-heading">
        <div>
          <span className="eyebrow">Broadcast tracklist</span>
          <h2 id="radio-timeline-heading">Songs in this show</h2>
        </div>
        <span>{countLabel(timeline.length, "chapter")}</span>
      </div>
      <ol className="now-playing__radio-chapters">
        {timeline.map((chapter, index) => {
          const isCurrent = index === currentIndex;
          const isNext = index === nextIndex;
          return (
            <li
              className={[
                "now-playing__radio-chapter-row",
                isCurrent ? "is-current" : "",
                isNext ? "is-next" : "",
              ].filter(Boolean).join(" ")}
              key={`${chapter.timecode}-${chapter.artist}-${chapter.title}-${index}`}
              aria-current={isCurrent ? "true" : undefined}
            >
              <button
                className="now-playing__radio-seek"
                onClick={() => onSeek(chapter.timecode)}
                aria-label={`Seek to ${chapter.title} at ${formatTime(chapter.timecode)}`}
                title={`Play from ${formatTime(chapter.timecode)}`}
              >
                <RadioChapterArtwork chapter={chapter} index={index} />
                <time>{formatTime(chapter.timecode)}</time>
              </button>
              <RadioChapterCopy
                chapter={chapter}
                className="now-playing__radio-chapter-copy"
                onOpen={onOpen}
                localLinks={getLocalLinks?.(chapter)}
              />
              {isCurrent ? (
                <span className="now-playing__radio-state">
                  <i
                    className={[
                      "now-playing__radio-equalizer",
                      playing ? "" : "is-paused",
                    ].filter(Boolean).join(" ")}
                    aria-hidden="true"
                  >
                    <i />
                    <i />
                    <i />
                  </i>
                  On air
                </span>
              ) : isNext ? (
                <span className="now-playing__radio-state">Up next</span>
              ) : null}
            </li>
          );
        })}
      </ol>
      {radioLinkError ? (
        <p className="now-playing__radio-link-error" role="status">
          {radioLinkError}
        </p>
      ) : null}
    </section>
  );
});

function NowPlayingViewComponent({
  track,
  radioTimeline,
  queue,
  currentIndex,
  playing,
  playbackClock,
  duration,
  volume,
  repeat,
  artwork,
  airPlayAvailable,
  queueOpen,
  onBack,
  onToggle,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  onSeek,
  onVolume,
  onRepeat,
  onAirPlay,
  onToggleQueue,
  onArtist,
  onAlbum,
  onPlayQueueIndex,
  getRadioChapterLocalLinks,
  favorite = false,
  onToggleFavorite,
  onAddToPlaylist,
}: NowPlayingViewProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [radioLinkError, setRadioLinkError] = useState("");
  const safeDuration = Math.max(0, duration);
  const upcoming = queue.slice(currentIndex + 1, currentIndex + 1 + UPCOMING_PREVIEW_LIMIT);
  const moreUpcoming = Math.max(0, queue.length - currentIndex - 1 - upcoming.length);
  const radioShowId = radioShowIdFromTrackId(track.id);
  const radioShowUrl = radioShowId
    ? `https://bandcamp.com/radio?show=${radioShowId}`
    : undefined;

  const openRadioChapter = useCallback((url: string) => {
    setRadioLinkError("");
    void openBandcampUrl(url).catch((cause) => {
      setRadioLinkError(String(cause).replace(/^Error:\s*/, ""));
    });
  }, []);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <article
      className="now-playing"
      aria-labelledby="now-playing-heading"
      style={
        {
          "--now-playing-accent": track.palette[0],
          "--now-playing-base": track.palette[1],
        } as CSSProperties
      }
    >
      <div className="now-playing__wash" aria-hidden="true" />
      <header className="now-playing__header">
        <button
          className="now-playing__back"
          onClick={onBack}
          aria-label="Back"
          title="Back to previous view"
        >
          <ArrowLeft size={17} strokeWidth={2.2} />
          Back
        </button>
        <span className={`now-playing__status ${playing ? "is-playing" : ""}`}>
          <i aria-hidden="true" />
          {playing ? "Playing now" : "Paused"}
        </span>
      </header>

      <div className="now-playing__stage">
        <div className="now-playing__artwork">{artwork}</div>
        <section className="now-playing__details" aria-label="Current track">
          <h1
            id="now-playing-heading"
            ref={headingRef}
            className={track.title.length > 32 ? "now-playing__title--long" : undefined}
            title={track.title}
            tabIndex={-1}
          >
            {radioShowUrl ? (
              <button
                className="now-playing__show-link"
                onClick={() => openRadioChapter(radioShowUrl)}
                aria-label={`Open ${track.title} on Bandcamp Radio`}
                title="Open show on Bandcamp Radio"
              >
                <span>{track.title}</span>
                <ExternalLink size={20} aria-hidden="true" />
              </button>
            ) : (
              track.title
            )}
          </h1>
          <div className="now-playing__byline">
            {radioShowUrl ? (
              <>
                <button
                  className="metadata-link"
                  onClick={() => openRadioChapter("https://bandcamp.com/radio")}
                >
                  Bandcamp Radio
                </button>
                <span aria-hidden="true">·</span>
                <button
                  className="metadata-link"
                  onClick={() => openRadioChapter(radioShowUrl)}
                >
                  {track.album}
                </button>
              </>
            ) : (
              <>
                <button className="metadata-link" onClick={() => onArtist(track.artist)}>
                  {track.artist}
                </button>
                <span aria-hidden="true">·</span>
                <button className="metadata-link" onClick={() => onAlbum(track)}>
                  {track.album}
                </button>
              </>
            )}
          </div>
          {radioTimeline.length ? (
            <NowPlayingRadioSummary
              playbackClock={playbackClock}
              timeline={radioTimeline}
              onOpen={openRadioChapter}
              getLocalLinks={getRadioChapterLocalLinks}
            />
          ) : null}
          <div className="now-playing__facts">
            <span>Track {track.track}</span>
            <span><Clock3 size={13} /> {formatTime(safeDuration)}</span>
            <span>{countLabel(queue.length - currentIndex - 1, "track")} next</span>
          </div>
          {(
            onToggleFavorite ||
            (!track.id.startsWith("radio:") && onAddToPlaylist)
          ) ? (
            <div className="now-playing__library-actions">
              {onToggleFavorite ? (
                <button
                  className={`text-button favorite-button ${favorite ? "is-favorite" : ""}`}
                  onClick={onToggleFavorite}
                  aria-pressed={favorite}
                >
                  <Heart size={15} fill={favorite ? "currentColor" : "none"} />
                  {favorite ? "Favorited" : "Favorite"}
                </button>
              ) : null}
              {!track.id.startsWith("radio:") && onAddToPlaylist ? (
                <button className="text-button" onClick={onAddToPlaylist}>
                  <ListPlus size={15} /> Add to playlist
                </button>
              ) : null}
            </div>
          ) : null}

          <NowPlayingPlaybackControls
            playbackClock={playbackClock}
            timeline={radioTimeline}
            duration={safeDuration}
            playing={playing}
            repeat={repeat}
            queueOpen={queueOpen}
            canPrevious={canPrevious}
            canNext={canNext}
            onSeek={onSeek}
            onRepeat={onRepeat}
            onPrevious={onPrevious}
            onToggle={onToggle}
            onNext={onNext}
            onToggleQueue={onToggleQueue}
          />

          <div className="now-playing__output">
            <button
              className="icon-button"
              onClick={() => onVolume(volume ? 0 : 0.72)}
              aria-label={volume ? "Mute" : "Unmute"}
            >
              {volume ? <Volume2 size={19} /> : <VolumeX size={19} />}
            </button>
            <label
              className="range now-playing__volume"
              style={{ "--range-value": `${volume * 100}%` } as CSSProperties}
            >
              <span className="sr-only">Volume</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => onVolume(Number(event.target.value))}
              />
            </label>
            {airPlayAvailable ? (
              <button
                className="now-playing__airplay"
                onClick={onAirPlay}
                title="Choose AirPlay device"
                aria-label="Choose AirPlay device"
              >
                <Airplay size={17} />
                AirPlay
              </button>
            ) : null}
          </div>
        </section>
      </div>

      <NowPlayingRadioTimeline
        playbackClock={playbackClock}
        timeline={radioTimeline}
        playing={playing}
        radioLinkError={radioLinkError}
        onSeek={onSeek}
        onOpen={openRadioChapter}
        getLocalLinks={getRadioChapterLocalLinks}
      />

      <section className="now-playing__up-next" aria-labelledby="up-next-heading">
        <div className="now-playing__up-next-heading">
          <div>
            <span className="eyebrow">In this session</span>
            <h2 id="up-next-heading">Up next</h2>
          </div>
          <button onClick={onToggleQueue}>
            {queueOpen ? "Hide full queue" : "Show full queue"}
          </button>
        </div>
        {upcoming.length ? (
          <div className="now-playing__up-next-list">
            {upcoming.map((item, index) => {
              const queueIndex = currentIndex + index + 1;
              return (
                <button
                  className="now-playing__up-next-track"
                  key={`${item.id}-${queueIndex}`}
                  onClick={() => onPlayQueueIndex(queueIndex)}
                  aria-label={`Play ${item.title}`}
                >
                  <span>{String(queueIndex + 1).padStart(2, "0")}</span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.artist} · {item.album}</small>
                  </span>
                  <span>{formatTime(item.duration)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="now-playing__up-next-empty">
            This is the last track in the queue.
          </div>
        )}
        {moreUpcoming ? (
          <span className="now-playing__more">{moreUpcoming} more in the full queue</span>
        ) : null}
      </section>
    </article>
  );
}

export const NowPlayingView = memo(NowPlayingViewComponent);
