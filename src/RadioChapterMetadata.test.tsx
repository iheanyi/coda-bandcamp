import { QueryClient } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RadioChapterArtwork, RadioChapterCopy } from "@/RadioChapterMetadata";
import { createCodaMemoryRouter } from "@/router";
import {
  parseAlbumIdParam,
  parseArtistKeyParam,
} from "@/routing/routeContracts";
import type { RadioChapter } from "@/types";

const chapter: RadioChapter = {
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  timecode: 30,
  itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage",
  artistUrl: "https://sweepsbeats.bandcamp.com",
  albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
};

function linkLocation(link: HTMLElement) {
  const href = link.getAttribute("href");
  if (!href) throw new Error("Expected a semantic link href.");
  return new URL(href, "https://coda.local");
}

describe("RadioChapterCopy navigation", () => {
  it("prefers typed Coda links over external URLs", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const openTrack = vi.fn();
    const openArtist = vi.fn();
    const openAlbum = vi.fn();
    const router = createCodaMemoryRouter(new QueryClient(), ["/radio"]);
    await router.load();
    render(
      <RouterContextProvider router={router}>
        <RadioChapterCopy
          chapter={chapter}
          className=""
          onOpen={onOpen}
          localLinks={{
            track: {
              albumId: parseAlbumIdParam("mirage-album"),
              onNavigate: openTrack,
            },
            artist: {
              artistKey: parseArtistKeyParam("sweeps"),
              sourceAlbumId: parseAlbumIdParam("mirage-album"),
              onNavigate: openArtist,
            },
            album: {
              albumId: parseAlbumIdParam("mirage-album"),
              onNavigate: openAlbum,
            },
          }}
        />
      </RouterContextProvider>,
    );

    const trackLink = screen.getByRole("link", {
      name: "Find Mirage by Sweeps in Coda",
    });
    const trackLocation = linkLocation(trackLink);
    expect(trackLocation.pathname).toBe("/collection/albums/mirage-album");
    expect(Object.fromEntries(trackLocation.searchParams)).toEqual({
      genre: "All",
      mode: "releases",
      q: "",
      sort: "recent",
    });
    expect(
      linkLocation(
        screen.getByRole("link", {
          name: "Open artist Sweeps in Coda",
        }),
      ).pathname,
    ).toBe("/collection/artists/sweeps");
    expect(
      linkLocation(
        screen.getByRole("link", {
          name: "Open album Mirage in Coda",
        }),
      ).pathname,
    ).toBe("/collection/albums/mirage-album");

    trackLink.focus();
    await user.keyboard("{Enter}");
    fireEvent.click(
      screen.getByRole("link", {
        name: "Open artist Sweeps in Coda",
      }),
    );
    fireEvent.click(
      screen.getByRole("link", {
        name: "Open album Mirage in Coda",
      }),
    );

    expect(openTrack).toHaveBeenCalledOnce();
    expect(openArtist).toHaveBeenCalledOnce();
    expect(openAlbum).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
    expect(
      document.querySelector("a button, button a"),
    ).not.toBeInTheDocument();
  });

  it("makes the Bandcamp fallback explicit when no local destination exists", () => {
    const onOpen = vi.fn();
    render(<RadioChapterCopy chapter={chapter} className="" onOpen={onOpen} />);

    const trackLink = screen.getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(trackLink).toHaveAttribute(
      "title",
      "Not in your library — open track on Bandcamp",
    );
    expect(trackLink).toHaveTextContent("Mirage");

    fireEvent.click(trackLink);
    expect(onOpen).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage",
    );
  });
});

describe("RadioChapterArtwork recovery", () => {
  it("shows recovered artwork when the chapter URL changes after an error", () => {
    const { container, rerender } = render(
      <RadioChapterArtwork
        chapter={{ ...chapter, artworkUrl: "https://f4.bcbits.com/a.jpg" }}
        index={0}
      />,
    );
    const failedImage = container.querySelector("img");
    if (!failedImage) throw new Error("Expected Radio artwork");

    fireEvent.error(failedImage);
    expect(failedImage).toHaveAttribute("hidden");

    rerender(
      <RadioChapterArtwork
        chapter={{ ...chapter, artworkUrl: "https://f4.bcbits.com/b.jpg" }}
        index={0}
      />,
    );
    const recoveredImage = container.querySelector("img");
    if (!recoveredImage) throw new Error("Expected recovered Radio artwork");
    expect(recoveredImage).not.toHaveAttribute("hidden");

    fireEvent.load(recoveredImage);
    expect(recoveredImage).not.toHaveAttribute("hidden");
  });
});
