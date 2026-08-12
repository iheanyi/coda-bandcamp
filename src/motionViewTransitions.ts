import {
  animateView,
  type AnimationPlaybackControls,
  type Transition,
  type ViewTransitionBuilder,
} from "motion";
import { flushSync } from "react-dom";
import {
  beginMotionDiagnostic,
  endpointIssues,
  finishMotionDiagnostic,
  inspectMotionPseudoLayers,
  pseudoLayersPair,
  rectSnapshot,
  updateMotionDiagnostic,
} from "./motionDiagnostics";
import type { ResolvedMotionProfile } from "./motionProfile";
import { snapshotMotionProfile } from "./motionProfileStore";
import type {
  CodaViewTransitionKind,
  CodaViewTransitionUpdate,
} from "./viewTransitions";

const SHARED_ARTWORK_CLASS = "coda-motion-shared-artwork";
const SHARED_IDENTITY_CLASS = "coda-motion-shared-identity";
const SHARED_TITLE_CLASS = "coda-motion-shared-title";
const DETAIL_SURFACE_CLASS = "coda-motion-detail-surface";
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

// Candidate selectors are derived while the old route is still mounted, but
// their existence is resolved only after the Router has committed the new
// route. Return markers cannot exist before that commit.
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
        : document.querySelector("[data-coda-artist-name-source]")
          ? "[data-coda-artist-name-detail]"
          : undefined;
    case "artist-detail-close": {
      const source = document.querySelector(
        "[data-coda-artist-artwork-detail][data-slot='cover']",
      );
      const artworkDestination = source
        ? identityDestination(
            source,
            ["data-coda-artist-artwork-detail"],
            "data-coda-artist-artwork-return",
            "[data-coda-artist-artwork-return]",
          )
        : undefined;
      const nameSource = document.querySelector(
        "[data-coda-artist-name-detail]",
      );
      const nameDestination = nameSource
        ? identityDestination(
            nameSource,
            ["data-coda-artist-name-detail"],
            "data-coda-artist-name-return",
            "[data-coda-artist-name-return]",
          )
        : undefined;
      return [artworkDestination, nameDestination].filter(
        (destination): destination is string => Boolean(destination),
      );
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

function sharedSnapshotDestinations(kind: CodaViewTransitionKind) {
  const destination = sharedSnapshotDestination(kind);
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
  "artist-detail":
    ":is([data-coda-artist-artwork-source] [data-slot='cover'], [data-coda-artist-artwork-source][data-slot='cover'])",
  "artist-detail-close": "[data-coda-artist-artwork-detail][data-slot='cover']",
  "discover-detail": "[data-coda-discover-artwork-source]",
  "discover-detail-close": "[data-coda-discover-artwork-detail]",
  "radio-detail": "[data-coda-radio-artwork-source]",
  "radio-detail-close": "[data-coda-radio-artwork-detail]",
  "playlist-detail": "[data-coda-playlist-identity-source]",
  "playlist-detail-close": "[data-coda-playlist-identity-detail]",
  "now-playing-open": ".player__art-link",
  "now-playing-close": ".now-playing__artwork",
};

function sharedSnapshotSource(kind: CodaViewTransitionKind) {
  const preferredSelector = SHARED_DIAGNOSTIC_SOURCE_SELECTORS[kind];
  const selector =
    preferredSelector && document.querySelector(preferredSelector)
      ? preferredSelector
      : kind === "artist-detail"
        ? "[data-coda-artist-name-source]"
        : kind === "artist-detail-close"
          ? "[data-coda-artist-name-detail]"
          : preferredSelector;
  return selector ? document.querySelector<HTMLElement>(selector) : null;
}

function sharedSnapshotSourceCount(kind: CodaViewTransitionKind) {
  const source = sharedSnapshotSource(kind);
  if (!source) return 0;
  const preferredSelector = SHARED_DIAGNOSTIC_SOURCE_SELECTORS[kind];
  if (preferredSelector && source.matches(preferredSelector)) {
    return document.querySelectorAll(preferredSelector).length;
  }
  const fallbackSelector =
    kind === "artist-detail"
      ? "[data-coda-artist-name-source]"
      : "[data-coda-artist-name-detail]";
  return document.querySelectorAll(fallbackSelector).length;
}

function sharedSnapshotSourceHasImage(kind: CodaViewTransitionKind) {
  const source = sharedSnapshotSource(kind);
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
    destinationRect: rectSnapshot(target.getBoundingClientRect()),
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
        motion.detailIdentityFade,
      )
      .new(
        {
          opacity: [motion.profile.shared.opacityFrom, 1],
          transform: [`scale(${motion.profile.shared.scaleFrom})`, "scale(1)"],
        },
        motion.detailIdentityFade,
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
) {
  if (!source) return;

  transition
    .add(source, destination)
    .class(SHARED_TITLE_CLASS)
    .group(false)
    .crop(false)
    .layout(motion.viewTransition.detailTitle)
    .old(
      { opacity: [1, motion.profile.shared.opacityFrom] },
      motion.detailIdentityFade,
    )
    .new(
      { opacity: [motion.profile.shared.opacityFrom, 1] },
      motion.detailIdentityFade,
    );
}

function configureNowPlayingTransition(
  transition: ViewTransitionBuilder,
  opening: boolean,
  motion: ResolvedMotionProfile,
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
    motion,
    motion.viewTransition.detailArtwork,
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
      motion.componentExit,
    );
    header.enter(
      {
        opacity: [motion.profile.component.opacityFrom, 1],
        transform: [
          `translateY(${motion.profile.component.translationPx}px)`,
          componentRest,
        ],
      },
      { ...motion.componentEnter, delay: 0.05 / motion.profile.speed },
    );
    details.enter(
      {
        opacity: [motion.profile.component.opacityFrom, 1],
        transform: [
          `translateY(${motion.profile.component.translationPx}px)`,
          componentRest,
        ],
      },
      { ...motion.componentEnter, delay: 0.08 / motion.profile.speed },
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
      motion.componentEnter,
    );
    const exit = {
      opacity: motion.profile.component.opacityFrom,
      transform: `translateY(${motion.profile.component.translationPx * 0.75}px)`,
    };
    header.exit(exit, motion.componentExit);
    details.exit(exit, motion.componentExit);
  }
}

