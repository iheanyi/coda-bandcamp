import { afterEach, describe, expect, it } from "vitest";

import type { DetailTransitionKey } from "@/detailTransitionDescriptors";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  parseDiscoverReleaseIdParam,
} from "@/routing/routeContracts";

import {
  detailTransitionEndpointTargets,
  findDetailTransitionTrigger,
  prepareDetailSource,
  resolveDetailTransitionEndpointTargets,
} from "./detailSourceIdentity";

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

afterEach(() => {
  document.body.replaceChildren();
});

type GenericIdentityFixture = Readonly<{
  findTrigger: HTMLElement;
  identity: string;
  kind: DetailTransitionKey;
  owner: HTMLElement;
  secondary: HTMLElement | undefined;
  shared: HTMLElement | undefined;
  slot: string | undefined;
  trigger: HTMLElement;
}>;

function appendMarquee(parent: HTMLElement, text: string): HTMLElement {
  const marquee = document.createElement("span");
  marquee.dataset.slot = "overflow-marquee-text";
  marquee.textContent = text;
  parent.append(marquee);
  return marquee;
}

function albumIdentityFixture(identity: string): GenericIdentityFixture {
  const source = albumSourceCard(identity);
  source.artworkLink.dataset.navigationSlot = "artwork";
  const owner = source.artworkLink.closest<HTMLElement>("[data-album-card]");
  if (!owner) throw new Error("Expected an album card owner");
  return {
    findTrigger: source.artworkLink,
    identity,
    kind: "album",
    owner,
    secondary: source.staticTitle,
    shared: source.cover,
    slot: "artwork",
    trigger: source.artworkLink,
  };
}

function artistIdentityFixture(identity: string): GenericIdentityFixture {
  const albumId = parseAlbumIdParam("album-hx-26");
  const card = document.createElement("article");
  card.dataset.albumCard = albumId;
  const cover = document.createElement("span");
  cover.dataset.slot = "cover";
  const trigger = document.createElement("a");
  trigger.href = `#/collection/artists/${encodeURIComponent(identity)}`;
  trigger.dataset.artistOpen = identity;
  trigger.dataset.navigationSlot = `album-card-artist:${albumId}`;
  const nameWrapper = document.createElement("span");
  nameWrapper.dataset.codaArtistNameTarget = identity;
  const staticName = appendMarquee(nameWrapper, "Knxwledge.");
  trigger.append(nameWrapper);
  card.append(cover, trigger);
  document.body.append(card);
  return {
    findTrigger: trigger,
    identity,
    kind: "artist",
    owner: card,
    secondary: staticName,
    shared: cover,
    slot: `album-card-artist:${albumId}`,
    trigger,
  };
}

function dailyIdentityFixture(identity: string): GenericIdentityFixture {
  const owner = document.createElement("article");
  const trigger = document.createElement("a");
  trigger.dataset.dailyArticleOpen = identity;
  const shared = document.createElement("div");
  shared.dataset.dailyArticleArtwork = identity;
  const secondary = document.createElement("h3");
  secondary.dataset.dailyArticleTitle = identity;
  trigger.append(shared, secondary);
  owner.append(trigger);
  document.body.append(owner);
  return {
    findTrigger: trigger,
    identity,
    kind: "daily",
    owner,
    secondary,
    shared,
    slot: undefined,
    trigger,
  };
}

function discoverIdentityFixture(identity: string): GenericIdentityFixture {
  const owner = document.createElement("article");
  owner.dataset.discoverReleaseCard = identity;
  const shared = document.createElement("div");
  shared.dataset.codaDiscoverArtwork = identity;
  shared.dataset.navigationSlot = "discover-artwork";
  const artworkLink = document.createElement("a");
  artworkLink.href = `#/discover/releases/${encodeURIComponent(identity)}`;
  shared.append(artworkLink);
  const titleLink = document.createElement("a");
  titleLink.href = `#/discover/releases/${encodeURIComponent(identity)}`;
  const secondary = document.createElement("span");
  secondary.dataset.codaDiscoverTitle = identity;
  titleLink.append(secondary);
  owner.append(shared, titleLink);
  document.body.append(owner);
  return {
    findTrigger: shared,
    identity,
    kind: "discover-release",
    owner,
    secondary,
    shared,
    slot: "discover-artwork",
    trigger: artworkLink,
  };
}

