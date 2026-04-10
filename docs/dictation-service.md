# Dictation Service — Design & Implementation Plan

> **Status:** Phase 1 complete (Backend) — Phase 2 pending (Client SDK)  
> **Scope:** New first-class cloud service for short/sporadic speech-to-text (Voice Anywhere, Narration PTT)  
> **Authors:** Fern.N
>
> **Repo layout:**  
> - Cloud backend: `transkit-home-page/supabase/` (private repo, not open-source)  
> - Desktop client: `transkit-desktop/` (this repo)

---

## 1. Motivation

Transkit Cloud hiện có một cơ chế STT duy nhất — **long-session WebSocket streaming** phục vụ Monitor (xem phim, cuộc họp dài). Cơ chế này không phù hợp với hai tính năng đang dùng chung:

| Tính năng | Vấn đề hiện tại |
|---|---|
| **Voice Anywhere** | Tạo WebSocket session dài chỉ để capture vài giây — overhead không tương xứng |
| **Narration PTT** | Duplicate STT session song song với Monitor session — lãng phí quota, khó track, tăng chi phí provider |

### Mục tiêu thiết kế

1. **Dịch vụ riêng biệt** — `dictation` đứng ngang hàng `stt`, `tts`, `ai`, `translate`
2. **Provider tự config** — Admin chọn provider riêng cho dictation, độc lập với STT streaming
3. **Server-side WS proxy** — Client kết nối qua Edge Function; provider credentials không bao giờ lộ ra client
4. **Quota riêng từ đầu** — `dictation_seconds_used` tách hoàn toàn với `stt_seconds_used`
5. **Thay thế Narration PTT** — Xóa duplicate session pattern hiện tại

---

## 2. Định nghĩa dịch vụ

### Tên: `dictation`

- Functional name — mô tả hành động, không gắn với tính năng cụ thể
- Covers: Voice Anywhere, Narration PTT, mọi "nói → text ngắn" trong tương lai
- Đối xứng: `stt` (long streaming) | `dictation` (short + finalize) | `tts` | `ai` | `translate`

### So sánh với STT streaming

| Đặc điểm | `stt` (Monitor streaming) | `dictation` (Voice Anywhere / Narration PTT) |
|---|---|---|
| **Use case** | Monitor audio dài không xác định | Utterance ngắn, có điểm kết thúc rõ ràng |
| **Protocol** | WebSocket, client → provider trực tiếp | WebSocket, client → **Edge Function proxy** → provider |
| **Credentials** | Temp credentials gửi về client, client tự kết nối | Không cần — Edge Function dùng admin credentials |
| **Duration** | Không giới hạn (session reset mỗi 3 phút) | 5 giây – 5 phút/utterance |
| **Kết thúc session** | User nhấn Stop | `{"type":"dictation_finalize"}` hoặc endpoint detection |
| **Billing model** | Pre-debit giây + reconcile khi dừng | Post-debit từ audio_seconds trong provider response |
| **Interim results** | Có (onProvisional) | Có — WS proxy forward interim về client |
| **Quota unit** | `stt_seconds_used` | `dictation_seconds_used` |

---

## 3. Connection model: Edge Function WebSocket Proxy

### 3.1 Tại sao không dùng HTTP upload?

Ban đầu thiết kế HTTP POST (upload WAV → trả transcript). Nhưng Soniox và Deepgram hỗ trợ **streaming + manual finalize** tốt hơn:

**Soniox:**
```json
// Trong auth message ban đầu
{ "enable_endpoint_detection": true }

// Client gửi khi muốn kết thúc
{ "type": "finalize" }

// Soniox trả về token final với is_final = true
```

**Deepgram:**
```json
// Client gửi khi muốn kết thúc
{ "type": "Finalize" }

// Deepgram trả transcript với from_finalize = true
```

**Ưu điểm streaming + finalize so với HTTP upload:**

