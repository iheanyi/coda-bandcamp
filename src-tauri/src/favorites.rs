use crate::cover_cache::{authorize_albums, authorize_tracks};
use crate::library::fetch_album_from_bandcamp;
use crate::models::{
    FavoriteCollection, FavoriteInput, FavoriteKind, FavoriteMutationResult, FavoriteTrackLocator,
    FavoriteTrackReconciliation, FavoriteVerification, Track,
};
use crate::storage::run_blocking;
use crate::subsonic::{
    beta_feature_error, bounded_album_from_value, bounded_track_from_value,
    current_connection_generation, load_credentials_async, playlist_track_album_id,
    request_empty_mutation, request_json, validate_subsonic_id,
};
use futures_util::{stream, StreamExt};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::time::Instant;

pub(super) const MAX_FAVORITE_ALBUMS: usize = 5_000;
pub(super) const MAX_FAVORITE_TRACKS: usize = 25_000;
const MAX_FAVORITE_ALBUM_RECONCILIATIONS: usize = 5_000;
const FAVORITE_RECONCILIATION_CONCURRENCY: usize = 6;

pub(super) fn favorite_mutation_request(
    input: &FavoriteInput,
) -> Result<(&'static str, &'static str, String), String> {
    let label = match input.kind {
        FavoriteKind::Album => "album",
        FavoriteKind::Song => "song",
    };
    validate_subsonic_id(&input.id, label)?;
    Ok((
        if input.favorite { "star" } else { "unstar" },
        if input.kind == FavoriteKind::Album {
            "albumId"
        } else {
            "id"
        },
        input.id.clone(),
    ))
}

