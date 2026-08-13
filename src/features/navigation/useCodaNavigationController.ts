import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState, type RefObject } from "react";

import type { ToastNotifier } from "@/components/ui/toastManager";
import type { LibraryArtistFallback } from "@/features/library/useLibraryBrowseController";
import type { PreparedArtistSearch } from "@/features/library/useLibraryRouteSearchController";
import { openBandcampUrl } from "@/lib";
import { artistKey, type ArtistGroup } from "@/libraryBrowse";
import { cachedAlbumTracks } from "@/libraryQueries";
import { discoverArtistUrl } from "@/discover";
import type { RadioChapterLocalLinks } from "@/RadioChapterMetadata";
import { BANDCAMP_RADIO_PROVIDER } from "@/radioIdentity";
import { radioShowIdFromTrackId } from "@/radioPlayback";
import { resolveRadioChapterLibraryTargets } from "@/radioNavigation";
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

import type { DetailNavigationController } from "./useDetailNavigationController";
import type { CodaRouteDestination } from "./useRouteDestination";

export type DiscoverDetailNavigation = Readonly<{
  previousView: CodaPrimaryView;
  releaseId: DiscoverReleaseId;
  releaseTitle: string;
  returnScrollTop: number;
  returnToNowPlaying: boolean;
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
}>;

const PRIMARY_VIEW_ORDER: Readonly<Record<CodaPrimaryView, number>> = {
  library: 0,
  favorites: 1,
  playlists: 2,
  recent: 3,
  discover: 4,
  daily: 5,
  radio: 6,
};

const PRIMARY_DESTINATION_VIEW: Readonly<
  Record<AppSidebarDestination, CodaPrimaryView>
> = {
  "/collection": "library",
  "/favorites": "favorites",
  "/playlists": "playlists",
  "/recent": "recent",
  "/discover": "discover",
  "/daily": "daily",
  "/radio": "radio",
};

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

