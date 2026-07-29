import type {
  LastFmTrackInput,
  RadioChapter,
  RadioScrobbleProgress,
  ScrobbleState,
  Track,
} from "./types";

const MAX_LISTEN_DELTA_SECONDS = 10;
const MAX_SCROBBLED_CHAPTER_KEYS = 256;

export type RadioChapterWindow = {
  chapter: RadioChapter;
  index: number;
  key: string;
  start: number;
  end: number;
  duration: number;
};

export type RadioScrobbleAction =
  | {
      kind: "now-playing";
      chapterKey: string;
      track: LastFmTrackInput;
    }
  | {
      kind: "chapter-scrobble";
      chapterKey: string;
      track: LastFmTrackInput;
      timestamp: number;
    };

export type RadioShowScrobbleAction = {
  track: LastFmTrackInput;
  timestamp: number;
};

function hashText(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

function chapterKey(chapter: RadioChapter): string {
  return `${Math.floor(chapter.timecode)}:${hashText(`${chapter.artist}\0${chapter.title}`)}`;
}

function meaningfulChapter(chapter: RadioChapter): boolean {
  const artist = chapter.artist.trim().toLocaleLowerCase();
  const title = chapter.title.trim().toLocaleLowerCase();
  return Boolean(
    artist &&
      title &&
      artist !== "unknown artist" &&
      artist !== "bandcamp radio" &&
      title !== "untitled track",
  );
}

export function radioChapterTimelineFromBounded(
  track: Track,
  timeline: readonly RadioChapter[],
): RadioChapterWindow[] {
  const duration = Math.max(0, track.duration);
  const unique: RadioChapter[] = [];
  for (const chapter of timeline) {
    const previous = unique.at(-1);
    if (previous?.timecode === chapter.timecode) {
      unique[unique.length - 1] = chapter;
    } else {
      unique.push(chapter);
    }
  }

  return unique.map((chapter, index) => {
    const start = Math.min(duration, Math.max(0, chapter.timecode));
    const end = Math.max(
      start,
      Math.min(duration, unique[index + 1]?.timecode ?? duration),
    );
    return {
      chapter,
      index,
      key: chapterKey(chapter),
      start,
      end,
      duration: end - start,
    };
  });
}

function radioChapterAtTimeline(
  timeline: readonly RadioChapterWindow[],
  position: number,
): RadioChapterWindow | undefined {
  const safePosition = Number.isFinite(position) ? Math.max(0, position) : 0;
  let low = 0;
  let high = timeline.length - 1;
  let currentIndex = -1;
  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    if (timeline[middle].start <= safePosition) {
      currentIndex = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return currentIndex >= 0 ? timeline[currentIndex] : undefined;
}

export function radioChapterTrackInput(
  window: RadioChapterWindow,
): LastFmTrackInput | undefined {
  if (window.duration <= 30 || !meaningfulChapter(window.chapter)) return undefined;
  return {
    artist: window.chapter.artist.trim(),
    title: window.chapter.title.trim(),
    album: window.chapter.album?.trim() ?? "",
    duration: Math.floor(window.duration),
    trackNumber: window.index + 1,
    chosenByUser: false,
  };
}

export function radioShowTrackInput(track: Track): LastFmTrackInput {
  return {
    artist: "Bandcamp Radio",
    title: track.title,
    album: track.album,
    duration: Math.max(0, Math.floor(track.duration)),
    trackNumber: 1,
    chosenByUser: false,
  };
}

export function createRadioScrobbleProgress(
  showTrackId: string,
  position = 0,
): RadioScrobbleProgress {
  return {
    showTrackId,
    chapterStartedAt: 0,
    chapterListenedSeconds: 0,
    lastPosition: Math.max(0, position),
    chapterNowPlayingSent: false,
    chapterScrobbleState: "idle",
    showStartedAt: 0,
    showListenedSeconds: 0,
    showScrobbleState: "idle",
    scrobbledChapterKeys: [],
  };
}

function switchChapter(
  progress: RadioScrobbleProgress,
  window: RadioChapterWindow | undefined,
): RadioScrobbleProgress {
  if (progress.activeChapterKey === window?.key) return progress;
  const alreadyScrobbled = window
    ? progress.scrobbledChapterKeys.includes(window.key)
    : false;
  return {
    ...progress,
    activeChapterKey: window?.key,
    chapterStartedAt: 0,
    chapterListenedSeconds: 0,
    chapterNowPlayingSent: false,
    chapterScrobbleState: alreadyScrobbled ? "sent" : "idle",
  };
}

function maybeStartChapter(
  progress: RadioScrobbleProgress,
  window: RadioChapterWindow | undefined,
  enabled: boolean,
  nowSeconds: number,
  actions: RadioScrobbleAction[],
): RadioScrobbleProgress {
  if (!window) return progress;
  let next = progress;
  if (!next.chapterStartedAt) {
    next = { ...next, chapterStartedAt: nowSeconds };
  }
  const input = radioChapterTrackInput(window);
  if (enabled && input && !next.chapterNowPlayingSent) {
    next = { ...next, chapterNowPlayingSent: true };
    actions.push({ kind: "now-playing", chapterKey: window.key, track: input });
  }
  return next;
}

function maybeScrobbleChapter(
  progress: RadioScrobbleProgress,
  window: RadioChapterWindow | undefined,
  enabled: boolean,
  actions: RadioScrobbleAction[],
): RadioScrobbleProgress {
  if (!window || !enabled || progress.chapterScrobbleState !== "idle") return progress;
  const input = radioChapterTrackInput(window);
  const threshold = Math.min(window.duration / 2, 240);
  if (
    !input ||
    !progress.chapterStartedAt ||
    progress.chapterListenedSeconds < threshold
  ) {
    return progress;
  }
  actions.push({
    kind: "chapter-scrobble",
    chapterKey: window.key,
    track: input,
    timestamp: progress.chapterStartedAt,
  });
  return { ...progress, chapterScrobbleState: "pending" };
}

export function advanceRadioScrobblingWithTimeline(
  track: Track,
  timeline: readonly RadioChapterWindow[],
  current: RadioScrobbleProgress,
  position: number,
  playing: boolean,
  enabled: boolean,
  nowSeconds = Math.floor(Date.now() / 1_000),
): { progress: RadioScrobbleProgress; actions: RadioScrobbleAction[] } {
  const safePosition = Number.isFinite(position)
    ? Math.min(Math.max(0, position), Math.max(0, track.duration))
    : current.lastPosition;
  const previousPosition = current.lastPosition;
  const delta = safePosition - previousPosition;
  const previousWindow = radioChapterAtTimeline(timeline, previousPosition);
  const currentWindow = radioChapterAtTimeline(timeline, safePosition);
  const actions: RadioScrobbleAction[] = [];
  let progress = current.showTrackId === track.id
    ? current
    : createRadioScrobbleProgress(track.id, safePosition);

  if (!playing || delta <= 0 || delta > MAX_LISTEN_DELTA_SECONDS) {
    progress = switchChapter(progress, currentWindow);
    if (playing) {
      if (!progress.showStartedAt) progress = { ...progress, showStartedAt: nowSeconds };
      progress = maybeStartChapter(progress, currentWindow, enabled, nowSeconds, actions);
    }
    return {
      progress: { ...progress, lastPosition: safePosition },
      actions,
    };
  }

  if (!progress.showStartedAt) progress = { ...progress, showStartedAt: nowSeconds };
  progress = {
    ...progress,
    showListenedSeconds: progress.showListenedSeconds + delta,
  };

  if (previousWindow?.key === currentWindow?.key) {
    progress = switchChapter(progress, currentWindow);
    progress = maybeStartChapter(progress, currentWindow, enabled, nowSeconds, actions);
    progress = {
      ...progress,
      chapterListenedSeconds: progress.chapterListenedSeconds + delta,
    };
    progress = maybeScrobbleChapter(progress, currentWindow, enabled, actions);
  } else {
    if (previousWindow && progress.activeChapterKey === previousWindow.key) {
      const previousContribution = Math.max(
        0,
        Math.min(safePosition, previousWindow.end) - previousPosition,
      );
      progress = maybeStartChapter(progress, previousWindow, enabled, nowSeconds, actions);
      progress = {
        ...progress,
        chapterListenedSeconds:
          progress.chapterListenedSeconds + previousContribution,
      };
      progress = maybeScrobbleChapter(progress, previousWindow, enabled, actions);
    }
    progress = switchChapter(progress, currentWindow);
    progress = maybeStartChapter(progress, currentWindow, enabled, nowSeconds, actions);
    if (currentWindow) {
      progress = {
        ...progress,
        chapterListenedSeconds:
          progress.chapterListenedSeconds +
          Math.max(0, safePosition - Math.max(previousPosition, currentWindow.start)),
      };
      progress = maybeScrobbleChapter(progress, currentWindow, enabled, actions);
    }
  }

  return { progress: { ...progress, lastPosition: safePosition }, actions };
}

export function markRadioChapterScrobble(
  progress: RadioScrobbleProgress,
  chapterKeyValue: string,
  state: Extract<ScrobbleState, "sent" | "failed">,
): RadioScrobbleProgress {
  const scrobbledChapterKeys = state === "sent"
    ? [...new Set([...progress.scrobbledChapterKeys, chapterKeyValue])].slice(
      -MAX_SCROBBLED_CHAPTER_KEYS,
    )
    : progress.scrobbledChapterKeys;
  return {
    ...progress,
    ...(progress.activeChapterKey === chapterKeyValue &&
    progress.chapterScrobbleState === "pending"
      ? { chapterScrobbleState: state }
      : {}),
    scrobbledChapterKeys,
  };
}

export function completeRadioShowScrobble(
  track: Track,
  progress: RadioScrobbleProgress,
  enabled: boolean,
): {
  progress: RadioScrobbleProgress;
  action?: RadioShowScrobbleAction;
} {
  const threshold = Math.min(track.duration / 2, 240);
  if (
    !enabled ||
    track.duration <= 30 ||
    !progress.showStartedAt ||
    progress.showListenedSeconds < threshold ||
    progress.showScrobbleState !== "idle"
  ) {
    return { progress };
  }
  return {
    progress: { ...progress, showScrobbleState: "pending" },
    action: {
      track: radioShowTrackInput(track),
      timestamp: progress.showStartedAt,
    },
  };
}

export function markRadioShowScrobble(
  progress: RadioScrobbleProgress,
  state: Extract<ScrobbleState, "sent" | "failed">,
): RadioScrobbleProgress {
  return progress.showScrobbleState === "pending"
    ? { ...progress, showScrobbleState: state }
    : progress;
}
