import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchDiscover: vi.fn(),
  openBandcampUrl: vi.fn(),
}));

vi.mock("./lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib")>();
  return {
    ...actual,
    fetchDiscover: mocks.fetchDiscover,
    openBandcampUrl: mocks.openBandcampUrl,
  };
});

import DiscoverView from "./DiscoverView";

function renderDiscover(onQueue = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    onQueue,
    ...render(
      <QueryClientProvider client={client}>
        <DiscoverView onPlay={vi.fn()} onQueue={onQueue} />
      </QueryClientProvider>,
    ),
  };
}

beforeEach(() => {
  mocks.fetchDiscover.mockReset().mockResolvedValue({
    results: [
      {
        id: "release-1",
        title: "Blue Hours",
        artist: "Signal Garden",
        location: "Chicago, Illinois",
        itemUrl: "https://signal-garden.bandcamp.com/album/blue-hours",
        featuredTrack: {
          id: "preview-1",
          title: "Glass Lines",
          duration: 201,
          streamUrl: "https://t4.bcbits.com/stream/example",
        },
      },
    ],
    resultCount: 1,
    hasMore: false,
  });
});

describe("Discover", () => {
  it("loads previews, queues a result, and supports the full genre selector", async () => {
    const { onQueue } = renderDiscover();

    expect(await screen.findByText("Blue Hours")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Add to queue/ }));
    expect(onQueue).toHaveBeenCalledWith(expect.objectContaining({
      id: "preview-1",
      album: "Blue Hours",
    }));

    fireEvent.change(screen.getByLabelText("More Discover genres"), {
      target: { value: "jazz" },
    });
    await waitFor(() =>
      expect(mocks.fetchDiscover).toHaveBeenLastCalledWith(
        expect.objectContaining({ tag: "jazz" }),
        "*",
      ),
    );
    expect(await screen.findByText("Jazz · Chicago, Illinois")).toBeInTheDocument();
  });
});