| | HTTP Upload | WS Proxy + Finalize |
|---|---|---|
| Interim results trong khi nói | Không | Có (hiển thị text realtime cho Voice Anywhere) |
| Buffer audio trên client | Phải giữ toàn bộ audio đến khi dừng | Không — stream trực tiếp |
| Encode WAV | Cần (phức tạp) | Không cần |
| Latency trước khi nhận kết quả | Cao (upload + process) | Thấp (provider xử lý liên tục) |
| Phụ thuộc file size limit | Có (Whisper: max 25MB) | Không |

→ **WS proxy là approach chính** cho dictation. HTTP upload chỉ là fallback cho providers REST-only (OpenAI Whisper).

### 3.2 Feasibility: Supabase Edge Function làm WS proxy

**Có hỗ trợ không?** — **Có.** Supabase Edge Functions chạy trên Deno và hỗ trợ đầy đủ:

```typescript
// Edge Function: proxy-dictation/index.ts
Deno.serve(async (req) => {
  // Upgrade HTTP → WebSocket (client side)
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req)

  // Open WebSocket to provider (server side)
  const providerWs = new WebSocket(providerWssUrl)

  // Bidirectional proxy with interception
  clientWs.onmessage  = (e) => handleClientMessage(e, providerWs, session)
  providerWs.onmessage = (e) => handleProviderMessage(e, clientWs, session)

  return response  // Deno keeps both WS alive
})
```

**Wall-clock limits:**
- HTTP requests: giới hạn ~2 phút
- WebSocket connections: **không có giới hạn wall-clock cứng** — Deno giữ connection sống cho đến khi một trong hai bên đóng
- CPU time limit: ~2 phút CPU time — nhưng WS proxy gần như idle CPU (chỉ forward bytes), nên 5 phút dictation không đủ để hit giới hạn CPU

**Kết luận:** Edge Function WS proxy hoạt động tốt cho dictation sessions 5 giây – 5 phút.

### 3.3 Luồng đầy đủ (WS Proxy approach)

```
Client                    Edge Function (proxy-dictation)         STT Provider (Soniox/DG)
  │                                │                                        │
  │─── WS connect ────────────────►│                                        │
  │    headers: { Authorization }  │                                        │
  │                                │── Validate JWT ───────────────────────►│
  │                                │── Check dictation quota                │
  │                                │── Read cloud_service_config            │
  │                                │── Open WS to provider ────────────────►│
  │                                │◄─ provider connected ──────────────────│
  │◄── WS opened ──────────────────│                                        │
  │                                │   session = { user_id, start_time,    │
  │                                │               audio_ms: 0 }            │
  │                                │                                        │
  │─── binary: PCM chunks ────────►│─── binary: PCM chunks ────────────────►│
  │─── binary: PCM chunks ────────►│─── binary: PCM chunks ────────────────►│
  │                                │◄── interim transcript json ────────────│
  │◄── interim transcript json ────│   (forwarded as-is)                    │
  │                                │                                        │
  │─── {"type":"dictation_end"} ──►│   (intercept — không forward)          │
  │                                │─── provider finalize cmd ─────────────►│
  │                                │   Soniox: {"type":"finalize"}          │
  │                                │   Deepgram: {"type":"Finalize"}        │
  │                                │◄── final transcript json ──────────────│
  │◄── final transcript json ──────│   (forwarded with dictation metadata)  │
  │                                │                                        │
  │─── WS close ───────────────────►│                                       │
  │                                │── Debit dictation quota ──────────────►│
  │                                │   (audio_seconds từ provider response) │
  │                                │── Log usage_sessions ──────────────────│
  │                                │── Close provider WS ──────────────────►│
```

**Điểm then chốt:**
- `{"type":"dictation_end"}` là unified command từ client (Edge Function normalize sang provider format)
- Provider audio_seconds từ final response → dùng để post-debit (không cần đo wall clock)
- Edge Function intercept final message → thêm `dictation_seconds_remaining` trước khi forward về client
- Provider credentials chưa bao giờ rời khỏi Edge Function

### 3.4 Endpoint detection (tự động, không cần user action)

Ngoài manual finalize, cả Soniox và Deepgram hỗ trợ endpoint detection — tự kết thúc khi phát hiện im lặng:

```
Soniox: enable_endpoint_detection: true → server tự gửi kết quả final sau im lặng
Deepgram: endpointing: 500 (ms) → Deepgram finalize sau 500ms im lặng
```

