import {
  createRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { MotionConfig } from "motion/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LibraryBrowseMode } from "@/libraryBrowse";
import { codaMotion } from "@/motion";
import {
  LibraryScreenChrome,
  type LibraryScreenChromeProps,
} from "./LibraryScreenChrome";

const chromeModel: LibraryScreenChromeProps["model"] = {
  kind: "collection",
  connected: true,
  releaseCount: 12,
  syncState: "idle",
  libraryError: "",
  query: "",
  surprise: {
    available: false,
    scopeName: "Collection",
    loading: false,
    disabled: false,
  },
  shuffle: {
    available: true,
    label: "Shuffle collection",
    scopeName: "the collection",
    disabled: false,
  },
  artwork: {
    refreshing: false,
    disabled: false,
  },
};

const browseCounts = {
  artists: 7,
  albums: 9,
  singles: 3,
} as const;

function chromeProps(
  mode: LibraryBrowseMode,
  onChooseMode: (mode: LibraryBrowseMode) => void,
): ComponentProps<typeof LibraryScreenChrome> {
  return {
    model: chromeModel,
    actions: {
      onQueryChange: vi.fn(),
      onSurprise: vi.fn(),
      onShuffle: vi.fn(),
      onRefreshArtwork: vi.fn(),
      onSync: vi.fn(),
      onConnect: vi.fn(),
    },
    refs: {
      search: createRef<HTMLInputElement>(),
      genreRail: createRef<HTMLElement>(),
    },
    browse: {
      model: {
        mode,
        releaseCount: chromeModel.releaseCount,
        counts: browseCounts,
      },
      actions: { onChooseMode },
    },
  };
}

function StatefulChrome({
  initialMode = "releases",
  onChooseMode = vi.fn(),
}: Readonly<{
  initialMode?: LibraryBrowseMode;
  onChooseMode?: (mode: LibraryBrowseMode) => void;
}>) {
  const [mode, setMode] = useState<LibraryBrowseMode>(initialMode);

  return (
    <LibraryScreenChrome
      {...chromeProps(mode, (nextMode) => {
        onChooseMode(nextMode);
        setMode(nextMode);
      })}
    />
  );
}

function renderWithMotion(
  view: ReactNode,
  reducedMotion: "always" | "never" = "never",
) {
  return render(
    <MotionConfig reducedMotion={reducedMotion}>{view}</MotionConfig>,
  );
}

function installViewTransitionSpy() {
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    document,
    "startViewTransition",
  );
  const startViewTransition = vi.fn();
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startViewTransition,
  });

  return {
    startViewTransition,
    restore() {
      if (originalDescriptor) {
        Object.defineProperty(
          document,
          "startViewTransition",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(document, "startViewTransition");
      }
    },
  };
}

