import {
  animateView,
  type AnimationPlaybackControls,
  type Transition,
  type ViewTransitionBuilder,
} from "motion";
import { flushSync } from "react-dom";
import { codaMotion, codaViewForwardMotion } from "./motion";
import type {
  CodaViewTransitionKind,
  CodaViewTransitionUpdate,
} from "./viewTransitions";

const SHARED_ARTWORK_CLASS = "coda-motion-shared-artwork";
const SHARED_IDENTITY_CLASS = "coda-motion-shared-identity";
const SHARED_TITLE_CLASS = "coda-motion-shared-title";
const DETAIL_SURFACE_CLASS = "coda-motion-detail-surface";
const SHARED_SNAPSHOT_IMAGE_READY_TIMEOUT_MS = 250;
const SHARED_SNAPSHOT_PAINT_TIMEOUT_MS = 50;
const MOTION_VIEW_TRANSITION_READY_WATCHDOG_MS = 5_000;
// Production transitions finish in well under one second. If the platform
// never settles its pseudo animations, release snapshot ownership instead of
// leaving the live element suppressed indefinitely.
const MOTION_VIEW_TRANSITION_WATCHDOG_MS = 1_500;

let latestMotionTransitionId = 0;

function cssAttributeValue(value: string) {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (character === '"' || character === "\\") {
      escaped += `\\${character}`;
    } else if (codePoint === 0) {
      escaped += "\\fffd ";
    } else if (codePoint < 0x20 || codePoint === 0x7f) {
      escaped += `\\${codePoint.toString(16)} `;
    } else {
      escaped += character;
    }
  }
  return escaped;
}

function identityDestination(
  source: Element | null,
  sourceAttributes: readonly string[],
  destinationAttribute: string,
  fallback: string,
  destinationSelector = "",
) {
  if (!source) return fallback;
  for (const attribute of sourceAttributes) {
    const identity = source.getAttribute(attribute);
    if (identity) {
      return `${destinationSelector}[${destinationAttribute}="${cssAttributeValue(identity)}"]`;
    }
  }
  return fallback;
}

function sharedSnapshotDestination(kind: CodaViewTransitionKind) {
  switch (kind) {
    case "album-detail":
      return document.querySelector(".coda-album-artwork-source")
        ? ".album-detail__artwork [data-slot='cover']"
        : undefined;
    case "album-detail-close": {
      const source = document.querySelector("[data-coda-album-artwork-detail]");
      return source
        ? identityDestination(
            source,
            ["data-coda-album-artwork-detail"],
            "data-coda-album-artwork-return",
            "[data-coda-album-artwork-return]",
          )
        : undefined;
    }
    case "artist-detail":
      return document.querySelector(
        ":is([data-coda-artist-artwork-source] [data-slot='cover'], [data-coda-artist-artwork-source][data-slot='cover'])",
      )
        ? ":is([data-coda-artist-artwork-detail][data-slot='cover'], [data-coda-artist-artwork-detail] [data-slot='cover'])"
        : undefined;
    case "artist-detail-close": {
      const source = document.querySelector(
        "[data-coda-artist-artwork-detail][data-slot='cover']",
      );
      return source
        ? identityDestination(
            source,
            ["data-coda-artist-artwork-detail"],
            "data-coda-artist-artwork-return",
            "[data-coda-artist-artwork-return]",
          )
        : undefined;
    }
    case "discover-detail": {
      const source = document.querySelector(
        "[data-coda-discover-artwork-source]",
      );
      return source
        ? identityDestination(
            source,
            ["data-coda-discover-artwork-source", "data-coda-discover-artwork"],
            "data-coda-discover-artwork-detail",
            "[data-coda-discover-artwork-detail]",
          )
        : undefined;
    }
    case "discover-detail-close": {
      const source = document.querySelector(
        "[data-coda-discover-artwork-detail]",
      );
      return source
        ? identityDestination(
            source,
            ["data-coda-discover-artwork-detail"],
            "data-coda-discover-artwork-return",
            "[data-coda-discover-artwork-return]",
          )
        : undefined;
    }
    case "radio-detail": {
      const source = document.querySelector("[data-coda-radio-artwork-source]");
      return source
        ? identityDestination(
            source,
            ["data-coda-radio-artwork-source"],
            "data-coda-radio-artwork-detail",
            "[data-coda-radio-artwork-detail]",
          )
        : undefined;
    }
    case "radio-detail-close": {
      const source = document.querySelector("[data-coda-radio-artwork-detail]");
      return source
        ? identityDestination(
            source,
            ["data-coda-radio-artwork-detail"],
            "data-coda-radio-artwork-return",
            "[data-coda-radio-artwork-return]",
          )
        : undefined;
    }
    case "playlist-detail": {
      const source = document.querySelector(
        "[data-coda-playlist-identity-source]",
      );
      return source
        ? identityDestination(
            source,
            ["data-coda-playlist-identity-source"],
            "data-coda-playlist-identity-detail",
            "[data-coda-playlist-identity-detail]",
          )
        : undefined;
    }
    case "playlist-detail-close": {
      const source = document.querySelector(
        "[data-coda-playlist-identity-detail]",
      );
      return source
        ? identityDestination(
            source,
            ["data-coda-playlist-identity-detail"],
            "data-coda-playlist-identity-return",
            "[data-coda-playlist-identity-return]",
          )
        : undefined;
    }
    case "now-playing-open": {
      const source = document.querySelector(".player__art-link");
      return source
        ? identityDestination(
            source,
            ["data-coda-track-id"],
            "data-coda-track-id",
            ".now-playing__artwork",
            ".now-playing__artwork",
          )
        : undefined;
    }
    case "now-playing-close": {
      const source = document.querySelector(".now-playing__artwork");
      return source
        ? identityDestination(
            source,
            ["data-coda-track-id"],
            "data-coda-track-id",
            ".player__art-link",
            ".player__art-link",
          )
        : undefined;
    }
    case "page-forward":
    case "page-back":
    case "page-crossfade":
      return undefined;
  }
}

