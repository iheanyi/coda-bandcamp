export type ItemDate = {
  year: number;
  month?: number;
  day?: number;
};

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
  starredAt?: string;
  playedAt?: string;
  originalReleaseDate?: ItemDate;
  releaseDate?: ItemDate;
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
  albumArtist?: string;
  musicBrainzId?: string;
  coverArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  radioChapters?: RadioChapter[];
  discoverRelease?: DiscoverRelease;
  palette: [string, string];
};

export type PlaylistSummary = {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount: number;
  duration: number;
  createdAt?: string;
  changedAt?: string;
  coverArt?: string;
};

export type PlaylistDetail = PlaylistSummary & {
  tracks: Track[];
};

export type PlaylistUpdateInput = {
  playlistId: string;
  name?: string;
  comment?: string;
  public?: boolean;
  songIdsToAdd?: string[];
  songIndexesToRemove?: number[];
};

export type FavoriteCollection = {
  albumIds: string[];
  songIds: string[];
  albums: Album[];
  tracks: Track[];
};

export type FavoriteInput = {
  id: string;
  kind: "song" | "album";
  favorite: boolean;
};

export type ConnectionInput = {
  username: string;
  password: string;
};

export type LastFmStatus = {
  configured: boolean;
  connected: boolean;
  username?: string;
};

export type LastFmAuthorization = {
  authorizationUrl: string;
  token: string;
};

export type LastFmTrackInput = {
  artist: string;
  title: string;
  album: string;
  albumArtist?: string;
  musicBrainzId?: string;
  duration: number;
  trackNumber: number;
  chosenByUser?: boolean;
};

export type RepeatMode = "off" | "all" | "one";
export type SortMode = "recent" | "artist" | "title" | "year";
export type ScrobbleState = "idle" | "pending" | "sent" | "failed";

export type PlayerStateTrack = Omit<
  Track,
  "albumArtist" | "artworkUrl" | "musicBrainzId" | "streamUrl"
>;

export type LastFmPlaybackProgress = {
  trackId: string;
  startedAt: number;
  listenedSeconds: number;
  lastPosition: number;
  nowPlayingSent: boolean;
  scrobbleState: ScrobbleState;
};

export type RadioScrobbleProgress = {
  showTrackId: string;
  activeChapterKey?: string;
  chapterStartedAt: number;
  chapterListenedSeconds: number;
  lastPosition: number;
  chapterNowPlayingSent: boolean;
  chapterScrobbleState: ScrobbleState;
  showStartedAt: number;
  showListenedSeconds: number;
  showScrobbleState: ScrobbleState;
  scrobbledChapterKeys: string[];
};

export type PlayerStateSnapshot = {
  version: 1;
  savedAt: number;
  queue: PlayerStateTrack[];
  currentIndex: number;
  positionSeconds: number;
  volume: number;
  repeatMode: RepeatMode;
  queueOpen: boolean;
  lastFmProgress?: LastFmPlaybackProgress;
  radioScrobbleProgress?: RadioScrobbleProgress;
};

export type PlayerStateInput = Omit<PlayerStateSnapshot, "savedAt" | "version">;

export type PlayerStateCheckpoint = {
  currentIndex: number;
  currentTrackId: string;
  positionSeconds: number;
  lastFmProgress?: LastFmPlaybackProgress;
  radioScrobbleProgress?: RadioScrobbleProgress;
};

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

export type RadioSeries = {
  id: number;
  title: string;
  slug: string;
};

export type RadioShowSummary = {
  id: number;
  subtitle: string;
  description: string;
  publishedAt: string;
  artworkUrl?: string;
  series?: RadioSeries;
};

export type RadioShowsPage = {
  results: RadioShowSummary[];
  cursor?: string;
  hasMore: boolean;
};

export type LocalFavoriteCollection = FavoriteCollection & {
  radioShowIds: number[];
  radioShows: RadioShowSummary[];
};

export type RadioChapter = {
  title: string;
  artist: string;
  album?: string;
  timecode: number;
  itemUrl?: string;
  artistUrl?: string;
  albumUrl?: string;
  artworkUrl?: string;
};

export type RadioShow = RadioShowSummary & {
  title: string;
  duration: number;
  streamUrl: string;
  chapters: RadioChapter[];
};
