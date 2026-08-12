import type { RefObject } from "react";
import type {
  ArtistResultsActions,
  ArtistResultsModel,
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import {
  ArtistResults,
  LibraryAvailability,
  ReleaseResults,
} from "./LibraryResults";
import { cn } from "@/lib/utils";

export type CollectionScreenModel = Readonly<{
  availability: LibraryAvailabilityModel;
  content:
    | Readonly<{ kind: "artists"; results: ArtistResultsModel }>
    | Readonly<{ kind: "releases"; results: ReleaseResultsModel }>;
}>;

export type CollectionScreenActions = Readonly<{
  availability: LibraryAvailabilityActions;
  artists: ArtistResultsActions;
  releases: ReleaseResultsActions;
}>;

export type CollectionScreenRefs = Readonly<{
  libraryPane: RefObject<HTMLElement | null>;
}>;

export type CollectionScreenProps = {
  model: CollectionScreenModel;
  actions: CollectionScreenActions;
  refs: CollectionScreenRefs;
  className?: string;
};

export function CollectionScreen({
  model,
  actions,
  refs,
  className,
}: CollectionScreenProps) {
  return (
    <section className={cn("pt-6", className)} aria-live="polite">
      <LibraryAvailability
        model={model.availability}
        actions={actions.availability}
      >
        {model.content.kind === "artists" ? (
          <ArtistResults
            model={model.content.results}
            actions={actions.artists}
            scrollElementRef={refs.libraryPane}
          />
        ) : (
          <ReleaseResults
            model={model.content.results}
            actions={actions.releases}
            scrollElementRef={refs.libraryPane}
          />
        )}
      </LibraryAvailability>
    </section>
  );
}