Client có thể dùng endpoint detection thay vì manual finalize cho Voice Anywhere:
- User nói xong, dừng lại 0.5s → tự nhận transcript
- Không cần user action sau khi nói

Cấu hình trong dictation Edge Function:
```json
{
  "use_endpoint_detection": true,
  "endpoint_silence_ms": 500
}
```

---

## 4. Message Protocol (Client ↔ Edge Function)

Client giao tiếp với Edge Function qua cùng binary/JSON pattern như các STT clients hiện tại:

### Từ client gửi lên:

```
Binary frames: raw PCM s16le, 16kHz, mono (giống hệt sendAudio() hiện tại)

JSON frames:
  { "type": "dictation_connect", "language": "vi", "context": "...", "endpoint_detection": true }
  { "type": "dictation_end" }   ← manual finalize (khi user nhả PTT hoặc hotkey)
  { "type": "dictation_abort" } ← cancel (user đổi ý)
```

### Từ Edge Function trả về:

```json
// Interim (forwarded từ provider, normalized)
{ "type": "interim", "text": "xin chào", "is_final": false }

// Final transcript
{
  "type": "final",
  "text": "xin chào bạn khỏe không",
  "audio_seconds": 3.2,
  "provider": "soniox",
  "dictation_seconds_remaining": 876
}

// Lỗi
{ "type": "error", "code": "quota_exceeded", "used": 1800, "limit": 1800 }
{ "type": "error", "code": "unauthorized" }
{ "type": "error", "code": "service_not_configured" }
```

---

## 5. Translate Parameter Handling

Cả Voice Anywhere và Narration PTT đều có option dịch: **Nói → (dịch tuỳ chọn) → Text output**.

### Tham số

| Tham số | Mục đích | Xử lý ở đâu |
|---|---|---|
| `source_language` | Ngôn ngữ user đang nói — truyền cho STT provider để tăng accuracy | **Edge Function** → provider config |
| `target_language` | Ngôn ngữ muốn dịch ra (optional) | **Client-side** — translate service riêng, sau khi nhận transcript |

### Nguyên tắc

- **Edge Function chỉ làm STT.** Không xử lý translate trong proxy-dictation.
- `target_language` gửi lên để lưu session metadata/analytics, không ảnh hưởng provider config.
- Translate sau khi nhận `onOriginal(text)` — giống flow hiện tại của Monitor (STT → translate → TTS riêng).

### Message dictation_connect với language params

```json
{
  "type": "dictation_connect",
  "token": "<jwt>",
  "source_language": "vi",
  "target_language": "en",
  "context": "optional domain hints",
  "endpoint_detection": true,
  "endpoint_silence_ms": 500
}
```

### Flow từng tính năng

**Voice Anywhere:**
```
Nói (source_language) → DictationClient.onOriginal(text)
  → [nếu target_language] → callCloudAI / translate → text dịch
  → inject vào target app (clipboard/paste)
```

**Narration PTT:**
```
Nói (targetLang của Monitor) → DictationClient.onOriginal(text)
  → translate(targetLang → sourceLang)  [e.g. vi → en]
  → TTS(translated) → BlackHole → partner nghe
```

### DictationClient config params

```javascript
{
  sourceLanguage: 'vi',          // bắt buộc (default: 'auto')
  targetLanguage: 'en' | null,   // optional — client xử lý translate sau
  context: 'optional hints',
  endpointDetection: true,
  endpointSilenceMs: 500,
}
```

---

## 6. Provider Support Matrix

| Provider | WS + Finalize | Endpoint Detection | Multilingual | Speed | Notes |
|---|---|---|---|---|---|
| **Soniox** | ✓ `{"type":"finalize"}` | ✓ built-in | Xuất sắc (vi/en/...) | ~1-2s | **Recommended default** |
| **Deepgram** | ✓ `{"type":"Finalize"}` | ✓ endpointing param | Tốt (Nova-3) | ~0.5-1s | Tốt cho en |
| Gladia | ✓ (prerecorded API) | Partial | Tốt | ~2-3s | WS mode phức tạp |
| AssemblyAI | Không (REST async) | N/A | Tốt | ~3-8s | REST fallback |
| OpenAI Whisper | Không (REST only) | N/A | Tốt nhất | ~2-5s | REST fallback |

