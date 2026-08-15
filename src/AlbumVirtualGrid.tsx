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

export default function AlbumVirtualGrid({
  ariaLabel,
  items,
  onVisibleItems,
  renderItem,
  scrollElementRef,
}: {
  ariaLabel: string;
  items: readonly Album[];
  onVisibleItems?: (albums: readonly Album[]) => void;
  renderItem: (album: Album) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
}) {
  return (
    <ResponsiveVirtualGrid
      aria-label={ariaLabel}
      className="w-full"
      getItemKey={(album) => album.id}
      items={items}
      layouts={ALBUM_GRID_LAYOUTS}
      onVisibleItems={onVisibleItems}
      renderItem={renderItem}
      scrollElementRef={scrollElementRef}
    />
  );
}
