import { useLayoutEffect } from "react";

import {
  RadioIndexScreen,
  RadioSeriesScreen,
} from "@/features/radio/RadioArchiveScreen";
import { useRadioRouteNavigation } from "@/features/radio/RadioRouteNavigationState";
import { useRadioRuntime } from "@/features/radio/RadioRuntimeContext";
import type { RadioSeriesId } from "@/routing/routeContracts";

export function RadioArchiveRoute({
  seriesId,
}: Readonly<{
  seriesId?: RadioSeriesId;
}>) {
  const runtime = useRadioRuntime();
  const navigation = useRadioRouteNavigation();

  useLayoutEffect(() => {
    navigation.restoreArchiveContext(seriesId);
  }, [navigation.restoreArchiveContext, seriesId]);

  const screenProps = {
    currentTrackId: runtime.currentTrackId,
    favoriteShowIds: runtime.favoriteShowIds,
    onOpenShow: navigation.openShow,
    onPlay: runtime.onPlay,
    onQueue: runtime.onQueue,
    onSelectSeries: navigation.selectSeries,
    onToggleFavorite: runtime.onToggleFavorite,
    onTogglePlayback: runtime.onTogglePlayback,
    playing: runtime.playing,
    returningArtworkId: navigation.returningArtworkId,
    seriesTravelSteps: navigation.seriesTravelSteps,
  };

  return seriesId ? (
    <RadioSeriesScreen {...screenProps} seriesId={seriesId} />
  ) : (
    <RadioIndexScreen {...screenProps} />
  );
}
