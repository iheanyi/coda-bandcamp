use super::*;
use std::sync::{mpsc, Arc, Barrier, Mutex};
use std::time::Duration;

fn sample_credentials(username: &str) -> ConnectionInput {
    ConnectionInput {
        username: username.into(),
        password: format!("{username}-password"),
    }
}

#[test]
fn publication_is_current_requires_authorization_and_matching_credentials() {
    let expected = sample_credentials("first-account");
    let replacement = sample_credentials("replacement-account");
    assert!(publication_is_current(true, &expected, Some(&expected)));
    assert!(!publication_is_current(false, &expected, Some(&expected)));
    assert!(!publication_is_current(true, &expected, None));
    assert!(!publication_is_current(true, &expected, Some(&replacement)));
}

#[test]
fn overlapping_sequence_issuance_is_unique_and_monotonic() {
    let ordering_sequence = Arc::new(Mutex::new(0_u64));
    let barrier = Arc::new(Barrier::new(9));
    let operations = (0..8)
        .map(|_| {
            let ordering_sequence = ordering_sequence.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                let _guard = cover_cache_publication_guard().unwrap();
                let mut sequence = ordering_sequence.lock().unwrap();
                next_cover_ordering_sequence(&mut sequence).unwrap()
            })
        })
        .collect::<Vec<_>>();
    barrier.wait();
    let mut sequences = operations
        .into_iter()
        .map(|operation| operation.join().unwrap())
        .collect::<Vec<_>>();
    sequences.sort_unstable();
    assert_eq!(sequences, (1..=8).collect::<Vec<_>>());
}

#[test]
fn delayed_pre_invalidation_publication_does_not_regress_a_newer_invalidation() {
    let mut ordering_sequence = 0_u64;
    let publication_guard = cover_cache_publication_guard().unwrap();
    let publication_sequence = next_cover_ordering_sequence(&mut ordering_sequence).unwrap();
    let delayed_publication = CoverArtUpdatedPayload::from_sequence(
        "cover-1".into(),
        "revision_1".into(),
        publication_sequence,
    );

    let shared_sequence = Arc::new(Mutex::new(ordering_sequence));
    let invalidation_sequence = shared_sequence.clone();
    let (started_sender, started_receiver) = mpsc::channel();
    let (sender, receiver) = mpsc::channel();
    let invalidation = std::thread::spawn(move || {
        started_sender.send(()).unwrap();
        let _guard = cover_cache_publication_guard().unwrap();
        let mut sequence = invalidation_sequence.lock().unwrap();
        sender
            .send(CoverArtInvalidationReceipt::from_sequence(
                next_cover_ordering_sequence(&mut sequence).unwrap(),
            ))
            .unwrap();
    });

    started_receiver
        .recv_timeout(Duration::from_secs(5))
        .unwrap();
    assert!(receiver.recv_timeout(Duration::from_millis(20)).is_err());
    drop(publication_guard);
    let receipt = receiver.recv_timeout(Duration::from_secs(5)).unwrap();
    invalidation.join().unwrap();

    let delayed_sequence = delayed_publication.sequence.parse::<u64>().unwrap();
    let invalidation_sequence = receipt.sequence.parse::<u64>().unwrap();
    assert!(
        delayed_sequence < invalidation_sequence,
        "a delayed publication event must not outrank the invalidation that followed it"
    );
}

#[test]
fn ordering_wire_values_are_bounded_decimal_strings() {
    let publication =
        CoverArtUpdatedPayload::from_sequence("cover-1".into(), "revision_1".into(), 7);
    assert_eq!(
        serde_json::to_value(publication).unwrap(),
        serde_json::json!({
            "coverArtId": "cover-1",
            "revision": "revision_1",
            "sequence": "7",
        })
    );
    assert_eq!(
        serde_json::to_value(CoverArtInvalidationReceipt::from_sequence(8)).unwrap(),
        serde_json::json!({ "sequence": "8" })
    );

    let mut ordering_sequence = u64::MAX;
    assert_eq!(
        next_cover_ordering_sequence(&mut ordering_sequence).unwrap_err(),
        "The cover artwork ordering sequence is exhausted."
    );
}
