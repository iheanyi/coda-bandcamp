import type { DiscoverReleaseId } from "@/routing/routeContracts";

import type {
  AlbumDetailNavigationRequest,
  ArtistDetailNavigationRequest,
  DetailNavigationRequest,
  DiscoverDetailNavigationRequest,
  NowPlayingNavigationRequest,
} from "./useDetailNavigationController";
import type { CodaRouteDestination } from "./useRouteDestination";
import {
  acquireTemporaryAttribute,
  acquireTemporaryClass,
  acquireTemporaryStyleProperty,
  combineMarkerReleases,
} from "./temporaryDomMarkers";

export type PreparedDetailSource = Readonly<{
  applyMarkers: () => () => void;
  sharedElementOwner?: string;
  sourceTrigger?: HTMLElement;
}>;

function currentNavigationTrigger(): HTMLElement | undefined {
  return document.activeElement instanceof HTMLElement
    ? document.activeElement
    : undefined;
}

function interactiveTrigger(
  trigger: HTMLElement | undefined,
): HTMLElement | undefined {
  return (
    trigger?.closest<HTMLElement>("a[href], button, [role=button]") ?? trigger
  );
}

function inertPreparedSource(
  sourceTrigger?: HTMLElement,
): PreparedDetailSource {
  return {
    applyMarkers: () => () => {},
    ...(sourceTrigger ? { sourceTrigger } : {}),
  };
}

function forcePaintedAncestors(element: HTMLElement): () => void {
  const releases: Array<() => void> = [];
  let candidate: HTMLElement | null = element;
  while (candidate && !candidate.matches("[data-coda-library-scroll]")) {
    if (
      window
        .getComputedStyle(candidate)
        .getPropertyValue("content-visibility") === "auto"
    ) {
      releases.push(
        acquireTemporaryStyleProperty(
          candidate,
          "content-visibility",
          "visible",
        ),
      );
    }
    candidate = candidate.parentElement;
  }
  return combineMarkerReleases(releases);
}

function anchorRoutePath(
  sourceTrigger: HTMLElement | undefined,
): string | undefined {
  if (!(sourceTrigger instanceof HTMLAnchorElement)) return undefined;
  const href = sourceTrigger.getAttribute("href");
  if (!href) return undefined;
  try {
    const url = new URL(href, document.baseURI);
    const routePath = url.hash.startsWith("#/")
      ? url.hash.slice(1).split("?", 1)[0]
      : url.pathname;
    return routePath ? decodeURIComponent(routePath) : undefined;
  } catch {
    return undefined;
  }
}

function anchorTargetsEntity(
  sourceTrigger: HTMLElement | undefined,
  routePrefix: string,
  entityId: string,
): sourceTrigger is HTMLAnchorElement {
  return anchorRoutePath(sourceTrigger) === `${routePrefix}${entityId}`;
}

function anchorTargetsAlbum(
  sourceTrigger: HTMLElement | undefined,
  albumId: string,
): sourceTrigger is HTMLAnchorElement {
  return anchorTargetsEntity(sourceTrigger, "/collection/albums/", albumId);
}

function anchorTargetsArtist(
  sourceTrigger: HTMLElement | undefined,
  artistKey: string,
): sourceTrigger is HTMLAnchorElement {
  return anchorTargetsEntity(sourceTrigger, "/collection/artists/", artistKey);
}

function anchorTargetsDiscoverRelease(
  sourceTrigger: HTMLElement | undefined,
  releaseId: string,
): sourceTrigger is HTMLAnchorElement {
  return anchorTargetsEntity(sourceTrigger, "/discover/releases/", releaseId);
}

function anchorTargetsNowPlaying(
  sourceTrigger: HTMLElement | undefined,
): sourceTrigger is HTMLAnchorElement {
  return anchorRoutePath(sourceTrigger) === "/now-playing";
}