function currentNavigationTrigger(): HTMLElement | undefined {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Owns typed destination commands and their bounded return identity. The
 * generated route remains authoritative; state here records only source-side
 * fallback data that cannot be reconstructed from the URL alone.
 */
export function useCodaNavigationController({
  albums,
  clearSelectedAlbum,
  currentTrack,
  destination,
  detailNavigation,
  notify,
  openAlbum,
  prepareArtistSearch,
  queue,
}: CodaNavigationControllerOptions): CodaNavigationController {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedArtistFallbackSnapshot, setSelectedArtistFallbackSnapshot] =
    useState<LibraryArtistFallback>();
  const [discoverDetailSnapshot, setDiscoverDetailSnapshot] =
    useState<DiscoverDetailNavigation>();
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
    return {
      albumId: sourceAlbum.id,
      key: libraryRouteInput.artistKey,
      name: sourceTrack?.artist ?? libraryRouteInput.artistKey,
      ...(sourceTrack
        ? {
            knownTrack: {
              duration: sourceTrack.duration,
              id: sourceTrack.id,
            },
          }
        : {}),
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
      returnToNowPlaying: boolean,
    ) => {
      if (!isDiscoverReleaseId(release.id)) {
        notify(`Could not open ${release.title} from Discover`, "bad");
        return;
      }
      const releaseId = release.id;
      void detailNavigation
        .open({
          kind: "discover-release",
          releaseId,
          releaseTitle: release.title,
          ...(sourceTrackId ? { sourceTrackId } : {}),
          sourceTrigger,
          beforeCommit: () => {
            setDiscoverDetailSnapshot({
              releaseId,
              releaseTitle: release.title,
              previousView: destination.primaryView,
              returnToNowPlaying,
              returnScrollTop:
                detailNavigation.scrollRootRef.current?.scrollTop ?? 0,
            });
          },
        })
        .catch((cause) => notify(errorMessage(cause), "bad"));
    },
    [destination.primaryView, detailNavigation, notify],
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
        void detailNavigation.transitionPrimary(() => {
          clearSelectedAlbum();
          setSelectedArtistFallbackSnapshot(undefined);
          return navigate({ to: "/radio", viewTransition: false });
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
            setSelectedArtistFallbackSnapshot(
              fallbackAlbum
                ? {
                    albumId: fallbackAlbum.id,
                    key,
                    name: artist,
                    ...(sourceTrack
                      ? {
                          knownTrack: {
                            duration: sourceTrack.duration,
                            id: sourceTrack.id,
                          },
                        }
                      : {}),
                  }
                : undefined,
            );
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
        openDiscoverDetail(
          release,
          sourceTrigger,
          track.id,
          destination.nowPlayingOpen,
        );
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
      destination.nowPlayingOpen,
      navigate,
      notify,
      openAlbum,
      openDiscoverDetail,
      openExternal,
    ],
  );

  const openDiscoverRelease = useCallback(
    (release: DiscoverRelease, sourceTrigger: HTMLElement) => {
      openDiscoverDetail(release, sourceTrigger, undefined, false);
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
      void transitionCodaView(() => {
        clearSelectedAlbum();
        switch (request.kind) {
          case "archive":
            return navigate({ to: "/radio" });
          case "series":
            return navigate({
              params: {
                seriesId: stringifyRadioSeriesIdParam(
                  parseRadioSeriesIdParam(request.seriesId),
                ),
              },
              to: "/radio/series/$seriesId",
            });
          case "show":
            return navigate({
              params: {
                showId: stringifyRadioShowIdParam(
                  parseRadioShowIdParam(request.show.id),
                ),
              },
              to: "/radio/shows/$showId",
            });
        }
      }, "page-forward");
    },
    [clearSelectedAlbum, navigate],
  );

  const back = useCallback(
    ({ kind, restoreFocus }: DetailBackRequest) => {
      if (kind === "artist") setSelectedArtistFallbackSnapshot(undefined);
      void detailNavigation
        .back(restoreFocus === undefined ? undefined : { restoreFocus })
        .then(() => {
          if (kind === "discover") setDiscoverDetailSnapshot(undefined);
        })
        .catch((cause) => notify(errorMessage(cause), "bad"));
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

      return {
        track: albumTarget,
        album: albumTarget,
        artist: targetArtist
          ? {
              artistKey: parseArtistKeyParam(artistKey(targetArtist)),
              ...(targetAlbum
                ? { sourceAlbumId: parseAlbumIdParam(targetAlbum.id) }
                : {}),
              onNavigate: (trigger: HTMLAnchorElement) => {
                openArtist({
                  kind: "name",
                  artist: targetArtist,
                  albumId: targetAlbum?.id,
                  sourceTrigger: trigger,
                });
              },
            }
          : undefined,
      };
    },
    [albums, openAlbum, openArtist],
  );

  const resetTransientNavigation = useCallback(() => {
    setSelectedArtistFallbackSnapshot(undefined);
    setDiscoverDetailSnapshot(undefined);
  }, []);

  const beforeDiscoverNavigate = useCallback(() => {
    if (destination.detail?.kind !== "discover-release") return false;
    back({ kind: "discover", restoreFocus: false });
    return true;
  }, [back, destination.detail?.kind]);

  const navigatePrimary = useCallback(
    async ({
      destination: target,
      navigate: commitNavigation,
    }: PrimaryNavigationRequest) => {
      const targetView = PRIMARY_DESTINATION_VIEW[target];
      const kind =
        PRIMARY_VIEW_ORDER[targetView] <
        PRIMARY_VIEW_ORDER[destination.primaryView]
          ? "page-back"
          : "page-forward";
      await transitionCodaView(commitNavigation, kind, {
        routerOwnedPage: true,
      });
    },
    [destination.primaryView],
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
            ...(albumId ? { albumId } : {}),
            ...(sourceTrack ? { sourceTrack } : {}),
            ...(sourceTrigger ? { sourceTrigger } : {}),
          }),
      },
      discover: {
        back: (options) =>
          back({
            kind: "discover",
            ...(options?.restoreFocus === undefined
              ? {}
              : { restoreFocus: options.restoreFocus }),
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
    () => ({
      commands,
      scrollRootRef: detailNavigation.scrollRootRef,
      state: {
        ...(discoverDetail ? { discoverDetail } : {}),
        ...(selectedArtistFallback ? { selectedArtistFallback } : {}),
      },
    }),
    [
      commands,
      detailNavigation.scrollRootRef,
      discoverDetail,
      selectedArtistFallback,
    ],
  );
}
