# Audio Monitor — Soniox Integration

Tài liệu mô tả cấu trúc, luồng xử lý, cách sử dụng Soniox API, và các hướng cải thiện tiếp theo cho tính năng Audio Monitor trong Transkit Desktop.

---

## Tổng quan

Audio Monitor là cửa sổ popup độc lập, lắng nghe âm thanh (microphone hoặc system audio), gửi lên Soniox để nhận phiên âm (STT) kết hợp dịch thuật realtime, sau đó hiển thị song ngữ và tùy chọn đọc bản dịch qua TTS.

```
Audio Input (cpal / ScreenCaptureKit)
    │  PCM s16le 16kHz mono
    ▼
Rust audio thread  ──[batch 200ms]──▶  Tauri event "audio_chunk"  (base64)
    │
    ▼ (JavaScript)
SonioxClient.sendAudio()
    │  WebSocket binary frame
    ▼
wss://stt-rt.soniox.com/transcribe-websocket
    │  JSON token stream
    ▼
_handleResponse()  ──▶  onOriginal / onTranslation / onProvisional
    │
    ▼
MonitorLog UI  +  TTSQueue.enqueue()
```

---

## Cấu trúc file

| File | Vai trò |
|---|---|
| `src/window/Monitor/index.jsx` | Component chính, state management, kết nối audio capture ↔ Soniox ↔ TTS |
| `src/window/Monitor/soniox.js` | `SonioxClient` — WebSocket client, session management, token parsing |
| `src/window/Monitor/tts.js` | `TTSQueue` — pipelined TTS playback (VieNeu / Edge TTS / Google / OpenAI) |
| `src/window/Monitor/components/MonitorLog/` | Hiển thị danh sách entry song ngữ, provisional text, TTS replay icon |
| `src/window/Monitor/components/MonitorToolbar/` | Controls: start/stop, source, language, font size, sub mode, TTS toggle |
| `src-tauri/src/audio_cmd.rs` | Rust: audio capture (cpal / SCKit), TTS playback (rodio), Tauri commands |
| `src-tauri/src/audio/microphone.rs` | cpal microphone capture → PCM s16le 16kHz |
| `src-tauri/src/audio/system_audio.rs` | ScreenCaptureKit system audio capture → PCM s16le 16kHz |
| `src/window/Config/pages/Service/Audio/index.jsx` | Settings UI: Soniox API key, TTS provider config |

---

## Soniox WebSocket API

### Endpoint

```
wss://stt-rt.soniox.com/transcribe-websocket
```

### Luồng kết nối

1. **Mở WebSocket**
2. **Gửi config message** (JSON) ngay khi `onopen`:

```json
{
  "api_key": "YOUR_KEY",
  "model": "stt-rt-v4",
  "audio_format": "pcm_s16le",
  "sample_rate": 16000,
  "num_channels": 1,
  "enable_endpoint_detection": true,
  "max_endpoint_delay_ms": 500,
  "enable_speaker_diarization": true,
  "language_hints": ["en"],
  "translation": {
    "type": "one_way",
    "target_language": "vi"
  },
  "context": {
    "domain": "Recent conversation context: ...",
    "terms": []
  }
}
```

3. **Gửi audio** liên tục: `ws.send(pcmArrayBuffer)` — binary frame, không có header/envelope
4. **Nhận token stream**: mỗi message là JSON chứa mảng `tokens`
5. **Kết thúc session**: gửi `ws.send(new ArrayBuffer(0))` rồi `ws.close(1000)`

### Cấu trúc token response

```json
{
  "tokens": [
    {
      "text": "Hello",
      "is_final": true,
      "translation_status": "original",
      "speaker": "S1",
      "start_ms": 1200,
      "end_ms": 1450
    },
    {
      "text": "Xin chào",
      "is_final": true,
      "translation_status": "translation"
    },
    {
      "text": "<end>",
      "is_final": true
    }
  ]
}
```

**Phân loại token:**
- `translation_status: "original"` + `is_final: true` → phiên âm đã xác nhận
- `translation_status: "original"` + `is_final: false` → provisional (đang nhận dạng)
- `translation_status: "translation"` + `is_final: true` → bản dịch đã xác nhận
- `text: "<end>"` → đánh dấu endpoint (khoảng dừng câu)
- `speaker` → label người nói (S1, S2, ...) — chỉ có trên token `original`

### Tham số quan trọng

| Tham số | Hiện tại | Ghi chú |
|---|---|---|
| `model` | `stt-rt-v4` | Model realtime mới nhất |
| `max_endpoint_delay_ms` | `500` | Thời gian chờ sau khi phát hiện điểm dừng câu trước khi finalize. Giảm → nhanh hơn nhưng có thể cắt câu. Tăng → chính xác hơn nhưng trễ hơn |
| `enable_speaker_diarization` | `true` | Nhận dạng người nói (S1, S2...) |
| `language_hints` | theo config | Gợi ý ngôn ngữ nguồn, bỏ qua nếu `auto` |
| `translation.target_language` | theo config | BCP-47 code, ví dụ `vi`, `en`, `ja` |

### Error codes (WebSocket close codes)

