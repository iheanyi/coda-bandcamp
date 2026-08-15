import { describe, expect, it } from "vitest";

import { parseAlbumIdParam } from "@/routing/routeContracts";

import { libraryArtistRouteSearch } from "./libraryLinkSearch";

describe("libraryArtistRouteSearch", () => {
  it("clears collection filters without forcing Artists mode", () => {
    expect(
      libraryArtistRouteSearch({
        genre: "Jazz",
        mode: "releases",
        q: "hx.26",
        sort: "title",
      }),
    ).toEqual({
      genre: "All",
      mode: "releases",
      q: "",
      sort: "title",
    });
  });

  it("keeps Artists mode when the origin was the Artists tab", () => {
    expect(
      libraryArtistRouteSearch(
        { genre: "Ambient", mode: "artists", q: "Signal", sort: "artist" },
        "album-1",
      ),
    ).toEqual({
      albumId: parseAlbumIdParam("album-1"),
      genre: "All",
      mode: "artists",
      q: "",
      sort: "artist",
    });
  });
});
