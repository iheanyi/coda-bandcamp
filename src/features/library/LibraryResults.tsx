import {
  ChevronRight,
  CircleAlert,
  Library,
  ListPlus,
  Radio,
  RefreshCw,
  Search,
  UsersRound,
} from "lucide-react";
import { lazy, Suspense, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { cn } from "@/lib/utils";
import type { ArtistGroup, LibraryBrowseMode } from "@/libraryBrowse";
import type { Album } from "@/types";
import { AlbumCard } from "./AlbumCard";
import { ArtistCard } from "./ArtistCard";
import type { ArtistNavigationHandler } from "./types";
import { LibraryEmptyState, LibrarySkeleton } from "./LibraryScreenPrimitives";
import type { LibrarySyncState } from "./LibraryScreenChrome";

const AlbumVirtualGrid = lazy(() => import("@/AlbumVirtualGrid"));
const ArtistVirtualGrid = lazy(() => import("@/ArtistVirtualGrid"));

export type LibraryAvailabilityModel = Readonly<{
  connected: boolean;
  releaseCount: number;
  syncState: LibrarySyncState;
  libraryError: string;
  isInitialLoading: boolean;
}>;

export type LibraryAvailabilityActions = Readonly<{
  onSync: () => void;
  onRetryStartup: () => void;
  onConnect: () => void;
}>;

export type LibraryAvailabilityProps = {
  model: LibraryAvailabilityModel;
  actions: LibraryAvailabilityActions;
  children: ReactNode;
};

export function LibraryAvailability({
  model,
  actions,
  children,
}: LibraryAvailabilityProps) {
  if (model.isInitialLoading) return <LibrarySkeleton />;

  if (
    (model.syncState === "error" || model.syncState === "syncing") &&
    Boolean(model.libraryError) &&
    !model.releaseCount
  ) {
    return (
      <LibraryEmptyState
        icon={<CircleAlert size={28} />}
        title="Your collection couldn’t load"
        detail={
          model.libraryError ||
          "Bandcamp could not be reached. Check your connection and try again."
        }
        action={
          <Button
            className="mt-3 text-xs text-[#ed8a71]"
            onClick={model.connected ? actions.onSync : actions.onRetryStartup}
            disabled={model.syncState === "syncing"}
            size="compact"
            variant="text"
          >
            {model.syncState === "syncing" ? (
              <Spinner aria-hidden="true" className="size-3.5" />
            ) : (
              <RefreshCw size={14} />
            )}
            {model.syncState === "syncing"
              ? "Syncing…"
              : model.connected
                ? "Try syncing again"
                : "Try checking again"}
          </Button>
        }
      />
    );
  }

  if (!model.connected) {
    return (
      <LibraryEmptyState
        icon={<Radio size={28} />}
        title="Your collection starts here"
        detail="Connect the separate Subsonic credentials from your Bandcamp fan settings. Your password stays in the system vault."
        action={
          <Button
            className="mt-3 text-xs text-[#ed8a71]"
            onClick={actions.onConnect}
            size="compact"
            variant="text"
          >
            Connect Bandcamp <ChevronRight size={15} />
          </Button>
        }
      />
    );
  }

  if (!model.releaseCount) {
    return (
      <LibraryEmptyState
        icon={<Library size={28} />}
        title="No releases found"
        detail="Bandcamp connected successfully, but its Subsonic library returned no purchases yet."
        action={
          <Button
            className="mt-3 text-xs text-[#ed8a71]"
            onClick={actions.onSync}
            disabled={model.syncState === "syncing"}
            size="compact"
            variant="text"
          >
            {model.syncState === "syncing" ? (
              <Spinner aria-hidden="true" className="size-3.5" />
            ) : (
              <RefreshCw size={14} />
            )}
            {model.syncState === "syncing" ? "Checking…" : "Check again"}
          </Button>
        }
      />
    );
  }

  return children;
}

export type ArtistResultsModel = Readonly<{
  genre: string;
  groups: readonly ArtistGroup[];
  hasActiveFilters: boolean;
}>;

export type ArtistResultsActions = Readonly<{
  onOpen: (group: ArtistGroup, trigger: HTMLElement) => void;
  onClearFilters: () => void;
}>;

export type ArtistResultsProps = {
  model: ArtistResultsModel;
  actions: ArtistResultsActions;
  scrollElementRef: RefObject<HTMLElement | null>;
  className?: string;
};

export function ArtistResults({
  model,
  actions,
  scrollElementRef,
  className,
}: ArtistResultsProps) {
  return (
    <>
      <div
        className={cn("mb-4 flex items-baseline justify-between", className)}
      >
        <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold tracking-tight">
          {model.genre === "All" ? "Artists" : `${model.genre} artists`}
        </h2>
        <span className="text-xs text-[#6f736e]">
          {countLabel(model.groups.length, "artist")}
        </span>
      </div>
      {model.groups.length ? (
        <Suspense fallback={<LibrarySkeleton label="Loading artists" />}>
          <ArtistVirtualGrid
            items={model.groups}
            renderItem={(group) => (
              <ArtistCard group={group} onOpen={actions.onOpen} />
            )}
            scrollElementRef={scrollElementRef}
          />
        </Suspense>
      ) : (
        <LibraryEmptyState
          icon={<UsersRound size={28} />}
          title="No artists match those filters"
          detail="Try another artist name, release title, or genre."
          action={
            model.hasActiveFilters ? (
              <Button
                className="mt-3 text-xs text-[#ed8a71]"
                onClick={actions.onClearFilters}
                size="compact"
                variant="text"
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}

export type ReleaseResultsModel = Readonly<{
  title: string;
  albums: readonly Album[];
  currentAlbumId?: string;
  loadingAlbumId?: string;
  playing: boolean;
  hasSearchQuery: boolean;
  queueProgress?: Readonly<{
    done: number;
    total: number;
  }>;
  browseMode: LibraryBrowseMode;
  hasActiveFilters: boolean;
}>;

export type ReleaseResultsActions = Readonly<{
  onOpen: (album: Album, trigger: HTMLElement) => void;
  onPlay: (album: Album) => void;
  onQueue: (album: Album) => void;
  onArtist: ArtistNavigationHandler;
  onTogglePlayback: () => void;
  onQueueSearchResults: () => void;
  onClearFilters: () => void;
  onVisibleAlbums?: (albums: readonly Album[]) => void;
}>;

export type ReleaseResultsProps = {
  model: ReleaseResultsModel;
  actions: ReleaseResultsActions;
  scrollElementRef: RefObject<HTMLElement | null>;
  className?: string;
};

export function ReleaseResults({
  model,
  actions,
  scrollElementRef,
  className,
}: ReleaseResultsProps) {
  return (
    <>
      <div
        className={cn("mb-4 flex items-baseline justify-between", className)}
      >
        <h2 className="m-0 font-['Segoe_UI_Variable_Display','Segoe_UI',sans-serif] text-base leading-none font-semibold tracking-tight">
          {model.title}
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-[#6f736e]">
            {countLabel(model.albums.length, "release")}
          </span>
          {model.hasSearchQuery && model.albums.length ? (
            <Button
              className="min-h-8 gap-1.5 border-primary/25 bg-accent px-2.5 text-xs text-[#ed9a84] hover:border-primary/40 hover:bg-primary/18 hover:text-[#ffc1b1]"
              onClick={actions.onQueueSearchResults}
              disabled={Boolean(model.queueProgress)}
              size="compact"
            >
              {model.queueProgress ? (
                <>
                  <Spinner aria-hidden="true" className="size-3.5" /> Adding{" "}
                  {model.queueProgress.done}/{model.queueProgress.total}
                </>
              ) : (
                <>
                  <ListPlus size={15} /> Add results to queue
                </>
              )}
            </Button>
          ) : null}
        </div>
      </div>
      {model.albums.length ? (
        <Suspense fallback={<LibrarySkeleton label="Loading releases" />}>
          <AlbumVirtualGrid
            ariaLabel={model.title}
            items={model.albums}
            onVisibleItems={actions.onVisibleAlbums}
            renderItem={(album) => (
              <AlbumCard
                album={album}
                onOpen={actions.onOpen}
                onPlay={actions.onPlay}
                onQueue={actions.onQueue}
                onArtist={actions.onArtist}
                active={model.currentAlbumId === album.id}
                loading={model.loadingAlbumId === album.id}
                playing={model.playing}
                onTogglePlayback={actions.onTogglePlayback}
              />
            )}
            scrollElementRef={scrollElementRef}
          />
        </Suspense>
      ) : (
        <LibraryEmptyState
          icon={<Search size={28} />}
          title="Nothing matches those filters"
          detail={
            model.browseMode === "singles"
              ? "No one-track purchases match. Try another artist, title, or genre."
              : model.browseMode === "albums"
                ? "No multi-track purchases match. Try another artist, title, or genre."
                : "Try a different artist, release title, or genre."
          }
          action={
            model.hasActiveFilters ? (
              <Button
                className="mt-3 text-xs text-[#ed8a71]"
                onClick={actions.onClearFilters}
                size="compact"
                variant="text"
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}
    </>
  );
}
