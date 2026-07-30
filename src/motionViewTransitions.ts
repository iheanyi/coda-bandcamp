import {
  animateView,
  type AnimationPlaybackControls,
  type ViewTransitionBuilder,
} from "motion";
import { flushSync } from "react-dom";
import { codaMotion } from "./motion";
import type { CodaViewTransitionKind } from "./viewTransitions";

const SHARED_ARTWORK_CLASS = "coda-motion-shared-artwork";

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
      .old({ opacity: 0 }, codaMotion.componentExit)
      .new({ opacity: [0, 1] }, {
        ...codaMotion.componentEnter,
        delay: 0.025,
      });
    return;
  }

  const forward = kind === "page-forward";
  page
    .old(
      {
        opacity: 0,
        transform: `translateX(${forward ? -8 : 8}px)`,
      },
      codaMotion.componentExit,
    )
    .new(
      {
        opacity: [0, 1],
        transform: [
          `translateX(${forward ? 12 : -12}px)`,
          "translateX(0px)",
        ],
      },
      {
        ...codaMotion.view,
        delay: 0.035,
      },
    );
}

function configureSharedArtwork(
  transition: ViewTransitionBuilder,
  source: Element | null,
  destination: string,
) {
  if (!source) return;

  transition
    .add(source, destination)
    .class(SHARED_ARTWORK_CLASS)
    .group(false)
    .layout(codaMotion.sharedArtwork);
}

function configureNowPlayingTransition(
  transition: ViewTransitionBuilder,
  opening: boolean,
) {
  configureSharedArtwork(
    transition,
    document.querySelector(
      opening ? ".player__art-link" : ".now-playing__artwork",
    ),
    opening ? ".now-playing__artwork" : ".player__art-link",
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
      configureSharedArtwork(
        transition,
        document.querySelector(".coda-album-artwork-source"),
        ".album-detail__artwork [data-slot='cover']",
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
  return import.meta.env.VITE_CODA_MOTION_VIEW_TRANSITIONS === "1";
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