function playlistIdentityFixture(identity: string): GenericIdentityFixture {
  const trigger = document.createElement("button");
  trigger.dataset.playlistOpen = identity;
  const shared = document.createElement("span");
  shared.dataset.playlistIdentity = identity;
  const titleRoot = document.createElement("span");
  titleRoot.dataset.playlistTitle = identity;
  const secondary = appendMarquee(titleRoot, "Night drives");
  trigger.append(shared, titleRoot);
  document.body.append(trigger);
  return {
    findTrigger: trigger,
    identity,
    kind: "playlist",
    owner: trigger,
    secondary,
    shared,
    slot: undefined,
    trigger,
  };
}

function radioIdentityFixture(identity: string): GenericIdentityFixture {
  const owner = document.createElement("article");
  const shared = document.createElement("span");
  shared.dataset.radioShowArtwork = identity;
  const trigger = document.createElement("a");
  trigger.dataset.radioShowOpen = identity;
  trigger.dataset.radioShowNavigationSlot = "artwork";
  const title = document.createElement("h3");
  title.dataset.radioShowTitle = identity;
  const secondary = appendMarquee(title, "The Show");
  owner.append(shared, trigger, title);
  document.body.append(owner);
  return {
    findTrigger: trigger,
    identity,
    kind: "radio",
    owner,
    secondary,
    shared,
    slot: "artwork",
    trigger,
  };
}

function nowPlayingIdentityFixture(identity: string): GenericIdentityFixture {
  const decoy = document.createElement("div");
  decoy.className = "now-playing__artwork";
  decoy.dataset.codaTrackId = identity;
  const trigger = document.createElement("a");
  trigger.className = "player__art-link";
  trigger.href = "#/now-playing";
  trigger.dataset.codaTrackId = identity;
  document.body.append(decoy, trigger);
  return {
    findTrigger: trigger,
    identity,
    kind: "now-playing",
    owner: trigger,
    secondary: undefined,
    shared: trigger,
    slot: undefined,
    trigger,
  };
}

const DETAIL_IDENTITY_KINDS = [
  "album",
  "artist",
  "daily",
  "discover-release",
  "now-playing",
  "playlist",
  "radio",
] as const satisfies readonly DetailTransitionKey[];

function identityFixture(
  kind: (typeof DETAIL_IDENTITY_KINDS)[number],
): GenericIdentityFixture {
  switch (kind) {
    case "album":
      return albumIdentityFixture(parseAlbumIdParam("album-1"));
    case "artist":
      return artistIdentityFixture(parseArtistKeyParam("knxwledge"));
    case "daily":
      return dailyIdentityFixture("daily-slug");
    case "discover-release":
      return discoverIdentityFixture(
        parseDiscoverReleaseIdParam("discover:blue-hours"),
      );
    case "playlist":
      return playlistIdentityFixture("playlist-1");
    case "radio":
      return radioIdentityFixture("42");
    case "now-playing":
      return nowPlayingIdentityFixture("track-1");
    default: {
      const exhaustive: never = kind;
      throw new TypeError(`Unsupported identity kind: ${String(exhaustive)}`);
    }
  }
}

function expectedTargets(fixture: GenericIdentityFixture) {
  return detailTransitionEndpointTargets(
    fixture.owner,
    fixture.shared,
    fixture.secondary,
  );
}

