# Subsonic, OpenSubsonic, and Bandcamp favorites support

Accessed: 2026-08-12

## Conclusion

The premise that the protocol has no favorites mechanism is incorrect. The
Subsonic protocol calls favorites **stars** and defines read, add, remove, and
filtered-list operations for them. It separately defines 1–5 star ratings.
Subsonic **bookmarks are playback positions inside media files**, not another
name for favorites.

Bandcamp's public launch announcement does not promise stars, ratings, or
bookmarks. It advertises collection streaming/downloading and playlist
creation/editing. That omission is not proof that those other protocol methods
are absent.

A read-only probe of Bandcamp's live beta endpoint found that Bandcamp does
implement at least part of the read side of stars: `getStarred` returned a
successful standard Subsonic response containing a starred album with a
`starred` timestamp. However, adjacent behavior is incomplete or inconsistent:
`getStarred2` did not return a Subsonic response, and the result of
`getAlbumList2?type=starred` did not reconcile with `getStarred`.

A subsequent user-authorized mutation probe established asymmetric behavior.
`star` successfully added one previously unstarred album, and a fresh
`getStarred` read returned it. Album `unstar` then failed for every standard
parameter and transport tested, leaving that test album starred. A later
single-track probe established a different beta inconsistency: Bandcamp
accepted and persisted a song `star`, and the exact song returned by `getAlbum`
carried a `starred` timestamp, while `getStarred` continued to return zero
songs. Song-star writes therefore exist, but Bandcamp does not globally
enumerate them through the read endpoint Coda can use.

The same probe found no usable bookmark read support: `getBookmarks` returned a
nonstandard top-level error rather than a Subsonic response. Because Bandcamp's
service is explicitly an open beta, these findings are a dated snapshot rather
than a permanent contract.

## What the protocols define

The original Subsonic API and the OpenSubsonic documentation agree on the
relevant core methods:

