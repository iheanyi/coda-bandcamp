import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { PreparedArtistSearch } from "@/features/library/useLibraryRouteSearchController";
import { formatErrorMessage } from "@/formatError";
import { discoverArtistUrl } from "@/discover";
import { openBandcampUrl } from "@/lib";
import {
  artistKey,
  type ArtistGroup,
  type LibraryArtistFallback,
} from "@/libraryBrowse";
import { cachedAlbumTracks } from "@/libraryQueries";
import { isAbsent, isOwnDataRecord, type OwnDataValue } from "@/ownData";
import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { resolveRadioChapterLibraryTargets } from "@/radioNavigation";
import {
  isDiscoverReleaseId,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  type DiscoverReleaseId,
  type RadioSeriesId,
  type RadioShowId,
} from "@/routing/routeContracts";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import {
  trackAlbumDestination,
  trackArtistDestination,
  trackSourceFamily,
} from "@/routing/trackRouteDestinations";
import type {
  Album,
  DiscoverRelease,
  RadioChapter,
  RadioShowSummary,
  Track,
} from "@/types";
import { transitionCodaView } from "@/viewTransitions";
import type { AppSidebarDestination } from "@/AppSidebar";

import {
  awaitRouteCommit,
  renderedLocationPath,
  routeCommitFailureCopy,
  type RouteCommitOutcome,
} from "./routeCommit";
import {
  createRouteNavigationAdapter,
  RADIO_ROUTE_SPEC,
  type RenderedNavigationRouter,
} from "./routeNavigationAdapters";
import type {
  DetailNavigationController,
  DiscoverDetailNavigationRequest,
} from "./useDetailNavigation";
import type { CodaRouteDestination } from "./useRouteDestination";

type DiscoverDetailNavigation = Readonly<{
  releaseId: DiscoverReleaseId;
  releaseTitle: string;
}>;

type ArtistNavigationRequest =
  | Readonly<{
      group: ArtistGroup;
      kind: "group";
      sourceTrigger: HTMLElement;
    }>
  | Readonly<{
      albumId?: string;
      artist: string;
      kind: "name";
      sourceTrack?: Track;
      sourceTrigger?: HTMLElement;
    }>;

type RadioNavigationRequest =
  | Readonly<{ kind: "archive" }>
  | Readonly<{ kind: "series"; seriesId: RadioSeriesId }>
  | Readonly<{ kind: "show"; showId: RadioShowId }>;

type DetailBackRequest = Readonly<{
  kind: "album" | "artist" | "discover" | "now-playing";
  restoreFocus?: boolean;
}>;

type AlbumOpener = (album: Album, sourceTrigger?: HTMLElement) => void;

type PrimaryNavigationRequest = Readonly<{
  destination: AppSidebarDestination;
  navigate: (viewTransition?: boolean) => Promise<void>;
  search?: OwnDataValue;
}>;

const PRIMARY_VIEW_ORDER = {
  library: 0,
  favorites: 1,
  playlists: 2,
  recent: 3,
  discover: 4,
  daily: 5,
  radio: 6,
} satisfies Record<CodaPrimaryView, number>;

const PRIMARY_DESTINATION_VIEW = {
  "/collection": "library",
  "/favorites": "favorites",
  "/playlists": "playlists",
  "/recent": "recent",
  "/discover": "discover",
  "/daily": "daily",
  "/radio": "radio",
} satisfies Record<AppSidebarDestination, CodaPrimaryView>;

function serializedRouteSearch<Value>(value: Value): string {
  if (isAbsent(value)) return "{}";
  if (!isOwnDataRecord(value)) return "\0";
  return JSON.stringify(
    Object.keys(value)
      .sort()
      .flatMap((key) => {
        const entry = value[key];
        return isAbsent(entry) ? [] : [[key, entry]];
      }),
  );
}

function isDiscoverReleasePath(path: string): boolean {
  return path.includes("/discover/releases/");
}

function isDiscoverIndexPath(path: string): boolean {
  return path === "/discover";
}

function isTrackedAppPath(path: string): boolean {
  return (
    path.startsWith("/collection") ||
    path.startsWith("/daily") ||
    path.startsWith("/discover") ||
    path.startsWith("/favorites") ||
    path.startsWith("/now-playing") ||
    path.startsWith("/playlists") ||
    path.startsWith("/radio") ||
    path.startsWith("/recent")
  );
}

