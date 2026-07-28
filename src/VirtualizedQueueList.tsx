import {
  defaultRangeExtractor,
  useVirtualizer,
  type Range,
} from "@tanstack/react-virtual";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type Key,
  type ReactNode,
} from "react";

export const DEFAULT_QUEUE_ROW_ESTIMATE = 59;
export const DEFAULT_QUEUE_OVERSCAN = 6;
export const DEFAULT_QUEUE_VIRTUALIZATION_THRESHOLD = 100;
const INITIAL_QUEUE_VIEWPORT_HEIGHT = 600;

export type QueueListItemContext = {
  absoluteIndex: number;
  dragging: boolean;
  dropTarget: boolean;
  index: number;
  virtualized: boolean;
};

export type VirtualizedQueueListProps<Item> = {
  "aria-label": string;
  className?: string;
  empty?: ReactNode;
  estimateSize?: number;
  getItemKey?: (item: Item, absoluteIndex: number) => Key;
  items: readonly Item[];
  onMove?: (fromAbsoluteIndex: number, toAbsoluteIndex: number) => void;
  overscan?: number;
  renderItem: (item: Item, context: QueueListItemContext) => ReactNode;
  startIndex?: number;
  style?: CSSProperties;
  tabIndex?: number;
  virtualizationThreshold?: number;
};

export function queueRelativeIndexAtOffset(
  offset: number,
  itemCount: number,
  estimatedItemSize: number,
): number | undefined {
  if (itemCount <= 0 || !Number.isFinite(offset)) return undefined;
  const safeSize = Math.max(1, estimatedItemSize);
  return Math.min(itemCount - 1, Math.max(0, Math.floor(offset / safeSize)));
}

function eventItemIndex(event: DragEvent<HTMLElement>): number | undefined {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const item = target.closest<HTMLElement>("[data-queue-relative-index]");
  if (!item || !event.currentTarget.contains(item)) return undefined;
  const value = Number(item.dataset.queueRelativeIndex);
  return Number.isInteger(value) ? value : undefined;
}

/**
 * A queue-specific virtualization boundary.
 *
 * `getItemKey` should return a stable queue-entry identity when duplicate track
 * IDs are possible. The absolute-index fallback is collision-free for legacy
 * Track arrays, but it intentionally resets row identity after a reorder.
 */
export function VirtualizedQueueList<Item>({
  "aria-label": ariaLabel,
  className,
  empty = null,
  estimateSize = DEFAULT_QUEUE_ROW_ESTIMATE,
  getItemKey,
  items,
  onMove,
  overscan = DEFAULT_QUEUE_OVERSCAN,
  renderItem,
  startIndex = 0,
  style,
  tabIndex = 0,
  virtualizationThreshold = DEFAULT_QUEUE_VIRTUALIZATION_THRESHOLD,
}: VirtualizedQueueListProps<Item>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const draggedIndexRef = useRef<number | undefined>(undefined);
  const dropIndexRef = useRef<number | undefined>(undefined);
  const [draggedIndex, setDraggedIndex] = useState<number>();
  const [dropIndex, setDropIndex] = useState<number>();
  const [focusedIndex, setFocusedIndex] = useState<number>();
  const virtualized = items.length > Math.max(0, virtualizationThreshold);

  const itemKey = useCallback(
    (index: number): Key => {
      const absoluteIndex = startIndex + index;
      return getItemKey?.(items[index], absoluteIndex) ?? absoluteIndex;
    },
    [getItemKey, items, startIndex],
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
    enabled: virtualized,
    estimateSize: () => estimateSize,
    getItemKey: itemKey,
    getScrollElement: () => scrollRef.current,
    initialRect: {
      height: INITIAL_QUEUE_VIEWPORT_HEIGHT,
      width: 0,
    },
    overscan,
    rangeExtractor,
  });

  useEffect(() => {
    if (focusedIndex !== undefined && focusedIndex >= items.length) {
      setFocusedIndex(undefined);
    }
  }, [focusedIndex, items.length]);

  const updateDropIndex = useCallback((nextIndex: number | undefined) => {
    dropIndexRef.current = nextIndex;
    setDropIndex(nextIndex);
  }, []);

  const clearDrag = useCallback(() => {
    draggedIndexRef.current = undefined;
    dropIndexRef.current = undefined;
    setDraggedIndex(undefined);
    setDropIndex(undefined);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === undefined) return;
      event.preventDefault();

      const scrollElement = scrollRef.current;
      const itemIndex = eventItemIndex(event);
      if (itemIndex !== undefined) {
        updateDropIndex(itemIndex);
      } else if (scrollElement) {
        const bounds = scrollElement.getBoundingClientRect();
        const offset = scrollElement.scrollTop + event.clientY - bounds.top;
        updateDropIndex(
          queueRelativeIndexAtOffset(offset, items.length, estimateSize),
        );
      }

      if (!virtualized || !scrollElement) return;
      const bounds = scrollElement.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const edge = Math.min(48, bounds.height * 0.2);
      if (event.clientY < bounds.top + edge) {
        scrollElement.scrollTop = Math.max(0, scrollElement.scrollTop - estimateSize);
      } else if (event.clientY > bounds.bottom - edge) {
        scrollElement.scrollTop += estimateSize;
      }
    },
    [estimateSize, items.length, updateDropIndex, virtualized],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === undefined) return;
      event.preventDefault();
      const from = draggedIndexRef.current;
      const to = dropIndexRef.current;
      if (to !== undefined && from !== to) {
        onMove?.(startIndex + from, startIndex + to);
      }
      clearDrag();
    },
    [clearDrag, onMove, startIndex],
  );

  const renderRow = (
    item: Item,
    index: number,
    key: Key,
    rowStyle?: CSSProperties,
  ) => {
    const absoluteIndex = startIndex + index;
    const isDragging = draggedIndex === index;
    const isDropTarget = dropIndex === index;
    return (
      <div
        aria-posinset={index + 1}
        aria-setsize={items.length}
        data-queue-item-key={String(key)}
        data-queue-relative-index={index}
        data-queue-absolute-index={absoluteIndex}
        data-dragging={isDragging || undefined}
        data-drop-target={isDropTarget || undefined}
        data-index={index}
        draggable={Boolean(onMove)}
        key={key}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusedIndex((current) => current === index ? undefined : current);
          }
        }}
        onDragEnd={clearDrag}
        onDragStart={(event) => {
          draggedIndexRef.current = index;
          setDraggedIndex(index);
          updateDropIndex(index);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        }}
        onFocusCapture={() => setFocusedIndex(index)}
        role="listitem"
        style={rowStyle}
      >
        {renderItem(item, {
          absoluteIndex,
          dragging: isDragging,
          dropTarget: isDropTarget,
          index,
          virtualized,
        })}
      </div>
    );
  };

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-virtualized={virtualized}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      ref={scrollRef}
      role="region"
      style={style}
      tabIndex={tabIndex}
    >
      {items.length ? (
        virtualized ? (
          <div
            className="relative w-full"
            role="list"
            style={{
              height: virtualizer.getTotalSize(),
            }}
          >
            {virtualItems.map((virtualItem) =>
              renderRow(
                items[virtualItem.index],
                virtualItem.index,
                virtualItem.key,
                {
                  left: 0,
                  position: "absolute",
                  top: 0,
                  transform: `translateY(${virtualItem.start}px)`,
                  width: "100%",
                },
              ),
            )}
          </div>
        ) : (
          <div role="list">
            {items.map((item, index) => renderRow(item, index, itemKey(index)))}
          </div>
        )
      ) : empty}
    </div>
  );
}
