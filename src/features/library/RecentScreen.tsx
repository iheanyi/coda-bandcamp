import type { RefObject } from "react";
import type {
  LibraryAvailabilityActions,
  LibraryAvailabilityModel,
  ReleaseResultsActions,
  ReleaseResultsModel,
} from "./LibraryResults";
import { LibraryAvailability, ReleaseResults } from "./LibraryResults";
import { cn } from "@/lib/utils";

export type RecentScreenModel = Readonly<{
  availability: LibraryAvailabilityModel;
  results: ReleaseResultsModel;
}>;

export type RecentScreenActions = Readonly<{
  availability: LibraryAvailabilityActions;
  releases: ReleaseResultsActions;
}>;

export type RecentScreenRefs = Readonly<{
  libraryPane: RefObject<HTMLElement | null>;
}>;

export type RecentScreenProps = {
  model: RecentScreenModel;
  actions: RecentScreenActions;
  refs: RecentScreenRefs;
  className?: string;
};

export function RecentScreen({
  model,
  actions,
  refs,
  className,
}: RecentScreenProps) {
  return (
    <section className={cn("pt-6", className)} aria-live="polite">
      <LibraryAvailability
        model={model.availability}
        actions={actions.availability}
      >
        <ReleaseResults
          model={model.results}
          actions={actions.releases}
          scrollElementRef={refs.libraryPane}
        />
      </LibraryAvailability>
    </section>
  );
}
