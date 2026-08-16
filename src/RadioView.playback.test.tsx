import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { radioServices, renderRadio, show, shows } from "./test/radioViewTestHarness";

describe("Bandcamp Radio playback behavior", () => {

  it("loads the archive and plays the latest signed show stream", async () => {
    const { onPlay } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(screen.getByText("2 broadcasts loaded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play latest show" }));

    await waitFor(() =>
      expect(radioServices.fetchShow).toHaveBeenCalledWith(979),
    );
    expect(onPlay).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "radio:979",
        artist: "Bandcamp Radio",
        album: "The Hip Hop Show",
        streamUrl: show.streamUrl,
        radioChapters: show.chapters,
      }),
    );
  });

  it("matches the latest show button to Now Playing and toggles it without reloading", async () => {
    const onTogglePlayback = vi.fn();
    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      currentTrackId: "radio:979",
      playing: true,
      onTogglePlayback,
    });

    await screen.findByRole("heading", { name: "Kinrose" });
    const pause = screen.getByRole("button", { name: "Pause latest show" });
    expect(pause).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(pause);

    expect(onTogglePlayback).toHaveBeenCalledOnce();
    expect(radioServices.fetchShow).not.toHaveBeenCalled();
  });

  it("adds an archive show to the queue and opens only its verified Bandcamp page", async () => {
    const archiveShow = { ...show, ...shows[1], title: "Bandcamp Weekly" };
    vi.mocked(radioServices.fetchShow).mockResolvedValueOnce(archiveShow);
    const { onQueue } = renderRadio();

    await screen.findByRole("heading", { name: "The Best of 2026" });
    const queueShow = screen.getByRole("button", {
      name: "Add The Best of 2026 to queue",
    });
    fireEvent.click(queueShow);
    await waitFor(() =>
      expect(onQueue).toHaveBeenCalledWith(
        expect.objectContaining({ id: "radio:978" }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Open The Best of 2026 on Bandcamp",
      }),
    );
    expect(radioServices.openBandcampUrl).toHaveBeenCalledWith(
      "https://bandcamp.com/radio?show=978",
    );
  });

  it("opens show details lazily and plays a chapter from its timecode", async () => {
    const { onPlayAt } = renderRadio();

    await screen.findByRole("heading", { name: "Kinrose" });
    expect(radioServices.fetchShow).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    await screen.findByRole("button", {
      name: "Play Mirage from 2:00",
    });
    expect(radioServices.fetchShow).toHaveBeenCalledWith(979);

    expect(onPlayAt).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Play Mirage from 2:00",
      }),
    );
    expect(onPlayAt).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "radio:979",
        radioChapters: show.chapters,
      }),
      120,
    );
  });

  it("keeps the live chapter highlighted in the Radio detail tracklist", async () => {
    renderRadio(vi.fn(), vi.fn(), vi.fn(), {
      currentTrackId: "radio:979",
      currentTime: 130,
      playing: true,
    });

    await screen.findByRole("heading", { name: "Kinrose" });
    fireEvent.click(screen.getByRole("link", { name: "View tracklist" }));

    const pauseChapter = await screen.findByRole("button", {
      name: "Pause Mirage",
    });
    expect(pauseChapter).toHaveAttribute("aria-pressed", "true");
    expect(pauseChapter.closest("li")).toHaveAttribute("aria-current", "true");
  });
});
