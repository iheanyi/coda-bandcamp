import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpenText,
  ListPlus,
  MapPin,
  Music2,
  Plus,
  RefreshCw,
} from "lucide-react";
import { memo, useLayoutEffect, useMemo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CardActionOverlay,
  RowActionGroup,
  RowPlaybackAction,
} from "@/components/ItemInteractions";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { ScrollableLinkSelectionRail } from "@/components/ScrollableLinkSelectionRail";
import { countLabel } from "@/countLabel";
import {
  DAILY_CATEGORY_GROUPS,
  dailyArticlesNewestFirst,
  dailyCategoryLabel,
  dailyTracksFromEmbed,
  formatDailyDate,
} from "@/daily";
import { CoverArt } from "@/features/artwork/CoverArt";
import { useDailyRouteNavigation } from "@/features/daily/DailyRouteNavigationState";
import { formatTime, openBandcampUrl, paletteFor } from "@/lib";
import { cn } from "@/lib/utils";
import { dailyArticlesInfiniteQueryOptions } from "@/queries/dailyQueries";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import type {
  DailyArticle,
  DailyArticleSummary,
  DailyCategory,
  Track,
} from "@/types";

export type DailyPlaybackProps = Readonly<{
  currentTrackId?: string;
  playing: boolean;
  onPlayTracks: (tracks: Track[]) => void;
  onQueueTracks: (tracks: Track[]) => void;
  onTogglePlayback: () => void;
}>;

function DailyCategoryNav({ category }: { category: DailyCategory }) {
  const selectedGroup =
    DAILY_CATEGORY_GROUPS.find((group) =>
      group.items.some((item) => item.value === category),
    ) ?? DAILY_CATEGORY_GROUPS[1];
  const groupItems = DAILY_CATEGORY_GROUPS.map((group) => ({
    label: group.label,
    value: group.id,
  }));

  return (
    <div className="mt-5 grid gap-2.5">
      <ScrollableLinkSelectionRail
        aria-label="Bandcamp Daily archive groups"
        indicatorClassName="border-primary/20 bg-primary/18"
        items={groupItems}
        layoutGroupId="coda-daily-group-navigation"
        linkClassName="uppercase tracking-[0.08em]"
        navClassName="w-fit rounded-lg bg-black/15 p-1"
        renderLink={(item, state) => {
          const group = DAILY_CATEGORY_GROUPS.find(
            (candidate) => candidate.id === item.value,
          );
          if (!group) return null;
          return (
            <Link
              activeOptions={{ exact: true }}
              aria-current={state.selected ? "page" : undefined}
              className={state.className}
              key={item.value}
              preload="intent"
              ref={state.ref}
              search={{
                articleSection: undefined,
                category: group.items[0].value,
              }}
              to="/daily"
            >
              {state.children}
            </Link>
          );
        }}
        value={selectedGroup.id}
      />
      <ScrollableLinkSelectionRail
        aria-label={`Bandcamp Daily ${selectedGroup.label.toLocaleLowerCase()}`}
        indicatorClassName="border-primary/15 bg-primary/12"
        items={selectedGroup.items}
        layoutGroupId="coda-daily-destination-navigation"
        navClassName="rounded-lg border border-border bg-black/10 p-1"
        navDataAttributes={{
          "data-daily-category-group": selectedGroup.id,
        }}
        nextLabel={`Show more ${selectedGroup.label.toLocaleLowerCase()}`}
        previousLabel={`Show previous ${selectedGroup.label.toLocaleLowerCase()}`}
        renderLink={(item, state) => (
          <Link
            activeOptions={{ exact: true }}
            aria-current={state.selected ? "page" : undefined}
            className={state.className}
            key={item.value}
            preload="intent"
            ref={state.ref}
            search={{
              articleSection: undefined,
              category: item.value,
            }}
            to="/daily"
          >
            {state.children}
          </Link>
        )}
        value={category}
      />
    </div>
  );
}