function trackAlbumUnavailableMessage(track: Track): string {
  const family = trackSourceFamily(track);
  switch (family) {
    case "daily":
      return `Could not open ${track.album} on Bandcamp`;
    case "discover":
      return `Could not open ${track.album} from Discover`;
    case "radio":
    case "library":
      return `Could not find ${track.album} in this library`;
    default:
      return assertNever(family);
  }
}

export type CodaNavigationControllerOptions = Readonly<{
  albums: readonly Album[];
  clearSelectedAlbum: () => void;
  currentTrack?: Track;
  destination: CodaRouteDestination;
  detailNavigation: DetailNavigationController;
  notify: ToastNotifier;
  openAlbum: AlbumOpener;
  prepareArtistSearch: () => PreparedArtistSearch;
  queue: readonly Track[];
}>;

export type CodaNavigationState = Readonly<{
  discoverDetail?: DiscoverDetailNavigation;
  selectedArtistFallback?: LibraryArtistFallback;
}>;

export type CodaNavigationCommands = Readonly<{
  album: Readonly<{
    back: () => void;
    openFromTrack: (track: Track, sourceTrigger?: HTMLElement) => void;
  }>;
  artist: Readonly<{
    back: () => void;
    openGroup: (group: ArtistGroup, sourceTrigger: HTMLElement) => void;
    openName: (
      artist: string,
      albumId?: string,
      sourceTrack?: Track,
      sourceTrigger?: HTMLElement,
    ) => void;
  }>;
  discover: Readonly<{
    back: (options?: Readonly<{ restoreFocus?: boolean }>) => void;
    openArtist: (release: DiscoverRelease) => void;
    openRelease: (release: DiscoverRelease, sourceTrigger: HTMLElement) => void;
  }>;
  nowPlaying: Readonly<{
    back: () => void;
    open: () => void;
  }>;
  radio: Readonly<{
    chapterLinks: (chapter: RadioChapter) => RadioChapterLocalLinks;
    openExternal: (url: string) => void;
    openSeries: (seriesId?: number) => void;
    openShow: (show: RadioShowSummary) => void;
  }>;
  sidebar: Readonly<{
    beforeDiscoverNavigate: () => boolean;
    navigatePrimary: (request: PrimaryNavigationRequest) => Promise<void>;
  }>;
  resetTransientNavigation: () => void;
}>;

export type CodaNavigationController = Readonly<{
  commands: CodaNavigationCommands;
  scrollRootRef: RefObject<HTMLElement | null>;
  state: CodaNavigationState;
}>;

type CodaNavigationRuntime = Readonly<{
  navigate: ReturnType<typeof useNavigate>;
  router: RenderedNavigationRouter;
}>;

function assertNever(value: never): never {
  throw new TypeError(`Unsupported exhaustive variant: ${String(value)}`);
}

function currentNavigationTrigger(): HTMLElement | undefined {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
}

function isCurrentPrimaryDestination(
  target: AppSidebarDestination,
  path: string,
  committedSearch: OwnDataValue,
  currentSearch: OwnDataValue,
): boolean {
  return (
    path === target &&
    serializedRouteSearch(committedSearch) ===
      serializedRouteSearch(currentSearch)
  );
}

function isCurrentRadioDestination(
  request: RadioNavigationRequest,
  current: CodaRouteDestination,
  path: string,
): boolean {
  switch (request.kind) {
    case "archive":
      return current.screen === "radio" || path === "/radio";
    case "series":
      if (path === `/radio/series/${request.seriesId}`) return true;
      return (
        current.detail?.kind === "radio-series" &&
        current.detail.seriesId === request.seriesId
      );
    case "show":
      if (path === `/radio/shows/${request.showId}`) return true;
      return (
        current.detail?.kind === "radio-show" &&
        current.detail.showId === request.showId
      );
    default:
      return assertNever(request);
  }
}

/**
 * Owns typed destination commands and their bounded return identity. The
 * generated route remains authoritative; state here records only source-side
 * fallback data that cannot be reconstructed from the URL alone.
 */
export function useCodaNavigationController(
  options: CodaNavigationControllerOptions,
): CodaNavigationController {
  const navigate = useNavigate();
  const router = useRouter();
  return useCodaNavigationControllerWithRuntime(options, { navigate, router });
}

