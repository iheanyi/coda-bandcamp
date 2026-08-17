import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Channel, type InvokeArgs } from "@tauri-apps/api/core";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { StrictMode } from "react";
import { afterAll, beforeEach, vi } from "vitest";

import { CodaMotionProvider } from "@/MotionProvider";
import { notifyToast } from "@/components/ui/toastManager";
import { createLibrarySessionController } from "@/features/library-session";
import {
  clearRuntimeCaches,
  type LibraryCacheSnapshot,
  type LibrarySyncProgress,
} from "@/lib";
import { isBooleanValue, type OwnDataRecord, type OwnDataValue } from "@/ownData";
import { createCodaMemoryRouter } from "@/router";
import { validateDiscoverSearch } from "@/routing/routeContracts";
import {
  installTauriEventPluginTestInternals,
  readTauriInvokeArguments,
  tauriNumber,
  tauriString,
} from "@/test/tauriInvoke";
import type {
  Album,
  ConnectionInput,
  FavoriteCollection,
  FavoriteInput,
  FavoriteMutationResult,
  PlaylistDetail,
  PlaylistSummary,
  Track,
} from "@/types";

export const mocks = {
  beginLastFmAuthorization: vi.fn(),
  checkpointPlayerState: vi.fn(),
  clearPlayerState: vi.fn(),
  completeLastFmAuthorization: vi.fn(),
  connectBandcamp: vi.fn(),
  disconnect: vi.fn(),
  disconnectLastFm: vi.fn(),
  fetchAlbum:
    vi.fn<
      (
        album: Album,
        options?: Readonly<{ forceRefresh?: boolean }>,
      ) => Promise<Track[]>
    >(),
  fetchDiscover: vi.fn(),
  fetchLibrary: vi.fn(),
  fetchFavorites: vi.fn(),
  fetchPlaylist: vi.fn<(playlistId: string) => Promise<PlaylistDetail>>(),
  fetchPlaylists: vi.fn<() => Promise<PlaylistSummary[]>>(),
  fetchRadioShow: vi.fn(),
  fetchRadioShows: vi.fn(),
  fetchStreamUrl: vi.fn(),
  getLastFmStatus: vi.fn(),
  hasConnection: vi.fn(),
  loadLibraryCache: vi.fn(),
  loadPlayerState: vi.fn(),
  openLastFmAuthorization: vi.fn(),
  openBandcampUrl: vi.fn(),
  reconcileFavoriteTracks: vi.fn(),
  scrobbleLastFm: vi.fn(),
  savePlayerState: vi.fn(),
  setFavorite: vi.fn(),
  updateLastFmNowPlaying: vi.fn(),
};

let nextCoverOrderingSequence = 1n;

function takeCoverOrderingReceipt() {
  const sequence = nextCoverOrderingSequence;
  nextCoverOrderingSequence += 1n;
  return { sequence: sequence.toString() };
}

type DiscoverCommandInput = OwnDataRecord;

type ConnectionInputPayload = OwnDataRecord;

type RadioArchiveRequest = {
  cursor?: string;
  seriesId?: number;
};

type AppBridgeArguments = Readonly<{
  albumId?: OwnDataValue;
  checkpoint?: OwnDataValue;
  durationSeconds?: OwnDataValue;
  event?: OwnDataValue;
  forceFull?: OwnDataValue;
  forceRefresh?: OwnDataValue;
  input?: OwnDataValue;
  onProgress?: OwnDataValue;
  playing?: OwnDataValue;
  positionSeconds?: OwnDataValue;
  state?: OwnDataValue;
  tracks?: OwnDataValue;
}>;

type ScrobbleCommandInput = OwnDataRecord;

const bridgeAlbums = new Map<string, Album>();
const bridgeStreamUrls = new Map<string, string>();

export type TestMediaSession<Metadata> = {
  metadata: Metadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: (
    action: MediaSessionAction,
    handler: MediaSessionActionHandler | null,
  ) => void;
  setPositionState: (state?: MediaPositionState) => void;
};