const DailyArticleCard = memo(function DailyArticleCard({
  article,
  category,
}: {
  article: DailyArticleSummary;
  category: DailyCategory;
}) {
  const navigation = useDailyRouteNavigation();
  const published = formatDailyDate(article.publishedAt);
  return (
    <article className="group/card min-w-0 [contain-intrinsic-size:144px_224px] [content-visibility:auto]">
      <Link
        aria-label={`Open ${article.title}`}
        className="flex min-w-0 flex-col gap-2 rounded-md text-left text-inherit outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        data-daily-article-open={article.slug}
        onClick={(event) =>
          handleCodaLinkActivation(event, (sourceTrigger) => {
            const scrollRoot = sourceTrigger.closest<HTMLElement>(
              "[data-coda-library-scroll]",
            );
            void navigation.openArticle({
              articleSection: article.articleSection,
              category,
              returnScrollTop: scrollRoot?.scrollTop ?? 0,
              slug: article.slug,
              sourceArtwork: article.artworkUrl
                ? (sourceTrigger.querySelector<HTMLElement>(
                    "[data-daily-article-artwork]",
                  ) ?? undefined)
                : undefined,
              sourceTitle:
                sourceTrigger.querySelector<HTMLElement>(
                  "[data-daily-article-title]",
                ) ?? undefined,
              sourceTrigger,
            });
          })
        }
        params={{ slug: article.slug }}
        search={{ articleSection: article.articleSection, category }}
        to="/daily/$slug"
      >
        <div
          className="relative aspect-square w-full overflow-hidden rounded-md bg-muted shadow-[0_10px_24px_rgba(0,0,0,0.24)] outline-1 -outline-offset-1 outline-white/10"
          data-daily-article-artwork={article.slug}
        >
          {article.artworkUrl ? (
            <img
              alt=""
              className="size-full object-cover transition-transform duration-(--duration-coda-standard) ease-coda-enter group-hover/card:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
              decoding="async"
              draggable={false}
              loading="lazy"
              src={article.artworkUrl}
            />
          ) : (
            <span className="grid size-full place-items-center text-muted-foreground">
              <BookOpenText size={24} />
            </span>
          )}
          <CardActionOverlay
            contentClassName="grid size-8 place-items-center rounded-full border border-white/10 bg-black/60 text-white shadow-[0_5px_15px_rgba(0,0,0,0.3)] backdrop-blur-sm"
          >
            <ArrowUpRight size={15} />
          </CardActionOverlay>
        </div>
        <div className="grid min-w-0 gap-1">
          {published ? (
            <div className="text-left text-xs tabular-nums text-muted-foreground">
              <time dateTime={article.publishedAt}>{published}</time>
            </div>
          ) : null}
          <h3
            className="m-0 line-clamp-2 text-left text-xs font-bold text-foreground transition-colors duration-(--duration-coda-fast) group-hover/card:text-primary motion-reduce:transition-none"
            data-daily-article-title={article.slug}
          >
            {article.title}
          </h3>
        </div>
      </Link>
    </article>
  );
});

