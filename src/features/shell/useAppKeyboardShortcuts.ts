import { useEffect, type RefObject } from "react";

export type AppKeyboardShortcutsOptions = Readonly<{
  onNext: () => void;
  onPrevious: () => void;
  onTogglePlayback: () => void;
  onToggleMotionLab?: () => void;
  searchRef: RefObject<HTMLInputElement | null>;
}>;

function editableTarget(target: HTMLElement): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
}

/** Owns Coda's route-independent keyboard listener and its cleanup. */
export function useAppKeyboardShortcuts({
  onNext,
  onPrevious,
  onTogglePlayback,
  onToggleMotionLab,
  searchRef,
}: AppKeyboardShortcutsOptions): void {
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (
        !event.repeat &&
        event.metaKey &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        event.key.toLowerCase() === "d"
      ) {
        event.preventDefault();
        onToggleMotionLab?.();
        return;
      }
      const target = event.target instanceof HTMLElement ? event.target : null;
      const interactiveTarget = target?.closest(
        "button, input, textarea, select, a, [contenteditable='true'], [role='slider']",
      );
      if (interactiveTarget) {
        if (event.key === "Escape" && target && editableTarget(target)) {
          target.blur();
        }
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        onTogglePlayback();
      }
      if (
        event.key === "/" ||
        (event.ctrlKey && event.key.toLowerCase() === "k")
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.altKey && event.key === "ArrowRight") onNext();
      if (event.altKey && event.key === "ArrowLeft") onPrevious();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [onNext, onPrevious, onToggleMotionLab, onTogglePlayback, searchRef]);
}
