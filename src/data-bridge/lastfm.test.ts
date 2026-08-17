import type { InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginLastFmAuthorization,
  completeLastFmAuthorization,
  disconnectLastFm,
  getLastFmStatus,
  openLastFmAuthorization,
  parseLastFmAuthorization,
  parseLastFmStatus,
  scrobbleLastFm,
  updateLastFmNowPlaying,
} from "./lastfm";

const status = {
  configured: true,
  connected: true,
  username: "listener",
};

const authorization = {
  authorizationUrl: "https://www.last.fm/api/auth/?api_key=test&token=abc",
  token: "abc",
};

const track = {
  artist: "Night Archive",
  title: "Afterimage",
  album: "Soft Focus",
  duration: 245,
  trackNumber: 1,
};

afterEach(() => {
  clearMocks();
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  vi.restoreAllMocks();
});

describe("Last.fm native decoders", () => {
  it("decodes status and a verified authorization URL", () => {
    expect(parseLastFmStatus(status, "lastfm_status")).toEqual(status);
    expect(parseLastFmAuthorization(authorization, "lastfm_begin_auth"))
      .toEqual(authorization);
  });

  it("rejects unverified Last.fm authorization hosts and credentials", () => {
    expect(() => parseLastFmAuthorization({
      ...authorization,
      authorizationUrl: "https://example.com/api/auth/",
    }, "lastfm_begin_auth")).toThrow(
      "the verified Last.fm authorization URL",
    );
    expect(() => parseLastFmAuthorization({
      ...authorization,
      authorizationUrl: "http://www.last.fm/api/auth/",
    }, "lastfm_begin_auth")).toThrow(
      "the verified Last.fm authorization URL",
    );
    expect(() => parseLastFmAuthorization({
      ...authorization,
      authorizationUrl: "https://token@www.last.fm/api/auth/",
    }, "lastfm_begin_auth")).toThrow(
      "the verified Last.fm authorization URL",
    );
    expect(() => parseLastFmAuthorization({
      ...authorization,
      authorizationUrl: "not-a-url",
    }, "lastfm_begin_auth")).toThrow("the Last.fm authorization URL");
  });

  it("rejects inherited status records instead of reading the prototype chain", () => {
    expect(() =>
      parseLastFmStatus(Object.create(status), "lastfm_status")
    ).toThrow("Invalid native response for lastfm_status");
  });
});

describe("Last.fm native commands", () => {
  it("returns a disconnected status outside the desktop app", async () => {
    await expect(getLastFmStatus()).resolves.toEqual({
      configured: false,
      connected: false,
    });
  });

  it("invokes fixed commands and decodes native payloads", async () => {
    const invocations: Array<{
      command: string;
      payload: InvokeArgs | undefined;
    }> = [];
    mockIPC((command, payload) => {
      invocations.push({ command, payload });
      switch (command) {
        case "lastfm_status":
        case "lastfm_complete_auth":
        case "lastfm_disconnect":
          return status;
        case "lastfm_begin_auth":
          return authorization;
        case "lastfm_update_now_playing":
        case "lastfm_scrobble":
          return null;
        default:
          throw new Error(`Unexpected native command: ${command}`);
      }
    });

    await expect(getLastFmStatus()).resolves.toEqual(status);
    await expect(beginLastFmAuthorization()).resolves.toEqual(authorization);
    await expect(completeLastFmAuthorization("abc")).resolves.toEqual(status);
    await expect(disconnectLastFm()).resolves.toEqual(status);
    await expect(updateLastFmNowPlaying(track)).resolves.toBeUndefined();
    await expect(scrobbleLastFm(track, 1_700_000_000)).resolves.toBeUndefined();
    expect(invocations.map(({ command }) => command)).toEqual([
      "lastfm_status",
      "lastfm_begin_auth",
      "lastfm_complete_auth",
      "lastfm_disconnect",
      "lastfm_update_now_playing",
      "lastfm_scrobble",
    ]);
  });

  it("opens only the verified Last.fm authorization page", async () => {
    const opened: string[] = [];
    vi.spyOn(window, "open").mockImplementation((url) => {
      opened.push(String(url));
      return null;
    });

    await expect(
      openLastFmAuthorization("https://example.com/api/auth/"),
    ).rejects.toThrow("Coda only opens the verified Last.fm authorization page.");
    await openLastFmAuthorization(authorization.authorizationUrl);
    expect(opened).toEqual([authorization.authorizationUrl]);
  });
});
