use std::sync::Mutex;

/// Reuses a successfully read vault value for this native process. Vault writes
/// invalidate the value so the next reader verifies what was actually stored.
pub(crate) struct CredentialSession<T: Clone> {
    value: Mutex<Option<T>>,
}

impl<T: Clone> CredentialSession<T> {
    pub(crate) const fn new() -> Self {
        Self {
            value: Mutex::new(None),
        }
    }

    pub(crate) fn read(&self, load: impl FnOnce() -> Result<T, String>) -> Result<T, String> {
        let mut value = self.value.lock().map_err(|_| {
            "The credential session is unavailable. Restart Coda to retry.".to_string()
        })?;
        if let Some(value) = value.as_ref() {
            return Ok(value.clone());
        }
        let loaded = load()?;
        *value = Some(loaded.clone());
        Ok(loaded)
    }

    pub(crate) fn mutate(
        &self,
        operation: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        let mut value = self.value.lock().map_err(|_| {
            "The credential session is unavailable. Restart Coda to retry.".to_string()
        })?;
        operation()?;
        *value = None;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::CredentialSession;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc, Barrier};
    use std::thread;

    #[test]
    fn concurrent_readers_load_the_vault_once() {
        let session = Arc::new(CredentialSession::new());
        let barrier = Arc::new(Barrier::new(8));
        let reads = Arc::new(AtomicUsize::new(0));
        let readers: Vec<_> = (0..8)
            .map(|_| {
                let session = Arc::clone(&session);
                let barrier = Arc::clone(&barrier);
                let reads = Arc::clone(&reads);
                thread::spawn(move || {
                    barrier.wait();
                    session.read(|| {
                        reads.fetch_add(1, Ordering::SeqCst);
                        Ok(42)
                    })
                })
            })
            .collect();

        for reader in readers {
            assert_eq!(reader.join().unwrap(), Ok(42));
        }
        assert_eq!(reads.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn failed_read_can_retry_and_successful_absence_is_cached() {
        let session = CredentialSession::<Option<u32>>::new();
        assert_eq!(
            session.read(|| Err("Access denied".into())),
            Err("Access denied".into())
        );
        assert_eq!(session.read(|| Ok(None)), Ok(None));
        assert_eq!(
            session.read(|| panic!("A missing session was already read")),
            Ok(None)
        );
    }

    #[test]
    fn successful_mutation_requires_a_new_vault_read() {
        let session = CredentialSession::new();
        assert_eq!(session.read(|| Ok(1)), Ok(1));
        session.mutate(|| Ok(())).unwrap();
        assert_eq!(
            session.read(|| Err("Readback failed".into())),
            Err("Readback failed".into())
        );
        assert_eq!(session.read(|| Ok(2)), Ok(2));
    }

    #[test]
    fn failed_mutation_preserves_the_previous_session() {
        let session = CredentialSession::new();
        assert_eq!(session.read(|| Ok(1)), Ok(1));
        assert_eq!(
            session.mutate(|| Err("Write failed".into())),
            Err("Write failed".into())
        );
        assert_eq!(
            session.read(|| panic!("The previous session should remain usable")),
            Ok(1)
        );
    }

    #[test]
    fn mutation_waits_for_a_pending_read_and_invalidates_its_result() {
        let session = Arc::new(CredentialSession::new());
        let (read_started, wait_for_read) = mpsc::channel();
        let (release_read, wait_for_release) = mpsc::channel();
        let reader_session = Arc::clone(&session);
        let reader = thread::spawn(move || {
            reader_session.read(|| {
                read_started.send(()).unwrap();
                wait_for_release.recv().unwrap();
                Ok(1)
            })
        });
        wait_for_read.recv().unwrap();
        assert!(session.value.try_lock().is_err());

        let writer_session = Arc::clone(&session);
        let writer = thread::spawn(move || writer_session.mutate(|| Ok(())));
        release_read.send(()).unwrap();
        assert_eq!(reader.join().unwrap(), Ok(1));
        writer.join().unwrap().unwrap();
        assert_eq!(session.read(|| Ok(2)), Ok(2));
    }
}
