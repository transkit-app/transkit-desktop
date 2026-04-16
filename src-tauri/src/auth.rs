use std::sync::mpsc;
use tauri::Manager;
use tiny_http::{Response, Server};

/// Starts a one-shot local HTTP server to capture the OAuth callback.
/// When the browser redirects to http://127.0.0.1:<port>/callback?code=...,
/// the server captures the full URL, serves a success page, and emits
/// the "oauth-callback" Tauri event with the callback URL string.
///
/// Returns an error immediately if the port is already in use, so the
/// caller can surface the error to the user instead of silently timing out.
#[tauri::command]
pub async fn start_oauth_server(window: tauri::Window, port: u16) -> Result<(), String> {
    // Bind the server synchronously before returning so the caller knows
    // whether the port was available.
    let server = Server::http(format!("127.0.0.1:{}", port))
        .map_err(|e| format!("port_in_use: {}", e))?;

    let (tx, rx) = mpsc::channel::<()>();

    std::thread::spawn(move || {
        // Signal that the server is ready (already bound above, just notify)
        let _ = tx.send(());

        if let Some(request) = server.incoming_requests().next() {
            let callback_url = format!("http://127.0.0.1:{}{}", port, request.url());

            let body = r#"<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>TransKit</title></head>
<body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0f172a;color:#f8fafc">
  <div style="text-align:center">
    <div style="font-size:3rem;margin-bottom:1rem">✓</div>
    <h2 style="margin:0 0 .5rem">Authentication successful!</h2>
    <p style="color:#94a3b8;margin:0">You can close this tab and return to TransKit.</p>
  </div>
</body>
</html>"#;

            let response = Response::from_string(body)
                .with_header(
                    tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8")
                        .unwrap(),
                );

            let _ = request.respond(response);
            let _ = window.emit("oauth-callback", callback_url);
        }
    });

    // Wait briefly to ensure the thread is running before returning
    let _ = rx.recv_timeout(std::time::Duration::from_millis(200));

    Ok(())
}
