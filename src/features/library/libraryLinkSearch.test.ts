import { describe, expect, it } from "vitest";

import {
  libraryArtistRouteSearch,
  resetCollectionSearchForArtist,
} from "./libraryLinkSearch";

describe("library artist route search", () => {
  it("resets genre, browse mode, and query for artist navigation", () => {
    expect(
      resetCollectionSearchForArtist({
        genre: "Jazz",
        mode: "albums",
        q: "night",
        sort: "recent",
      }),
    ).toEqual({
      genre: "All",
      mode: "artists",
      q: "",
      sort: "recent",
    });
  });

  it("overlays a source album id on the artist search", () => {
    expect(
      libraryArtistRouteSearch(
        { genre: "Electronic", mode: "releases", q: "glass" },
        "album-22",
      ),
    ).toEqual({
      albumId: "album-22",
      genre: "All",
      mode: "artists",
      q: "",
      sort: "recent",
    });
  });
});