| Code | Ý nghĩa | Xử lý |
|---|---|---|
| `1000` | Đóng bình thường | Không reconnect |
| `1006` | Mất kết nối đột ngột | Reconnect (tối đa 3 lần) |
| `4001` | API key không hợp lệ | Báo lỗi, không reconnect |
| `4002` | Vấn đề subscription | Báo lỗi, không reconnect |
| `4003` | Không có quyền | Báo lỗi, không reconnect |
| `4029` | Rate limit | Báo lỗi, không reconnect |

### Error codes (API error message)

| Code | Ý nghĩa |
|---|---|
| `400` | Config message sai |
| `401` | API key không hợp lệ |
| `402` | Hết credits |
| `408` | Request timeout → reconnect |
| `429` | Rate limit |

---

## Session Management

### Seamless reset (make-before-break)

Soniox giới hạn session liên tục. Cứ **3 phút**, `SonioxClient` tự reset session mà không gián đoạn audio capture:

1. Mở WebSocket mới (`newWs`) — gửi config với `carryoverContext`
2. Khi `newWs.onopen` → đánh dấu `oldWs._isOld = true` → đóng `oldWs`
3. `oldWs.onclose` bị bỏ qua (do `_isOld = true`) → không trigger reconnect

Audio capture ở Rust chạy liên tục, không bị gián đoạn.

### Context carryover

Khi reset session, 500 ký tự cuối của bản dịch được gửi kèm như `context.domain`:

```
"Recent conversation context: Xin chào các bạn, hôm nay chúng ta..."
```

Giúp model duy trì ngữ cảnh tên riêng, thuật ngữ qua các session.

### Reconnect logic

- Tối đa **3 lần**, backoff tuyến tính: 2s → 4s → 6s
- Reconnect kèm context carryover từ session trước
- Chỉ retry với close code `1006` và các code không xác định

---

## Audio Capture

### Microphone (cpal)

- Device: default input device
- Format: F32 hoặc I16, tùy device
- Resampling: linear interpolation về 16kHz
- Mixdown: multi-channel → mono (average)

### System Audio (macOS — ScreenCaptureKit)

- Capture toàn bộ system audio output qua SCKit
- Native rate: 48kHz stereo → downsample ×3 → 16kHz mono
- Yêu cầu quyền: `Screen Recording` trong macOS Privacy settings
- Chỉ có trên macOS (flag `#[cfg(target_os = "macos")]`)

### Batching

Rust gom audio chunks mỗi **200ms** trước khi emit event `audio_chunk` lên frontend (base64 encoded). Giảm để lấy latency thấp hơn, tăng để giảm overhead.

---

## Cấu hình hiện tại (config keys)

| Key | Default | Mô tả |
|---|---|---|
| `soniox_api_key` | `""` | API key từ console.soniox.com |
| `audio_source` | `"microphone"` | `"microphone"` hoặc `"system"` |
| `audio_source_lang` | `"auto"` | BCP-47 hoặc `"auto"` |
| `audio_target_lang` | `"vi"` | BCP-47 target language |
| `monitor_font_size` | `14` | Font size cho MonitorLog |

---

## Hướng cải thiện tiếp theo

### Latency

- **`max_endpoint_delay_ms`**: Thử giảm xuống 200–300ms cho meeting context (người nói có nhịp rõ). Hiện tại 500ms.
- **Streaming TTS**: Bắt đầu phát TTS ngay khi nhận được token đầu tiên của bản dịch thay vì chờ finalize toàn câu.
- **Batch size Rust**: Giảm từ 200ms xuống 100ms nếu latency là ưu tiên.

### Độ chính xác

- **`context.terms`**: Thêm UI cho phép người dùng nhập danh sách thuật ngữ/tên riêng để Soniox ưu tiên nhận dạng đúng.
- **`language_hints` đa ngôn ngữ**: Hỗ trợ nhiều ngôn ngữ nguồn song song (Soniox hỗ trợ multi-language hints).
- **Custom domain context**: Cho phép người dùng nhập domain description (ví dụ: "medical conference", "software engineering talk") để tăng accuracy.

### Tính năng

- **Lưu lịch sử**: Export transcript + translation ra file `.txt` / `.srt`.
- **Multi-target language**: Dịch đồng thời sang nhiều ngôn ngữ (hiện Soniox `one_way` chỉ hỗ trợ 1 target, có thể dùng nhiều connection song song).
- **Confidence threshold**: Lọc bỏ token có confidence thấp trước khi hiển thị/đọc TTS.
- **Provisional display styling**: Hiển thị provisional text với style mờ/italic để phân biệt rõ với text đã finalize.
- **Speaker labels**: Hiển thị label người nói (S1, S2) với màu sắc phân biệt thay vì chỉ icon hiện tại.

### Reliability

- **Exponential backoff**: Thay backoff tuyến tính hiện tại bằng exponential (2s → 4s → 8s) để không DDoS server khi có vấn đề mạng.
- **Health check**: Ping `https://stt-rt.soniox.com` trước khi kết nối để phát hiện sớm vấn đề network.
- **Session duration tăng**: Test xem Soniox có cho phép session dài hơn 3 phút không để giảm tần suất reset.

---

## Tham khảo

- Soniox Console (API key): https://console.soniox.com
- Soniox API docs: https://soniox.com/docs
- Supported languages: https://soniox.com/docs/speech-to-text/supported-languages
- BCP-47 language codes: https://www.iana.org/assignments/language-subtag-registry
