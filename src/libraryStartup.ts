export const LIBRARY_STARTUP_STEP_TIMEOUT_MS = 15_000;

export function awaitLibraryStartupStep<Value>(
  operation: Promise<Value>,
  timeoutMessage: string,
  timeoutMs = LIBRARY_STARTUP_STEP_TIMEOUT_MS,
): Promise<Value> {
  return new Promise((resolve, reject) => {
    const timeoutId = globalThis.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    operation.then(
      (value) => {
        globalThis.clearTimeout(timeoutId);
        resolve(value);
      },
      (cause) => {
        globalThis.clearTimeout(timeoutId);
        reject(cause);
      },
    );
  });
}