**Default provider cho dictation:** Soniox — đã được dùng cho STT streaming, multilingual tốt nhất (quan trọng cho vi/en), và hỗ trợ finalize đầy đủ.

**Admin config trong `cloud_service_config` table:**
```json
{
  "service_type": "dictation",
  "provider": "soniox",
  "endpoint_detection": true,
  "endpoint_silence_ms": 500,
  "max_audio_seconds": 300
}
```

---

## 6. Narration PTT — Audio Source

**Clarification:** Narration PTT lấy audio từ **mic** (không phải system audio):

```
User (speaks Vietnamese)
     │ microphone
     ▼
DictationClient.sendAudio(pcm)
     │ WS proxy → Edge Function → Soniox
     ▼
onOriginal("xin chào")
     │
     ▼
translate('vi' → 'en') → "hello"
     │
     ▼
TTS("hello", voice) → audio buffer
     │
     ▼
Output device: BlackHole 2ch (virtual mic)
     │
     ▼
Partner's Zoom/Teams hears translated English voice
```

**Mic capture cho Narration PTT:**
- Monitor có thể đang capture system audio (xem phim) — Narration PTT dùng mic riêng
- Nếu Monitor đang ở mic mode thì có thể share audio stream
- Cần đảm bảo 2 capture streams không conflict (Rust audio_cmd.rs xử lý)
- DictationClient nhận PCM chunks từ mic capture event riêng

---

## 7. Database Migration

### 7.1 Profiles table — dictation quota

```sql
-- Migration: add dictation quota columns
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS dictation_seconds_used    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dictation_addon_seconds   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS plan_dictation_limit      INTEGER NOT NULL DEFAULT 0;

-- plan_dictation_limit:
--   0   = không được dùng (upgrade required)
--   -1  = unlimited
--   N   = N giây/tháng

-- Set limits theo plan (trigger sẽ sync khi thay đổi plan):
UPDATE profiles SET plan_dictation_limit = 300  WHERE plan = 'trial';    -- 5 phút
UPDATE profiles SET plan_dictation_limit = 3600 WHERE plan = 'starter';  -- 1 giờ/tháng
UPDATE profiles SET plan_dictation_limit = -1   WHERE plan = 'pro';      -- unlimited
UPDATE profiles SET plan_dictation_limit = -1   WHERE plan = 'team';     -- unlimited
```

### 7.2 Usage sessions — service_type + provider tracking

```sql
-- Migration: per-service analytics
ALTER TABLE usage_sessions
  ADD COLUMN IF NOT EXISTS service_type  TEXT NOT NULL DEFAULT 'stt',
  ADD COLUMN IF NOT EXISTS provider_used TEXT;

-- service_type: 'stt' | 'dictation'
-- provider_used: 'soniox' | 'deepgram' | 'gladia' | 'openai_whisper' | ...

CREATE INDEX IF NOT EXISTS usage_sessions_service_idx
  ON usage_sessions (user_id, service_type, started_at DESC);
```

### 7.3 DB Functions

```sql
-- Post-debit dictation (KHÔNG cần reconcile — biết exact seconds từ provider)
CREATE OR REPLACE FUNCTION public.debit_dictation_usage(
  p_user_id UUID,
  p_seconds  NUMERIC   -- float vì provider trả e.g. 12.4s
) RETURNS INTEGER AS $$  -- returns remaining seconds
DECLARE
  v_remaining INTEGER;
BEGIN
  UPDATE public.profiles
  SET dictation_seconds_used = dictation_seconds_used + CEIL(p_seconds)::INT
  WHERE id = p_user_id;

  SELECT CASE
    WHEN plan_dictation_limit = -1 THEN 999999
    ELSE GREATEST(plan_dictation_limit - dictation_seconds_used + dictation_addon_seconds, 0)
  END INTO v_remaining
  FROM public.profiles WHERE id = p_user_id;

  RETURN v_remaining;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check remaining trước khi cho connect
CREATE OR REPLACE FUNCTION public.get_dictation_remaining(p_user_id UUID)
RETURNS INTEGER AS $$
  SELECT CASE
    WHEN plan_dictation_limit = -1 THEN 999999
    ELSE GREATEST(plan_dictation_limit - dictation_seconds_used + dictation_addon_seconds, 0)
  END
  FROM public.profiles WHERE id = p_user_id;
$$ LANGUAGE SQL SECURITY DEFINER;
```

