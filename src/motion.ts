import { codaMotion, type ViewTransitionTiming } from "./motionProfile";

export { codaMotion };
export { useCodaMotion } from "./MotionProvider";

type SpringViewTransitionTiming = Extract<
  ViewTransitionTiming,
  { type: unknown }
>;

export const codaViewTransitionMotion = codaMotion.viewTransition as Readonly<{
  detailArtwork: SpringViewTransitionTiming;
  detailIdentity: SpringViewTransitionTiming;
  detailTitle: SpringViewTransitionTiming;
}>;

export const codaViewForwardMotion = {
  exit: codaMotion.viewExit,
  enter: codaMotion.viewEnter,
};
