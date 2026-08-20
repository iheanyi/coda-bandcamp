import type { Album } from "@/types";
import type { ArtistGroup, LibraryBrowseMode } from "@/libraryBrowse";
import type { LibraryRouteInput } from "@/routing/libraryRouteInput";

export type BrowseScopeInput = Readonly<{
  activeArtist?: ArtistGroup;
  effectiveBrowseMode: LibraryBrowseMode;
  genre: string;
  query: string;
  recent: boolean;
  selectedAlbum?: Album;
}>;

export type BrowseScopeDescriptor = Readonly<{
  name: string;
  shuffleLabel: string;
}>;

export type LibrarySurpriseScope = Readonly<{
  albums: readonly Album[];
  artist?: ArtistGroup;
  name: string;
  shuffleLabel: string;
}>;

export function deriveBrowseScopeDescriptor({
  activeArtist,
  effectiveBrowseMode,
  genre,
  query,
  recent,
  selectedAlbum,
}: BrowseScopeInput): BrowseScopeDescriptor {
  if (selectedAlbum) {
    return { name: selectedAlbum.title, shuffleLabel: "Shuffle album" };
  }
  if (activeArtist) {
    return { name: activeArtist.name, shuffleLabel: "Shuffle artist" };
  }
  if (query.trim()) {
    return { name: "the current results", shuffleLabel: "Shuffle results" };
  }
  if (genre !== "All") {
    return { name: genre, shuffleLabel: "Shuffle genre" };
  }
  if (recent) {
    return { name: "recent additions", shuffleLabel: "Shuffle recent" };
  }
  switch (effectiveBrowseMode) {
    case "singles":
      return { name: "the singles view", shuffleLabel: "Shuffle singles" };
    case "albums":
      return { name: "the albums view", shuffleLabel: "Shuffle albums" };
    case "artists":
      return { name: "the visible artists", shuffleLabel: "Shuffle artists" };
    case "releases":
      return { name: "the collection", shuffleLabel: "Shuffle collection" };
    default: {
      const _exhaustive: never = effectiveBrowseMode;
      return _exhaustive;
    }
  }
}

export function deriveSurpriseScope({
  routeKind,
  visibleAlbums,
  ...descriptor
}: BrowseScopeInput & {
  routeKind: LibraryRouteInput["kind"];
  visibleAlbums: readonly Album[];
}): LibrarySurpriseScope {
  const scopeAlbums =
    routeKind === "album"
      ? descriptor.selectedAlbum
        ? [descriptor.selectedAlbum]
        : []
      : routeKind === "artist"
        ? (descriptor.activeArtist?.albums ?? [])
        : visibleAlbums;
  const artist =
    routeKind === "artist" ? descriptor.activeArtist : undefined;
  const scope = deriveBrowseScopeDescriptor(descriptor);
  return {
    albums: scopeAlbums,
    artist,
    name: scope.name,
    shuffleLabel: scope.shuffleLabel,
  };
}

export function browseModeReleaseTitle(mode: LibraryBrowseMode): string {
  switch (mode) {
    case "singles":
      return "Singles";
    case "albums":
      return "Albums & EPs";
    case "artists":
    case "releases":
      return "All releases";
    default: {
      const _exhaustive: never = mode;
      return _exhaustive;
    }
  }
}

export function deriveReleaseResultsTitle({
  activeArtist,
  genre,
  mode,
}: {
  activeArtist?: ArtistGroup;
  genre: string;
  mode: LibraryBrowseMode;
}): string {
  if (activeArtist) return "Releases";
  const title = browseModeReleaseTitle(mode);
  return genre === "All" ? title : `${title} · ${genre}`;
}

export function hasActiveBrowseFilters({
  query,
  genre,
  mode,
  selectedArtist,
}: {
  query: string;
  genre: string;
  mode: LibraryBrowseMode;
  selectedArtist?: string;
}): boolean {
  return (
    Boolean(query.trim()) ||
    genre !== "All" ||
    mode !== "releases" ||
    Boolean(selectedArtist)
  );
}
