import { cn } from "@/lib/utils";
import { useRecentRouteScreenProps } from "./LibraryRouteRuntime";
import { RecentScreen } from "./RecentScreen";

export type RecentRouteScreenProps = Readonly<{
  className?: string;
}>;

export function RecentRouteScreen({
  className,
}: RecentRouteScreenProps = {}) {
  const screenProps = useRecentRouteScreenProps();
  return (
    <RecentScreen
      {...screenProps}
      className={cn(screenProps.className, className)}
    />
  );
}