export function DailyArchiveScreen({
  category,
}: Readonly<{ category: DailyCategory }>) {
  const query = useInfiniteQuery(dailyArticlesInfiniteQueryOptions(category));
  const articles = dailyArticlesNewestFirst(
    query.data?.pages.flatMap((page) => page.results) ?? [],
  );

  return (
    <section
      className="mx-auto mb-8 w-full max-w-6xl"
      aria-labelledby="daily-heading"
    >
      <header className="rounded-xl border border-border bg-[radial-gradient(circle_at_85%_15%,rgba(221,101,73,0.15),transparent_35%),linear-gradient(135deg,#24282a,#191c1e_70%)] px-6 py-6 lg:px-8">
        <Badge variant="artwork">Listen</Badge>
        <h1
          className="mt-3 mb-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl font-semibold tracking-tight"
          id="daily-heading"
        >
          Bandcamp Daily
        </h1>
        <p className="mt-2 mb-0 max-w-2xl text-sm text-muted-foreground">
          Skip straight to the albums and tracks embedded in Bandcamp’s
          editorial picks.
        </p>
        <DailyCategoryNav category={category} />
      </header>

      <div className="mt-6 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-lg font-semibold">
          {dailyCategoryLabel(category)}
        </h2>
        {articles.length ? (
          <span className="text-xs text-muted-foreground">
            {countLabel(articles.length, "story", "stories")}
          </span>
        ) : null}
      </div>

      {query.isPending ? (
        <div
          className="grid min-h-72 place-items-center text-center text-muted-foreground"
          role="status"
        >
          <div>
            <Spinner
              aria-hidden="true"
              className="mx-auto size-7 motion-reduce:animate-none"
            />
            <strong className="mt-3 block text-sm text-foreground">
              Finding the music…
            </strong>
          </div>
        </div>
      ) : query.isError && !articles.length ? (
        <div className="grid min-h-72 place-items-center text-center">
          <div>
            <Music2 className="mx-auto text-muted-foreground" size={28} />
            <strong className="mt-3 block text-sm">
              Bandcamp Daily is taking a break
            </strong>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              {String(query.error).replace(/^Error:\s*/u, "")}
            </p>
            <Button
              className="mt-3"
              onClick={() => void query.refetch()}
              size="compact"
            >
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        </div>
      ) : articles.length ? (
        <>
          {query.isError ? (
            <Alert className="mt-4" variant="danger">
              <Music2 size={16} />
              <div>
                <AlertTitle>Could not load more Daily stories</AlertTitle>
                <AlertDescription>
                  Your existing music and the stories already shown are
                  unaffected.
                </AlertDescription>
              </div>
            </Alert>
          ) : null}
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-x-3 gap-y-5 lg:grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] lg:gap-x-4 lg:gap-y-6 xl:grid-cols-[repeat(auto-fill,minmax(9rem,1fr))]">
            {articles.map((article) => (
              <DailyArticleCard
                article={article}
                category={category}
                key={article.id}
              />
            ))}
          </div>
          {query.hasNextPage ? (
            <Button
              className="mx-auto mt-7 flex"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              size="compact"
              variant="outline"
            >
              {query.isFetchingNextPage ? (
                <Spinner
                  aria-hidden="true"
                  className="size-4 motion-reduce:animate-none"
                />
              ) : null}
              {query.isFetchingNextPage ? "Loading more…" : "More stories"}
            </Button>
          ) : null}
        </>
      ) : (
        <div className="grid min-h-72 place-items-center text-center text-muted-foreground">
          <div>
            <Music2 className="mx-auto" size={28} />
            <strong className="mt-3 block text-sm text-foreground">
              No music stories found
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}

function DailyEmbedCard({
  article,
  embedIndex,
  playback,
}: {
  article: DailyArticle;
  embedIndex: number;
  playback: DailyPlaybackProps;
}) {
  const embed = article.embeds[embedIndex];
  if (!embed) return null;
  const tracks = dailyTracksFromEmbed(article, embed);
  const activeTrack = tracks.find(
    (track) => track.id === playback.currentTrackId,
  );
  return (
    <article className="overflow-hidden rounded-xl border border-border bg-white/[0.018]">
      <header className="flex gap-5 border-b border-border p-5 max-md:flex-col">
        <div className="size-36 shrink-0">
          <CoverArt
            album={{
              id: embed.id,
              title: embed.title,
              artist: embed.artist,
              artworkUrl: embed.artworkUrl,
              palette: paletteFor(embed.id),
            }}
            className="size-full rounded-lg"
            size="large"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="m-0 text-left text-xs tabular-nums text-muted-foreground">
            {countLabel(tracks.length, "playable track")}
          </p>
          <h3 className="mt-3 mb-0 text-xl font-semibold tracking-tight wrap-anywhere">
            {embed.title}
          </h3>
          <p className="mt-1 mb-0 text-sm font-medium text-primary">
            {embed.artist}
          </p>
          {embed.location ? (
            <p className="mt-1 mb-0 inline-flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin size={13} /> {embed.location}
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            {tracks.length ? (
              <>
                <Button
                  onClick={() =>
                    activeTrack && tracks.length === 1
                      ? playback.onTogglePlayback()
                      : playback.onPlayTracks(tracks)
                  }
                  variant="primary"
                >
                  <PlaybackIcon
                    playing={Boolean(
                      activeTrack && tracks.length === 1 && playback.playing,
                    )}
                  />
                  {activeTrack && tracks.length === 1
                    ? playback.playing
                      ? "Pause"
                      : "Resume"
                    : "Play release"}
                </Button>
                <Button onClick={() => playback.onQueueTracks(tracks)}>
                  <ListPlus size={16} /> Add to queue
                </Button>
              </>
            ) : null}
            <Button onClick={() => void openBandcampUrl(embed.itemUrl)}>
              <ArrowUpRight size={15} /> Open on Bandcamp
            </Button>
          </div>
        </div>
      </header>
      {tracks.length ? (
        <ol className="m-0 list-none p-2">
          {tracks.map((track) => {
            const active = track.id === playback.currentTrackId;
            return (
              <li
                className="group/row flex min-w-0 items-center gap-3 rounded-md px-2 py-2 transition-colors duration-(--duration-coda-fast) hover:bg-white/3 focus-within:bg-white/3 motion-reduce:transition-none"
                key={track.id}
              >
                <RowPlaybackAction
                  active={active}
                  ariaLabel={
                    active
                      ? `${playback.playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  className={cn("size-8 shrink-0", active && "text-primary")}
                  onClick={
                    active
                      ? playback.onTogglePlayback
                      : () => playback.onPlayTracks([track])
                  }
                  playing={playback.playing}
                  position={track.track}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {track.title}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatTime(track.duration)}
                </span>
                <RowActionGroup>
                  <Button
                    aria-label={`Add ${track.title} to queue`}
                    onClick={() => playback.onQueueTracks([track])}
                    size="icon-compact"
                    variant="ghost"
                  >
                    <Plus size={14} />
                  </Button>
                </RowActionGroup>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="m-0 p-5 text-sm text-muted-foreground">
          This embedded release does not currently offer a playable preview.
        </p>
      )}
    </article>
  );
}

export function DailyArticleScreen({
  article,
  playback,
  section,
}: Readonly<{
  article: DailyArticle;
  playback: DailyPlaybackProps;
  section: DailyCategory;
}>) {
  const navigation = useDailyRouteNavigation();
  const published = formatDailyDate(article.publishedAt);
  const allTracks = useMemo(
    () =>
      article.embeds.flatMap((embed) => dailyTracksFromEmbed(article, embed)),
    [article],
  );
  useLayoutEffect(() => {
    document
      .getElementById("daily-article-heading")
      ?.focus({ preventScroll: true });
  }, [article.slug]);

  return (
    <section
      className="mx-auto mb-8 w-full max-w-5xl"
      aria-labelledby="daily-article-heading"
    >
      <Link
        className="-ml-1 inline-flex items-center gap-1.5 rounded p-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        onClick={(event) =>
          handleCodaLinkActivation(event, () => {
            void navigation.closeArticle(article.slug, section);
          })
        }
        search={{ category: section }}
        to="/daily"
      >
        <ArrowLeft size={15} /> Back to {dailyCategoryLabel(section)}
      </Link>
      <div data-coda-daily-detail-surface>
      <header
        className="mt-3 grid gap-6 rounded-xl border border-border bg-[radial-gradient(circle_at_85%_15%,rgba(221,101,73,0.14),transparent_35%),linear-gradient(135deg,#24282a,#191c1e_70%)] p-6 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] lg:p-8"
      >
        {article.artworkUrl ? (
          <div
            className="aspect-square w-full max-w-48 overflow-hidden rounded-lg bg-muted shadow-[0_18px_38px_rgba(0,0,0,0.32)] outline-1 -outline-offset-1 outline-white/10"
            data-coda-daily-artwork-detail={article.slug}
          >
            <img
              alt=""
              className="size-full object-cover"
              decoding="async"
              draggable={false}
              src={article.artworkUrl}
            />
          </div>
        ) : null}
        <div className="min-w-0 self-center">
          <Badge variant="artwork">From Bandcamp Daily</Badge>
          <h1
            className="mt-3 mb-0 max-w-3xl text-3xl font-semibold tracking-tight wrap-anywhere outline-none"
            data-coda-daily-title-detail={article.slug}
            id="daily-article-heading"
            tabIndex={-1}
          >
            {article.title}
          </h1>
          <p className="mt-2 mb-0 text-xs text-muted-foreground">
            {[article.author, published].filter(Boolean).join(" · ")}
          </p>
          {article.description ? (
            <p className="mt-3 mb-0 max-w-3xl text-sm text-muted-foreground">
              {article.description}
            </p>
          ) : null}
          <Button
            className="mt-4"
            onClick={() => void openBandcampUrl(article.articleUrl)}
            size="compact"
            variant="outline"
          >
            <BookOpenText size={14} /> Read the story <ArrowUpRight size={13} />
          </Button>
        </div>
      </header>

      <div className="mt-7 flex items-center justify-between gap-3">
        <h2 className="m-0 text-xl font-semibold">Music in this story</h2>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="text-xs text-muted-foreground">
            {countLabel(article.embeds.length, "release")}
          </span>
          {article.embeds.length > 1 && allTracks.length ? (
            <Button
              aria-label="Queue all releases"
              onClick={() => playback.onQueueTracks(allTracks)}
              size="compact"
              title="Add every playable track to the queue"
              variant="outline"
            >
              <ListPlus size={14} /> Queue all
            </Button>
          ) : null}
        </div>
      </div>
      {article.embeds.length ? (
        <div className="mt-4 grid gap-5">
          {article.embeds.map((embed, index) => (
            <DailyEmbedCard
              article={article}
              embedIndex={index}
              key={embed.id}
              playback={playback}
            />
          ))}
        </div>
      ) : (
        <div className="mt-4 grid min-h-60 place-items-center rounded-xl border border-border text-center text-muted-foreground">
          <div>
            <Music2 className="mx-auto" size={28} />
            <strong className="mt-3 block text-sm text-foreground">
              No playable embeds found
            </strong>
            <p className="mt-1 mb-0 max-w-sm text-xs">
              The story is still available on Bandcamp Daily.
            </p>
          </div>
        </div>
      )}
      </div>
    </section>
  );
}
