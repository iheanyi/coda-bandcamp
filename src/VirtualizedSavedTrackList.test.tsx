import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VirtualizedSavedTrackList,
  type SavedTrackRowProps,
} from "./VirtualizedSavedTrackList";

type SavedTrack = {
  id: string;
  title: string;
};

const VIEWPORT_HEIGHT = 240;
const LIST_TOP = 90;

class ResizeObserverMock implements ResizeObserver {
  static observers = new Set<ResizeObserverMock>();
  readonly callback: ResizeObserverCallback;
  readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.observers.add(this);
  }

  disconnect() {
    this.targets.clear();
    ResizeObserverMock.observers.delete(this);
  }

  observe(target: Element) {
    this.targets.add(target);
    const bounds = target.getBoundingClientRect();
    const size = {
      blockSize: bounds.height,
      inlineSize: bounds.width,
    };
    const entry: ResizeObserverEntry = {
      borderBoxSize: [{
        blockSize: size.blockSize,
        inlineSize: size.inlineSize,
      }],
      contentBoxSize: [size],
      contentRect: bounds,
      devicePixelContentBoxSize: [size],
      target,
    };
    this.callback([entry], this);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }
}

const track = (index: number): SavedTrack => ({
  id: `saved-track-${index}`,
  title: `Saved track ${index}`,
});

function row(
  item: SavedTrack,
  rowProps: SavedTrackRowProps,
) {
  return (
    <div {...rowProps}>
      <button type="button">{item.title}</button>
    </div>
  );
}

function List({
  items,
  threshold = 3,
}: {
  items: SavedTrack[];
  threshold?: number;
}) {
  return (
    <div data-coda-library-scroll data-testid="saved-scroll">
      <div style={{ height: LIST_TOP }} />
      <div>
        <VirtualizedSavedTrackList
          aria-label="Saved tracks"
          getItemKey={(item) => item.id}
          items={items}
          renderItem={(item, _context, rowProps) => row(item, rowProps)}
          virtualizationThreshold={threshold}
        />
      </div>
    </div>
  );
}

describe("VirtualizedSavedTrackList", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    ResizeObserverMock.observers.clear();
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const isScrollElement = this.dataset.testid === "saved-scroll";
      const top = isScrollElement ? 0 : LIST_TOP;
      const height = isScrollElement ? VIEWPORT_HEIGHT : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: 360,
        top,
        width: 360,
        x: 0,
        y: top,
        toJSON: () => undefined,
      };
    };
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it("keeps short saved-track lists fully accessible", () => {
    render(<List items={[track(0), track(1), track(2)]} />);

    const list = screen.getByRole("list", { name: "Saved tracks" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[0]).toHaveAttribute("aria-setsize", "3");
  });

  it("bounds a 25,000-track list and reaches the final item", async () => {
    const items = Array.from({ length: 25_000 }, (_, index) => track(index));
    render(<List items={items} />);

    const scroll = screen.getByTestId("saved-scroll");
    const list = screen.getByRole("list", { name: "Saved tracks" });
    await waitFor(() => {
      const rows = within(list).getAllByRole("listitem");
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.length).toBeLessThan(30);
    });
    expect(screen.queryByText("Saved track 24999")).not.toBeInTheDocument();

    scroll.scrollTop = 2_000_000;
    fireEvent.scroll(scroll);

    expect(await screen.findByText("Saved track 24999")).toBeInTheDocument();
    expect(within(list).getAllByRole("listitem").length).toBeLessThan(30);
  });

  it("pins a focused track while the shared scroller moves far away", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => track(index));
    render(<List items={items} />);

    const scroll = screen.getByTestId("saved-scroll");
    const first = await screen.findByRole("button", { name: "Saved track 0" });
    first.focus();
    expect(first).toHaveFocus();

    scroll.scrollTop = 100_000;
    fireEvent.scroll(scroll);

    await screen.findByText("Saved track 999");
    expect(document.body.contains(first)).toBe(true);
    expect(first).toHaveFocus();
  });

  it("drops an out-of-range focused row when a virtualized list shrinks", async () => {
    const items = Array.from({ length: 1_000 }, (_, index) => track(index));
    const { rerender } = render(<List items={items} />);

    const scroll = screen.getByTestId("saved-scroll");
    scroll.scrollTop = 100_000;
    fireEvent.scroll(scroll);
    const last = await screen.findByRole("button", { name: "Saved track 999" });
    last.focus();
    expect(last).toHaveFocus();

    const retained = Array.from({ length: 10 }, (_, index) => track(index));
    rerender(<List items={retained} />);

    const list = screen.getByRole("list", { name: "Saved tracks" });
    await waitFor(() => {
      expect(
        within(list)
          .getAllByRole("listitem")
          .every((row) => Number(row.dataset.savedTrackIndex) < retained.length),
      ).toBe(true);
    });
    expect(screen.queryByText("Saved track 999")).not.toBeInTheDocument();
  });
});
