import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResponsiveVirtualGrid,
  resolveResponsiveGridLayout,
  responsiveGridMetrics,
  type ResponsiveGridLayout,
} from "./ResponsiveVirtualGrid";

type Card = {
  id: string;
  title: string;
};

const VIEWPORT_HEIGHT = 240;
const GRID_TOP = 80;
const layouts: ResponsiveGridLayout[] = [
  {
    columnGap: 8,
    maxWidth: 399,
    minColumnWidth: 100,
    rowGap: 12,
    rowHeight: (columnWidth) => columnWidth + 30,
  },
  {
    columnGap: 10,
    minColumnWidth: 140,
    rowGap: 16,
    rowHeight: (columnWidth) => columnWidth + 30,
  },
];

let containerWidth = 600;

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
    this.emit(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  emit(target: Element) {
    const bounds = target.getBoundingClientRect();
    const size = {
      blockSize: bounds.height,
      inlineSize: bounds.width,
    };
    this.callback([
      {
        borderBoxSize: [size],
        contentBoxSize: [size],
        contentRect: bounds,
        devicePixelContentBoxSize: [size],
        target,
      } as unknown as ResizeObserverEntry,
    ], this);
  }

  static resizeAll() {
    for (const observer of ResizeObserverMock.observers) {
      for (const target of observer.targets) observer.emit(target);
    }
  }
}

const card = (index: number): Card => ({
  id: `card-${index}`,
  title: `Card ${index}`,
});

function Grid({
  cards,
  threshold = 10,
}: {
  cards: Card[];
  threshold?: number;
}) {
  const scrollRef = { current: null } as React.RefObject<HTMLDivElement | null>;
  return (
    <div
      data-testid="grid-scroll"
      ref={(element) => {
        scrollRef.current = element;
      }}
      style={{ height: VIEWPORT_HEIGHT, overflowY: "auto" }}
    >
      <div style={{ height: GRID_TOP }} />
      <ResponsiveVirtualGrid
        aria-label="Collection"
        getItemKey={(item) => item.id}
        items={cards}
        layouts={layouts}
        renderItem={(item, context) => (
          <button type="button">
            {item.title} row {context.row} column {context.column}
          </button>
        )}
        scrollElementRef={scrollRef}
        virtualizationThreshold={threshold}
      />
    </div>
  );
}

describe("ResponsiveVirtualGrid", () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeEach(() => {
    containerWidth = 600;
    ResizeObserverMock.observers.clear();
    globalThis.ResizeObserver = ResizeObserverMock;
    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      const isScrollElement = this.dataset.testid === "grid-scroll";
      const top = isScrollElement ? 0 : GRID_TOP;
      const height = isScrollElement ? VIEWPORT_HEIGHT : 0;
      return {
        bottom: top + height,
        height,
        left: 0,
        right: containerWidth,
        top,
        width: containerWidth,
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

  it("uses natural CSS Grid flow below the virtualization threshold", async () => {
    render(<Grid cards={Array.from({ length: 6 }, (_, index) => card(index))} />);

    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => expect(grid).toHaveAttribute("data-columns", "4"));
    expect(grid).toHaveAttribute("data-virtualized", "false");
    const listItems = within(grid).getAllByRole("listitem");
    expect(listItems).toHaveLength(6);
    expect(listItems[0]).toHaveAttribute("aria-posinset", "1");
    expect(listItems[0]).toHaveAttribute("aria-setsize", "6");
    expect(grid).toHaveStyle({
      columnGap: "10px",
      display: "grid",
      rowGap: "16px",
    });
  });

  it("keeps a large grid bounded and renders the final row after scrolling", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);

    const scroll = screen.getByTestId("grid-scroll");
    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => {
      expect(grid).toHaveAttribute("data-columns", "4");
      const rendered = within(grid).getAllByRole("listitem");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(40);
    });
    expect(screen.queryByText(/Card 999 row/)).not.toBeInTheDocument();

    const rowHeight = responsiveGridMetrics(600, layouts[1]).rowHeight + layouts[1].rowGap;
    scroll.scrollTop = Math.ceil(cards.length / 4) * rowHeight + GRID_TOP;
    fireEvent.scroll(scroll);

    expect(await screen.findByText(/Card 999 row 249 column 3/)).toBeInTheDocument();
    expect(within(grid).getAllByRole("listitem").length).toBeLessThan(40);
  });

  it("recomputes columns from ResizeObserver width without duplicating cards", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);
    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => expect(grid).toHaveAttribute("data-columns", "4"));

    containerWidth = 330;
    ResizeObserverMock.resizeAll();

    await waitFor(() => expect(grid).toHaveAttribute("data-columns", "3"));
    const renderedKeys = within(grid)
      .getAllByRole("listitem")
      .map((element) => element.getAttribute("data-grid-item-key"));
    expect(new Set(renderedKeys).size).toBe(renderedKeys.length);
    expect(renderedKeys.length).toBeLessThan(40);
  });

  it("pins the focused row while scrolling to distant cards", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);

    const scroll = screen.getByTestId("grid-scroll");
    const first = await screen.findByRole("button", {
      name: "Card 0 row 0 column 0",
    });
    first.focus();
    expect(first).toHaveFocus();

    const rowHeight = responsiveGridMetrics(600, layouts[1]).rowHeight + layouts[1].rowGap;
    scroll.scrollTop = Math.ceil(cards.length / 4) * rowHeight + GRID_TOP;
    fireEvent.scroll(scroll);

    await screen.findByText(/Card 999 row 249 column 3/);
    expect(document.body.contains(first)).toBe(true);
    expect(first).toHaveFocus();
  });
});

describe("responsive grid helpers", () => {
  it("selects first matching layout and computes CSS auto-fill columns", () => {
    expect(resolveResponsiveGridLayout(330, layouts)).toBe(layouts[0]);
    expect(resolveResponsiveGridLayout(600, layouts)).toBe(layouts[1]);
    expect(responsiveGridMetrics(600, layouts[1])).toMatchObject({
      columnGap: 10,
      columns: 4,
      columnWidth: 142.5,
      rowGap: 16,
      rowHeight: 172.5,
    });
  });
});
