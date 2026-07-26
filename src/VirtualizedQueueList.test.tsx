import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VirtualizedQueueList,
  queueRelativeIndexAtOffset,
} from "./VirtualizedQueueList";

type QueueItem = {
  entryId: string;
  title: string;
  trackId: string;
};

const VIEWPORT_WIDTH = 320;
const VIEWPORT_HEIGHT = 180;
const ROW_HEIGHT = 50;

type ResizeCallback = ResizeObserverCallback;

class ResizeObserverMock implements ResizeObserver {
  static callbacks: ResizeCallback[] = [];
  static observed = new WeakSet<Element>();

  constructor(callback: ResizeCallback) {
    ResizeObserverMock.callbacks.push(callback);
  }

  disconnect() {}
  observe(target: Element) {
    if (ResizeObserverMock.observed.has(target)) return;
    ResizeObserverMock.observed.add(target);
    const bounds = target.getBoundingClientRect();
    const size = {
      blockSize: bounds.height,
      inlineSize: bounds.width,
    };
    const entry = {
      borderBoxSize: [size],
      contentBoxSize: [size],
      contentRect: bounds,
      devicePixelContentBoxSize: [size],
      target,
    } as unknown as ResizeObserverEntry;
    ResizeObserverMock.callbacks.at(-1)?.([entry], this);
  }
  unobserve() {}
}

const item = (index: number, trackId = `track-${index}`): QueueItem => ({
  entryId: `queue-entry-${index}`,
  title: `Queue track ${index}`,
  trackId,
});

function Queue({
  items,
  onMove,
  startIndex = 0,
  threshold = 3,
}: {
  items: QueueItem[];
  onMove?: (from: number, to: number) => void;
  startIndex?: number;
  threshold?: number;
}) {
  return (
    <VirtualizedQueueList
      aria-label="Upcoming tracks"
      estimateSize={ROW_HEIGHT}
      getItemKey={(queueItem) => queueItem.entryId}
      items={items}
      onMove={onMove}
      renderItem={(queueItem, context) => (
        <button type="button">
          {queueItem.title} at {context.absoluteIndex}
        </button>
      )}
      startIndex={startIndex}
      style={{ height: VIEWPORT_HEIGHT, overflowY: "auto" }}
      virtualizationThreshold={threshold}
    />
  );
}

describe("VirtualizedQueueList", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    ResizeObserverMock.callbacks = [];
    ResizeObserverMock.observed = new WeakSet<Element>();
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const height = this.dataset.queueRelativeIndex === undefined
        ? VIEWPORT_HEIGHT
        : ROW_HEIGHT;
      return {
        bottom: height,
        height,
        left: 0,
        right: VIEWPORT_WIDTH,
        top: 0,
        width: VIEWPORT_WIDTH,
        x: 0,
        y: 0,
        toJSON: () => undefined,
      };
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("renders small queues in normal document flow and keeps duplicate track IDs distinct", () => {
    render(<Queue items={[item(0, "duplicate"), item(1, "duplicate"), item(2)]} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    expect(region).toHaveAttribute("data-virtualized", "false");
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
    expect(region.querySelector('[data-queue-item-key="queue-entry-0"]')).not.toBeNull();
    expect(region.querySelector('[data-queue-item-key="queue-entry-1"]')).not.toBeNull();
    expect(screen.getByText("Queue track 0 at 0")).toBeInTheDocument();
    expect(screen.getByText("Queue track 1 at 1")).toBeInTheDocument();
  });

  it("keeps a large queue bounded and renders later items after scrolling", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => item(index));
    render(<Queue items={items} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    await waitFor(() => {
      const rendered = within(region).getAllByRole("listitem");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(30);
    });
    expect(region).toHaveAttribute("data-virtualized", "true");
    expect(screen.queryByText("Queue track 999 at 999")).not.toBeInTheDocument();

    region.scrollTop = (items.length - 1) * ROW_HEIGHT;
    fireEvent.scroll(region);

    expect(await screen.findByText("Queue track 999 at 999")).toBeInTheDocument();
    expect(within(region).getAllByRole("listitem").length).toBeLessThan(30);
  });

  it("pins the focused row while a large queue scrolls away from it", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => item(index));
    render(<Queue items={items} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    const first = await screen.findByRole("button", { name: "Queue track 0 at 0" });
    first.focus();
    expect(first).toHaveFocus();

    region.scrollTop = (items.length - 1) * ROW_HEIGHT;
    fireEvent.scroll(region);

    await screen.findByText("Queue track 999 at 999");
    expect(document.body.contains(first)).toBe(true);
    expect(first).toHaveFocus();
  });

  it("reports absolute indexes when duplicate tracks are reordered", () => {
    const onMove = vi.fn();
    render(
      <Queue
        items={[item(0, "duplicate"), item(1, "duplicate"), item(2)]}
        onMove={onMove}
        startIndex={7}
      />,
    );

    const from = document.querySelector<HTMLElement>('[data-queue-absolute-index="8"]')!;
    const to = document.querySelector<HTMLElement>('[data-queue-absolute-index="9"]')!;
    fireEvent.dragStart(from, {
      dataTransfer: { effectAllowed: "none" },
    });
    fireEvent.dragOver(to);
    fireEvent.drop(to);

    expect(onMove).toHaveBeenCalledWith(8, 9);
  });
});

describe("queueRelativeIndexAtOffset", () => {
  it("clamps offsets to the queue bounds", () => {
    expect(queueRelativeIndexAtOffset(-20, 10, 50)).toBe(0);
    expect(queueRelativeIndexAtOffset(149, 10, 50)).toBe(2);
    expect(queueRelativeIndexAtOffset(50_000, 10, 50)).toBe(9);
    expect(queueRelativeIndexAtOffset(0, 0, 50)).toBeUndefined();
  });
});