### 7.4 getUserProfile — cập nhật query

```typescript
// src/lib/transkit-cloud.ts — getUserProfile() SELECT string:
'..., dictation_seconds_used, dictation_addon_seconds, plan_dictation_limit'

// UserProfile interface:
dictation_seconds_used: number
dictation_addon_seconds: number
plan_dictation_limit: number   // -1 = unlimited, 0 = no access, N = seconds/month
```

---

## 8. Edge Function: `proxy-dictation`

### 8.1 File structure

```
supabase/functions/proxy-dictation/
  index.ts           ← Entry point, WS upgrade + session management
  providers/
    soniox.ts        ← Soniox auth message + finalize translation
    deepgram.ts      ← Deepgram config + Finalize translation
    fallback_rest.ts ← HTTP upload fallback (Whisper, AssemblyAI)
  quota.ts           ← Check + debit dictation quota
  protocol.ts        ← Message normalization (client ↔ provider)
```

### 8.2 Session lifecycle (pseudo-code)

```typescript
Deno.serve(async (req) => {
  // 1. Validate JWT từ header (không phải query param — bảo mật hơn)
  const user = await validateJWT(req.headers.get('Authorization'))
  if (!user) return new Response('Unauthorized', { status: 401 })

  // 2. Check quota TRƯỚC khi mở WS connection
  const remaining = await getDictationRemaining(user.id)
  if (remaining <= 0) return new Response(
    JSON.stringify({ error: 'quota_exceeded' }), { status: 402 }
  )

  // 3. Upgrade HTTP → WebSocket (client side)
  const { socket: clientWs, response } = Deno.upgradeWebSocket(req)

  // 4. Đọc provider config
  const config = await getServiceConfig('dictation')  // từ cloud_service_config

  // 5. Session state
  const session = {
    userId: user.id,
    startTime: Date.now(),
    audioSeconds: 0,
    provider: config.provider,
    sessionId: crypto.randomUUID(),
  }

  clientWs.onopen = async () => {
    // 6. Mở WS tới provider với admin credentials
    const providerWs = await openProviderWebSocket(config, session)

    clientWs.onmessage = (e) => {
      if (e.data instanceof ArrayBuffer) {
        // PCM audio chunk → forward to provider
        providerWs.send(e.data)
      } else {
        const msg = JSON.parse(e.data)
        if (msg.type === 'dictation_connect') {
          // Gửi auth/config message tới provider
          sendProviderConfig(providerWs, config, msg)
        } else if (msg.type === 'dictation_end') {
          // Manual finalize — translate to provider format
          sendProviderFinalize(providerWs, config.provider)
        } else if (msg.type === 'dictation_abort') {
          providerWs.close()
          clientWs.close()
        }
      }
    }

    providerWs.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const normalized = normalizeProviderMessage(msg, config.provider)

      if (normalized.type === 'final') {
        // Capture audio_seconds từ provider response
        session.audioSeconds = normalized.audio_seconds
      }

      // Forward về client (với dictation_seconds_remaining nếu là final)
      clientWs.send(JSON.stringify(normalized))
    }
  }

  clientWs.onclose = async () => {
    // 7. Post-debit (chỉ nếu có audio đã process)
    if (session.audioSeconds > 0) {
      const remaining = await debitDictationUsage(session.userId, session.audioSeconds)
      // Log usage_sessions
      await logUsageSession({
        user_id: session.userId,
        service_type: 'dictation',
        duration_seconds: Math.ceil(session.audioSeconds),
        provider_used: session.provider,
      })
    }
  }

  return response
})
```

### 8.3 Provider normalization