describe("Collection browse tabs", () => {
  it("exposes the contextual shuffle action without invoking a major view transition", async () => {
    const user = userEvent.setup();
    const onShuffle = vi.fn();
    const viewTransition = installViewTransitionSpy();

    try {
      const props = chromeProps("releases", vi.fn());
      renderWithMotion(
        <LibraryScreenChrome
          {...props}
          actions={{ ...props.actions, onShuffle }}
        />,
      );

      await user.click(
        screen.getByRole("button", { name: "Shuffle collection" }),
      );

      expect(onShuffle).toHaveBeenCalledOnce();
      expect(viewTransition.startViewTransition).not.toHaveBeenCalled();
    } finally {
      viewTransition.restore();
    }
  });

  it("renders selection from the controlled route model and keeps one shared indicator", async () => {
    const user = userEvent.setup();
    const onChooseMode = vi.fn();
    const { rerender } = renderWithMotion(
      <LibraryScreenChrome {...chromeProps("releases", onChooseMode)} />,
    );

    const releases = screen.getByRole("button", { name: /All releases/ });
    const artists = screen.getByRole("button", { name: /Artists/ });

    expect(releases).toHaveAttribute("aria-pressed", "true");
    expect(artists).toHaveAttribute("aria-pressed", "false");
    expect(
      releases.querySelector("[data-collection-browse-indicator]"),
    ).toBeInTheDocument();
    expect(
      releases.querySelector("[data-collection-browse-indicator]"),
    ).toHaveClass("pointer-events-none");

    await user.click(releases);
    expect(onChooseMode).toHaveBeenCalledWith("releases");

    await user.click(artists);

    expect(onChooseMode).toHaveBeenCalledWith("artists");
    expect(releases).toHaveAttribute("aria-pressed", "true");
    expect(artists).toHaveAttribute("aria-pressed", "false");

    rerender(
      <MotionConfig reducedMotion="never">
        <LibraryScreenChrome {...chromeProps("artists", onChooseMode)} />
      </MotionConfig>,
    );

    expect(artists).toHaveAttribute("aria-pressed", "true");
    expect(
      artists.querySelector("[data-collection-browse-indicator]"),
    ).toBeInTheDocument();
    expect(
      artists.querySelector("[data-collection-browse-indicator]"),
    ).toHaveAttribute("data-selection-travel-steps", "1");
    expect(
      screen
        .getByRole("navigation", { name: "Browse collection" })
        .querySelectorAll("[data-collection-browse-indicator]"),
    ).toHaveLength(1);
  });

  it("activates the semantic toggle buttons from the keyboard", async () => {
    const user = userEvent.setup();
    const onChooseMode = vi.fn();
    renderWithMotion(<StatefulChrome onChooseMode={onChooseMode} />);

    const artists = screen.getByRole("button", { name: /Artists/ });
    artists.focus();
    await user.keyboard("{Enter}");

    expect(onChooseMode).toHaveBeenLastCalledWith("artists");
    expect(artists).toHaveAttribute("aria-pressed", "true");
    expect(artists).toHaveFocus();

    const singles = screen.getByRole("button", { name: /Singles/ });
    singles.focus();
    await user.keyboard(" ");

    expect(onChooseMode).toHaveBeenLastCalledWith("singles");
    expect(singles).toHaveAttribute("aria-pressed", "true");
    expect(singles).toHaveFocus();
  });

  it("scopes shared indicators so separate collection controls cannot cross-pair", () => {
    renderWithMotion(
      <>
        <section aria-label="Primary collection">
          <LibraryScreenChrome {...chromeProps("releases", vi.fn())} />
        </section>
        <section aria-label="Secondary collection">
          <LibraryScreenChrome {...chromeProps("singles", vi.fn())} />
        </section>
      </>,
    );

    const primary = screen.getByRole("region", {
      name: "Primary collection",
    });
    const secondary = screen.getByRole("region", {
      name: "Secondary collection",
    });
    const primaryPressed = within(primary).getByRole("button", {
      name: /All releases/,
    });
    const secondaryPressed = within(secondary).getByRole("button", {
      name: /Singles/,
    });
    expect(primaryPressed).toHaveAttribute("aria-pressed", "true");
    expect(secondaryPressed).toHaveAttribute("aria-pressed", "true");
    expect(
      primaryPressed.querySelector("[data-collection-browse-indicator]"),
    ).toBeInTheDocument();
    expect(
      secondaryPressed.querySelector("[data-collection-browse-indicator]"),
    ).toBeInTheDocument();
    expect(
      primary.querySelectorAll("[data-collection-browse-indicator]"),
    ).toHaveLength(1);
    expect(
      secondary.querySelectorAll("[data-collection-browse-indicator]"),
    ).toHaveLength(1);
  });

  it("commits rapid choices latest-wins without remounting chrome or invoking a view transition", () => {
    const onChooseMode = vi.fn();
    const viewTransition = installViewTransitionSpy();

    try {
      renderWithMotion(<StatefulChrome onChooseMode={onChooseMode} />);
      const chrome = screen.getByRole("navigation", {
        name: "Browse collection",
      });
      const search = screen.getByPlaceholderText("Search your collection");

      fireEvent.click(screen.getByRole("button", { name: /Artists/ }));
      fireEvent.click(screen.getByRole("button", { name: /Singles/ }));
      fireEvent.click(screen.getByRole("button", { name: /Albums & EPs/ }));

      expect(onChooseMode.mock.calls.map(([mode]) => mode)).toEqual([
        "artists",
        "singles",
        "albums",
      ]);
      expect(
        screen.getByRole("button", { name: /Albums & EPs/ }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        screen.getByRole("navigation", { name: "Browse collection" }),
      ).toBe(chrome);
      expect(screen.getByPlaceholderText("Search your collection")).toBe(
        search,
      );
      expect(viewTransition.startViewTransition).not.toHaveBeenCalled();
    } finally {
      viewTransition.restore();
    }
  });

  it("uses the restrained shared-indicator motion profile", () => {
    const { unmount } = renderWithMotion(
      <LibraryScreenChrome {...chromeProps("releases", vi.fn())} />,
    );

    expect(
      screen.getByRole("button", { name: /All releases/ })
        .querySelector("[data-collection-browse-indicator]"),
    ).toHaveAttribute("data-selection-travel-steps", "0");
    expect(codaMotion.selectionPill).toEqual({
      type: "spring",
      visualDuration: 0.3,
      bounce: 0.04,
    });

    unmount();
    renderWithMotion(
      <LibraryScreenChrome {...chromeProps("releases", vi.fn())} />,
      "always",
    );

    expect(
      screen.getByRole("button", { name: /All releases/ })
        .querySelector("[data-collection-browse-indicator]"),
    ).toBeInTheDocument();
  });
});

describe("Collection genre filters", () => {
  it("glides one controlled pressed-chip indicator without becoming a tablist", async () => {
    const user = userEvent.setup();
    const onGenreChange = vi.fn();
    const viewTransition = installViewTransitionSpy();
    const filterActions = {
      onGenreChange,
      onGenreRailScroll: vi.fn(),
      onScrollGenres: vi.fn(),
      onSortChange: vi.fn(),
    };
    const filterModel = {
      kind: "collection" as const,
      genre: "All",
      genres: ["Rock", "Jazz"],
      edges: { start: false, end: false },
      trailingControl: "sort" as const,
      sort: "recent" as const,
    };
    try {
      const { rerender } = renderWithMotion(
        <LibraryScreenChrome
          {...chromeProps("releases", vi.fn())}
          filter={{ model: filterModel, actions: filterActions }}
        />,
      );
      const allGenres = screen.getByRole("button", { name: "All" });
      const rock = screen.getByRole("button", { name: "Rock" });

      expect(
        screen.getByRole("navigation", {
          name: "Filter collection by genre",
        }),
      ).not.toHaveAttribute("role", "tablist");
      expect(allGenres).toHaveAttribute("aria-pressed", "true");
      expect(
        allGenres.querySelector("[data-selection-rail-indicator]"),
      ).toBeInTheDocument();
      expect(
        allGenres.querySelector("[data-selection-rail-indicator]"),
      ).toHaveClass("pointer-events-none");
      expect(allGenres).not.toHaveClass("overflow-hidden");

      await user.click(allGenres);
      expect(onGenreChange).toHaveBeenCalledWith("All");

      rock.focus();
      await user.keyboard("{Enter}");
      expect(onGenreChange).toHaveBeenCalledWith("Rock");

      rerender(
        <MotionConfig reducedMotion="never">
          <LibraryScreenChrome
            {...chromeProps("releases", vi.fn())}
            filter={{
              model: { ...filterModel, genre: "Rock" },
              actions: filterActions,
            }}
          />
        </MotionConfig>,
      );

      expect(rock).toHaveAttribute("aria-pressed", "true");
      expect(
        rock.querySelector("[data-selection-rail-indicator]"),
      ).toBeInTheDocument();
      expect(
        rock.querySelector("[data-selection-rail-indicator]"),
      ).toHaveAttribute("data-selection-travel-steps", "1");
      expect(viewTransition.startViewTransition).not.toHaveBeenCalled();
    } finally {
      viewTransition.restore();
    }
  });

  it("omits the genre rail when a detail route does not provide filter state", () => {
    renderWithMotion(
      <LibraryScreenChrome {...chromeProps("releases", vi.fn())} />,
    );

    expect(
      screen.queryByRole("navigation", {
        name: "Filter collection by genre",
      }),
    ).not.toBeInTheDocument();
  });

  it("snaps the selected genre indicator for reduced motion", () => {
    renderWithMotion(
      <LibraryScreenChrome
        {...chromeProps("releases", vi.fn())}
        filter={{
          model: {
            kind: "collection",
            genre: "Rock",
            genres: ["Rock", "Jazz"],
            edges: { start: false, end: false },
            trailingControl: "artists",
            sort: "artist",
          },
          actions: {
            onGenreChange: vi.fn(),
            onGenreRailScroll: vi.fn(),
            onScrollGenres: vi.fn(),
            onSortChange: vi.fn(),
          },
        }}
      />,
      "always",
    );

    expect(
      screen.getByRole("button", { name: "Rock" })
        .querySelector("[data-selection-rail-indicator]"),
    ).toBeInTheDocument();
  });
});
