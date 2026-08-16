import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const eventHandlers = new Set<(event: { payload: unknown }) => void>();
  return {
    convertFileSrc: vi.fn(
      (path: string, protocol: string) => `${protocol}:${path}`,
    ),
    eventHandlers,
    invoke: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    listen: vi.fn(
      (_event: string, handler: (event: { payload: unknown }) => void) => {
        eventHandlers.add(handler);
        return Promise.resolve(() => eventHandlers.delete(handler));
      },
    ),
  };
});

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: mocks.convertFileSrc,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

vi.mock("@/lib", () => ({
  initials: (value: string) => value.slice(0, 2),
}));

import { clearCoverArtRendererState } from "@/coverArtSource";
import { CoverArt, type CoverArtAlbum } from "./CoverArt";

function album({
  artworkUrl,
  coverArt = "cover-1",
}: {
  artworkUrl?: string;
  coverArt?: string;
} = {}): CoverArtAlbum {
  return {
    artist: "Test Artist",
    artworkUrl,
    coverArt,
    id: "album-1",
    palette: ["#c46f59", "#17191b"],
    title: "Test Album",
  };
}

function coverImage(): HTMLImageElement {
  return screen.getByRole("img", {
    name: "Test Album cover",
  });
}

beforeEach(() => {
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
  document.documentElement.classList.remove("coda-view-transitioning");
  clearCoverArtRendererState();
  mocks.convertFileSrc.mockClear();
  mocks.invoke.mockClear().mockResolvedValue(undefined);
});

describe("CoverArt", () => {
  it("renders an authenticated local source on the first commit", () => {
    render(<CoverArt album={album()} />);

    expect(coverImage().getAttribute("src")).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(coverImage().parentElement).toHaveClass("bg-(--cover-base)");
    expect(coverImage().parentElement).not.toHaveTextContent("Test Artist");
    expect(mocks.convertFileSrc).toHaveBeenCalledWith("", "coda-cover");
    expect(coverImage()).toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");

    fireEvent.load(coverImage());

    expect(coverImage()).not.toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).toHaveAttribute("data-cover-art-reveal");
  });

  it("restores a previously painted local source eagerly on remount", () => {
    const first = render(
      <CoverArt album={album({ coverArt: "warm-cover" })} />,
    );
    expect(coverImage()).toHaveAttribute("loading", "eager");
    expect(coverImage()).toHaveAttribute("decoding", "async");
    expect(coverImage()).toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");
    fireEvent.load(coverImage());
    expect(coverImage()).not.toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).toHaveAttribute("data-cover-art-reveal");
    fireEvent.animationEnd(coverImage());
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");
    first.unmount();

    render(<CoverArt album={album({ coverArt: "warm-cover" })} />);
    expect(coverImage()).toHaveAttribute("loading", "eager");
    expect(coverImage()).toHaveAttribute("decoding", "sync");
    expect(coverImage()).not.toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");
  });

  it("animates an explicit artwork change even when its source is warm", () => {
    const first = render(
      <CoverArt album={album({ coverArt: "animated-cover" })} />,
    );
    fireEvent.load(coverImage());
    first.unmount();

    render(
      <CoverArt album={album({ coverArt: "animated-cover" })} animateChanges />,
    );

    expect(coverImage()).toHaveAttribute("decoding", "sync");
    expect(coverImage()).toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");

    fireEvent.load(coverImage());

    expect(coverImage()).not.toHaveAttribute("data-cover-art-pending");
    expect(coverImage()).toHaveAttribute("data-cover-art-reveal");
  });

  it("keeps shared-transition artwork paintable without a local reveal", () => {
    document.documentElement.classList.add("coda-view-transitioning");

    render(
      <CoverArt
        album={album({ coverArt: "transition-cover" })}
        albumArtworkDetail="album-1"
      />,
    );

    expect(coverImage()).not.toHaveAttribute("data-cover-art-pending");
    fireEvent.load(coverImage());
    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");
  });

  it("settles a local reveal when a native transition cancels its animation", () => {
    render(
      <CoverArt
        album={album({ coverArt: "cancelled-reveal-cover" })}
        animateChanges
      />,
    );
    fireEvent.load(coverImage());
    expect(coverImage()).toHaveAttribute("data-cover-art-reveal");

    document.documentElement.classList.add("coda-view-transitioning");
    fireEvent(coverImage(), new Event("animationcancel", { bubbles: true }));
    document.documentElement.classList.remove("coda-view-transitioning");

    expect(coverImage()).not.toHaveAttribute("data-cover-art-reveal");
  });

  it("updates the source revision after native content changes", async () => {
    render(
      <StrictMode>
        <CoverArt album={album({ coverArt: "revision-cover" })} />
      </StrictMode>,
    );

    const initialSource = coverImage().getAttribute("src");
    const sessionScope = initialSource?.match(/&s=([a-f0-9]{32})$/)?.[1];
    expect(initialSource).toMatch(
      /^coda-cover:\/v1\/600\/revision-cover\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(sessionScope).toBeDefined();
    expect(mocks.listen).toHaveBeenCalledTimes(1);

    for (const handler of mocks.eventHandlers) {
      handler({
        payload: { coverArtId: "revision-cover", revision: "sha256_A1" },
      });
    }

    await waitFor(() =>
      expect(coverImage()).toHaveAttribute(
        "src",
        `coda-cover:/v1/600/revision-cover?v=sha256_A1&s=${sessionScope}`,
      ),
    );
    expect(mocks.listen).toHaveBeenCalledTimes(1);
  });

  it("invalidates one broken local entry, retries once, then falls back", async () => {
    let finishInvalidation: () => void = () => undefined;
    mocks.invoke.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishInvalidation = resolve;
        }),
    );
    const view = render(
      <CoverArt album={album({ coverArt: "broken-cover" })} />,
    );
    const artwork = view.container.querySelector('[data-slot="cover"]');
    const firstSource = coverImage().getAttribute("src");

    fireEvent.error(coverImage());

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    expect(mocks.invoke).toHaveBeenCalledWith("invalidate_cover_art", {
      coverArtId: "broken-cover",
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(artwork).not.toHaveTextContent("Test Artist");

    finishInvalidation();
    await waitFor(() =>
      expect(coverImage().getAttribute("src")).not.toBe(firstSource),
    );

    fireEvent.error(coverImage());

    expect(
      screen.queryByRole("img", { name: "Test Album cover" }),
    ).not.toBeInTheDocument();
    expect(artwork).toHaveTextContent("Test Artist");
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });

  it("preserves direct artwork and transition markers", () => {
    render(
      <CoverArt
        album={album({
          artworkUrl: "https://bandcamp.com/direct.jpg",
          coverArt: "",
        })}
        albumArtworkDetail="album-1"
        artistArtworkDetail="artist-1"
      />,
    );

    expect(coverImage()).toHaveAttribute(
      "src",
      "https://bandcamp.com/direct.jpg",
    );
    expect(coverImage().parentElement).toHaveAttribute(
      "data-coda-album-artwork-detail",
      "album-1",
    );
    expect(coverImage().parentElement).toHaveAttribute(
      "data-coda-artist-artwork-detail",
      "artist-1",
    );
  });

  it("clears a failed source when artwork refresh is requested", async () => {
    render(<CoverArt album={album({ coverArt: "refresh-cover" })} />);
    fireEvent.error(coverImage());
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledOnce());
    fireEvent.error(coverImage());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));

    await waitFor(() => expect(coverImage()).toBeInTheDocument());
  });
});
