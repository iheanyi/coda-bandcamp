import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchCoverUrl: vi.fn<(coverArtId: string) => Promise<string>>(),
  invalidateCoverUrl: vi.fn<(coverArtId: string) => void>(),
}));

vi.mock("@/lib", () => ({
  fetchCoverUrl: mocks.fetchCoverUrl,
  initials: (value: string) => value.slice(0, 2),
  invalidateCoverUrl: mocks.invalidateCoverUrl,
  isDesktop: () => true,
}));

import { CoverArt, type CoverArtAlbum } from "./CoverArt";

const sourceA = "https://bandcamp.com/cover-a.jpg";
const resolvedB = "https://bandcamp.com/cover-b.jpg";
const sourceC = "https://bandcamp.com/cover-c.jpg";
const resolvedD = "https://bandcamp.com/cover-d.jpg";

function album(artworkUrl: string): CoverArtAlbum {
  return {
    artist: "Test Artist",
    artworkUrl,
    coverArt: "cover-1",
    id: "album-1",
    palette: ["#c46f59", "#17191b"],
    title: "Test Album",
  };
}

beforeEach(() => {
  mocks.fetchCoverUrl.mockReset();
  mocks.invalidateCoverUrl.mockReset();
});

describe("CoverArt", () => {
  it("recovers a failed prop URL through the cover cache and resets failure scope for a later prop URL", async () => {
    mocks.fetchCoverUrl
      .mockResolvedValueOnce(resolvedB)
      .mockResolvedValueOnce(resolvedD);
    const { rerender } = render(
      <CoverArt
        album={album(sourceA)}
        albumArtworkDetail="album-1"
        artistArtworkDetail="artist-1"
      />,
    );

    const wrapper = screen.getByRole("img", {
      name: "Test Album cover",
    }).parentElement;
    expect(wrapper).toHaveAttribute(
      "data-coda-album-artwork-detail",
      "album-1",
    );
    expect(wrapper).toHaveAttribute(
      "data-coda-artist-artwork-detail",
      "artist-1",
    );
    expect(
      screen.getByRole("img", { name: "Test Album cover" }),
    ).toHaveAttribute("src", sourceA);

    fireEvent.error(screen.getByRole("img", { name: "Test Album cover" }));

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Test Album cover" }),
      ).toHaveAttribute("src", resolvedB),
    );
    expect(mocks.invalidateCoverUrl).toHaveBeenCalledExactlyOnceWith("cover-1");
    expect(mocks.fetchCoverUrl).toHaveBeenCalledExactlyOnceWith("cover-1");

    rerender(
      <CoverArt
        album={album(sourceC)}
        albumArtworkDetail="album-1"
        artistArtworkDetail="artist-1"
      />,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Test Album cover" }),
      ).toHaveAttribute("src", sourceC),
    );

    fireEvent.error(screen.getByRole("img", { name: "Test Album cover" }));
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Test Album cover" }),
      ).toHaveAttribute("src", resolvedD),
    );
    expect(mocks.invalidateCoverUrl).toHaveBeenCalledTimes(2);
    expect(mocks.fetchCoverUrl).toHaveBeenCalledTimes(2);
  });

  it("keeps one artwork-refresh listener through Strict Mode remounts", async () => {
    mocks.fetchCoverUrl.mockResolvedValue(resolvedB);
    const { unmount } = render(
      <StrictMode>
        <CoverArt album={album("")} />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: "Test Album cover" }),
      ).toHaveAttribute("src", resolvedB),
    );
    mocks.fetchCoverUrl.mockClear();

    window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));
    await waitFor(() => expect(mocks.fetchCoverUrl).toHaveBeenCalledOnce());

    unmount();
    mocks.fetchCoverUrl.mockClear();
    window.dispatchEvent(new CustomEvent("coda:refresh-artwork"));
    await Promise.resolve();
    expect(mocks.fetchCoverUrl).not.toHaveBeenCalled();
  });
});
