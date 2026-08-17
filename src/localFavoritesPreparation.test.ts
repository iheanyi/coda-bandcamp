import { afterEach, describe, expect, it, vi } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_VERSION,
  parseLocalFavoritesSerialized,
} from "./localFavorites";
import {
  LocalFavoritesPreparationClient,
  localFavoritesInputMatchesPrepared,
  localFavoritesWorkerPrepared,
  parseLocalFavoritesPreparationRequest,
  parseLocalFavoritesPreparationResponse,
  serializeLocalFavorites,
  serializeValidatedLocalFavorites,
  type LocalFavoritesPreparationRequest,
  type LocalFavoritesWorkerErrorEvent,
  type LocalFavoritesWorkerMessageEvent,
  type LocalFavoritesWorkerMessageErrorEvent,
  type LocalFavoritesWorkerPort,
} from "./localFavoritesPreparation";
import type { OwnDataValue } from "./ownData";
import type { LocalFavoriteCollection, Track } from "./types";

const track: Track = {
  id: "track-1",
  title: "Afterimage",
  artist: "Night Archive",
  album: "Soft Focus",
  albumId: "album-1",
  duration: 240,
  track: 1,
  artworkUrl: "https://t4.bcbits.com/signed-artwork",
  streamUrl: "https://t4.bcbits.com/signed-stream",
  palette: ["#cf6046", "#2f2624"],
};

const favorites: LocalFavoriteCollection = {
  ...emptyLocalFavorites(),
  songIds: [track.id],
  tracks: [track],
};

const runImmediately = (callback: () => void): void => callback();

