import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deriveLibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  validateCollectionSearch,
} from "@/routing/routeContracts";

const routerMocks = vi.hoisted(() => ({
  navigate: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => routerMocks.navigate,
}));

import { useLibraryRouteSearchController } from "./useLibraryRouteSearchController";

beforeEach(() => {
  routerMocks.navigate.mockReset();
});

describe("library route search controller", () => {
  it("updates each generated library destination without changing history or scroll", () => {
    const cases = [
      {
        routeInput: deriveLibraryRouteInput({
          screen: "recent",
          search: { q: "drone" },
        }),
        expected: {
          search: {
            genre: "Ambient",
            mode: "releases",
            q: "drone",
            sort: "recent",
          },
          to: "/recent",
        },
      },
      {
        routeInput: deriveLibraryRouteInput({
          albumId: "album-1",
          screen: "album",
          search: { q: "drone" },
        }),
        expected: {
          params: { albumId: "album-1" },
          search: {
            genre: "Ambient",
            mode: "releases",
            q: "drone",
            sort: "recent",
          },
          to: "/collection/albums/$albumId",
        },
      },
      {
        routeInput: deriveLibraryRouteInput({
          artistKey: "night archive",
          screen: "artist",
          search: { q: "drone" },
          sourceAlbumId: "compilation-1",
        }),
        expected: {
          params: { artistKey: "night archive" },
          search: {
            albumId: "compilation-1",
            genre: "Ambient",
            mode: "releases",
            q: "drone",
            sort: "recent",
          },
          to: "/collection/artists/$artistKey",
        },
      },
    ] as const;

    for (const { expected, routeInput } of cases) {
      const { result, unmount } = renderHook(() =>
        useLibraryRouteSearchController({
          routeInput,
          search: validateCollectionSearch({ q: "drone" }),
        }),
      );

      act(() => result.current.commands.changeGenre(" Ambient "));

      expect(routerMocks.navigate).toHaveBeenLastCalledWith({
        ...expected,
        replace: true,
        resetScroll: false,
        viewTransition: false,
      });
      unmount();
    }
  });

  it("moves browse choices and artist-detail searches onto Collection", () => {
    const routeInput = deriveLibraryRouteInput({
      artistKey: "night archive",
      screen: "artist",
      search: { genre: "Jazz", mode: "artists", q: "night" },
    });
    const { result } = renderHook(() =>
      useLibraryRouteSearchController({
        routeInput,
        search:
          routeInput.kind === "artist"
            ? routeInput.collectionSearch
            : validateCollectionSearch(undefined),
      }),
    );

    act(() => result.current.commands.changeQuery("  ambient  "));

    expect(routerMocks.navigate).toHaveBeenLastCalledWith({
      replace: true,
      resetScroll: false,
      search: {
        genre: "Jazz",
        mode: "artists",
        q: "ambient",
        sort: "recent",
      },
      to: "/collection",
      viewTransition: false,
    });

    act(() => result.current.commands.chooseBrowseMode("singles"));

    expect(routerMocks.navigate).toHaveBeenLastCalledWith({
      replace: true,
      resetScroll: false,
      search: {
        genre: "Jazz",
        mode: "singles",
        q: "night",
        sort: "recent",
      },
      to: "/collection",
      viewTransition: false,
    });
  });

  it("clears to the validated Collection defaults", () => {
    const routeInput = deriveLibraryRouteInput({
      screen: "recent",
      search: { genre: "Jazz", q: "night", sort: "year" },
    });
    const { result } = renderHook(() =>
      useLibraryRouteSearchController({
        routeInput,
        search:
          routeInput.kind === "recent"
            ? routeInput.collectionSearch
            : validateCollectionSearch(undefined),
      }),
    );

    act(() => result.current.commands.clearFilters());

    expect(routerMocks.navigate).toHaveBeenCalledWith({
      replace: true,
      resetScroll: false,
      search: DEFAULT_COLLECTION_ROUTE_SEARCH,
      to: "/collection",
      viewTransition: false,
    });
  });

  it("ignores only the stale deferred query after an artist reset commits", async () => {
    const initialSearch = validateCollectionSearch({ q: "compilation" });
    const initialRoute = deriveLibraryRouteInput({
      screen: "collection",
      search: initialSearch,
    });
    const { result, rerender } = renderHook(
      ({ routeInput, search }) =>
        useLibraryRouteSearchController({ routeInput, search }),
      {
        initialProps: {
          routeInput: initialRoute,
          search: initialSearch,
        },
      },
    );
    const prepared = result.current.commands.prepareArtistSearch();

    expect(prepared.search).toEqual({
      genre: "All",
      mode: "releases",
      q: "",
      sort: "recent",
    });
    expect(result.current.state.ignoreDeferredArtistQuery).toBe(false);

    act(() => prepared.commitDeferredReset());
    rerender({ routeInput: initialRoute, search: initialSearch });

    expect(result.current.state.deferredQuery).toBe("compilation");
    expect(result.current.state.ignoreDeferredArtistQuery).toBe(true);

    const resetSearch = prepared.search;
    const artistRoute = deriveLibraryRouteInput({
      artistKey: "guest voice",
      screen: "artist",
      search: resetSearch,
    });
    rerender({ routeInput: artistRoute, search: resetSearch });

    await waitFor(() => expect(result.current.state.deferredQuery).toBe(""));
    await waitFor(() =>
      expect(result.current.state.ignoreDeferredArtistQuery).toBe(false),
    );
  });

  it("keeps Artists mode when preparing artist search from the Artists tab", () => {
    const initialSearch = validateCollectionSearch({
      genre: "Jazz",
      mode: "artists",
      q: "night",
    });
    const { result } = renderHook(() =>
      useLibraryRouteSearchController({
        routeInput: deriveLibraryRouteInput({
          screen: "collection",
          search: initialSearch,
        }),
        search: initialSearch,
      }),
    );

    expect(result.current.commands.prepareArtistSearch().search).toEqual({
      genre: "All",
      mode: "artists",
      q: "",
      sort: "recent",
    });
  });

  it("keeps All releases mode when searching from an artist opened in that mode", () => {
    const artistSearch = validateCollectionSearch({ mode: "releases", q: "" });
    const { result } = renderHook(() =>
      useLibraryRouteSearchController({
        routeInput: deriveLibraryRouteInput({
          artistKey: "guest voice",
          screen: "artist",
          search: artistSearch,
        }),
        search: artistSearch,
      }),
    );

    act(() => result.current.commands.changeQuery("  ambient  "));

    expect(routerMocks.navigate).toHaveBeenLastCalledWith({
      replace: true,
      resetScroll: false,
      search: {
        genre: "All",
        mode: "releases",
        q: "ambient",
        sort: "recent",
      },
      to: "/collection",
      viewTransition: false,
    });
  });
});
