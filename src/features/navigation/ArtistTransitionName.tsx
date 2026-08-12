import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";
import type { ArtistKey } from "@/routing/routeContracts";

export type ArtistTransitionNameProps = ComponentProps<"span"> &
  Readonly<{
    artistKey: ArtistKey;
  }>;

/** Keeps shared artist motion on the glyphs instead of the interactive link box. */
export function ArtistTransitionName({
  artistKey,
  className,
  ...props
}: ArtistTransitionNameProps) {
  return (
    <span
      className={cn("inline-block max-w-full", className)}
      data-coda-artist-name-target={artistKey}
      {...props}
    />
  );
}
