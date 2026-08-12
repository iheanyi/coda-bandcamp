import { cn } from "@/lib/utils";
import { ArtistScreen, type ArtistScreenProps } from "./ArtistScreen";
import type { ReadyLibraryScreenResource } from "./LibraryRouteRuntime";

export type ArtistRouteScreenProps = Readonly<{
  className?: string;
  resource: ReadyLibraryScreenResource<ArtistScreenProps>;
}>;

export function ArtistRouteScreen({
  className,
  resource,
}: ArtistRouteScreenProps) {
  return (
    <ArtistScreen
      {...resource.value}
      className={cn(resource.value.className, className)}
    />
  );
}
