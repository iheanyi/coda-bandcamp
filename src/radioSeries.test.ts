import { describe, expect, it } from "vitest";
import {
  BANDCAMP_RADIO_SERIES,
  radioSeriesByTitle,
} from "./radioSeries";

describe("Bandcamp Radio links", () => {
  it("keeps all six in-Coda show archives explicit", () => {
    expect(BANDCAMP_RADIO_SERIES.map(({ id, slug }) => ({ id, slug }))).toEqual([
      { id: 1, slug: "bandcamp-electronic" },
      { id: 2, slug: "bandcamp-selects" },
      { id: 4, slug: "the-game-show" },
      { id: 5, slug: "the-hip-hop-show" },
      { id: 6, slug: "the-indie-show" },
      { id: 7, slug: "the-metal-show" },
    ]);
  });

  it("resolves a Now Playing album label to its in-Coda archive", () => {
    expect(radioSeriesByTitle("The Hip Hop Show")).toMatchObject({
      id: 5,
      slug: "the-hip-hop-show",
    });
  });
});
