import type { ReactNode, RefObject } from "react";
import { ResponsiveVirtualGrid } from "./ResponsiveVirtualGrid";
import type { ArtistGroup } from "./libraryBrowse";

const ARTIST_GRID_LAYOUTS = [
  {
    maxWidth: 700,
    minColumnWidth: 180,
    columnGap: 8,
    rowGap: 8,
    rowHeight: 62,
  },
  {
    minColumnWidth: 235,
    columnGap: 8,
    rowGap: 8,
    rowHeight: 62,
  },
] as const;

const artistGroupKey = (group: ArtistGroup) => group.key;

export default function ArtistVirtualGrid({
  items,
  renderItem,
  scrollElementRef,
}: {
  items: readonly ArtistGroup[];
  renderItem: (group: ArtistGroup) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
}) {
  return (
    <ResponsiveVirtualGrid
      aria-label="Artists"
      className="w-full"
      getItemKey={artistGroupKey}
      items={items}
      layouts={ARTIST_GRID_LAYOUTS}
      renderItem={renderItem}
      scrollElementRef={scrollElementRef}
    />
  );
}
