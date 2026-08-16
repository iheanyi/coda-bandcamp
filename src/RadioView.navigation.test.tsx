import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { radioServices, renderRadio, show, shows } from "./test/radioViewTestHarness";

describe("Bandcamp Radio navigation behavior", () => {

  it("moves focus into a show and restores its tracklist trigger on Back", async () => {
    renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    const tracklistButton = screen.getByRole("link", {
      name: "View tracklist",
    });
    tracklistButton.focus();
    fireEvent.click(tracklistButton);

    await screen.findByRole("heading", { name: "Songs in this show" });
    const detailHeading = document.getElementById("radio-detail-title");
    expect(detailHeading).not.toBeNull();
    expect(detailHeading?.parentElement).toHaveAttribute(
      "data-coda-radio-metadata-detail",
    );
    expect(
      document.querySelectorAll("[data-coda-radio-metadata-detail]"),
    ).toHaveLength(1);
    await waitFor(() => expect(detailHeading).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    const restoredTracklistButton = await screen.findByRole("link", {
      name: "View tracklist",
    });
    await waitFor(() => expect(restoredTracklistButton).toHaveFocus());
    expect(
      document.querySelector("[data-coda-radio-metadata-detail]"),
    ).not.toBeInTheDocument();
  });

  it("pairs Radio artwork in both directions and restores context before the Back snapshot", async () => {
    const snapshots: Array<{
      sourceBefore?: string | null;
      sourceTitleBefore?: string | null;
      sourceTitleCount: number;
      detailAfter?: string | null;
      detailTitleAfter?: string | null;
      returningAfter?: string | null;
      returningTitleAfter?: string | null;
      scrollTopAfter: number;
      focusedShowAfter?: string;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let sourceTitleElement: Element | null = null;
    const startViewTransition = vi.fn(
      (update: () => void | Promise<void>) => {
        const sourceBefore = document
          .querySelector("[data-coda-radio-artwork-source]")
          ?.getAttribute("data-coda-radio-artwork-source");
        sourceTitleElement = document.querySelector(
          "[data-coda-radio-title-source]",
        );
        const sourceTitleBefore = sourceTitleElement?.getAttribute(
          "data-coda-radio-title-source",
        );
        const sourceTitleCount = document.querySelectorAll(
          "[data-coda-radio-title-source]",
        ).length;
        const finished = Promise.resolve(update()).then(() => {
          const activeElement = document.activeElement;
          snapshots.push({
            sourceBefore,
            sourceTitleBefore,
            sourceTitleCount,
            detailAfter: document
              .querySelector("[data-coda-radio-artwork-detail]")
              ?.getAttribute("data-coda-radio-artwork-detail"),
            detailTitleAfter: document
              .querySelector("[data-coda-radio-title-detail]")
              ?.getAttribute("data-coda-radio-title-detail"),
            returningAfter: document
              .querySelector("[data-coda-radio-artwork-return]")
              ?.getAttribute("data-coda-radio-artwork-return"),
            returningTitleAfter: document
              .querySelector("[data-coda-radio-title-return]")
              ?.getAttribute("data-coda-radio-title-return"),
            scrollTopAfter:
              document.querySelector<HTMLElement>("[data-coda-library-scroll]")
                ?.scrollTop ?? -1,
            focusedShowAfter:
              activeElement instanceof HTMLElement
                ? activeElement.dataset.radioShowOpen
                : undefined,
          });
        });
        return { finished };
      },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      const scrollRoot = document.querySelector<HTMLElement>(
        "[data-coda-library-scroll]",
      );
      expect(scrollRoot).not.toBeNull();
      if (scrollRoot) scrollRoot.scrollTop = 287;
      const tracklistButton = screen.getByRole("link", {
        name: "View tracklist",
      });
      tracklistButton.focus();
      fireEvent.click(tracklistButton);

      await screen.findByRole("heading", { name: "Songs in this show" });
      await waitFor(() =>
        expect(sourceTitleElement).not.toHaveAttribute(
          "data-coda-radio-title-source",
        ),
      );
      if (scrollRoot) scrollRoot.scrollTop = 0;
      fireEvent.click(screen.getByRole("button", { name: "Back" }));

      await screen.findByRole("heading", { name: "Kinrose" });
      expect(startViewTransition).toHaveBeenCalledTimes(2);
      expect(radioServices.transitionKinds).toEqual([
        "radio-detail",
        "radio-detail-close",
      ]);
      expect(snapshots).toEqual([
        expect.objectContaining({
          sourceBefore: "979",
          sourceTitleBefore: "979",
          sourceTitleCount: 1,
          detailAfter: "979",
          detailTitleAfter: "979",
        }),
        expect.objectContaining({
          returningAfter: "979",
          returningTitleAfter: "979",
          scrollTopAfter: 287,
          focusedShowAfter: "979",
        }),
      ]);
      await waitFor(() =>
        expect(
          document.querySelector(
            "[data-coda-radio-artwork-return], [data-coda-radio-title-return]",
          ),
        ).not.toBeInTheDocument(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--radio-detail",
        "coda-transition--radio-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("pairs the exact archive show title and cleans every temporary title marker", async () => {
    const archiveShow = {
      ...show,
      ...shows[1],
      title: "Bandcamp Selects",
    };
    vi.mocked(radioServices.fetchShow).mockResolvedValueOnce(archiveShow);
    const snapshots: Array<{
      sourceTitle?: string | null;
      sourceTitleIsStatic: boolean;
      sourceTitleCount: number;
      detailTitle?: string | null;
      returningTitle?: string | null;
      returningTitleIsStatic: boolean;
      returningTitleCount: number;
    }> = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    let detachedSourceTitle: Element | null = null;
    const startViewTransition = vi.fn(
      (update: () => void | Promise<void>) => {
        detachedSourceTitle = document.querySelector(
          "[data-coda-radio-title-source]",
        );
        const sourceTitle = detachedSourceTitle?.getAttribute(
          "data-coda-radio-title-source",
        );
        const sourceTitleCount = document.querySelectorAll(
          "[data-coda-radio-title-source]",
        ).length;
        const finished = Promise.resolve(update()).then(() => {
          snapshots.push({
            sourceTitle,
            sourceTitleIsStatic:
              detachedSourceTitle?.matches(
                '[data-slot="overflow-marquee-text"]',
              ) ?? false,
            sourceTitleCount,
            detailTitle: document
              .querySelector("[data-coda-radio-title-detail]")
              ?.getAttribute("data-coda-radio-title-detail"),
            returningTitle: document
              .querySelector("[data-coda-radio-title-return]")
              ?.getAttribute("data-coda-radio-title-return"),
            returningTitleIsStatic:
              document
                .querySelector("[data-coda-radio-title-return]")
                ?.matches('[data-slot="overflow-marquee-text"]') ?? false,
            returningTitleCount: document.querySelectorAll(
              "[data-coda-radio-title-return]",
            ).length,
          });
        });
        return { finished };
      },
    );
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      expect(document.querySelectorAll("[data-radio-show-title]")).toHaveLength(
        2,
      );
      fireEvent.click(
        screen.getByRole("link", {
          name: "View tracklist for The Best of 2026",
        }),
      );

      await screen.findByRole("heading", { name: "Songs in this show" });
      await waitFor(() =>
        expect(detachedSourceTitle).not.toHaveAttribute(
          "data-coda-radio-title-source",
        ),
      );
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("heading", { name: "Kinrose" });

      expect(snapshots).toEqual([
        expect.objectContaining({
          sourceTitle: "978",
          sourceTitleIsStatic: true,
          sourceTitleCount: 1,
          detailTitle: "978",
          returningTitleIsStatic: false,
          returningTitleCount: 0,
        }),
        expect.objectContaining({
          sourceTitleCount: 0,
          sourceTitleIsStatic: false,
          returningTitle: "978",
          returningTitleIsStatic: true,
          returningTitleCount: 1,
        }),
      ]);
      await waitFor(() =>
        expect(
          document.querySelector(
            "[data-coda-radio-title-source], [data-coda-radio-title-return]",
          ),
        ).not.toBeInTheDocument(),
      );
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--radio-detail",
        "coda-transition--radio-detail-close",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });

  it("falls back to page motion when the source Radio artwork is unavailable", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      document,
      "startViewTransition",
    );
    const startViewTransition = vi.fn();
    Object.defineProperty(document, "startViewTransition", {
      configurable: true,
      value: startViewTransition,
    });

    try {
      renderRadio();

      await screen.findByRole("heading", { name: "Kinrose" });
      document
        .querySelector('[data-radio-show-artwork="979"]')
        ?.removeAttribute("data-radio-show-artwork");
      fireEvent.click(
        screen.getByRole("link", {
          name: "View tracklist",
        }),
      );

      await screen.findByRole("heading", { name: "Songs in this show" });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByRole("heading", { name: "Kinrose" });

      expect(startViewTransition).not.toHaveBeenCalled();
      expect(radioServices.transitionKinds).toEqual([
        "page-forward",
        "page-back",
      ]);
      expect(
        document.querySelector(
          "[data-coda-radio-artwork-return], [data-coda-radio-title-return]",
        ),
      ).not.toBeInTheDocument();
    } finally {
      document.documentElement.classList.remove(
        "coda-transition--page-forward",
        "coda-transition--page-back",
      );
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    }
  });
});
