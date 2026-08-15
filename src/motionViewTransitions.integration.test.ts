import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isCompositorOnlyKeyframeKeys,
  keyframePropertyNames,
} from "./compositorViewTransition";
import { codaViewTransitionMotion } from "./motion";
import { transitionCodaViewWithMotion } from "./motionViewTransitions";
import type { CodaViewTransitionKind } from "./viewTransitions";

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
  Reflect.deleteProperty(document, "activeViewTransition");
});

describe("Motion-backed route View Transitions", () => {
  it("resolves shared artwork geometry through Motion's spring generator", () => {
    const { type, ...options } = codaViewTransitionMotion.detailArtwork;

    expect(type).toEqual(expect.any(Function));
    if (typeof type !== "function" || !type.applyToOptions) {
      throw new Error("Expected Motion's spring generator");
    }
    const timing = type.applyToOptions(options);
    expect(timing).toMatchObject({
      duration: 450,
      type: "keyframes",
      visualDuration: 0.3,
    });
    expect(timing.ease).not.toBe("easeOut");
  });

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

  it("captures the async artist return without waiting on artwork decode", async () => {
    const artistKey = "artist-1";
    const detail = document.createElement("section");
    const detailArtwork = document.createElement("div");
    detailArtwork.dataset.codaArtistArtworkDetail = artistKey;
    detailArtwork.dataset.slot = "cover";
    detailArtwork.append(document.createElement("img"));
    const detailName = document.createElement("span");
    detailName.dataset.codaArtistNameDetail = artistKey;
    detail.append(detailArtwork, detailName);
    document.body.append(detail);
    const routeRendered = deferred();
    const imageDecoded = deferred();
    const decodeImage = vi.fn(() => imageDecoded.promise);
    let browserUpdateFinished = false;
    let artworkPresentAtCapture = false;
    let artworkNameAtCapture = "";

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
            `[data-coda-artist-artwork-return="${artistKey}"]`,
          );
          artworkPresentAtCapture = Boolean(artwork);
          artworkNameAtCapture = artwork
            ? getComputedStyle(artwork).viewTransitionName
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
      const returnArtwork = document.createElement("div");
      returnArtwork.dataset.codaArtistArtworkReturn = artistKey;
      returnArtwork.dataset.slot = "cover";
      const image = document.createElement("img");
      Object.defineProperty(image, "decode", {
        configurable: true,
        value: decodeImage,
      });
      returnArtwork.append(image);
      document.body.append(returnArtwork);
    }, "artist-detail-close");

    await vi.waitFor(() =>
      expect(document.startViewTransition).toHaveBeenCalledOnce(),
    );
    routeRendered.resolve();
    await vi.waitFor(() =>
      expect(
        document.querySelector("[data-coda-artist-artwork-return]"),
      ).not.toBeNull(),
    );
    await vi.waitFor(() => expect(decodeImage).toHaveBeenCalledOnce());
    expect(browserUpdateFinished).toBe(true);
    expect(artworkPresentAtCapture).toBe(true);
    expect(artworkNameAtCapture).not.toBe("none");

    imageDecoded.resolve();
    await transition;

    expect(decodeImage).toHaveBeenCalledOnce();
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

  it.each([
    ["radio-detail", "coda-radio-artwork"],
    ["playlist-detail", "coda-playlist-identity"],
    ["now-playing-open", "coda-now-playing-artwork"],
  ] as const satisfies ReadonlyArray<
    readonly [CodaViewTransitionKind, string]
  >)(
    "rewrites %s layout groups to transform/opacity before the builder settles",
    async (kind, groupName) => {
      const setKeyframes = vi.fn();
      Object.defineProperty(document, "getAnimations", {
        configurable: true,
        value: () => [
          {
            playState: "running",
            effect: {
              pseudoElement: `::view-transition-group(${groupName})`,
              getKeyframes: () => [
                {
                  width: "80px",
                  height: "80px",
                  transform: "none",
                  backdropFilter: "blur(8px)",
                },
                {
                  width: "160px",
                  height: "160px",
                  transform: "none",
                  backdropFilter: "none",
                },
              ],
              setKeyframes,
            },
          },
        ],
      });
      Object.defineProperty(document, "startViewTransition", {
        configurable: true,
        value: vi.fn((update: () => void | Promise<void>) => {
          const updateCallbackDone = Promise.resolve(update());
          return {
            finished: updateCallbackDone,
            ready: Promise.resolve(),
            skipTransition: vi.fn(),
            updateCallbackDone,
          };
        }),
      });
      Object.defineProperty(document, "activeViewTransition", {
        configurable: true,
        value: { ready: Promise.resolve(), skipTransition: vi.fn() },
      });

      await transitionCodaViewWithMotion(async () => undefined, kind);

      expect(setKeyframes).toHaveBeenCalled();
      const frames = setKeyframes.mock.calls[0]?.[0] as Keyframe[];
      expect(frames.length).toBeGreaterThan(0);
      expect(isCompositorOnlyKeyframeKeys(keyframePropertyNames(frames))).toBe(
        true,
      );
    },
  );
});
