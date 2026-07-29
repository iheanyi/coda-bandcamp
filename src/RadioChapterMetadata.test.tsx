import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RadioChapterCopy } from "./RadioChapterMetadata";
import type { RadioChapter } from "./types";

const chapter: RadioChapter = {
  title: "Mirage",
  artist: "Sweeps",
  album: "Mirage",
  timecode: 30,
  itemUrl: "https://sweepsbeats.bandcamp.com/track/mirage",
  artistUrl: "https://sweepsbeats.bandcamp.com",
  albumUrl: "https://sweepsbeats.bandcamp.com/album/mirage",
};

describe("RadioChapterCopy navigation", () => {
  it("prefers available Coda destinations over external URLs", () => {
    const onOpen = vi.fn();
    const openTrack = vi.fn();
    const openArtist = vi.fn();
    const openAlbum = vi.fn();
    render(
      <RadioChapterCopy
        chapter={chapter}
        className="chapter"
        onOpen={onOpen}
        localLinks={{
          track: openTrack,
          artist: openArtist,
          album: openAlbum,
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Find Mirage by Sweeps in Coda",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Open artist Sweeps in Coda",
    }));
    fireEvent.click(screen.getByRole("button", {
      name: "Open album Mirage in Coda",
    }));

    expect(openTrack).toHaveBeenCalledOnce();
    expect(openArtist).toHaveBeenCalledOnce();
    expect(openAlbum).toHaveBeenCalledOnce();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("makes the Bandcamp fallback explicit when no local destination exists", () => {
    const onOpen = vi.fn();
    render(
      <RadioChapterCopy
        chapter={chapter}
        className="chapter"
        onOpen={onOpen}
      />,
    );

    const trackLink = screen.getByRole("button", {
      name: "Open Mirage by Sweeps on Bandcamp",
    });
    expect(trackLink).toHaveAttribute(
      "title",
      "Not in your library — open track on Bandcamp",
    );
    expect(trackLink).toHaveTextContent("Mirage");
    expect(trackLink.querySelector("svg")).toBeInTheDocument();

    fireEvent.click(trackLink);
    expect(onOpen).toHaveBeenCalledWith(
      "https://sweepsbeats.bandcamp.com/track/mirage",
    );
  });
});