function sharedSnapshotSourceHasImage(kind: CodaViewTransitionKind) {
  let source: Element | null = null;
  switch (kind) {
    case "album-detail":
      source = document.querySelector(".coda-album-artwork-source");
      break;
    case "album-detail-close":
      source = document.querySelector("[data-coda-album-artwork-detail]");
      break;
    case "artist-detail":
      source = document.querySelector(
        ":is([data-coda-artist-artwork-source] [data-slot='cover'], [data-coda-artist-artwork-source][data-slot='cover'])",
      );
      break;
    case "artist-detail-close":
      source = document.querySelector(
        "[data-coda-artist-artwork-detail][data-slot='cover']",
      );
      break;
    case "discover-detail":
      source = document.querySelector("[data-coda-discover-artwork-source]");
      break;
    case "discover-detail-close":
      source = document.querySelector("[data-coda-discover-artwork-detail]");
      break;
    case "radio-detail":
      source = document.querySelector("[data-coda-radio-artwork-source]");
      break;
    case "radio-detail-close":
      source = document.querySelector("[data-coda-radio-artwork-detail]");
      break;
    case "playlist-detail":
      source = document.querySelector("[data-coda-playlist-identity-source]");
      break;
    case "playlist-detail-close":
      source = document.querySelector("[data-coda-playlist-identity-detail]");
      break;
    case "now-playing-open":
      source = document.querySelector(".player__art-link");
      break;
    case "now-playing-close":
      source = document.querySelector(".now-playing__artwork");
      break;
    case "page-forward":
    case "page-back":
    case "page-crossfade":
      return false;
  }
  return Boolean(
    source && (source.matches("img") || source.querySelector("img")),
  );
}

function imageReady(image: HTMLImageElement) {
  if (typeof image.decode === "function") {
    return Promise.resolve()
      .then(() => image.decode())
      .catch(() => undefined);
  }
  if (image.complete) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const settle = () => resolve();
    image.addEventListener("load", settle, { once: true });
    image.addEventListener("error", settle, { once: true });
  });
}

function imagesWithin(target: HTMLElement) {
  return target.matches("img")
    ? [target as HTMLImageElement]
    : Array.from(target.querySelectorAll("img"));
}

function waitForImages(target: HTMLElement, timeoutMs: number) {
  const existing = imagesWithin(target);
  if (existing.length > 0 || typeof MutationObserver === "undefined") {
    return Promise.resolve(existing);
  }
  return new Promise<HTMLImageElement[]>((resolve) => {
    let settled = false;
    const observer = new MutationObserver(() => {
      const images = imagesWithin(target);
      if (images.length > 0) settle(images);
    });
    const timeoutId = window.setTimeout(() => settle([]), timeoutMs);
    const settle = (images: HTMLImageElement[]) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timeoutId);
      resolve(images);
    };
    observer.observe(target, { childList: true, subtree: true });
  });
}

