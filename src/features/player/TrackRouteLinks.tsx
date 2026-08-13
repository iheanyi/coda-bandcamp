import { Link } from "@tanstack/react-router";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import type { ArtistNavigationHandler } from "@/features/library/types";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { artistKey } from "@/libraryBrowse";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
  stringifyRadioSeriesIdParam,
  stringifyRadioShowIdParam,
  validateCollectionSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import {
  trackAlbumDestination,
  trackArtistDestination,
} from "@/routing/trackRouteDestinations";
import type { Album, Track } from "@/types";

type NavigationLinkProps = Readonly<{
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  title?: string;
}>;

type TrackAlbumLinkProps = NavigationLinkProps &
  Readonly<{
    track: Track;
    disabled?: boolean;
    busy?: boolean;
    onNavigate?: (track: Track, trigger: HTMLElement) => void;
    dataPlayerAlbumLink?: boolean;
  }>;

function albumLinkActivation(
  event: MouseEvent<HTMLAnchorElement>,
  disabled: boolean,
  activate?: (trigger: HTMLAnchorElement) => void,
) {
  if (disabled) {
    event.preventDefault();
    return;
  }
  if (activate) handleCodaLinkActivation(event, activate);
}

export function TrackAlbumLink({
  track,
  disabled = false,
  busy = false,
  onNavigate,
  dataPlayerAlbumLink = false,
  children,
  className,
  ariaLabel,
  title,
}: TrackAlbumLinkProps) {
  const destination = trackAlbumDestination(track);
  if (!destination) {
    if (!onNavigate) return <>{children}</>;
    return (
      <Button
        aria-busy={busy || undefined}
        aria-label={ariaLabel}
        className={className}
        data-player-album-link={dataPlayerAlbumLink ? "" : undefined}
        disabled={disabled}
        onClick={(event) => onNavigate(track, event.currentTarget)}
        size="compact"
        title={title}
        variant="text"
      >
        {children}
      </Button>
    );
  }

  const commonProps = {
    "aria-busy": busy || undefined,
    "aria-disabled": disabled || undefined,
    "aria-label": ariaLabel,
    className,
    "data-player-album-link": dataPlayerAlbumLink ? "" : undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) =>
      albumLinkActivation(
        event,
        disabled,
        onNavigate ? (trigger) => onNavigate(track, trigger) : undefined,
      ),
    title,
  } as const;

  switch (destination.kind) {
    case "album":
      return (
        <Link
          {...commonProps}
          params={{ albumId: destination.albumId }}
          search={(previous) => validateCollectionSearch(previous)}
          to="/collection/albums/$albumId"
        >
          {children}
        </Link>
      );
    case "discover-release":
      return (
        <Link
          {...commonProps}
          params={{ releaseId: destination.releaseId }}
          search={(previous) => validateDiscoverSearch(previous)}
          to="/discover/releases/$releaseId"
        >
          {children}
        </Link>
      );
    case "radio-show":
      return (
        <Link
          {...commonProps}
          params={{ showId: stringifyRadioShowIdParam(destination.showId) }}
          to="/radio/shows/$showId"
        >
          {children}
        </Link>
      );
  }
}

type TrackArtistLinkProps = NavigationLinkProps &
  Readonly<{
    track: Track;
    onNavigate?: ArtistNavigationHandler;
    onRadioSeries?: (seriesId?: number, trigger?: HTMLAnchorElement) => void;
  }>;

