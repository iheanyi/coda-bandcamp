import type { Transition } from "motion/react";

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
  view: {
    duration: 0.22,
    ease: [0.22, 1, 0.36, 1],
  },
  sharedArtwork: {
    duration: 0.44,
    ease: [0.22, 1, 0.36, 1],
  },
  gentleSpring: {
    type: "spring",
    visualDuration: 0.22,
    bounce: 0.08,
  },
} satisfies Record<string, Transition>;
