import { Heart } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { libraryArtistRouteSearch } from "@/features/library/libraryLinkSearch";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { cn } from "@/lib/utils";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { validateCollectionSearch } from "@/routing/routeContracts";
import type { Album, Track } from "@/types";

import { FavoriteArtwork } from "./FavoriteArtwork";
import {
  albumRouteId,
  artistRouteKey,
  metadataLinkClassName,
} from "./savedLibraryPresentationData";
import { SavedSectionHeader } from "./SavedLibraryPresentation";

const FAVORITE_ALBUM_GRID_LAYOUTS = [
  {
    minColumnWidth: 240,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 64,
  },
] as const;

const favoriteAlbumKey = (album: Album) => album.id;

export function FavoriteAlbumsSection({
  albums,
  albumCount,
  loadingAlbumId,
  onOpenAlbum,
  onOpenArtist,
  onToggleFavorite,
  scrollElementRef,
}: {
  albums: Album[];
  albumCount: number;
  loadingAlbumId?: string;
  onOpenAlbum: (album: Album, trigger: HTMLElement) => void;
  onOpenArtist: (
    artist: string,
    albumId?: string,
    sourceTrack?: Track,
    sourceTrigger?: HTMLElement,
  ) => void;
  onToggleFavorite: (
    id: string,
    kind: "song" | "album",
    favorite: boolean,
  ) => void;
  scrollElementRef: RefObject<HTMLElement | null>;
}) {
  return (
    <section className="mt-8">
      <SavedSectionHeader
        title="Releases"
        count={countLabel(albumCount, "release")}
      />
      <ResponsiveVirtualGrid
        aria-label="Favorite releases"
        className="w-full"
        getItemKey={favoriteAlbumKey}
        items={albums}
        layouts={FAVORITE_ALBUM_GRID_LAYOUTS}
        scrollElementRef={scrollElementRef}
        renderItem={(album) => {
          const albumLoading = loadingAlbumId === album.id;
          const albumId = albumRouteId(album.id);
          const albumArtistKey = artistRouteKey(album.artist);
          return (
            <article
              className="grid h-full grid-cols-[minmax(0,1fr)_2rem] items-center gap-1 rounded-lg border border-border bg-white/2 p-2"
              data-album-card={album.id}
            >
              <div className="grid min-w-0 grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                {albumId ? (
                  <Link
                    aria-busy={albumLoading || undefined}
                    aria-disabled={albumLoading || undefined}
                    aria-label={`Open ${album.title}`}
                    className="relative grid size-12 place-items-center overflow-hidden rounded-md p-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-100"
                    data-album-open={album.id}
                    data-navigation-slot="artwork"
                    onClick={(event) => {
                      if (albumLoading) {
                        event.preventDefault();
                        return;
                      }
                      handleCodaLinkActivation(event, (trigger) =>
                        onOpenAlbum(album, trigger),
                      );
                    }}
                    params={{ albumId }}
                    search={(previous) => validateCollectionSearch(previous)}
                    to="/collection/albums/$albumId"
                  >
                    <FavoriteArtwork
                      className={cn(
                        "size-full",
                        albumLoading && "opacity-40",
                      )}
                      item={album}
                    />
                    {albumLoading ? (
                      <Spinner
                        aria-label={`Loading ${album.title} artwork`}
                        className="absolute size-4 text-current"
                      />
                    ) : null}
                  </Link>
                ) : (
                  <FavoriteArtwork className="size-12" item={album} />
                )}
                <span className="flex min-w-0 flex-col">
                  {albumId ? (
                    <Link
                      aria-busy={albumLoading || undefined}
                      aria-disabled={albumLoading || undefined}
                      aria-label={albumLoading ? album.title : undefined}
                      className="inline-flex h-auto w-fit max-w-full items-center justify-start gap-1 overflow-hidden rounded-none p-0 text-xs text-[#d8d7d1] outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring aria-disabled:cursor-default aria-disabled:opacity-100"
                      data-album-open={album.id}
                      data-coda-album-title-target={album.id}
                      data-navigation-slot="title"
                      onClick={(event) => {
                        if (albumLoading) {
                          event.preventDefault();
                          return;
                        }
                        handleCodaLinkActivation(event, (trigger) =>
                          onOpenAlbum(album, trigger),
                        );
                      }}
                      params={{ albumId }}
                      search={(previous) => validateCollectionSearch(previous)}
                      to="/collection/albums/$albumId"
                    >
                      {albumLoading ? (
                        <Spinner
                          aria-label={`Loading ${album.title} release`}
                          className="size-3 text-current"
                        />
                      ) : null}
                      <OverflowMarquee
                        className="max-w-full"
                        text={album.title}
                      />
                    </Link>
                  ) : (
                    <OverflowMarquee
                      className="max-w-full text-xs text-[#d8d7d1]"
                      text={album.title}
                    />
                  )}
                  {albumArtistKey ? (
                    <Link
                      className={cn(metadataLinkClassName, "mt-1 max-w-full")}
                      data-artist-open={albumArtistKey}
                      data-coda-artist-name-target={albumArtistKey}
                      data-navigation-slot={`favorite-album-artist:${album.id}`}
                      onClick={(event) =>
                        handleCodaLinkActivation(event, (trigger) =>
                          onOpenArtist(
                            album.artist,
                            albumId,
                            undefined,
                            trigger,
                          ),
                        )
                      }
                      params={{ artistKey: albumArtistKey }}
                      search={(previous) =>
                        libraryArtistRouteSearch(previous, albumId)
                      }
                      to="/collection/artists/$artistKey"
                    >
                      <ArtistTransitionName artistKey={albumArtistKey}>
                        {album.artist}
                      </ArtistTransitionName>
                    </Link>
                  ) : (
                    <span className="mt-1 truncate text-xs text-coda-subtle-foreground">
                      {album.artist}
                    </span>
                  )}
                </span>
              </div>
              <Button
                className="text-coda-favorite"
                onClick={() =>
                  onToggleFavorite(album.id, "album", false)
                }
                aria-label={`Remove ${album.title} from favorites`}
                size="icon"
                variant="ghost"
              >
                <Heart size={15} fill="currentColor" />
              </Button>
            </article>
          );
        }}
      />
    </section>
  );
}
