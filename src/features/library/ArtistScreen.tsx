import type { RefObject } from "react";
import { cn } from "@/lib/utils";
import type { ArtistGroup } from "@/libraryBrowse";
import { ArtistHero } from "./ArtistHero";
import type {
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import { LibraryAvailability, ReleaseResults } from "./LibraryResults";
export type ArtistScreenModel = Readonly<{
  availability: LibraryAvailabilityModel;
  artist: Readonly<{
    group?: ArtistGroup;
    loading?: "play" | "shuffle" | "queue";
    active: boolean;
    playing: boolean;
  }>;
  results: ReleaseResultsModel;
}>;

export type ArtistScreenActions = Readonly<{
  availability: LibraryAvailabilityActions;
  artist: Readonly<{
    onBack: () => void;
    onPlay: (group: ArtistGroup) => void;
    onShuffle: (group: ArtistGroup) => void;
    onQueue: (group: ArtistGroup) => void;
    onTogglePlayback: () => void;
  }>;
  releases: ReleaseResultsActions;
}>;

export type ArtistScreenRefs = Readonly<{
  libraryPane: RefObject<HTMLElement | null>;
}>;

export type ArtistScreenProps = {
  model: ArtistScreenModel;
  actions: ArtistScreenActions;
  refs: ArtistScreenRefs;
  className?: string;
};

export function ArtistScreen({
  model,
  actions,
  refs,
  className,
}: ArtistScreenProps) {
  return (
    <section className={cn("pt-6", className)} aria-live="polite">
      <LibraryAvailability
        model={model.availability}
        actions={actions.availability}
      >
        {model.artist.group ? (
          <ArtistHero
            group={model.artist.group}
            loading={model.artist.loading}
            onBack={actions.artist.onBack}
            onPlay={actions.artist.onPlay}
            onShuffle={actions.artist.onShuffle}
            onQueue={actions.artist.onQueue}
            active={model.artist.active}
            playing={model.artist.playing}
            onTogglePlayback={actions.artist.onTogglePlayback}
          />
        ) : null}
        <ReleaseResults
          model={model.results}
          actions={actions.releases}
          scrollElementRef={refs.libraryPane}
        />
      </LibraryAvailability>
    </section>
  );
}
