import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { codaMotion } from "@/motion";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";

type MotionProps = HTMLAttributes<HTMLElement> & {
  animate?: unknown;
  initial?: unknown;
  transition?: unknown;
  children?: ReactNode;
};

vi.mock("motion/react-m", () => ({
  div: forwardRef<HTMLDivElement, MotionProps>(function MotionDiv(
    { animate, initial, transition, ...props },
    ref,
  ) {
    return (
      <div
        ref={ref}
        data-motion-animate={JSON.stringify(animate)}
        data-motion-initial={JSON.stringify(initial)}
        data-motion-transition={JSON.stringify(transition)}
        {...props}
      />
    );
  }),
  span: forwardRef<HTMLSpanElement, MotionProps>(function MotionSpan(
    { animate, initial, transition, ...props },
    ref,
  ) {
    return (
      <span
        ref={ref}
        data-motion-animate={JSON.stringify(animate)}
        data-motion-initial={JSON.stringify(initial)}
        data-motion-transition={JSON.stringify(transition)}
        {...props}
      />
    );
  }),
}));

function SortSelect() {
  return (
    <Select defaultValue="recent">
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
    expect(chevron).toHaveAttribute(
      "data-motion-animate",
      JSON.stringify({ transform: "rotate(180deg)" }),
    );

    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveTextContent("recent");
    expect(trigger).toHaveFocus();
    expect(chevron).toHaveAttribute(
      "data-motion-animate",
      JSON.stringify({ transform: "rotate(0deg)" }),
    );
  });
});
