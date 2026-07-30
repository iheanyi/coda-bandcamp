import {
  animateView,
  type AnimationPlaybackControls,
  type ViewTransitionBuilder,
} from "motion";
import type { Transition } from "motion/react";
import { flushSync } from "react-dom";
import { codaMotion, codaViewForwardMotion } from "./motion";
import type { CodaViewTransitionKind } from "./viewTransitions";

const SHARED_ARTWORK_CLASS = "coda-motion-shared-artwork";
const SHARED_IDENTITY_CLASS = "coda-motion-shared-identity";
const SHARED_TITLE_CLASS = "coda-motion-shared-title";
const DETAIL_SURFACE_CLASS = "coda-motion-detail-surface";

let latestMotionTransitionId = 0;

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

  if (kind === "page-back") {
    return;
  }

  page
    .old(
      {
        opacity: 0,
        transform: "translateX(-6px)",
      },
      codaViewForwardMotion.exit,
    )
    .new(
      {
        opacity: [0, 1],
        transform: ["translateX(10px)", "translateX(0px)"],
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
    .old({ opacity: [0, 0] })
    .new({ opacity: [1, 1] });
}

function configureNowPlayingTransition(
  transition: ViewTransitionBuilder,
  opening: boolean,
) {
  configureSharedElement(
    transition,
    document.querySelector(
      opening ? ".player__art-link" : ".now-playing__artwork",
    ),
    opening ? ".now-playing__artwork" : ".player__art-link",
  );
  configureSharedTitle(
    transition,
    document.querySelector(
      opening
        ? "[data-coda-now-playing-title-compact]"
        : "[data-coda-now-playing-title-detail]",
    ),
    opening
      ? "[data-coda-now-playing-title-detail]"
      : "[data-coda-now-playing-title-compact]",
  );

  const player = transition
    .add("footer[data-player-mode]")
    .group(false);
  const header = transition.add(".now-playing__header").group(false);
  const details = transition.add(".now-playing__details").group(false);
  if (opening) {
    player.exit(
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
    player.enter(
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
      configureDetailSurface(
        transition,
        "[data-coda-album-detail-surface]",
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-album-title-source]"),
        "[data-coda-album-title-detail]",
      );
      return;
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
      configureDetailSurface(
        transition,
        "[data-coda-artist-detail-surface]",
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-artist-name-source]"),
        "[data-coda-artist-name-detail]",
      );
      return;
    case "discover-detail":
      configureSharedElement(
        transition,
        document.querySelector("[data-coda-discover-artwork-source]"),
        "[data-coda-discover-artwork-detail]",
        codaMotion.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-discover-detail-surface]",
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-discover-title-source]"),
        "[data-coda-discover-title-detail]",
      );
      return;
    case "radio-detail":
      configureSharedElement(
        transition,
        document.querySelector("[data-coda-radio-artwork-source]"),
        "[data-coda-radio-artwork-detail]",
        codaMotion.detailArtwork,
      );
      configureDetailSurface(
        transition,
        "[data-coda-radio-detail-surface]",
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-radio-title-source]"),
        "[data-coda-radio-title-detail]",
      );
      return;
    case "radio-detail-close":
      configureSharedElement(
        transition,
        document.querySelector("[data-coda-radio-artwork-detail]"),
        "[data-coda-radio-artwork-return]",
        codaMotion.detailArtwork,
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-radio-title-detail]"),
        "[data-coda-radio-title-return]",
      );
      return;
    case "playlist-detail":
      configureSharedElement(
        transition,
        document.querySelector("[data-coda-playlist-identity-source]"),
        "[data-coda-playlist-identity-detail]",
        codaMotion.detailIdentity,
        SHARED_IDENTITY_CLASS,
      );
      configureDetailSurface(
        transition,
        "[data-coda-playlist-detail-surface]",
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-playlist-title-source]"),
        "[data-coda-playlist-title-detail]",
      );
      return;
    case "playlist-detail-close":
      configureSharedElement(
        transition,
        document.querySelector("[data-coda-playlist-identity-detail]"),
        "[data-coda-playlist-identity-return]",
        codaMotion.detailIdentity,
        SHARED_IDENTITY_CLASS,
      );
      configureSharedTitle(
        transition,
        document.querySelector("[data-coda-playlist-title-detail]"),
        "[data-coda-playlist-title-return]",
      );
      return;
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
  update: () => void,
  kind: CodaViewTransitionKind,
): Promise<void> {
  const transitionId = ++latestMotionTransitionId;
  let updated = false;
  const transition = animateView(
    () => {
      if (transitionId !== latestMotionTransitionId || updated) return;
      updated = true;
      flushSync(update);
    },
    {
      interrupt: "immediate",
    },
  );
  configureMotionTransition(transition, kind);

  try {
    const controls = await (
      transition as unknown as PromiseLike<AnimationPlaybackControls>
    );
    await controls.finished;
  } catch {
    if (transitionId === latestMotionTransitionId && !updated) {
      updated = true;
      update();
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
