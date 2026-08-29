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

export type QueueDropInsert = "before" | "after";

export type QueueDropTarget = {
  index: number;
  insert: QueueDropInsert;
};

export type QueueListItemContext = {
  absoluteIndex: number;
  dragging: boolean;
  dropInsert: QueueDropInsert | undefined;
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
  getItemLabel?: (item: Item, absoluteIndex: number) => string;
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

export function queueDropTargetAtOffset(
  offset: number,
  itemCount: number,
  estimatedItemSize: number,
): QueueDropTarget | undefined {
  const index = queueRelativeIndexAtOffset(offset, itemCount, estimatedItemSize);
  if (index === undefined) return undefined;
  const safeSize = Math.max(1, estimatedItemSize);
  return {
    index,
    insert: offset >= itemCount * safeSize ? "after" : "before",
  };
}

export function moveIndexForDropTarget(
  fromIndex: number,
  dropTarget: QueueDropTarget,
): number {
  if (dropTarget.insert === "after") return dropTarget.index;
  return fromIndex < dropTarget.index ? dropTarget.index - 1 : dropTarget.index;
}

function eventDropTarget(
  event: DragEvent<HTMLElement>,
  itemCount: number,
): QueueDropTarget | undefined {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;
  const item = target.closest<HTMLElement>("[data-queue-relative-index]");
  if (!item || !event.currentTarget.contains(item)) return undefined;
  const value = Number(item.dataset.queueRelativeIndex);
  if (!Number.isInteger(value)) return undefined;
  const bounds = item.getBoundingClientRect();
  const insert =
    value === itemCount - 1 &&
    bounds.height > 0 &&
    event.clientY >= bounds.top + bounds.height / 2
      ? "after"
      : "before";
  return { index: value, insert };
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
  getItemLabel,
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
  const dropTargetRef = useRef<QueueDropTarget | undefined>(undefined);
  const [draggedIndex, setDraggedIndex] = useState<number>();
  const [dropTarget, setDropTarget] = useState<QueueDropTarget>();
  const [focusedIndex, setFocusedIndex] = useState<number>();
  const [moveAnnouncement, setMoveAnnouncement] = useState("");
  const virtualized = items.length > Math.max(0, virtualizationThreshold);

  const itemKey = useCallback(
    (index: number): Key => {
      const absoluteIndex = startIndex + index;
      return getItemKey?.(items[index], absoluteIndex) ?? absoluteIndex;
    },
    [estimateSize, getItemKey, items, startIndex],
  );

  const rangeExtractor = useCallback(
    (range: Range) => {
      const indexes = defaultRangeExtractor(range);
      if (
        focusedIndex === undefined ||
        focusedIndex < 0 ||
        focusedIndex >= items.length ||
        indexes.includes(focusedIndex)
      ) {
        return indexes;
      }
      return [...indexes, focusedIndex].sort((left, right) => left - right);
    },
    [focusedIndex, items.length],
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

  const updateDropTarget = useCallback((nextTarget: QueueDropTarget | undefined) => {
    dropTargetRef.current = nextTarget;
    setDropTarget(nextTarget);
  }, []);

  const clearDrag = useCallback(() => {
    draggedIndexRef.current = undefined;
    dropTargetRef.current = undefined;
    setDraggedIndex(undefined);
    setDropTarget(undefined);
  }, []);

  const accessibleItemLabel = useCallback(
    (index: number) => {
      const absoluteIndex = startIndex + index;
      const label = getItemLabel?.(items[index], absoluteIndex).trim();
      return label || `queue item ${index + 1}`;
    },
    [getItemLabel, items, startIndex],
  );

  const commitMove = useCallback(
    (from: number, to: number) => {
      if (
        !onMove ||
        from < 0 ||
        from >= items.length ||
        to < 0 ||
        to >= items.length ||
        from === to
      ) {
        return;
      }
      const label = accessibleItemLabel(from);
      onMove(startIndex + from, startIndex + to);
      setMoveAnnouncement(
        `Moved ${label} to position ${to + 1} of ${items.length}.`,
      );
    },
    [accessibleItemLabel, items.length, onMove, startIndex],
  );

  // A drop target only becomes valid once a dragover is cancelled, and the
  // first dragover waits on a pointer move. Windows renders that gap as a
  // not-allowed cursor flash at drag start, so claim the target and advertise
  // "move" as soon as an active queue drag enters. Drags that did not start
  // in this list (for example OS file drags) are deliberately left unclaimed.
  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (draggedIndexRef.current === undefined) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === undefined) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";

      const scrollElement = scrollRef.current;
      const nextDropTarget = eventDropTarget(event, items.length);
      if (nextDropTarget !== undefined) {
        updateDropTarget(nextDropTarget);
      } else if (scrollElement) {
        const bounds = scrollElement.getBoundingClientRect();
        const offset = scrollElement.scrollTop + event.clientY - bounds.top;
        updateDropTarget(
          queueDropTargetAtOffset(offset, items.length, estimateSize),
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
    [estimateSize, items.length, updateDropTarget, virtualized],
  );

  const handleDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (draggedIndexRef.current === undefined) return;
      event.preventDefault();
      const from = draggedIndexRef.current;
      const to = dropTargetRef.current;
      if (to !== undefined && from !== to.index) {
        commitMove(from, moveIndexForDropTarget(from, to));
      }
      clearDrag();
    },
    [clearDrag, commitMove],
  );

  const renderRow = (
    item: Item,
    index: number,
    key: Key,
    rowStyle?: CSSProperties,
  ) => {
    const absoluteIndex = startIndex + index;
    const isDragging = draggedIndex === index;
    const isDropTarget = dropTarget?.index === index;
    const dropInsert = isDropTarget ? dropTarget.insert : undefined;
    const itemLabel = accessibleItemLabel(index);
    return (
      <div
        aria-posinset={index + 1}
        aria-setsize={items.length}
        data-queue-item-key={String(key)}
        data-queue-relative-index={index}
        data-queue-absolute-index={absoluteIndex}
        data-dragging={isDragging || undefined}
        data-drop-target={isDropTarget || undefined}
        data-insert={dropInsert}
        data-index={index}
        draggable={Boolean(onMove)}
        className="group/queue-row relative"
        key={key}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;
          if (
            !(nextTarget instanceof Node) ||
            !event.currentTarget.contains(nextTarget)
          ) {
            setFocusedIndex((current) => current === index ? undefined : current);
          }
        }}
        onDragEnd={clearDrag}
        onDragStart={(event) => {
          draggedIndexRef.current = index;
          setDraggedIndex(index);
          updateDropTarget({ index, insert: "before" });
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        }}
        onFocusCapture={() => setFocusedIndex(index)}
        role="listitem"
        style={rowStyle}
      >
        {renderItem(item, {
          absoluteIndex,
          dragging: isDragging,
          dropInsert,
          dropTarget: isDropTarget,
          index,
          virtualized,
        })}
        {onMove ? (
          <div
            aria-label={`Reorder ${itemLabel}`}
            className="pointer-events-none absolute top-1/2 right-8 z-10 flex -translate-y-1/2 gap-0.5 rounded-sm border border-white/10 bg-coda-queue p-0.5 opacity-0 shadow-md transition-opacity group-hover/queue-row:pointer-events-auto group-hover/queue-row:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"
            data-queue-reorder-controls=""
            role="group"
          >
            <button
              type="button"
              aria-label={`Move ${itemLabel} up`}
              className="grid size-6 place-items-center rounded-sm border-0 bg-transparent text-xs font-bold text-[#8d918b] outline-none hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-35"
              disabled={index === 0}
              onClick={() => commitMove(index, index - 1)}
              title="Move up"
            >
              <span aria-hidden="true">↑</span>
            </button>
            <button
              type="button"
              aria-label={`Move ${itemLabel} down`}
              className="grid size-6 place-items-center rounded-sm border-0 bg-transparent text-xs font-bold text-[#8d918b] outline-none hover:bg-white/8 hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-default disabled:opacity-35"
              disabled={index === items.length - 1}
              onClick={() => commitMove(index, index + 1)}
              title="Move down"
            >
              <span aria-hidden="true">↓</span>
            </button>
          </div>
        ) : null}
      </div>
    );
  };

  const virtualItems = virtualized ? virtualizer.getVirtualItems() : [];

  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-virtualized={virtualized}
      onDragEnter={handleDragEnter}
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
      {onMove ? (
        <div
          aria-atomic="true"
          aria-live="polite"
          className="sr-only"
          role="status"
        >
          {moveAnnouncement}
        </div>
      ) : null}
    </div>
  );
}
