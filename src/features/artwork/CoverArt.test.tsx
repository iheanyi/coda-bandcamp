import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCoverArtRendererState } from "@/coverArtSource";
import {
  installTauriEventPluginTestInternals,
  readTauriInvokeArguments,
  tauriString,
} from "@/test/tauriInvoke";
import { CoverArt, type CoverArtAlbum } from "./CoverArt";

type CoverArtRevisionPayload = Readonly<{
  coverArtId: string;
  revision: string;
}>;

type CoverArtEvent = Readonly<{
  event: string;
  id: number;
  payload: CoverArtRevisionPayload;
}>;

type CoverArtEventHandler = (event: CoverArtEvent) => void;

const artworkBridge = {
  callbacks: new Map<number, CoverArtEventHandler>(),
  convertFileSrc: vi.fn(
    (path: string, protocol: string) => `${protocol}:${path}`,
  ),
  invalidate: vi.fn<(coverArtId: string) => Promise<void>>()
    .mockResolvedValue(undefined),
  listen: vi.fn<() => Promise<number>>().mockResolvedValue(1),
  nextCallbackId: 1,
};

function installArtworkBridge(): void {
  installTauriEventPluginTestInternals();
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {
      convertFileSrc: artworkBridge.convertFileSrc,
      invoke: async (command: string, args?: InvokeArgs) => {
        if (command === "plugin:event|listen") return artworkBridge.listen();
        if (command === "invalidate_cover_art") {
          return artworkBridge.invalidate(
            tauriString(
              readTauriInvokeArguments(args).coverArtId,
              "coverArtId",
            ),
          );
        }
        if (command === "plugin:event|unlisten") return undefined;
        throw new Error(`Unexpected artwork command: ${command}`);
      },
      transformCallback: (handler: CoverArtEventHandler) => {
        const callbackId = artworkBridge.nextCallbackId++;
        artworkBridge.callbacks.set(callbackId, handler);
        return callbackId;
      },
      unregisterCallback: (callbackId: number) => {
        artworkBridge.callbacks.delete(callbackId);
      },
    },
  });
}

function emitArtworkRevision(payload: CoverArtRevisionPayload): void {
  for (const [id, handler] of artworkBridge.callbacks) {
    handler({
      event: "coda://cover-art-updated",
      id,
      payload,
    });
  }
}

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
  installArtworkBridge();
  document.documentElement.classList.remove("coda-view-transitioning");
  clearCoverArtRendererState();
  artworkBridge.callbacks.clear();
  artworkBridge.convertFileSrc.mockClear();
  artworkBridge.invalidate.mockReset().mockResolvedValue(undefined);
  artworkBridge.listen.mockClear();
  artworkBridge.nextCallbackId = 1;
});

describe("CoverArt", () => {
  it("renders an authenticated local source on the first commit", () => {
    render(<CoverArt album={album()} />);

    expect(coverImage().getAttribute("src")).toMatch(
      /^coda-cover:\/v1\/600\/cover-1\?v=0&s=[a-f0-9]{32}$/,
    );
    expect(coverImage().parentElement).toHaveClass("bg-(--cover-base)");
    expect(coverImage().parentElement).not.toHaveTextContent("Test Artist");
    expect(artworkBridge.convertFileSrc).toHaveBeenCalledWith("", "coda-cover");
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
    expect(artworkBridge.listen).toHaveBeenCalledTimes(1);

    emitArtworkRevision({
      coverArtId: "revision-cover",
      revision: "sha256_A1",
    });

    await waitFor(() =>
      expect(coverImage()).toHaveAttribute(
        "src",
        `coda-cover:/v1/600/revision-cover?v=sha256_A1&s=${sessionScope}`,
      ),
    );
    expect(artworkBridge.listen).toHaveBeenCalledTimes(1);
  });

  it("invalidates one broken local entry, retries once, then falls back", async () => {
    let finishInvalidation: () => void = () => undefined;
    artworkBridge.invalidate.mockImplementationOnce(
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

    await waitFor(() => expect(artworkBridge.invalidate).toHaveBeenCalledOnce());
    expect(artworkBridge.invalidate).toHaveBeenCalledWith("broken-cover");
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
    expect(artworkBridge.invalidate).toHaveBeenCalledOnce();
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
    await waitFor(() => expect(artworkBridge.invalidate).toHaveBeenCalledOnce());
    fireEvent.error(coverImage());
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));

    await waitFor(() => expect(coverImage()).toBeInTheDocument());
  });
});
