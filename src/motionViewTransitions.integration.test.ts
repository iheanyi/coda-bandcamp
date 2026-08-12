import { afterEach, describe, expect, it, vi } from "vitest";

import { transitionCodaViewWithMotion } from "./motionViewTransitions";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function albumSource() {
  const card = document.createElement("article");
  card.dataset.albumCard = "album-1";
  const cover = document.createElement("div");
  cover.className = "coda-album-artwork-source";
  card.append(cover);
  document.body.append(card);
  return card;
}

function mountAlbumDestination() {
  const detail = document.createElement("article");
  detail.dataset.codaAlbumDetailSurface = "";
  const artwork = document.createElement("div");
  artwork.className = "album-detail__artwork";
  const cover = document.createElement("div");
  cover.dataset.slot = "cover";
  artwork.append(cover);
  detail.append(artwork);
  document.body.append(detail);
  return cover;
}

function artistNameSource() {
  const link = document.createElement("a");
  link.dataset.artistOpen = "artist-1";
  link.dataset.codaArtistNameSource = "artist-1";
  link.textContent = "Artist One";
  document.body.append(link);
  return link;
}

function mountArtistDestination() {
  const detail = document.createElement("section");
  detail.dataset.codaArtistDetailSurface = "";
  const name = document.createElement("span");
  name.dataset.codaArtistNameDetail = "";
  name.textContent = "Artist One";
  detail.append(name);
  document.body.append(detail);
  return name;
}

function artistDetailName(artistKey: string) {
  const detail = document.createElement("section");
  detail.dataset.codaArtistDetailSurface = "";
  const name = document.createElement("span");
  name.dataset.codaArtistNameDetail = artistKey;
  name.textContent = "Artist One";
  detail.append(name);
  document.body.append(detail);
  return detail;
}

function mountArtistNameReturn(artistKey: string) {
  const link = document.createElement("a");
  link.dataset.artistOpen = artistKey;
  const name = document.createElement("span");
  name.dataset.codaArtistNameReturn = artistKey;
  name.textContent = "Artist One";
  link.append(name);
  document.body.append(link);
  return name;
}

function discoverDetailSource(releaseId: string) {
  const detail = document.createElement("article");
  detail.dataset.codaDiscoverDetailSurface = "";
  const artwork = document.createElement("div");
  artwork.dataset.codaDiscoverArtworkDetail = releaseId;
  const title = document.createElement("span");
  title.dataset.codaDiscoverTitleDetail = releaseId;
  title.textContent = "Blue Hours";
  detail.append(artwork, title);
  document.body.append(detail);
  return detail;
}

function mountDiscoverReturnDestination(releaseId: string) {
  const card = document.createElement("article");
  card.dataset.discoverReleaseCard = releaseId;
  const artwork = document.createElement("div");
  artwork.dataset.codaDiscoverArtworkReturn = releaseId;
  const title = document.createElement("span");
  title.dataset.codaDiscoverTitleReturn = releaseId;
  title.textContent = "Blue Hours";
  card.append(artwork, title);
  document.body.append(card);
  return { artwork, title };
}

afterEach(() => {
  document.body.replaceChildren();
  Reflect.deleteProperty(document, "getAnimations");
  Reflect.deleteProperty(document, "startViewTransition");
});

