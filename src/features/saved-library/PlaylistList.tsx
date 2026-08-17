import { ListMusic, Plus } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  type FormEvent,
  useCallback,
  useRef,
  useState,
} from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OverflowMarquee } from "@/components/ui/overflow-marquee";
import { Spinner } from "@/components/ui/spinner";
import { countLabel } from "@/countLabel";
import { formatTime } from "@/lib";
import { cn } from "@/lib/utils";
import { ResponsiveVirtualGrid } from "@/ResponsiveVirtualGrid";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import { type PlaylistId } from "@/routing/routeContracts";
import type { PlaylistSummary } from "@/types";

import { isOptimisticPlaylist } from "./playlistCache";
import { Eyebrow, SavedEmpty } from "./SavedLibraryPresentation";

const PLAYLIST_GRID_LAYOUTS = [
  {
    minColumnWidth: 272,
    columnGap: 12,
    rowGap: 12,
    rowHeight: 84,
  },
] as const;

const playlistSummaryKey = (playlist: PlaylistSummary) => playlist.id;

export function PlaylistList({
  playlists,
  onOpen,
  onCreate,
  creating,
  openingPlaylistId,
}: {
  playlists: PlaylistSummary[];
  onOpen: (playlist: PlaylistSummary, trigger: HTMLAnchorElement) => void;
  onCreate: (name: string) => void;
  creating: boolean;
  openingPlaylistId?: string;
}) {
  const [name, setName] = useState("");
  const scrollElementRef = useRef<HTMLElement | null>(null);
  const setPlaylistListRoot = useCallback((element: HTMLDivElement | null) => {
    scrollElementRef.current =
      element?.closest<HTMLElement>("[data-coda-library-scroll]") ??
      element?.parentElement ??
      null;
  }, []);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName) return;
    onCreate(nextName);
    setName("");
  };

  return (
    <div ref={setPlaylistListRoot}>
      <form
        className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 rounded-lg border border-border bg-[linear-gradient(110deg,rgba(221,101,73,0.075),transparent_46%),var(--panel)] p-5 lg:grid-cols-[minmax(14rem,1fr)_minmax(13rem,0.9fr)_auto]"
        onSubmit={submit}
      >
        <div className="col-span-full flex flex-col items-start lg:col-span-1">
          <Eyebrow className="mb-1">New playlist</Eyebrow>
          <strong className="text-sm text-[#deddd7]">Create a playlist</strong>
          <p className="mt-1 mb-0 text-xs text-coda-subtle-foreground">
            Playlists sync with your Bandcamp collection.
          </p>
        </div>
        <Label className="block">
          <span className="sr-only">Playlist name</span>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={256}
            placeholder="Late-night rotation"
          />
        </Label>
        <Button
          type="submit"
          disabled={!name.trim() || creating}
          variant="primary"
        >
          {creating ? (
            <Spinner aria-hidden="true" className="size-4 text-current" />
          ) : (
            <Plus size={16} />
          )}
          {creating ? "Creating…" : "Create"}
        </Button>
      </form>

      {playlists.length ? (
        <ResponsiveVirtualGrid
          aria-label="Playlists"
          className="w-full"
          getItemKey={playlistSummaryKey}
          items={playlists}
          layouts={PLAYLIST_GRID_LAYOUTS}
          scrollElementRef={scrollElementRef}
          renderItem={(playlist) => {
            const optimistic = isOptimisticPlaylist(playlist);
            const opening = openingPlaylistId === playlist.id;
            // SAFETY: playlist ids are validated at parseNativePlaylistSummary.
            const playlistId = playlist.id as PlaylistId;
            return (
              <Link
                aria-busy={optimistic || opening || undefined}
                aria-disabled={optimistic || opening || undefined}
                className={cn(
                  buttonVariants(),
                  "grid h-full w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border-border bg-white/2 p-3.5 text-left font-normal transition-[border-color,background-color,transform] duration-(--duration-coda-fast) hover:-translate-y-px hover:border-input hover:bg-white/3.5 aria-disabled:cursor-default aria-disabled:opacity-[0.38]",
                )}
                data-playlist-open={playlist.id}
                onClick={(event) => {
                  if (optimistic || opening) {
                    event.preventDefault();
                    return;
                  }
                  handleCodaLinkActivation(event, (trigger) =>
                    onOpen(playlist, trigger),
                  );
                }}
                params={{ playlistId }}
                preload={optimistic || opening ? false : undefined}
                tabIndex={optimistic ? -1 : undefined}
                to="/playlists/$playlistId"
              >
                <span className="grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1">
                  <span
                    className="row-span-3 grid size-13 place-items-center rounded-lg border border-white/7 bg-coda-hover text-[#e1846d]"
                    data-playlist-identity={playlist.id}
                  >
                    <ListMusic size={25} />
                  </span>
                  <span className="min-w-0" data-playlist-title={playlist.id}>
                    <OverflowMarquee
                      className="text-xs text-[#dcdbd5]"
                      text={playlist.name}
                    />
                  </span>
                  <span className="col-start-2 truncate text-xs text-coda-subtle-foreground">
                    {countLabel(playlist.songCount, "track")}
                    {playlist.duration
                      ? ` · ${formatTime(playlist.duration)}`
                      : ""}
                  </span>
                  {playlist.comment ? (
                    <small className="col-start-2 truncate text-xs text-coda-subtle-foreground">
                      {playlist.comment}
                    </small>
                  ) : null}
                </span>
                <span className="flex items-center gap-1 text-xs font-bold text-[#787c77] uppercase">
                  {opening ? (
                    <Spinner
                      aria-label={`Opening ${playlist.name}`}
                      className="size-3 text-current"
                    />
                  ) : null}
                  {optimistic ? "Creating…" : opening ? "Opening…" : "Open"}
                </span>
              </Link>
            );
          }}
        />
      ) : (
        <SavedEmpty
          icon={<ListMusic size={28} />}
          title="No playlists yet"
          detail="Name your first mix above, then add tracks from an album, Favorites, or Now Playing."
        />
      )}
    </div>
  );
}
