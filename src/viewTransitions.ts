import { flushSync } from "react-dom";

export type CodaViewTransitionKind =
  | "now-playing"
  | "page-forward"
  | "page-back"
  | "page-crossfade";

type CodaViewTransition = {
  finished: Promise<void>;
};

type CodaViewTransitionOptions = {
  skipSnapshot?: boolean;
};

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => void) => CodaViewTransition;
};

const TRANSITION_CLASSES: Record<CodaViewTransitionKind, string> = {
  "now-playing": "coda-transition--now-playing",
  "page-forward": "coda-transition--page-forward",
  "page-back": "coda-transition--page-back",
  "page-crossfade": "coda-transition--page-crossfade",
};

export function transitionCodaView(
  update: () => void,
  kind: CodaViewTransitionKind,
  options: CodaViewTransitionOptions = {},
): Promise<void> {
  if (options.skipSnapshot) {
    update();
    return Promise.resolve();
  }

  const transitionDocument = document as ViewTransitionDocument;
  const prefersReducedMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!transitionDocument.startViewTransition || prefersReducedMotion) {
    update();
    return Promise.resolve();
  }

  const transitionClass = TRANSITION_CLASSES[kind];
  let updated = false;
  document.documentElement.classList.add(
    "coda-view-transitions-supported",
    "coda-view-transitioning",
    transitionClass,
  );
  try {
    const transition = transitionDocument.startViewTransition.call(
      transitionDocument,
      () => {
        updated = true;
        flushSync(update);
      },
    );
    return transition.finished
      .catch(() => undefined)
      .finally(() => {
        document.documentElement.classList.remove(
          "coda-view-transitioning",
          transitionClass,
        );
      });
  } catch {
    document.documentElement.classList.remove(
      "coda-view-transitioning",
      transitionClass,
    );
    if (!updated) update();
    return Promise.resolve();
  }
}
