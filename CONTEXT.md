# Coda

Coda presents a listener's Bandcamp library alongside anonymous Bandcamp
editorial programming and desktop playback.

## Bandcamp Radio

**Radio Provider**:
Bandcamp Radio, the source that publishes every Radio series and episode.
_Avoid_: Artist, show

**Radio Series**:
A recurring Bandcamp Radio program, such as The Hip Hop Show.
_Avoid_: Artist, provider, episode

**Radio Episode**:
One dated broadcast within a Radio series, identified by Bandcamp's stable
numeric show ID.
_Avoid_: Series, album

**Radio Host**:
The person presenting an episode. A host is display metadata and is not a Coda
library artist unless the episode provides a separately validated artist link.
_Avoid_: Provider, series
