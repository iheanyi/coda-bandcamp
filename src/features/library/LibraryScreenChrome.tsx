import {
  ArrowDownUp,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Dices,
  Images,
  Radio,
  RefreshCw,
  Search,
  Shuffle,
} from "lucide-react";
import { useId, type CSSProperties, type RefObject } from "react";
import { LayoutGroup } from "motion/react";
import * as m from "motion/react-m";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { genreKey } from "@/genres";
import { cn } from "@/lib/utils";
import type { LibraryBrowseMode } from "@/libraryBrowse";
import { useDistanceAwareSelectionPill } from "@/selectionMotion";
import type { SortMode } from "@/types";

export type LibrarySyncState = "checking" | "idle" | "syncing" | "error";

export type LibraryChromeModel = Readonly<{
  kind: "collection" | "recent";
  connected: boolean;
  releaseCount: number;
  syncState: LibrarySyncState;
  libraryError: string;
  query: string;
  surprise: Readonly<{
    available: boolean;
    scopeName: string;
    loading: boolean;
    disabled: boolean;
  }>;
  shuffle: Readonly<{
    available: boolean;
    label: string;
    scopeName: string;
    progress?: Readonly<{
      done: number;
      total: number;
    }>;
    disabled: boolean;
  }>;
  artwork: Readonly<{
    refreshing: boolean;
    disabled: boolean;
  }>;
}>;

export type LibraryChromeActions = Readonly<{
  onQueryChange: (query: string) => void;
  onSurprise: () => void;
  onShuffle: () => void;
  onRefreshArtwork: () => void;
  onSync: () => void;
  onConnect: () => void;
}>;

export type LibraryBrowseModel = Readonly<{
  mode: LibraryBrowseMode;
  releaseCount: number;
  counts: Readonly<{
    artists: number;
    albums: number;
    singles: number;
  }>;
}>;

export type LibraryBrowseActions = Readonly<{
  onChooseMode: (mode: LibraryBrowseMode) => void;
}>;

export type LibraryFilterModel = Readonly<{
  kind: "collection" | "recent";
  genre: string;
  genres: readonly string[];
  edges: Readonly<{
    start: boolean;
    end: boolean;
  }>;
  trailingControl: "recent" | "artists" | "sort";
  sort: SortMode;
}>;

export type LibraryFilterActions = Readonly<{
  onGenreChange: (genre: string) => void;
  onGenreRailScroll: (rail: HTMLElement) => void;
  onScrollGenres: (direction: -1 | 1) => void;
  onSortChange: (sort: SortMode) => void;
}>;

export type LibraryScreenRefs = Readonly<{
  search: RefObject<HTMLInputElement | null>;
  genreRail: RefObject<HTMLElement | null>;
}>;

export type LibraryScreenChromeProps = {
  model: LibraryChromeModel;
  actions: LibraryChromeActions;
  refs: LibraryScreenRefs;
  browse?: Readonly<{
    model: LibraryBrowseModel;
    actions: LibraryBrowseActions;
  }>;
  filter?: Readonly<{
    model: LibraryFilterModel;
    actions: LibraryFilterActions;
  }>;
  className?: string;
};

const LIBRARY_BROWSE_OPTIONS: ReadonlyArray<{
  mode: LibraryBrowseMode;
  label: string;
  title: string;
}> = [
  { mode: "releases", label: "All releases", title: "Browse every purchase" },
  { mode: "artists", label: "Artists", title: "Group purchases by artist" },
  { mode: "albums", label: "Albums & EPs", title: "Multi-track purchases" },
  { mode: "singles", label: "Singles", title: "One-track purchases" },
];

const COLLECTION_BROWSE_INDICATOR_STYLE = {
  borderRadius: "var(--radius-sm)",
  boxShadow: "0 1px 4px rgba(0, 0, 0, 0.22)",
} satisfies CSSProperties;

const COLLECTION_SORT_OPTIONS: ReadonlyArray<{
  value: SortMode;
  label: string;
}> = [
  { value: "recent", label: "Recently added" },
  { value: "artist", label: "Artist A–Z" },
  { value: "title", label: "Album A–Z" },
  { value: "year", label: "Release date" },
];

