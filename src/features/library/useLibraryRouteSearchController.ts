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
  type AlbumId,
  type ArtistKey,
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

type LibraryNavigationBase = Readonly<{
  replace: true;
  resetScroll: false;
  viewTransition: false;
}>;

export type LibraryRouteNavigateRequest =
  | (LibraryNavigationBase &
      Readonly<{
        search: CollectionRouteSearch;
        to: "/collection" | "/recent";
      }>)
  | (LibraryNavigationBase &
      Readonly<{
        params: Readonly<{ albumId: AlbumId }>;
        search: CollectionRouteSearch;
        to: "/collection/albums/$albumId";
      }>)
  | (LibraryNavigationBase &
      Readonly<{
        params: Readonly<{ artistKey: ArtistKey }>;
        search: CollectionRouteSearch & Readonly<{ albumId?: AlbumId }>;
        to: "/collection/artists/$artistKey";
      }>);

export type LibraryRouteNavigate = (
  request: LibraryRouteNavigateRequest,
) => void | Promise<void>;

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
  const routerNavigate = useNavigate();
  const navigate = useCallback<LibraryRouteNavigate>(
    (request) => {
      switch (request.to) {
        case "/collection":
        case "/recent":
        case "/collection/albums/$albumId":
        case "/collection/artists/$artistKey":
          return routerNavigate(request);
        default: {
          const unhandledRequest: never = request;
          return unhandledRequest;
        }
      }
    },
    [routerNavigate],
  );
  return useLibraryRouteSearchControllerWithNavigation(
    { routeInput, search },
    navigate,
  );
}

export function useLibraryRouteSearchControllerWithNavigation(
  { routeInput, search }: LibraryRouteSearchControllerOptions,
  navigate: LibraryRouteNavigate,
): LibraryRouteSearchController {
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
        case "artist": {
          const artistSearch = routeInput.sourceAlbumId
            ? { ...nextSearch, albumId: routeInput.sourceAlbumId }
            : nextSearch;
          void navigate({
            ...navigationOptions,
            params: { artistKey: routeInput.artistKey },
            search: artistSearch,
            to: "/collection/artists/$artistKey",
          });
          return;
        }
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
