export type Album = {
  id: string;
  title: string;
  artist: string;
  songCount: number;
  duration: number;
  coverArt?: string;
  artworkUrl?: string;
  year?: number;
  genre?: string;
  addedAt?: string;
  tracks?: Track[];
  palette: [string, string];
};

export type Track = {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumId: string;
  duration: number;
  track: number;
  disc?: number;
  coverArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  palette: [string, string];
};

export type ConnectionInput = {
  username: string;
  password: string;
};

export type RepeatMode = "off" | "all" | "one";
export type SortMode = "recent" | "artist" | "title" | "year";

export type DiscoverSort = "top" | "new";

export type DiscoverFilters = {
  tag: string;
  sort: DiscoverSort;
};

export type DiscoverRelease = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  location?: string;
  itemUrl: string;
  artworkUrl?: string;
  featuredTrack?: {
    id: string;
    title: string;
    duration: number;
    streamUrl: string;
  };
};

export type DiscoverPage = {
  results: DiscoverRelease[];
  resultCount: number;
  cursor?: string;
  hasMore: boolean;
};
