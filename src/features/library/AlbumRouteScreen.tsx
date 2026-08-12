import { cn } from "@/lib/utils";
import { AlbumScreen, type AlbumScreenProps } from "./AlbumScreen";
import type { ReadyLibraryScreenResource } from "./LibraryRouteRuntime";

export type AlbumRouteScreenProps = Readonly<{
  className?: string;
  resource: ReadyLibraryScreenResource<AlbumScreenProps>;
}>;

export function AlbumRouteScreen({
  className,
  resource,
}: AlbumRouteScreenProps) {
  return (
    <AlbumScreen
      {...resource.value}
      className={cn(resource.value.className, className)}
    />
  );
}
