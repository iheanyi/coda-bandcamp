import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
    const entry: ResizeObserverEntry = {
      borderBoxSize: [size],
      contentBoxSize: [size],
      contentRect: bounds,
      devicePixelContentBoxSize: [size],
      target,
    };
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
      getItemLabel={(queueItem) => queueItem.title}
      items={items}
      onMove={onMove}
      renderItem={(queueItem, context) => (
        <>
          <button type="button">
            {queueItem.title} at {context.absoluteIndex}
          </button>
          {onMove ? (
            <span
              aria-hidden="true"
              data-queue-drop-marker=""
              data-visible={context.dropTarget || undefined}
            />
          ) : null}
        </>
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

  it("keeps duplicate queue entries distinct with absolute indexes", () => {
    render(<Queue items={[item(0, "duplicate"), item(1, "duplicate"), item(2)]} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    expect(within(region).getAllByRole("listitem")).toHaveLength(3);
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

  it("drops an out-of-range focused row when a virtualized queue shrinks", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => item(index));
    const { rerender } = render(<Queue items={items} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    region.scrollTop = (items.length - 1) * ROW_HEIGHT;
    fireEvent.scroll(region);
    const last = await screen.findByRole("button", {
      name: "Queue track 999 at 999",
    });
    last.focus();
    expect(last).toHaveFocus();

    const retained = Array.from({ length: 10 }, (_, index) => item(index));
    rerender(<Queue items={retained} />);

    await waitFor(() => {
      const rendered = within(region).getAllByRole("listitem");
      expect(rendered.length).toBeGreaterThan(0);
      expect(
        rendered.every(
          (row) => Number(row.dataset.queueRelativeIndex) < retained.length,
        ),
      ).toBe(true);
    });
    expect(screen.queryByText("Queue track 999 at 999")).not.toBeInTheDocument();
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

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    const from = within(region)
      .getByRole("button", { name: "Queue track 1 at 8" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(region)
      .getByRole("button", { name: "Queue track 2 at 9" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");
    fireEvent.dragStart(from, {
      dataTransfer: { effectAllowed: "none" },
    });
    fireEvent.dragOver(to);
    fireEvent.drop(to);

    expect(onMove).toHaveBeenCalledWith(8, 9);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved Queue track 1 to position 3 of 3.",
    );
  });

  it("shows a landing marker on the drop target during dragover and clears it on drop", () => {
    render(<Queue items={[item(0), item(1), item(2)]} onMove={vi.fn()} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    const from = within(region)
      .getByRole("button", { name: "Queue track 0 at 0" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(region)
      .getByRole("button", { name: "Queue track 2 at 2" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");

    fireEvent.dragStart(from, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });
    fireEvent.dragOver(to, {
      dataTransfer: { dropEffect: "none", effectAllowed: "move" },
    });

    expect(to).toHaveAttribute("data-drop-target", "true");
    expect(
      to.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).not.toBeNull();

    fireEvent.drop(to);

    expect(to).not.toHaveAttribute("data-drop-target");
    expect(
      region.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).toBeNull();
  });

  it("clears the landing marker when dragging ends without a drop", () => {
    render(<Queue items={[item(0), item(1), item(2)]} onMove={vi.fn()} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    const from = within(region)
      .getByRole("button", { name: "Queue track 0 at 0" })
      .closest<HTMLElement>('[role="listitem"]');
    const to = within(region)
      .getByRole("button", { name: "Queue track 1 at 1" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!from || !to) throw new Error("Expected draggable queue rows");

    fireEvent.dragStart(from, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });
    fireEvent.dragOver(to, {
      dataTransfer: { dropEffect: "none", effectAllowed: "move" },
    });

    expect(
      to.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).not.toBeNull();

    fireEvent.dragEnd(from);

    expect(to).not.toHaveAttribute("data-drop-target");
    expect(
      region.querySelector('[data-queue-drop-marker][data-visible="true"]'),
    ).toBeNull();
  });

  it("claims the drop target with a move effect as soon as a queue drag enters", () => {
    render(<Queue items={[item(0), item(1)]} onMove={vi.fn()} />);

    const region = screen.getByRole("region", { name: "Upcoming tracks" });
    const row = within(region)
      .getByRole("button", { name: "Queue track 0 at 0" })
      .closest<HTMLElement>('[role="listitem"]');
    if (!row) throw new Error("Expected a draggable queue row");

    // A drag that did not start in the queue (for example an OS file drag)
    // must stay unclaimed.
    const foreignDataTransfer = { dropEffect: "none", effectAllowed: "all" };
    expect(
      fireEvent.dragEnter(region, { dataTransfer: foreignDataTransfer }),
    ).toBe(true);
    expect(foreignDataTransfer.dropEffect).toBe("none");

    fireEvent.dragStart(row, {
      dataTransfer: { dropEffect: "none", effectAllowed: "none" },
    });

    // Windows shows a not-allowed cursor until the target is claimed, so
    // dragenter must be cancelled and advertise "move" without waiting for
    // the first dragover.
    const enterDataTransfer = { dropEffect: "none", effectAllowed: "move" };
    expect(
      fireEvent.dragEnter(region, { dataTransfer: enterDataTransfer }),
    ).toBe(false);
    expect(enterDataTransfer.dropEffect).toBe("move");

    const overDataTransfer = { dropEffect: "none", effectAllowed: "move" };
    expect(fireEvent.dragOver(row, { dataTransfer: overDataTransfer })).toBe(
      false,
    );
    expect(overDataTransfer.dropEffect).toBe("move");
  });

  it("offers keyboard-operable move controls with bounded destinations", async () => {
    const onMove = vi.fn();
    const user = userEvent.setup();
    render(
      <Queue
        items={[item(0), item(1), item(2)]}
        onMove={onMove}
        startIndex={7}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Move Queue track 0 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Queue track 0 down" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move Queue track 2 up" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move Queue track 2 down" }),
    ).toBeDisabled();

    const moveUp = screen.getByRole("button", {
      name: "Move Queue track 1 up",
    });
    moveUp.focus();
    await user.keyboard("{Enter}");

    expect(moveUp).toHaveFocus();
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith(8, 7);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Moved Queue track 1 to position 1 of 3.",
    );
  });

  it("does not announce or dispatch unavailable moves", () => {
    const onMove = vi.fn();
    render(<Queue items={[item(0)]} onMove={onMove} />);

    const moveUp = screen.getByRole("button", {
      name: "Move Queue track 0 up",
    });
    const moveDown = screen.getByRole("button", {
      name: "Move Queue track 0 down",
    });
    expect(moveUp).toBeDisabled();
    expect(moveDown).toBeDisabled();

    fireEvent.click(moveUp);
    fireEvent.click(moveDown);

    expect(onMove).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("falls back to a positional accessible name", () => {
    render(
      <VirtualizedQueueList
        aria-label="Upcoming tracks"
        items={["first", "second"]}
        onMove={vi.fn()}
        renderItem={(queueItem) => <span>{queueItem}</span>}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Move queue item 1 down" }),
    ).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Move queue item 2 up" }),
    ).toBeEnabled();
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
