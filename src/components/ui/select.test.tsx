import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type ComponentProps } from "react";
import * as m from "motion/react-m";
import { describe, expect, it } from "vitest";

import { codaMotion } from "@/motion";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type SelectMotionElements,
} from "./select";

const CapturingMotionDiv = forwardRef<
  HTMLDivElement,
  ComponentProps<typeof m.div>
>(function CapturingMotionDiv({ animate, initial, transition, ...props }, ref) {
  return (
    <m.div
      {...props}
      ref={ref}
      animate={animate}
      data-motion-animate={JSON.stringify(animate)}
      data-motion-initial={JSON.stringify(initial)}
      data-motion-transition={JSON.stringify(transition)}
      initial={initial}
      transition={transition}
    />
  );
});

const CapturingMotionSpan = forwardRef<
  HTMLSpanElement,
  ComponentProps<typeof m.span>
>(function CapturingMotionSpan({ animate, initial, transition, ...props }, ref) {
  return (
    <m.span
      {...props}
      ref={ref}
      animate={animate}
      data-motion-animate={JSON.stringify(animate)}
      data-motion-initial={JSON.stringify(initial)}
      data-motion-transition={JSON.stringify(transition)}
      initial={initial}
      transition={transition}
    />
  );
});

const CAPTURING_MOTION_ELEMENTS = {
  div: CapturingMotionDiv,
  span: CapturingMotionSpan,
} satisfies SelectMotionElements;

function SortSelect() {
  return (
    <Select
      defaultValue="recent"
      motionElements={CAPTURING_MOTION_ELEMENTS}
    >
      <SelectTrigger aria-label="Sort collection">
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false}>
        <SelectItem value="recent">Recently added</SelectItem>
        <SelectItem value="artist">Artist A–Z</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe("Select Motion integration", () => {
  it("animates popup opacity and scale from its transform origin", async () => {
    const user = userEvent.setup();
    render(<SortSelect />);

    const trigger = screen.getByRole("combobox", {
      name: "Sort collection",
    });
    await user.click(trigger);

    await screen.findByRole("listbox");
    const popup = document.querySelector('[data-slot="select-content"]');
    expect(popup).not.toBeNull();
    expect(popup).toHaveAttribute(
      "data-motion-initial",
      JSON.stringify({ opacity: 0, transform: "scale(0.98)" }),
    );
    expect(popup).toHaveAttribute(
      "data-motion-animate",
      JSON.stringify({ opacity: 1, transform: "scale(1)" }),
    );
    expect(popup).toHaveAttribute(
      "data-motion-transition",
      JSON.stringify(codaMotion.componentEnter),
    );
  });

  it("rotates the chevron without changing keyboard dismissal semantics", async () => {
    const user = userEvent.setup();
    render(<SortSelect />);

    const trigger = screen.getByRole("combobox", {
      name: "Sort collection",
    });
    const chevron = trigger.querySelector(
      '[data-slot="select-chevron-motion"]',
    );
    expect(chevron).toHaveAttribute(
      "data-motion-animate",
      JSON.stringify({ transform: "rotate(0deg)" }),
    );

    await user.click(trigger);
    await screen.findByRole("listbox");
    await waitFor(() =>
      expect(chevron).toHaveAttribute(
        "data-motion-animate",
        JSON.stringify({ transform: "rotate(180deg)" }),
      ),
    );

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      expect(chevron).toHaveAttribute(
        "data-motion-animate",
        JSON.stringify({ transform: "rotate(0deg)" }),
      );
    });
    expect(trigger).toHaveTextContent("recent");
    expect(trigger).toHaveFocus();
  });
});