**Soniox → normalized:**
```typescript
// Soniox raw:
{ "tokens": [{ "text": "xin", "is_final": true }, ...], "final_proc_time_ms": 3200 }

// Normalized (interim):
{ "type": "interim", "text": "xin chào", "is_final": false }

// Normalized (final — khi nhận finalize response):
{ "type": "final", "text": "xin chào bạn khỏe không", "audio_seconds": 3.2, "provider": "soniox" }
```

**Deepgram → normalized:**
```typescript
// Deepgram raw:
{ "channel": { "alternatives": [{ "transcript": "hello" }] }, "from_finalize": true, "duration": 2.8 }

// Normalized (final):
{ "type": "final", "text": "hello", "audio_seconds": 2.8, "provider": "deepgram" }
```

---

## 9. Client-side Implementation

### 9.1 New file: `src/services/transcription/transkit_cloud_dictation/client.js`

**DictationClient** — implements cùng callback contract với STT clients, nhưng kết nối qua WS proxy:

```javascript
export class TranskitCloudDictationClient {
  constructor() {
    this._ws = null
    this._config = null
    this._abortController = null

    // Callbacks — cùng interface với STT clients
    this.onOriginal    = null   // (text) => void
    this.onProvisional = null   // (text) => void  ← có interim results!
    this.onStatusChange = null  // ('connecting'|'recording'|'processing'|'done'|'error') => void
    this.onError       = null   // (msg, meta) => void

    // Dictation-specific
    this.onDictationSession = null  // ({ seconds_remaining }) => void
  }

  connect(config) {
    this._config = config
    this._abortController = new AbortController()
    this._doConnect(config)
  }

  async _doConnect(config) {
    this.onStatusChange?.('connecting')

    const session = await getSession()
    if (!session) {
      this.onError?.('unauthorized', { code: 'unauthorized' })
      return
    }

    // Kết nối tới Edge Function WS (không phải provider trực tiếp)
    const wsUrl = `${SUPABASE_WS_URL}/functions/v1/proxy-dictation`
    this._ws = new WebSocket(wsUrl, [], {
      headers: { 'Authorization': `Bearer ${session.access_token}` }
    })

    this._ws.onopen = () => {
      // Gửi dictation_connect với language/context config
      this._ws.send(JSON.stringify({
        type: 'dictation_connect',
        language: config.sourceLanguage ?? 'auto',
        context: config.customContext ?? '',
        endpoint_detection: config.endpointDetection ?? true,
        endpoint_silence_ms: config.endpointSilenceMs ?? 500,
      }))
      this.onStatusChange?.('recording')
    }

    this._ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      switch (msg.type) {
        case 'interim':
          this.onProvisional?.(msg.text)
          break
        case 'final':
          this.onOriginal?.(msg.text)
          this.onDictationSession?.({ seconds_remaining: msg.dictation_seconds_remaining })
          this.onStatusChange?.('done')
          break
        case 'error':
          this.onError?.(msg.code, msg)
          this.onStatusChange?.('error')
          break
      }
    }

    this._ws.onerror = () => {
      this.onError?.('connection_failed', { code: 'connection_failed' })
      this.onStatusChange?.('error')
    }
  }

  sendAudio(pcmBuffer) {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(pcmBuffer)  // binary frame
    }
  }

  // Gọi khi user release PTT / hotkey
  finalize() {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: 'dictation_end' }))
      this.onStatusChange?.('processing')
    }
  }

  disconnect() {
    if (this._ws) {
      this._ws.send(JSON.stringify({ type: 'dictation_abort' }))
      this._ws.close()
      this._ws = null
    }
    this.onStatusChange?.('disconnected')
  }
}
```

### 9.2 Index file: `src/services/transcription/transkit_cloud_dictation/index.js`

```javascript
import { TranskitCloudDictationClient } from './client.js'

export function createClient(options = {}) {
  const client = new TranskitCloudDictationClient()
  return client
}
```

### 9.3 Tích hợp Voice Anywhere (`useVoiceAnywhere.js`)

Khi `voice_anywhere_stt_service === 'transkit_cloud'`, dùng DictationClient:

