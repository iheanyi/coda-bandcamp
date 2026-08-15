import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type Key,
  type ReactNode,
  type RefObject,
} from "react";
import {
  initialResponsiveGridScrollMargin,
  initialResponsiveGridWidth,
  readResponsiveGridViewport,
  rememberResponsiveGridMeasurement,
} from "./responsiveGridMeasurement";

// One extra row above and below. Three rows each side mounted ~54 album cards on Back.
export const DEFAULT_GRID_OVERSCAN = 1;
export const DEFAULT_GRID_VIRTUALIZATION_THRESHOLD = 80;

export type ResponsiveGridLayout = {
  columnGap: number;
  maxColumns?: number;
  maxWidth?: number;
  minColumnWidth: number;
  rowGap: number;
  rowHeight: number | ((columnWidth: number) => number);
};

export type ResponsiveGridMetrics = {
  columnGap: number;
  columns: number;
  columnWidth: number;
  rowGap: number;
  rowHeight: number;
};

export type ResponsiveGridItemContext = ResponsiveGridMetrics & {
  column: number;
  index: number;
  row: number;
  virtualized: boolean;
};

export type ResponsiveVirtualGridProps<Item> = {
  "aria-label": string;
  className?: string;
  empty?: ReactNode;
  getItemKey: (item: Item, index: number) => Key;
  items: readonly Item[];
  layouts: readonly ResponsiveGridLayout[];
  onVisibleItems?: (items: readonly Item[]) => void;
  overscan?: number;
  renderItem: (item: Item, context: ResponsiveGridItemContext) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
  style?: CSSProperties;
  virtualizationThreshold?: number;
};

export function firstScreenGridItemCount({
  columns,
  overscan,
  rowGap,
  rowHeight,
  viewportHeight,
}: Readonly<{
  columns: number;
  overscan: number;
  rowGap: number;
  rowHeight: number;
  viewportHeight: number;
}>): number {
  const stride = Math.max(1, rowHeight + rowGap);
  const visibleRows = Math.max(
    1,
    Math.ceil(finiteNonNegative(viewportHeight) / stride),
  );
  return Math.max(1, columns) * (visibleRows + Math.max(0, overscan));
}

export function isOverscanVirtualRow(
  rowIndex: number,
  viewportRange: Readonly<{ endIndex: number; startIndex: number }> | null,
): boolean {
  if (viewportRange === null) return false;
  return (
    rowIndex < viewportRange.startIndex || rowIndex > viewportRange.endIndex
  );
}

