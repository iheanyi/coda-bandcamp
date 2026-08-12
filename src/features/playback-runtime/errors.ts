const MAX_PLAYBACK_ERROR_DETAIL_LENGTH = 180;

const AUTHORIZATION_PATTERN = /\b(?:Bearer|Basic)\s+[^\s,;]+/giu;
const SENSITIVE_VALUE_PATTERN =
  /\b(password|passwd|token|secret|signature|authorization|credential|session(?:[_-]?key)?|api[_-]?key)\s*[:=]\s*([^\s,;]+)/giu;
const URL_PATTERN = /\b(?:https?|file):\/\/[^\s"'<>]+/giu;
const UNIX_PATH_PATTERN =
  /(^|\s)\/(?:Users|home|private|tmp|var|opt|etc)\/[^\s,;]+/gu;
const WINDOWS_PATH_PATTERN = /\b[A-Za-z]:\\[^\s,;]+/gu;

/** Keeps diagnostics useful without surfacing URLs, credentials, or paths. */
export function safePlaybackErrorDetail(cause: unknown): string {
  const raw = cause instanceof Error ? cause.message : String(cause ?? "");
  const sanitized = raw
    .replace(/^Error:\s*/iu, "")
    .replace(/[\u0000-\u001f\u007f-\u009f]+/gu, " ")
    .replace(AUTHORIZATION_PATTERN, "[redacted authorization]")
    .replace(URL_PATTERN, "[redacted URL]")
    .replace(SENSITIVE_VALUE_PATTERN, "$1=[redacted]")
    .replace(UNIX_PATH_PATTERN, "$1[redacted path]")
    .replace(WINDOWS_PATH_PATTERN, "[redacted path]")
    .replace(/\s+/gu, " ")
    .trim();
  const detail = sanitized || "Unexpected playback failure";
  if (detail.length <= MAX_PLAYBACK_ERROR_DETAIL_LENGTH) return detail;
  return `${detail.slice(0, MAX_PLAYBACK_ERROR_DETAIL_LENGTH - 1)}…`;
}