export function LibraryScreenChrome({
  model,
  actions,
  refs,
  browse,
  filter,
  className,
}: LibraryScreenChromeProps) {
  const browseLayoutGroupId = `collection-browse-${useId()}`;
  const browseIndicatorLayoutId = `${browseLayoutGroupId}-selected`;
  const genreLayoutGroupId = `collection-genres-${useId()}`;
  const genreIndicatorLayoutId = `${genreLayoutGroupId}-selected`;
  const browseSelectedIndex = browse
    ? Math.max(
        0,
        LIBRARY_BROWSE_OPTIONS.findIndex(
          ({ mode }) => mode === browse.model.mode,
        ),
      )
    : 0;
  const browseIndicatorMotion =
    useDistanceAwareSelectionPill(browseSelectedIndex);
  const genreOptions = filter ? ["All", ...filter.model.genres] : ["All"];
  const genreSelectedIndex = Math.max(
    0,
    genreOptions.findIndex(
      (genre) => genreKey(genre) === genreKey(filter?.model.genre ?? "All"),
    ),
  );
  const genreIndicatorMotion =
    useDistanceAwareSelectionPill(genreSelectedIndex);

  return (
    <>
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 lg:gap-6",
          className,
        )}
      >
        <div>
          <span className="mb-2.5 text-xs font-bold tracking-widest text-[#777b76] uppercase">
            {model.connected ? "Your Bandcamp" : "Your music"}
          </span>
          <h1 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-3xl leading-none font-semibold tracking-tighter text-foreground lg:text-4xl">
            {model.kind === "collection" ? "Collection" : "Recently added"}
          </h1>
          <p className="mt-2 mb-0 text-sm text-muted-foreground">
            {model.syncState === "checking"
              ? "Checking your saved connection…"
              : model.connected
                ? `${countLabel(model.releaseCount, "release")}, ready when you are.`
                : "Connect your Bandcamp library to start listening."}
          </p>
        </div>
        <div className="mt-3 flex w-full flex-wrap justify-end gap-2 lg:w-auto">
          {model.connected ? (
            <label className="flex h-10 w-full flex-[1_1_100%] items-center rounded-md border border-(--line-strong) bg-coda-field px-2.5 text-[#737772] focus-within:border-primary/55 focus-within:ring-3 focus-within:ring-primary/8 lg:w-[clamp(12.5rem,22vw,18.75rem)] lg:flex-none">
              <Search size={17} />
              <span className="sr-only">Search collection</span>
              <Input
                className="h-full flex-1 border-0 bg-transparent px-2 focus-visible:border-0 focus-visible:ring-0"
                ref={refs.search}
                value={model.query}
                onChange={(event) => actions.onQueryChange(event.target.value)}
                placeholder="Search your collection"
              />
              <kbd className="grid size-5 place-items-center rounded-sm border border-(--line-strong) font-['Segoe_UI_Variable','Segoe_UI',sans-serif] text-xs leading-none text-[#777a76]">
                /
              </kbd>
            </label>
          ) : null}
          {model.connected && model.surprise.available ? (
            <Button
              onClick={actions.onSurprise}
              disabled={model.surprise.disabled}
              title={`Play a random track or complete album from ${model.surprise.scopeName}`}
              aria-label={`Surprise me from ${model.surprise.scopeName}`}
              variant="artwork"
            >
              {model.surprise.loading ? (
                <Spinner aria-hidden="true" className="size-4" />
              ) : (
                <Dices size={15} />
              )}
              {model.surprise.loading ? "Picking…" : "Surprise me"}
            </Button>
          ) : null}
          {model.connected && model.shuffle.available ? (
            <Button
              onClick={actions.onShuffle}
              disabled={model.shuffle.disabled}
              title={`${model.shuffle.label} and start playing from ${model.shuffle.scopeName}`}
              aria-label={model.shuffle.label}
              variant="artwork"
            >
              {model.shuffle.progress ? (
                <Spinner aria-hidden="true" className="size-4" />
              ) : (
                <Shuffle size={15} />
              )}
              {model.shuffle.progress
                ? `${model.shuffle.progress.done}/${model.shuffle.progress.total}`
                : model.shuffle.label}
            </Button>
          ) : null}
          {model.connected ? (
            <Button
              onClick={actions.onRefreshArtwork}
              disabled={model.artwork.disabled}
              title="Retry artwork and recover missing covers"
              variant="artwork"
            >
              {model.artwork.refreshing ? (
                <Spinner aria-hidden="true" className="size-4" />
              ) : (
                <Images size={15} />
              )}
              {model.artwork.refreshing ? "Refreshing…" : "Artwork"}
            </Button>
          ) : null}
          <Button
            onClick={model.connected ? actions.onSync : actions.onConnect}
            disabled={
              model.syncState === "checking" || model.syncState === "syncing"
            }
            variant="primary"
          >
            {model.syncState === "checking" || model.syncState === "syncing" ? (
              <Spinner aria-hidden="true" className="size-4 text-current" />
            ) : model.connected ? (
              <RefreshCw size={16} />
            ) : (
              <Radio size={16} />
            )}
            {model.syncState === "checking"
              ? "Checking…"
              : model.syncState === "syncing"
                ? "Syncing…"
                : model.connected
                  ? "Sync"
                  : "Connect"}
          </Button>
        </div>
      </header>

      {model.connected &&
      (model.syncState === "error" || model.syncState === "syncing") &&
      Boolean(model.libraryError) &&
      model.releaseCount ? (
        <section
          className="mt-6 grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-primary/20 bg-primary/6.5 px-3.5 py-3"
          role="status"
        >
          <div className="grid size-9 place-items-center rounded-full bg-accent text-[#e68268]">
            <CircleAlert size={18} />
          </div>
          <div className="flex flex-col gap-0.5">
            <strong className="text-xs text-[#e8e5df]">
              Showing your saved collection
            </strong>
            <span className="text-xs text-muted-foreground">
              {model.libraryError ||
                "Bandcamp could not be reached. Your cached library is still available."}
            </span>
          </div>
          <Button
            className="gap-1 px-2 text-xs text-[#ed8a71]"
            onClick={actions.onSync}
            disabled={model.syncState === "syncing"}
            size="compact"
            variant="text"
          >
            {model.syncState === "syncing" ? (
              <Spinner aria-hidden="true" className="size-4" />
            ) : (
              <ChevronRight size={16} />
            )}
            {model.syncState === "syncing" ? "Syncing…" : "Try again"}
          </Button>
        </section>
      ) : null}

      {browse && model.connected && model.releaseCount ? (
        <LayoutGroup id={browseLayoutGroupId}>
          <nav
            className="mt-7 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg border border-border bg-[#171a1c] p-1 scrollbar-none [&::-webkit-scrollbar]:hidden"
            aria-label="Browse collection"
          >
            {LIBRARY_BROWSE_OPTIONS.map(({ mode, label, title }) => {
              const selected = browse.model.mode === mode;
              const count =
                mode === "releases"
                  ? browse.model.releaseCount
                  : mode === "artists"
                    ? browse.model.counts.artists
                    : browse.model.counts[mode];
              return (
                <Button
                  key={mode}
                  className="group relative isolate min-h-8 gap-2 px-2.5 text-xs text-[#858984] transition-colors duration-150 ease-out hover:bg-transparent hover:text-[#deddd7] aria-pressed:text-[#f0eee8]"
                  onClick={() => browse.actions.onChooseMode(mode)}
                  aria-pressed={selected}
                  size="compact"
                  title={title}
                  variant="ghost"
                >
                  {selected ? (
                    <m.div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 z-0 bg-[#2a2d2f]"
                      data-collection-browse-indicator=""
                      data-selection-travel-steps={
                        browseIndicatorMotion.travelSteps
                      }
                      layoutId={browseIndicatorLayoutId}
                      style={COLLECTION_BROWSE_INDICATOR_STYLE}
                      transition={browseIndicatorMotion.transition}
                    />
                  ) : null}
                  <span className="relative z-10 transition-colors duration-150 ease-out">
                    {label}
                  </span>
                  <Badge
                    className="relative z-10 border-0 bg-white/5.5 text-[#737771] transition-colors duration-150 ease-out group-aria-pressed:bg-accent group-aria-pressed:text-[#e78d76]"
                    size="compact"
                    variant="secondary"
                  >
                    {count}
                  </Badge>
                </Button>
              );
            })}
          </nav>
        </LayoutGroup>
      ) : null}

      {filter && model.connected && model.releaseCount ? (
        <section
          className={cn(
            "flex items-center gap-2 border-b border-border pb-3 lg:gap-4",
            filter.model.kind === "collection" ? "mt-3" : "mt-7",
          )}
        >
          <div className="relative min-w-0 flex-1">
            <LayoutGroup id={genreLayoutGroupId}>
              <nav
                ref={refs.genreRail}
                aria-label="Filter collection by genre"
                className="flex items-center gap-1 overflow-x-auto overscroll-x-contain pr-10 scroll-px-10 scrollbar-none [&::-webkit-scrollbar]:hidden"
                onScroll={(event) =>
                  filter.actions.onGenreRailScroll(event.currentTarget)
                }
              >
                {genreOptions.map((item) => {
                  const selected =
                    genreKey(filter.model.genre) === genreKey(item);

                  return (
                    <Button
                      key={item}
                      className="relative isolate h-8 shrink-0 overflow-hidden px-3 text-xs font-semibold text-[#888b86] transition-colors duration-150 ease-out hover:bg-transparent hover:text-[#dddcd7] aria-pressed:text-[#f0eee8]"
                      onClick={() => filter.actions.onGenreChange(item)}
                      aria-pressed={selected}
                      size="compact"
                      variant="ghost"
                    >
                      {selected ? (
                        <m.div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 z-0 bg-coda-active"
                          data-collection-genre-indicator=""
                          data-selection-travel-steps={
                            genreIndicatorMotion.travelSteps
                          }
                          layoutId={genreIndicatorLayoutId}
                          style={COLLECTION_BROWSE_INDICATOR_STYLE}
                          transition={genreIndicatorMotion.transition}
                        />
                      ) : null}
                      <span className="relative z-10 transition-colors duration-150 ease-out">
                        {item}
                      </span>
                    </Button>
                  );
                })}
              </nav>
            </LayoutGroup>
            {filter.model.edges.start ? (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-linear-to-r from-background to-transparent"
                />
                <Button
                  type="button"
                  aria-label="Show previous genres"
                  className="absolute top-1/2 left-0 z-10 -translate-y-1/2 rounded-full border-border bg-[#1b1e20] text-[#9a9d98] shadow-md hover:bg-[#26292b] hover:text-[#efede7]"
                  onClick={() => filter.actions.onScrollGenres(-1)}
                  size="icon-compact"
                  variant="secondary"
                >
                  <ChevronLeft aria-hidden="true" className="size-3.5" />
                </Button>
              </>
            ) : null}
            {filter.model.edges.end ? (
              <>
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-12 bg-linear-to-l from-background to-transparent"
                />
                <Button
                  type="button"
                  aria-label="Show more genres"
                  className="absolute top-1/2 right-0 z-10 -translate-y-1/2 rounded-full border-border bg-[#1b1e20] text-[#9a9d98] shadow-md hover:bg-[#26292b] hover:text-[#efede7]"
                  onClick={() => filter.actions.onScrollGenres(1)}
                  size="icon-compact"
                  variant="secondary"
                >
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </Button>
              </>
            ) : null}
          </div>
          {filter.model.trailingControl === "recent" ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#777b76]">
              <ArrowDownUp size={14} /> Newest first
            </span>
          ) : filter.model.trailingControl === "artists" ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-[#777b76] [&>svg]:max-lg:hidden">
              <ArrowDownUp size={14} /> Artist A–Z
            </span>
          ) : (
            <Select
              items={COLLECTION_SORT_OPTIONS}
              value={filter.model.sort}
              onValueChange={(value) => {
                if (value) filter.actions.onSortChange(value);
              }}
            >
              <SelectTrigger
                aria-label="Sort collection"
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
                {COLLECTION_SORT_OPTIONS.map(({ value, label }) => (
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
          )}
        </section>
      ) : null}
    </>
  );
}