function prepareAlbumSource(
  request: AlbumDetailNavigationRequest,
): PreparedDetailSource {
  const sourceTrigger = interactiveTrigger(
    request.sourceTrigger ?? currentNavigationTrigger(),
  );
  if (
    !anchorTargetsAlbum(sourceTrigger, request.albumId) ||
    sourceTrigger?.dataset.albumOpen !== request.albumId
  ) {
    return inertPreparedSource(sourceTrigger);
  }

  const sourceCard = sourceTrigger.closest<HTMLElement>("[data-album-card]");
  if (sourceCard?.dataset.albumCard !== request.albumId) {
    return inertPreparedSource(sourceTrigger);
  }
  const sourceArtwork =
    sourceCard.querySelector<HTMLElement>("[data-slot=cover]") ?? undefined;
  const titleTarget = sourceCard.querySelector<HTMLElement>(
    "[data-coda-album-title-target]",
  );
  const staticTitle = titleTarget?.querySelector<HTMLElement>(
    '[data-slot="overflow-marquee-text"]',
  );
  const sourceTitle =
    titleTarget?.dataset.codaAlbumTitleTarget === request.albumId
      ? staticTitle
      : undefined;

  return {
    applyMarkers: () =>
      combineMarkerReleases([
        ...(sourceArtwork
          ? [acquireTemporaryClass(sourceArtwork, "coda-album-artwork-source")]
          : []),
        ...(sourceTitle
          ? [
              acquireTemporaryAttribute(
                sourceTitle,
                "data-coda-album-title-source",
                request.albumId,
              ),
            ]
          : []),
      ]),
    ...(sourceArtwork
      ? { sharedElementOwner: "coda-album-artwork" }
      : sourceTitle
        ? { sharedElementOwner: "coda-album-title" }
        : {}),
    ...(sourceTrigger ? { sourceTrigger } : {}),
  };
}

export function markAlbumReturnDestination(
  sourceTrigger: HTMLElement | undefined,
  albumId: string,
): () => void {
  if (
    !sourceTrigger ||
    sourceTrigger.dataset.albumOpen !== albumId ||
    !anchorTargetsAlbum(sourceTrigger, albumId)
  ) {
    return () => {};
  }

  const sourceCard = sourceTrigger.closest<HTMLElement>("[data-album-card]");
  if (sourceCard?.dataset.albumCard !== albumId) return () => {};

  const sourceArtwork =
    sourceCard.querySelector<HTMLElement>("[data-slot=cover]") ?? undefined;
  const titleTarget = sourceCard.querySelector<HTMLElement>(
    "[data-coda-album-title-target]",
  );
  const sourceTitle =
    titleTarget?.dataset.codaAlbumTitleTarget === albumId
      ? (titleTarget.querySelector<HTMLElement>(
          '[data-slot="overflow-marquee-text"]',
        ) ?? titleTarget)
      : undefined;

  return combineMarkerReleases([
    forcePaintedAncestors(sourceCard),
    ...(sourceArtwork
      ? [
          acquireTemporaryAttribute(
            sourceArtwork,
            "data-coda-album-artwork-return",
            albumId,
          ),
        ]
      : []),
    ...(sourceTitle
      ? [
          acquireTemporaryAttribute(
            sourceTitle,
            "data-coda-album-title-return",
            albumId,
          ),
        ]
      : []),
  ]);
}

