import { IconButton } from "./components/ui/IconButton";
import { Input } from "./components/ui/Field";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronDown,
  Disc3,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import { type FormEvent, memo, useMemo, useState } from "react";
import { countLabel } from "./countLabel";
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

function previewTrack(release: DiscoverRelease): Track | undefined {
  if (!release.featuredTrack) return undefined;
  return {
    id: release.featuredTrack.id,
    title: release.featuredTrack.title,
    artist: release.artist,
    album: release.title,
    albumId: release.id,
    duration: release.featuredTrack.duration,
    track: 0,
    artworkUrl: release.artworkUrl,
    streamUrl: release.featuredTrack.streamUrl,
    palette: paletteFor(release.id),
  };
}

const DiscoverCard = memo(function DiscoverCard({
  release,
  fallbackGenre,
  currentTrackId,
  playing,
  onPlay,
  onTogglePlayback,
  onQueue,
}: {
  release: DiscoverRelease;
  fallbackGenre?: string;
  currentTrackId?: string;
  playing: boolean;
  onPlay: (track: Track) => void;
  onTogglePlayback: () => void;
  onQueue: (track: Track) => void;
}) {
  const track = previewTrack(release);
  const palette = paletteFor(release.id);
  const active = Boolean(track && currentTrackId === track.id);

  return (
    <article className="discover-card">
      <div
        className="discover-card__art"
        style={
          {
            "--cover-accent": palette[0],
            "--cover-base": palette[1],
          } as React.CSSProperties
        }
      >
        {release.artworkUrl ? (
          <img
            src={release.artworkUrl}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span>{initials(release.title)}</span>
        )}
        {track ? (
          <button
            className={`discover-card__play ${active ? "is-current" : ""} ${active && playing ? "is-playing" : ""}`}
            onClick={active ? onTogglePlayback : () => onPlay(track)}
            aria-label={
              active
                ? `${playing ? "Pause" : "Resume"} ${track.title}`
                : `Preview ${track.title}`
            }
            aria-pressed={active && playing}
          >
            {active && playing
              ? <Pause size={20} fill="currentColor" />
              : <Play size={20} fill="currentColor" />}
          </button>
        ) : null}
      </div>
      <div className="discover-card__body">
        <div className="discover-card__copy">
          <strong title={release.title}>{release.title}</strong>
          <span title={release.artist}>{release.artist}</span>
        </div>
        <p>
          {[release.genre ?? fallbackGenre, release.location]
            .filter(Boolean)
            .map((value, index) => index === 0 ? normalizeGenre(value) : value)
            .join(" · ") ||
            "Independent release"}
        </p>
        <div className="discover-card__actions">
          {track ? (
            <button className="discover-card__queue" onClick={() => onQueue(track)}>
              <Plus size={14} />
              Add to queue
              {track.duration ? <span>{formatTime(track.duration)}</span> : null}
            </button>
          ) : (
            <span className="discover-card__unavailable">No preview available</span>
          )}
          <IconButton onClick={() => void openBandcampUrl(release.itemUrl)}
            aria-label={`Open ${release.title} on Bandcamp`}
            title="Open on Bandcamp"
          >
            <ArrowUpRight size={16} />
          </IconButton>
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
}: {
  onPlay: (track: Track) => void;
  onQueue: (track: Track) => void;
  currentTrackId?: string;
  playing: boolean;
  onTogglePlayback: () => void;
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
      className="discover-view"
      aria-live="polite"
      aria-busy={query.isFetching}
    >
      <div className="discover-intro">
        <div>
          <span className="eyebrow"><Sparkles size={13} /> Find something new</span>
          <h1>Discover</h1>
          <p>Browse Bandcamp’s public feed, preview a release, then send it straight to your queue.</p>
        </div>
        <form className="discover-search" onSubmit={submit}>
          <Search size={17} />
          <label className="sr-only" htmlFor="discover-tag">Search Discover by tag</label>
          <Input
            id="discover-tag"
            value={draftTag}
            maxLength={64}
            onChange={(event) => setDraftTag(event.target.value)}
            placeholder="Try shoegaze, house, Lagos…"
          />
          <button type="submit" disabled={query.isPending}>
            {query.isPending ? <LoaderCircle className="spin" size={14} /> : null}
            {query.isPending ? "Exploring…" : "Explore"}
          </button>
        </form>
      </div>

      <div className="discover-controls">
        <div className="discover-genres" aria-label="Discover genres">
          <button
            className={!filters.tag ? "active" : ""}
            onClick={() => chooseGenre("all")}
            disabled={query.isPending}
          >
            All genres
          </button>
          {quickGenres.map((tag) => (
            <button
              key={tag}
              className={selectedGenre === tag ? "active" : ""}
              onClick={() => chooseGenre(tag)}
              disabled={query.isPending}
            >
              {normalizeGenre(tag)}
            </button>
          ))}
          <label className="discover-genre-picker">
            <span className="sr-only">More Discover genres</span>
            <select
              value={selectedExtraGenre}
              aria-label="More Discover genres"
              onChange={(event) => chooseGenre(event.target.value)}
              disabled={query.isPending}
            >
              <option value="" disabled>More genres</option>
              {EXTRA_GENRES.map((tag) => (
                <option key={tag} value={tag}>{normalizeGenre(tag)}</option>
              ))}
            </select>
            <ChevronDown size={12} />
          </label>
        </div>
        <div className="discover-sort" aria-label="Sort Discover results">
          <button
            className={filters.sort === "top" ? "active" : ""}
            onClick={() => chooseSort("top")}
            disabled={query.isPending}
          >
            Best-selling
          </button>
          <button
            className={filters.sort === "new" ? "active" : ""}
            onClick={() => chooseSort("new")}
            disabled={query.isPending}
          >
            New arrivals
          </button>
        </div>
      </div>

      {query.isPending ? (
        <div className="discover-status">
          <LoaderCircle className="spin" size={26} />
          <strong>Scanning Bandcamp…</strong>
          <span>Finding releases with playable previews.</span>
        </div>
      ) : query.isError ? (
        <div className="discover-status">
          <Disc3 size={28} />
          <strong>Discover is taking a break</strong>
          <span>{String(query.error).replace(/^Error:\s*/, "")}</span>
          <button
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
          >
            {query.isFetching
              ? <LoaderCircle className="spin" size={14} />
              : <RefreshCw size={14} />}
            {query.isFetching ? "Trying again…" : "Try again"}
          </button>
        </div>
      ) : releases.length ? (
        <>
          <div className="section-heading">
            <h2>{filters.tag ? `Sounds tagged “${filters.tag}”` : "Across Bandcamp"}</h2>
            <span>{countLabel(total, "result")}</span>
          </div>
          <div className="discover-grid">
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
              />
            ))}
          </div>
          {query.hasNextPage ? (
            <button
              className="load-more"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <><LoaderCircle className="spin" size={15} /> Loading more</>
              ) : (
                "View more discoveries"
              )}
            </button>
          ) : null}
        </>
      ) : (
        <div className="discover-status">
          <Search size={28} />
          <strong>No releases found</strong>
          <span>Try a broader genre or a different tag.</span>
          <button onClick={() => chooseGenre("all")}>Clear tag</button>
        </div>
      )}
    </section>
  );
}
