import { describe, expect, it } from "vitest";
import {
  advanceRadioScrobbling,
  advanceRadioScrobblingWithTimeline,
  completeRadioShowScrobble,
  createRadioScrobbleProgress,
  markRadioChapterScrobble,
  markRadioShowScrobble,
  radioChapterTimeline,
  radioChapterAtTimeline,
} from "./radioScrobbling";
import type { Track } from "./types";

const radioTrack: Track = {
  id: "radio:979",
  title: "The Hip-Hop Show",
  artist: "Bandcamp Radio",
  album: "Bandcamp Weekly",
  albumId: "radio:979",
  duration: 720,
  track: 1,
  palette: ["#111", "#222"],
  radioChapters: [
    { title: "Station ident", artist: "Bandcamp Radio", timecode: 0 },
    {
      title: "First light",
      artist: "North Star",
      album: "Daybreak",
      timecode: 60,
    },
    {
      title: "Night drive",
      artist: "Low Beam",
      album: "After Dark",
      timecode: 180,
    },
  ],
};

describe("Radio scrobbling", () => {
  it("builds deterministic chapter windows and lets the last duplicate go on air", () => {
    const track = {
      ...radioTrack,
      radioChapters: [
        ...radioTrack.radioChapters!,
        { title: "Corrected title", artist: "Low Beam", timecode: 180 },
      ],
    };

    expect(radioChapterTimeline(track).map(({ chapter, start, end }) => ({
      title: chapter.title,
      start,
      end,
    }))).toEqual([
      { title: "Station ident", start: 0, end: 60 },
      { title: "First light", start: 60, end: 180 },
      { title: "Corrected title", start: 180, end: 720 },
    ]);
  });

  it("reuses a precomputed timeline without changing scrobble accounting", () => {
    const timeline = radioChapterTimeline(radioTrack);
    const progress = createRadioScrobbleProgress(radioTrack.id, 60);
    const direct = advanceRadioScrobbling(
      radioTrack,
      progress,
      70,
      true,
      true,
      1_000,
    );
    const precomputed = advanceRadioScrobblingWithTimeline(
      radioTrack,
      timeline,
      progress,
      70,
      true,
      true,
      1_000,
    );

    expect(precomputed).toEqual(direct);
    expect(radioChapterAtTimeline(timeline, 70)?.chapter.title).toBe(
      "First light",
    );
  });

  it("sends chapter Now Playing with radio semantics and scrobbles actual listening", () => {
    let progress = createRadioScrobbleProgress(radioTrack.id, 60);
    const started = advanceRadioScrobbling(
      radioTrack,
      progress,
      60,
      true,
      true,
      1_000,
    );
    progress = started.progress;

    expect(started.actions).toEqual([
      expect.objectContaining({
        kind: "now-playing",
        track: expect.objectContaining({
          artist: "North Star",
          title: "First light",
          duration: 120,
          chosenByUser: false,
        }),
      }),
    ]);

    for (let position = 65; position <= 120; position += 5) {
      const advanced = advanceRadioScrobbling(
        radioTrack,
        progress,
        position,
        true,
        true,
        1_000 + position,
      );
      progress = advanced.progress;
      if (position < 120) {
        expect(advanced.actions).toEqual([]);
      } else {
        expect(advanced.actions).toEqual([
          expect.objectContaining({
            kind: "chapter-scrobble",
            track: expect.objectContaining({ title: "First light" }),
            timestamp: 1_000,
          }),
        ]);
      }
    }
    expect(progress.chapterListenedSeconds).toBe(60);
    expect(progress.chapterScrobbleState).toBe("pending");

    progress = markRadioChapterScrobble(
      progress,
      progress.activeChapterKey!,
      "sent",
    );
    expect(progress.chapterScrobbleState).toBe("sent");
    expect(progress.scrobbledChapterKeys).toContain(progress.activeChapterKey);
  });

  it("does not count seeks or scrobble station-ident metadata", () => {
    let progress = createRadioScrobbleProgress(radioTrack.id);
    progress = advanceRadioScrobbling(
      radioTrack,
      progress,
      0,
      true,
      true,
      1_000,
    ).progress;
    const seeked = advanceRadioScrobbling(
      radioTrack,
      progress,
      170,
      true,
      true,
      1_010,
    );

    expect(seeked.progress.showListenedSeconds).toBe(0);
    expect(seeked.progress.chapterListenedSeconds).toBe(0);
    expect(seeked.actions).toEqual([
      expect.objectContaining({
        kind: "now-playing",
        track: expect.objectContaining({ title: "First light" }),
      }),
    ]);
  });

  it("only scrobbles the complete show at natural completion after enough listening", () => {
    const progress = {
      ...createRadioScrobbleProgress(radioTrack.id, radioTrack.duration),
      showStartedAt: 1_000,
      showListenedSeconds: 240,
    };
    const completed = completeRadioShowScrobble(radioTrack, progress, true);

    expect(completed.action).toEqual({
      track: expect.objectContaining({
        artist: "Bandcamp Radio",
        title: "The Hip-Hop Show",
        chosenByUser: false,
      }),
      timestamp: 1_000,
    });
    expect(completed.progress.showScrobbleState).toBe("pending");
    expect(markRadioShowScrobble(completed.progress, "sent").showScrobbleState)
      .toBe("sent");

    expect(
      completeRadioShowScrobble(
        radioTrack,
        { ...progress, showListenedSeconds: 239 },
        true,
      ).action,
    ).toBeUndefined();
  });

  it("tracks listening while Last.fm is disconnected without retroactive fake actions", () => {
    const progress = createRadioScrobbleProgress(radioTrack.id, 60);
    const advanced = advanceRadioScrobbling(
      radioTrack,
      progress,
      65,
      true,
      false,
      1_000,
    );

    expect(advanced.actions).toEqual([]);
    expect(advanced.progress.showListenedSeconds).toBe(5);
    expect(advanced.progress.chapterListenedSeconds).toBe(5);
    expect(advanced.progress.chapterNowPlayingSent).toBe(false);
  });
});
