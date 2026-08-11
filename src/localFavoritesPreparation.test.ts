import { describe, expect, it, vi } from "vitest";
import {
  emptyLocalFavorites,
  LOCAL_FAVORITES_VERSION,
} from "./localFavorites";
import {
  LocalFavoritesPreparationClient,
  parseLocalFavoritesSerialized,
  serializeLocalFavorites,
  type LocalFavoritesPreparationRequest,
  type LocalFavoritesPreparationResponse,
  type LocalFavoritesWorkerErrorEvent,
  type LocalFavoritesWorkerMessageEvent,
  type LocalFavoritesWorkerPort,
} from "./localFavoritesPreparation";
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

class FakeLocalFavoritesWorker implements LocalFavoritesWorkerPort {
  onmessage: ((event: LocalFavoritesWorkerMessageEvent) => void) | null = null;
  onerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null = null;
  onmessageerror: ((event: LocalFavoritesWorkerErrorEvent) => void) | null = null;
  readonly requests: LocalFavoritesPreparationRequest[] = [];
  readonly terminate = vi.fn();

  postMessage(request: LocalFavoritesPreparationRequest): void {
    this.requests.push(request);
  }

  respond(response: LocalFavoritesPreparationResponse): void {
    this.onmessage?.({ data: response });
  }
}

describe("local Favorites preparation", () => {
  it("parses and serializes through one reusable worker with correlated results", async () => {
    const worker = new FakeLocalFavoritesWorker();
    const factory = vi.fn(() => worker);
    const client = new LocalFavoritesPreparationClient(factory);
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
    const stored = JSON.parse(prepared.serialized) as Record<string, unknown>;
    const storedTrack = (stored.tracks as Array<Record<string, unknown>>)[0];

    expect(storedTrack.artworkUrl).toBeUndefined();
    expect(storedTrack.streamUrl).toBeUndefined();
    expect(prepared.favorites.tracks[0].artworkUrl).toBeUndefined();
    expect(prepared.favorites.tracks[0].streamUrl).toBeUndefined();
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
    const client = new LocalFavoritesPreparationClient(factory);
    const pending = client.serialize(favorites);
    const preventDefault = vi.fn();
    const failedWorker = workers[0];

    failedWorker.onerror?.({
      message: "The module worker could not load.",
      preventDefault,
    });

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

  it("delegates the maximum favorite-track collection without preparing it locally", () => {
    const worker = new FakeLocalFavoritesWorker();
    const client = new LocalFavoritesPreparationClient(() => worker);
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

    expect(worker.requests).toHaveLength(1);
    expect(worker.requests[0]).toMatchObject({
      kind: "serialize-local-favorites",
      favorites: maximumFavorites,
    });
  });
});
