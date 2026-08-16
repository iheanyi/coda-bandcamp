import { vi } from "vitest";

import { resetDetailNavigation } from "@/detailNavigation";
import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import type { CodaScreen } from "@/routing/routeMeta";
import {
  installDocumentViewTransitionHarness,
  type TestDocumentViewTransition,
  type TestDocumentViewTransitionCapture,
} from "@/test/documentViewTransitionHarness";
import type { CodaViewTransitionKind } from "@/viewTransitions";

import type { RenderedRouterEvent } from "./routeNavigationAdapters";
import type {
  CodaDetailDestination,
  CodaRouteDestination,
} from "./useRouteDestination";

type RenderListener = (event: RenderedRouterEvent) => void;

type ControllerHarnessState = {
  afterTransitionUpdate: (() => void) | undefined;
  captureTransition: ((kind: CodaViewTransitionKind) => void) | undefined;
  renderedListener: RenderListener | undefined;
  viewTransition: ReturnType<typeof installDocumentViewTransitionHarness> | undefined;
};

export const controllerHarness: ControllerHarnessState = {
  afterTransitionUpdate: undefined,
  captureTransition: undefined,
  renderedListener: undefined,
  viewTransition: undefined,
};

export const controllerMocks = {
  navigate: vi.fn(),
  nextRenderKey: 2,
  router: {
    history: {
      back: vi.fn(),
      canGoBack: vi.fn(() => false),
    },
    state: {
      location: { state: { __TSR_key: "entry-1" } },
    },
    subscribe: vi.fn(),
  },
};

export const controllerRuntime = {
  navigate: controllerMocks.navigate,
  router: controllerMocks.router,
};

const collectionSearch = validateCollectionSearch({});
const discoverSearch = validateDiscoverSearch({});

export function destination(
  detail: CodaDetailDestination | undefined,
  locationKey: string,
): CodaRouteDestination {
  let screen: CodaScreen = "collection";
  if (detail) screen = detail.kind;
  const libraryRouteInput = deriveLibraryRouteInput({
    albumId: detail?.kind === "album" ? detail.albumId : undefined,
    artistKey: detail?.kind === "artist" ? detail.artistKey : undefined,
    screen,
    search: collectionSearch,
    sourceAlbumId: detail?.kind === "artist" ? detail.sourceAlbumId : undefined,
  });

  const routeDestination = {
    collectionSearch,
    discoverSearch,
    libraryRouteInput,
    locationKey,
    nowPlayingOpen: detail?.kind === "now-playing",
    primaryView:
      detail?.kind === "discover-release"
        ? "discover"
        : detail?.kind === "playlist"
          ? "playlists"
          : detail?.kind === "radio-series" || detail?.kind === "radio-show"
            ? "radio"
            : "library",
    screen,
  } satisfies CodaRouteDestination;
  if (!detail) return routeDestination;
  return { ...routeDestination, detail };
}

export function albumCard(albumId: string) {
  const card = document.createElement("article");
  card.dataset.albumCard = albumId;
  const cover = document.createElement("div");
  cover.dataset.slot = "cover";
  const artworkLink = document.createElement("a");
  artworkLink.href = `#/collection/albums/${albumId}`;
  artworkLink.dataset.albumOpen = albumId;
  artworkLink.dataset.navigationSlot = "artwork";
  const playButton = document.createElement("button");
  playButton.textContent = "Play";
  const titleLink = document.createElement("a");
  titleLink.href = `#/collection/albums/${albumId}`;
  titleLink.dataset.albumOpen = albumId;
  titleLink.dataset.navigationSlot = "title";
  const titleTarget = document.createElement("span");
  titleTarget.dataset.codaAlbumTitleTarget = albumId;
  const title = document.createElement("span");
  title.dataset.slot = "overflow-marquee-text";
  title.textContent = "Soft Focus";
  titleTarget.append(title);
  titleLink.append(titleTarget);
  card.append(cover, artworkLink, playButton, titleLink);
  document.body.append(card);
  return { artworkLink, card, cover, playButton, title, titleLink };
}

