import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RadioShow } from "./types";
import { radioServices, renderRadio, show } from "./test/radioViewTestHarness";

describe("Bandcamp Radio show behavior", () => {

  it("commits the safe summary shell before signed show media resolves", async () => {
    let resolveShow!: (value: RadioShow) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    const archiveArtwork = document.querySelector<HTMLElement>(
      '[data-radio-show-artwork="979"]',
    );
    const archiveImage = archiveArtwork?.querySelector("img");
    if (!archiveImage) throw new Error("Expected archive Radio artwork.");
    fireEvent.load(archiveImage);

    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    expect(await screen.findByRole("button", { name: "Back" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Kinrose", level: 1 }),
    ).toBeVisible();
    const detailArtwork = document.querySelector<HTMLElement>(
      '[data-coda-radio-artwork-detail="979"]',
    );
    expect(detailArtwork?.querySelector("img")).not.toHaveClass("invisible");
    expect(
      detailArtwork?.querySelector("[data-radio-show-artwork-fallback]"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: "Loading Radio show tracklist",
      }),
    ).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: "Loading show audio" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add to queue" }),
    ).toBeDisabled();
    expect(radioServices.fetchShow).toHaveBeenCalledTimes(1);

    await act(async () => resolveShow(show));

    expect(
      await screen.findByRole("button", {
        name: "Play Mirage from 2:00",
      }),
    ).toBeEnabled();
    expect(radioServices.fetchShow).toHaveBeenCalledTimes(1);
  });

  it("retains the safe summary shell when signed show loading fails", async () => {
    let rejectShow!: (reason?: Error) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((_, reject) => {
        rejectShow = (reason) => reject(reason);
      }),
    );
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));
    await screen.findByRole("button", { name: "Back" });

    await act(async () => {
      rejectShow(new Error("The signed Radio stream expired"));
    });

    expect(
      screen.getByRole("heading", { name: "Kinrose", level: 1 }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Back" })).toBeVisible();
    expect(
      await screen.findByText("Tracklist unavailable"),
    ).toBeInTheDocument();
    expect(screen.getByText("The signed Radio stream expired")).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Show audio unavailable" }),
    ).toBeDisabled();
  });

  it("keeps requested show loading visible over a warm archive until details arrive", async () => {
    const requestedShow = {
      ...show,
      id: 977,
      subtitle: "Deep Focus",
    };
    let resolveShow!: (value: RadioShow) => void;
    vi.mocked(radioServices.fetchShow).mockReturnValue(
      new Promise((resolve) => {
        resolveShow = resolve;
      }),
    );

    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      requestedShowId: requestedShow.id,
      warmArchive: true,
    });

    expect(
      await screen.findByRole("status", {
        name: "Loading Radio show details",
      }),
    ).toBeInTheDocument();

    resolveShow(requestedShow);

    expect(
      await screen.findByRole("heading", {
        name: "Deep Focus",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole("status", {
          name: "Loading Radio show details",
        }),
      ).not.toBeInTheDocument(),
    );
  });
});
