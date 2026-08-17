import { forwardRef, useState, type ComponentProps } from "react";
import { MotionConfig } from "motion/react";
import * as m from "motion/react-m";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { codaMotion } from "@/motion";
import { ScrollableSelectionRail } from "./ScrollableSelectionRail";

type CapturedIndicator = Readonly<{
  layoutId?: string;
  transition?: ComponentProps<typeof m.div>["transition"];
}>;

const capturedIndicators: CapturedIndicator[] = [];

const CapturingIndicator = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof m.div>
>(function CapturingIndicator({ layoutId, transition, ...props }, ref) {
  capturedIndicators.push({ layoutId, transition });
  return (
    <m.div
      {...props}
      ref={ref}
      layoutId={layoutId}
      transition={transition}
    />
  );
});

const items = [
  { label: "All genres", value: "all" },
  { label: "Ambient", value: "ambient" },
  { label: "Jazz", value: "jazz" },
] as const;

function StatefulRail({
  onScroll = vi.fn(),
  onScrollByDirection = vi.fn(),
  onValueChange = vi.fn(),
}: Readonly<{
  onScroll?: (rail: HTMLElement) => void;
  onScrollByDirection?: (direction: -1 | 1) => void;
  onValueChange?: (value: string) => void;
}>) {
  const [value, setValue] = useState("all");

  return (
    <ScrollableSelectionRail
      aria-label="Filter music by genre"
      className="test-rail"
      edges={{ end: true, start: true }}
      items={items}
      nextLabel="Show more genres"
      onScroll={onScroll}
      onScrollByDirection={onScrollByDirection}
      onValueChange={(nextValue) => {
        onValueChange(nextValue);
        setValue(nextValue);
      }}
      previousLabel="Show previous genres"
      value={value}
    />
  );
}

beforeEach(() => {
  capturedIndicators.length = 0;
});

describe("ScrollableSelectionRail", () => {
  it("keeps native toggle-button keyboard behavior and controlled latest-wins selection", async () => {
    const user = userEvent.setup();
    const onScroll = vi.fn();
    const onScrollByDirection = vi.fn();
    const onValueChange = vi.fn();
    render(
      <StatefulRail
        onScroll={onScroll}
        onScrollByDirection={onScrollByDirection}
        onValueChange={onValueChange}
      />,
    );

    const navigation = screen.getByRole("navigation", {
      name: "Filter music by genre",
    });
    const ambient = within(navigation).getByRole("button", {
      name: "Ambient",
    });

    expect(navigation).not.toHaveAttribute("role", "tablist");
    expect(navigation.parentElement).toHaveClass("test-rail");
    fireEvent.scroll(navigation);
    expect(onScroll).toHaveBeenCalledWith(navigation);
    await user.click(
      screen.getByRole("button", { name: "Show previous genres" }),
    );
    await user.click(screen.getByRole("button", { name: "Show more genres" }));
    expect(
      onScrollByDirection.mock.calls.map(([direction]) => direction),
    ).toEqual([-1, 1]);

    ambient.focus();
    await user.keyboard("{Enter}");
    expect(ambient).toHaveFocus();
    expect(ambient).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(navigation).getByRole("button", { name: "Jazz" }));
    fireEvent.click(
      within(navigation).getByRole("button", { name: "All genres" }),
    );

    expect(onValueChange.mock.calls.map(([value]) => value)).toEqual([
      "ambient",
      "jazz",
      "all",
    ]);
    expect(
      within(navigation).getByRole("button", { name: "All genres" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      navigation.querySelectorAll("[data-selection-rail-indicator]"),
    ).toHaveLength(1);
  });

  it("scopes stable shared-layout indicators and snaps them for reduced motion", () => {
    const view = render(
      <MotionConfig reducedMotion="always">
        <ScrollableSelectionRail
          aria-label="Primary genres"
          edges={{ end: false, start: false }}
          indicatorComponent={CapturingIndicator}
          items={items}
          onScroll={vi.fn()}
          onScrollByDirection={vi.fn()}
          onValueChange={vi.fn()}
          value="all"
        />
        <ScrollableSelectionRail
          aria-label="Secondary genres"
          edges={{ end: false, start: false }}
          indicatorComponent={CapturingIndicator}
          items={items}
          onScroll={vi.fn()}
          onScrollByDirection={vi.fn()}
          onValueChange={vi.fn()}
          value="ambient"
        />
      </MotionConfig>,
    );

    const initialLayoutIds = capturedIndicators.map(({ layoutId }) => layoutId);
    expect(new Set(initialLayoutIds)).toHaveLength(2);
    expect(
      capturedIndicators.every(
        ({ transition }) =>
          JSON.stringify(transition) === JSON.stringify({ duration: 0 }),
      ),
    ).toBe(true);

    view.rerender(
      <MotionConfig reducedMotion="never">
        <ScrollableSelectionRail
          aria-label="Primary genres"
          edges={{ end: false, start: false }}
          indicatorComponent={CapturingIndicator}
          items={items}
          onScroll={vi.fn()}
          onScrollByDirection={vi.fn()}
          onValueChange={vi.fn()}
          value="jazz"
        />
        <ScrollableSelectionRail
          aria-label="Secondary genres"
          edges={{ end: false, start: false }}
          indicatorComponent={CapturingIndicator}
          items={items}
          onScroll={vi.fn()}
          onScrollByDirection={vi.fn()}
          onValueChange={vi.fn()}
          value="ambient"
        />
      </MotionConfig>,
    );

    const rerenderedIndicators = capturedIndicators.slice(-2);
    expect(rerenderedIndicators.map(({ layoutId }) => layoutId)).toEqual(
      initialLayoutIds,
    );
    expect(rerenderedIndicators[0]?.transition).toMatchObject({
      ...codaMotion.selectionPill,
      visualDuration: 0.355,
    });
    const primaryNavigation = screen.getByRole("navigation", {
      name: "Primary genres",
    });
    expect(
      within(primaryNavigation)
        .getByRole("button", { name: "Jazz" })
        .querySelector("[data-selection-rail-indicator]"),
    ).toHaveAttribute("data-selection-travel-steps", "2");
  });
});
