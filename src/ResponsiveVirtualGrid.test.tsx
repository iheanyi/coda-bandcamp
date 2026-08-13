import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ResponsiveVirtualGrid,
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
  gridLayouts = layouts,
  threshold = 10,
}: {
  cards: Card[];
  gridLayouts?: ResponsiveGridLayout[];
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
        layouts={gridLayouts}
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

  it("keeps a small responsive grid fully accessible", async () => {
    render(<Grid cards={Array.from({ length: 6 }, (_, index) => card(index))} />);

    const grid = screen.getByRole("list", { name: "Collection" });
    expect(await screen.findByRole("button", {
      name: "Card 3 row 0 column 3",
    })).toBeInTheDocument();
    const listItems = within(grid).getAllByRole("listitem");
    expect(listItems).toHaveLength(6);
    expect(listItems[0]).toHaveAttribute("aria-posinset", "1");
    expect(listItems[0]).toHaveAttribute("aria-setsize", "6");
  });

  it("caps columns for full-width responsive rows", async () => {
    render(
      <Grid
        cards={Array.from({ length: 6 }, (_, index) => card(index))}
        gridLayouts={[{ ...layouts[1], maxColumns: 1 }]}
      />,
    );

    const grid = screen.getByRole("list", { name: "Collection" });
    expect(
      await screen.findByRole("button", {
        name: "Card 3 row 3 column 0",
      }),
    ).toBeInTheDocument();
    expect(grid).toHaveAttribute("data-columns", "1");
    expect(grid).toHaveStyle({
      gridTemplateColumns: "repeat(1, minmax(0, 1fr))",
    });
  });

  it("keeps a large grid bounded and renders the final row after scrolling", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);

    const scroll = screen.getByTestId("grid-scroll");
    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => {
      const rendered = within(grid).getAllByRole("listitem");
      expect(rendered.length).toBeGreaterThan(0);
      expect(rendered.length).toBeLessThan(40);
    });
    expect(screen.queryByText(/Card 999 row/)).not.toBeInTheDocument();

    scroll.scrollTop = 100_000;
    fireEvent.scroll(scroll);

    expect(await screen.findByText(/Card 999 row 249 column 3/)).toBeInTheDocument();
    expect(within(grid).getAllByRole("listitem").length).toBeLessThan(40);
  });

  it("recomputes card coordinates from ResizeObserver width without duplicates", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);
    const grid = screen.getByRole("list", { name: "Collection" });
    expect(await screen.findByRole("button", {
      name: "Card 3 row 0 column 3",
    })).toBeInTheDocument();

    containerWidth = 330;
    ResizeObserverMock.resizeAll();

    expect(await screen.findByRole("button", {
      name: "Card 3 row 1 column 0",
    })).toBeInTheDocument();
    const renderedNames = within(grid)
      .getAllByRole("button")
      .map((element) => element.textContent);
    expect(new Set(renderedNames).size).toBe(renderedNames.length);
    expect(renderedNames.length).toBeLessThan(40);
  });

  it("recomputes fixed row geometry when width changes within one column count", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    render(<Grid cards={cards} />);
    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => expect(grid).toHaveAttribute("data-columns", "4"));
    const initialHeight = Number.parseFloat(grid.style.height);

    containerWidth = 590;
    ResizeObserverMock.resizeAll();

    await waitFor(() => {
      expect(grid).toHaveAttribute("data-columns", "4");
      expect(Number.parseFloat(grid.style.height)).toBeLessThan(initialHeight);
    });
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

    scroll.scrollTop = 100_000;
    fireEvent.scroll(scroll);

    await screen.findByText(/Card 999 row 249 column 3/);
    expect(document.body.contains(first)).toBe(true);
    expect(first).toHaveFocus();
  });

  it("drops an out-of-range focused row when a virtualized grid shrinks", async () => {
    const cards = Array.from({ length: 1_000 }, (_, index) => card(index));
    const { rerender } = render(<Grid cards={cards} />);

    const scroll = screen.getByTestId("grid-scroll");
    scroll.scrollTop = 100_000;
    fireEvent.scroll(scroll);
    const last = await screen.findByRole("button", {
      name: "Card 999 row 249 column 3",
    });
    last.focus();
    expect(last).toHaveFocus();

    const retained = Array.from({ length: 20 }, (_, index) => card(index));
    rerender(<Grid cards={retained} />);

    const grid = screen.getByRole("list", { name: "Collection" });
    await waitFor(() => {
      expect(
        within(grid)
          .getAllByRole("listitem")
          .every((row) => Number(row.dataset.gridIndex) < retained.length),
      ).toBe(true);
    });
    expect(screen.queryByText(/Card 999 row/)).not.toBeInTheDocument();
  });
});
