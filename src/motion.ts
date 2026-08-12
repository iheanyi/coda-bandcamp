import { spring, type AnimationOptions } from "motion";
import type { Transition } from "motion/react";

type CubicBezier = [number, number, number, number];

const viewEnterDelay = 0.015;
const viewEnterEase: CubicBezier = [0.22, 1, 0.36, 1];
const viewExitEase: CubicBezier = [0.4, 0, 1, 1];
const detailArtworkSpring = {
  visualDuration: 0.3,
  bounce: 0.06,
};
const detailIdentitySpring = {
  visualDuration: 0.28,
  bounce: 0.04,
};
const detailTitleSpring = {
  visualDuration: 0.26,
  bounce: 0,
};

export const codaMotion = {
  feedback: {
    duration: 0.14,
    ease: [0.22, 1, 0.36, 1],
  },
  componentEnter: {
    duration: 0.18,
    ease: [0.22, 1, 0.36, 1],
  },
  componentExit: {
    duration: 0.14,
    ease: [0.4, 0, 1, 1],
  },
  viewExit: {
    duration: 0.12,
    ease: viewExitEase,
  },
  view: {
    duration: 0.18,
    ease: viewEnterEase,
  },
  sharedArtwork: {
    duration: 0.44,
    ease: [0.22, 1, 0.36, 1],
  },
  detailIdentityFade: {
    duration: 0.2,
    ease: "linear",
  },
  detailSurfaceEnter: {
    duration: 0.3,
    ease: viewEnterEase,
  },
  gentleSpring: {
    type: "spring",
    visualDuration: 0.22,
    bounce: 0.08,
  },
  selectionPill: {
    type: "spring",
    visualDuration: 0.3,
    bounce: 0.04,
  },
} satisfies Record<string, Transition>;

// Motion's View Transition builder uses the DOM animation API, where a spring
// must be supplied as a generator function. A React-style `type: "spring"`
// silently falls back to a 300ms ease-out and lets the snapshot opacity trail
// behind the geometry.
export const codaViewTransitionMotion = {
  detailArtwork: {
    type: spring,
    ...detailArtworkSpring,
  },
  detailIdentity: {
    type: spring,
    ...detailIdentitySpring,
  },
  detailTitle: {
    type: spring,
    ...detailTitleSpring,
  },
} satisfies Record<string, AnimationOptions>;

export const codaViewForwardMotion = {
  exit: codaMotion.viewExit,
  enter: {
    ...codaMotion.view,
    delay: viewEnterDelay,
  },
} satisfies Record<string, Transition>;