function finiteNonNegative(value: number, fallback = 0): number {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function resolveResponsiveGridLayout(
  width: number,
  layouts: readonly ResponsiveGridLayout[],
): ResponsiveGridLayout {
  if (!layouts.length) {
    throw new Error("ResponsiveVirtualGrid requires at least one layout.");
  }
  const safeWidth = finiteNonNegative(width);
  return (
    layouts.find(
      (layout) => layout.maxWidth === undefined || safeWidth <= layout.maxWidth,
    ) ?? layouts[layouts.length - 1]
  );
}

function responsiveGridMetrics(
  width: number,
  layout: ResponsiveGridLayout,
): ResponsiveGridMetrics {
  const safeWidth = finiteNonNegative(width);
  const minColumnWidth = Math.max(
    1,
    finiteNonNegative(layout.minColumnWidth, 1),
  );
  const columnGap = finiteNonNegative(layout.columnGap);
  const rowGap = finiteNonNegative(layout.rowGap);
  const responsiveColumns = Math.max(
    1,
    Math.floor((safeWidth + columnGap) / (minColumnWidth + columnGap)),
  );
  const maxColumns = Math.max(
    1,
    Math.floor(finiteNonNegative(layout.maxColumns ?? responsiveColumns, 1)),
  );
  const columns = Math.min(responsiveColumns, maxColumns);
  const columnWidth = Math.max(
    0,
    (safeWidth - columnGap * (columns - 1)) / columns,
  );
  const configuredRowHeight =
    typeof layout.rowHeight === "function"
      ? layout.rowHeight(columnWidth)
      : layout.rowHeight;
  const rowHeight = Math.max(1, finiteNonNegative(configuredRowHeight, 1));
  return { columnGap, columns, columnWidth, rowGap, rowHeight };
}

function elementWidth(entry: ResizeObserverEntry): number {
  const borderBox = Array.isArray(entry.borderBoxSize)
    ? entry.borderBoxSize[0]
    : entry.borderBoxSize;
  return borderBox?.inlineSize ?? entry.contentRect.width;
}

/**
 * Row-major virtualization for regular responsive card grids.
 *
 * Layouts use first-match container-width breakpoints. Keep them ordered from
 * the narrowest `maxWidth` to an unbounded final layout. The supplied scroll
 * element may contain headers before the grid; the component measures that
 * offset and forwards it to TanStack Virtual as `scrollMargin`.
 */
export function ResponsiveVirtualGrid<Item>({
  "aria-label": ariaLabel,
  className,
  empty = null,
  getItemKey,
  items,
  layouts,
  onVisibleItems,
  overscan = DEFAULT_GRID_OVERSCAN,
  renderItem,
  scrollElementRef,
  style,
  virtualizationThreshold = DEFAULT_GRID_VIRTUALIZATION_THRESHOLD,
}: ResponsiveVirtualGridProps<Item>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(() =>
    initialResponsiveGridWidth(scrollElementRef.current),
  );
  const [scrollMargin, setScrollMargin] = useState(
    initialResponsiveGridScrollMargin,
  );
  const [focusedIndex, setFocusedIndex] = useState<number>();
  const layout = resolveResponsiveGridLayout(containerWidth, layouts);
  const metrics = responsiveGridMetrics(containerWidth, layout);
  const rowCount = Math.ceil(items.length / metrics.columns);
  const virtualized = items.length > Math.max(0, virtualizationThreshold);

  const syncMeasurements = useCallback(
    (width?: number) => {
      const root = rootRef.current;
      if (!root) return;
      const scrollElement = scrollElementRef.current;
      const nextWidth = finiteNonNegative(
        width ?? root.getBoundingClientRect().width,
      );
      setContainerWidth((current) =>
        current === nextWidth ? current : nextWidth,
      );

      if (!scrollElement || scrollElement === root) {
        rememberResponsiveGridMeasurement({
          scrollMargin: 0,
          width: nextWidth,
        });
        setScrollMargin((current) => (current === 0 ? current : 0));
        return;
      }
      const rootBounds = root.getBoundingClientRect();
      const scrollBounds = scrollElement.getBoundingClientRect();
      const nextMargin = Math.max(
        0,
        rootBounds.top - scrollBounds.top + scrollElement.scrollTop,
      );
      rememberResponsiveGridMeasurement({
        scrollMargin: nextMargin,
        width: nextWidth,
      });
      setScrollMargin((current) =>
        current === nextMargin ? current : nextMargin,
      );
    },
    [scrollElementRef],
  );

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    syncMeasurements();
    if (typeof ResizeObserver === "undefined") {
      const resize = () => syncMeasurements();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) syncMeasurements(elementWidth(entry));
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [syncMeasurements]);

  useLayoutEffect(() => {
    syncMeasurements();
  }, [items.length, layouts, syncMeasurements]);

  useEffect(() => {
    if (focusedIndex !== undefined && focusedIndex >= items.length) {
      setFocusedIndex(undefined);
    }
  }, [focusedIndex, items.length]);

  const rowKey = useCallback(
    (rowIndex: number): Key => {
      const itemIndex = rowIndex * metrics.columns;
      const item = items[itemIndex];
      return item === undefined
        ? `${metrics.columns}:${rowIndex}`
        : `${metrics.columns}:${String(getItemKey(item, itemIndex))}`;
    },
    [getItemKey, items, metrics.columns],
  );

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (
        focusedIndex === undefined ||
        focusedIndex < 0 ||
        focusedIndex >= items.length
      ) {
        return indexes;
      }
      const focusedRow = Math.floor(focusedIndex / metrics.columns);
      if (indexes.includes(focusedRow)) return indexes;
      return [...indexes, focusedRow].sort((left, right) => left - right);
    },
    [focusedIndex, items.length, metrics.columns],
  );

  const scrollViewport = readResponsiveGridViewport(scrollElementRef.current);
  const virtualizer = useVirtualizer({
    count: rowCount,
    enabled: virtualized,
    estimateSize: () => metrics.rowHeight,
    gap: metrics.rowGap,
    getItemKey: rowKey,
    getScrollElement: () => scrollElementRef.current,
    initialOffset: () => scrollViewport.offset,
    initialRect: {
      height: scrollViewport.height,
      width: scrollViewport.width,
    },
    overscan,
    rangeExtractor,
    scrollMargin,
  });

  const firstScreenCount = firstScreenGridItemCount({
    columns: metrics.columns,
    overscan,
    rowGap: metrics.rowGap,
    rowHeight: metrics.rowHeight,
    viewportHeight: scrollViewport.height,
  });
  const virtualRowKey = virtualized
    ? virtualizer
        .getVirtualItems()
        .map((row) => row.index)
        .join(",")
    : "";
  const visibleItems = !virtualized
    ? items.slice(0, Math.min(items.length, firstScreenCount))
    : virtualRowKey.length === 0
      ? []
      : virtualRowKey.split(",").flatMap((rawRowIndex) => {
          const rowIndex = Number(rawRowIndex);
          const firstIndex = rowIndex * metrics.columns;
          return items.slice(
            firstIndex,
            Math.min(firstIndex + metrics.columns, items.length),
          );
        });
  const visibleItemKey = visibleItems
    .map((item, index) => String(getItemKey(item, index)))
    .join("\0");
  const visibleItemsRef = useRef(visibleItems);
  visibleItemsRef.current = visibleItems;

  useEffect(() => {
    onVisibleItems?.(visibleItemsRef.current);
  }, [onVisibleItems, visibleItemKey]);

  const renderGridItem = (item: Item, index: number) => {
    const row = Math.floor(index / metrics.columns);
    const key = getItemKey(item, index);
    return (
      <div
        aria-posinset={index + 1}
        aria-setsize={items.length}
        data-grid-index={index}
        data-grid-item-key={String(key)}
        key={key}
        onBlurCapture={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setFocusedIndex((current) =>
              current === index ? undefined : current,
            );
          }
        }}
        onFocusCapture={() => setFocusedIndex(index)}
        role="listitem"
        style={{ minWidth: 0 }}
      >
        {renderItem(item, {
          ...metrics,
          column: index % metrics.columns,
          index,
          row,
          virtualized,
        })}
      </div>
    );
  };

  const commonRootProps = {
    "aria-label": ariaLabel,
    className,
    "data-columns": metrics.columns,
    "data-container-width": containerWidth,
    "data-responsive-virtual-grid": true,
    "data-virtualized": virtualized,
    ref: rootRef,
    role: "list",
  } as const;

  if (!items.length) {
    return (
      <div {...commonRootProps} style={style}>
        {empty}
      </div>
    );
  }

  if (!virtualized) {
    return (
      <div
        {...commonRootProps}
        style={{
          ...style,
          columnGap: metrics.columnGap,
          display: "grid",
          gridTemplateColumns:
            layout.maxColumns === undefined
              ? `repeat(auto-fill, minmax(${layout.minColumnWidth}px, 1fr))`
              : `repeat(${metrics.columns}, minmax(0, 1fr))`,
          rowGap: metrics.rowGap,
        }}
      >
        {items.map(renderGridItem)}
      </div>
    );
  }

  return (
    <div
      {...commonRootProps}
      style={{
        ...style,
        display: "block",
        height: virtualizer.getTotalSize(),
        position: "relative",
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const firstIndex = virtualRow.index * metrics.columns;
        const rowItems = items.slice(
          firstIndex,
          Math.min(firstIndex + metrics.columns, items.length),
        );
        const focusedRow =
          focusedIndex === undefined
            ? undefined
            : Math.floor(focusedIndex / metrics.columns);
        const hideOverscanFromAx =
          focusedRow !== virtualRow.index &&
          isOverscanVirtualRow(virtualRow.index, virtualizer.range);
        return (
          <div
            aria-hidden={hideOverscanFromAx || undefined}
            data-grid-row={virtualRow.index}
            inert={hideOverscanFromAx || undefined}
            key={virtualRow.key}
            role="presentation"
            style={{
              columnGap: metrics.columnGap,
              display: "grid",
              gridTemplateColumns: `repeat(${metrics.columns}, minmax(0, 1fr))`,
              height: metrics.rowHeight,
              left: 0,
              position: "absolute",
              top: 0,
              transform: `translateY(${virtualRow.start - scrollMargin}px)`,
              width: "100%",
            }}
          >
            {rowItems.map((item, column) =>
              renderGridItem(item, firstIndex + column),
            )}
          </div>
        );
      })}
    </div>
  );
}
