export function parseVerifiedBandcampPageUrl(
  value: string,
): URL | undefined {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      (host !== "bandcamp.com" && !host.endsWith(".bandcamp.com"))
    ) {
      return undefined;
    }
    return url;
  } catch {
    return undefined;
  }
}

export function bandcampArtistOrigin(value: string): string | undefined {
  const url = parseVerifiedBandcampPageUrl(value);
  if (!url) return undefined;
  if (url.hostname.toLowerCase() === "bandcamp.com") return undefined;
  return `${url.origin}/`;
}