| Concept | Methods and fields | Protocol meaning |
| --- | --- | --- |
| Read favorites | [`getStarred`](https://opensubsonic.netlify.app/docs/endpoints/getstarred/), [`getStarred2`](https://opensubsonic.netlify.app/docs/endpoints/getstarred2/) | Return starred songs, albums, and artists. `getStarred2` is the ID3-tag-organized variant. Both date from API 1.8.0. |
| Filter albums to favorites | [`getAlbumList2`](https://opensubsonic.netlify.app/docs/endpoints/getalbumlist2/) with `type=starred` | Retrieve starred albums through the album-list API. |
| Add/remove favorites | [`star`](https://opensubsonic.netlify.app/docs/endpoints/star/), [`unstar`](https://opensubsonic.netlify.app/docs/endpoints/unstar/) | Attach or remove a star for one or more songs, albums, or artists. The ID3-oriented parameters are `albumId` and `artistId`; `id` covers a file or folder. Both date from API 1.8.0. |
| Represent favorite state | [`starred` on `AlbumID3`](https://opensubsonic.netlify.app/docs/responses/albumid3/) and corresponding artist/media response fields | Optional ISO 8601 timestamp recording when the item was starred. |
| Ratings | [`setRating`](https://opensubsonic.netlify.app/docs/endpoints/setrating/) and `userRating` response fields | A separate per-item rating from 1 through 5; `0` removes the rating. This is not the binary star/favorite state. |
| Playback bookmarks | [`getBookmarks`](https://opensubsonic.netlify.app/docs/endpoints/getbookmarks/), [`createBookmark`](https://opensubsonic.netlify.app/docs/endpoints/createbookmark/), [`deleteBookmark`](https://opensubsonic.netlify.app/docs/endpoints/deletebookmark/) | A personal position in milliseconds within one media file, optionally with a comment. This is resume-position state, not save-for-later or favorite state. |

The original protocol owner's [Subsonic API reference](https://www.subsonic.org/pages/api.jsp)
describes the same division: `star`/`unstar`/`setRating` are media annotations,
while bookmarks are positions within media files. OpenSubsonic retains these as
core Subsonic endpoints; they are not OpenSubsonic-only extensions. The
OpenSubsonic [API method index](https://opensubsonic.netlify.app/docs/opensubsonic-api/)
lists stars, ratings, and bookmarks as separate groups.

## Why `unstar` error code `0` does not explain the failure

The protocol contract does not reveal a client-side reason for the observed
failure. The original Subsonic [`unstar` reference](https://www.subsonic.org/pages/api.jsp#unstar)
and OpenSubsonic's [`unstar` endpoint](https://opensubsonic.netlify.app/docs/endpoints/unstar/)
define the same operation, available since API 1.8.0:

- `id` removes a star from a song or from a file-tree album/artist;
- `albumId` removes a star from an ID3-organized album;
- `artistId` removes a star from an ID3-organized artist; and
- each parameter may be repeated to mutate multiple items.

All three item parameters are individually optional because the endpoint
accepts three item kinds; a normal request supplies at least one of them. On
success, the endpoint returns an otherwise empty `subsonic-response` with
`status=ok`. `star` has the identical parameter model and success shape, with
the opposite action. Coda's mapping therefore matches the specification: it
sends `albumId` for an album and `id` for a song, targets `unstar.view`, uses
token authentication, and requests API 1.16.1, which is newer than the 1.8.0
minimum.

There is one transport-level qualification. Original Subsonic documents these
parameters in the request URL. OpenSubsonic permits
`application/x-www-form-urlencoded` POST only through its optional
[`formPost` extension](https://opensubsonic.netlify.app/docs/extensions/formpost/),
and tells clients to check that the server advertises the extension before
using it. Bandcamp advertised an empty extension list in this snapshot, while
Coda currently sends the item parameter in a POST form body. That is worth
tracking as a strict compatibility issue. It does **not** explain this failure,
however: the authorized probe also sent the same `unstar` through a standard
GET query and received the same error for albums, tracks, `id`, and `albumId`.
`star` succeeded over both transports.

Subsonic's canonical [error table](https://www.subsonic.org/pages/api.jsp)
and OpenSubsonic's [`error` response](https://opensubsonic.netlify.app/docs/responses/error/)
define code `0` only as “a generic error.” It is a valid failure code but has
no more specific protocol meaning. In particular, it is not the value used for
a missing parameter (`10`), incompatible client/server versions (`20`/`30`),
bad credentials (`40`), insufficient authorization (`50`), or missing media
(`70`). It is also unrelated to `setRating`'s request value `rating=0`, which
removes a numeric rating rather than a star.

The narrow diagnosis is therefore server-side: Bandcamp received a
standards-shaped request, then returned a generic failure without an actionable
reason. Because the same account and IDs worked with `star`, and
`unstar` failed across every standard item parameter, transport, and compatible
API version tested, the evidence points to an incomplete or defective Bandcamp
beta `unstar` implementation rather than a Subsonic rule Coda violated. The
protocol cannot distinguish an internal Bandcamp exception from an intentionally
unsupported removal path. Bandcamp's own
[beta announcement](https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/)
promises streaming, downloads, and playlist editing, but does not document
stars or `unstar`, so there is no first-party Bandcamp detail that narrows the
generic error further.

## What Bandcamp documents

Bandcamp's first-party [Subsonic implementation announcement](https://blog.bandcamp.com/2026/07/16/discover-improvements-and-subsonic-implementation/)
says that:

- the service is an open beta;
- its server URL is `https://bandcamp.com/api/subsonic`;
- users generate dedicated credentials in Fan Settings;
- Bandcamp names Amperfy, Feishin, and Submariner as supported clients; and
- users can stream/download their collection and create/edit playlists that
  also appear in Bandcamp's web/app collection.

The announcement does **not** mention `getStarred`, `star`, `unstar`,
`setRating`, bookmarks, favorites, or wishlist synchronization. That is a limit
of the documented promise, not affirmative evidence that the endpoint lacks
those methods.

Bandcamp itself has a favorites-adjacent concept: the wishlist. Its
[Fan Page help](https://get.bandcamp.help/en/articles/15263087-how-do-i-edit-my-fan-page)
describes a heart control that removes a release from the wishlist. No
first-party source found in this review says that Subsonic stars map to that
wishlist. Such a mapping is plausible, but remains an inference until Bandcamp
documents it or a reversible write test proves it.

There is also a concrete client-compatibility wrinkle. Bandcamp names Amperfy
as a supported client, and Amperfy advertises [favorite-song support](https://github.com/BLeeEZ/amperfy#features).
In Amperfy's current
[`SubsonicServerApi.swift`](https://github.com/BLeeEZ/amperfy/blob/master/AmperfyKit/Api/Subsonic/SubsonicServerApi.swift),
`requestFavoriteElements` calls `getStarred2`, while its favorite mutations call
`star` or `unstar`. Bandcamp rejected the former route in this probe; the live
mutation check found that album `star` worked but album `unstar` did not.
Therefore “Amperfy is supported”
cannot be read as a guarantee that Amperfy Favorites work end to end; it is
consistent with Bandcamp's narrower public promise of streaming, downloading,
and playlist editing.

Bandcamp's older [`/developer` API](https://bandcamp.com/developer) is a
different OAuth API for labels and merchandise-fulfillment partners. It does
not document the fan-facing Subsonic beta and should not be used as evidence of
which Subsonic methods are supported.

## Live Bandcamp endpoint snapshot

The following began as an empirical read-only check on 2026-08-12 against
[`https://bandcamp.com/api/subsonic`](https://bandcamp.com/api/subsonic). It used
valid Bandcamp-generated Subsonic credentials already stored by Coda in the
macOS keychain, token authentication, JSON responses, client API version
`1.16.1`, and no credential or music-metadata logging.

| Request | Observed response | Narrow conclusion |
| --- | --- | --- |
| `ping` | HTTP 200; standard `subsonic-response`; `status=ok`, `version=1.16.1`, `type=BandcampServer`, `openSubsonic=true` | The endpoint identifies itself as an OpenSubsonic-capable Subsonic 1.16.1 server. This flag alone does not promise every core method. |
| `getOpenSubsonicExtensions` | HTTP 200; standard response; empty `openSubsonicExtensions` object | Bandcamp advertised no OpenSubsonic extensions in this response. The [extension-list endpoint](https://opensubsonic.netlify.app/docs/endpoints/getopensubsonicextensions/) enumerates additive OpenSubsonic extensions, not core Subsonic methods. |
| `getStarred` | HTTP 200; standard successful response with `starred`; albums carried `starred` timestamps. The song array was empty immediately after a song star was persisted, then a later probe returned that one song. | Bandcamp provides a usable album-star list, but song enumeration can lag behind the write and cannot be treated as immediately complete. A missing song here is not evidence that the song is unstarred. |
| `getStarred2` | HTTP 200, but top-level `{"error":true,"error_message":"bad version"}` instead of a `subsonic-response` | The ID3-oriented starred-list method was unsupported or nonconformant in this snapshot. The same shape occurred for requested API versions 1.8.0, 1.9.0, 1.12.0, 1.15.0, 1.16.0, and 1.16.1. |
| `getAlbumList2?type=starred&size=500` | HTTP 200 and a standard successful response, but it returned 437 albums while only one carried a `starred` timestamp; `getStarred` returned only one album | Bandcamp recognizes the list type, but the result did not provide a trustworthy equivalent of `getStarred`. This may reflect beta bugs or Bandcamp-specific semantics; the probe cannot distinguish them. |
| `getBookmarks` | HTTP 200, but the same top-level `bad version` error shape as `getStarred2`, not a standard Subsonic error envelope | Bookmark reads were unsupported or nonconformant in this snapshot. The same result occurred across the API versions listed above. |

After the user explicitly authorized mutation testing, the same account was
used for this bounded album-star check:

| Request | Observed response | Narrow conclusion |
| --- | --- | --- |
| `star` for an already-starred album | Successful response for both `albumId` and legacy `id`, over GET query and POST form transports; the album remained starred | The route accepted all standard forms, but an idempotent call alone could not prove that it writes. |
| `star?albumId=...` for a previously unstarred album | Successful response; a fresh `getStarred` contained the new album and the starred-album count increased from one to two | Bandcamp's beta performed a real album-star write. |
| `unstar` for that newly starred album | Failed with standard Subsonic error code `0` and `unknown error` for `albumId` and `id`, over both GET and POST; the same failure occurred with client versions 1.8.0, 1.9.0, 1.12.0, 1.15.0, 1.16.0, and 1.16.1 | Album-star removal was unusable. The test album remained starred after all rollback attempts. |
| `star` for one song using POST form `id` | Successful response; the exact song in a subsequent `getAlbum` response carried a `starred` timestamp while the immediate `getStarred` response still returned zero songs. A later `getStarred` probe returned the song. | Bandcamp persists individual song stars. `getAlbum` exposed the post-write state before the global starred list caught up, so it is the available immediate per-song verification source. |

### Probe limits

- This checked one account at one point in an open beta. Feature flags or
  account data may change the result.
- It tested album `star`/`unstar` and one song `star`/`unstar`. The authorized
  song cleanup was attempted after `getAlbum` recovered, but Bandcamp rejected
  the correctly shaped `unstar` request with error code `0`; the song remains
  starred. It did not test artist stars, ratings, or bookmark mutations.
- It did not inspect whether the returned starred album was a Bandcamp wishlist
  item through an API. The tested Subsonic stars were not surfaced in the
  current Bandcamp website UI, so Coda must not present them as website or
  wishlist Favorites.
- The `bad version` text is Bandcamp's response text, but it is not a compliant
  Subsonic error envelope and appeared for multiple valid protocol versions.
  It is evidence of an unusable method, not a reliable diagnosis of its cause.

## Product implication for Coda

Coda should no longer state categorically that Bandcamp's Subsonic beta does
not return any valid favorites response. A more accurate statement is:

> Bandcamp currently exposes a partial stars API: `getStarred` enumerates album
> stars, and `star` persists album and song stars. Individual song state is
> visible immediately through `getAlbum`, while `getStarred` can lag behind a
> song write; `getStarred2`, tested album/song `unstar`, and starred album-list
> filtering are broken or nonconformant in the tested account.

For Coda, `getStarred` can be authoritative only for album enumeration. Track
writes should use the standard `star`/`unstar` endpoints and carry the album ID
so the exact track can be verified through `getAlbum`. Since no immediately
consistent endpoint globally enumerates song stars, Coda needs a bounded,
stripped local index of Bandcamp-confirmed track stars; hydration and explicit
Refresh can reconcile only known albums, with bounded concurrency. This cache
is not independent favorite truth: rejected writes roll back, missing songs in
`getStarred` never clear it, and a track is removed only after `getAlbum`
explicitly confirms the star is absent. Cross-device discovery may arrive later
through `getStarred` or when the relevant album is hydrated, but cannot be
claimed as complete while the endpoint is inconsistent. Coda should not use
`getStarred2` or `getAlbumList2?type=starred` as fallbacks. Whether these stars
map internally to another Bandcamp concept remains unproven; the current
website UI does not expose the tested stars.
