import { Heart, ListPlus, Radio } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { type MouseEvent, type RefObject } from "react";

import { RowActionGroup } from "@/components/ItemInteractions";
import { Button } from "@/components/ui/button";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { paletteFor } from "@/lib";
import { cn } from "@/lib/utils";
import {
  BANDCAMP_RADIO_PROVIDER,
  radioSeriesForShow,
  radioShowIdentity,
} from "@/radioIdentity";
import {
  radioSeriesId,
  radioShowId,
} from "@/features/radio/radioRouteIds";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { stringifyRadioShowIdParam } from "@/routing/routeContracts";
import type { RadioShowSummary } from "@/types";

import { FavoriteArtwork } from "./FavoriteArtwork";
import { radioShowDate } from "./savedLibraryPresentationData";

const FAVORITE_RADIO_GRID_LAYOUTS = [
  {
    minColumnWidth: 420,
    maxColumns: 2,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 88,
  },
] as const;

const favoriteRadioShowKey = (show: RadioShowSummary) => show.id;

export function FavoriteRadioShowsSection({
  shows,
  showCount,
  currentTrackId,
  playing,
  onTogglePlayback,
  radioAction,
  onActOnShow,
  onOpenRadioShow,
  onOpenRadioSeries,
  onToggleRadioFavorite,
  scrollElementRef,
}: {
  shows: RadioShowSummary[];
  showCount: number;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  radioAction?: {
    id: number;
    action: "play" | "queue";
  };
  onActOnShow: (
    show: RadioShowSummary,
    action: "play" | "queue",
  ) => void;
  onOpenRadioShow: (show: RadioShowSummary) => void;
  onOpenRadioSeries: (seriesId?: number) => void;
  onToggleRadioFavorite: (
    show: RadioShowSummary,
    favorite: boolean,
  ) => void;
  scrollElementRef: RefObject<HTMLElement | null>;
}) {
  return (
    <section className="mt-8">
      <div className="mb-4 flex items-baseline justify-between">
        <h2 className="m-0 font-display text-base leading-none font-semibold tracking-tight">
          Radio shows
        </h2>
        <span className="text-xs text-[#6f736e]">
          {countLabel(showCount, "show")}
        </span>
      </div>
      <ResponsiveVirtualGrid
        aria-label="Favorite radio shows"
        className="w-full"
        getItemKey={favoriteRadioShowKey}
        items={shows}
        layouts={FAVORITE_RADIO_GRID_LAYOUTS}
        scrollElementRef={scrollElementRef}
        renderItem={(show) => {
          const identity = radioShowIdentity(show);
          const activeShow = currentTrackId === `radio:${show.id}`;
          const busyAction =
            radioAction?.id === show.id ? radioAction.action : undefined;
          const showId = radioShowId(show.id);
          const showIdParam = showId
            ? stringifyRadioShowIdParam(showId)
            : undefined;
          const seriesId = radioSeriesId(radioSeriesForShow(show)?.id);
          const openShow = (event: MouseEvent<HTMLAnchorElement>) => {
            if (!showId) return;
            handleCodaLinkActivation(event, () => onOpenRadioShow(show));
          };
          return (
            <article
              className={cn(
                "group/row grid h-[88px] min-w-0 grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 overflow-hidden rounded-xl border border-border bg-white/[0.025] p-3 transition-[border-color,background-color] duration-(--duration-coda-fast) hover:border-white/12 hover:bg-white/4 focus-within:border-white/12 focus-within:bg-white/4 motion-reduce:transition-none",
                activeShow && "border-primary/30 bg-primary/7",
              )}
            >
              {showIdParam ? (
                <Link
                  className="size-16 overflow-hidden rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  data-radio-show-open={show.id}
                  onClick={openShow}
                  params={{ showId: showIdParam }}
                  to="/radio/shows/$showId"
                  aria-label={`Open ${identity.episodeTitle} episode`}
                >
                  <span
                    className="block size-full"
                    data-radio-show-artwork={show.id}
                  >
                    <FavoriteArtwork
                      className="size-full"
                      fallback={<Radio size={22} />}
                      item={{
                        artworkUrl: show.artworkUrl,
                        title: identity.episodeTitle,
                        palette: paletteFor(`radio:${show.id}`),
                      }}
                    />
                  </span>
                </Link>
              ) : (
                <FavoriteArtwork
                  className="size-16"
                  fallback={<Radio size={22} />}
                  item={{
                    artworkUrl: show.artworkUrl,
                    title: identity.episodeTitle,
                    palette: paletteFor(`radio:${show.id}`),
                  }}
                />
              )}
              <div className="flex min-w-0 flex-col gap-1.5">
                <span data-radio-show-title={show.id}>
                  {showIdParam ? (
                    <Link
                      className="inline-flex h-auto w-fit max-w-full justify-start overflow-hidden rounded-none p-0 text-sm font-semibold text-[#deddd7] outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      data-radio-show-open={show.id}
                      onClick={openShow}
                      params={{ showId: showIdParam }}
                      to="/radio/shows/$showId"
                      aria-label={`Open ${identity.episodeTitle} details`}
                    >
                      <OverflowMarquee
                        className="max-w-full"
                        staticTextProps={{
                          "data-coda-radio-title-text": show.id,
                        }}
                        text={identity.episodeTitle}
                      />
                    </Link>
                  ) : (
                    <OverflowMarquee
                      className="max-w-full text-sm font-semibold text-[#deddd7]"
                      text={identity.episodeTitle}
                    />
                  )}
                </span>
                <div className="flex min-w-0 items-center gap-1.5 text-xs text-coda-subtle-foreground">
                  <Link
                    activeOptions={{ exact: true }}
                    className="h-auto min-w-0 max-w-[60%] truncate rounded-none p-0 text-xs font-medium text-coda-subtle-foreground outline-none hover:bg-transparent hover:text-accent-foreground focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                    onClick={(event) =>
                      handleCodaLinkActivation(event, () =>
                        onOpenRadioSeries(seriesId),
                      )
                    }
                    aria-label={`Browse ${identity.seriesTitle ?? BANDCAMP_RADIO_PROVIDER}`}
                    {...(seriesId
                      ? {
                          params: { seriesId },
                          to: "/radio/series/$seriesId" as const,
                        }
                      : { to: "/radio" as const })}
                  >
                    {identity.seriesTitle ?? BANDCAMP_RADIO_PROVIDER}
                  </Link>
                  <span aria-hidden="true">·</span>
                  <time className="shrink-0" dateTime={show.publishedAt}>
                    {radioShowDate(show.publishedAt)}
                  </time>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  className={cn(
                    "gap-1.5",
                    activeShow && playing && "text-primary",
                  )}
                  onClick={
                    activeShow
                      ? onTogglePlayback
                      : () => onActOnShow(show, "play")
                  }
                  disabled={Boolean(radioAction)}
                  aria-label={
                    activeShow
                      ? `${playing ? "Pause" : "Resume"} ${identity.episodeTitle}`
                      : `Play ${identity.episodeTitle}`
                  }
                  aria-pressed={activeShow && playing}
                  title={
                    activeShow ? (playing ? "Pause" : "Resume") : "Play"
                  }
                  size="compact"
                  variant="ghost"
                >
                  {busyAction === "play" ? (
                    <Spinner aria-hidden="true" className="size-4 text-current" />
                  ) : (
                    <PlaybackIcon
                      className="size-4"
                      playing={activeShow && playing}
                    />
                  )}
                  <span>
                    {activeShow
                      ? playing
                        ? "Pause"
                        : "Resume"
                      : "Play"}
                  </span>
                </Button>
                <RowActionGroup>
                  <Button
                    onClick={() => onActOnShow(show, "queue")}
                    disabled={Boolean(radioAction)}
                    aria-label={`Add ${identity.episodeTitle} to queue`}
                    title="Add to queue"
                    size="icon"
                    variant="ghost"
                  >
                    {busyAction === "queue" ? (
                      <Spinner
                        aria-hidden="true"
                        className="size-4 text-current"
                      />
                    ) : (
                      <ListPlus size={15} />
                    )}
                  </Button>
                  <Button
                    className="text-coda-favorite"
                    onClick={() => onToggleRadioFavorite(show, false)}
                    aria-label={`Remove ${identity.episodeTitle} from favorites`}
                    title="Remove from favorites"
                    size="icon"
                    variant="ghost"
                  >
                    <Heart size={15} fill="currentColor" />
                  </Button>
                </RowActionGroup>
              </div>
            </article>
          );
        }}
      />
    </section>
  );
}