function prepareArtistSource(
  request: ArtistDetailNavigationRequest,
): PreparedDetailSource {
  const sourceTrigger = interactiveTrigger(
    request.sourceTrigger ?? currentNavigationTrigger(),
  );
  const existingArtistKey = sourceTrigger?.dataset.artistOpen;
  const isArtistCard =
    anchorTargetsArtist(sourceTrigger, request.artistKey) &&
    sourceTrigger.dataset.codaArtistCard !== undefined &&
    existingArtistKey === request.artistKey;
  const isArtistNameLink =
    anchorTargetsArtist(sourceTrigger, request.artistKey) &&
    sourceTrigger.dataset.codaArtistCard === undefined &&
    (existingArtistKey === undefined ||
      existingArtistKey === request.artistKey);
  if (!sourceTrigger || (!isArtistCard && !isArtistNameLink)) {
    return inertPreparedSource(sourceTrigger);
  }

  // The validated entity identity stays with a metadata link after its route
  // unmounts so a virtualized replacement can be selected on Back.
  if (isArtistNameLink) sourceTrigger.dataset.artistOpen = request.artistKey;
  const sourceArtwork = isArtistCard
    ? (sourceTrigger.querySelector<HTMLElement>("[data-slot=cover]") ??
      undefined)
    : undefined;
  const artistNameTarget = isArtistCard
    ? sourceTrigger.querySelector<HTMLElement>("[data-coda-artist-name-target]")
    : undefined;
  const inlineArtistNameTarget = isArtistNameLink
    ? Array.from(
        sourceTrigger.querySelectorAll<HTMLElement>(
          "[data-coda-artist-name-target]",
        ),
      ).find(
        (candidate) =>
          candidate.dataset.codaArtistNameTarget === request.artistKey,
      )
    : undefined;
  const staticInlineArtistName =
    inlineArtistNameTarget?.querySelector<HTMLElement>(
      '[data-slot="overflow-marquee-text"]',
    );
  const sourceName = isArtistCard
    ? artistNameTarget?.dataset.codaArtistNameTarget === request.artistKey
      ? artistNameTarget
      : undefined
    : (staticInlineArtistName ?? inlineArtistNameTarget ?? sourceTrigger);

  return {
    applyMarkers: () =>
      combineMarkerReleases([
        ...(sourceArtwork
          ? [
              acquireTemporaryAttribute(
                sourceArtwork,
                "data-coda-artist-artwork-source",
                request.artistKey,
              ),
            ]
          : []),
        ...(sourceName
          ? [
              acquireTemporaryAttribute(
                sourceName,
                "data-coda-artist-name-source",
                request.artistKey,
              ),
            ]
          : []),
      ]),
    ...(sourceArtwork
      ? { sharedElementOwner: "coda-artist-artwork" }
      : sourceName
        ? { sharedElementOwner: "coda-artist-name" }
        : {}),
    sourceTrigger,
  };
}

export function markArtistReturnDestination(
  sourceTrigger: HTMLElement | undefined,
  artistKey: string,
): () => void {
  if (
    !sourceTrigger ||
    sourceTrigger.dataset.artistOpen !== artistKey ||
    !anchorTargetsArtist(sourceTrigger, artistKey)
  ) {
    return () => {};
  }

  const sourceArtwork =
    sourceTrigger.dataset.codaArtistCard !== undefined
      ? (sourceTrigger.querySelector<HTMLElement>("[data-slot=cover]") ??
        undefined)
      : undefined;
  const nameWrapper =
    Array.from(
      sourceTrigger.querySelectorAll<HTMLElement>(
        "[data-coda-artist-name-target]",
      ),
    ).find(
      (candidate) => candidate.dataset.codaArtistNameTarget === artistKey,
    ) ?? sourceTrigger;
  const nameTarget =
    nameWrapper.querySelector<HTMLElement>(
      '[data-slot="overflow-marquee-text"]',
    ) ?? nameWrapper;

  return combineMarkerReleases([
    forcePaintedAncestors(sourceTrigger),
    ...(sourceArtwork
      ? [
          acquireTemporaryAttribute(
            sourceArtwork,
            "data-coda-artist-artwork-return",
            artistKey,
          ),
        ]
      : []),
    acquireTemporaryAttribute(
      nameTarget,
      "data-coda-artist-name-return",
      artistKey,
    ),
  ]);
}

