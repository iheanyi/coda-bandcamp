import { HardDrive, Heart } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";

import { RetryButton } from "@/components/ui/retry-button";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { formatErrorMessage } from "@/formatError";
import { radioShowQueryOptions } from "@/queries/radioQueries";
import { radioTrackFromShow } from "@/radioTrack";
import type { RadioShowSummary } from "@/types";

import { FavoriteAlbumsSection } from "./FavoriteAlbumsSection";
import { FavoriteRadioShowsSection } from "./FavoriteRadioShowsSection";
import { FavoriteTracksSection } from "./FavoriteTracksSection";
import { savedPageClassName } from "./savedLibraryPresentationData";
import {
  Eyebrow,
  SavedEmpty,
} from "./SavedLibraryPresentation";
import { useSavedLibraryRuntime } from "./SavedLibraryRuntimeContext";

export function FavoritesScreen() {
  const {
    favorites,
    favoritesLoading,
    favoritesError,
    favoritesLocal = false,
    loadingAlbumId,
    onRefreshFavorites,
    onToggleFavorite,
    onToggleRadioFavorite,
    currentTrackId,
    playing,
    onTogglePlayback,
    onPlayTracks,
    onQueueTracks,
    onPlayTrack,
    onQueueTrack,
    onOpenAlbum,
    onOpenTrackAlbum,
    onOpenArtist,
    onOpenRadioShow,
    onOpenRadioSeries,
    onAddToPlaylist,
    onNotify,
  } = useSavedLibraryRuntime();
  const queryClient = useQueryClient();
  const favoriteScrollElementRef = useRef<HTMLElement | null>(null);
  const setFavoritePageRoot = useCallback((element: HTMLElement | null) => {
    favoriteScrollElementRef.current =
      element?.closest<HTMLElement>("[data-coda-library-scroll]") ??
      element?.parentElement ??
      null;
  }, []);
  const [radioAction, setRadioAction] = useState<{
    id: number;
    action: "play" | "queue";
  }>();
  const actOnFavoriteRadioShow = async (
    show: RadioShowSummary,
    action: "play" | "queue",
  ) => {
    if (radioAction) return;
    setRadioAction({ id: show.id, action });
    try {
      const details = await queryClient.fetchQuery(
        radioShowQueryOptions(show.id),
      );
      const track = radioTrackFromShow(details);
      if (action === "play") onPlayTrack(track);
      else onQueueTrack(track);
    } catch (cause) {
      onNotify(formatErrorMessage(cause), "bad");
    } finally {
      setRadioAction(undefined);
    }
  };
  const favoriteTracks = favorites?.tracks ?? [];
  const favoriteAlbums = favorites?.albums ?? [];
  const favoriteRadioShows = favorites?.radioShows ?? [];
  const favoriteTrackCount = favorites?.songIds.length ?? favoriteTracks.length;
  const favoriteAlbumCount =
    favorites?.albumIds.length ?? favoriteAlbums.length;
  const favoriteRadioShowCount =
    favorites?.radioShowIds?.length ?? favoriteRadioShows.length;
  const favoriteDisplayMetadataCount =
    favoriteTrackCount + favoriteAlbumCount + favoriteRadioShowCount;

  return (
    <section className={savedPageClassName} ref={setFavoritePageRoot}>
      <header className="mb-8 flex items-start justify-between gap-6">
        <div className="flex min-w-0 flex-col gap-2.5">
          <Eyebrow className="mb-0 inline-flex items-center gap-1.5">
            {favoritesLocal ? (
              <>
                <HardDrive size={12} /> On this device
              </>
            ) : (
              "Bandcamp Subsonic + this device"
            )}
          </Eyebrow>
          <div className="flex flex-col gap-2">
            <h1 className="m-0 font-display text-4xl leading-none font-semibold tracking-tighter text-foreground">
              Favorites
            </h1>
            <p className="m-0 max-w-xl text-xs text-muted-foreground">
              {favoritesLocal
                ? "Your personal shortlist, saved only in Coda on this computer."
                : "Music favorites sync through Bandcamp’s Subsonic service, separate from the Bandcamp website. Track listings can lag, so Coda confirms them as albums load and on Refresh. Radio shows stay on this device."}
            </p>
          </div>
        </div>
        {!favoritesLocal ? (
          <RetryButton
            busy={favoritesLoading}
            busyLabel="Refreshing…"
            iconSize={15}
            label="Refresh"
            onClick={onRefreshFavorites}
            variant="artwork"
          />
        ) : null}
      </header>
      {favoritesLoading ? (
        <SavedEmpty
          icon={<Spinner aria-hidden="true" className="size-7 text-current" />}
          title="Loading favorites"
          detail="Syncing your favorites from Bandcamp…"
        />
      ) : favoritesError ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="Favorites couldn’t load"
          detail={favoritesError}
          action={
            <RetryButton
              busy={favoritesLoading}
              busyLabel="Trying again…"
              label="Try again"
              onClick={onRefreshFavorites}
            />
          }
        />
      ) : !favoriteAlbumCount &&
        !favoriteTrackCount &&
        !favoriteRadioShowCount ? (
        <SavedEmpty
          icon={<Heart size={28} />}
          title="No favorites yet"
          detail={
            favoritesLocal
              ? "Use the heart on any release, track, or Radio show. Favorites stay on this device."
              : "Heart an album or track to save it to Bandcamp Subsonic Favorites. They stay separate from the Bandcamp website; Radio shows stay on this device."
          }
        />
      ) : (
        <>
          {!favoriteTracks.length &&
          !favoriteAlbums.length &&
          !favoriteRadioShows.length ? (
            <SavedEmpty
              icon={<Heart size={28} />}
              title="Your stars are saved"
              detail={
                favoritesLocal
                  ? `${countLabel(favoriteDisplayMetadataCount, "local favorite")} ${favoriteDisplayMetadataCount === 1 ? "is" : "are"} waiting for display metadata. Coda will repair ${favoriteDisplayMetadataCount === 1 ? "it" : "them"} when the item is loaded.`
                  : `Bandcamp returned ${countLabel(favoriteTrackCount + favoriteAlbumCount, "favorite ID")} without display metadata. Refresh after your collection finishes syncing.`
              }
              action={
                favoritesLocal ? undefined : (
                  <RetryButton
                    busy={favoritesLoading}
                    busyLabel="Refreshing…"
                    label="Refresh metadata"
                    onClick={onRefreshFavorites}
                  />
                )
              }
            />
          ) : null}
          {favoriteTracks.length ? (
            <FavoriteTracksSection
              tracks={favoriteTracks}
              trackCount={favoriteTrackCount}
              currentTrackId={currentTrackId}
              playing={playing}
              loadingAlbumId={loadingAlbumId}
              onTogglePlayback={onTogglePlayback}
              onPlayTracks={onPlayTracks}
              onQueueTracks={onQueueTracks}
              onPlayTrack={onPlayTrack}
              onQueueTrack={onQueueTrack}
              onAddToPlaylist={onAddToPlaylist}
              onToggleFavorite={onToggleFavorite}
              onOpenTrackAlbum={onOpenTrackAlbum}
              onOpenArtist={onOpenArtist}
            />
          ) : null}
          {favoriteRadioShows.length ? (
            <FavoriteRadioShowsSection
              shows={favoriteRadioShows}
              showCount={favoriteRadioShowCount}
              currentTrackId={currentTrackId}
              playing={playing}
              onTogglePlayback={onTogglePlayback}
              radioAction={radioAction}
              onActOnShow={(show, action) => {
                void actOnFavoriteRadioShow(show, action);
              }}
              onOpenRadioShow={onOpenRadioShow}
              onOpenRadioSeries={onOpenRadioSeries}
              onToggleRadioFavorite={onToggleRadioFavorite}
              scrollElementRef={favoriteScrollElementRef}
            />
          ) : null}
          {favoriteAlbums.length ? (
            <FavoriteAlbumsSection
              albums={favoriteAlbums}
              albumCount={favoriteAlbumCount}
              loadingAlbumId={loadingAlbumId}
              onOpenAlbum={onOpenAlbum}
              onOpenArtist={onOpenArtist}
              onToggleFavorite={onToggleFavorite}
              scrollElementRef={favoriteScrollElementRef}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