export function resizeObserverEntry(
  target: Element,
  bounds: DOMRectReadOnly,
): ResizeObserverEntry {
  const size = {
    blockSize: bounds.height,
    inlineSize: bounds.width,
  };
  return {
    borderBoxSize: [size],
    contentBoxSize: [size],
    contentRect: bounds,
    devicePixelContentBoxSize: [size],
    target,
  };
}

function isDiscoverCommandInput(
  value: OwnDataValue,
): value is DiscoverCommandInput {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

function isConnectionInputPayload(
  value: OwnDataValue,
): value is ConnectionInputPayload {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

function isScrobbleCommandInput(
  value: OwnDataValue,
): value is ScrobbleCommandInput {
  return value !== null && Object(value) === value && !Array.isArray(value);
}

function readAppBridgeArguments(
  args: InvokeArgs | undefined,
): AppBridgeArguments & ReturnType<typeof readTauriInvokeArguments> {
  const common = readTauriInvokeArguments(args);
  if (
    args === undefined ||
    Array.isArray(args) ||
    args instanceof ArrayBuffer ||
    args instanceof Uint8Array
  ) {
    return common;
  }
  // SAFETY: App test invoke bags are JSON-compatible command arguments.
  return {
    ...common,
    albumId: args.albumId as OwnDataValue,
    checkpoint: args.checkpoint as OwnDataValue,
    durationSeconds: args.durationSeconds as OwnDataValue,
    event: args.event as OwnDataValue,
    forceFull: args.forceFull as OwnDataValue,
    forceRefresh: args.forceRefresh as OwnDataValue,
    playing: args.playing as OwnDataValue,
    positionSeconds: args.positionSeconds as OwnDataValue,
    state: args.state as OwnDataValue,
    tracks: args.tracks as OwnDataValue,
  };
}

function connectionInput(value: OwnDataValue): ConnectionInput {
  if (!isConnectionInputPayload(value)) {
    throw new TypeError("App connection input is invalid");
  }
  return {
    password: tauriString(value.password, "password"),
    username: tauriString(value.username, "username"),
  };
}

function registerTracks(nextTracks: readonly Track[]): void {
  for (const track of nextTracks) {
    if (track.streamUrl) bridgeStreamUrls.set(track.id, track.streamUrl);
  }
}

function registerAlbums(albums: readonly Album[]): void {
  for (const release of albums) {
    bridgeAlbums.set(release.id, release);
    if (release.tracks) registerTracks(release.tracks);
  }
}

function libraryProgressReceiver<Value>(
  value: Value,
): ((progress: LibrarySyncProgress) => void) | undefined {
  return value instanceof Channel
    ? (progress) => {
        registerAlbums(progress.albums);
        value.onmessage({
          albums: progress.albums,
          kind: "page",
          loaded: progress.loaded,
          pageIndex: progress.pageIndex,
        });
      }
    : undefined;
}

async function nativeLibrarySnapshot(): Promise<
  (LibraryCacheSnapshot & { version: 1 }) | null
> {
  const snapshot = await mocks.loadLibraryCache();
  if (!snapshot) return null;
  registerAlbums(snapshot.albums);
  return { ...snapshot, version: 1 };
}

function installAppBridge(): void {
  let nextCallbackId = 1;
  installTauriEventPluginTestInternals();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      convertFileSrc: (path: string, protocol: string) => `${protocol}:${path}`,
      invoke: async (command: string, args?: InvokeArgs) => {
        const values = readAppBridgeArguments(args);
        switch (command) {
          case "connect": {
            const albums = await mocks.connectBandcamp(
              connectionInput(values.input),
              libraryProgressReceiver(values.onProgress),
            );
            registerAlbums(albums);
            return albums;
          }
          case "has_connection":
            return mocks.hasConnection();
          case "load_library_cache":
            return nativeLibrarySnapshot();
          case "fetch_library": {
            const albums = await mocks.fetchLibrary(
              libraryProgressReceiver(values.onProgress),
              { forceFull: values.forceFull === true },
            );
            registerAlbums(albums);
            return albums;
          }
          case "fetch_album": {
            const albumId = tauriString(values.albumId, "albumId");
            const release = bridgeAlbums.get(albumId);
            if (!release) {
              throw new Error(`Missing App album fixture: ${albumId}`);
            }
            const nextTracks = await (values.forceRefresh === true
              ? mocks.fetchAlbum(release, { forceRefresh: true })
              : mocks.fetchAlbum(release));
            registerTracks(nextTracks);
            return nextTracks;
          }
          case "disconnect":
            return (await mocks.disconnect()) ?? null;
          case "discover": {
            const input = values.input;
            if (!isDiscoverCommandInput(input)) {
              throw new TypeError("App Discover input is invalid");
            }
            return mocks.fetchDiscover(
              validateDiscoverSearch({ sort: input.sort, tag: input.tag }),
              tauriString(input.cursor, "cursor"),
            );
          }
          case "fetch_favorites": {
            const favorites = await mocks.fetchFavorites();
            registerAlbums(favorites.albums);
            registerTracks(favorites.tracks);
            return favorites;
          }
          case "set_favorite":
            return mocks.setFavorite(values.input);
          case "reconcile_favorite_tracks":
            return mocks.reconcileFavoriteTracks(values.tracks);
          case "fetch_playlist": {
            const playlist = await mocks.fetchPlaylist(
              tauriString(values.playlistId, "playlistId"),
            );
            registerTracks(playlist.tracks);
            return playlist;
          }
          case "fetch_playlists":
            return mocks.fetchPlaylists();
          case "get_stream_url":
            return mocks.fetchStreamUrl(tauriString(values.trackId, "trackId"));
          case "player_state_contract_version":
            return 2;
          case "record_player_state_diagnostic":
            return undefined;
          case "load_player_state":
            return (await mocks.loadPlayerState()) ?? null;
          case "save_player_state":
            return mocks.savePlayerState(values.state);
          case "checkpoint_player_state":
            return mocks.checkpointPlayerState(values.checkpoint);
          case "clear_player_state":
            return mocks.clearPlayerState();
          case "lastfm_status":
            return mocks.getLastFmStatus();
          case "lastfm_begin_auth":
            return mocks.beginLastFmAuthorization();
          case "lastfm_complete_auth":
            return mocks.completeLastFmAuthorization(
              tauriString(values.token, "token"),
            );
          case "lastfm_disconnect":
            return mocks.disconnectLastFm();
          case "lastfm_update_now_playing":
            return mocks.updateLastFmNowPlaying(values.input);
          case "lastfm_scrobble": {
            if (!isScrobbleCommandInput(values.input)) {
              throw new TypeError("App Last.fm scrobble input is invalid");
            }
            return mocks.scrobbleLastFm(
              values.input.track,
              tauriNumber(values.input.timestamp, "timestamp"),
            );
          }
          case "invalidate_cover_art":
            return takeCoverOrderingReceipt();
          case "plugin:event|listen":
            return 1;
          case "plugin:event|unlisten":
            return undefined;
          case "plugin:opener|open_url": {
            const url = tauriString(values.url, "url");
            return new URL(url).hostname === "www.last.fm"
              ? mocks.openLastFmAuthorization(url)
              : mocks.openBandcampUrl(url);
          }
          case "plugin:updater|check":
            return null;
          case "radio_show":
            return mocks.fetchRadioShow(tauriNumber(values.showId, "showId"));
          case "radio_shows": {
            const request: RadioArchiveRequest = {};
            if (values.cursor !== undefined) {
              request.cursor = tauriString(values.cursor, "cursor");
            }
            if (values.seriesId !== undefined) {
              request.seriesId = tauriNumber(values.seriesId, "seriesId");
            }
            return mocks.fetchRadioShows(request);
          }
          default:
            throw new Error(`Unexpected App command: ${command}`);
        }
      },
      transformCallback: () => nextCallbackId++,
      unregisterCallback: () => undefined,
    },
  });
}