function discoverCardSource(
  request: DiscoverDetailNavigationRequest,
  sourceTrigger: HTMLElement | undefined,
): PreparedDetailSource | undefined {
  if (!anchorTargetsDiscoverRelease(sourceTrigger, request.releaseId)) {
    return undefined;
  }
  const sourceCard = sourceTrigger?.closest<HTMLElement>(
    "[data-discover-release-card]",
  );
  if (sourceCard?.dataset.discoverReleaseCard !== request.releaseId) {
    return undefined;
  }
  const sourceArtworkCandidate = sourceCard.querySelector<HTMLElement>(
    "[data-coda-discover-artwork]",
  );
  const sourceTitleCandidate = sourceCard.querySelector<HTMLElement>(
    "[data-coda-discover-title]",
  );
  const sourceArtwork =
    sourceArtworkCandidate?.dataset.codaDiscoverArtwork === request.releaseId
      ? sourceArtworkCandidate
      : undefined;
  const sourceTitle =
    sourceTitleCandidate?.dataset.codaDiscoverTitle === request.releaseId
      ? sourceTitleCandidate
      : undefined;

  if (sourceTrigger && sourceArtwork?.contains(sourceTrigger)) {
    sourceTrigger.dataset.navigationSlot = "discover-artwork";
  } else if (
    sourceTrigger &&
    sourceTitle?.closest("a[href]") === sourceTrigger
  ) {
    sourceTrigger.dataset.navigationSlot = "discover-title";
  }

  return {
    applyMarkers: () =>
      combineMarkerReleases([
        ...(sourceArtwork
          ? [
              acquireTemporaryAttribute(
                sourceArtwork,
                "data-coda-discover-artwork-source",
                request.releaseId,
              ),
            ]
          : []),
        ...(sourceTitle
          ? [
              acquireTemporaryAttribute(
                sourceTitle,
                "data-coda-discover-title-source",
                request.releaseId,
              ),
            ]
          : []),
      ]),
    ...(sourceArtwork
      ? { sharedElementOwner: "coda-discover-artwork" }
      : sourceTitle
        ? { sharedElementOwner: "coda-discover-title" }
        : {}),
    ...(sourceTrigger ? { sourceTrigger } : {}),
  };
}

function nowPlayingDiscoverSource(
  request: DiscoverDetailNavigationRequest,
  sourceTrigger: HTMLElement | undefined,
  destination: CodaRouteDestination,
): PreparedDetailSource | undefined {
  if (
    destination.detail?.kind !== "now-playing" ||
    !request.sourceTrackId ||
    !sourceTrigger?.hasAttribute("data-player-album-link") ||
    !anchorTargetsDiscoverRelease(sourceTrigger, request.releaseId)
  ) {
    return undefined;
  }
  const sourceArtwork = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".now-playing__artwork[data-coda-track-id]",
    ),
  ).find(
    (candidate) => candidate.dataset.codaTrackId === request.sourceTrackId,
  );
  const titleCandidate = sourceTrigger.querySelector<HTMLElement>(
    '[data-slot="overflow-marquee-text"]',
  );
  const sourceTitle =
    titleCandidate?.textContent?.trim() === request.releaseTitle
      ? titleCandidate
      : undefined;

  return {
    applyMarkers: () =>
      combineMarkerReleases([
        ...(sourceArtwork
          ? [
              acquireTemporaryAttribute(
                sourceArtwork,
                "data-coda-discover-artwork-source",
                request.releaseId,
              ),
            ]
          : []),
        ...(sourceTitle
          ? [
              acquireTemporaryAttribute(
                sourceTitle,
                "data-coda-discover-title-source",
                request.releaseId,
              ),
            ]
          : []),
      ]),
    ...(sourceArtwork
      ? { sharedElementOwner: "coda-discover-artwork" }
      : sourceTitle
        ? { sharedElementOwner: "coda-discover-title" }
        : {}),
    sourceTrigger,
  };
}

