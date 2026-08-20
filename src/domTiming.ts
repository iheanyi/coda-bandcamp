type AnimationFrameRequester = typeof globalThis.requestAnimationFrame;
type AnimationFrameCanceller = typeof globalThis.cancelAnimationFrame;

export function isAnimationFrameRequester(
  value: AnimationFrameRequester | undefined,
): value is AnimationFrameRequester {
  return typeof value === "function";
}

function isAnimationFrameCanceller(
  value: AnimationFrameCanceller | undefined,
): value is AnimationFrameCanceller {
  return typeof value === "function";
}

export function cancelScheduledFrame(handle: number | undefined): void {
  if (handle === undefined) return;
  const cancelFrame = globalThis.cancelAnimationFrame;
  if (isAnimationFrameCanceller(cancelFrame)) {
    cancelFrame.call(globalThis, handle);
  }
}

export function scheduleNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    const requestFrame = globalThis.requestAnimationFrame;
    if (isAnimationFrameRequester(requestFrame)) {
      requestFrame.call(globalThis, () => resolve());
      return;
    }
    queueMicrotask(resolve);
  });
}
