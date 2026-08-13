import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  ArrowDownUp,
  ArrowUpRight,
  Check,
  Disc3,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CardActionOverlay } from "@/components/ItemInteractions";
import { ScrollableSelectionRail } from "@/components/ScrollableSelectionRail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { PlaybackIcon } from "@/components/ui/playback-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { discoverPreviewTrack } from "@/discover";
import { DISCOVER_GENRES, normalizeGenre } from "@/genres";
import { initials, openBandcampUrl, paletteFor } from "@/lib";
import { cn } from "@/lib/utils";
import { discoverInfiniteQueryOptions } from "@/queries/discoverQueries";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import {
  isDiscoverReleaseId,
  parseDiscoverReleaseIdParam,
  type DiscoverRouteSearch,
  validateDiscoverSearch,
} from "@/routing/routeContracts";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import type {
  DiscoverFilters,
  DiscoverRelease,
  DiscoverSort,
  Track,
} from "@/types";

const DISCOVER_SORT_OPTIONS: ReadonlyArray<{
  value: DiscoverSort;
  label: string;
}> = [
  { value: "top", label: "Best-selling" },
  { value: "new", label: "New arrivals" },
];

const DISCOVER_GRID_LAYOUTS = [
  {
    minColumnWidth: 288,
    columnGap: 10,
    rowGap: 10,
    rowHeight: 112,
  },
] as const;

