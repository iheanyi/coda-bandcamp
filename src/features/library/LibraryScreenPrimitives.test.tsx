import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LibrarySkeleton } from "./LibraryScreenPrimitives";

describe("LibrarySkeleton", () => {
  it("uses one structural shimmer without a competing spinner", () => {
    render(<LibrarySkeleton />);

    const loadingStatus = screen.getByRole("status", {
      name: "Loading your collection",
    });
    expect(loadingStatus).toHaveAttribute("aria-busy", "true");
    expect(
      loadingStatus.querySelectorAll('[data-slot="skeleton"]'),
    ).not.toHaveLength(0);
    expect(
      loadingStatus.querySelector('[data-slot="spinner"]'),
    ).not.toBeInTheDocument();
  });
});