export function TrackArtistLink({
  track,
  onNavigate,
  onRadioSeries,
  children,
  className,
  ariaLabel,
  title,
}: TrackArtistLinkProps) {
  const destination = trackArtistDestination(track);
  if (!destination) return <>{children}</>;

  if (
    destination.kind === "discover-external-artist" ||
    destination.kind === "daily-external-artist"
  ) {
    if (!onNavigate) return <>{children}</>;
    // Discover artist URLs cross Tauri's native HTTPS allowlist, so this stays
    // an explicitly named action instead of bypassing validation with an href.
    return (
      <Button
        aria-label={ariaLabel ?? `Open artist ${track.artist} on Bandcamp`}
        className={className}
        onClick={(event) =>
          onNavigate(track.artist, track.albumId, track, event.currentTarget)
        }
        size="compact"
        title={title ?? "Open artist on Bandcamp"}
        variant="text"
      >
        {children}
      </Button>
    );
  }

  if (destination.kind === "artist") {
    return (
      <Link
        aria-label={ariaLabel}
        className={className}
        data-artist-open={destination.artistKey}
        data-coda-artist-name-target={destination.artistKey}
        data-navigation-slot={`track-artist:${track.id}`}
        onClick={(event) => {
          if (!onNavigate) return;
          handleCodaLinkActivation(event, (trigger) =>
            onNavigate(track.artist, track.albumId, track, trigger),
          );
        }}
        params={{ artistKey: destination.artistKey }}
        search={(previous) => ({
          ...validateCollectionSearch(previous),
          genre: "All",
          mode: "artists",
          q: "",
          ...(destination.sourceAlbumId
            ? { albumId: destination.sourceAlbumId }
            : {}),
        })}
        title={title}
        to="/collection/artists/$artistKey"
      >
        <ArtistTransitionName artistKey={destination.artistKey}>
          {children}
        </ArtistTransitionName>
      </Link>
    );
  }

  if (destination.kind === "radio-series") {
    return (
      <Link
        aria-label={ariaLabel}
        className={className}
        onClick={(event) => {
          if (!onRadioSeries) return;
          handleCodaLinkActivation(event, (trigger) =>
            onRadioSeries(Number(destination.seriesId), trigger),
          );
        }}
        params={{
          seriesId: stringifyRadioSeriesIdParam(destination.seriesId),
        }}
        title={title}
        to="/radio/series/$seriesId"
      >
        {children}
      </Link>
    );
  }

  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (onRadioSeries) {
          handleCodaLinkActivation(event, (trigger) =>
            onRadioSeries(undefined, trigger),
          );
          return;
        }
        if (onNavigate) {
          handleCodaLinkActivation(event, (trigger) =>
            onNavigate(track.artist, track.albumId, track, trigger),
          );
        }
      }}
      title={title}
      to="/radio"
    >
      {children}
    </Link>
  );
}

type LibraryAlbumLinkProps = NavigationLinkProps &
  Readonly<{
    album: Album;
    onNavigate?: (album: Album, trigger: HTMLAnchorElement) => void;
  }>;

export function LibraryAlbumLink({
  album,
  onNavigate,
  children,
  className,
  ariaLabel,
  title,
}: LibraryAlbumLinkProps) {
  const albumId = parseAlbumIdParam(album.id);
  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        if (!onNavigate) return;
        handleCodaLinkActivation(event, (trigger) =>
          onNavigate(album, trigger),
        );
      }}
      params={{ albumId }}
      search={(previous) => validateCollectionSearch(previous)}
      title={title}
      to="/collection/albums/$albumId"
    >
      {children}
    </Link>
  );
}

type LibraryArtistLinkProps = NavigationLinkProps &
  Readonly<{
    artist: string;
    sourceAlbumId?: string;
    sourceTrack?: Track;
    onNavigate?: ArtistNavigationHandler;
  }>;

export function LibraryArtistLink({
  artist,
  sourceAlbumId,
  sourceTrack,
  onNavigate,
  children,
  className,
  ariaLabel,
  title,
}: LibraryArtistLinkProps) {
  const artistRouteKey = parseArtistKeyParam(artistKey(artist));
  const parsedSourceAlbumId = sourceAlbumId
    ? parseAlbumIdParam(sourceAlbumId)
    : undefined;
  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      data-artist-open={artistRouteKey}
      data-coda-artist-name-target={artistRouteKey}
      data-navigation-slot={`library-artist:${sourceTrack?.id ?? sourceAlbumId ?? artistRouteKey}`}
      onClick={(event) => {
        if (!onNavigate) return;
        handleCodaLinkActivation(event, (trigger) =>
          onNavigate(artist, sourceAlbumId, sourceTrack, trigger),
        );
      }}
      params={{ artistKey: artistRouteKey }}
      search={(previous) => ({
        ...validateCollectionSearch(previous),
        genre: "All",
        mode: "artists",
        q: "",
        ...(parsedSourceAlbumId ? { albumId: parsedSourceAlbumId } : {}),
      })}
      title={title}
      to="/collection/artists/$artistKey"
    >
      <ArtistTransitionName artistKey={artistRouteKey}>
        {children}
      </ArtistTransitionName>
    </Link>
  );
}
