import type { Transition } from "motion/react";

type CubicBezier = [number, number, number, number];

const viewEnterDelay = 0.015;
const viewEnterEase: CubicBezier = [0.22, 1, 0.36, 1];
const viewExitEase: CubicBezier = [0.4, 0, 1, 1];

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
  detailArtwork: {
    type: "spring",
    visualDuration: 0.46,
    bounce: 0.08,
  },
  detailIdentity: {
    type: "spring",
    visualDuration: 0.44,
    bounce: 0.04,
  },
  detailTitle: {
    type: "spring",
    visualDuration: 0.44,
    bounce: 0,
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

export const codaViewForwardMotion = {
  exit: codaMotion.viewExit,
  enter: {
    ...codaMotion.view,
    delay: viewEnterDelay,
  },
} satisfies Record<string, Transition>;
