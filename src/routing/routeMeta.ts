export type CodaPrimaryView =
  | "library"
  | "favorites"
  | "playlists"
  | "recent"
  | "discover"
  | "daily"
  | "radio";

export type CodaScreen =
  | "collection"
  | "recent"
  | "album"
  | "artist"
  | "favorites"
  | "playlists"
  | "playlist"
  | "discover"
  | "discover-release"
  | "daily"
  | "daily-article"
  | "radio"
  | "radio-series"
  | "radio-show"
  | "now-playing";

export type CodaRouteMeta = Readonly<{
  screen: CodaScreen;
  primaryView?: CodaPrimaryView;
}>;

declare module "@tanstack/react-router" {
  interface StaticDataRouteOption {
    coda?: CodaRouteMeta;
  }
}

export function codaRouteMeta(
  screen: CodaScreen,
  primaryView?: CodaPrimaryView,
): Readonly<{ coda: CodaRouteMeta }> {
  return Object.freeze({
    coda: Object.freeze({
      screen,
      ...(primaryView === undefined ? {} : { primaryView }),
    }),
  });
}