pub(super) fn favorites_from_response(body: &Value) -> Result<FavoriteCollection, String> {
    let starred = body
        .pointer("/subsonic-response/starred")
        .and_then(Value::as_object)
        .ok_or_else(|| "Bandcamp did not return a valid Favorites list.".to_string())?;
    let album_values = match starred.get("album") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(values)) => values.as_slice(),
        Some(_) => return Err("Bandcamp returned an invalid favorite album list.".into()),
    };
    let song_values = match starred.get("song") {
        None | Some(Value::Null) => &[][..],
        Some(Value::Array(values)) => values.as_slice(),
        Some(_) => return Err("Bandcamp returned an invalid favorite track list.".into()),
    };
    if album_values.len() > MAX_FAVORITE_ALBUMS {
        return Err(format!(
            "Bandcamp returned more than {MAX_FAVORITE_ALBUMS} favorite albums."
        ));
    }
    if song_values.len() > MAX_FAVORITE_TRACKS {
        return Err(format!(
            "Bandcamp returned more than {MAX_FAVORITE_TRACKS} favorite tracks."
        ));
    }

    let albums = album_values
        .iter()
        .map(|value| {
            bounded_album_from_value(value)
                .ok_or_else(|| "Bandcamp returned invalid favorite album metadata.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    let tracks = song_values
        .iter()
        .map(|value| {
            let album_id = playlist_track_album_id(value).unwrap_or_default();
            bounded_track_from_value(value, &album_id)
                .ok_or_else(|| "Bandcamp returned invalid favorite track metadata.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(FavoriteCollection {
        album_ids: albums.iter().map(|album| album.id.clone()).collect(),
        song_ids: tracks.iter().map(|track| track.id.clone()).collect(),
        albums,
        tracks,
    })
}

#[tauri::command]
pub(super) async fn fetch_favorites() -> Result<FavoriteCollection, String> {
    let started = Instant::now();
    let generation = current_connection_generation();
    let credentials = load_credentials_async().await?;
    let body = match request_json("getStarred", &credentials, &[]).await {
        Ok(body) => body,
        Err(error) => {
            tracing::warn!(
                target: "coda::favorites",
                operation = "get_starred",
                status = "failed",
                elapsed_ms = started.elapsed().as_millis(),
            );
            return Err(beta_feature_error("Favorites", error));
        }
    };
    let favorites = run_blocking(
        "Could not finish processing Bandcamp Favorites",
        move || favorites_from_response(&body),
    )
    .await?;
    tracing::info!(
        target: "coda::favorites",
        operation = "get_starred",
        status = "ok",
        album_count = favorites.album_ids.len(),
        enumerated_track_count = favorites.song_ids.len(),
        elapsed_ms = started.elapsed().as_millis(),
    );
    authorize_albums(generation, &credentials, &favorites.albums)?;
    authorize_tracks(generation, &credentials, &favorites.tracks)?;
    Ok(favorites)
}

#[tauri::command]
pub(super) async fn set_favorite(input: FavoriteInput) -> Result<FavoriteMutationResult, String> {
    let started = Instant::now();
    let generation = current_connection_generation();
    let (endpoint, key, id) = favorite_mutation_request(&input)?;
    let album_id = match input.kind {
        FavoriteKind::Album => None,
        FavoriteKind::Song => {
            let album_id = input.album_id.as_deref().ok_or_else(|| {
                "A favorite track update requires its album identifier.".to_string()
            })?;
            validate_subsonic_id(album_id, "album")?;
            Some(album_id.to_string())
        }
    };
    let credentials = load_credentials_async().await?;
    if let Err(error) =
        request_empty_mutation(endpoint, &credentials, &[(key.into(), id.clone())]).await
    {
        tracing::warn!(
            target: "coda::favorites",
            operation = "favorite_write",
            favorite_kind = if input.kind == FavoriteKind::Album { "album" } else { "song" },
            requested_favorite = input.favorite,
            status = "rejected",
            elapsed_ms = started.elapsed().as_millis(),
        );
        return Err(beta_feature_error("Favorites update", error));
    }
    tracing::info!(
        target: "coda::favorites",
        operation = "favorite_write",
        favorite_kind = if input.kind == FavoriteKind::Album { "album" } else { "song" },
        requested_favorite = input.favorite,
        status = "accepted",
        elapsed_ms = started.elapsed().as_millis(),
    );

    let Some(album_id) = album_id else {
        return Ok(FavoriteMutationResult {
            accepted: true,
            verification: FavoriteVerification::NotRequired,
            favorite: Some(input.favorite),
            track: None,
        });
    };

    let verification_started = Instant::now();
    let tracks = match fetch_album_from_bandcamp(&album_id, &credentials).await {
        Ok(tracks) => tracks,
        Err(_) => {
            tracing::warn!(
                target: "coda::favorites",
                operation = "get_album_reconciliation",
                status = "unavailable",
                track_count = 1,
                elapsed_ms = verification_started.elapsed().as_millis(),
            );
            return Ok(FavoriteMutationResult {
                accepted: true,
                verification: FavoriteVerification::Unavailable,
                favorite: None,
                track: None,
            });
        }
    };
    let Some(track) = tracks.into_iter().find(|track| track.id == id) else {
        tracing::warn!(
            target: "coda::favorites",
            operation = "get_album_reconciliation",
            status = "track_missing",
            track_count = 1,
            elapsed_ms = verification_started.elapsed().as_millis(),
        );
        return Ok(FavoriteMutationResult {
            accepted: true,
            verification: FavoriteVerification::Unavailable,
            favorite: None,
            track: None,
        });
    };
    authorize_tracks(generation, &credentials, std::slice::from_ref(&track))?;
    let favorite = track.starred_at.is_some();
    let verification = if favorite == input.favorite {
        FavoriteVerification::Verified
    } else {
        FavoriteVerification::Mismatch
    };
    tracing::info!(
        target: "coda::favorites",
        operation = "get_album_reconciliation",
        status = if verification == FavoriteVerification::Verified { "verified" } else { "mismatch" },
        track_count = 1,
        elapsed_ms = verification_started.elapsed().as_millis(),
    );
    Ok(FavoriteMutationResult {
        accepted: true,
        verification,
        favorite: Some(favorite),
        track: Some(track),
    })
}

pub(super) fn reconcile_album_tracks(
    requested_ids: &BTreeSet<String>,
    album_tracks: Vec<Track>,
) -> FavoriteTrackReconciliation {
    let matching = album_tracks
        .into_iter()
        .filter(|track| requested_ids.contains(&track.id))
        .collect::<Vec<_>>();
    let returned_ids = matching
        .iter()
        .map(|track| track.id.clone())
        .collect::<BTreeSet<_>>();
    let unavailable_track_count = requested_ids.difference(&returned_ids).count();
    let (tracks, unstarred_tracks): (Vec<_>, Vec<_>) = matching
        .into_iter()
        .partition(|track| track.starred_at.is_some());
    FavoriteTrackReconciliation {
        tracks,
        unstarred_ids: unstarred_tracks.into_iter().map(|track| track.id).collect(),
        unavailable_track_count,
    }
}

// Consume complete albums as they arrive: only requested Favorites survive into
// the accumulator, rather than retaining every fetched album until the last reply.
pub(super) async fn reconcile_favorite_albums<Fetch, FetchResult, IsCurrent>(
    albums: BTreeMap<String, BTreeSet<String>>,
    fetch_album: Fetch,
    connection_is_current: IsCurrent,
) -> Result<FavoriteTrackReconciliation, String>
where
    Fetch: Fn(String) -> FetchResult,
    FetchResult: Future<Output = Result<Vec<Track>, String>>,
    IsCurrent: Fn() -> bool,
{
    let connection_changed =
        || "The Bandcamp connection changed before Favorites refresh completed.".to_string();
    if !connection_is_current() {
        return Err(connection_changed());
    }
    let requests = stream::iter(albums)
        .map(|(album_id, requested_ids)| {
            let fetch_album = &fetch_album;
            let connection_is_current = &connection_is_current;
            async move {
                let request_started = Instant::now();
                let result = if connection_is_current() {
                    fetch_album(album_id).await
                } else {
                    Err(connection_changed())
                };
                tracing::debug!(
                    target: "coda::favorites",
                    operation = "get_album_reconciliation",
                    status = if result.is_ok() { "ok" } else { "unavailable" },
                    track_count = requested_ids.len(),
                    elapsed_ms = request_started.elapsed().as_millis(),
                );
                (requested_ids, result)
            }
        })
        .buffer_unordered(FAVORITE_RECONCILIATION_CONCURRENCY);
    futures_util::pin_mut!(requests);
    let mut reconciliation = FavoriteTrackReconciliation {
        tracks: Vec::new(),
        unstarred_ids: Vec::new(),
        unavailable_track_count: 0,
    };
    while let Some((requested_ids, result)) = requests.next().await {
        if !connection_is_current() {
            return Err(connection_changed());
        }
        match result {
            Ok(album_tracks) => {
                let album = reconcile_album_tracks(&requested_ids, album_tracks);
                reconciliation.tracks.extend(album.tracks);
                reconciliation.unstarred_ids.extend(album.unstarred_ids);
                reconciliation.unavailable_track_count += album.unavailable_track_count;
            }
            Err(_) => reconciliation.unavailable_track_count += requested_ids.len(),
        }
    }
    Ok(reconciliation)
}

#[tauri::command]
pub(super) async fn reconcile_favorite_tracks(
    tracks: Vec<FavoriteTrackLocator>,
) -> Result<FavoriteTrackReconciliation, String> {
    if tracks.len() > MAX_FAVORITE_TRACKS {
        return Err(format!(
            "Coda can reconcile at most {MAX_FAVORITE_TRACKS} favorite tracks at once."
        ));
    }
    let mut albums = BTreeMap::<String, BTreeSet<String>>::new();
    for track in tracks {
        validate_subsonic_id(&track.id, "song")?;
        validate_subsonic_id(&track.album_id, "album")?;
        albums.entry(track.album_id).or_default().insert(track.id);
    }
    if albums.len() > MAX_FAVORITE_ALBUM_RECONCILIATIONS {
        return Err(format!(
            "Coda can reconcile at most {MAX_FAVORITE_ALBUM_RECONCILIATIONS} favorite albums at once."
        ));
    }
    if albums.is_empty() {
        return Ok(FavoriteTrackReconciliation {
            tracks: Vec::new(),
            unstarred_ids: Vec::new(),
            unavailable_track_count: 0,
        });
    }

    let started = Instant::now();
    let generation = current_connection_generation();
    let album_count = albums.len();
    let track_count = albums.values().map(BTreeSet::len).sum::<usize>();
    let credentials = load_credentials_async().await?;
    let reconciliation = reconcile_favorite_albums(
        albums,
        |album_id| {
            let credentials = &credentials;
            async move { fetch_album_from_bandcamp(&album_id, credentials).await }
        },
        || current_connection_generation() == generation,
    )
    .await?;
    tracing::info!(
        target: "coda::favorites",
        operation = "favorite_track_reconciliation",
        status = if reconciliation.unavailable_track_count == 0 { "complete" } else { "partial" },
        album_count,
        track_count,
        verified_starred_count = reconciliation.tracks.len(),
        verified_unstarred_count = reconciliation.unstarred_ids.len(),
        unavailable_track_count = reconciliation.unavailable_track_count,
        concurrency_limit = FAVORITE_RECONCILIATION_CONCURRENCY,
        elapsed_ms = started.elapsed().as_millis(),
    );
    authorize_tracks(generation, &credentials, &reconciliation.tracks)?;
    Ok(reconciliation)
}
