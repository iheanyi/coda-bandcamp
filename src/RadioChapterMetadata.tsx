import { ExternalLink } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArtistTransitionName } from "@/features/navigation/ArtistTransitionName";
import { cn } from "@/lib/utils";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  type AlbumId,
  type ArtistKey,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import type { RadioChapter } from "@/types";

export type RadioChapterAlbumLocalLink = Readonly<{
  albumId: AlbumId;
  onNavigate?: (trigger: HTMLAnchorElement) => void;
}>;

export type RadioChapterArtistLocalLink = Readonly<{
  artistKey: ArtistKey;
  sourceAlbumId?: AlbumId;
  onNavigate?: (trigger: HTMLAnchorElement) => void;
}>;

export type RadioChapterLocalLinks = {
  track?: RadioChapterAlbumLocalLink;
  artist?: RadioChapterArtistLocalLink;
  album?: RadioChapterAlbumLocalLink;
};

export const RadioChapterArtwork = memo(function RadioChapterArtwork({
  chapter,
  index,
  active = false,
}: {
  chapter: RadioChapter;
  index: number;
  active?: boolean;
}) {
  const number = String(index + 1).padStart(2, "0");
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string>();
  const artworkFailed = failedArtworkUrl === chapter.artworkUrl;
  return (
    <span
      className={cn(
        "relative grid size-10 shrink-0 place-items-center justify-self-center overflow-hidden rounded-md border border-white/7 bg-[#232628] text-xs text-[#858984] tabular-nums",
        active && "border-primary/42 shadow-[0_0_0_1px_rgba(221,101,73,0.08)]",
      )}
      aria-hidden="true"
    >
      <span>{number}</span>
      {chapter.artworkUrl ? (
        <img
          key={chapter.artworkUrl}
          className="absolute inset-0 size-full object-cover"
          src={chapter.artworkUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          hidden={artworkFailed}
          onError={() => setFailedArtworkUrl(chapter.artworkUrl)}
          onLoad={() =>
            setFailedArtworkUrl((current) =>
              current === chapter.artworkUrl ? undefined : current,
            )
          }
        />
      ) : null}
    </span>
  );
});

export const RadioChapterCopy = memo(function RadioChapterCopy({
  chapter,
  className,
  onOpen,
  localLinks,
}: {
  chapter: RadioChapter;
  className: string;
  onOpen: (url: string) => void;
  localLinks?: RadioChapterLocalLinks;
}) {
  const trackUrl = chapter.itemUrl;
  const artistUrl = chapter.artistUrl;
  const albumUrl = chapter.albumUrl;
  // External chapter destinations must cross Tauri's validated native opener
  // boundary, so those remain explicitly named button actions.

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {localLinks?.track ? (
        <Link
          aria-label={`Find ${chapter.title} by ${chapter.artist} in Coda`}
          className="h-auto w-fit max-w-full justify-start gap-1.5 overflow-hidden p-0 text-left text-xs/tight font-semibold text-[#deddd7] hover:bg-transparent hover:text-[#ee927b]"
          onClick={(event) => {
            if (!localLinks.track?.onNavigate) return;
            handleCodaLinkActivation(event, localLinks.track.onNavigate);
          }}
          params={{ albumId: localLinks.track.albumId }}
          search={(previous) => validateCollectionSearch(previous)}
          title="Open its release in Coda"
          to="/collection/albums/$albumId"
        >
          <span className="truncate">{chapter.title}</span>
        </Link>
      ) : trackUrl ? (
        <Button
          variant="text"
          size="compact"
          className="h-auto w-fit max-w-full justify-start gap-1.5 overflow-hidden p-0 text-left text-xs/tight font-semibold text-[#deddd7] hover:bg-transparent hover:text-[#ee927b]"
          onClick={() => onOpen(trackUrl)}
          aria-label={`Open ${chapter.title} by ${chapter.artist} on Bandcamp`}
          title="Not in your library — open track on Bandcamp"
        >
          <span className="truncate">{chapter.title}</span>
          <ExternalLink
            className="size-3 shrink-0 text-coda-subtle-foreground"
            aria-hidden="true"
          />
        </Button>
      ) : (
        <strong className="w-fit max-w-full truncate text-xs/tight font-semibold text-[#d8d7d1]">
          {chapter.title}
        </strong>
      )}
      <span className="flex min-w-0 items-baseline gap-1 overflow-hidden text-xs text-[#7d817c]">
        <span className="shrink-0">by</span>
        {localLinks?.artist ? (
          <Link
            aria-label={`Open artist ${chapter.artist} in Coda`}
            className="h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#dadbd5]"
            data-artist-open={localLinks.artist.artistKey}
            data-coda-artist-name-target={localLinks.artist.artistKey}
            data-navigation-slot={`radio-chapter-artist:${localLinks.artist.sourceAlbumId ?? localLinks.artist.artistKey}`}
            onClick={(event) => {
              if (!localLinks.artist?.onNavigate) return;
              handleCodaLinkActivation(event, localLinks.artist.onNavigate);
            }}
            params={{ artistKey: localLinks.artist.artistKey }}
            search={(previous) => ({
              ...validateCollectionSearch(previous),
              genre: "All",
              mode: "artists",
              q: "",
              ...(localLinks.artist?.sourceAlbumId
                ? { albumId: localLinks.artist.sourceAlbumId }
                : {}),
            })}
            title="Open artist in Coda"
            to="/collection/artists/$artistKey"
          >
            <ArtistTransitionName artistKey={localLinks.artist.artistKey}>
              {chapter.artist}
            </ArtistTransitionName>
          </Link>
        ) : artistUrl ? (
          <Button
            variant="text"
            size="compact"
            className="h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#e58b74]"
            onClick={() => onOpen(artistUrl)}
            aria-label={`Open artist ${chapter.artist} on Bandcamp`}
            title="Not in your library — open artist on Bandcamp"
          >
            {chapter.artist}
            <span className="ml-0.5 text-[#686d68]" aria-hidden="true">
              ↗
            </span>
          </Button>
        ) : (
          <span className="max-w-2/5 shrink-0 truncate">{chapter.artist}</span>
        )}
        {chapter.album ? (
          <>
            <span className="shrink-0" aria-hidden="true">
              ·
            </span>
            <span className="shrink-0">from</span>
            {localLinks?.album ? (
              <Link
                aria-label={`Open album ${chapter.album} in Coda`}
                className="h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#dadbd5]"
                onClick={(event) => {
                  if (!localLinks.album?.onNavigate) return;
                  handleCodaLinkActivation(event, localLinks.album.onNavigate);
                }}
                params={{ albumId: localLinks.album.albumId }}
                search={(previous) => validateCollectionSearch(previous)}
                title="Open album in Coda"
                to="/collection/albums/$albumId"
              >
                {chapter.album}
              </Link>
            ) : albumUrl ? (
              <Button
                variant="text"
                size="compact"
                className="h-auto max-w-2/5 shrink-0 truncate p-0 text-xs font-semibold text-[#999c96] hover:bg-transparent hover:text-[#e58b74]"
                onClick={() => onOpen(albumUrl)}
                aria-label={`Open album ${chapter.album} on Bandcamp`}
                title="Not in your library — open album on Bandcamp"
              >
                {chapter.album}
                <span className="ml-0.5 text-[#686d68]" aria-hidden="true">
                  ↗
                </span>
              </Button>
            ) : (
              <span className="max-w-2/5 shrink-0 truncate">
                {chapter.album}
              </span>
            )}
          </>
        ) : null}
      </span>
    </div>
  );
});
