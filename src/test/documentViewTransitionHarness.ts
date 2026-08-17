import {
  ALL_CODA_VIEW_TRANSITION_KINDS,
  codaViewTransitionClass,
  DETAIL_TRANSITION_DESCRIPTORS,
  type CodaViewTransitionKind,
} from "@/detailTransitionDescriptors";

type ViewTransitionUpdate = () => void | Promise<void>;

export type TestDocumentViewTransition = Readonly<{
  className: string;
  finished: Promise<void>;
  kind: CodaViewTransitionKind | undefined;
  ready: Promise<void>;
  resolve: () => void;
  skipTransition: () => void;
  updateCallbackDone: Promise<void>;
}>;

export type TestDocumentViewTransitionCapture = Readonly<{
  className: string;
  kind: CodaViewTransitionKind | undefined;
}>;

function transitionKind(className: string): CodaViewTransitionKind | undefined {
  return ALL_CODA_VIEW_TRANSITION_KINDS.find((kind) =>
    className.split(/\s+/u).includes(codaViewTransitionClass(kind)),
  );
}

function compositorAnimations() {
  const names = new Set(
    Object.values(DETAIL_TRANSITION_DESCRIPTORS).flatMap(
      ({ transitionNames }) => transitionNames,
    ),
  );
  return [...names].map((name) => ({
    effect: {
      getComputedTiming: () => ({ duration: 460, endTime: 460 }),
      getKeyframes: () => [{ opacity: 1 }, { opacity: 1 }],
      pseudoElement: `::view-transition-group(${name})`,
    },
    playState: "running",
  }));
}

export function installDocumentViewTransitionHarness({
  autoFinish = false,
  onCapture,
  onUpdated,
}: Readonly<{
  autoFinish?: boolean;
  onCapture?: (capture: TestDocumentViewTransitionCapture) => void;
  onUpdated?: (transition: TestDocumentViewTransition) => void;
}> = {}) {
  const originalStartViewTransition = Object.getOwnPropertyDescriptor(
    document,
    "startViewTransition",
  );
  const originalGetAnimations = Object.getOwnPropertyDescriptor(
    document,
    "getAnimations",
  );
  const transitions: TestDocumentViewTransition[] = [];

  Object.defineProperty(document, "getAnimations", {
    configurable: true,
    value: compositorAnimations,
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: (update: ViewTransitionUpdate) => {
      let resolveCompletion = () => {};
      const completion = autoFinish
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            resolveCompletion = resolve;
          });
      const className = document.documentElement.className;
      const kind = transitionKind(className);
      onCapture?.({ className, kind });
      let transition!: TestDocumentViewTransition;
      const updateCallbackDone = Promise.resolve().then(update);
      const ready = updateCallbackDone.then(() => {
        onUpdated?.(transition);
      });
      const finished = Promise.all([ready, completion]).then(() => undefined);
      const resolve = () => resolveCompletion();
      const skipTransition = () => resolveCompletion();
      transition = Object.freeze({
        className,
        finished,
        kind,
        ready,
        resolve,
        skipTransition,
        updateCallbackDone,
      });
      transitions.push(transition);
      return {
        finished,
        ready,
        skipTransition,
        updateCallbackDone,
      };
    },
  });

  return {
    restore: () => {
      if (originalStartViewTransition) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalStartViewTransition,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
      if (originalGetAnimations) {
        Object.defineProperty(
          document,
          "getAnimations",
          originalGetAnimations,
        );
      } else {
        Reflect.deleteProperty(document, "getAnimations");
      }
    },
    transitions,
  };
}
