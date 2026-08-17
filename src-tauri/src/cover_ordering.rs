//! Monotonic publication ordering for cover-artwork cache mutations.
//!
//! Native mutation order is recorded as a checked sequence while the
//! publication barrier is held. Event delivery and command responses must
//! happen only after those locks are released so delayed platform callbacks
//! cannot invert order or deadlock against a later command.

use crate::models::ConnectionInput;
use serde::Serialize;
use std::sync::{Mutex, MutexGuard};

static COVER_CACHE_PUBLICATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverArtUpdatedPayload {
    pub(super) cover_art_id: String,
    pub(super) revision: String,
    pub(super) sequence: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CoverArtInvalidationReceipt {
    pub(super) sequence: String,
}

impl CoverArtUpdatedPayload {
    pub(super) fn from_sequence(cover_art_id: String, revision: String, sequence: u64) -> Self {
        Self {
            cover_art_id,
            revision,
            sequence: sequence_wire_value(sequence),
        }
    }
}

impl CoverArtInvalidationReceipt {
    pub(super) fn from_sequence(sequence: u64) -> Self {
        Self {
            sequence: sequence_wire_value(sequence),
        }
    }
}

pub(super) fn cover_cache_publication_guard() -> Result<MutexGuard<'static, ()>, String> {
    COVER_CACHE_PUBLICATION_LOCK
        .lock()
        .map_err(|_| "The cover artwork publication state is unavailable.".to_string())
}

pub(super) fn next_cover_ordering_sequence(ordering_sequence: &mut u64) -> Result<u64, String> {
    // Callers hold the publication barrier and runtime lock. The sequence
    // records native mutation order without requiring event delivery to occur
    // before a later command response.
    *ordering_sequence = ordering_sequence
        .checked_add(1)
        .ok_or_else(|| "The cover artwork ordering sequence is exhausted.".to_string())?;
    Ok(*ordering_sequence)
}

pub(super) fn publication_is_current(
    authorized: bool,
    expected_credentials: &ConnectionInput,
    current_credentials: Option<&ConnectionInput>,
) -> bool {
    authorized && current_credentials == Some(expected_credentials)
}

fn sequence_wire_value(sequence: u64) -> String {
    sequence.to_string()
}