export function useCodaNavigationControllerWithRuntime(
  {
    albums,
    clearSelectedAlbum,
    currentTrack,
    destination,
    detailNavigation,
    notify,
    openAlbum,
    prepareArtistSearch,
    queue,
  }: CodaNavigationControllerOptions,
  { navigate, router }: CodaNavigationRuntime,
): CodaNavigationController {
  const queryClient = useQueryClient();
  const [selectedArtistFallbackSnapshot, setSelectedArtistFallbackSnapshot] =
    useState<LibraryArtistFallback>();
  const [discoverDetailSnapshot, setDiscoverDetailSnapshot] =
    useState<DiscoverDetailNavigation>();
  const routerPath = renderedLocationPath(router.state.location);
  const destinationIsDiscoverRelease =
    destination.detail?.kind === "discover-release" ||
    destination.screen === "discover-release";
  const locationIsDiscoverRelease = isDiscoverReleasePath(routerPath);
  const onDiscoverRelease =
    locationIsDiscoverRelease ||
    (destinationIsDiscoverRelease && !isTrackedAppPath(routerPath));
  const lastNonDiscoverReleaseView = useRef<CodaPrimaryView | undefined>(
    onDiscoverRelease ? undefined : destination.primaryView,
  );
  const radioRouteNav = useMemo(
    () => createRouteNavigationAdapter({ navigate, router }, RADIO_ROUTE_SPEC),
    [navigate, router],
  );
  const lastNonDiscoverReleasePath = useRef<string | undefined>(
    onDiscoverRelease ? undefined : routerPath,
  );
  if (!onDiscoverRelease) {
    lastNonDiscoverReleaseView.current = destination.primaryView;
    lastNonDiscoverReleasePath.current = routerPath;
  }
  const libraryRouteInput = destination.libraryRouteInput;

  const selectedArtistFallback = useMemo(() => {
    if (
      libraryRouteInput.kind !== "artist" ||
      !libraryRouteInput.sourceAlbumId
    ) {
      return undefined;
    }
    if (
      selectedArtistFallbackSnapshot?.key === libraryRouteInput.artistKey &&
      selectedArtistFallbackSnapshot.albumId === libraryRouteInput.sourceAlbumId
    ) {
      return selectedArtistFallbackSnapshot;
    }
    const sourceAlbum = albums.find(
      (album) => album.id === libraryRouteInput.sourceAlbumId,
    );
    if (
      !sourceAlbum ||
      artistKey(sourceAlbum.artist) === libraryRouteInput.artistKey
    ) {
      return undefined;
    }
    const sourceTrack = (
      cachedAlbumTracks(queryClient, sourceAlbum) ??
      sourceAlbum.tracks ??
      queue.filter((track) => track.albumId === sourceAlbum.id)
    ).find((track) => artistKey(track.artist) === libraryRouteInput.artistKey);
    if (sourceTrack) {
      return {
        albumId: sourceAlbum.id,
        key: libraryRouteInput.artistKey,
        name: sourceTrack.artist,
        knownTrack: {
          duration: sourceTrack.duration,
          id: sourceTrack.id,
        },
      };
    }
    return {
      albumId: sourceAlbum.id,
      key: libraryRouteInput.artistKey,
      name: libraryRouteInput.artistKey,
    };
  }, [
    albums,
    libraryRouteInput,
    queryClient,
    queue,
    selectedArtistFallbackSnapshot,
  ]);

  const discoverDetail =
    destination.detail?.kind === "discover-release" &&
    discoverDetailSnapshot?.releaseId === destination.detail.releaseId
      ? discoverDetailSnapshot
      : undefined;

  const openDiscoverDetail = useCallback(
    (
      release: DiscoverRelease,
      sourceTrigger: HTMLElement | undefined,
      sourceTrackId: string | undefined,
    ) => {
      if (!isDiscoverReleaseId(release.id)) {
        notify(`Could not open ${release.title} from Discover`, "bad");
        return;
      }
      const releaseId = release.id;
      let detailRequest: DiscoverDetailNavigationRequest = {
        kind: "discover-release",
        releaseId,
        releaseTitle: release.title,
        sourceTrigger,
        beforeCommit: () => {
          setDiscoverDetailSnapshot({
            releaseId,
            releaseTitle: release.title,
          });
        },
      };
      if (sourceTrackId) {
        detailRequest = { ...detailRequest, sourceTrackId };
      }
      void detailNavigation
        .open(detailRequest)
        .catch((cause) => notify(formatErrorMessage(cause), "bad"));
    },
    [detailNavigation, notify],
  );

  const openExternal = useCallback(
    (url: string) => {
      void openBandcampUrl(url).catch((cause) =>
        notify(formatErrorMessage(cause), "bad"),
      );
    },
    [notify],
  );

  const openDiscoverArtist = useCallback(
    (release: DiscoverRelease) => {
      const artistUrl = discoverArtistUrl(release);
      if (!artistUrl) {
        notify(`Could not open ${release.artist} on Bandcamp`, "bad");
        return;
      }
      openExternal(artistUrl);
    },
    [notify, openExternal],
  );

  const openRadio = useCallback(
    (request: RadioNavigationRequest) => {
      if (isCurrentRadioDestination(request, destination, routerPath)) {
        return;
      }
      void transitionCodaView(async (token) => {
        if (!token.isCurrent()) return;
        clearSelectedAlbum();
        switch (request.kind) {
          case "archive":
            await radioRouteNav.goToIndex();
            return;
          case "series":
            await radioRouteNav.goToSeries(request.seriesId);
            return;
          case "show":
            await radioRouteNav.goToShow(request.showId);
            return;
          default:
            return assertNever(request);
        }
      }, "page-forward");
    },
    [clearSelectedAlbum, destination, radioRouteNav, routerPath],
  );

  const openArtist = useCallback(
    (request: ArtistNavigationRequest) => {
      if (request.kind === "group") {
        void detailNavigation
          .open({
            kind: "artist",
            artistKey: parseArtistKeyParam(request.group.key),
            sourceTrigger: request.sourceTrigger,
            beforeCommit: () => {
              setSelectedArtistFallbackSnapshot(undefined);
              clearSelectedAlbum();
            },
          })
          .catch((cause) => notify(formatErrorMessage(cause), "bad"));
        return;
      }

      const {
        albumId,
        artist,
        sourceTrack,
        sourceTrigger = currentNavigationTrigger(),
      } = request;
      const artistDestination = sourceTrack
        ? trackArtistDestination(sourceTrack)
        : artist === BANDCAMP_RADIO_PROVIDER
          ? { kind: "radio" as const }
          : undefined;
      if (artistDestination) {
        switch (artistDestination.kind) {
          case "daily-external-artist":
            openExternal(artistDestination.artistUrl);
            return;
          case "discover-external-artist":
            openDiscoverArtist(artistDestination.release);
            return;
          case "radio-series":
            setSelectedArtistFallbackSnapshot(undefined);
            openRadio({ kind: "series", seriesId: artistDestination.seriesId });
            return;
          case "radio":
            setSelectedArtistFallbackSnapshot(undefined);
            openRadio({ kind: "archive" });
            return;
          case "artist":
            break; // Library flow below stays authoritative (fallback albums, prepared search).
          default:
            return assertNever(artistDestination);
        }
      }

      const key = artistKey(artist);
      const hasReleaseArtist = albums.some(
        (album) => artistKey(album.artist) === key,
      );
      const sourceAlbum = albumId
        ? albums.find((album) => album.id === albumId)
        : undefined;
      const fallbackAlbum =
        sourceAlbum && artistKey(sourceAlbum.artist) !== key
          ? sourceAlbum
          : undefined;
      if (!hasReleaseArtist && !fallbackAlbum) {
        notify(`Could not find a saved release for ${artist}.`, "bad");
        return;
      }

      const preparedArtistSearch = prepareArtistSearch();
      const artistRouteKey = parseArtistKeyParam(key);
      const sourceAlbumId = fallbackAlbum
        ? parseAlbumIdParam(fallbackAlbum.id)
        : undefined;
      void detailNavigation
        .open({
          kind: "artist",
          artistKey: artistRouteKey,
          sourceAlbumId,
          sourceTrigger,
          collectionSearch: preparedArtistSearch.search,
          beforeCommit: () => {
            preparedArtistSearch.commitDeferredReset();
            if (fallbackAlbum) {
              const fallbackSnapshot: LibraryArtistFallback = sourceTrack
                ? {
                    albumId: fallbackAlbum.id,
                    key,
                    name: artist,
                    knownTrack: {
                      duration: sourceTrack.duration,
                      id: sourceTrack.id,
                    },
                  }
                : {
                    albumId: fallbackAlbum.id,
                    key,
                    name: artist,
                  };
              setSelectedArtistFallbackSnapshot(fallbackSnapshot);
            } else {
              setSelectedArtistFallbackSnapshot(undefined);
            }
            clearSelectedAlbum();
          },
        })
        .catch((cause) => notify(formatErrorMessage(cause), "bad"));
    },
    [
      albums,
      clearSelectedAlbum,
      detailNavigation,
      notify,
      openDiscoverArtist,
      openExternal,
      openRadio,
      prepareArtistSearch,
    ],
  );

  const openTrackAlbum = useCallback(
    (track: Track, sourceTrigger?: HTMLElement) => {
      const destination = trackAlbumDestination(track);
      if (!destination) {
        notify(trackAlbumUnavailableMessage(track), "bad");
        return;
      }
      switch (destination.kind) {
        case "album": {
          const album = albums.find(
            (candidate) => candidate.id === destination.albumId,
          );
          if (album) {
            openAlbum(album, sourceTrigger);
            return;
          }
          notify(trackAlbumUnavailableMessage(track), "bad");
          return;
        }
        case "daily-external-item":
          openExternal(destination.itemUrl);
          return;
        case "discover-release":
          openDiscoverDetail(destination.release, sourceTrigger, track.id);
          return;
        case "radio-show":
          openRadio({ kind: "show", showId: destination.showId });
          return;
        case "radio-series":
          openRadio({ kind: "series", seriesId: destination.seriesId });
          return;
        case "radio":
          openRadio({ kind: "archive" });
          return;
        default:
          return assertNever(destination);
      }
    },
    [albums, notify, openAlbum, openDiscoverDetail, openExternal, openRadio],
  );

  const openDiscoverRelease = useCallback(
    (release: DiscoverRelease, sourceTrigger: HTMLElement) => {
      openDiscoverDetail(release, sourceTrigger, undefined);
    },
    [openDiscoverDetail],
  );

  const openNowPlaying = useCallback(() => {
    if (!currentTrack) return;
    void detailNavigation
      .open({ kind: "now-playing", trackId: currentTrack.id })
      .catch((cause) => notify(formatErrorMessage(cause), "bad"));
  }, [currentTrack, detailNavigation, notify]);

  const back = useCallback(
    async ({
      kind,
      restoreFocus,
    }: DetailBackRequest): Promise<RouteCommitOutcome | undefined> => {
      try {
        const outcome = await detailNavigation.back(
          restoreFocus === undefined ? undefined : { restoreFocus },
        );
        if (outcome === "rendered") {
          if (kind === "artist") setSelectedArtistFallbackSnapshot(undefined);
          if (kind === "discover") setDiscoverDetailSnapshot(undefined);
          return outcome;
        }
        if (!outcome) return outcome;
        const message = routeCommitFailureCopy(
          outcome,
          "Going back",
          "Could not go back. Try again.",
        );
        if (message) notify(message, "bad");
        return outcome;
      } catch (cause) {
        notify(formatErrorMessage(cause), "bad");
        return undefined;
      }
    },
    [detailNavigation, notify],
  );

  const radioChapterLinks = useCallback(
    (chapter: RadioChapter): RadioChapterLocalLinks => {
      const targets = resolveRadioChapterLibraryTargets(chapter, albums);
      const targetAlbum = targets.album;
      const targetArtist = targets.artist;
      const albumTarget = targetAlbum
        ? {
            albumId: parseAlbumIdParam(targetAlbum.id),
            onNavigate: (trigger: HTMLAnchorElement) => {
              openAlbum(targetAlbum, trigger);
            },
          }
        : undefined;
      let artistTarget: RadioChapterLocalLinks["artist"];
      if (targetArtist) {
        const onNavigate = (trigger: HTMLAnchorElement) => {
          openArtist({
            kind: "name",
            artist: targetArtist,
            albumId: targetAlbum?.id,
            sourceTrigger: trigger,
          });
        };
        const targetArtistKey = parseArtistKeyParam(artistKey(targetArtist));
        artistTarget = targetAlbum
          ? {
              artistKey: targetArtistKey,
              sourceAlbumId: parseAlbumIdParam(targetAlbum.id),
              onNavigate,
            }
          : {
              artistKey: targetArtistKey,
              onNavigate,
            };
      }

      return {
        track: albumTarget,
        album: albumTarget,
        artist: artistTarget,
      };
    },
    [albums, openAlbum, openArtist],
  );

  const resetTransientNavigation = useCallback(() => {
    setSelectedArtistFallbackSnapshot(undefined);
    setDiscoverDetailSnapshot(undefined);
  }, []);

  const beforeDiscoverNavigate = useCallback(() => {
    if (!onDiscoverRelease) return false;
    const originPath = lastNonDiscoverReleasePath.current;
    if (originPath && isTrackedAppPath(originPath)) {
      if (!isDiscoverIndexPath(originPath)) return false;
    } else if (lastNonDiscoverReleaseView.current !== "discover") {
      return false;
    }
    void (async () => {
      try {
        const outcome = await detailNavigation.back({ restoreFocus: false });
        if (outcome === "rendered") {
          setDiscoverDetailSnapshot(undefined);
          return;
        }
      } catch {
        // Fall through to a real Discover index commit.
      }
      try {
        await navigate({
          search: destination.discoverSearch,
          to: "/discover",
          viewTransition: false,
        });
      } catch (cause) {
        notify(formatErrorMessage(cause), "bad");
      }
    })();
    return true;
  }, [
    destination.discoverSearch,
    detailNavigation,
    navigate,
    notify,
    onDiscoverRelease,
  ]);

  const navigatePrimary = useCallback(
    async ({
      destination: target,
      navigate: commitNavigation,
      search: committedSearch,
    }: PrimaryNavigationRequest) => {
      if (
        isCurrentPrimaryDestination(
          target,
          routerPath,
          committedSearch,
          router.state.location.search,
        )
      ) {
        return;
      }
      const targetView = PRIMARY_DESTINATION_VIEW[target];
      const kind =
        PRIMARY_VIEW_ORDER[targetView] <
        PRIMARY_VIEW_ORDER[destination.primaryView]
          ? "page-back"
          : "page-forward";
      await transitionCodaView(async (token) => {
        if (!token.isCurrent()) return;
        await awaitRouteCommit(router, () => commitNavigation(false));
      }, kind);
    },
    [destination.primaryView, router, routerPath],
  );

  const commands = useMemo<CodaNavigationCommands>(
    () => ({
      album: {
        back: () => back({ kind: "album" }),
        openFromTrack: openTrackAlbum,
      },
      artist: {
        back: () => back({ kind: "artist" }),
        openGroup: (group, sourceTrigger) =>
          openArtist({ group, kind: "group", sourceTrigger }),
        openName: (artist, albumId, sourceTrack, sourceTrigger) =>
          openArtist({
            kind: "name",
            artist,
            albumId,
            sourceTrack,
            sourceTrigger,
          }),
      },
      discover: {
        back: (options) =>
          back({
            kind: "discover",
            restoreFocus: options?.restoreFocus,
          }),
        openArtist: openDiscoverArtist,
        openRelease: openDiscoverRelease,
      },
      nowPlaying: {
        back: () => back({ kind: "now-playing" }),
        open: openNowPlaying,
      },
      radio: {
        chapterLinks: radioChapterLinks,
        openExternal,
        openSeries: (seriesId) =>
          openRadio(
            seriesId === undefined
              ? { kind: "archive" }
              : { kind: "series", seriesId: parseRadioSeriesIdParam(seriesId) },
          ),
        openShow: (show) =>
          openRadio({ kind: "show", showId: parseRadioShowIdParam(show.id) }),
      },
      sidebar: {
        beforeDiscoverNavigate,
        navigatePrimary,
      },
      resetTransientNavigation,
    }),
    [
      back,
      beforeDiscoverNavigate,
      navigatePrimary,
      openArtist,
      openDiscoverArtist,
      openDiscoverRelease,
      openNowPlaying,
      openExternal,
      openRadio,
      openTrackAlbum,
      radioChapterLinks,
      resetTransientNavigation,
    ],
  );

  return useMemo(() => {
    return {
      commands,
      scrollRootRef: detailNavigation.scrollRootRef,
      state: {
        discoverDetail,
        selectedArtistFallback,
      },
    };
  }, [
    commands,
    detailNavigation.scrollRootRef,
    discoverDetail,
    selectedArtistFallback,
  ]);
}