type RenderAppOptions = Readonly<{
  connectedLibrary?: readonly Album[];
  initialEntries?: readonly string[];
  strict?: boolean;
}>;

export function renderApp(options: boolean | RenderAppOptions = false) {
  const {
    connectedLibrary,
    initialEntries = ["/collection"],
    strict = false,
  } = isBooleanValue(options) ? { strict: options } : options;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const librarySession = createLibrarySessionController({
    notify: notifyToast,
    queryClient,
  });
  if (connectedLibrary) {
    librarySession.commands.acceptConnectedLibrary(connectedLibrary, {
      announce: false,
    });
  }
  const router = createCodaMemoryRouter(
    queryClient,
    initialEntries,
    librarySession,
  );
  const app = (
    <CodaMotionProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </CodaMotionProvider>
  );
  const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
  return { ...view, librarySession, queryClient, router };
}

export async function findAudioElement(container: HTMLElement) {
  return waitFor(() => {
    const audio = container.querySelector<HTMLAudioElement>("audio");
    if (!audio) throw new Error("Expected the persistent audio element");
    return audio;
  });
}

export function getNavigationSlotLink(name: string, navigationSlot: string) {
  const link = screen
    .getAllByRole("link", { name })
    .find((candidate) => candidate.dataset.navigationSlot === navigationSlot);
  if (!link) {
    throw new Error(`Expected ${name} in navigation slot ${navigationSlot}`);
  }
  return link;
}

