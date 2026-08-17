import { Channel, type InvokeArgs } from "@tauri-apps/api/core";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchDailyArticle,
  fetchDailyArticles,
} from "./daily";
import {
  fetchFavorites,
  reconcileFavoriteTracks,
  setFavorite,
} from "./favorites";
import {
  connectBandcamp,
  disconnect,
  fetchAlbum,
  fetchLibrary,
  hasConnection,
  loadLibraryCache,
} from "./library";
import {
  decodeNativeArray,
  decodeNativeBandcampUrl,
  decodeNativeRecord,
  decodeNativeString,
  decodeNativeVoid,
  type NativeValue,
} from "./native";
import { isOwnDataRecord } from "../ownData";
import {
  createPlaylist,
  deletePlaylist,
  fetchPlaylist,
  fetchPlaylists,
  updatePlaylist,
} from "./playlists";
import {
  clearStreamUrlCache,
  fetchStreamUrl,
} from "./streamUrls";

const nativeAlbum = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: 1,
  duration: 245,
};

const nativeTrack = {
  id: "song-1",
  title: "Afterimage",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 245,
  track: 1,
};

const nativePlaylist = {
  id: "playlist-1",
  name: "Night drives",
  songCount: 1,
  duration: 245,
};

const nativePlaylistDetail = {
  ...nativePlaylist,
  tracks: [nativeTrack],
};

const nativeArticle = {
  id: "best-jazz:patient-music",
  articleSection: "best-jazz",
  slug: "patient-music",
  title: "Patient Music",
  articleUrl: "https://daily.bandcamp.com/best-jazz/patient-music",
  embeds: [],
};

/** Bridge-supplied invoke arguments these tests inspect after capture. */
type BridgeInvokeArguments = {
  onProgress?: Channel<NativeValue>;
  forceFull?: boolean;
};

function isInvokeRecord(
  value: InvokeArgs | undefined,
): value is BridgeInvokeArguments {
  return (
    value !== undefined &&
    !Array.isArray(value) &&
    !(value instanceof ArrayBuffer) &&
    !(value instanceof Uint8Array)
  );
}

function invokeRecord(value: InvokeArgs | undefined): BridgeInvokeArguments {
  if (!isInvokeRecord(value)) {
    throw new TypeError("Expected Tauri invoke arguments");
  }
  return value;
}

afterEach(() => {
  clearMocks();
  clearStreamUrlCache();
  window.localStorage.clear();
});