```javascript
// Thêm import
import { createClient as createDictationClient } from '../../services/transcription/transkit_cloud_dictation'

function buildSTTClient(service, options) {
  switch (service) {
    case 'transkit_cloud':
      return createDictationClient(options)           // ← mới: WS proxy
    case 'transkit_cloud_streaming':
      return createCloudSTT(options)                  // ← legacy: temp credentials
    // ... các provider khác giữ nguyên
  }
}
```

Callback mapping trong Voice Anywhere:
```javascript
client.onProvisional = (text) => setLiveText(text)    // hiển thị text đang nói
client.onOriginal    = (text) => injectText(text)     // inject vào target app
client.onDictationSession = ({ seconds_remaining }) => updateQuotaDisplay(seconds_remaining)
```

### 9.4 Migration Narration PTT (`Monitor/index.jsx`)

**Hiện tại:** Narration PTT tạo duplicate STT session streaming song song với Monitor.

**Sau migration:** Dùng DictationClient cho PTT — không tạo session mới, upload khi release PTT.

```javascript
// src/window/Monitor/index.jsx

// PTT setup (thay thế toàn bộ duplicate session logic)
const narrationDictation = createDictationClient({
  sourceLanguage: targetLanguage,  // user đang nói ngôn ngữ đích
  endpointDetection: false,        // PTT: user control khi kết thúc
})

narrationDictation.onOriginal = async (transcript) => {
  // transcript → translate → TTS → BlackHole
  const translated = await translateText(transcript, targetLanguage, sourceLang)
  await playTTS(translated, narrationOutputDevice)
}

// PTT press
function onPTTPress() {
  narrationDictation.connect({ sourceLanguage: targetLanguage })
  startMicCapture(chunk => narrationDictation.sendAudio(chunk))
}

// PTT release
function onPTTRelease() {
  stopMicCapture()
  narrationDictation.finalize()  // → Edge Function → Soniox finalize → transcript
}
```

**Lưu ý mic capture cho Narration PTT:**
- Mic capture riêng biệt với Monitor's system audio
- Nếu Monitor đang ở `source: 'microphone'` mode → cần dừng Monitor mic capture trước khi PTT, hoặc multiplex cùng stream
- Nếu Monitor đang ở `source: 'system'` (xem phim) → Narration PTT mở mic capture riêng, không conflict

---

## 10. Rate Limiting

### Chiến lược: Quota + Connection guard

| Limit | Giá trị | Enforcement |
|---|---|---|
| Max audio/session | 300s (5 phút) | Edge Function close WS nếu vượt |
| Quota = 0 | Reject ngay khi WS connect | DB check trước khi upgrade WS |
| Concurrent WS | 3 per user | Check active count trong DB/KV |
| No per-minute rate limit | — | Quota tự điều tiết |

**Concurrent connection guard (optional, nếu cần):**
```sql
-- Đơn giản: count active trong usage_sessions trong 60s gần nhất
SELECT COUNT(*) FROM usage_sessions
WHERE user_id = $1
  AND service_type = 'dictation'
  AND started_at > now() - interval '60 seconds'
  AND duration_seconds = 0  -- chưa kết thúc
```

---

## 11. Config UI (Settings)

Thêm vào Settings → AI Service tab, phần mới **Dictation**:

```
┌─ Dictation ──────────────────────────────────────────────────────┐
│  Service               [Transkit Cloud ▾]                         │
│  Language              [Auto-detect ▾]                            │
│  Endpoint detection    [ON] — tự kết thúc sau 0.5s im lặng       │
│                                                                    │
│  Quota: ████░░░░░░ 420s / 3,600s used this month                 │
└────────────────────────────────────────────────────────────────────┘
```

Config keys mới:
```
dictation_service              : 'transkit_cloud' | 'deepgram' | 'soniox' | 'local_sidecar'
dictation_language             : 'auto' | 'vi' | 'en' | ...
dictation_endpoint_detection   : true | false
dictation_endpoint_silence_ms  : 500
```

---

## 12. Implementation Phases

### Phase 1 — Backend (Supabase)

