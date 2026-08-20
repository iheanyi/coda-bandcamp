/** User-visible copy for a thrown value. `Error.message` keeps subclass names out of toasts. */
export function formatErrorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
