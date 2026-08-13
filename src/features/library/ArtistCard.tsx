import { ChevronRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { countLabel } from "@/countLabel";
import { CoverArt } from "@/features/artwork/CoverArt";
import { cn } from "@/lib/utils";
import type { ArtistGroup } from "@/libraryBrowse";
import { handleCodaLinkActivation } from "@/routing/linkActivation";
import {
  parseArtistKeyParam,
  validateCollectionSearch,
} from "@/routing/routeContracts";

export type ArtistCardProps = {
  group: ArtistGroup;
  onOpen: (group: ArtistGroup, trigger: HTMLElement) => void;
  className?: string;
};

export const ArtistCard = memo(function ArtistCard({
  group,
  onOpen,
  className,
}: ArtistCardProps) {
  const artistKey = parseArtistKeyParam(group.key);
  return (
    <Link
      aria-label={`Browse ${group.name}`}
      className={cn(
        "group grid w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border bg-[#171a1c] p-2 text-left text-inherit outline-none hover:border-(--line-strong) hover:bg-popover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
      data-artist-open={group.key}
      data-coda-artist-card=""
      onClick={(event) =>
        handleCodaLinkActivation(event, (trigger) => onOpen(group, trigger))
      }
      params={{ artistKey }}
      search={(previous) => ({
        ...validateCollectionSearch(previous),
        mode: "artists",
      })}
      to="/collection/artists/$artistKey"
    >
      <CoverArt album={group.representative} size="small" />
      <span className="flex min-w-0 flex-col gap-1">
        <strong className="min-w-0 text-xs font-bold text-[#e8e6df]">
          <span
            className="inline-block max-w-full truncate align-top"
            data-coda-artist-name-target={group.key}
          >
            {group.name}
          </span>
        </strong>
        <span className="truncate text-xs font-normal text-coda-subtle-foreground">
          {countLabel(group.releaseCount, "release")}
          {" · "}
          {countLabel(group.trackCount, "track")}
        </span>
      </span>
      <ChevronRight
        className="text-[#686c67] group-hover:text-[#d88974]"
        size={17}
      />
    </Link>
  );
});
