import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollableLinkSelectionRail } from "./ScrollableLinkSelectionRail";

const ITEMS = [
  { label: "Best of", value: "best-of" },
  { label: "Franchises", value: "franchises" },
  { label: "Genres", value: "genres" },
] as const;

function SelectionRail({ value }: { value: (typeof ITEMS)[number]["value"] }) {
  return (
    <MotionConfig reducedMotion="never">
      <LazyMotion features={domAnimation} strict>
        <ScrollableLinkSelectionRail
          aria-label="Daily sections"
          items={ITEMS}
          renderLink={(item, state) => (
            <a
              aria-current={state.selected ? "page" : undefined}
              className={state.className}
              href={`#${item.value}`}
              key={item.value}
              ref={state.ref}
            >
              {state.children}
            </a>
          )}
          value={value}
        />
      </LazyMotion>
    </MotionConfig>
  );
}

describe("ScrollableLinkSelectionRail", () => {
  it("keeps the traveling tint unclipped above link surfaces and below every label", () => {
    const view = render(<SelectionRail value="best-of" />);

    const firstLink = screen.getByRole("link", { name: "Best of" });
    const firstIndicator = firstLink.querySelector(
      "[data-selection-link-rail-indicator]",
    );
    expect(firstLink).not.toHaveClass("overflow-hidden");
    expect(firstIndicator).toHaveClass("z-10");
    expect(within(firstLink).getByText("Best of")).toHaveClass("z-20");

    view.rerender(<SelectionRail value="genres" />);

    const selectedLink = screen.getByRole("link", { name: "Genres" });
    expect(
      selectedLink.querySelector("[data-selection-link-rail-indicator]"),
    ).toHaveClass("z-10");
    for (const item of ITEMS) {
      expect(screen.getByText(item.label)).toHaveClass("z-20");
    }
  });
});
