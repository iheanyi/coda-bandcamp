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

export const DEFAULT_GRID_OVERSCAN = 3;
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
  overscan?: number;
  renderItem: (item: Item, context: ResponsiveGridItemContext) => ReactNode;
  scrollElementRef: RefObject<HTMLElement | null>;
  style?: CSSProperties;
  virtualizationThreshold?: number;
};

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
      (layout) =>
        layout.maxWidth === undefined || safeWidth <= layout.maxWidth,
    ) ?? layouts[layouts.length - 1]
  );
}

function responsiveGridMetrics(
  width: number,
  layout: ResponsiveGridLayout,
): ResponsiveGridMetrics {
  const safeWidth = finiteNonNegative(width);
  const minColumnWidth = Math.max(1, finiteNonNegative(layout.minColumnWidth, 1));
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
    layout.rowHeight instanceof Function
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
  overscan = DEFAULT_GRID_OVERSCAN,
  renderItem,
  scrollElementRef,
  style,
  virtualizationThreshold = DEFAULT_GRID_VIRTUALIZATION_THRESHOLD,
}: ResponsiveVirtualGridProps<Item>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number>();
  const layout = resolveResponsiveGridLayout(containerWidth, layouts);
  const metrics = responsiveGridMetrics(containerWidth, layout);
  const rowCount = Math.ceil(items.length / metrics.columns);
  const virtualized =
    items.length > Math.max(0, virtualizationThreshold);

  const syncMeasurements = useCallback((width?: number) => {
    const root = rootRef.current;
    if (!root) return;
    const scrollElement = scrollElementRef.current;
    const nextWidth = finiteNonNegative(width ?? root.getBoundingClientRect().width);
    setContainerWidth((current) => current === nextWidth ? current : nextWidth);

    if (!scrollElement || scrollElement === root) {
      setScrollMargin((current) => current === 0 ? current : 0);
      return;
    }
    const rootBounds = root.getBoundingClientRect();
    const scrollBounds = scrollElement.getBoundingClientRect();
    const nextMargin = Math.max(
      0,
      rootBounds.top - scrollBounds.top + scrollElement.scrollTop,
    );
    setScrollMargin((current) => current === nextMargin ? current : nextMargin);
  }, [scrollElementRef]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    syncMeasurements();
    if (!globalThis.ResizeObserver) {
      const resize = () => syncMeasurements();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new globalThis.ResizeObserver(([entry]) => {
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
    [getItemKey, items, metrics.columns, metrics.rowHeight],
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

  const virtualizer = useVirtualizer({
    count: rowCount,
    enabled: virtualized,
    estimateSize: () => metrics.rowHeight,
    gap: metrics.rowGap,
    getItemKey: rowKey,
    getScrollElement: () => scrollElementRef.current,
    overscan,
    rangeExtractor,
    scrollMargin,
  });

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
          const nextFocusedNode =
            event.relatedTarget instanceof Node ? event.relatedTarget : null;
          if (!event.currentTarget.contains(nextFocusedNode)) {
            setFocusedIndex((current) => current === index ? undefined : current);
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
        return (
          <div
            data-grid-row={virtualRow.index}
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
