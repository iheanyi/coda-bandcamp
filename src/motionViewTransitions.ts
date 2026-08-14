import {
  animateView,
  spring,
  type AnimationPlaybackControls,
  type Transition,
  type ViewTransitionBuilder,
} from "motion";
import { flushSync } from "react-dom";
import {
  resolveDetailTransition,
  type ResolvedDetailTransition,
} from "./detailTransitionDescriptors";
import {
  motionDiagnosticsActive,
  motionDiagnosticsRuntime,
} from "./motionDiagnosticsRuntime";
import type { ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileRuntime";
import type {
  CodaViewTransitionKind,
  CodaViewTransitionUpdate,
} from "./viewTransitions";

const SHARED_ARTWORK_CLASS = "coda-motion-shared-artwork";
const SHARED_IDENTITY_CLASS = "coda-motion-shared-identity";
const SHARED_TITLE_CLASS = "coda-motion-shared-title";
const DETAIL_SURFACE_CLASS = "coda-motion-detail-surface";
const ALBUM_DETAIL_ARTWORK_VISUAL_DURATION_MS = 220;
const ALBUM_DETAIL_ARTWORK_BOUNCE = 0.08;
const ALBUM_DETAIL_TITLE_VISUAL_DURATION_MS = 190;
const ALBUM_DETAIL_TITLE_BOUNCE = 0.04;
const ALBUM_DETAIL_FADE_DURATION_MS = 130;
const NOW_PLAYING_ARTWORK_VISUAL_DURATION_MS = 200;
const NOW_PLAYING_ARTWORK_BOUNCE = 0.1;
const NOW_PLAYING_TITLE_VISUAL_DURATION_MS = 180;
const NOW_PLAYING_TITLE_BOUNCE = 0.05;
const NOW_PLAYING_FADE_DURATION_MS = 130;
const NOW_PLAYING_COMPONENT_ENTER_DURATION_MS = 140;
const NOW_PLAYING_COMPONENT_EXIT_DURATION_MS = 100;
const NOW_PLAYING_HEADER_DELAY_MS = 20;
const NOW_PLAYING_DETAILS_DELAY_MS = 35;
const NOW_PLAYING_EASE: [number, number, number, number] = [0.22, 1, 0.36, 1];
const MOTION_OWNED_VIEW_TRANSITION_NAME = /^motion-view-\d+$/;
const EMPTY_TRANSITION_NAMES: readonly string[] = [];
let latestMotionTransitionId = 0;

function cappedDurationMs(durationMs: number, maximumMs: number) {
  return Math.min(durationMs, maximumMs);
}

function cappedTween(
  durationMs: number,
  maximumMs: number,
  motion: ResolvedMotionProfile,
): Transition {
  return {
    duration:
      cappedDurationMs(durationMs, maximumMs) / motion.profile.speed / 1_000,
    ease: NOW_PLAYING_EASE,
  };
}

function cappedSpring(
  durationMs: number,
  maximumVisualDurationMs: number,
  bounce: number,
  motion: ResolvedMotionProfile,
): Transition {
  return {
    type: spring,
    visualDuration:
      cappedDurationMs(durationMs, maximumVisualDurationMs) /
      motion.profile.speed /
      1_000,
    bounce,
  };
}

function clearStaleMotionViewTransitionNames() {
  document
    .querySelectorAll<HTMLElement>("[style*='view-transition-name']")
    .forEach((element) => {
      const name = element.style
        .getPropertyValue("view-transition-name")
        .trim();
      if (!MOTION_OWNED_VIEW_TRANSITION_NAME.test(name)) return;
      element.style.removeProperty("view-transition-name");
      element.style.removeProperty("view-transition-class");
      element.style.removeProperty("view-transition-group");
    });
}

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

// Candidate selectors are derived while the old route is still mounted, but
// their existence is resolved only after the Router has committed the new
// route. Return markers cannot exist before that commit.
function sharedSnapshotDestination(
  kind: CodaViewTransitionKind,
  detail: ResolvedDetailTransition | undefined,
) {
  if (detail) return detail.snapshotDestinations;
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
    case "artist-detail-close":
    case "daily-detail":
    case "daily-detail-close":
    case "discover-detail":
    case "discover-detail-close":
    case "radio-detail":
    case "radio-detail-close":
    case "playlist-detail":
    case "playlist-detail-close":
      return undefined;
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

function sharedSnapshotDestinations(
  kind: CodaViewTransitionKind,
  detail: ResolvedDetailTransition | undefined,
) {
  const destination = sharedSnapshotDestination(kind, detail);
  return Array.isArray(destination)
    ? destination
    : destination
      ? [destination]
      : [];
}

const SHARED_DIAGNOSTIC_SOURCE_SELECTORS: Partial<
  Record<CodaViewTransitionKind, string>
> = {
  "album-detail": ".coda-album-artwork-source",
  "album-detail-close": "[data-coda-album-artwork-detail]",
  "now-playing-open": ".player__art-link",
  "now-playing-close": ".now-playing__artwork",
};

function sharedSnapshotSource(
  kind: CodaViewTransitionKind,
  detail: ResolvedDetailTransition | undefined,
) {
  if (detail) return detail.diagnosticSource;
  const preferredSelector = SHARED_DIAGNOSTIC_SOURCE_SELECTORS[kind];
  return preferredSelector
    ? document.querySelector<HTMLElement>(preferredSelector)
    : null;
}

function sharedSnapshotSourceCount(
  kind: CodaViewTransitionKind,
  detail: ResolvedDetailTransition | undefined,
) {
  if (detail) return detail.diagnosticSourceCount;
  const source = sharedSnapshotSource(kind, detail);
  if (!source) return 0;
  const preferredSelector = SHARED_DIAGNOSTIC_SOURCE_SELECTORS[kind];
  if (preferredSelector && source.matches(preferredSelector)) {
    return document.querySelectorAll(preferredSelector).length;
  }
  return 0;
}

function sharedSnapshotSourceHasImage(
  kind: CodaViewTransitionKind,
  detail: ResolvedDetailTransition | undefined,
) {
  const source = sharedSnapshotSource(kind, detail);
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

function inspectSharedSnapshotDestination(
  destinations: readonly string[],
  sourceHadImage: boolean,
) {
  const destination = destinations.find((selector) =>
    document.querySelector(selector),
  );
  if (!destination) {
    return {
      destinationCount: 0,
      imageInsertionMs: 0,
      imageDecodeMs: 0,
      imageDecodeReady: undefined,
    };
  }
  const target = document.querySelector<HTMLElement>(destination);
  if (!target) {
    return {
      destinationCount: 0,
      imageInsertionMs: 0,
      imageDecodeMs: 0,
      imageDecodeReady: undefined,
    };
  }

  let imageInsertionMs = 0;
  let imageDecodeMs = 0;
  let imageDecodeReady: Promise<number> | undefined;
  if (sourceHadImage) {
    const insertionStartedAt = performance.now();
    const readyImages = imagesWithin(target);
    imageInsertionMs = performance.now() - insertionStartedAt;
    if (readyImages.length > 0) {
      const decodeStartedAt = performance.now();
      imageDecodeReady = Promise.all(readyImages.map(imageReady)).then(
        () => performance.now() - decodeStartedAt,
      );
    }
  }
  const destinationElements = Array.from(
    document.querySelectorAll<HTMLElement>(destination),
  );
  const destinationNames = destinationElements
    .map((element) => getComputedStyle(element).viewTransitionName)
    .filter((name) => name && name !== "none");
  return {
    destinationCount: new Set(destinationElements).size,
    destinationRect: motionDiagnosticsRuntime.rectSnapshot(
      target.getBoundingClientRect(),
    ),
    destinationNames,
    imageInsertionMs,
    imageDecodeMs,
    imageDecodeReady,
  };
}

function configurePageTransition(
  transition: ViewTransitionBuilder,
  kind: Extract<
    CodaViewTransitionKind,
    "page-forward" | "page-back" | "page-crossfade"
  >,
  motion: ResolvedMotionProfile,
) {
  const page = transition.add(".library-pane").group(false);

  if (kind === "page-crossfade" || motion.profile.page.mode === "crossfade") {
    page
      .old({ opacity: motion.profile.page.opacityFrom }, motion.viewExit)
      .new({ opacity: [motion.profile.page.opacityFrom, 1] }, motion.view);
    return;
  }

  const direction = kind === "page-back" ? -1 : 1;
  const pageScale =
    motion.profile.page.scaleFrom === 1
      ? ""
      : ` scale(${motion.profile.page.scaleFrom})`;
  page
    .old(
      {
        opacity: motion.profile.page.opacityFrom,
        transform: `translateX(${direction * -motion.profile.page.translationPx * 0.6}px)${pageScale}`,
      },
      motion.viewExit,
    )
    .new(
      {
        opacity: [motion.profile.page.opacityFrom, 1],
        transform: [
          `translateX(${direction * motion.profile.page.translationPx}px)${pageScale}`,
          motion.profile.page.scaleFrom === 1
            ? "translateX(0px)"
            : "translateX(0px) scale(1)",
        ],
      },
      motion.viewEnter,
    );
}

function configureSharedElement(
  transition: ViewTransitionBuilder,
  source: Element | null,
  destination: string,
  motion: ResolvedMotionProfile,
  layoutTransition: Transition = motion.viewTransition.detailArtwork,
  transitionClass = SHARED_ARTWORK_CLASS,
  preserveSourceVisual = false,
  fadeTransition: Transition = motion.detailIdentityFade,
) {
  if (!source) return;

  const shared = transition
    .add(source, destination)
    .class(transitionClass)
    .group(false);
  if (preserveSourceVisual) {
    // Return cards can remount with their generated placeholder visible while
    // the same cover image decodes. Keep the already-painted detail snapshot
    // as the sole visual for the morph; the live destination is revealed when
    // the native snapshot is released. This is an endpoint-stability invariant
    // even when the experimental shared choreography is a crossfade.
    shared
      .layout(layoutTransition)
      .old({ opacity: [1, 1] }, layoutTransition)
      .new({ opacity: [0, 0] }, layoutTransition);
    return;
  }
  if (motion.profile.shared.choreography === "crossfade") {
    shared
      .layout({ duration: 0 })
      .old(
        {
          opacity: motion.profile.shared.opacityFrom,
          transform: `scale(${motion.profile.shared.scaleFrom})`,
        },
        fadeTransition,
      )
      .new(
        {
          opacity: [motion.profile.shared.opacityFrom, 1],
          transform: [`scale(${motion.profile.shared.scaleFrom})`, "scale(1)"],
        },
        fadeTransition,
      );
    return;
  }
  shared.layout(layoutTransition);
}

function configureDetailSurface(
  transition: ViewTransitionBuilder,
  selector: string,
  motion: ResolvedMotionProfile,
) {
  const detailScale =
    motion.profile.detail.scaleFrom === 1
      ? ""
      : ` scale(${motion.profile.detail.scaleFrom})`;
  transition
    .add(selector)
    .class(DETAIL_SURFACE_CLASS)
    .group(false)
    .enter(
      {
        ...(motion.profile.detail.opacityFrom < 1
          ? { opacity: [motion.profile.detail.opacityFrom, 1] }
          : {}),
        transform: [
          `translateY(${motion.profile.detail.translationPx}px)${detailScale}`,
          motion.profile.detail.scaleFrom === 1
            ? "translateY(0px)"
            : "translateY(0px) scale(1)",
        ],
      },
      motion.detailSurfaceEnter,
    );
}

function configureSharedTitle(
  transition: ViewTransitionBuilder,
  source: Element | null,
  destination: string,
  motion: ResolvedMotionProfile,
  layoutTransition: Transition = motion.viewTransition.detailTitle,
  fadeTransition: Transition = motion.detailIdentityFade,
) {
  if (!source) return;

  transition
    .add(source, destination)
    .class(SHARED_TITLE_CLASS)
    .group(false)
    .crop(false)
    .layout(layoutTransition)
    .old({ opacity: [1, motion.profile.shared.opacityFrom] }, fadeTransition)
    .new({ opacity: [motion.profile.shared.opacityFrom, 1] }, fadeTransition);
}

function configureNowPlayingTransition(
  transition: ViewTransitionBuilder,
  opening: boolean,
  motion: ResolvedMotionProfile,
) {
  const artworkTransition = cappedSpring(
    motion.profile.shared.artwork.durationMs,
    NOW_PLAYING_ARTWORK_VISUAL_DURATION_MS,
    NOW_PLAYING_ARTWORK_BOUNCE,
    motion,
  );
  const titleTransition = cappedSpring(
    motion.profile.shared.title.durationMs,
    NOW_PLAYING_TITLE_VISUAL_DURATION_MS,
    NOW_PLAYING_TITLE_BOUNCE,
    motion,
  );
  const fadeTransition = cappedTween(
    motion.profile.shared.crossfade.durationMs,
    NOW_PLAYING_FADE_DURATION_MS,
    motion,
  );
  const componentEnter = cappedTween(
    motion.profile.component.enter.durationMs,
    NOW_PLAYING_COMPONENT_ENTER_DURATION_MS,
    motion,
  );
  const componentExit = cappedTween(
    motion.profile.component.exit.durationMs,
    NOW_PLAYING_COMPONENT_EXIT_DURATION_MS,
    motion,
  );
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
    motion,
    artworkTransition,
    SHARED_ARTWORK_CLASS,
    false,
    fadeTransition,
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
    motion,
    titleTransition,
    fadeTransition,
  );

  const player = transition.add("footer[data-player-mode]").group(false);
  const header = transition.add(".now-playing__header").group(false);
  const details = transition.add(".now-playing__details").group(false);
  const componentRest = "translateY(0px)";
  if (opening) {
    player.old(
      {
        opacity: motion.profile.component.opacityFrom,
        transform: `translateY(${motion.profile.component.translationPx * 0.75}px)`,
      },
      componentExit,
    );
    header.enter(
      {
        opacity: [motion.profile.component.opacityFrom, 1],
        transform: [
          `translateY(${motion.profile.component.translationPx}px)`,
          componentRest,
        ],
      },
      {
        ...componentEnter,
        delay: NOW_PLAYING_HEADER_DELAY_MS / motion.profile.speed / 1_000,
      },
    );
    details.enter(
      {
        opacity: [motion.profile.component.opacityFrom, 1],
        transform: [
          `translateY(${motion.profile.component.translationPx}px)`,
          componentRest,
        ],
      },
      {
        ...componentEnter,
        delay: NOW_PLAYING_DETAILS_DELAY_MS / motion.profile.speed / 1_000,
      },
    );
  } else {
    player.new(
      {
        opacity: [motion.profile.component.opacityFrom, 1],
        transform: [
          `translateY(${motion.profile.component.translationPx * 0.75}px)`,
          componentRest,
        ],
      },
      componentEnter,
    );
    const exit = {
      opacity: motion.profile.component.opacityFrom,
      transform: `translateY(${motion.profile.component.translationPx * 0.75}px)`,
    };
    header.exit(exit, componentExit);
    details.exit(exit, componentExit);
  }
}

function configureDetailTransition(
  transition: ViewTransitionBuilder,
  detail: ResolvedDetailTransition,
  motion: ResolvedMotionProfile,
) {
  const { descriptor } = detail;
  configureSharedElement(
    transition,
    detail.sharedSource,
    detail.sharedDestination,
    motion,
    descriptor.sharedKind === "identity"
      ? motion.viewTransition.detailIdentity
      : motion.viewTransition.detailArtwork,
    descriptor.sharedKind === "identity"
      ? SHARED_IDENTITY_CLASS
      : SHARED_ARTWORK_CLASS,
    descriptor.preserveSourceVisual,
  );
  if (descriptor.detailSurfaceSelector) {
    configureDetailSurface(
      transition,
      descriptor.detailSurfaceSelector,
      motion,
    );
  }
  configureSharedTitle(
    transition,
    detail.titleSource,
    detail.titleDestination,
    motion,
  );
}

function configureMotionTransition(
  transition: ViewTransitionBuilder,
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile,
  detail: ResolvedDetailTransition | undefined,
) {
  if (detail) {
    configureDetailTransition(transition, detail, motion);
    return;
  }
  switch (kind) {
    case "album-detail": {
      const artworkTransition = cappedSpring(
        motion.profile.shared.artwork.durationMs,
        ALBUM_DETAIL_ARTWORK_VISUAL_DURATION_MS,
        ALBUM_DETAIL_ARTWORK_BOUNCE,
        motion,
      );
      const titleTransition = cappedSpring(
        motion.profile.shared.title.durationMs,
        ALBUM_DETAIL_TITLE_VISUAL_DURATION_MS,
        ALBUM_DETAIL_TITLE_BOUNCE,
        motion,
      );
      const fadeTransition = cappedTween(
        motion.profile.shared.crossfade.durationMs,
        ALBUM_DETAIL_FADE_DURATION_MS,
        motion,
      );
      configureSharedElement(
        transition,
        document.querySelector(".coda-album-artwork-source"),
        ".album-detail__artwork [data-slot='cover']",
        motion,
        artworkTransition,
        SHARED_ARTWORK_CLASS,
        false,
        fadeTransition,
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-album-title-source]"),
        "[data-coda-album-title-detail]",
        motion,
        titleTransition,
        fadeTransition,
      );
      return;
    }
    case "album-detail-close": {
      const albumArtwork = document.querySelector(
        "[data-coda-album-artwork-detail]",
      );
      const albumTitle = document.querySelector(
        "[data-coda-album-title-detail]",
      );
      const artworkTransition = cappedSpring(
        motion.profile.shared.artwork.durationMs,
        ALBUM_DETAIL_ARTWORK_VISUAL_DURATION_MS,
        ALBUM_DETAIL_ARTWORK_BOUNCE,
        motion,
      );
      const titleTransition = cappedSpring(
        motion.profile.shared.title.durationMs,
        ALBUM_DETAIL_TITLE_VISUAL_DURATION_MS,
        ALBUM_DETAIL_TITLE_BOUNCE,
        motion,
      );
      const fadeTransition = cappedTween(
        motion.profile.shared.crossfade.durationMs,
        ALBUM_DETAIL_FADE_DURATION_MS,
        motion,
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
        motion,
        artworkTransition,
        SHARED_ARTWORK_CLASS,
        true,
        fadeTransition,
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
        motion,
        titleTransition,
        fadeTransition,
      );
      return;
    }
    case "now-playing-open":
      configureNowPlayingTransition(transition, true, motion);
      return;
    case "now-playing-close":
      configureNowPlayingTransition(transition, false, motion);
      return;
    case "page-forward":
    case "page-back":
    case "page-crossfade":
      configurePageTransition(transition, kind, motion);
  }
}

export function motionViewTransitionsEnabled() {
  // The product path is always enabled. Unit tests retain the isolated native
  // coordinator through Vitest's standard test mode, not a product flag.
  return import.meta.env.MODE !== "test";
}

function configuredVisualDuration(
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile,
) {
  const { profile } = motion;
  const scale = (durationMs: number) => durationMs / profile.speed;
  if (kind.startsWith("page")) {
    return Math.max(
      scale(profile.page.exit.durationMs),
      scale(profile.page.enter.durationMs + profile.page.enterDelayMs),
    );
  }
  if (kind.startsWith("now-playing")) {
    const durations = [
      cappedDurationMs(
        profile.shared.artwork.durationMs,
        NOW_PLAYING_ARTWORK_VISUAL_DURATION_MS,
      ),
      cappedDurationMs(
        profile.shared.title.durationMs,
        NOW_PLAYING_TITLE_VISUAL_DURATION_MS,
      ),
      cappedDurationMs(
        profile.shared.crossfade.durationMs,
        NOW_PLAYING_FADE_DURATION_MS,
      ),
      cappedDurationMs(
        profile.component.exit.durationMs,
        NOW_PLAYING_COMPONENT_EXIT_DURATION_MS,
      ),
    ];
    if (!kind.endsWith("close")) {
      durations.push(
        cappedDurationMs(
          profile.component.enter.durationMs,
          NOW_PLAYING_COMPONENT_ENTER_DURATION_MS,
        ) + NOW_PLAYING_DETAILS_DELAY_MS,
      );
    }
    return scale(Math.max(...durations));
  }
  if (kind.startsWith("album-detail")) {
    return scale(
      Math.max(
        cappedDurationMs(
          profile.shared.artwork.durationMs,
          ALBUM_DETAIL_ARTWORK_VISUAL_DURATION_MS,
        ),
        cappedDurationMs(
          profile.shared.title.durationMs,
          ALBUM_DETAIL_TITLE_VISUAL_DURATION_MS,
        ),
        cappedDurationMs(
          profile.shared.crossfade.durationMs,
          ALBUM_DETAIL_FADE_DURATION_MS,
        ),
      ),
    );
  }
  const sharedTiming = kind.startsWith("playlist")
    ? profile.shared.identity
    : profile.shared.artwork;
  const sharedDuration =
    profile.shared.choreography === "crossfade"
      ? profile.shared.crossfade.durationMs
      : sharedTiming.durationMs;
  const durations = [sharedDuration, profile.shared.title.durationMs];
  if (!kind.endsWith("close"))
    durations.push(profile.detail.surface.durationMs);
  return scale(Math.max(...durations));
}

export async function transitionCodaViewWithMotion(
  update: CodaViewTransitionUpdate,
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile = snapshotMotionProfile(),
  transitionClass = `coda-transition--${kind}`,
): Promise<void> {
  // Motion queues builders configured with `interrupt: "wait"`. Finish the
  // previous snapshot before enqueueing this one so rapid primary navigation
  // remains latest-wins instead of sitting behind the prior animation's full
  // settled timeline.
  supersedeMotionViewTransition();
  const transitionId = ++latestMotionTransitionId;
  const detail = resolveDetailTransition(kind);
  const diagnostics = motionDiagnosticsActive()
    ? motionDiagnosticsRuntime
    : undefined;
  const snapshotDestinations = diagnostics
    ? sharedSnapshotDestinations(kind, detail)
    : EMPTY_TRANSITION_NAMES;
  const sourceHadImage = diagnostics
    ? sharedSnapshotSourceHasImage(kind, detail)
    : false;
  const source = diagnostics ? sharedSnapshotSource(kind, detail) : null;
  const sourceCount = diagnostics ? sharedSnapshotSourceCount(kind, detail) : 0;
  const sourceName = source ? getComputedStyle(source).viewTransitionName : "";
  const sharedExpected = snapshotDestinations.length > 0;
  const diagnosticId = diagnostics?.begin({
    kind,
    configuredDurationMs: configuredVisualDuration(kind, motion),
    speed: motion.profile.speed,
    transitionClass,
    transitionNames: sourceName && sourceName !== "none" ? [sourceName] : [],
    transitionClasses: [
      transitionClass,
      detail?.descriptor.sharedKind === "identity"
        ? SHARED_IDENTITY_CLASS
        : kind.startsWith("page")
          ? "coda-motion-page"
          : SHARED_ARTWORK_CLASS,
    ],
    sourceRect: source
      ? diagnostics.rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount,
    destinationCount: 0,
    sharedExpected,
  });
  let updated = false;
  let capturedDestinationCount = 0;
  let capturedDestinationNames = EMPTY_TRANSITION_NAMES;

  try {
    const defaultTransition = kind.startsWith("now-playing")
      ? cappedSpring(
          motion.profile.shared.artwork.durationMs,
          NOW_PLAYING_ARTWORK_VISUAL_DURATION_MS,
          NOW_PLAYING_ARTWORK_BOUNCE,
          motion,
        )
      : kind.startsWith("album-detail")
        ? cappedSpring(
            motion.profile.shared.artwork.durationMs,
            ALBUM_DETAIL_ARTWORK_VISUAL_DURATION_MS,
            ALBUM_DETAIL_ARTWORK_BOUNCE,
            motion,
          )
        : undefined;
    const transition = animateView(
      async () => {
        if (transitionId !== latestMotionTransitionId || updated) return;
        updated = true;
        await flushSync(update);
        const destination = diagnostics
          ? inspectSharedSnapshotDestination(
              snapshotDestinations,
              sourceHadImage,
            )
          : undefined;
        const destinationCount = destination?.destinationCount ?? 0;
        capturedDestinationCount = destinationCount;
        capturedDestinationNames = destination?.destinationNames ?? [];
        if (diagnosticId !== undefined)
          diagnostics?.update(diagnosticId, {
            destinationCount,
            destinationRect: destination?.destinationRect,
            imageInsertionMs: destination?.imageInsertionMs,
            imageDecodeMs: destination?.imageDecodeMs,
            transitionNames: [
              ...(sourceName && sourceName !== "none" ? [sourceName] : []),
              ...(destination?.destinationNames ?? []),
            ],
            ...diagnostics.endpointIssues(sourceCount, destinationCount),
          });
        void destination?.imageDecodeReady?.then((imageDecodeMs) => {
          if (diagnosticId !== undefined) {
            diagnostics?.update(diagnosticId, { imageDecodeMs });
          }
        });
      },
      {
        // Motion 12.43 rewrites an "immediate" update with a synchronous
        // forEach wrapper, discarding the Promise returned by our async Router
        // commit. Waiting preserves the render acknowledgement so the incoming
        // shared element exists before the browser captures its snapshot.
        interrupt: "wait",
        ...defaultTransition,
      },
    );
    configureMotionTransition(transition, kind, motion, detail);
    // TanStack Router's navigate promise resolves after its route commit and
    // render acknowledgement. Motion's builder then resolves when the browser
    // has captured that committed destination. Those are the lifecycle
    // boundaries; do not layer timing-based readiness guesses over them.
    const controls = await Promise.resolve(
      transition as unknown as PromiseLike<AnimationPlaybackControls>,
    );
    if (diagnostics && diagnosticId !== undefined) {
      const expectedTransitionNames = [
        ...(sourceName && sourceName !== "none" ? [sourceName] : []),
        ...capturedDestinationNames,
      ];
      const pseudo = diagnostics.inspectPseudoLayers(expectedTransitionNames);
      diagnostics.update(diagnosticId, {
        pseudoLayers: pseudo.layers,
        actualDurationMs: pseudo.actualDurationMs,
        transitionNames: [
          ...new Set([
            ...(sourceName && sourceName !== "none" ? [sourceName] : []),
            ...capturedDestinationNames,
            ...pseudo.layers.group,
          ]),
        ],
        sharedPaired: sharedExpected
          ? sourceCount === 1 &&
            capturedDestinationCount === 1 &&
            diagnostics.pseudoLayersPair(pseudo.layers, expectedTransitionNames)
          : undefined,
      });
    }
    await controls.finished;
    if (diagnosticId !== undefined) {
      diagnostics?.finish(diagnosticId, "finished");
    }
  } catch (cause) {
    if (transitionId === latestMotionTransitionId && !updated) {
      updated = true;
      document.documentElement.classList.remove(
        "coda-view-transitions-supported",
      );
      await update();
    }
    if (diagnosticId !== undefined) {
      diagnostics?.finish(
        diagnosticId,
        "fallback",
        cause instanceof Error
          ? cause.message.slice(0, 160)
          : "transition-error",
      );
    }
  }
}

export function supersedeMotionViewTransition() {
  latestMotionTransitionId += 1;
  if (typeof document.getAnimations === "function") {
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
  clearStaleMotionViewTransitionNames();
}