export function artistCard(artistKey: string) {
  const link = document.createElement("a");
  link.href = `#/collection/artists/${artistKey}`;
  link.dataset.artistOpen = artistKey;
  link.dataset.codaArtistCard = "";
  link.dataset.navigationSlot = `artist-card:${artistKey}`;
  const cover = document.createElement("div");
  cover.dataset.slot = "cover";
  const name = document.createElement("span");
  name.dataset.codaArtistNameTarget = artistKey;
  const nameText = document.createElement("span");
  nameText.dataset.slot = "overflow-marquee-text";
  nameText.textContent = "Night Archive";
  name.append(nameText);
  link.append(cover, name);
  document.body.append(link);
  return { cover, link, name, nameText };
}

export function discoverCard(releaseId: string) {
  const card = document.createElement("article");
  card.dataset.discoverReleaseCard = releaseId;
  const artwork = document.createElement("div");
  artwork.dataset.codaDiscoverArtwork = releaseId;
  const artworkLink = document.createElement("a");
  artworkLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
  artworkLink.dataset.navigationSlot = "discover-artwork";
  artwork.append(artworkLink);
  const titleLink = document.createElement("a");
  titleLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
  titleLink.dataset.navigationSlot = "discover-title";
  const title = document.createElement("span");
  title.dataset.codaDiscoverTitle = releaseId;
  title.textContent = "Blue Hours";
  titleLink.append(title);
  card.append(artwork, titleLink);
  document.body.append(card);
  return { artwork, artworkLink, card, title, titleLink };
}

export function libraryScrollSurface(scrollTop = 0): HTMLElement {
  const scrollRoot = document.createElement("main");
  scrollRoot.dataset.codaLibraryScroll = "";
  scrollRoot.scrollTop = scrollTop;
  document.body.append(scrollRoot);
  return scrollRoot;
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

export function emitRenderedLocation(locationKey: string): void {
  controllerHarness.renderedListener?.({
    toLocation: { state: { __TSR_key: locationKey } },
  });
}

export function latestViewTransition(): TestDocumentViewTransition | undefined {
  return controllerHarness.viewTransition?.transitions.at(-1);
}

export function resetControllerHarness(autoFinish = true): void {
  controllerHarness.viewTransition?.restore();
  resetDetailNavigation();
  controllerHarness.afterTransitionUpdate = undefined;
  controllerHarness.captureTransition = undefined;
  controllerHarness.renderedListener = undefined;
  controllerMocks.nextRenderKey = 2;
  controllerMocks.router.state.location.state.__TSR_key = "entry-1";
  controllerMocks.navigate.mockReset().mockImplementation(async () => {
    const nextKey = `entry-${controllerMocks.nextRenderKey++}`;
    controllerMocks.router.state.location.state.__TSR_key = nextKey;
    emitRenderedLocation(nextKey);
  });
  controllerMocks.router.history.back.mockReset();
  controllerMocks.router.history.canGoBack.mockReset().mockReturnValue(false);
  controllerMocks.router.subscribe
    .mockReset()
    .mockImplementation((event: string, listener: RenderListener) => {
      if (event === "onRendered") {
        controllerHarness.renderedListener = listener;
      }
      return () => {
        if (controllerHarness.renderedListener === listener) {
          controllerHarness.renderedListener = undefined;
        }
      };
    });
  controllerHarness.viewTransition = installDocumentViewTransitionHarness({
    autoFinish,
    onCapture: (capture: TestDocumentViewTransitionCapture) => {
      if (capture.kind) controllerHarness.captureTransition?.(capture.kind);
    },
    onUpdated: () => {
      controllerHarness.afterTransitionUpdate?.();
    },
  });
}

export function cleanupControllerHarness(): void {
  controllerHarness.viewTransition?.restore();
  controllerHarness.viewTransition = undefined;
  resetDetailNavigation();
  document.body.replaceChildren();
}
