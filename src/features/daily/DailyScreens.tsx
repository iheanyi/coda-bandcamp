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
import { memo } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import {
  DAILY_CATEGORIES,
  dailyCategoryLabel,
  dailyTracksFromEmbed,
  formatDailyDate,
} from "@/daily";
import { CoverArt } from "@/features/artwork/CoverArt";
import { formatTime, openBandcampUrl, paletteFor } from "@/lib";
import { cn } from "@/lib/utils";
import { dailyArticlesInfiniteQueryOptions } from "@/queries/dailyQueries";
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
  return (
    <nav aria-label="Bandcamp Daily sections" className="mt-5 overflow-x-auto">
      <div className="flex min-w-max gap-1 rounded-lg border border-border bg-white/2 p-1">
        {DAILY_CATEGORIES.map((item) => (
          <Link
            aria-current={item.value === category ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-white/4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              item.value === category && "bg-primary/12 text-primary",
            )}
            key={item.value}
            search={{ category: item.value }}
            to="/daily"
          >
            {item.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

const DailyArticleCard = memo(function DailyArticleCard({
  article,
  category,
}: {
  article: DailyArticleSummary;
  category: DailyCategory;
}) {
  const published = formatDailyDate(article.publishedAt);
  return (
    <article className="min-w-0">
      <Link
        aria-label={`Open music from ${article.title}`}
        className="group grid min-w-0 grid-cols-[--spacing(28)_minmax(0,1fr)] overflow-hidden rounded-lg border border-border bg-white/[0.018] outline-none hover:border-(--line-strong) hover:bg-white/3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        params={{ slug: article.slug }}
        search={{ category }}
        to="/daily/$slug"
      >
        <span className="relative size-28 overflow-hidden bg-muted">
          {article.artworkUrl ? (
            <img
              alt=""
              className="size-full object-cover transition-transform duration-(--duration-coda-fast) group-hover:scale-[1.025] motion-reduce:transition-none"
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
        </span>
        <span className="grid min-w-0 grid-rows-[auto_1fr_auto] px-3 py-3">
          <Badge className="justify-self-start" variant="artwork">
            {dailyCategoryLabel(category)}
          </Badge>
          <span className="mt-2 line-clamp-2 self-start text-sm leading-snug font-semibold text-foreground group-hover:text-primary">
            {article.title}
          </span>
          <span className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{published ?? "Bandcamp Daily"}</span>
            <span className="inline-flex items-center gap-1 font-semibold text-primary">
              Hear the music <Music2 size={13} />
            </span>
          </span>
        </span>
      </Link>
    </article>
  );
});

export function DailyArchiveScreen({
  category,
}: Readonly<{ category: DailyCategory }>) {
  const query = useInfiniteQuery(dailyArticlesInfiniteQueryOptions(category));
  const articles = query.data?.pages.flatMap((page) => page.results) ?? [];

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
          <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
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
          <Badge variant="artwork">
            {countLabel(tracks.length, "playable track")}
          </Badge>
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
                className="flex min-w-0 items-center gap-3 rounded-md px-2 py-2 hover:bg-white/3"
                key={track.id}
              >
                <Button
                  aria-label={
                    active
                      ? `${playback.playing ? "Pause" : "Resume"} ${track.title}`
                      : `Play ${track.title}`
                  }
                  aria-pressed={active && playback.playing}
                  className={cn("size-8 shrink-0", active && "text-primary")}
                  onClick={
                    active
                      ? playback.onTogglePlayback
                      : () => playback.onPlayTracks([track])
                  }
                  size="icon-compact"
                  variant="ghost"
                >
                  <PlaybackIcon playing={active && playback.playing} />
                </Button>
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {track.track}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {track.title}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatTime(track.duration)}
                </span>
                <Button
                  aria-label={`Add ${track.title} to queue`}
                  onClick={() => playback.onQueueTracks([track])}
                  size="icon-compact"
                  variant="ghost"
                >
                  <Plus size={14} />
                </Button>
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
}: Readonly<{ article: DailyArticle; playback: DailyPlaybackProps }>) {
  const published = formatDailyDate(article.publishedAt);
  return (
    <section
      className="mx-auto mb-8 w-full max-w-5xl"
      aria-labelledby="daily-article-heading"
    >
      <Link
        className="-ml-1 inline-flex items-center gap-1.5 rounded p-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        search={{ category: article.category }}
        to="/daily"
      >
        <ArrowLeft size={15} /> Back to {dailyCategoryLabel(article.category)}
      </Link>
      <header className="mt-3 rounded-xl border border-border bg-[radial-gradient(circle_at_85%_15%,rgba(221,101,73,0.14),transparent_35%),linear-gradient(135deg,#24282a,#191c1e_70%)] p-6 lg:p-8">
        <Badge variant="artwork">From Bandcamp Daily</Badge>
        <h1
          className="mt-3 mb-0 max-w-3xl text-3xl font-semibold tracking-tight wrap-anywhere"
          id="daily-article-heading"
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
      </header>

      <div className="mt-7 flex items-baseline justify-between gap-3">
        <h2 className="m-0 text-xl font-semibold">Music in this story</h2>
        <span className="text-xs text-muted-foreground">
          {countLabel(article.embeds.length, "release")}
        </span>
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
    </section>
  );
}