export async function startArtistShuffle(artistName = "Night Archive") {
  fireEvent.click(screen.getByRole("button", { name: /Artists\s*\d/ }));
  fireEvent.click(
    await screen.findByRole("link", {
      name: `Browse ${artistName}`,
    }),
  );
  const heading = await screen.findByRole("heading", { name: artistName });
  const artistHero = heading.closest("section");
  if (!artistHero) throw new Error("Expected the artist heading in its hero");
  fireEvent.click(within(artistHero).getByRole("button", { name: "Shuffle" }));
}

export const tracks: Track[] = [
  {
    id: "track-1",
    title: "First Light",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 180,
    track: 1,
    streamUrl: "https://t4.bcbits.com/stream/first/mp3-128",
    palette: ["#777", "#222"],
  },
  {
    id: "track-2",
    title: "Afterimage",
    artist: "Night Archive",
    album: "Soft Focus",
    albumId: "album-1",
    duration: 210,
    track: 2,
    streamUrl: "https://t4.bcbits.com/stream/after/mp3-128",
    palette: ["#777", "#222"],
  },
];

export const album: Album = {
  id: "album-1",
  title: "Soft Focus",
  artist: "Night Archive",
  songCount: tracks.length,
  duration: tracks.reduce((total, track) => total + track.duration, 0),
  genre: "Ambient",
  tracks,
  palette: ["#777", "#222"],
};

export const albumFavorites: FavoriteCollection = {
  albumIds: [album.id],
  songIds: [],
  albums: [album],
  tracks: [],
};

export const trackFavorites: FavoriteCollection = {
  albumIds: [],
  songIds: [tracks[0].id],
  albums: [],
  tracks: [tracks[0]],
};

export const single: Album = {
  id: "single-1",
  title: "Streetlight",
  artist: "Glass Taxi",
  songCount: 1,
  duration: 164,
  genre: "Electronic",
  tracks: [
    {
      id: "single-track-1",
      title: "Streetlight",
      artist: "Glass Taxi",
      album: "Streetlight",
      albumId: "single-1",
      duration: 164,
      track: 1,
      streamUrl: "https://t4.bcbits.com/stream/streetlight/mp3-128",
      palette: ["#968", "#221"],
    },
  ],
  palette: ["#968", "#221"],
};

export function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

