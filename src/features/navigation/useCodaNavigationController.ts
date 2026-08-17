import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState, type RefObject } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { LibraryArtistFallback } from "@/features/library/useLibraryBrowseController";
import type { PreparedArtistSearch } from "@/features/library/useLibraryRouteSearchController";
import { discoverArtistUrl } from "@/discover";
import { openBandcampUrl } from "@/lib";
import { artistKey, type ArtistGroup } from "@/libraryBrowse";
import { cachedAlbumTracks } from "@/libraryQueries";
import { isAbsent, isOwnDataRecord, type OwnDataValue } from "@/ownData";
import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { resolveRadioChapterLibraryTargets } from "@/radioNavigation";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import { radioSeriesByTitle } from "@/radioSeries";
import {
  isDiscoverReleaseId,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseRadioSeriesIdParam,
  parseRadioShowIdParam,
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
  type DiscoverReleaseId,
} from "@/routing/routeContracts";
import type { CodaPrimaryView } from "@/routing/routeMeta";
import type {
  Album,
  DiscoverRelease,
  RadioChapter,
  RadioShowSummary,
  Track,
} from "@/types";
import { transitionCodaView } from "@/viewTransitions";
import type { AppSidebarDestination } from "@/AppSidebar";

import { awaitRouteCommit, type RouteCommitOutcome } from "./routeCommit";
import type { RenderedNavigationRouter } from "./routeNavigationAdapters";
import type {
  DetailNavigationController,
  DiscoverDetailNavigationRequest,
} from "./useDetailNavigation";
import type { CodaRouteDestination } from "./useRouteDestination";