function compactPlayerDiscoverSource(
  request: DiscoverDetailNavigationRequest,
  sourceTrigger: HTMLElement | undefined,
): PreparedDetailSource | undefined {
  if (
    !request.sourceTrackId ||
    !sourceTrigger?.hasAttribute("data-player-album-link") ||
    !anchorTargetsDiscoverRelease(sourceTrigger, request.releaseId)
  ) {
    return undefined;
  }
  const sourceTitle = sourceTrigger.querySelector<HTMLElement>(
    '[data-slot="overflow-marquee-text"]',
  );
  if (sourceTitle?.textContent?.trim() !== request.releaseTitle) {
    return undefined;
  }
  sourceTrigger.dataset.navigationSlot = "player-album";
  return {
    applyMarkers: () =>
      acquireTemporaryAttribute(
        sourceTitle,
        "data-coda-discover-title-source",
        request.releaseId,
      ),
    sharedElementOwner: "coda-discover-title",
    sourceTrigger,
  };
}

function prepareDiscoverSource(
  request: DiscoverDetailNavigationRequest,
  destination: CodaRouteDestination,
): PreparedDetailSource {
  const sourceTrigger = interactiveTrigger(
    request.sourceTrigger ?? currentNavigationTrigger(),
  );
  return (
    discoverCardSource(request, sourceTrigger) ??
    nowPlayingDiscoverSource(request, sourceTrigger, destination) ??
    compactPlayerDiscoverSource(request, sourceTrigger) ??
    inertPreparedSource(sourceTrigger)
  );
}

export function markDiscoverReturnDestination(
  sourceTrigger: HTMLElement | undefined,
  releaseId: DiscoverReleaseId,
): () => void {
  if (!anchorTargetsDiscoverRelease(sourceTrigger, releaseId)) {
    return () => {};
  }
  const sourceCard = sourceTrigger.closest<HTMLElement>(
    "[data-discover-release-card]",
  );
  if (sourceCard?.dataset.discoverReleaseCard !== releaseId) {
    return () => {};
  }
  const sourceArtworkCandidate = sourceCard.querySelector<HTMLElement>(
    "[data-coda-discover-artwork]",
  );
  const sourceTitleCandidate = sourceCard.querySelector<HTMLElement>(
    "[data-coda-discover-title]",
  );
  const sourceArtwork =
    sourceArtworkCandidate?.dataset.codaDiscoverArtwork === releaseId
      ? sourceArtworkCandidate
      : undefined;
  const sourceTitle =
    sourceTitleCandidate?.dataset.codaDiscoverTitle === releaseId
      ? sourceTitleCandidate
      : undefined;

  return combineMarkerReleases([
    forcePaintedAncestors(sourceCard),
    ...(sourceArtwork
      ? [
          acquireTemporaryAttribute(
            sourceArtwork,
            "data-coda-discover-artwork-return",
            releaseId,
          ),
        ]
      : []),
    ...(sourceTitle
      ? [
          acquireTemporaryAttribute(
            sourceTitle,
            "data-coda-discover-title-return",
            releaseId,
          ),
        ]
      : []),
  ]);
}

function prepareNowPlayingSource(
  request: NowPlayingNavigationRequest,
): PreparedDetailSource {
  const sourceTrigger = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".player__art-link[data-coda-track-id]",
    ),
  ).find(
    (candidate) =>
      candidate.dataset.codaTrackId === request.trackId &&
      anchorTargetsNowPlaying(candidate),
  );
  const sourceTitle = Array.from(
    document.querySelectorAll<HTMLElement>(
      "[data-coda-now-playing-title-compact]",
    ),
  ).find(
    (candidate) =>
      candidate.dataset.codaNowPlayingTitleCompact === request.trackId,
  );

  return {
    applyMarkers: () => () => {},
    ...(sourceTrigger
      ? { sharedElementOwner: "coda-now-playing-artwork", sourceTrigger }
      : sourceTitle
        ? { sharedElementOwner: "coda-now-playing-title" }
        : {}),
  };
}

export function prepareDetailSource(
  request: DetailNavigationRequest,
  destination: CodaRouteDestination,
): PreparedDetailSource {
  switch (request.kind) {
    case "album":
      return prepareAlbumSource(request);
    case "artist":
      return prepareArtistSource(request);
    case "discover-release":
      return prepareDiscoverSource(request, destination);
    case "now-playing":
      return prepareNowPlayingSource(request);
  }
}