describe("native boundary primitives", () => {
  it("accepts only unspoofed plain data records", () => {
    let getterCalls = 0;
    const taggedRecord = { value: "safe" };
    Object.defineProperty(taggedRecord, Symbol.toStringTag, {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("tag getter must not run");
      },
    });
    const spoofedDate: NativeValue | Date = Object.assign(new Date(), {
      [Symbol.toStringTag]: "Object",
      value: "safe",
    });
    const proxy = new Proxy(
      { value: "safe" },
      {
        get() {
          getterCalls += 1;
          throw new Error("proxy getter must not run");
        },
        getPrototypeOf() {
          throw new Error("prototype inspection denied");
        },
      },
    );

    expect(() => decodeNativeRecord(Object.create({ value: "inherited" }), "record"))
      .toThrow("Invalid native response for record");
    expect(() => decodeNativeRecord([], "record")).toThrow(
      "Invalid native response for record",
    );
    for (const boxed of [
      Object("boxed"),
      Object(1),
      Object(true),
      Object(1n),
      Object(Symbol("boxed")),
    ]) {
      expect(() => decodeNativeRecord(boxed, "record")).toThrow(
        "Invalid native response for record",
      );
    }
    // A Date spoofing Symbol.toStringTag is not wire data, so it cannot reach
    // decodeNativeRecord's NativeValue contract; the shared guard that
    // decodeNativeRecord delegates to must still reject it structurally.
    expect(isOwnDataRecord(spoofedDate)).toBe(false);
    expect(() => decodeNativeRecord(taggedRecord, "record")).toThrow(
      "Invalid native response for record",
    );
    expect(() => decodeNativeRecord(proxy, "record")).toThrow(
      "Invalid native response for record",
    );
    expect(getterCalls).toBe(0);
  });

  it("projects records onto a null prototype so later field reads cannot walk prototypes", () => {
    let getterCalls = 0;
    const payload = { id: "own-id", title: "Soft Focus" };
    Object.defineProperty(payload, "secret", {
      configurable: true,
      enumerable: true,
      get() {
        getterCalls += 1;
        throw new Error("record getter must not run");
      },
    });
    Object.defineProperty(Object.prototype, "artist", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: "polluted-artist",
    });
    try {
      const record = decodeNativeRecord(payload, "record");
      expect(Object.getPrototypeOf(record)).toBeNull();
      expect(record.id).toBe("own-id");
      expect(record.title).toBe("Soft Focus");
      expect(Object.hasOwn(payload, "artist")).toBe(false);
      expect(isOwnDataRecord(payload) ? payload.artist : undefined).toBe(
        "polluted-artist",
      );
      expect(record.artist).toBeUndefined();
      expect(record.secret).toBeUndefined();
      expect(getterCalls).toBe(0);
    } finally {
      Reflect.deleteProperty(Object.prototype, "artist");
    }
  });

  it("decodes only dense arrays containing own data elements", () => {
    let getterCalls = 0;
    const accessorEntries = ["safe"];
    Object.defineProperty(accessorEntries, "0", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("array getter must not run");
      },
    });
    const inheritedEntries: NativeValue[] = [];
    inheritedEntries.length = 1;
    const inheritedEntriesPrototype = Object.create(Array.prototype);
    Object.defineProperty(inheritedEntriesPrototype, "0", {
      configurable: true,
      value: "inherited",
    });
    Object.setPrototypeOf(inheritedEntries, inheritedEntriesPrototype);
    const proxyEntries = new Proxy(
      ["safe"],
      {
        get() {
          getterCalls += 1;
          throw new Error("proxy getter must not run");
        },
        getOwnPropertyDescriptor() {
          throw new Error("descriptor inspection denied");
        },
      },
    );
    const decodeEntry = (entry: NativeValue, context: string) =>
      decodeNativeString(entry, context, 16);

    expect(() =>
      decodeNativeArray(accessorEntries, "entries", 4, decodeEntry)
    ).toThrow("Invalid native response for entries[0]");
    expect(() =>
      decodeNativeArray(inheritedEntries, "entries", 4, decodeEntry)
    ).toThrow("Invalid native response for entries[0]");
    expect(() =>
      decodeNativeArray(proxyEntries, "entries", 4, decodeEntry)
    ).toThrow("Invalid native response for entries");
    expect(getterCalls).toBe(0);
  });

  it("bounds strings by UTF-8 bytes and rejects control characters", () => {
    expect(decodeNativeString("éé", "text", 4)).toBe("éé");
    expect(() => decodeNativeString("ééé", "text", 4)).toThrow(
      "text up to 4 bytes",
    );
    expect(() => decodeNativeString("safe\u0000unsafe", "text", 32)).toThrow(
      "Invalid native response for text",
    );
  });

  it("allows only credential-free Bandcamp and bcbits HTTPS URLs", () => {
    expect(
      decodeNativeBandcampUrl(
        "https://artist.bandcamp.com/album/release",
        "itemUrl",
      ),
    ).toBe("https://artist.bandcamp.com/album/release");
    expect(
      decodeNativeBandcampUrl(
        "https://t4.bcbits.com/stream/example/mp3-128",
        "streamUrl",
      ),
    ).toBe("https://t4.bcbits.com/stream/example/mp3-128");
    expect(() =>
      decodeNativeBandcampUrl("https://example.com/audio", "streamUrl")
    ).toThrow("verified Bandcamp HTTPS URL");
    expect(() =>
      decodeNativeBandcampUrl(
        "https://token@artist.bandcamp.com/album/release",
        "itemUrl",
      )
    ).toThrow("verified Bandcamp HTTPS URL");
    expect(
      decodeNativeBandcampUrl(
        "https://artist.bandcamp.com:443/album/release",
        "itemUrl",
      ),
    ).toBe("https://artist.bandcamp.com:443/album/release");
    expect(() =>
      decodeNativeBandcampUrl(
        "https://artist.bandcamp.com:8443/path",
        "itemUrl",
      )
    ).toThrow("verified Bandcamp HTTPS URL");
    expect(() =>
      decodeNativeBandcampUrl(
        "https://t4.bcbits.com:444/stream/example/mp3-128",
        "streamUrl",
      )
    ).toThrow("verified Bandcamp HTTPS URL");
  });

  it("accepts only Tauri's void response values", () => {
    expect(decodeNativeVoid(undefined, "command")).toBeUndefined();
    expect(decodeNativeVoid(null, "command")).toBeUndefined();
    expect(() => decodeNativeVoid({}, "command")).toThrow(
      "Invalid native response for command",
    );
  });
});