export type DiscoverDetailNavigation = Readonly<{
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
  | Readonly<{ kind: "series"; seriesId: number }>
  | Readonly<{ kind: "show"; show: RadioShowSummary }>;

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

function routerLocationPath(location: {
  href?: string;
  pathname?: string;
}): string {
  if (location.pathname) return location.pathname;
  const href = location.href ?? "";
  const queryIndex = href.indexOf("?");
  return queryIndex >= 0 ? href.slice(0, queryIndex) : href;
}

function routerLocationSearch(location: {
  href?: string;
  pathname?: string;
  search?: OwnDataValue;
}): OwnDataValue {
  return location.search;
}

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

export type CodaNavigationRuntime = Readonly<{
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

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function routeCloseFailureCopy(outcome: "failed" | "timeout"): string {
  switch (outcome) {
    case "failed":
      return "Could not go back. Try again.";
    case "timeout":
      return "Going back took too long. Try again.";
    default:
      return assertNever(outcome);
  }
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
        current.detail.seriesId === parseRadioSeriesIdParam(request.seriesId)
      );
    case "show":
      if (path === `/radio/shows/${request.show.id}`) return true;
      return (
        current.detail?.kind === "radio-show" &&
        current.detail.showId === parseRadioShowIdParam(request.show.id)
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
  const routerPath = routerLocationPath(router.state.location);
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
        .catch((cause) => notify(errorMessage(cause), "bad"));
    },
    [detailNavigation, notify],
  );

  const openExternal = useCallback(
    (url: string) => {
      void openBandcampUrl(url).catch((cause) =>
        notify(errorMessage(cause).replace(/^Error:\s*/, ""), "bad"),
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
          .catch((cause) => notify(errorMessage(cause), "bad"));
        return;
      }

      const {
        albumId,
        artist,
        sourceTrack,
        sourceTrigger = currentNavigationTrigger(),
      } = request;
      if (sourceTrack?.id.startsWith("daily:")) {
        const artistUrl = sourceTrack.dailySource?.artistUrl;
        if (!artistUrl) {
          notify(`Could not open ${artist} on Bandcamp`, "bad");
          return;
        }
        openExternal(artistUrl);
        return;
      }
      if (sourceTrack?.id.startsWith("discover:")) {
        const release = sourceTrack.discoverRelease;
        if (!release || release.id !== sourceTrack.albumId) {
          notify(`Could not open ${artist} on Bandcamp`, "bad");
          return;
        }
        openDiscoverArtist(release);
        return;
      }
      if (artist === BANDCAMP_RADIO_PROVIDER) {
        void detailNavigation.transitionPrimary(async (token) => {
          if (!token.isCurrent()) return;
          clearSelectedAlbum();
          setSelectedArtistFallbackSnapshot(undefined);
          await awaitRouteCommit(router, () =>
            navigate({ to: "/radio", viewTransition: false }),
          );
        });
        return;
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
        .catch((cause) => notify(errorMessage(cause), "bad"));
    },
    [
      albums,
      clearSelectedAlbum,
      destination.collectionSearch,
      detailNavigation,
      navigate,
      notify,
      openDiscoverArtist,
      openExternal,
      prepareArtistSearch,
      router,
    ],
  );

  const openTrackAlbum = useCallback(
    (track: Track, sourceTrigger?: HTMLElement) => {
      if (track.id.startsWith("daily:")) {
        const itemUrl = track.dailySource?.itemUrl;
        if (!itemUrl) {
          notify(`Could not open ${track.album} on Bandcamp`, "bad");
          return;
        }
        openExternal(itemUrl);
        return;
      }
      if (track.id.startsWith("discover:")) {
        const release = track.discoverRelease;
        if (!release || release.id !== track.albumId) {
          notify(`Could not open ${track.album} from Discover`, "bad");
          return;
        }
        openDiscoverDetail(release, sourceTrigger, track.id);
        return;
      }
      if (track.id.startsWith("radio:")) {
        clearSelectedAlbum();
        const showId = radioShowIdFromTrackId(track.id);
        if (showId !== undefined) {
          void navigate({
            params: {
              showId: stringifyRadioShowIdParam(parseRadioShowIdParam(showId)),
            },
            to: "/radio/shows/$showId",
          });
          return;
        }
        const series = radioSeriesByTitle(track.album);
        if (series) {
          void navigate({
            params: {
              seriesId: stringifyRadioSeriesIdParam(
                parseRadioSeriesIdParam(series.id),
              ),
            },
            to: "/radio/series/$seriesId",
          });
          return;
        }
        void navigate({ to: "/radio" });
        return;
      }
      const album = albums.find((candidate) => candidate.id === track.albumId);
      if (album) {
        openAlbum(album, sourceTrigger);
        return;
      }
      notify(`Could not find ${track.album} in this library`, "bad");
    },
    [
      albums,
      clearSelectedAlbum,
      navigate,
      notify,
      openAlbum,
      openDiscoverDetail,
      openExternal,
    ],
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
      .catch((cause) => notify(errorMessage(cause), "bad"));
  }, [currentTrack, detailNavigation, notify]);

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
            await awaitRouteCommit(router, () =>
              navigate({ to: "/radio", viewTransition: false }),
            );
            return;
          case "series":
            await awaitRouteCommit(router, () =>
              navigate({
                params: {
                  seriesId: stringifyRadioSeriesIdParam(
                    parseRadioSeriesIdParam(request.seriesId),
                  ),
                },
                to: "/radio/series/$seriesId",
                viewTransition: false,
              }),
            );
            return;
          case "show":
            await awaitRouteCommit(router, () =>
              navigate({
                params: {
                  showId: stringifyRadioShowIdParam(
                    parseRadioShowIdParam(request.show.id),
                  ),
                },
                to: "/radio/shows/$showId",
                viewTransition: false,
              }),
            );
            return;
          default:
            return assertNever(request);
        }
      }, "page-forward");
    },
    [clearSelectedAlbum, destination, navigate, router, routerPath],
  );

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
        if (outcome === "failed" || outcome === "timeout") {
          notify(routeCloseFailureCopy(outcome), "bad");
        }
        return outcome;
      } catch (cause) {
        notify(errorMessage(cause), "bad");
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
        notify(errorMessage(cause), "bad");
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
          routerLocationSearch(router.state.location),
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
              : { kind: "series", seriesId },
          ),
        openShow: (show) => openRadio({ kind: "show", show }),
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

  return useMemo(
    () => {
      const navigationState: CodaNavigationState =
        discoverDetail && selectedArtistFallback
          ? { discoverDetail, selectedArtistFallback }
          : discoverDetail
            ? { discoverDetail }
            : selectedArtistFallback
              ? { selectedArtistFallback }
              : {};
      return {
        commands,
        scrollRootRef: detailNavigation.scrollRootRef,
        state: navigationState,
      };
    },
    [
      commands,
      detailNavigation.scrollRootRef,
      discoverDetail,
      selectedArtistFallback,
    ],
  );
}
