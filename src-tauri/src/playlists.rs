use crate::cover_cache::{authorize_playlist, authorize_playlist_summaries};
use crate::models::{ConnectionInput, PlaylistDetail, PlaylistSummary, PlaylistUpdateInput};
use crate::storage::run_blocking;
use crate::subsonic::{
    authenticated_url, beta_feature_error, current_connection_generation, load_credentials_async,
    playlist_from_response, playlist_update_from_response, playlists_from_response, request_json,
    request_mutation_json, validate_identifier, validate_playlist_name, validate_playlist_update,
    validate_song_ids, validate_subsonic_id,
};

#[tauri::command]
pub(super) async fn fetch_playlists() -> Result<Vec<PlaylistSummary>, String> {
    let generation = current_connection_generation();
    let credentials = load_credentials_async().await?;
    let body = request_json("getPlaylists", &credentials, &[])
        .await
        .map_err(|error| beta_feature_error("Playlists", error))?;
    let playlists = run_blocking(
        "Could not finish processing Bandcamp playlists",
        move || playlists_from_response(&body),
    )
    .await?;
    authorize_playlist_summaries(generation, &credentials, &playlists)?;
    Ok(playlists)
}

#[tauri::command]
pub(super) async fn fetch_playlist(playlist_id: String) -> Result<PlaylistDetail, String> {
    validate_subsonic_id(&playlist_id, "playlist")?;
    let generation = current_connection_generation();
    let credentials = load_credentials_async().await?;
    let playlist = fetch_playlist_from_bandcamp(&playlist_id, &credentials)
        .await
        .map_err(|error| beta_feature_error("Playlist loading", error))?;
    authorize_playlist(generation, &credentials, &playlist)?;
    Ok(playlist)
}

pub(super) async fn fetch_playlist_from_bandcamp(
    playlist_id: &str,
    credentials: &ConnectionInput,
) -> Result<PlaylistDetail, String> {
    let body = request_json(
        "getPlaylist",
        credentials,
        &[("id", playlist_id.to_string())],
    )
    .await?;
    let expected_playlist_id = playlist_id.to_string();
    run_blocking(
        "Could not finish processing the Bandcamp playlist",
        move || {
            let playlist = playlist_from_response(&body)?;
            if playlist.id != expected_playlist_id {
                return Err("Bandcamp returned a different playlist than Coda requested.".into());
            }
            Ok(playlist)
        },
    )
    .await
}

#[tauri::command]
pub(super) async fn create_playlist(
    name: String,
    song_ids: Vec<String>,
) -> Result<PlaylistDetail, String> {
    let generation = current_connection_generation();
    validate_playlist_name(&name)?;
    validate_song_ids(&song_ids)?;
    let credentials = load_credentials_async().await?;
    let mut parameters = Vec::with_capacity(song_ids.len() + 1);
    parameters.push(("name".into(), name));
    parameters.extend(
        song_ids
            .into_iter()
            .map(|song_id| ("songId".into(), song_id)),
    );
    let body = request_mutation_json("createPlaylist", &credentials, &parameters)
        .await
        .map_err(|error| beta_feature_error("Playlist creation", error))?;
    let playlist = run_blocking(
        "Could not finish processing the created playlist",
        move || playlist_from_response(&body),
    )
    .await?;
    authorize_playlist(generation, &credentials, &playlist)?;
    Ok(playlist)
}

#[tauri::command]
pub(super) async fn update_playlist(
    input: PlaylistUpdateInput,
) -> Result<Option<PlaylistDetail>, String> {
    let generation = current_connection_generation();
    validate_playlist_update(&input)?;
    let credentials = load_credentials_async().await?;
    let playlist_id = input.playlist_id.clone();
    let mut parameters = vec![("playlistId".into(), playlist_id.clone())];
    if let Some(name) = input.name {
        parameters.push(("name".into(), name));
    }
    if let Some(comment) = input.comment {
        parameters.push(("comment".into(), comment));
    }
    if let Some(public) = input.public {
        parameters.push(("public".into(), public.to_string()));
    }
    parameters.extend(
        input
            .song_ids_to_add
            .into_iter()
            .map(|song_id| ("songIdToAdd".into(), song_id)),
    );
    parameters.extend(
        input
            .song_indexes_to_remove
            .into_iter()
            .map(|index| ("songIndexToRemove".into(), index.to_string())),
    );
    let body = request_mutation_json("updatePlaylist", &credentials, &parameters)
        .await
        .map_err(|error| beta_feature_error("Playlist update", error))?;
    let playlist = run_blocking(
        "Could not finish processing the updated playlist",
        move || playlist_update_from_response(&body, &playlist_id),
    )
    .await?;
    if let Some(playlist) = &playlist {
        authorize_playlist(generation, &credentials, playlist)?;
    }
    Ok(playlist)
}

#[tauri::command]
pub(super) async fn delete_playlist(playlist_id: String) -> Result<(), String> {
    validate_subsonic_id(&playlist_id, "playlist")?;
    let credentials = load_credentials_async().await?;
    request_mutation_json(
        "deletePlaylist",
        &credentials,
        &[("id".into(), playlist_id)],
    )
    .await
    .map_err(|error| beta_feature_error("Playlist deletion", error))?;
    Ok(())
}

#[tauri::command]
pub(super) async fn get_stream_url(track_id: String) -> Result<String, String> {
    validate_identifier(&track_id)?;
    let credentials = load_credentials_async().await?;
    Ok(authenticated_url(
        "stream",
        &credentials,
        &[("id", track_id), ("format", "raw".into())],
    )?
    .to_string())
}