function parseSerializeRequest(source: LocalFavoriteCollection) {
  const request = parseLocalFavoritesPreparationRequest({
    kind: "serialize-local-favorites",
    requestId: 1,
    favorites: source,
  });
  if (!request || request.kind !== "serialize-local-favorites") {
    throw new Error("Expected a validated serialization request.");
  }
  return request;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

class FakeLocalFavoritesWorker implements LocalFavoritesWorkerPort {
  onmessage: ((event: LocalFavoritesWorkerMessageEvent) => void) | null = null;
  onerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null = null;
  onmessageerror: (
    (event: LocalFavoritesWorkerMessageErrorEvent) => void
  ) | null = null;
  readonly requests: LocalFavoritesPreparationRequest[] = [];
  readonly terminate = vi.fn();

  postMessage(request: LocalFavoritesPreparationRequest): void {
    this.requests.push(request);
  }

  respond(response: OwnDataValue): void {
    this.onmessage?.(
      new MessageEvent<OwnDataValue>("message", { data: response }),
    );
  }
}

describe("local Favorites preparation", () => {
  it("parses and serializes through one reusable worker with correlated results", async () => {
    const worker = new FakeLocalFavoritesWorker();
    const factory = vi.fn(() => worker);
    const client = new LocalFavoritesPreparationClient(factory, runImmediately);
    const serialized = JSON.stringify({
      version: LOCAL_FAVORITES_VERSION,
      ...favorites,
    });

    const parsed = client.parse(serialized);
    const prepared = client.serialize(favorites);

    expect(factory).toHaveBeenCalledOnce();
    expect(worker.requests).toHaveLength(2);
    const parseRequest = worker.requests[0];
    const serializeRequest = worker.requests[1];
    expect(parseRequest.kind).toBe("parse-local-favorites");
    expect(serializeRequest.kind).toBe("serialize-local-favorites");

    worker.respond({
      kind: "local-favorites-serialized",
      requestId: serializeRequest.requestId,
      prepared: serializeLocalFavorites(favorites),
    });
    worker.respond({
      kind: "local-favorites-parsed",
      requestId: parseRequest.requestId,
      favorites: parseLocalFavoritesSerialized(serialized),
    });

    await expect(parsed).resolves.toEqual(expect.objectContaining({
      songIds: ["track-1"],
    }));
    await expect(prepared).resolves.toEqual(expect.objectContaining({
      favorites: expect.objectContaining({ songIds: ["track-1"] }),
    }));
  });

  it("keeps signed runtime URLs out of the prepared durable snapshot", () => {
    const prepared = serializeLocalFavorites(favorites);

    expect(prepared.serialized).not.toContain("signed-artwork");
    expect(prepared.serialized).not.toContain("signed-stream");
    expect(prepared.favorites.tracks[0].artworkUrl).toBeUndefined();
    expect(prepared.favorites.tracks[0].streamUrl).toBeUndefined();
    expect(localFavoritesInputMatchesPrepared(favorites, prepared)).toBe(false);
    expect(
      localFavoritesInputMatchesPrepared(prepared.favorites, prepared),
    ).toBe(true);
  });

  it("takes the worker fast path for a canonical already-sanitized collection", () => {
    const canonical = serializeLocalFavorites(favorites).favorites;
    const request = parseSerializeRequest(canonical);
    const prepared = serializeValidatedLocalFavorites(request.favorites);
    const workerPrepared = localFavoritesWorkerPrepared(
      prepared,
      request.sourceFavorites,
    );

    expect(
      localFavoritesInputMatchesPrepared(request.sourceFavorites, prepared),
    ).toBe(true);
    expect(workerPrepared).toEqual({ serialized: prepared.serialized });
    expect(workerPrepared).not.toHaveProperty("favorites");
  });

  it("returns the sanitized clone when the worker collection actually changed", () => {
    const canonical = serializeLocalFavorites(favorites).favorites;
    const prepared = serializeValidatedLocalFavorites(
      parseSerializeRequest(canonical).favorites,
    );
    const changed: LocalFavoriteCollection = {
      ...canonical,
      songIds: ["track-2"],
      tracks: [{ ...canonical.tracks[0], id: "track-2", title: "Elsewhere" }],
    };
    const workerPrepared = localFavoritesWorkerPrepared(prepared, changed);

    expect(localFavoritesInputMatchesPrepared(changed, prepared)).toBe(false);
    expect(workerPrepared.favorites).toBe(prepared.favorites);
    expect(workerPrepared.serialized).toBe(prepared.serialized);
  });

  it("matches a key-order-only difference against the worker snapshot", () => {
    const canonical = serializeLocalFavorites(favorites).favorites;
    const prepared = serializeValidatedLocalFavorites(
      parseSerializeRequest(canonical).favorites,
    );
    const reordered = {
      radioShows: canonical.radioShows,
      radioShowIds: canonical.radioShowIds,
      tracks: canonical.tracks,
      albums: canonical.albums,
      songIds: canonical.songIds,
      albumIds: canonical.albumIds,
    };

    expect(localFavoritesInputMatchesPrepared(reordered, prepared)).toBe(true);
    expect(localFavoritesWorkerPrepared(prepared, reordered)).not.toHaveProperty(
      "favorites",
    );
    expect(
      localFavoritesInputMatchesPrepared(
        {
          songIds: canonical.songIds,
          albums: canonical.albums,
          tracks: canonical.tracks,
          radioShowIds: canonical.radioShowIds,
          radioShows: canonical.radioShows,
        },
        prepared,
      ),
    ).toBe(false);
  });

  it("validates unknown worker requests and responses before using them", () => {
    expect(parseLocalFavoritesPreparationRequest({
      kind: "parse-local-favorites",
      requestId: 0,
      serialized: "{}",
    })).toBeUndefined();
    expect(parseLocalFavoritesPreparationRequest({
      kind: "serialize-local-favorites",
      requestId: 1,
      favorites: { songIds: "not-an-array" },
    })).toBeUndefined();
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-serialized",
      requestId: 1,
      prepared: {
        favorites: { tracks: "not-an-array" },
        serialized: "{}",
      },
    })).toBeUndefined();
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-error",
      requestId: 1,
      errorName: "Error",
      errorMessage: "",
    })).toBeUndefined();
  });

  it("rejects inherited, accessor, spoofed, null, and oversize messages", () => {
    const inheritedRequest = Object.create({
      kind: "parse-local-favorites",
      requestId: 1,
      serialized: "{}",
    });
    let serializedReads = 0;
    const accessorRequest = {
      kind: "parse-local-favorites",
      requestId: 1,
      get serialized() {
        serializedReads += 1;
        return "{}";
      },
    };
    let coercions = 0;
    const spoofedKind = {
      [Symbol.toPrimitive]() {
        coercions += 1;
        return "parse-local-favorites";
      },
    };

    expect(parseLocalFavoritesPreparationRequest(null)).toBeUndefined();
    expect(parseLocalFavoritesPreparationRequest(inheritedRequest))
      .toBeUndefined();
    expect(parseLocalFavoritesPreparationRequest(accessorRequest))
      .toBeUndefined();
    expect(serializedReads).toBe(0);
    expect(parseLocalFavoritesPreparationRequest({
      kind: spoofedKind,
      requestId: 1,
      serialized: "{}",
    })).toBeUndefined();
    expect(coercions).toBe(0);
    expect(parseLocalFavoritesPreparationRequest({
      kind: "parse-local-favorites",
      requestId: 1,
      serialized: "x".repeat(4 * 1024 * 1024 + 1),
    })).toBeUndefined();
  });

  it("deep-validates worker Favorites before exposing them", () => {
    const inheritedResponse = Object.create({
      kind: "local-favorites-parsed",
      requestId: 1,
      favorites,
    });
    let titleReads = 0;
    const accessorTrack = { ...track };
    Object.defineProperty(accessorTrack, "title", {
      get() {
        titleReads += 1;
        return track.title;
      },
    });

    expect(parseLocalFavoritesPreparationResponse(inheritedResponse))
      .toBeUndefined();
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-parsed",
      requestId: 1,
      favorites: {
        ...favorites,
        tracks: [{ ...track, title: null }],
      },
    })).toBeUndefined();
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-parsed",
      requestId: 1,
      favorites: {
        ...favorites,
        tracks: [accessorTrack],
      },
    })).toBeUndefined();
    expect(titleReads).toBe(0);
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-serialized",
      requestId: 1,
      prepared: {
        serialized: "{}",
        favorites: {
          ...favorites,
          tracks: [{ ...track, palette: ["#000000"] }],
        },
      },
    })).toBeUndefined();
    expect(parseLocalFavoritesPreparationResponse({
      kind: "local-favorites-parsed",
      requestId: 1,
      favorites: {
        ...emptyLocalFavorites(),
        songIds: Array.from(
          { length: 25_001 },
          (_value, index) => `track-${index}`,
        ),
      },
    })).toBeUndefined();
  });

  it("serializes a boundary-validated worker request without a second parse", () => {
    const request = parseLocalFavoritesPreparationRequest({
      kind: "serialize-local-favorites",
      requestId: 1,
      favorites,
    });
    if (!request || request.kind !== "serialize-local-favorites") {
      throw new Error("Expected a validated serialization request.");
    }

    const prepared = serializeValidatedLocalFavorites(request.favorites);

    expect(prepared.favorites.songIds).toEqual(["track-1"]);
    expect(prepared.serialized).not.toContain("signed-artwork");
    expect(parseLocalFavoritesPreparationRequest({
      kind: "serialize-local-favorites",
      requestId: 2,
      favorites: {
        ...favorites,
        tracks: [{ ...track, albumArtist: "invalid\u009f" }],
      },
    })).toBeUndefined();
  });

  it("falls back when a worker returns malformed nested data", async () => {
    const worker = new FakeLocalFavoritesWorker();
    const client = new LocalFavoritesPreparationClient(
      () => worker,
      runImmediately,
    );
    const pending = client.serialize(favorites);
    const request = worker.requests[0];

    worker.respond({
      kind: "local-favorites-serialized",
      requestId: request.requestId,
      prepared: {
        favorites: { tracks: "not-an-array" },
        serialized: "{}",
      },
    });

    await expect(pending).resolves.toEqual(serializeLocalFavorites(favorites));
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("accepts a maximum worker result without re-canonicalizing it on the renderer", async () => {
    const worker = new FakeLocalFavoritesWorker();
    const client = new LocalFavoritesPreparationClient(
      () => worker,
      runImmediately,
    );
    const tracks = Array.from({ length: 25_000 }, (_, index): Track => ({
      id: `t${index}`,
      title: "T",
      artist: "A",
      album: "R",
      albumId: "a",
      duration: 1,
      track: 1,
      palette: ["#000000", "#ffffff"],
    }));
    const maximumFavorites: LocalFavoriteCollection = {
      ...emptyLocalFavorites(),
      songIds: tracks.map((item) => item.id),
      tracks,
    };
    const serialized = JSON.stringify({
      version: LOCAL_FAVORITES_VERSION,
      ...maximumFavorites,
    });
    const pending = client.serialize(maximumFavorites);
    const request = worker.requests[0];

    worker.respond({
      kind: "local-favorites-serialized",
      requestId: request.requestId,
      prepared: {
        serialized,
        favorites: maximumFavorites,
      },
    });

    const prepared = await pending;
    expect(prepared.favorites).toBe(maximumFavorites);
    expect(prepared.serialized).toBe(serialized);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("uses an asynchronous fallback only when workers are unavailable", async () => {
    const client = new LocalFavoritesPreparationClient(() => undefined);
    let settled = false;
    const pending = client.serialize(favorites).then((prepared) => {
      settled = true;
      return prepared;
    });

    await Promise.resolve();
    expect(settled).toBe(false);
    await expect(pending).resolves.toEqual(serializeLocalFavorites(favorites));
  });

  it("falls back for active work and recreates after a transient worker failure", async () => {
    const workers: FakeLocalFavoritesWorker[] = [];
    const factory = vi.fn(() => {
      const worker = new FakeLocalFavoritesWorker();
      workers.push(worker);
      return worker;
    });
    const client = new LocalFavoritesPreparationClient(factory, runImmediately);
    const pending = client.serialize(favorites);
    const failedWorker = workers[0];

    const errorEvent = new ErrorEvent("error", {
      message: "The module worker could not load.",
    });
    const preventDefault = vi.spyOn(errorEvent, "preventDefault");
    failedWorker.onerror?.(errorEvent);

    await expect(pending).resolves.toEqual(serializeLocalFavorites(favorites));
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(failedWorker.terminate).toHaveBeenCalledOnce();

    const parsed = client.parse(serializeLocalFavorites(favorites).serialized);
    expect(factory).toHaveBeenCalledTimes(2);
    const replacement = workers[1];
    const request = replacement.requests[0];
    replacement.respond({
      kind: "local-favorites-parsed",
      requestId: request.requestId,
      favorites,
    });
    await expect(parsed).resolves.toEqual(expect.objectContaining({
      songIds: ["track-1"],
    }));
  });

  it("idle-schedules the maximum favorite-track clone before worker dispatch", () => {
    const worker = new FakeLocalFavoritesWorker();
    let runIdle: (() => void) | undefined;
    const client = new LocalFavoritesPreparationClient(
      () => worker,
      (callback) => {
        runIdle = callback;
      },
    );
    const tracks = Array.from({ length: 25_000 }, (_, index): Track => ({
      ...track,
      id: `track-${index}`,
      track: index + 1,
    }));
    const maximumFavorites: LocalFavoriteCollection = {
      ...emptyLocalFavorites(),
      songIds: tracks.map((item) => item.id),
      tracks,
    };

    void client.serialize(maximumFavorites);

    expect(worker.requests).toHaveLength(0);
    runIdle?.();
    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      kind: "serialize-local-favorites",
      favorites: maximumFavorites,
    });
  });

  it("uses a bounded browser idle window for worker serialization", () => {
    const worker = new FakeLocalFavoritesWorker();
    let runIdle: IdleRequestCallback | undefined;
    const requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      runIdle = callback;
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", requestIdleCallback);
    const client = new LocalFavoritesPreparationClient(() => worker);

    void client.serialize(favorites);

    expect(worker.requests).toHaveLength(0);
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 250,
    });
    runIdle?.({ didTimeout: false, timeRemaining: () => 10 });
    expect(worker.requests).toHaveLength(1);
  });
});