beforeEach(() => {
  bridgeAlbums.clear();
  bridgeStreamUrls.clear();
  clearRuntimeCaches();
  installAppBridge();
  window.localStorage.clear();
  mocks.beginLastFmAuthorization.mockReset();
  mocks.checkpointPlayerState.mockReset().mockResolvedValue(true);
  mocks.clearPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.completeLastFmAuthorization.mockReset();
  mocks.connectBandcamp.mockReset();
  mocks.disconnect.mockReset().mockResolvedValue(undefined);
  mocks.disconnectLastFm.mockReset();
  mocks.fetchAlbum.mockReset().mockResolvedValue(tracks);
  mocks.fetchDiscover.mockReset().mockResolvedValue({
    results: [
      {
        id: "discover:release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        artworkUrl: "https://f4.bcbits.com/img/blue-hours.jpg",
        featuredTrack: {
          id: "discover:preview-1",
          title: "Glass Lines",
          duration: 201,
          streamUrl: "https://t4.bcbits.com/stream/blue-hours",
        },
      },
    ],
    resultCount: 1,
    hasMore: false,
  });
  mocks.fetchLibrary.mockReset();
  mocks.fetchFavorites.mockReset().mockResolvedValue({
    albumIds: [],
    songIds: [],
    albums: [],
    tracks: [],
  });
  mocks.fetchPlaylist.mockReset();
  mocks.fetchPlaylists.mockReset().mockResolvedValue([]);
  mocks.fetchRadioShow.mockReset().mockResolvedValue({
    id: 979,
    subtitle: "The Coda Broadcast",
    title: "Bandcamp Weekly",
    description: "A broadcast from Bandcamp.",
    publishedAt: "2026-07-20T12:00:00Z",
    duration: 3_600,
    streamUrl: "https://t4.bcbits.com/stream/radio-979-refreshed/mp3-128",
    artworkUrl: "https://f4.bcbits.com/img/radio-979.jpg",
    chapters: [
      { title: "Opening signal", artist: "Bandcamp Radio", timecode: 0 },
      {
        title: "Second signal",
        artist: "Night Archive",
        album: "Night Signals",
        timecode: 60,
        artworkUrl: "https://f4.bcbits.com/img/second-signal.jpg",
        itemUrl: "https://nightarchive.bandcamp.com/track/second-signal",
        artistUrl: "https://nightarchive.bandcamp.com",
        albumUrl: "https://nightarchive.bandcamp.com/album/night-signals",
      },
    ],
  });
  mocks.fetchRadioShows.mockReset().mockResolvedValue({
    results: [
      {
        id: 979,
        subtitle: "The Coda Broadcast",
        title: "Bandcamp Weekly",
        description: "A broadcast from Bandcamp.",
        publishedAt: "2026-07-20T12:00:00Z",
      },
    ],
    hasMore: false,
  });
  mocks.fetchStreamUrl
    .mockReset()
    .mockImplementation(
      async (trackId: string) =>
        bridgeStreamUrls.get(trackId) ??
        `https://t4.bcbits.com/stream/${encodeURIComponent(trackId)}/mp3-128`,
    );
  mocks.getLastFmStatus.mockReset().mockResolvedValue({
    configured: true,
    connected: false,
  });
  mocks.hasConnection.mockReset();
  mocks.loadLibraryCache.mockReset().mockResolvedValue(undefined);
  mocks.loadPlayerState.mockReset().mockResolvedValue(undefined);
  mocks.openLastFmAuthorization.mockReset().mockResolvedValue(undefined);
  mocks.openBandcampUrl.mockReset().mockResolvedValue(undefined);
  mocks.scrobbleLastFm.mockReset().mockResolvedValue(undefined);
  mocks.savePlayerState.mockReset().mockResolvedValue(undefined);
  mocks.reconcileFavoriteTracks.mockReset().mockResolvedValue({
    tracks: [],
    unstarredIds: [],
    unavailableTrackCount: 0,
  });
  mocks.setFavorite
    .mockReset()
    .mockImplementation(
      async (input: FavoriteInput): Promise<FavoriteMutationResult> => {
        const result: FavoriteMutationResult = {
          accepted: true,
          verification: input.kind === "album" ? "notRequired" : "verified",
          favorite: input.favorite,
        };
        if (input.kind === "song") {
          const matchingTrack =
            tracks.find((track) => track.id === input.id) ?? tracks[0];
          if (!matchingTrack) {
            throw new Error(`Missing fixture track ${input.id}`);
          }
          const favoriteTrack: Track = { ...matchingTrack };
          if (input.favorite) {
            favoriteTrack.starredAt = "2026-08-12T18:01:00Z";
          }
          result.track = favoriteTrack;
        }
        return result;
      },
    );
  mocks.updateLastFmNowPlaying.mockReset().mockResolvedValue(undefined);
  mocks.hasConnection.mockResolvedValue(false);
});

afterAll(() => {
  Reflect.deleteProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__");
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
});
