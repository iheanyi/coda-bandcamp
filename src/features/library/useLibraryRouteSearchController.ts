import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  type RefObject,
} from "react";

import type { LibraryRouteInput } from "@/routing/libraryRouteInput";
import {
  DEFAULT_COLLECTION_ROUTE_SEARCH,
  type CollectionRouteSearch,
  validateCollectionSearch,
} from "@/routing/routeContracts";
import type { LibraryBrowseMode } from "@/libraryBrowse";
import type { SortMode } from "@/types";

export type PreparedArtistSearch = Readonly<{
  commitDeferredReset: () => void;
  search: CollectionRouteSearch;
}>;

export type LibraryRouteSearchController = Readonly<{
  commands: Readonly<{
    changeGenre: (genre: string) => void;
    changeQuery: (query: string) => void;
    changeSort: (sort: SortMode) => void;
    chooseBrowseMode: (mode: LibraryBrowseMode) => void;
    clearFilters: () => void;
    prepareArtistSearch: () => PreparedArtistSearch;
    replace: (update: Partial<CollectionRouteSearch>) => void;
  }>;
  refs: Readonly<{
    search: RefObject<HTMLInputElement | null>;
  }>;
  state: Readonly<{
    deferredQuery: string;
    ignoreDeferredArtistQuery: boolean;
    search: CollectionRouteSearch;
  }>;
}>;

export type LibraryRouteSearchControllerOptions = Readonly<{
  routeInput: LibraryRouteInput;
  search: CollectionRouteSearch;
}>;

function normalizedDeferredQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Owns the validated search contract for the Collection route family. It
 * changes only Router search state and never mirrors remote library data.
 */
export function useLibraryRouteSearchController({
  routeInput,
  search,
}: LibraryRouteSearchControllerOptions): LibraryRouteSearchController {
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const artistDeferredResetPendingRef = useRef(false);
  const validatedSearch = useMemo(
    () => validateCollectionSearch(search),
    [search],
  );
  const deferredQuery = useDeferredValue(
    normalizedDeferredQuery(validatedSearch.q),
  );

  useEffect(() => {
    if (!deferredQuery) artistDeferredResetPendingRef.current = false;
  }, [deferredQuery]);

  const replace = useCallback(
    (update: Partial<CollectionRouteSearch>) => {
      const nextSearch = validateCollectionSearch({
        ...validatedSearch,
        ...update,
      });
      const navigationOptions = {
        replace: true,
        resetScroll: false,
        viewTransition: false,
      } as const;

      switch (routeInput.kind) {
        case "recent":
          void navigate({
            ...navigationOptions,
            search: nextSearch,
            to: "/recent",
          });
          return;
        case "album":
          void navigate({
            ...navigationOptions,
            params: { albumId: routeInput.albumId },
            search: nextSearch,
            to: "/collection/albums/$albumId",
          });
          return;
        case "artist":
          void navigate({
            ...navigationOptions,
            params: { artistKey: routeInput.artistKey },
            search: {
              ...nextSearch,
              ...(routeInput.sourceAlbumId
                ? { albumId: routeInput.sourceAlbumId }
                : {}),
            },
            to: "/collection/artists/$artistKey",
          });
          return;
        case "collection":
        case "inactive":
          void navigate({
            ...navigationOptions,
            search: nextSearch,
            to: "/collection",
          });
      }
    },
    [navigate, routeInput, validatedSearch],
  );

  const chooseBrowseMode = useCallback(
    (mode: LibraryBrowseMode) => {
      void navigate({
        replace: true,
        resetScroll: false,
        search: validateCollectionSearch({ ...validatedSearch, mode }),
        to: "/collection",
        viewTransition: false,
      });
    },
    [navigate, validatedSearch],
  );

  const changeQuery = useCallback(
    (query: string) => {
      artistDeferredResetPendingRef.current = false;
      if (routeInput.kind === "artist") {
        void navigate({
          replace: true,
          resetScroll: false,
          search: validateCollectionSearch({
            ...validatedSearch,
            mode: "artists",
            q: query,
          }),
          to: "/collection",
          viewTransition: false,
        });
        return;
      }
      replace({ q: query });
    },
    [navigate, replace, routeInput.kind, validatedSearch],
  );

  const clearFilters = useCallback(() => {
    artistDeferredResetPendingRef.current = false;
    void navigate({
      replace: true,
      resetScroll: false,
      search: DEFAULT_COLLECTION_ROUTE_SEARCH,
      to: "/collection",
      viewTransition: false,
    });
  }, [navigate]);

  const prepareArtistSearch = useCallback<() => PreparedArtistSearch>(() => {
    const artistSearch = validateCollectionSearch({
      ...validatedSearch,
      genre: "All",
      mode: "artists",
      q: "",
    });
    return {
      commitDeferredReset: () => {
        artistDeferredResetPendingRef.current = true;
      },
      search: artistSearch,
    };
  }, [validatedSearch]);
  const changeGenre = useCallback(
    (genre: string) => replace({ genre }),
    [replace],
  );
  const changeSort = useCallback(
    (sort: SortMode) => replace({ sort }),
    [replace],
  );

  return {
    commands: {
      changeGenre,
      changeQuery,
      changeSort,
      chooseBrowseMode,
      clearFilters,
      prepareArtistSearch,
      replace,
    },
    refs: { search: searchRef },
    state: {
      deferredQuery,
      ignoreDeferredArtistQuery:
        Boolean(deferredQuery) && artistDeferredResetPendingRef.current,
      search: validatedSearch,
    },
  };
}