const DiscoverCard = memo(function DiscoverCard({
  release,
  releaseSearch,
  fallbackGenre,
  currentTrackId,
  playing,
  onPlay,
  onQueue,
  onTogglePlayback,
  onOpenRelease,
  onOpenArtist,
}: {
  release: DiscoverRelease;
  releaseSearch: DiscoverRouteSearch;
  fallbackGenre?: string;
  currentTrackId?: string;
  playing: boolean;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  onTogglePlayback: () => void;
  onOpenRelease: (
    release: DiscoverRelease,
    trigger: HTMLElement,
  ) => void;
  onOpenArtist: (release: DiscoverRelease) => void;
}) {
  const track = discoverPreviewTrack(release);
  const palette = paletteFor(release.id);
  const active = Boolean(track && currentTrackId === track.id);
  const releaseId = isDiscoverReleaseId(release.id) ? release.id : undefined;
  const artworkUrl = release.artworkUrl;
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string>();
  const [loadedArtworkUrl, setLoadedArtworkUrl] = useState<string>();
  const [queueConfirmed, setQueueConfirmed] = useState(false);
  const queueConfirmationTimeoutRef = useRef<number | null>(null);
  const artworkEligible = Boolean(
    artworkUrl && failedArtworkUrl !== artworkUrl,
  );
  const artworkLoaded = Boolean(
    artworkEligible && loadedArtworkUrl === artworkUrl,
  );
  const openRelease = (event: MouseEvent<HTMLAnchorElement>) => {
    handleCodaLinkActivation(event, (trigger) => {
      onOpenRelease(release, trigger);
    });
  };
  const openInvalidRelease = (event: MouseEvent<HTMLButtonElement>) => {
    onOpenRelease(release, event.currentTarget);
  };
  const queueTrack = () => {
    if (!track) return;
    onQueue(track);
    setQueueConfirmed(true);
    if (queueConfirmationTimeoutRef.current !== null) {
      window.clearTimeout(queueConfirmationTimeoutRef.current);
    }
    queueConfirmationTimeoutRef.current = window.setTimeout(() => {
      setQueueConfirmed(false);
      queueConfirmationTimeoutRef.current = null;
    }, 1_600);
  };

  useEffect(
    () => () => {
      if (queueConfirmationTimeoutRef.current !== null) {
        window.clearTimeout(queueConfirmationTimeoutRef.current);
      }
    },
    [],
  );

  return (
    <article
      className="group/card grid h-full min-w-0 grid-cols-[--spacing(28)_minmax(0,1fr)] overflow-hidden rounded-lg border border-(--line) bg-white/[0.018] [contain-intrinsic-size:--spacing(28)_--spacing(75)] [content-visibility:auto] hover:border-(--line-strong) hover:bg-white/3"
      data-discover-release-card={release.id}
    >
      <div
        className="relative grid size-28 place-items-center overflow-hidden bg-[linear-gradient(145deg,var(--cover-accent),transparent_72%),var(--cover-base)] text-2xl font-bold text-white/78"
        data-coda-discover-artwork={release.id}
        style={
          {
            "--cover-accent": palette[0],
            "--cover-base": palette[1],
          } as React.CSSProperties
        }
      >
        {artworkEligible && artworkUrl ? (
          <img
            key={artworkUrl}
            className={cn(
              "col-start-1 row-start-1 size-full object-cover",
              !artworkLoaded && "invisible",
            )}
            data-discover-artwork-image={artworkUrl}
            src={artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedArtworkUrl(artworkUrl)}
            onLoad={() => {
              setLoadedArtworkUrl(artworkUrl);
              setFailedArtworkUrl((current) =>
                current === artworkUrl ? undefined : current,
              );
            }}
          />
        ) : null}
        {!artworkLoaded ? (
          <span
            className="col-start-1 row-start-1"
            data-discover-artwork-fallback={artworkUrl ?? "missing"}
          >
            {initials(release.title)}
          </span>
        ) : null}
        {releaseId ? (
          <Link
            className="absolute inset-0 z-1 size-full rounded-none p-0 outline-none hover:bg-white/4 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={openRelease}
            params={{ releaseId }}
            search={releaseSearch}
            to="/discover/releases/$releaseId"
            aria-label={`Open ${release.title} Discover details`}
            title={`Open ${release.title}`}
          />
        ) : (
          <Button
            variant="text"
            size="icon"
            className="absolute inset-0 z-1 size-full rounded-none p-0 outline-none hover:bg-white/4 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
            onClick={openInvalidRelease}
            aria-label={`Open ${release.title} Discover details`}
            title={`Open ${release.title}`}
          />
        )}
        {track ? (
          <CardActionOverlay
            contentClassName="flex items-center gap-1.5"
            visible={active}
          >
            <Button
              variant="primary"
              size="icon"
              className={`size-9 rounded-full p-0 shadow-[0_5px_17px_rgba(0,0,0,0.42)] ${active && playing ? "bg-[color-mix(in_srgb,var(--primary)_80%,#17191b)] shadow-[0_5px_17px_rgba(0,0,0,0.42),0_0_0_3px_rgba(221,101,73,0.16)]" : ""}`}
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
            <Button
              variant={queueConfirmed ? "primary" : "artwork"}
              size="icon"
              className="relative size-9 rounded-full p-0 shadow-[0_5px_17px_rgba(0,0,0,0.42)]"
              onClick={queueTrack}
              data-coda-discover-queue-action
              data-confirmed={queueConfirmed}
              aria-label={
                queueConfirmed
                  ? `${track.title} added to queue`
                  : `Add ${track.title} to queue`
              }
              title={queueConfirmed ? "Added" : "Add to queue"}
            >
              <Plus
                aria-hidden="true"
                className="absolute inset-0 m-auto"
                data-coda-queue-plus
                size={15}
              />
              <Check
                aria-hidden="true"
                className="absolute inset-0 m-auto"
                data-coda-queue-check
                size={15}
              />
              <span className="sr-only" aria-live="polite">
                {queueConfirmed ? `${track.title} added to queue` : ""}
              </span>
            </Button>
          </CardActionOverlay>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col px-3 pt-3 pb-2">
        <div className="flex min-w-0 flex-col gap-1">
          {releaseId ? (
            <Link
              className="flex h-auto w-full min-w-0 items-center justify-start overflow-hidden p-0 text-xs font-bold text-[#e8e5de] outline-none hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              onClick={openRelease}
              params={{ releaseId }}
              search={releaseSearch}
              to="/discover/releases/$releaseId"
              title={release.title}
            >
              <OverflowMarquee
                className="w-full text-left"
                staticTextProps={{
                  "data-coda-discover-title": release.id,
                }}
                text={release.title}
              />
            </Link>
          ) : (
            <Button
              variant="text"
              size="compact"
              className="flex h-auto w-full min-w-0 items-center justify-start overflow-hidden p-0 text-xs font-bold text-[#e8e5de] outline-none hover:bg-transparent hover:text-primary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              onClick={openInvalidRelease}
              title={release.title}
            >
              <OverflowMarquee
                className="w-full text-left"
                staticTextProps={{
                  "data-coda-discover-title": release.id,
                }}
                text={release.title}
              />
            </Button>
          )}
          {/* The runtime decides between a local artist route and the native,
              allowlisted external opener, so this remains an action button. */}
          <Button
            variant="text"
            size="compact"
            className="h-auto min-w-0 justify-start truncate p-0 text-xs font-medium text-[#9b9e99] hover:bg-transparent hover:text-primary"
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
        <div className="mt-auto flex min-h-7 items-center gap-1">
          {!track ? (
            <span className="text-xs text-[#666a65]">No preview available</span>
          ) : null}
          {/* Keep this imperative: the native opener validates the external
              Bandcamp URL instead of exposing it to in-app routing. */}
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

export type DiscoverScreenProps = {
  className?: string;
  filters: DiscoverFilters;
  onFiltersChange: (filters: DiscoverFilters) => void;
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
  onOpenRelease: (
    release: DiscoverRelease,
    trigger: HTMLElement,
  ) => void;
  onOpenArtist: (release: DiscoverRelease) => void;
};

type DiscoverViewProps = Omit<
  DiscoverScreenProps,
  "filters" | "onFiltersChange"
>;

export function DiscoverScreen({
  className,
  filters,
  onFiltersChange,
  onPlay,
  onQueue,
  currentTrackId,
  playing,
  onTogglePlayback,
  onOpenRelease,
  onOpenArtist,
}: DiscoverScreenProps) {
  const [draftTagState, setDraftTagState] = useState(() => ({
    committedTag: filters.tag,
    value: filters.tag,
  }));
  const draftTag =
    draftTagState.committedTag === filters.tag
      ? draftTagState.value
      : filters.tag;
  const setDraftTag = (value: string) => {
    setDraftTagState({ committedTag: filters.tag, value });
  };
  const query = useInfiniteQuery(discoverInfiniteQueryOptions(filters));
  const releases = useMemo(
    () => query.data?.pages.flatMap((page) => page.results) ?? [],
    [query.data],
  );
  const releaseSearch = useMemo(
    () => validateDiscoverSearch(filters),
    [filters],
  );
  const total = query.data?.pages[0]?.resultCount ?? 0;
  const selectedGenre = filters.tag.toLocaleLowerCase("en-US");
  const genreRailRef = useRef<HTMLElement>(null);
  const discoverScrollElementRef = useRef<HTMLElement | null>(null);
  const [genreRailEdges, setGenreRailEdges] = useState({
    start: false,
    end: false,
  });
  const setDiscoverRoot = useCallback((element: HTMLElement | null) => {
    discoverScrollElementRef.current = element?.closest<HTMLElement>(
      "[data-coda-library-scroll]",
    ) ?? element?.parentElement ?? null;
  }, []);

  const chooseGenre = (tag: string) => {
    const nextTag = tag === "all" ? "" : tag;
    setDraftTag(nextTag);
    onFiltersChange({ ...filters, tag: nextTag });
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onFiltersChange({ ...filters, tag: draftTag.trim() });
  };
  const chooseSort = (sort: DiscoverSort) =>
    onFiltersChange({ ...filters, sort });
  const updateGenreRailEdges = useCallback((rail: HTMLElement | null) => {
    if (!rail) return;
    const maxScrollLeft = Math.max(0, rail.scrollWidth - rail.clientWidth);
    const nextEdges = {
      start: rail.scrollLeft > 1,
      end: rail.scrollLeft < maxScrollLeft - 1,
    };
    setGenreRailEdges((current) =>
      current.start === nextEdges.start && current.end === nextEdges.end
        ? current
        : nextEdges,
    );
  }, []);
  const scrollGenreRail = useCallback(
    (direction: -1 | 1) => {
      const rail = genreRailRef.current;
      if (!rail) return;
      const left =
        rail.scrollLeft +
        direction * Math.max(160, Math.round(rail.clientWidth * 0.7));
      if (typeof rail.scrollTo === "function") {
        rail.scrollTo({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          left,
        });
      } else {
        rail.scrollLeft = left;
        updateGenreRailEdges(rail);
      }
    },
    [updateGenreRailEdges],
  );

  useLayoutEffect(() => {
    const rail = genreRailRef.current;
    if (!rail) return;
    const updateEdges = () => updateGenreRailEdges(rail);
    updateEdges();
    window.addEventListener("resize", updateEdges);
    return () => window.removeEventListener("resize", updateEdges);
  }, [updateGenreRailEdges]);

  useEffect(() => {
    if (selectedGenre) return;
    const rail = genreRailRef.current;
    if (!rail) return;
    if (typeof rail.scrollTo === "function") {
      rail.scrollTo({ behavior: "auto", left: 0 });
    } else {
      rail.scrollLeft = 0;
    }
    updateGenreRailEdges(rail);
  }, [selectedGenre, updateGenreRailEdges]);

  return (
    <section
      className={cn("min-h-full", className)}
      aria-live="polite"
      aria-busy={query.isFetching}
      ref={setDiscoverRoot}
    >
      <div className="relative -mx-4 -mt-6 mb-6 flex items-end justify-between gap-9 overflow-hidden border-b border-(--line) bg-[radial-gradient(circle_at_92%_0%,rgba(221,101,73,0.17),transparent_39%),linear-gradient(135deg,#181b1d_0%,#141719_70%)] px-4 pt-12 pb-8 after:pointer-events-none after:absolute after:-top-28 after:right-[18%] after:size-56 after:rounded-full after:border after:border-white/[0.035] after:shadow-[0_0_0_42px_rgba(255,255,255,0.012),0_0_0_84px_rgba(255,255,255,0.008)] after:content-[''] lg:-mx-6 lg:-mt-8 lg:px-6 xl:-mx-8 xl:flex-row xl:items-end xl:px-8 max-xl:flex-col max-xl:items-stretch">
        <div className="relative z-1">
          <Badge variant="artwork" className="mb-2.5 h-auto gap-1.5 border-0 bg-transparent p-0 text-xs tracking-widest text-[#c67966] uppercase"><Sparkles size={13} /> Find something new</Badge>
          <h1 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-4xl leading-none font-semibold tracking-tighter xl:text-5xl">Discover</h1>
          <p className="mt-3 mb-0 max-w-xl text-sm/normal text-[#969a95]">Browse Bandcamp’s public feed, preview a release, then send it straight to your queue.</p>
        </div>
        <form className="relative z-1 flex h-10 min-w-70 basis-90 items-center rounded-lg border border-(--line-strong) bg-[rgba(9,10,11,0.52)] pl-3 text-coda-subtle-foreground shadow-[0_12px_30px_rgba(0,0,0,0.16)] focus-within:border-[rgba(221,101,73,0.5)] max-xl:w-full max-xl:max-w-md max-xl:basis-auto" onSubmit={submit}>
          <Search size={17} />
          <label className="sr-only" htmlFor="discover-tag">Search Discover by tag</label>
          <Input
            id="discover-tag"
            name="discover-tag"
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

      <div className="flex items-center gap-2 border-b border-(--line) pb-3 lg:gap-4">
        <ScrollableSelectionRail
          aria-label="Filter Discover by genre"
          className="flex-1"
          disabled={query.isPending}
          edges={genreRailEdges}
          items={[
            { label: "All genres", value: "" },
            ...DISCOVER_GENRES.map((tag) => ({
              label: normalizeGenre(tag) ?? tag,
              value: tag,
            })),
          ]}
          nextLabel="Show more genres"
          onScroll={updateGenreRailEdges}
          onScrollByDirection={scrollGenreRail}
          onValueChange={(tag) => chooseGenre(tag || "all")}
          previousLabel="Show previous genres"
          railRef={genreRailRef}
          value={selectedGenre}
        />
        <Select
          items={DISCOVER_SORT_OPTIONS}
          value={filters.sort}
          onValueChange={(value) => {
            if (value) chooseSort(value);
          }}
          disabled={query.isPending}
        >
          <SelectTrigger
            aria-label="Sort Discover results"
            className="h-8 max-w-40 shrink-0 gap-1.5 rounded-sm border-border bg-muted px-2 py-0 text-xs font-semibold text-[#858984] hover:bg-muted hover:text-[#d8d7d1] data-open:border-primary/40 data-open:bg-muted data-open:text-[#efede7]"
            size="sm"
          >
            <ArrowDownUp aria-hidden="true" className="size-3.5" />
            <SelectValue className="min-w-0" />
          </SelectTrigger>
          <SelectContent
            align="end"
            alignItemWithTrigger={false}
            className="min-w-40 rounded-lg border border-(--line-strong) bg-popover p-1 text-xs shadow-lg"
            sideOffset={6}
          >
            {DISCOVER_SORT_OPTIONS.map(({ value, label }) => (
              <SelectItem
                className="py-1.5 pr-8 pl-2 text-xs text-[#a8aaa5] focus:bg-white/5 focus:text-[#efede7]"
                key={value}
                value={value}
              >
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {query.isPending ? (
        <div className="flex min-h-80 flex-col items-center justify-center text-center text-[#6e726d]">
          <Spinner
            aria-hidden="true"
            className="size-7 text-current motion-reduce:animate-none"
          />
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
          <ResponsiveVirtualGrid
            aria-label="Discover releases"
            className="w-full"
            getItemKey={(release) => release.id}
            items={releases}
            layouts={DISCOVER_GRID_LAYOUTS}
            scrollElementRef={discoverScrollElementRef}
            renderItem={(release) => (
              <DiscoverCard
                release={release}
                releaseSearch={releaseSearch}
                fallbackGenre={filters.tag || undefined}
                currentTrackId={currentTrackId}
                playing={playing}
                onPlay={onPlay}
                onQueue={onQueue}
                onTogglePlayback={onTogglePlayback}
                onOpenRelease={onOpenRelease}
                onOpenArtist={onOpenArtist}
              />
            )}
          />
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

export default function DiscoverView(props: DiscoverViewProps) {
  const [filters, setFilters] = useState<DiscoverFilters>({
    tag: "",
    sort: "top",
  });
  return (
    <DiscoverScreen
      {...props}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
}
