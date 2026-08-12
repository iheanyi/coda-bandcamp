import { describe, expect, it } from "vitest";

import {
  deriveLibraryRouteInput,
  type LibraryRouteInput,
} from "@/routing/libraryRouteInput";
import {
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  DEFAULT_DISCOVER_ROUTE_SEARCH,
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
} from "@/routing/routeContracts";

import {
  markAlbumReturnDestination,
  markArtistReturnDestination,
  markDiscoverReturnDestination,
  prepareDetailSource,
} from "./detailSourceIdentity";
import type { CodaRouteDestination } from "./useRouteDestination";

function collectionDestination(): CodaRouteDestination {
  const libraryRouteInput: LibraryRouteInput = deriveLibraryRouteInput({
    screen: "collection",
    search: DEFAULT_COLLECTION_ROUTE_SEARCH,
  });
  return {
    collectionSearch: DEFAULT_COLLECTION_ROUTE_SEARCH,
    discoverSearch: DEFAULT_DISCOVER_ROUTE_SEARCH,
    libraryRouteInput,
    locationKey: "collection-entry",
    nowPlayingOpen: false,
    primaryView: "library",
    screen: "collection",
  };
}

function albumSourceCard(albumId: string) {
  const card = document.createElement("article");
  card.dataset.albumCard = albumId;

  const artworkLink = document.createElement("a");
  artworkLink.href = `#/collection/albums/${encodeURIComponent(albumId)}`;
  artworkLink.dataset.albumOpen = albumId;
  const cover = document.createElement("span");
  cover.dataset.slot = "cover";
  artworkLink.append(cover);

  const titleTarget = document.createElement("span");
  titleTarget.dataset.codaAlbumTitleTarget = albumId;
  const staticTitle = document.createElement("span");
  staticTitle.dataset.slot = "overflow-marquee-text";
  staticTitle.textContent = "Release One";
  titleTarget.append(staticTitle);
  card.append(artworkLink, titleTarget);
  document.body.append(card);
  return { artworkLink, cover, staticTitle };
}

describe("detail source marker lifetimes", () => {
  it("keeps reused album markers until the newest overlapping lease releases", () => {
    const albumId = parseAlbumIdParam("album-1");
    const source = albumSourceCard(albumId);
    const request = {
      albumId,
      kind: "album" as const,
      sourceTrigger: source.artworkLink,
    };
    const preparedFirst = prepareDetailSource(request, collectionDestination());
    const preparedSecond = prepareDetailSource(
      request,
      collectionDestination(),
    );

    const releaseFirst = preparedFirst.applyMarkers();
    const releaseSecond = preparedSecond.applyMarkers();
    expect(source.cover).toHaveClass("coda-album-artwork-source");
    expect(source.staticTitle).toHaveAttribute(
      "data-coda-album-title-source",
      albumId,
    );

    releaseFirst();
    expect(source.cover).toHaveClass("coda-album-artwork-source");
    expect(source.staticTitle).toHaveAttribute(
      "data-coda-album-title-source",
      albumId,
    );

    releaseSecond();
    releaseSecond();
    expect(source.cover).not.toHaveClass("coda-album-artwork-source");
    expect(source.staticTitle).not.toHaveAttribute(
      "data-coda-album-title-source",
    );
  });

  it("marks the static artist-name glyphs for a marquee-backed return", () => {
    const artistKey = parseArtistKeyParam("night archive");
    const link = document.createElement("a");
    link.href = `#/collection/artists/${encodeURIComponent(artistKey)}`;
    link.dataset.artistOpen = artistKey;
    const nameWrapper = document.createElement("span");
    nameWrapper.dataset.codaArtistNameTarget = artistKey;
    const staticName = document.createElement("span");
    staticName.dataset.slot = "overflow-marquee-text";
    staticName.textContent = "Night Archive";
    const movingName = document.createElement("span");
    movingName.dataset.slot = "overflow-marquee-track";
    movingName.textContent = "Night Archive Night Archive";
    nameWrapper.append(staticName, movingName);
    link.append(nameWrapper);
    document.body.append(link);

    const release = markArtistReturnDestination(link, artistKey);

    expect(staticName).toHaveAttribute(
      "data-coda-artist-name-return",
      artistKey,
    );
    expect(nameWrapper).not.toHaveAttribute("data-coda-artist-name-return");
    expect(movingName).not.toHaveAttribute("data-coda-artist-name-return");
    release();
    expect(staticName).not.toHaveAttribute("data-coda-artist-name-return");
  });

  it("forces a virtualized return card to remain paintable for the snapshot", () => {
    const albumId = parseAlbumIdParam("album-virtualized");
    const source = albumSourceCard(albumId);
    const card = source.artworkLink.closest<HTMLElement>("[data-album-card]");
    if (!card) throw new Error("Expected an album card fixture");
    card.style.setProperty("content-visibility", "auto");

    const release = markAlbumReturnDestination(source.artworkLink, albumId);

    expect(card.style.getPropertyValue("content-visibility")).toBe("visible");
    expect(source.cover).toHaveAttribute(
      "data-coda-album-artwork-return",
      albumId,
    );
    release();
    expect(card.style.getPropertyValue("content-visibility")).toBe("auto");
    expect(source.cover).not.toHaveAttribute("data-coda-album-artwork-return");
  });

  it("keeps only the exact Discover return identity leased through overlapping cleanup", () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const otherReleaseId = parseDiscoverReleaseIdParam("discover:other");
    const makeCard = (id: string) => {
      const card = document.createElement("article");
      card.dataset.discoverReleaseCard = id;
      card.style.setProperty("content-visibility", "auto");
      const artwork = document.createElement("div");
      artwork.dataset.codaDiscoverArtwork = id;
      const artworkLink = document.createElement("a");
      artworkLink.href = `#/discover/releases/${encodeURIComponent(id)}`;
      artwork.append(artworkLink);
      const titleLink = document.createElement("a");
      titleLink.href = `#/discover/releases/${encodeURIComponent(id)}`;
      const title = document.createElement("span");
      title.dataset.codaDiscoverTitle = id;
      titleLink.append(title);
      card.append(artwork, titleLink);
      document.body.append(card);
      return { artwork, card, title, titleLink };
    };
    const exact = makeCard(releaseId);
    const other = makeCard(otherReleaseId);

    const releaseFirst = markDiscoverReturnDestination(
      exact.titleLink,
      releaseId,
    );
    const releaseSecond = markDiscoverReturnDestination(
      exact.titleLink,
      releaseId,
    );

    expect(exact.card.style.getPropertyValue("content-visibility")).toBe(
      "visible",
    );
    expect(exact.artwork).toHaveAttribute(
      "data-coda-discover-artwork-return",
      releaseId,
    );
    expect(exact.title).toHaveAttribute(
      "data-coda-discover-title-return",
      releaseId,
    );
    expect(other.artwork).not.toHaveAttribute(
      "data-coda-discover-artwork-return",
    );
    expect(other.title).not.toHaveAttribute("data-coda-discover-title-return");

    releaseFirst();
    expect(exact.artwork).toHaveAttribute(
      "data-coda-discover-artwork-return",
      releaseId,
    );
    expect(exact.title).toHaveAttribute(
      "data-coda-discover-title-return",
      releaseId,
    );

    releaseSecond();
    expect(exact.card.style.getPropertyValue("content-visibility")).toBe(
      "auto",
    );
    expect(exact.artwork).not.toHaveAttribute(
      "data-coda-discover-artwork-return",
    );
    expect(exact.title).not.toHaveAttribute("data-coda-discover-title-return");
  });
});
