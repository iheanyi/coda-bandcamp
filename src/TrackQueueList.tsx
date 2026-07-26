import type { Track } from "./types";
import {
  VirtualizedQueueList,
  type VirtualizedQueueListProps,
} from "./VirtualizedQueueList";

export default function TrackQueueList(
  props: VirtualizedQueueListProps<Track>,
) {
  return <VirtualizedQueueList<Track> {...props} />;
}
