//! Built-in Microsoft Edge TTS client — matches the edge-tts Python reference implementation.
//!
//! Key auth requirements (as of edge-tts v1.4+):
//!   - `Sec-MS-GEC` and `Sec-MS-GEC-Version` go in the **URL query string**, not headers.
//!   - `Sec-MS-GEC` is a SHA256 of "{windows_filetime_rounded_300s}{TRUSTED_CLIENT_TOKEN}".
//!   - `Cookie: muid={random_32_hex};` must be present in WS headers.
//!   - Chrome/Edge version in User-Agent must match the GEC version string.
//!
//! Reference: https://github.com/rany2/edge-tts

use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::Window;
use tokio_tungstenite::{
    connect_async,
    tungstenite::{client::IntoClientRequest, Message},
};
use uuid::Uuid;

// ── Constants (keep in sync with edge-tts constants.py) ───────────────────

const TRUSTED_CLIENT_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const ENDPOINT: &str =
    "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1";

/// Chromium version used by the current edge-tts release.
/// Must match the major version in USER_AGENT and the SEC_MS_GEC_VERSION string.
const CHROMIUM_FULL_VERSION: &str = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION: &str = "143";

/// "1-{CHROMIUM_FULL_VERSION}" — put in the URL query string, NOT as a header.
const SEC_MS_GEC_VERSION: &str = "1-143.0.3650.75";

const ORIGIN: &str = "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold";
const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) \
    AppleWebKit/537.36 (KHTML, like Gecko) \
    Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

// ── Helpers ────────────────────────────────────────────────────────────────

fn unix_timestamp() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

fn now_ms() -> u128 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn new_id() -> String {
    Uuid::new_v4().to_string().replace('-', "")
}

/// Generate a random MUID (16 random bytes as uppercase hex).
/// Equivalent to Python's `secrets.token_hex(16).upper()`.
fn generate_muid() -> String {
    let bytes = Uuid::new_v4().as_bytes().to_vec();
    bytes.iter().map(|b| format!("{b:02X}")).collect()
}

/// Compute the `Sec-MS-GEC` token.
///
/// Algorithm (mirrors DRM.generate_sec_ms_gec() in the Python package):
///   1. Get Unix timestamp as float.
///   2. Add Windows epoch offset (11_644_473_600 seconds → shifts to 1601-01-01).
///   3. Round down to nearest 300-second window.
///   4. Convert to 100-nanosecond Windows FILETIME ticks (* 10_000_000).
///   5. SHA256("{ticks:.0}{TRUSTED_CLIENT_TOKEN}").hexdigest().upper()
fn generate_sec_ms_gec() -> String {
    let mut ticks = unix_timestamp();
    ticks += 11_644_473_600.0_f64;      // Unix → Windows epoch
    ticks -= ticks % 300.0;             // round down to 5-minute window
    ticks *= 10_000_000.0_f64;          // seconds → 100-ns FILETIME ticks

    // {ticks:.0} = integer representation, no decimal point (matches Python f"{ticks:.0f}")
    let str_to_hash = format!("{:.0}{}", ticks, TRUSTED_CLIENT_TOKEN);
    let digest = Sha256::digest(str_to_hash.as_bytes());
    digest.iter().map(|b| format!("{b:02X}")).collect()
}

// ── Protocol message builders ──────────────────────────────────────────────

/// X-Timestamp value used in speech.config and SSML frames.
/// Microsoft's service accepts epoch-milliseconds as a plain integer string.
fn timestamp() -> String {
    now_ms().to_string()
}

/// speech.config text frame — sent once right after the WS handshake.
fn speech_config_msg() -> String {
    format!(
        "X-Timestamp:{ts}\r\n\
         Content-Type:application/json; charset=utf-8\r\n\
         Path:speech.config\r\n\r\n\
         {{\"context\":{{\"synthesis\":{{\"audio\":{{\"metadataoptions\":\
         {{\"sentenceBoundaryEnabled\":\"false\",\"wordBoundaryEnabled\":\"true\"}},\
         \"outputFormat\":\"audio-24khz-48kbitrate-mono-mp3\"}}}}}}}}\r\n",
        ts = timestamp()
    )
}

/// SSML text frame — triggers synthesis of `text` with the given voice/prosody.
fn ssml_msg(req_id: &str, voice: &str, rate: &str, pitch: &str, text: &str) -> String {
    // XML-escape user text to prevent malformed SSML.
    let escaped = text
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;");

    let ssml = format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>\
         <voice name='{voice}'>\
         <prosody pitch='{pitch}' rate='{rate}' volume='+0%'>{escaped}</prosody>\
         </voice></speak>"
    );

    // Note: Python appends "Z" to the timestamp in the SSML frame (ssml_headers_plus_data).
    format!(
        "X-RequestId:{req_id}\r\n\
         Content-Type:application/ssml+xml\r\n\
         X-Timestamp:{ts}Z\r\n\
         Path:ssml\r\n\r\n\
         {ssml}",
        ts = timestamp()
    )
}

