import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Disc3,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { type FormEvent, memo, useMemo, useState } from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { countLabel } from "./countLabel";
import { discoverPreviewTrack } from "./discover";
import { DISCOVER_GENRES, normalizeGenre } from "./genres";
import {
  fetchDiscover,
  formatTime,
  initials,
  openBandcampUrl,
  paletteFor,
} from "./lib";
import type {
  DiscoverFilters,
  DiscoverRelease,
  DiscoverSort,
  Track,
} from "./types";

const PRIMARY_GENRES: readonly string[] = DISCOVER_GENRES.slice(0, 11);
const EXTRA_GENRES: readonly string[] = DISCOVER_GENRES.slice(PRIMARY_GENRES.length);

const DiscoverCard = memo(function DiscoverCard({
  release,
  fallbackGenre,
  currentTrackId,
  playing,
  onPlay,
  onTogglePlayback,
  onQueue,
  onOpenRelease,
  onOpenArtist,
}: {
  release: DiscoverRelease;
  fallbackGenre?: string;
  currentTrackId?: string;
  playing: boolean;
  onPlay: (track: Track) => void;
  onTogglePlayback: () => void;
  onQueue: (track: Track) => void;
  onOpenRelease: (
    release: DiscoverRelease,
    trigger: HTMLButtonElement,
  ) => void;
  onOpenArtist: (release: DiscoverRelease) => void;
}) {
  const track = discoverPreviewTrack(release);
  const palette = paletteFor(release.id);
  const active = Boolean(track && currentTrackId === track.id);

  return (
    <article className="group/card grid min-w-0 grid-cols-[--spacing(28)_minmax(0,1fr)] overflow-hidden rounded-lg border border-(--line) bg-white/[0.018] [contain-intrinsic-size:--spacing(28)_--spacing(75)] [content-visibility:auto] hover:border-(--line-strong) hover:bg-white/3">
      <div
        className="relative grid size-28 place-items-center overflow-hidden bg-[linear-gradient(145deg,var(--cover-accent),transparent_72%),var(--cover-base)] text-2xl font-bold text-white/78"
        style={
          {
            "--cover-accent": palette[0],
            "--cover-base": palette[1],
          } as React.CSSProperties
        }
      >
        {release.artworkUrl ? (
          <img
            className="size-full object-cover"
            src={release.artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span>{initials(release.title)}</span>
        )}
        <Button
          variant="ghost"
          size="compact"
          className="absolute inset-0 z-1 size-full rounded-none p-0 hover:bg-white/4 focus-visible:-outline-offset-2"
          onClick={(event) => onOpenRelease(release, event.currentTarget)}
          aria-label={`Open ${release.title} Discover details`}
          title={`Open ${release.title}`}
        />
        {track ? (
          <Button
            variant="primary"
            size="icon"
            className={`absolute right-2 bottom-2 z-2 size-9 translate-y-1 rounded-full p-0 opacity-0 shadow-[0_5px_17px_rgba(0,0,0,0.42)] transition-[opacity,transform] duration-(--duration-coda-fast) group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100 motion-reduce:transition-none ${active ? "translate-y-0 opacity-100" : ""} ${active && playing ? "bg-[color-mix(in_srgb,var(--primary)_80%,#17191b)] shadow-[0_5px_17px_rgba(0,0,0,0.42),0_0_0_3px_rgba(221,101,73,0.16)]" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(track)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${track.title}`
                : `Preview ${track.title}`
            }
            aria-pressed={active && playing}
          >
            <PlaybackIcon playing={active && playing} />
          </Button>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col px-3 pt-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          <Button
            variant="text"
            size="compact"
            className="h-auto min-w-0 justify-start truncate p-0 text-xs font-bold text-[#e8e5de] hover:bg-transparent hover:text-primary hover:underline"
            onClick={(event) => onOpenRelease(release, event.currentTarget)}
            title={release.title}
          >
            {release.title}
          </Button>
          <Button
            variant="text"
            size="compact"
            className="h-auto min-w-0 justify-start truncate p-0 text-xs font-medium text-[#9b9e99] hover:bg-transparent hover:text-primary hover:underline"
            onClick={() => onOpenArtist(release)}
            title={release.artist}
          >
            {release.artist}
          </Button>
        </div>
        <p className="mt-2 truncate text-xs text-[#696d68]">
          {[release.genre ?? fallbackGenre, release.location]
            .filter(Boolean)
            .map((value, index) => index === 0 ? normalizeGenre(value) : value)
            .join(" · ") ||
            "Independent release"}
        </p>
        <div className="mt-auto flex items-center gap-1">
          {track ? (
            <Button
              variant="text"
              size="compact"
              className="h-auto min-w-0 gap-1 py-1 pr-1 pl-0 text-xs font-bold text-[#dc8069] hover:text-[#dc8069]"
              onClick={() => onQueue(track)}
            >
              <Plus size={14} />
              Add to queue
              {track.duration ? <span className="text-xs font-medium text-[#626661]">{formatTime(track.duration)}</span> : null}
            </Button>
          ) : (
            <span className="text-xs text-[#666a65]">No preview available</span>
          )}
          <Button
            variant="ghost"
            size="icon-compact"
            className="ml-auto size-7 text-muted-foreground"
            onClick={() => void openBandcampUrl(release.itemUrl)}
            aria-label={`Open ${release.title} on Bandcamp`}
            title="Open on Bandcamp"
          >
            <ArrowUpRight size={16} />
          </Button>
        </div>
      </div>
    </article>
  );
});

export default function DiscoverView({
  onPlay,
  onQueue,
  currentTrackId,
  playing,
  onTogglePlayback,
  onOpenRelease,
  onOpenArtist,
}: {
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  onOpenRelease: (
    release: DiscoverRelease,
    trigger: HTMLButtonElement,
  ) => void;
  onOpenArtist: (release: DiscoverRelease) => void;
}) {
  const [draftTag, setDraftTag] = useState("");
  const [filters, setFilters] = useState<DiscoverFilters>({ tag: "", sort: "top" });
  const query = useInfiniteQuery({
    queryKey: ["discover", filters],
    queryFn: ({ pageParam }) => fetchDiscover(filters, pageParam),
    initialPageParam: "*",
    getNextPageParam: (lastPage) =>
      lastPage.hasMore && lastPage.cursor ? lastPage.cursor : undefined,
  });
  const releases = useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.resultCount ?? 0;
  const selectedGenre = filters.tag.toLocaleLowerCase("en-US");
  const quickGenres = useMemo(
    () =>
      EXTRA_GENRES.includes(selectedGenre)
        ? [...PRIMARY_GENRES, selectedGenre]
        : PRIMARY_GENRES,
    [selectedGenre],
  );
  const selectedExtraGenre = EXTRA_GENRES.includes(selectedGenre) ? selectedGenre : "";

  const chooseGenre = (tag: string) => {
    const nextTag = tag === "all" ? "" : tag;
    setDraftTag(nextTag);
    setFilters((value) => ({ ...value, tag: nextTag }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setFilters((value) => ({ ...value, tag: draftTag.trim() }));
  };
  const chooseSort = (sort: DiscoverSort) =>
    setFilters((value) => ({ ...value, sort }));

  return (
    <section
      className="min-h-full"
      aria-live="polite"
      aria-busy={query.isFetching}
    >
      <div className="relative -mx-8 -mt-8 mb-6 flex items-end justify-between gap-9 overflow-hidden border-b border-(--line) bg-[radial-gradient(circle_at_92%_0%,rgba(221,101,73,0.17),transparent_39%),linear-gradient(135deg,#181b1d_0%,#141719_70%)] px-8 pt-12 pb-8 after:pointer-events-none after:absolute after:-top-28 after:right-[18%] after:size-56 after:rounded-full after:border after:border-white/[0.035] after:shadow-[0_0_0_42px_rgba(255,255,255,0.012),0_0_0_84px_rgba(255,255,255,0.008)] after:content-[''] max-xl:-mx-6 max-xl:flex-col max-xl:items-stretch max-xl:px-6">
        <div className="relative z-1">
          <Badge variant="artwork" className="mb-2.5 h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#c67966] uppercase"><Sparkles size={13} /> Find something new</Badge>
          <h1 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-4xl leading-none font-semibold tracking-tighter xl:text-5xl">Discover</h1>
          <p className="mt-3 mb-0 max-w-xl text-sm/normal text-[#969a95]">Browse Bandcamp’s public feed, preview a release, then send it straight to your queue.</p>
        </div>
        <form className="relative z-1 flex h-10 min-w-70 basis-90 items-center rounded-lg border border-(--line-strong) bg-[rgba(9,10,11,0.52)] pl-3 text-[#777b76] shadow-[0_12px_30px_rgba(0,0,0,0.16)] focus-within:border-[rgba(221,101,73,0.5)] max-xl:w-full max-xl:max-w-md max-xl:basis-auto" onSubmit={submit}>
          <Search size={17} />
          <label className="sr-only" htmlFor="discover-tag">Search Discover by tag</label>
          <Input
            id="discover-tag"
            className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2.5 text-xs text-[#ebe8e1] shadow-none focus-visible:border-0 focus-visible:ring-0"
            value={draftTag}
            maxLength={64}
            onChange={(event) => setDraftTag(event.target.value)}
            placeholder="Try shoegaze, house, Lagos…"
          />
          <Button type="submit" variant="text" size="compact" className="h-full self-stretch rounded-l-none rounded-r-md border-y-0 border-r-0 border-l border-(--line) bg-[rgba(221,101,73,0.12)] px-3.5 text-xs font-bold text-[#e98a72] hover:bg-[rgba(221,101,73,0.12)] hover:text-[#e98a72]" disabled={query.isPending}>
            {query.isPending ? <Spinner aria-hidden="true" className="size-3.5 text-current motion-reduce:animate-none" /> : null}
            {query.isPending ? "Exploring…" : "Explore"}
          </Button>
        </form>
      </div>

      <div className="flex items-start justify-between gap-4 border-b border-(--line) pb-4 max-xl:flex-col">
        <ToggleGroup
          className="w-auto flex-wrap gap-1 rounded-none"
          aria-label="Discover genres"
          value={[filters.tag || "all"]}
          spacing={4}
          disabled={query.isPending}
          onValueChange={(values) => {
            const nextTag = values[0];
            if (nextTag) chooseGenre(nextTag);
          }}
        >
          <ToggleGroupItem value="all" variant="default" size="sm" className="h-7 min-w-0 rounded-full border border-transparent px-2.5 text-xs font-semibold text-[#858984] hover:text-[#d8d7d1] aria-pressed:border-(--line) aria-pressed:bg-[#26292b] aria-pressed:text-[#efede7]">
            All genres
          </ToggleGroupItem>
          {quickGenres.map((tag) => (
            <ToggleGroupItem
              key={tag}
              value={tag}
              variant="default"
              size="sm"
              className="h-7 min-w-0 rounded-full border border-transparent px-2.5 text-xs font-semibold text-[#858984] hover:text-[#d8d7d1] aria-pressed:border-(--line) aria-pressed:bg-[#26292b] aria-pressed:text-[#efede7]"
            >
              {normalizeGenre(tag)}
            </ToggleGroupItem>
          ))}
          <NativeSelect
            className="h-7 max-w-32 rounded-full border border-(--line) bg-[#202325] text-xs text-[#858984] [&_select]:h-7 [&_select]:max-w-20 [&_select]:border-0 [&_select]:bg-transparent [&_select]:py-0 [&_select]:pr-6 [&_select]:pl-2 [&_select]:text-xs [&_select]:text-inherit [&_svg]:right-1 [&_svg]:size-3"
            value={selectedExtraGenre}
            aria-label="More Discover genres"
            onChange={(event) => chooseGenre(event.target.value)}
            disabled={query.isPending}
          >
            <NativeSelectOption value="" disabled>More genres</NativeSelectOption>
            {EXTRA_GENRES.map((tag) => (
              <NativeSelectOption key={tag} value={tag}>{normalizeGenre(tag)}</NativeSelectOption>
            ))}
          </NativeSelect>
        </ToggleGroup>
        <ToggleGroup
          className="w-auto rounded-full border border-(--line) p-0.5"
          aria-label="Sort Discover results"
          value={[filters.sort]}
          disabled={query.isPending}
          onValueChange={(values) => {
            const nextSort = values[0] as DiscoverSort | undefined;
            if (nextSort) chooseSort(nextSort);
          }}
        >
          <ToggleGroupItem value="top" variant="default" size="sm" className="h-7 min-w-0 rounded-full border-0 px-2.5 text-xs font-semibold text-[#858984] hover:text-[#d8d7d1] aria-pressed:bg-(--accent-soft) aria-pressed:text-[#e9917a]">
            Best-selling
          </ToggleGroupItem>
          <ToggleGroupItem value="new" variant="default" size="sm" className="h-7 min-w-0 rounded-full border-0 px-2.5 text-xs font-semibold text-[#858984] hover:text-[#d8d7d1] aria-pressed:bg-(--accent-soft) aria-pressed:text-[#e9917a]">
            New arrivals
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {query.isPending ? (
        <div className="flex min-h-80 flex-col items-center justify-center text-center text-[#6e726d]">
          <div className="relative grid size-7 place-items-center">
            <Skeleton aria-hidden="true" className="absolute inset-0 rounded-full bg-[#6e726d]/20 motion-reduce:animate-none" />
            <Spinner aria-hidden="true" className="relative size-7 text-current motion-reduce:animate-none" />
          </div>
          <strong className="mt-3 text-sm text-[#c8c7c1]">Scanning Bandcamp…</strong>
          <span className="mt-1 max-w-sm text-xs text-[#747873]">Finding releases with playable previews.</span>
        </div>
      ) : query.isError && !releases.length ? (
        <div className="flex min-h-80 flex-col items-center justify-center text-center text-[#6e726d]">
          <Disc3 size={28} />
          <strong className="mt-3 text-sm text-[#c8c7c1]">Discover is taking a break</strong>
          <span className="mt-1 max-w-sm text-xs text-[#747873]">{String(query.error).replace(/^Error:\s*/, "")}</span>
          <Button
            variant="artwork"
            size="compact"
            className="mt-3 h-auto gap-1.5 rounded-md border border-(--line) px-2.5 py-2 text-xs font-bold text-[#d98974] hover:bg-white/2.5 hover:text-[#d98974]"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching
              ? <Spinner aria-hidden="true" className="size-3.5 text-current motion-reduce:animate-none" />
              : <RefreshCw size={14} />}
            {query.isFetching ? "Trying again…" : "Try again"}
          </Button>
        </div>
      ) : releases.length ? (
        <>
          {query.isError ? (
            <Alert variant="danger" className="mb-4 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2">
              <Disc3 size={16} />
              <div>
                <AlertTitle>Discover is taking a break</AlertTitle>
                <AlertDescription>{String(query.error).replace(/^Error:\s*/, "")}</AlertDescription>
              </div>
              <AlertAction className="static">
                <Button variant="text" size="compact" className="h-auto px-0 text-xs text-[#d98974] hover:text-[#d98974]" onClick={() => void query.refetch()} disabled={query.isFetching}>
                  {query.isFetching ? "Trying again…" : "Try again"}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          <div className="mt-6 mb-4 flex items-baseline justify-between gap-3">
            <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold tracking-tight">{filters.tag ? `Sounds tagged “${filters.tag}”` : "Across Bandcamp"}</h2>
            <span className="text-xs text-[#6f736e]">{countLabel(total, "result")}</span>
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(18rem,1fr))] gap-2.5">
            {releases.map((release) => (
              <DiscoverCard
                key={release.id}
                release={release}
                fallbackGenre={filters.tag || undefined}
                currentTrackId={currentTrackId}
                playing={playing}
                onPlay={onPlay}
                onTogglePlayback={onTogglePlayback}
                onQueue={onQueue}
                onOpenRelease={onOpenRelease}
                onOpenArtist={onOpenArtist}
              />
            ))}
          </div>
          {query.hasNextPage ? (
            <Button
              variant="outline"
              size="compact"
              className="mx-auto mt-8 flex h-auto w-fit rounded-md border border-(--line) bg-white/2.5 px-3.5 py-2 text-xs font-bold text-[#a8aaa5] hover:border-(--line-strong) hover:bg-white/5.5 hover:text-[#e3e1db]"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <><Spinner aria-hidden="true" className="size-4 text-current motion-reduce:animate-none" /> Loading more</>
              ) : (
                "View more discoveries"
              )}
            </Button>
          ) : null}
        </>
      ) : (
        <div className="flex min-h-80 flex-col items-center justify-center text-center text-[#6e726d]">
          <Search size={28} />
          <strong className="mt-3 text-sm text-[#c8c7c1]">No releases found</strong>
          <span className="mt-1 max-w-sm text-xs text-[#747873]">Try a broader genre or a different tag.</span>
          <Button variant="artwork" size="compact" className="mt-3 h-auto gap-1.5 rounded-md border border-(--line) px-2.5 py-2 text-xs font-bold text-[#d98974] hover:bg-white/2.5 hover:text-[#d98974]" onClick={() => chooseGenre("all")}>Clear tag</Button>
        </div>
      )}
    </section>
  );
}
