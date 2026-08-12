import { cn } from "@/lib/utils";
import { CollectionScreen } from "./CollectionScreen";
import { useCollectionRouteScreenProps } from "./LibraryRouteRuntime";

export type CollectionRouteScreenProps = Readonly<{
  className?: string;
}>;

export function CollectionRouteScreen({
  className,
}: CollectionRouteScreenProps = {}) {
  const screenProps = useCollectionRouteScreenProps();
  return (
    <CollectionScreen
      {...screenProps}
      className={cn(screenProps.className, className)}
    />
  );
}