// ── Tauri event payloads ───────────────────────────────────────────────────

#[derive(Clone, Serialize)]
pub struct EdgeTtsChunk {
    pub id: String,
    /// Base64-encoded MP3 bytes.
    pub data: String,
}

#[derive(Clone, Serialize)]
pub struct EdgeTtsDone {
    pub id: String,
    pub error: Option<String>,
}

// ── Tauri command ──────────────────────────────────────────────────────────

/// Synthesize `text` via Microsoft Edge TTS and stream MP3 chunks to the frontend.
///
/// Emits on `window`:
///   `edge_tts_chunk` { id, data: base64 }  — one per audio chunk received
///   `edge_tts_done`  { id, error? }         — once, when the stream ends
#[tauri::command]
pub async fn synthesize_edge_tts(
    id: String,
    text: String,
    voice: String,
    rate: String,
    pitch: String,
    window: Window,
) -> Result<(), String> {
    let conn_id = new_id();
    let req_id = new_id();
    let sec_ms_gec = generate_sec_ms_gec();
    let muid = generate_muid();

    // Sec-MS-GEC and Sec-MS-GEC-Version go in the URL query string (not headers).
    let url = format!(
        "{ENDPOINT}?TrustedClientToken={TRUSTED_CLIENT_TOKEN}\
         &ConnectionId={conn_id}\
         &Sec-MS-GEC={sec_ms_gec}\
         &Sec-MS-GEC-Version={SEC_MS_GEC_VERSION}"
    );

    let mut request = url
        .into_client_request()
        .map_err(|e| format!("Invalid URL: {e}"))?;

    {
        let h = request.headers_mut();
        h.insert("Origin",          ORIGIN.parse().unwrap());
        h.insert("User-Agent",      USER_AGENT.parse().unwrap());
        h.insert("Pragma",          "no-cache".parse().unwrap());
        h.insert("Cache-Control",   "no-cache".parse().unwrap());
        h.insert("Accept-Encoding", "gzip, deflate, br, zstd".parse().unwrap());
        h.insert("Accept-Language", "en-US,en;q=0.9".parse().unwrap());
        // MUID cookie is required by Microsoft's auth layer.
        h.insert("Cookie", format!("muid={muid};").parse().unwrap());
    }

    let (mut ws, _) = connect_async(request)
        .await
        .map_err(|e| format!("WebSocket connect failed: {e}"))?;

    // ── Send protocol messages ─────────────────────────────────────────────

    ws.send(Message::Text(speech_config_msg()))
        .await
        .map_err(|e| format!("Failed to send speech.config: {e}"))?;

    ws.send(Message::Text(ssml_msg(&req_id, &voice, &rate, &pitch, &text)))
        .await
        .map_err(|e| format!("Failed to send SSML: {e}"))?;

    // ── Stream audio chunks ────────────────────────────────────────────────
    //
    // Binary frame layout:
    //   [0..2]      u16 big-endian  — header byte length (N)
    //   [2..2+N]    UTF-8 text      — frame header (e.g. "Path:audio\r\nContent-Type:audio/mpeg\r\n...")
    //   [2+N..]     bytes           — MP3 audio payload
    //
    // Text frames with "Path:turn.end" signal end of stream.

    let mut stream_error: Option<String> = None;

    while let Some(msg) = ws.next().await {
        match msg {
            Ok(Message::Binary(data)) => {
                if data.len() < 2 {
                    continue;
                }
                let header_len = u16::from_be_bytes([data[0], data[1]]) as usize;
                if data.len() < 2 + header_len {
                    continue;
                }
                let header = std::str::from_utf8(&data[2..2 + header_len]).unwrap_or("");
                if header.contains("Path:audio") {
                    let audio = &data[2 + header_len..];
                    if !audio.is_empty() {
                        window
                            .emit(
                                "edge_tts_chunk",
                                EdgeTtsChunk {
                                    id: id.clone(),
                                    data: STANDARD.encode(audio),
                                },
                            )
                            .ok();
                    }
                }
            }

            Ok(Message::Text(txt)) => {
                if txt.contains("Path:turn.end") {
                    break;
                }
            }

            Err(e) => {
                stream_error = Some(e.to_string());
                break;
            }

            _ => {}
        }
    }

    window
        .emit(
            "edge_tts_done",
            EdgeTtsDone {
                id: id.clone(),
                error: stream_error,
            },
        )
        .ok();

    Ok(())
}
