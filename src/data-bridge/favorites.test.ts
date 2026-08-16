import { describe, expect, it } from "vitest";
import {
  parseNativeFavoriteCollection,
  parseNativeFavoriteMutationResult,
  parseNativeFavoriteTrackReconciliation,
} from "./favorites";

const favoriteCollection = {
  albumIds: [],
  songIds: [],
  albums: [],
  tracks: [],
};

const favoriteMutation = {
  accepted: true,
  verification: "verified",
  favorite: true,
};

const favoriteTrackReconciliation = {
  tracks: [],
  unstarredIds: [],
  unavailableTrackCount: 0,
};

describe("favorite native decoders", () => {
  it("requires root fields to be own data properties", () => {
    let getterCalls = 0;
    const collectionWithAccessor = { ...favoriteCollection };
    Object.defineProperty(collectionWithAccessor, "albumIds", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("collection getter must not run");
      },
    });
    const mutationWithAccessor = { ...favoriteMutation };
    Object.defineProperty(mutationWithAccessor, "accepted", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("mutation getter must not run");
      },
    });
    const reconciliationWithAccessor = {
      ...favoriteTrackReconciliation,
    };
    Object.defineProperty(reconciliationWithAccessor, "tracks", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("reconciliation getter must not run");
      },
    });

    expect(() =>
      parseNativeFavoriteCollection(Object.create(favoriteCollection))
    ).toThrow("Invalid native response for fetch_favorites");
    expect(() =>
      parseNativeFavoriteMutationResult(Object.create(favoriteMutation))
    ).toThrow("Invalid native response for set_favorite");
    expect(() =>
      parseNativeFavoriteTrackReconciliation(
        Object.create(favoriteTrackReconciliation),
      )
    ).toThrow("Invalid native response for reconcile_favorite_tracks");
    expect(() =>
      parseNativeFavoriteCollection(collectionWithAccessor)
    ).toThrow("Invalid native response for fetch_favorites.albumIds");
    expect(() =>
      parseNativeFavoriteMutationResult(mutationWithAccessor)
    ).toThrow("Invalid native response for set_favorite.accepted");
    expect(() =>
      parseNativeFavoriteTrackReconciliation(reconciliationWithAccessor)
    ).toThrow("Invalid native response for reconcile_favorite_tracks.tracks");
    expect(getterCalls).toBe(0);
  });

  it("rejects unsafe array entries before decoding them", () => {
    let getterCalls = 0;
    const albumIds = ["album-1"];
    Object.defineProperty(albumIds, "0", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("favorite array getter must not run");
      },
    });
    const proxy = new Proxy(
      { ...favoriteCollection },
      {
        get() {
          getterCalls += 1;
          throw new Error("favorite proxy getter must not run");
        },
        getOwnPropertyDescriptor() {
          throw new Error("descriptor inspection denied");
        },
      },
    );

    expect(() =>
      parseNativeFavoriteCollection({
        ...favoriteCollection,
        albumIds,
      })
    ).toThrow("Invalid native response for fetch_favorites.albumIds[0]");
    expect(() => parseNativeFavoriteCollection(proxy)).toThrow(
      "Invalid native response for fetch_favorites",
    );
    expect(getterCalls).toBe(0);
  });
});