function configureMotionTransition(
  transition: ViewTransitionBuilder,
  kind: CodaViewTransitionKind,
  motion: ResolvedMotionProfile,
) {
  switch (kind) {
    case "album-detail":
      configureSharedElement(
        transition,
        document.querySelector(".coda-album-artwork-source"),
        ".album-detail__artwork [data-slot='cover']",
        motion,
        motion.viewTransition.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-album-detail-surface]",
        motion,
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-album-title-source]"),
        "[data-coda-album-title-detail]",
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
        SHARED_ARTWORK_CLASS,
        true,
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
        motion,
        motion.viewTransition.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-artist-detail-surface]",
        motion,
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-artist-name-source]"),
        "[data-coda-artist-name-detail]",
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
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
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-discover-detail-surface]",
        motion,
      );
      configureSharedTitle(
        transition,
        discoverTitle,
        identityDestination(
          discoverTitle,
          ["data-coda-discover-title-source", "data-coda-discover-title"],
          "data-coda-discover-title-detail",
          "[data-coda-discover-title-detail]",
        ),
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
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
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-radio-detail-surface]",
        motion,
      );
      configureSharedTitle(
        transition,
        radioTitle,
        identityDestination(
          radioTitle,
          ["data-coda-radio-title-source"],
          "data-coda-radio-title-detail",
          "[data-coda-radio-title-detail]",
        ),
        motion,
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
        motion,
        motion.viewTransition.detailArtwork,
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
        motion,
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
        motion,
        motion.viewTransition.detailIdentity,
        SHARED_IDENTITY_CLASS,
      );
      configureDetailSurface(
        transition,
        "[data-coda-playlist-detail-surface]",
        motion,
      );
      configureSharedTitle(
        transition,
        playlistTitle,
        identityDestination(
          playlistTitle,
          ["data-coda-playlist-title-source"],
          "data-coda-playlist-title-detail",
          "[data-coda-playlist-title-detail]",
        ),
        motion,
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
        motion,
        motion.viewTransition.detailIdentity,
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
        motion,
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
  if (kind.startsWith("now-playing")) {
    durations.push(
      profile.component.enter.durationMs + 80,
      profile.component.exit.durationMs,
    );
  }
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
  const snapshotDestinations = sharedSnapshotDestinations(kind);
  const sourceHadImage = sharedSnapshotSourceHasImage(kind);
  const source = sharedSnapshotSource(kind);
  const sourceCount = sharedSnapshotSourceCount(kind);
  const sourceName = source ? getComputedStyle(source).viewTransitionName : "";
  const sharedExpected = snapshotDestinations.length > 0;
  const configuredDurationMs = configuredVisualDuration(kind, motion);
  const diagnosticId = beginMotionDiagnostic({
    kind,
    configuredDurationMs,
    speed: motion.profile.speed,
    transitionClass,
    transitionNames: sourceName && sourceName !== "none" ? [sourceName] : [],
    transitionClasses: [
      transitionClass,
      kind.startsWith("playlist")
        ? SHARED_IDENTITY_CLASS
        : kind.startsWith("page")
          ? "coda-motion-page"
          : SHARED_ARTWORK_CLASS,
    ],
    sourceRect: source
      ? rectSnapshot(source.getBoundingClientRect())
      : undefined,
    sourceCount,
    destinationCount: 0,
    sharedExpected,
  });
  let updated = false;
  let capturedDestinationCount = 0;
  let capturedDestinationNames: readonly string[] = [];

  try {
    const transition = animateView(
      async () => {
        if (transitionId !== latestMotionTransitionId || updated) return;
        updated = true;
        await flushSync(update);
        const destination = inspectSharedSnapshotDestination(
          snapshotDestinations,
          sourceHadImage,
        );
        const destinationCount = destination?.destinationCount ?? 0;
        capturedDestinationCount = destinationCount;
        capturedDestinationNames = destination?.destinationNames ?? [];
        updateMotionDiagnostic(diagnosticId, {
          destinationCount,
          destinationRect: destination?.destinationRect,
          imageInsertionMs: destination?.imageInsertionMs,
          imageDecodeMs: destination?.imageDecodeMs,
          transitionNames: [
            ...(sourceName && sourceName !== "none" ? [sourceName] : []),
            ...(destination?.destinationNames ?? []),
          ],
          ...endpointIssues(sourceCount, destinationCount),
        });
        void destination?.imageDecodeReady?.then((imageDecodeMs) => {
          updateMotionDiagnostic(diagnosticId, { imageDecodeMs });
        });
      },
      {
        // Motion 12.43 rewrites an "immediate" update with a synchronous
        // forEach wrapper, discarding the Promise returned by our async Router
        // commit. Waiting preserves the render acknowledgement so the incoming
        // shared element exists before the browser captures its snapshot.
        interrupt: "wait",
      },
    );
    configureMotionTransition(transition, kind, motion);
    // TanStack Router's navigate promise resolves after its route commit and
    // render acknowledgement. Motion's builder then resolves when the browser
    // has captured that committed destination. Those are the lifecycle
    // boundaries; do not layer timing-based readiness guesses over them.
    const controls = await Promise.resolve(
      transition as unknown as PromiseLike<AnimationPlaybackControls>,
    );
    const expectedTransitionNames = [
      ...(sourceName && sourceName !== "none" ? [sourceName] : []),
      ...capturedDestinationNames,
    ];
    const pseudo = inspectMotionPseudoLayers(expectedTransitionNames);
    updateMotionDiagnostic(diagnosticId, {
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
          pseudoLayersPair(pseudo.layers, expectedTransitionNames)
        : undefined,
    });
    await controls.finished;
    finishMotionDiagnostic(diagnosticId, "finished");
  } catch (cause) {
    if (transitionId === latestMotionTransitionId && !updated) {
      updated = true;
      document.documentElement.classList.remove(
        "coda-view-transitions-supported",
      );
      await update();
    }
    finishMotionDiagnostic(
      diagnosticId,
      "fallback",
      cause instanceof Error ? cause.message.slice(0, 160) : "transition-error",
    );
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