- [ ] DB migration: `dictation_seconds_used`, `dictation_addon_seconds`, `plan_dictation_limit` → `profiles`
- [ ] DB migration: `service_type`, `provider_used` → `usage_sessions`
- [ ] DB functions: `debit_dictation_usage()`, `get_dictation_remaining()`
- [ ] Admin config: row `dictation` trong `cloud_service_config` table
- [ ] Edge Function: `proxy-dictation` — WS upgrade + proxy logic + quota check/debit
- [ ] Edge Function: provider adapters (Soniox, Deepgram)

### Phase 2 — Client SDK

- [ ] `callCloudDictation()` / `DictationWS` trong `transkit-cloud.ts` (helper cho WS URL + auth)
- [ ] Cập nhật `UserProfile` interface + `getUserProfile()` query
- [ ] `src/services/transcription/transkit_cloud_dictation/client.js` (DictationClient)
- [ ] `src/services/transcription/transkit_cloud_dictation/index.js`

### Phase 3 — Feature Integration

- [ ] Voice Anywhere: switch to DictationClient cho `transkit_cloud` service
- [ ] Voice Anywhere Settings: rename `transkit_cloud` → `transkit_cloud_streaming` cho legacy mode
- [ ] Narration PTT: migrate sang DictationClient, xóa duplicate session logic
- [ ] Narration PTT: clarify mic capture strategy (separate vs shared stream)

### Phase 4 — UI & Polish

- [ ] Settings: Dictation section với quota display
- [ ] Usage dashboard: `dictation_seconds_used` cạnh STT, TTS, AI
- [ ] `subscription_plans` trigger: sync `plan_dictation_limit` khi đổi plan

---

## 13. Quyết định kiến trúc & trade-offs

### WS proxy qua Edge Function — server gánh gì?

Khi dictation session đang chạy, Edge Function process:
- 2 WS connections (client + provider) — minimal resource
- Forwarding binary frames (PCM) — CPU overhead rất thấp
- JSON message parsing — minimal

Với dictation sessions 5–60 giây, số lượng concurrent sessions trung bình sẽ rất thấp. Không cần worry về scale ở giai đoạn này.

### Tại sao post-debit thay vì pre-debit?

STT streaming cần pre-debit vì session vô thời hạn — phải "giữ chỗ" quota.  
Dictation: biết `audio_seconds` chính xác từ provider response → post-debit đơn giản, không cần reconcile.

### Tại sao tách quota ngay từ đầu?

- STT và dictation có cost model khác nhau ở provider level
- Analytics: biết feature nào dùng nhiều
- Pricing flexibility: có thể bán dictation addon riêng
- Kỹ thuật: tách ngay dễ hơn migrate sau

### Narration PTT — không conflict với Monitor?

- Monitor `system audio` mode + Narration PTT `mic` → không conflict (2 device khác nhau)
- Monitor `mic` mode + Narration PTT → conflict tiềm năng — cần giải quyết ở Rust layer hoặc disable PTT khi Monitor đang dùng mic

---

## 14. Files cần thay đổi (summary)

| File | Loại thay đổi |
|---|---|
| `db/schema.sql` | Migration: dictation quota columns + service_type |
| `src/lib/transkit-cloud.ts` | Thêm WS helper cho dictation, cập nhật `UserProfile` |
| `src/services/transcription/transkit_cloud_dictation/client.js` | Tạo mới |
| `src/services/transcription/transkit_cloud_dictation/index.js` | Tạo mới |
| `src/window/VoiceAnywhere/useVoiceAnywhere.js` | Dùng DictationClient cho cloud mode |
| `src/window/Monitor/index.jsx` | Migrate Narration PTT → DictationClient |
| `src/window/Monitor/components/NarrationPanel/index.jsx` | Xóa duplicate session logic |
| `src/window/Settings/` | Thêm Dictation section + quota display |
| `supabase/functions/proxy-dictation/index.ts` | Tạo mới — WS proxy |
| `supabase/functions/proxy-dictation/providers/soniox.ts` | Tạo mới |
| `supabase/functions/proxy-dictation/providers/deepgram.ts` | Tạo mới |

---

*Document này là source of truth cho dictation service. Cập nhật khi có quyết định kiến trúc mới.*
