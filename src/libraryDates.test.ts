import { describe, expect, it } from "vitest";
import {
  compareAlbumsByNewestAdded,
  formatAlbumReleaseDate,
  isItemDate,
  parseLibraryDate,
  sortAlbumsByNewestAdded,
  sortAlbumsByNewestRelease,
} from "./libraryDates";

const album = (
  id: string,
  addedAt?: string,
  artist = "Artist",
  title = `Release ${id}`,
) => ({ id, addedAt, artist, title });

describe("library dates", () => {
  it("sorts Bandcamp created dates chronologically instead of lexically", () => {
    const releases = [
      album("june", "30 Jun 2025 12:00:00 GMT"),
      album("july", "02 Jul 2025 12:00:00 GMT"),
    ];

    expect(
      [...releases]
        .sort((left, right) =>
          (right.addedAt ?? "").localeCompare(left.addedAt ?? ""),
        )
        .map(({ id }) => id),
    ).toEqual(["june", "july"]);
    expect(
      [...releases].sort(compareAlbumsByNewestAdded).map(({ id }) => id),
    ).toEqual(["july", "june"]);
  });

  it("normalizes ISO timestamps with offsets", () => {
    expect(parseLibraryDate("2026-01-01T00:30:00+01:00")).toBe(
      Date.parse("2025-12-31T23:30:00Z"),
    );
    expect(parseLibraryDate("2026-01-01T00:15:00-05:30")).toBe(
      Date.parse("2026-01-01T05:45:00Z"),
    );
    expect(
      [
        album("offset", "2026-01-01T00:30:00+01:00"),
        album("utc", "2025-12-31T23:45:00Z"),
      ]
        .sort(compareAlbumsByNewestAdded)
        .map(({ id }) => id),
    ).toEqual(["utc", "offset"]);
  });

  it("places invalid and missing dates after valid dates", () => {
    const releases = [
      album("missing"),
      album("invalid-month", "30 Nope 2025 12:00:00 GMT"),
      album("invalid-day", "2025-02-29T12:00:00Z"),
      album("valid", "01 Jan 2025 00:00:00 GMT"),
    ];

    expect(parseLibraryDate(releases[1].addedAt)).toBeUndefined();
    expect(parseLibraryDate(releases[2].addedAt)).toBeUndefined();
    expect(
      [...releases].sort(compareAlbumsByNewestAdded).map(({ id }) => id),
    ).toEqual(["valid", "invalid-day", "invalid-month", "missing"]);
  });

  it("breaks equal-date ties by artist, title, then id", () => {
    const addedAt = "2025-01-01T00:00:00Z";
    const releases = [
      album("z", addedAt, "Bravo", "Alpha"),
      album("b", addedAt, "Alpha", "Beta"),
      album("c", addedAt, "Alpha", "Alpha"),
      album("a", addedAt, "Alpha", "Alpha"),
    ];

    expect(
      [...releases].sort(compareAlbumsByNewestAdded).map(({ id }) => id),
    ).toEqual(["a", "c", "b", "z"]);
  });

  it("preserves fractional precision beyond JavaScript milliseconds", () => {
    const releases = [
      album("earlier", "2025-01-01T00:00:00.1231Z"),
      album("later", "2025-01-01T00:00:00.1239Z"),
      album("latest", "01 Jan 2025 00:00:00.1240001 GMT"),
    ];

    expect(sortAlbumsByNewestAdded(releases).map(({ id }) => id)).toEqual([
      "latest",
      "later",
      "earlier",
    ]);
    expect(releases.map(({ id }) => id)).toEqual(["earlier", "later", "latest"]);
  });

  it("sorts precise and partial release dates without conflating them with added dates", () => {
    const releases = [
      { ...album("legacy"), year: 2022 },
      { ...album("original"), originalReleaseDate: { year: 2023, month: 8 } },
      {
        ...album("edition"),
        addedAt: "01 Jan 2020 00:00:00 GMT",
        originalReleaseDate: { year: 1999, month: 12, day: 31 },
        releaseDate: { year: 2024, month: 2, day: 29 },
      },
      { ...album("unknown"), addedAt: "31 Dec 2026 00:00:00 GMT" },
    ];

    expect(
      sortAlbumsByNewestRelease(releases).map(({ id }) => id),
    ).toEqual(["edition", "original", "legacy", "unknown"]);
    expect(formatAlbumReleaseDate(releases[2])).toBe("February 29, 2024");
  });

  it("validates complete OpenSubsonic ItemDate precision", () => {
    expect(isItemDate({ year: 2026 })).toBe(true);
    expect(isItemDate({ year: 2026, month: 8 })).toBe(true);
    expect(isItemDate({ year: 2024, month: 2, day: 29 })).toBe(true);
    expect(isItemDate({})).toBe(false);
    expect(isItemDate({ year: 2026, day: 10 })).toBe(false);
    expect(isItemDate({ year: 2025, month: 2, day: 29 })).toBe(false);
  });
});