describe("Motion-backed route View Transitions", () => {
  it("keeps the browser update pending until an async album destination mounts", async () => {
    const source = albumSource();
    const routeRendered = deferred();
    let browserUpdateFinished = false;
    let destinationPresentAtCapture = false;
    let destinationNameAtCapture = "";

    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          browserUpdateFinished = true;
          const destination = document.querySelector<HTMLElement>(
            ".album-detail__artwork [data-slot='cover']",
          );
          destinationPresentAtCapture = Boolean(destination);
          destinationNameAtCapture = destination
            ? getComputedStyle(destination).viewTransitionName
            : "";
        });
        return {
          finished: updateCallbackDone,
          ready: updateCallbackDone,
          skipTransition: vi.fn(),
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaViewWithMotion(async () => {
      await routeRendered.promise;
      source.remove();
      mountAlbumDestination();
    }, "album-detail");

    await vi.waitFor(() =>
      expect(document.startViewTransition).toHaveBeenCalledOnce(),
    );
    await Promise.resolve();

    expect(browserUpdateFinished).toBe(false);

    routeRendered.resolve();
    await transition;

    expect(browserUpdateFinished).toBe(true);
    expect(destinationPresentAtCapture).toBe(true);
    expect(destinationNameAtCapture).not.toBe("none");
  });

  it("keeps an artist name shared until its async route destination mounts", async () => {
    const source = artistNameSource();
    const routeRendered = deferred();
    let browserUpdateFinished = false;
    let destinationPresentAtCapture = false;
    let destinationNameAtCapture = "";

    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          browserUpdateFinished = true;
          const destination = document.querySelector<HTMLElement>(
            "[data-coda-artist-name-detail]",
          );
          destinationPresentAtCapture = Boolean(destination);
          destinationNameAtCapture = destination
            ? getComputedStyle(destination).viewTransitionName
            : "";
        });
        return {
          finished: updateCallbackDone,
          ready: updateCallbackDone,
          skipTransition: vi.fn(),
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaViewWithMotion(async () => {
      await routeRendered.promise;
      source.remove();
      mountArtistDestination();
    }, "artist-detail");

    await vi.waitFor(() =>
      expect(document.startViewTransition).toHaveBeenCalledOnce(),
    );
    await Promise.resolve();

    expect(browserUpdateFinished).toBe(false);

    routeRendered.resolve();
    await transition;

    expect(browserUpdateFinished).toBe(true);
    expect(destinationPresentAtCapture).toBe(true);
    expect(destinationNameAtCapture).not.toBe("none");
  });

  it("keeps a name-only artist return paintable without an artwork endpoint", async () => {
    const artistKey = "artist-1";
    const detail = artistDetailName(artistKey);
    const routeRendered = deferred();
    let browserUpdateFinished = false;
    let destinationPresentAtCapture = false;
    let destinationNameAtCapture = "";

    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          browserUpdateFinished = true;
          const destination = document.querySelector<HTMLElement>(
            `[data-coda-artist-name-return="${artistKey}"]`,
          );
          destinationPresentAtCapture = Boolean(destination);
          destinationNameAtCapture = destination
            ? getComputedStyle(destination).viewTransitionName
            : "";
        });
        return {
          finished: updateCallbackDone,
          ready: updateCallbackDone,
          skipTransition: vi.fn(),
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaViewWithMotion(async () => {
      await routeRendered.promise;
      detail.remove();
      mountArtistNameReturn(artistKey);
    }, "artist-detail-close");

    await vi.waitFor(() =>
      expect(document.startViewTransition).toHaveBeenCalledOnce(),
    );
    await Promise.resolve();
    expect(browserUpdateFinished).toBe(false);

    routeRendered.resolve();
    await transition;

    expect(browserUpdateFinished).toBe(true);
    expect(destinationPresentAtCapture).toBe(true);
    expect(destinationNameAtCapture).not.toBe("none");
  });

  it("keeps Discover detail identity shared until its exact return card mounts", async () => {
    const releaseId = "discover:blue-hours";
    const detail = discoverDetailSource(releaseId);
    const routeRendered = deferred();
    let browserUpdateFinished = false;
    let artworkPresentAtCapture = false;
    let titlePresentAtCapture = false;
    let artworkNameAtCapture = "";
    let titleNameAtCapture = "";

    Object.defineProperty(document, "getAnimations", {
      configurable: true,
      value: () => [],
    });

    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: vi.fn((update: () => void | Promise<void>) => {
        const updateCallbackDone = Promise.resolve(update()).then(() => {
          browserUpdateFinished = true;
          const artwork = document.querySelector<HTMLElement>(
            `[data-coda-discover-artwork-return="${releaseId}"]`,
          );
          const title = document.querySelector<HTMLElement>(
            `[data-coda-discover-title-return="${releaseId}"]`,
          );
          artworkPresentAtCapture = Boolean(artwork);
          titlePresentAtCapture = Boolean(title);
          artworkNameAtCapture = artwork
            ? getComputedStyle(artwork).viewTransitionName
            : "";
          titleNameAtCapture = title
            ? getComputedStyle(title).viewTransitionName
            : "";
        });
        return {
          finished: updateCallbackDone,
          ready: updateCallbackDone,
          skipTransition: vi.fn(),
          updateCallbackDone,
        };
      }),
    });

    const transition = transitionCodaViewWithMotion(async () => {
      await routeRendered.promise;
      detail.remove();
      mountDiscoverReturnDestination(releaseId);
    }, "discover-detail-close");

    await vi.waitFor(() =>
      expect(document.startViewTransition).toHaveBeenCalledOnce(),
    );
    await Promise.resolve();
    expect(browserUpdateFinished).toBe(false);

    routeRendered.resolve();
    await transition;

    expect(browserUpdateFinished).toBe(true);
    expect(artworkPresentAtCapture).toBe(true);
    expect(titlePresentAtCapture).toBe(true);
    expect(artworkNameAtCapture).not.toBe("none");
    expect(titleNameAtCapture).not.toBe("none");
  });
});