async function waitBounded(promise: Promise<unknown>, timeoutMs: number) {
  let timeoutId: number | undefined;
  await Promise.race([
    promise,
    new Promise<void>((resolve) => {
      timeoutId = window.setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
}

async function nextPaint() {
  if (typeof requestAnimationFrame !== "function") return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      if (frameId !== undefined) cancelAnimationFrame(frameId);
      resolve();
    };
    const timeoutId = window.setTimeout(
      settle,
      SHARED_SNAPSHOT_PAINT_TIMEOUT_MS,
    );
    const frameId = requestAnimationFrame(settle);
  });
}

async function awaitSharedSnapshotReady(
  destination: string | undefined,
  sourceHadImage: boolean,
) {
  if (!destination) return;
  const target = document.querySelector<HTMLElement>(destination);
  if (!target) return;

  const images = sourceHadImage
    ? await waitForImages(
        target,
        Math.floor(SHARED_SNAPSHOT_IMAGE_READY_TIMEOUT_MS / 2),
      )
    : imagesWithin(target);
  if (images.length > 0) {
    await waitBounded(
      Promise.all(images.map(imageReady)),
      Math.floor(SHARED_SNAPSHOT_IMAGE_READY_TIMEOUT_MS / 2),
    );
  }

  // Reading layout and yielding one frame gives WebKit a paint opportunity for
  // a just-remounted, formerly lazy image before it captures the new snapshot.
  target.getBoundingClientRect();
  await nextPaint();
}

function configurePageTransition(
  transition: ViewTransitionBuilder,
  kind: Extract<
    CodaViewTransitionKind,
    "page-forward" | "page-back" | "page-crossfade"
  >,
) {
  const page = transition.add(".library-pane").group(false);

  if (kind === "page-crossfade") {
    page
      .old({ opacity: 0 }, codaMotion.viewExit)
      .new({ opacity: [0, 1] }, codaMotion.view);
    return;
  }

  const direction = kind === "page-back" ? -1 : 1;
  page
    .old(
      {
        opacity: 0,
        transform: `translateX(${direction * -6}px)`,
      },
      codaViewForwardMotion.exit,
    )
    .new(
      {
        opacity: [0, 1],
        transform: [`translateX(${direction * 10}px)`, "translateX(0px)"],
      },
      codaViewForwardMotion.enter,
    );
}

function configureSharedElement(
  transition: ViewTransitionBuilder,
  source: Element | null,
  destination: string,
  layoutTransition: Transition = codaMotion.sharedArtwork,
  transitionClass = SHARED_ARTWORK_CLASS,
) {
  if (!source) return;

  transition
    .add(source, destination)
    .class(transitionClass)
    .group(false)
    .layout(layoutTransition);
}

function configureDetailSurface(
  transition: ViewTransitionBuilder,
  selector: string,
) {
  transition
    .add(selector)
    .class(DETAIL_SURFACE_CLASS)
    .group(false)
    .enter(
      {
        transform: ["translateY(8px)", "translateY(0px)"],
      },
      codaMotion.detailSurfaceEnter,
    );
}

function configureSharedTitle(
  transition: ViewTransitionBuilder,
  source: Element | null,
  destination: string,
) {
  if (!source) return;

  transition
    .add(source, destination)
    .class(SHARED_TITLE_CLASS)
    .group(false)
    .crop(false)
    .layout(codaMotion.detailTitle)
    .old({ opacity: [1, 0] }, codaMotion.detailIdentityFade)
    .new({ opacity: [0, 1] }, codaMotion.detailIdentityFade);
}

function configureNowPlayingTransition(
  transition: ViewTransitionBuilder,
  opening: boolean,
) {
  const artworkSource = document.querySelector(
    opening ? ".player__art-link" : ".now-playing__artwork",
  );
  const titleSource = document.querySelector(
    opening
      ? "[data-coda-now-playing-title-compact]"
      : "[data-coda-now-playing-title-detail]",
  );
  configureSharedElement(
    transition,
    artworkSource,
    identityDestination(
      artworkSource,
      ["data-coda-track-id"],
      "data-coda-track-id",
      opening ? ".now-playing__artwork" : ".player__art-link",
      opening ? ".now-playing__artwork" : ".player__art-link",
    ),
    codaMotion.detailArtwork,
  );
  configureSharedTitle(
    transition,
    titleSource,
    identityDestination(
      titleSource,
      [
        opening
          ? "data-coda-now-playing-title-compact"
          : "data-coda-now-playing-title-detail",
      ],
      opening
        ? "data-coda-now-playing-title-detail"
        : "data-coda-now-playing-title-compact",
      opening
        ? "[data-coda-now-playing-title-detail]"
        : "[data-coda-now-playing-title-compact]",
    ),
  );

  const player = transition.add("footer[data-player-mode]").group(false);
  const header = transition.add(".now-playing__header").group(false);
  const details = transition.add(".now-playing__details").group(false);
  if (opening) {
    player.old(
      {
        opacity: 0,
        transform: "translateY(6px)",
      },
      codaMotion.componentExit,
    );
    header.enter(
      {
        opacity: [0, 1],
        transform: ["translateY(8px)", "translateY(0px)"],
      },
      { ...codaMotion.componentEnter, delay: 0.05 },
    );
    details.enter(
      {
        opacity: [0, 1],
        transform: ["translateY(8px)", "translateY(0px)"],
      },
      { ...codaMotion.componentEnter, delay: 0.08 },
    );
  } else {
    player.new(
      {
        opacity: [0, 1],
        transform: ["translateY(6px)", "translateY(0px)"],
      },
      codaMotion.componentEnter,
    );
    const exit = {
      opacity: 0,
      transform: "translateY(6px)",
    };
    header.exit(exit, codaMotion.componentExit);
    details.exit(exit, codaMotion.componentExit);
  }
}

function configureMotionTransition(
  transition: ViewTransitionBuilder,
  kind: CodaViewTransitionKind,
) {
  switch (kind) {
    case "album-detail":
      configureSharedElement(
        transition,
        document.querySelector(".coda-album-artwork-source"),
        ".album-detail__artwork [data-slot='cover']",
        codaMotion.detailArtwork,
      );
      configureDetailSurface(transition, "[data-coda-album-detail-surface]");
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-album-title-source]"),
        "[data-coda-album-title-detail]",
      );
      return;
    case "album-detail-close": {
      const albumArtwork = document.querySelector(
        "[data-coda-album-artwork-detail]",
      );
      const albumTitle = document.querySelector(
        "[data-coda-album-title-detail]",
      );
      configureSharedElement(
        transition,
        albumArtwork,
        identityDestination(
          albumArtwork,
          ["data-coda-album-artwork-detail"],
          "data-coda-album-artwork-return",
          "[data-coda-album-artwork-return]",
        ),
        codaMotion.detailArtwork,
      );
      configureSharedTitle(
        transition,
        albumTitle,
        identityDestination(
          albumTitle,
          ["data-coda-album-title-detail"],
          "data-coda-album-title-return",
          "[data-coda-album-title-return]",
        ),
      );
      return;
    }
    case "artist-detail":
      configureSharedElement(
        transition,
        document.querySelector(
          "[data-coda-artist-artwork-source] [data-slot='cover']",
        ) ??
          document.querySelector(
            "[data-coda-artist-artwork-source][data-slot='cover']",
          ),
        ":is([data-coda-artist-artwork-detail][data-slot='cover'], [data-coda-artist-artwork-detail] [data-slot='cover'])",
        codaMotion.detailArtwork,
      );
      configureDetailSurface(transition, "[data-coda-artist-detail-surface]");
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-artist-name-source]"),
        "[data-coda-artist-name-detail]",
      );
      return;
    case "artist-detail-close": {
      const artistArtwork = document.querySelector(
        "[data-coda-artist-artwork-detail][data-slot='cover']",
      );
      const artistName = document.querySelector(
        "[data-coda-artist-name-detail]",
      );
      configureSharedElement(
        transition,
        artistArtwork,
        identityDestination(
          artistArtwork,
          ["data-coda-artist-artwork-detail"],
          "data-coda-artist-artwork-return",
          "[data-coda-artist-artwork-return]",
        ),
        codaMotion.detailArtwork,
      );
      configureSharedTitle(
        transition,
        artistName,
        identityDestination(
          artistName,
          ["data-coda-artist-name-detail"],
          "data-coda-artist-name-return",
          "[data-coda-artist-name-return]",
        ),
      );
      return;
    }
    case "discover-detail": {
      const discoverArtwork = document.querySelector(
        "[data-coda-discover-artwork-source]",
      );
      const discoverTitle = document.querySelector(
        "[data-coda-discover-title-source]",
      );
      configureSharedElement(
        transition,
        discoverArtwork,
        identityDestination(
          discoverArtwork,
          ["data-coda-discover-artwork-source", "data-coda-discover-artwork"],
          "data-coda-discover-artwork-detail",
          "[data-coda-discover-artwork-detail]",
        ),
        codaMotion.detailArtwork,
      );
      configureDetailSurface(transition, "[data-coda-discover-detail-surface]");
      configureSharedTitle(
        transition,
        discoverTitle,
        identityDestination(
          discoverTitle,
          ["data-coda-discover-title-source", "data-coda-discover-title"],
          "data-coda-discover-title-detail",
          "[data-coda-discover-title-detail]",
        ),
      );
      return;
    }
    case "discover-detail-close": {
      const discoverArtwork = document.querySelector(
        "[data-coda-discover-artwork-detail]",
      );
      const discoverTitle = document.querySelector(
        "[data-coda-discover-title-detail]",
      );
      configureSharedElement(
        transition,
        discoverArtwork,
        identityDestination(
          discoverArtwork,
          ["data-coda-discover-artwork-detail"],
          "data-coda-discover-artwork-return",
          "[data-coda-discover-artwork-return]",
        ),
        codaMotion.detailArtwork,
      );
      configureSharedTitle(
        transition,
        discoverTitle,
        identityDestination(
          discoverTitle,
          ["data-coda-discover-title-detail"],
          "data-coda-discover-title-return",
          "[data-coda-discover-title-return]",
        ),
      );
      return;
    }
    case "radio-detail": {
      const radioArtwork = document.querySelector(
        "[data-coda-radio-artwork-source]",
      );
      const radioTitle = document.querySelector(
        "[data-coda-radio-title-source]",
      );
      configureSharedElement(
        transition,
        radioArtwork,
        identityDestination(
          radioArtwork,
          ["data-coda-radio-artwork-source"],
          "data-coda-radio-artwork-detail",
          "[data-coda-radio-artwork-detail]",
        ),
        codaMotion.detailArtwork,
      );
      configureDetailSurface(transition, "[data-coda-radio-detail-surface]");
      configureSharedTitle(
        transition,
        radioTitle,
        identityDestination(
          radioTitle,
          ["data-coda-radio-title-source"],
          "data-coda-radio-title-detail",
          "[data-coda-radio-title-detail]",
        ),
      );
      return;
    }
    case "radio-detail-close": {
      const radioArtwork = document.querySelector(
        "[data-coda-radio-artwork-detail]",
      );
      const radioTitle = document.querySelector(
        "[data-coda-radio-title-detail]",
      );
      configureSharedElement(
        transition,
        radioArtwork,
        identityDestination(
          radioArtwork,
          ["data-coda-radio-artwork-detail"],
          "data-coda-radio-artwork-return",
          "[data-coda-radio-artwork-return]",
        ),
        codaMotion.detailArtwork,
      );
      configureSharedTitle(
        transition,
        radioTitle,
        identityDestination(
          radioTitle,
          ["data-coda-radio-title-detail"],
          "data-coda-radio-title-return",
          "[data-coda-radio-title-return]",
        ),
      );
      return;
    }
    case "playlist-detail": {
      const playlistIdentity = document.querySelector(
        "[data-coda-playlist-identity-source]",
      );
      const playlistTitle = document.querySelector(
        "[data-coda-playlist-title-source]",
      );
      configureSharedElement(
        transition,
        playlistIdentity,
        identityDestination(
          playlistIdentity,
          ["data-coda-playlist-identity-source"],
          "data-coda-playlist-identity-detail",
          "[data-coda-playlist-identity-detail]",
        ),
        codaMotion.detailIdentity,
        SHARED_IDENTITY_CLASS,
      );
      configureDetailSurface(transition, "[data-coda-playlist-detail-surface]");
      configureSharedTitle(
        transition,
        playlistTitle,
        identityDestination(
          playlistTitle,
          ["data-coda-playlist-title-source"],
          "data-coda-playlist-title-detail",
          "[data-coda-playlist-title-detail]",
        ),
      );
      return;
    }
    case "playlist-detail-close": {
      const playlistIdentity = document.querySelector(
        "[data-coda-playlist-identity-detail]",
      );
      const playlistTitle = document.querySelector(
        "[data-coda-playlist-title-detail]",
      );
      configureSharedElement(
        transition,
        playlistIdentity,
        identityDestination(
          playlistIdentity,
          ["data-coda-playlist-identity-detail"],
          "data-coda-playlist-identity-return",
          "[data-coda-playlist-identity-return]",
        ),
        codaMotion.detailIdentity,
        SHARED_IDENTITY_CLASS,
      );
      configureSharedTitle(
        transition,
        playlistTitle,
        identityDestination(
          playlistTitle,
          ["data-coda-playlist-title-detail"],
          "data-coda-playlist-title-return",
          "[data-coda-playlist-title-return]",
        ),
      );
      return;
    }
    case "now-playing-open":
      configureNowPlayingTransition(transition, true);
      return;
    case "now-playing-close":
      configureNowPlayingTransition(transition, false);
      return;
    case "page-forward":
    case "page-back":
    case "page-crossfade":
      configurePageTransition(transition, kind);
  }
}

