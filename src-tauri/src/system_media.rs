#[cfg(target_os = "windows")]
mod platform {
    use crate::{SystemMediaControlEvent, SERVICE_NAME};
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use windows::{
        core::{w, GUID, HSTRING},
        Foundation::{TimeSpan, TypedEventHandler},
        Media::{
            MediaPlaybackStatus, MediaPlaybackType, PlaybackPositionChangeRequestedEventArgs,
            SystemMediaTransportControls, SystemMediaTransportControlsButton,
            SystemMediaTransportControlsButtonPressedEventArgs,
            SystemMediaTransportControlsTimelineProperties,
        },
        Storage::Streams::{DataWriter, InMemoryRandomAccessStream, RandomAccessStreamReference},
        Win32::{
            Foundation::PROPERTYKEY,
            System::Com::StructuredStorage::PROPVARIANT,
            System::WinRT::{ISystemMediaTransportControlsInterop, RoGetActivationFactory},
            UI::Shell::{
                PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
                SetCurrentProcessExplicitAppUserModelID,
            },
        },
    };

    const TICKS_PER_SECOND: f64 = 10_000_000.0;
    const PKEY_APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY {
        fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
        pid: 5,
    };

    pub fn set_process_app_user_model_id() -> Result<(), String> {
        unsafe { SetCurrentProcessExplicitAppUserModelID(w!("com.coda.bandcamp")) }
            .map_err(|error| format!("Coda could not set its Windows app identity: {error}"))
    }

    pub fn set_window_app_user_model_id(window: &WebviewWindow) -> Result<(), String> {
        let store: IPropertyStore =
            unsafe { SHGetPropertyStoreForWindow(window.hwnd().map_err(media_error)?) }
                .map_err(media_error)?;
        let app_id = PROPVARIANT::from(SERVICE_NAME);
        unsafe {
            store
                .SetValue(&PKEY_APP_USER_MODEL_ID, &app_id)
                .map_err(media_error)?;
            store.Commit().map_err(media_error)
        }
    }

    pub struct NativeMediaSession {
        controls: SystemMediaTransportControls,
        button_token: i64,
        position_token: Option<i64>,
    }

    #[derive(Clone)]
    pub struct SystemMediaArtwork {
        stream: RandomAccessStreamReference,
    }

    pub fn artwork_from_bytes(bytes: &[u8]) -> Result<SystemMediaArtwork, String> {
        let stream = InMemoryRandomAccessStream::new().map_err(media_error)?;
        let output = stream.GetOutputStreamAt(0).map_err(media_error)?;
        let writer = DataWriter::CreateDataWriter(&output).map_err(media_error)?;
        writer.WriteBytes(bytes).map_err(media_error)?;
        writer
            .StoreAsync()
            .map_err(media_error)?
            .get()
            .map_err(media_error)?;
        writer
            .FlushAsync()
            .map_err(media_error)?
            .get()
            .map_err(media_error)?;
        writer.DetachStream().map_err(media_error)?;
        stream.Seek(0).map_err(media_error)?;
        let stream = RandomAccessStreamReference::CreateFromStream(&stream).map_err(media_error)?;
        Ok(SystemMediaArtwork { stream })
    }

    impl NativeMediaSession {
        pub fn new(window: &WebviewWindow, app: AppHandle) -> Result<Self, String> {
            let factory: ISystemMediaTransportControlsInterop = unsafe {
                RoGetActivationFactory(&HSTRING::from("Windows.Media.SystemMediaTransportControls"))
            }
            .map_err(media_error)?;
            let controls: SystemMediaTransportControls =
                unsafe { factory.GetForWindow(window.hwnd().map_err(media_error)?) }
                    .map_err(media_error)?;

            controls.SetIsEnabled(false).map_err(media_error)?;
            controls.SetIsPlayEnabled(true).map_err(media_error)?;
            controls.SetIsPauseEnabled(true).map_err(media_error)?;
            controls.SetIsPreviousEnabled(false).map_err(media_error)?;
            controls.SetIsNextEnabled(false).map_err(media_error)?;

            let button_app = app.clone();
            let button_token = controls
                .ButtonPressed(&TypedEventHandler::<
                    SystemMediaTransportControls,
                    SystemMediaTransportControlsButtonPressedEventArgs,
                >::new(move |_, args| {
                    let button = args.ok()?.Button()?;
                    let action = if button == SystemMediaTransportControlsButton::Play {
                        Some("play")
                    } else if button == SystemMediaTransportControlsButton::Pause {
                        Some("pause")
                    } else if button == SystemMediaTransportControlsButton::Previous {
                        Some("previous")
                    } else if button == SystemMediaTransportControlsButton::Next {
                        Some("next")
                    } else {
                        None
                    };
                    if let Some(action) = action {
                        let _ = button_app.emit(
                            "coda://system-media-control",
                            SystemMediaControlEvent {
                                action: action.into(),
                                position_seconds: None,
                            },
                        );
                    }
                    Ok(())
                }))
                .map_err(media_error)?;

            let position_token = controls
                .PlaybackPositionChangeRequested(&TypedEventHandler::<
                    SystemMediaTransportControls,
                    PlaybackPositionChangeRequestedEventArgs,
                >::new(move |_, args| {
                    let position = args.ok()?.RequestedPlaybackPosition()?.Duration;
                    let _ = app.emit(
                        "coda://system-media-control",
                        SystemMediaControlEvent {
                            action: "seek".into(),
                            position_seconds: Some(position as f64 / TICKS_PER_SECOND),
                        },
                    );
                    Ok(())
                }))
                .ok();

            Ok(Self {
                controls,
                button_token,
                position_token,
            })
        }

