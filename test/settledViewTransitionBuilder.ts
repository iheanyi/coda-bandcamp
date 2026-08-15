import { vi } from "vitest";

function hasInlineStyle(
  element: Element,
): element is Element & ElementCSSInlineStyle {
  return "style" in element;
}

export function settledViewTransitionBuilder(
  update: () => void | Promise<void>,
) {
  let currentSubject: Element | string | undefined;
  let execution: Promise<{
    finished: Promise<void>;
    stop: ReturnType<typeof vi.fn>;
  }> | null = null;
  const controls = {
    finished: Promise.resolve(),
    stop: vi.fn(),
  };
  const builder = {
    add: vi.fn((subject: Element | string) => {
      currentSubject = subject;
      return builder;
    }),
    class: vi.fn((transitionClass: string) => {
      const elements =
        typeof currentSubject === "string"
          ? document.querySelectorAll<HTMLElement>(currentSubject)
          : currentSubject
            ? [currentSubject]
            : [];
      elements.forEach((element) => {
        if (hasInlineStyle(element)) {
          element.style.setProperty("view-transition-class", transitionClass);
        }
      });
      return builder;
    }),
    crop: vi.fn(),
    enter: vi.fn(),
    exit: vi.fn(),
    group: vi.fn(),
    layout: vi.fn(),
    new: vi.fn(),
    old: vi.fn(),
    then: vi.fn(),
  };
  for (const method of [
    "crop",
    "enter",
    "exit",
    "group",
    "layout",
    "new",
    "old",
  ] as const) {
    builder[method].mockReturnValue(builder);
  }
  builder.then.mockImplementation((resolve, reject) => {
    execution ??= Promise.resolve().then(async () => {
      const transition = document.startViewTransition?.(update);
      if (transition) {
        await transition.updateCallbackDone;
      } else {
        await update();
      }
      return controls;
    });
    return execution.then(resolve, reject);
  });
  return builder;
}