describe("Tauri invoke boundary", () => {
  it("uses fixed commands and decodes every data-bridge response", async () => {
    const invocations: Array<{
      command: string;
      args: InvokeArgs | undefined;
    }> = [];
    mockIPC((command, args) => {
      invocations.push({ command, args });
      switch (command) {
        case "has_connection":
          return true;
        case "load_library_cache":
        case "disconnect":
          return null;
        case "connect":
        case "fetch_library": {
          const progress = invokeRecord(args).onProgress;
          if (progress instanceof Channel) {
            progress.onmessage({
              kind: "page",
              pageIndex: 0,
              loaded: 1,
              albums: [nativeAlbum],
            });
          }
          return [nativeAlbum];
        }
        case "fetch_album":
          return [nativeTrack];
        case "fetch_favorites":
          return {
            albumIds: [nativeAlbum.id],
            songIds: [nativeTrack.id],
            albums: [nativeAlbum],
            tracks: [nativeTrack],
          };
        case "set_favorite":
          return {
            accepted: true,
            verification: "notRequired",
            favorite: true,
          };
        case "reconcile_favorite_tracks":
          return {
            tracks: [nativeTrack],
            unstarredIds: [],
            unavailableTrackCount: 0,
          };
        case "fetch_playlists":
          return [nativePlaylist];
        case "fetch_playlist":
        case "create_playlist":
        case "update_playlist":
          return nativePlaylistDetail;
        case "delete_playlist":
          return null;
        case "daily_articles":
          return {
            results: [nativeArticle],
            page: 2,
            hasMore: false,
          };
        case "daily_article":
          return nativeArticle;
        case "get_stream_url":
          return "https://t4.bcbits.com/stream/boundary/mp3-128";
        default:
          throw new Error(`Unexpected native command: ${command}`);
      }
    });
    const onPage = vi.fn();

    await expect(hasConnection()).resolves.toBe(true);
    await expect(loadLibraryCache()).resolves.toBeUndefined();
    const albums = await connectBandcamp(
      { username: "listener", password: "subsonic-token" },
      onPage,
    );
    await expect(disconnect()).resolves.toBeUndefined();
    await expect(
      fetchLibrary(onPage, { forceFull: true }),
    ).resolves.toHaveLength(1);
    await expect(fetchAlbum(albums[0])).resolves.toHaveLength(1);
    await expect(fetchFavorites()).resolves.toMatchObject({
      albumIds: ["album-1"],
      songIds: ["song-1"],
    });
    await expect(setFavorite({
      id: "album-1",
      kind: "album",
      favorite: true,
    })).resolves.toMatchObject({ accepted: true });
    await expect(reconcileFavoriteTracks([
      { id: "song-1", albumId: "album-1" },
    ])).resolves.toMatchObject({ unavailableTrackCount: 0 });
    await expect(fetchPlaylists()).resolves.toEqual([nativePlaylist]);
    await expect(fetchPlaylist("playlist-1")).resolves.toMatchObject({
      id: "playlist-1",
    });
    await expect(createPlaylist("Night drives", ["song-1"])).resolves
      .toMatchObject({ id: "playlist-1" });
    await expect(updatePlaylist({
      playlistId: "playlist-1",
      songIdsToAdd: ["song-1"],
    })).resolves.toMatchObject({ id: "playlist-1" });
    await expect(deletePlaylist("playlist-1")).resolves.toBeUndefined();
    await expect(
      fetchDailyArticles("best-jazz", 2),
    ).resolves.toMatchObject({ page: 2 });
    await expect(
      fetchDailyArticle("best-jazz", "patient-music"),
    ).resolves.toMatchObject({ articleSection: "best-jazz" });
    await expect(fetchStreamUrl("boundary-track")).resolves.toBe(
      "https://t4.bcbits.com/stream/boundary/mp3-128",
    );

    expect(onPage).toHaveBeenCalledWith(
      expect.objectContaining({
        albums: [expect.objectContaining({ palette: expect.any(Array) })],
      }),
    );
    expect(invocations.map(({ command }) => command)).toEqual([
      "has_connection",
      "load_library_cache",
      "connect",
      "disconnect",
      "fetch_library",
      "fetch_album",
      "fetch_favorites",
      "set_favorite",
      "reconcile_favorite_tracks",
      "fetch_playlists",
      "fetch_playlist",
      "create_playlist",
      "update_playlist",
      "delete_playlist",
      "daily_articles",
      "daily_article",
      "get_stream_url",
    ]);
    const fetchLibraryInvocation = invocations.find(
      ({ command }) => command === "fetch_library",
    );
    expect(invokeRecord(fetchLibraryInvocation?.args).forceFull).toBe(true);
  });

  it("preserves native failures and rejects malformed successes", async () => {
    const nativeFailure = new Error("Bandcamp request failed");
    mockIPC(() => Promise.reject(nativeFailure));
    await expect(fetchPlaylists()).rejects.toBe(nativeFailure);

    mockIPC(() => ({ playlists: [] }));
    await expect(fetchPlaylists()).rejects.toThrow(
      "Invalid native response for fetch_playlists",
    );
  });
});
