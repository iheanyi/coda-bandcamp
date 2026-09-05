use std::sync::Once;

pub(crate) fn initialize_crypto_provider() {
    static INITIALIZE: Once = Once::new();
    INITIALIZE.call_once(|| {
        // Reqwest and the updater share Ring. The updater may have already
        // installed it; install_default only fails when a provider exists.
        let _ = rustls::crypto::ring::default_provider().install_default();
    });
}

pub(crate) fn client_builder() -> reqwest::ClientBuilder {
    // Tests and background clients can run without the desktop entry point.
    // rustls-no-provider requires initialization before constructing a client.
    initialize_crypto_provider();
    reqwest::Client::builder()
}

#[cfg(test)]
mod tests {
    use rustls::pki_types::PrivateKeyDer;
    use std::io::{Read, Write};
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn clients_initialize_provider_without_app_startup() {
        const CHILD: &str = "CODA_TEST_CRYPTO_CHILD";
        if std::env::var_os(CHILD).is_none() {
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "network::tests::clients_initialize_provider_without_app_startup",
                ])
                .env(CHILD, "1")
                .status()
                .unwrap();
            assert!(status.success());
            return;
        }

        // A fresh process makes this independent of test order and catches
        // reliance on the updater or another test installing the provider.
        assert!(rustls::crypto::CryptoProvider::get_default().is_none());
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| super::client_builder().build().unwrap());
            }
        });
        assert!(rustls::crypto::CryptoProvider::get_default().is_some());
    }

    #[test]
    fn https_rejects_untrusted_certificates() {
        // Generate throwaway credentials in memory; never persist a test key.
        let rcgen::CertifiedKey { cert, signing_key } =
            rcgen::generate_simple_self_signed(vec!["localhost".into(), "127.0.0.1".into()])
                .unwrap();
        {
            let builder = super::client_builder()
                .no_proxy()
                .https_only(true)
                .timeout(Duration::from_secs(5));
            let client = builder.build().unwrap();
            let config = rustls::ServerConfig::builder()
                .with_no_client_auth()
                .with_single_cert(
                    vec![cert.der().clone()],
                    PrivateKeyDer::Pkcs8(signing_key.serialize_der().into()),
                )
                .unwrap();
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                let (socket, _) = listener.accept().unwrap();
                socket
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                socket
                    .set_write_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let connection = rustls::ServerConnection::new(Arc::new(config)).unwrap();
                let mut stream = rustls::StreamOwned::new(connection, socket);
                let mut request = [0; 2048];
                if stream.read(&mut request).is_ok() {
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok",
                    );
                    let _ = stream.flush();
                }
            });
            let response = tauri::async_runtime::block_on(async {
                client.get(format!("https://{address}")).send().await
            });
            server.join().unwrap();
            let error = response.unwrap_err();
            assert!(error.is_connect() && !error.is_timeout(), "{error}");
            let mut source = std::error::Error::source(&error);
            let mut certificate_error = false;
            while let Some(cause) = source {
                certificate_error |= cause.to_string().to_lowercase().contains("certificate");
                source = cause.source();
            }
            assert!(
                certificate_error,
                "expected a certificate validation error: {error:?}"
            );
        }
    }
}
