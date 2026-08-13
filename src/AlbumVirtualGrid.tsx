import type { ReactNode, RefObject } from "react";
import { ResponsiveVirtualGrid } from "./ResponsiveVirtualGrid";
import type { Album } from "./types";

const ALBUM_GRID_LAYOUTS = [
  {
    maxWidth: 700,
    minColumnWidth: 110,
    columnGap: 12,
    rowGap: 19,
    rowHeight: (columnWidth: number) => columnWidth + 64,
  },
  {
    maxWidth: 930,
    minColumnWidth: 125,
    columnGap: 16,
    rowGap: 24,
    rowHeight: (columnWidth: number) => columnWidth + 64,
  },
  {
    minColumnWidth: 140,
    columnGap: 16,
    rowGap: 24,
    rowHeight: (columnWidth: number) => columnWidth + 64,
  },
] as const;

const albumKey = (album: Album) => album.id;

export default function AlbumVirtualGrid({
  ariaLabel,
  items,
  renderItem,
  scrollElementRef,
}: {
  ariaLabel: string;
  items: readonly Album[];
  renderItem: (album: Album) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
}) {
  return (
    <ResponsiveVirtualGrid
      aria-label={ariaLabel}
      className="w-full"
      getItemKey={albumKey}
      items={items}
      layouts={ALBUM_GRID_LAYOUTS}
      renderItem={renderItem}
      scrollElementRef={scrollElementRef}
    />
  );
}