describe("generic descriptor identity resolution", () => {
  it.each(DETAIL_IDENTITY_KINDS)(
    "resolves owner, shared, secondary, and trigger for %s",
    (kind) => {
      const fixture = identityFixture(kind);
      const generic = resolveDetailTransitionEndpointTargets(
        kind,
        fixture.trigger,
        fixture.identity,
      );
      const found = findDetailTransitionTrigger(
        kind,
        fixture.identity,
        fixture.slot,
      );
      const prepared = prepareDetailSource(
        kind,
        fixture.identity,
        true,
        fixture.trigger,
      );

      expect(generic).toEqual(expectedTargets(fixture));
      expect(found).toBe(fixture.findTrigger);
      expect(prepared.targets).toEqual(generic);
    },
  );

  it.each(DETAIL_IDENTITY_KINDS)(
    "does not match %s when the owner identity is wrong",
    (kind) => {
      const fixture = identityFixture(kind);
      const generic = resolveDetailTransitionEndpointTargets(
        kind,
        fixture.trigger,
        "wrong-id",
      );

      expect(generic.secondary).toBeUndefined();
      expect(
        findDetailTransitionTrigger(kind, "wrong-id", fixture.slot),
      ).toBeUndefined();
      if (kind === "artist") {
        expect(generic.shared).toBe(fixture.shared);
        return;
      }
      expect(generic.shared).toBeUndefined();
    },
  );

  it("resolves fromOwner shared artwork from the album card identity", () => {
    const fixture = albumIdentityFixture(parseAlbumIdParam("album-from-owner"));
    const matched = resolveDetailTransitionEndpointTargets(
      "album",
      fixture.trigger,
      fixture.identity,
    );
    expect(matched.shared).toBe(fixture.shared);
    expect(matched.shared).not.toHaveAttribute("data-album-card");

    fixture.owner.dataset.albumCard = "album-mismatch";
    const mismatched = resolveDetailTransitionEndpointTargets(
      "album",
      fixture.trigger,
      fixture.identity,
    );
    expect(mismatched.shared).toBeUndefined();
    expect(mismatched.secondary).toBeUndefined();
    expect(mismatched.owner).toBe(fixture.owner);
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

    const targets = resolveDetailTransitionEndpointTargets("artist", link, artistKey);

    expect(targets?.secondary).toBe(staticName);
    expect(targets?.owner).toBe(link);
    expect(targets?.shared).toBeUndefined();
    expect(nameWrapper).not.toHaveAttribute("data-coda-artist-name-return");
    expect(movingName).not.toHaveAttribute("data-coda-artist-name-return");
  });

  it("returns the virtualized album card as the paint owner", () => {
    const albumId = parseAlbumIdParam("album-virtualized");
    const source = albumSourceCard(albumId);
    const card = source.artworkLink.closest<HTMLElement>("[data-album-card]");
    if (!card) throw new Error("Expected an album card fixture");
    card.style.setProperty("content-visibility", "auto");

    const targets = resolveDetailTransitionEndpointTargets("album", source.artworkLink, albumId);

    expect(targets?.owner).toBe(card);
    expect(targets?.shared).toBe(source.cover);
    expect(card.style.getPropertyValue("content-visibility")).toBe("auto");
  });

  it("resolves only the exact Discover return identity", () => {
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

    const targets = resolveDetailTransitionEndpointTargets(
      "discover-release",
      exact.titleLink,
      releaseId,
    );

    expect(targets).toEqual({
      owner: exact.card,
      secondary: exact.title,
      shared: exact.artwork,
    });
    expect(other.artwork).not.toHaveAttribute(
      "data-coda-discover-artwork-return",
    );
    expect(other.title).not.toHaveAttribute("data-coda-discover-title-return");
    expect(exact.card.style.getPropertyValue("content-visibility")).toBe(
      "auto",
    );
    expect(exact.artwork).not.toHaveAttribute(
      "data-coda-discover-artwork-return",
    );
    expect(exact.title).not.toHaveAttribute("data-coda-discover-title-return");
  });

  it("assigns Discover return slots from the clicked card surface", () => {
    const fixture = discoverIdentityFixture(
      parseDiscoverReleaseIdParam("discover:slot-check"),
    );
    const titleLink = fixture.secondary?.closest("a");
    if (!titleLink) throw new Error("Expected a Discover title link");

    prepareDetailSource(
      "discover-release",
      fixture.identity,
      true,
      fixture.trigger,
    );
    expect(fixture.trigger.dataset.navigationSlot).toBe("discover-artwork");

    prepareDetailSource("discover-release", fixture.identity, true, titleLink);
    expect(titleLink.dataset.navigationSlot).toBe("discover-title");
  });

  it("keeps a compact-player Discover trigger for focused Back", () => {
    const releaseId = parseDiscoverReleaseIdParam("discover:blue-hours");
    const playerAlbumLink = document.createElement("a");
    playerAlbumLink.href = `#/discover/releases/${encodeURIComponent(releaseId)}`;
    playerAlbumLink.dataset.playerAlbumLink = "";
    const playerTitle = document.createElement("span");
    playerTitle.dataset.slot = "overflow-marquee-text";
    playerTitle.textContent = "Blue Hours";
    playerAlbumLink.append(playerTitle);
    document.body.append(playerAlbumLink);

    const prepared = prepareDetailSource(
      "discover-release",
      releaseId,
      true,
      playerAlbumLink,
    );

    expect(prepared.sharedIdentityAvailable).toBe(false);
    expect(prepared.sourceTrigger).toBe(playerAlbumLink);
    expect(playerAlbumLink.dataset.navigationSlot).toBe("player-album");
  });
});