export function motionViewTransitionsEnabled() {
  return import.meta.env.VITE_CODA_MOTION_VIEW_TRANSITIONS !== "0";
}

export async function transitionCodaViewWithMotion(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
): Promise<void> {
  const transitionId = ++latestMotionTransitionId;
  const snapshotDestination = sharedSnapshotDestination(kind);
  const sourceHadImage = sharedSnapshotSourceHasImage(kind);
  let updated = false;

  try {
    const transition = animateView(
      async () => {
        if (transitionId !== latestMotionTransitionId || updated) return;
        updated = true;
        await flushSync(update);
        await awaitSharedSnapshotReady(snapshotDestination, sourceHadImage);
      },
      {
        // Motion 12.43 rewrites an "immediate" update with a synchronous
        // forEach wrapper, discarding the Promise returned by our async Router
        // commit. Waiting preserves the render acknowledgement so the incoming
        // shared element exists before the browser captures its snapshot.
        interrupt: "wait",
      },
    );
    configureMotionTransition(transition, kind);
    let readyWatchdogId: number | undefined;
    const readiness = await Promise.race([
      Promise.resolve(
        transition as unknown as PromiseLike<AnimationPlaybackControls>,
      ).then((controls) => ({ controls, status: "ready" as const })),
      new Promise<{ status: "timed-out" }>((resolve) => {
        readyWatchdogId = window.setTimeout(() => {
          if (transitionId === latestMotionTransitionId) {
            supersedeMotionViewTransition();
            if (!updated) {
              updated = true;
              document.documentElement.classList.remove(
                "coda-view-transitions-supported",
              );
              try {
                // The watchdog owns visual cleanup, not the lifetime of a
                // potentially stalled Router commit. Let that commit finish
                // independently so transition classes and source markers are
                // always released at the bounded deadline.
                void Promise.resolve(update()).catch(() => undefined);
              } catch {
                // A synchronous navigation failure must not strand the root in
                // its transitioning state either.
              }
            }
          }
          resolve({ status: "timed-out" });
        }, MOTION_VIEW_TRANSITION_READY_WATCHDOG_MS);
      }),
    ]);
    if (readyWatchdogId !== undefined) {
      window.clearTimeout(readyWatchdogId);
    }
    if (readiness.status === "timed-out") return;
    const { controls } = readiness;
    let watchdogId: number | undefined;
    const watchdog = new Promise<void>((resolve) => {
      watchdogId = window.setTimeout(() => {
        if (transitionId === latestMotionTransitionId) {
          try {
            controls.stop();
          } catch {
            // The platform may already have detached its snapshot animations.
          }
          supersedeMotionViewTransition();
        }
        resolve();
      }, MOTION_VIEW_TRANSITION_WATCHDOG_MS);
    });
    try {
      await Promise.race([controls.finished, watchdog]);
    } finally {
      if (watchdogId !== undefined) window.clearTimeout(watchdogId);
    }
  } catch (cause) {
    if (transitionId === latestMotionTransitionId && !updated) {
      updated = true;
      document.documentElement.classList.remove(
        "coda-view-transitions-supported",
      );
      await update();
    }
  }
}

export function supersedeMotionViewTransition() {
  latestMotionTransitionId += 1;
  if (typeof document.getAnimations !== "function") return;

  for (const animation of document.getAnimations()) {
    const effect = animation.effect as KeyframeEffect | null;
    if (
      effect?.target === document.documentElement &&
      effect.pseudoElement?.startsWith("::view-transition")
    ) {
      try {
        animation.finish();
      } catch {
        animation.cancel();
      }
    }
  }
}