        pub fn update_metadata(
            &self,
            title: &str,
            artist: &str,
            album: &str,
            artwork: Option<&SystemMediaArtwork>,
            can_previous: bool,
            can_next: bool,
        ) -> Result<(), String> {
            let updater = self.controls.DisplayUpdater().map_err(media_error)?;
            updater.ClearAll().map_err(media_error)?;
            updater
                .SetType(MediaPlaybackType::Music)
                .map_err(media_error)?;
            updater
                .SetAppMediaId(&HSTRING::from(SERVICE_NAME))
                .map_err(media_error)?;
            let music = updater.MusicProperties().map_err(media_error)?;
            music.SetTitle(&HSTRING::from(title)).map_err(media_error)?;
            music
                .SetArtist(&HSTRING::from(artist))
                .map_err(media_error)?;
            music
                .SetAlbumTitle(&HSTRING::from(album))
                .map_err(media_error)?;
            if let Some(artwork) = artwork {
                updater.SetThumbnail(&artwork.stream).map_err(media_error)?;
            }
            updater.Update().map_err(media_error)?;
            self.controls
                .SetIsPreviousEnabled(can_previous)
                .map_err(media_error)?;
            self.controls
                .SetIsNextEnabled(can_next)
                .map_err(media_error)?;
            self.controls.SetIsEnabled(true).map_err(media_error)
        }

        pub fn clear(&self) -> Result<(), String> {
            let updater = self.controls.DisplayUpdater().map_err(media_error)?;
            updater.ClearAll().map_err(media_error)?;
            updater.Update().map_err(media_error)?;
            self.controls
                .SetPlaybackStatus(MediaPlaybackStatus::Closed)
                .map_err(media_error)?;
            self.controls.SetIsEnabled(false).map_err(media_error)
        }

        pub fn update_playback(&self, playing: bool) -> Result<(), String> {
            self.controls
                .SetPlaybackStatus(if playing {
                    MediaPlaybackStatus::Playing
                } else {
                    MediaPlaybackStatus::Paused
                })
                .map_err(media_error)
        }

        pub fn update_timeline(
            &self,
            position_seconds: f64,
            duration_seconds: f64,
        ) -> Result<(), String> {
            let timeline =
                SystemMediaTransportControlsTimelineProperties::new().map_err(media_error)?;
            let start = seconds_to_timespan(0.0);
            let end = seconds_to_timespan(duration_seconds);
            timeline.SetStartTime(start).map_err(media_error)?;
            timeline.SetMinSeekTime(start).map_err(media_error)?;
            timeline.SetEndTime(end).map_err(media_error)?;
            timeline.SetMaxSeekTime(end).map_err(media_error)?;
            timeline
                .SetPosition(seconds_to_timespan(
                    position_seconds.clamp(0.0, duration_seconds),
                ))
                .map_err(media_error)?;
            self.controls
                .UpdateTimelineProperties(&timeline)
                .map_err(media_error)
        }
    }

    impl Drop for NativeMediaSession {
        fn drop(&mut self) {
            let _ = self.controls.RemoveButtonPressed(self.button_token);
            if let Some(token) = self.position_token {
                let _ = self.controls.RemovePlaybackPositionChangeRequested(token);
            }
            let _ = self.controls.SetIsEnabled(false);
        }
    }

    fn seconds_to_timespan(seconds: f64) -> TimeSpan {
        TimeSpan {
            Duration: (seconds * TICKS_PER_SECOND).round() as i64,
        }
    }

    fn media_error(error: impl std::fmt::Display) -> String {
        format!("Coda could not update Windows media controls: {error}")
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use tauri::{AppHandle, WebviewWindow};

    pub fn set_process_app_user_model_id() -> Result<(), String> {
        Ok(())
    }

    pub fn set_window_app_user_model_id(_window: &WebviewWindow) -> Result<(), String> {
        Ok(())
    }

    pub struct NativeMediaSession;

    #[derive(Clone)]
    pub struct SystemMediaArtwork;

    pub fn artwork_from_bytes(_bytes: &[u8]) -> Result<SystemMediaArtwork, String> {
        Ok(SystemMediaArtwork)
    }

    impl NativeMediaSession {
        pub fn new(_window: &WebviewWindow, _app: AppHandle) -> Result<Self, String> {
            Ok(Self)
        }

        pub fn update_metadata(
            &self,
            _title: &str,
            _artist: &str,
            _album: &str,
            _artwork: Option<&SystemMediaArtwork>,
            _can_previous: bool,
            _can_next: bool,
        ) -> Result<(), String> {
            Ok(())
        }

        pub fn clear(&self) -> Result<(), String> {
            Ok(())
        }

        pub fn update_playback(&self, _playing: bool) -> Result<(), String> {
            Ok(())
        }

        pub fn update_timeline(
            &self,
            _position_seconds: f64,
            _duration_seconds: f64,
        ) -> Result<(), String> {
            Ok(())
        }
    }
}

pub use platform::{
    artwork_from_bytes, set_process_app_user_model_id, set_window_app_user_model_id,
    NativeMediaSession, SystemMediaArtwork,
};
