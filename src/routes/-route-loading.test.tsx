import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AlbumRoutePending,
  ArtistRoutePending,
} from "@/features/library/LibraryDetailRouteStatus";
import { Route as AlbumRoute } from "@/routes/collection/albums/$albumId";
import { Route as ArtistRoute } from "@/routes/collection/artists/$artistKey";
import { Route as CollectionIndexRoute } from "@/routes/collection/index";
import { Route as CollectionLayoutRoute } from "@/routes/collection/route";
import { DiscoverReleasePending } from "@/routes/discover/-release-status";
import { Route as DiscoverIndexRoute } from "@/routes/discover/index";
import { Route as DiscoverReleaseRoute } from "@/routes/discover/releases/$releaseId";
import { Route as DiscoverLayoutRoute } from "@/routes/discover/route";
import { Route as DailyArticleRoute } from "@/routes/daily/$slug";
import { Route as DailyIndexRoute } from "@/routes/daily/index";
import { Route as DailyLayoutRoute } from "@/routes/daily/route";
import { Route as FavoritesRoute } from "@/routes/favorites";
import { Route as NowPlayingRoute } from "@/routes/now-playing";
import { Route as PlaylistRoute } from "@/routes/playlists/$playlistId";
import { Route as PlaylistsIndexRoute } from "@/routes/playlists/index";
import { Route as PlaylistsLayoutRoute } from "@/routes/playlists/route";
import { Route as RadioLayoutRoute } from "@/routes/radio";
import {
  RadioArchivePending,
  RadioShowPending,
} from "@/routes/radio/-radio-route-status";
import { Route as RadioIndexRoute } from "@/routes/radio/index";
import { Route as RadioSeriesRoute } from "@/routes/radio/series/$seriesId";
import { Route as RadioShowRoute } from "@/routes/radio/shows/$showId";
import { Route as RecentRoute } from "@/routes/recent";
import {
  CollectionRoutePending,
  DiscoverRoutePending,
  DailyRoutePending,
  FavoritesRoutePending,
  NowPlayingRoutePending,
  PlaylistRoutePending,
  PlaylistsRoutePending,
  RecentRoutePending,
} from "./-route-loading";

describe("route loading boundaries", () => {
  it("covers every visible file-route destination", () => {
    expect(CollectionLayoutRoute.options.pendingComponent).toBe(
      CollectionRoutePending,
    );
    expect(CollectionIndexRoute.options.pendingComponent).toBe(
      CollectionRoutePending,
    );
    expect(AlbumRoute.options.pendingComponent).toBe(AlbumRoutePending);
    expect(ArtistRoute.options.pendingComponent).toBe(ArtistRoutePending);
    expect(RecentRoute.options.pendingComponent).toBe(RecentRoutePending);
    expect(FavoritesRoute.options.pendingComponent).toBe(FavoritesRoutePending);
    expect(PlaylistsLayoutRoute.options.pendingComponent).toBe(
      PlaylistsRoutePending,
    );
    expect(PlaylistsIndexRoute.options.pendingComponent).toBe(
      PlaylistsRoutePending,
    );
    expect(PlaylistRoute.options.pendingComponent).toBe(PlaylistRoutePending);
    expect(DiscoverLayoutRoute.options.pendingComponent).toBe(
      DiscoverRoutePending,
    );
    expect(DiscoverIndexRoute.options.pendingComponent).toBe(
      DiscoverRoutePending,
    );
    expect(DiscoverReleaseRoute.options.pendingComponent).toBe(
      DiscoverReleasePending,
    );
    expect(DailyLayoutRoute.options.pendingComponent).toBe(DailyRoutePending);
    expect(DailyIndexRoute.options.pendingComponent).toBe(DailyRoutePending);
    expect(DailyArticleRoute.options.pendingComponent).toBe(DailyRoutePending);
    expect(RadioLayoutRoute.options.pendingComponent).toBe(RadioArchivePending);
    expect(RadioIndexRoute.options.pendingComponent).toBe(RadioArchivePending);
    expect(RadioSeriesRoute.options.pendingComponent).toBe(RadioArchivePending);
    expect(RadioShowRoute.options.pendingComponent).toBe(RadioShowPending);
    expect(NowPlayingRoute.options.pendingComponent).toBe(
      NowPlayingRoutePending,
    );
  });

  it("shows one accessible, reduced-motion-safe spinner for a cold route", () => {
    const { container } = render(<RecentRoutePending />);

    const status = screen.getByRole("status", {
      name: "Loading recent additions…",
    });
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent(
      "Preparing the newest releases in your saved library.",
    );

    const spinner = container.querySelector('[data-slot="spinner"]');
    expect(spinner).toBeInTheDocument();
    expect(spinner).toHaveClass("motion-reduce:animate-none");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });
});
