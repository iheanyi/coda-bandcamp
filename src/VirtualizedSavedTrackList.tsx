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
  type FocusEventHandler,
  Fragment,
  type Key,
  type ReactNode,
} from "react";

const SAVED_TRACK_ROW_HEIGHT = 56;
export const SAVED_TRACK_VIRTUALIZATION_THRESHOLD = 100;
export const SAVED_TRACK_OVERSCAN = 6;

export type SavedTrackRowContext = {
  index: number;
  virtualized: boolean;
};

export type SavedTrackRowProps = {
  "aria-posinset": number;
  "aria-setsize": number;
  "data-index": number;
  "data-saved-track-index": number;
  onBlurCapture: FocusEventHandler<HTMLDivElement>;
  onFocusCapture: FocusEventHandler<HTMLDivElement>;
  role: "listitem";
  style?: CSSProperties;
};

export type VirtualizedSavedTrackListProps<Item> = {
  "aria-label": string;
  className?: string;
  getItemKey: (item: Item, index: number) => Key;
  getScrollElement?: (root: HTMLElement) => HTMLElement | null;
  items: readonly Item[];
  renderItem: (
    item: Item,
    context: SavedTrackRowContext,
    rowProps: SavedTrackRowProps,
  ) => ReactNode;
  rowHeight?: number;
  virtualizationThreshold?: number;
};

function defaultScrollElement(root: HTMLElement): HTMLElement | null {
  return root.closest<HTMLElement>("[data-coda-library-scroll]") ??
    root.parentElement;
}

/**
 * Virtualizes fixed-height saved-library track rows against Coda's stable
 * data-marked library scroller. Short lists keep their natural DOM flow.
 */
export function VirtualizedSavedTrackList<Item>({
  "aria-label": ariaLabel,
  className,
  getItemKey,
  getScrollElement = defaultScrollElement,
  items,
  renderItem,
  rowHeight = SAVED_TRACK_ROW_HEIGHT,
  virtualizationThreshold = SAVED_TRACK_VIRTUALIZATION_THRESHOLD,
}: VirtualizedSavedTrackListProps<Item>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState<number>();
  const virtualized = items.length > Math.max(0, virtualizationThreshold);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    setScrollElement((current) => {
      const next = getScrollElement(root);
      return current === next ? current : next;
    });
  }, [getScrollElement]);

  const syncScrollMargin = useCallback(() => {
    const root = rootRef.current;
    if (!root || !scrollElement || root === scrollElement) {
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
  }, [scrollElement]);

  useLayoutEffect(() => {
    syncScrollMargin();
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") {
      const resize = () => syncScrollMargin();
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }
    const observer = new ResizeObserver(syncScrollMargin);
    observer.observe(root);
    if (scrollElement) observer.observe(scrollElement);
    return () => observer.disconnect();
  }, [scrollElement, syncScrollMargin]);

  useLayoutEffect(() => {
    syncScrollMargin();
  }, [items.length, syncScrollMargin]);

  useEffect(() => {
    if (focusedIndex !== undefined && focusedIndex >= items.length) {
      setFocusedIndex(undefined);
    }
  }, [focusedIndex, items.length]);

  const itemKey = useCallback(
    (index: number) => getItemKey(items[index], index),
    [getItemKey, items],
  );

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (focusedIndex === undefined || indexes.includes(focusedIndex)) {
        return indexes;
      }
      return [...indexes, focusedIndex].sort((left, right) => left - right);
    },
    [focusedIndex],
  );

  const virtualizer = useVirtualizer({
    count: items.length,
    enabled: virtualized && Boolean(scrollElement),
    estimateSize: () => Math.max(1, rowHeight),
    getItemKey: itemKey,
    getScrollElement: () => scrollElement,
    overscan: SAVED_TRACK_OVERSCAN,
    rangeExtractor,
    scrollMargin,
  });

  const renderRow = (
    item: Item,
    index: number,
    key: Key,
    style?: CSSProperties,
  ) => {
    const rowProps: SavedTrackRowProps = {
      "aria-posinset": index + 1,
      "aria-setsize": items.length,
      "data-index": index,
      "data-saved-track-index": index,
      onBlurCapture: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setFocusedIndex((current) => current === index ? undefined : current);
        }
      },
      onFocusCapture: () => setFocusedIndex(index),
      role: "listitem",
      style,
    };
    return (
      <Fragment key={key}>
        {renderItem(item, { index, virtualized }, rowProps)}
      </Fragment>
    );
  };

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-virtualized={virtualized}
      ref={rootRef}
      role="list"
      style={
        virtualized
          ? {
              height: virtualizer.getTotalSize(),
              position: "relative",
            }
          : undefined
      }
    >
      {virtualized
        ? virtualItems.map((virtualItem) =>
            renderRow(
              items[virtualItem.index],
              virtualItem.index,
              virtualItem.key,
              {
                borderBottom: virtualItem.index === items.length - 1 ? 0 : undefined,
                height: virtualItem.size,
                left: 0,
                position: "absolute",
                top: 0,
                transform: `translateY(${virtualItem.start - scrollMargin}px)`,
                width: "100%",
              },
            ),
          )
        : items.map((item, index) =>
            renderRow(item, index, itemKey(index)),
          )}
      {virtualized ? (
        <span aria-hidden="true" style={{ display: "none" }} />
      ) : null}
    </div>
  );
}
