# Transkit Dynamic Provider System – Subscription \& Entitlement Design

## Mục tiêu

Xây dựng hệ thống **Dynamic Provider** cho phép Transkit:

- Giữ nguyên tinh thần **open-source** (Free = BYO key).
- Bán các **gói subscription** (Pro, Power…) thông qua việc mở khóa các **builtin managed providers**.
- Kiểm soát usage (phút transcription, AI request, TTS) theo từng gói.
- Cho phép user **chuyển đổi linh hoạt** giữa provider của chính họ và provider managed của Transkit.

***

## Kiến trúc tổng quan

### 1. Provider Types

Hệ thống hỗ trợ 3 loại provider ngang hàng:


| Loại | Ví dụ | Đặc điểm |
| :-- | :-- | :-- |
| **builtin-local** | Local OCR, local TTS | Chạy hoàn toàn trên máy, không cần key, không giới hạn |
| **custom (BYO)** | Soniox, OpenAI, ElevenLabs | User tự nhập API key, không bị trừ quota của Transkit |
| **builtin-managed** | `transkit-cloud-stt`, `transkit-cloud-tts`, `transkit-cloud-ai` | Chỉ khả dụng khi user có trial/subscription, usage bị trừ vào quota gói |

> **Nguyên tắc:** Provider managed được coi như một provider bình thường trong registry, chỉ khác là có **entitlement check** trước khi cho phép sử dụng.

***

## 2. Subscription Plans \& Entitlements

### Các gói đề xuất

| Plan | Giá | STT (phút/tháng) | AI requests | TTS (phút) | Cloud Sync | Trial |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| **Free (BYO)** | \$0 | 0 (managed) | 0 | 0 | ❌ | – |
| **Pro** | \$12/tháng | 600 (10h) | 300 | 120 | ✅ | 3 ngày |
| **Power** | \$29/tháng | 2400 (40h) | 1000 | 600 | ✅ | 3 ngày |

### Entitlement Flow

1. User đăng ký/đăng nhập → tạo `profile` trong Supabase.
2. Khi thanh toán thành công (Stripe webhook):
    - Cập nhật bảng `subscriptions` (status, period, plan_code).
    - Tự động bật các rows trong bảng `entitlements`:
        - `transkit-cloud-stt` = true
        - `transkit-cloud-tts` = true
        - `transkit-cloud-ai` = true
3. Khi user hết trial/hủy subscription:
    - `entitlements.enabled` = false → provider bị khóa trong UI.

***

## 3. Database Schema (cốt lõi)

### Bảng chính

- `profiles`: thông tin user, `stripe_customer_id`, `billing_mode` (BYO_FIRST / PRO_FIRST).
- `plans`: định nghĩa các gói (code, price, limits, stripe_price_id).
- `subscriptions`: trạng thái subscription hiện tại của user (plan_code, status, trial_end, period_end).
- `entitlements`: mapping user ↔ provider managed (enabled/disabled, source, expires_at).
- `usage_monthly`: theo dõi usage theo tháng (stt_seconds_used, ai_requests_used, tts_seconds_used).
- `projects`, `files`, `segments`: đồng bộ bản dịch/transcript giữa các thiết bị.


### View tiện lợi

```sql
CREATE VIEW v_me_entitlements AS
-- Trả về plan, status, limits, usage hiện tại của user
-- Dùng để gọi từ GET /me/entitlements
```


***

## 4. Client-side Logic (Desktop/Extension)

### SDK: `transkit-cloud.ts`

Cung cấp các hàm chính:

- `getEntitlements()`: gọi Edge Function `/me-entitlements` → trả về plan, status, providers enabled, usage.
- `resolveProviderEnabled(providerCode, entitlements)`: quyết định provider có được bật không và lý do nếu bị khóa.
- `getEffectiveBillingSource(billingMode, hasPro, sessionToggle)`: trả về `"managed"` hay `"byo"` cho session hiện tại.
- `consumeUsage({ stt_seconds, ai_requests, tts_seconds })`: trừ quota sau mỗi job.
- `createCheckoutSession(plan, billing)`: mở Stripe Checkout.


### Provider Interface

Mỗi provider (dù custom hay managed) đều tuân theo cùng một interface:

```ts
interface ServiceProvider {
  id: string;
  name: string;
  service: 'stt' | 'tts' | 'ai';
  kind: 'builtin-local' | 'custom' | 'builtin-managed';
  requiresUserKey: boolean;
  requiresPro: boolean;
  enabled: boolean;
  lockedReason?: 'no_account' | 'free_plan' | 'quota_exceeded' | 'trial_ended';
}
```

Khi user chọn provider trong UI:

- Nếu `kind = 'custom'` → dùng key từ settings, không gọi backend billing.
- Nếu `kind = 'builtin-managed'`:
    - Kiểm tra `enabled` từ entitlements.
    - Nếu enabled → gọi backend Transkit, sau đó gọi `consumeUsage()`.
    - Nếu không enabled → hiển thị tooltip/CTA upgrade.

***

## 5. UX Flow chính

### 5.1. Lần đầu mở app

- User chưa đăng nhập → tất cả `transkit-cloud-*` providers hiện mờ, label "Pro only".
- Custom providers (Soniox, OpenAI…) vẫn dùng bình thường nếu đã nhập key.


### 5.2. Nâng cấp Pro

1. User click "Start 3-day trial" hoặc "Go Pro".
2. Gọi `createCheckoutSession("PRO")` → mở Stripe Checkout.
3. Stripe webhook cập nhật `subscriptions` + `entitlements`.
4. App gọi lại `getEntitlements()` → providers `transkit-cloud-*` sáng lên, usage bar hiện ra.

### 5.3. Chọn provider trong Realtime screen

- Dropdown "Transcription provider":
    - Soniox (custom)
    - Deepgram (custom)
    - **Transkit Cloud** (managed, badge "Pro")
- Nếu user chọn Transkit Cloud:
    - Kiểm tra `resolveProviderEnabled()` → nếu `quota_exceeded` → hiện dialog:
        - "Switch to my own API keys"
        - "Buy more hours"
        - "Stop session"


### 5.4. Hết quota

- Backend trả 429 khi gọi `/consume-usage`.
- Client hiện `QuotaExceededDialog` với options rõ ràng.
- Không bao giờ tự động chuyển sang BYO mà không hỏi user.

***

## 6. Edge Functions (Supabase)

### `/me-entitlements` (GET)

- Input: user token.
- Output: JSON gồm plan, status, providers enabled, usage, cloud_sync.


### `/create-checkout-session` (POST)

- Input: `{ plan: "PRO", billing: "monthly" }`.
- Output: `{ url: "https://checkout.stripe.com/..." }`.


### `/consume-usage` (POST)

- Input: `{ stt_seconds, ai_requests, tts_seconds }`.
- Logic:
    - Kiểm tra subscription status.
    - So sánh với limits trong `v_me_entitlements`.
    - Nếu vượt → trả 429 + error code.
    - Nếu OK → gọi RPC `consume_usage()` để cộng dồn.


### `/stripe-webhook` (POST)

- Xử lý các events:
    - `checkout.session.completed`
    - `customer.subscription.created/updated/deleted`
    - `invoice.payment_succeeded/failed`
- Cập nhật `subscriptions` → sync `entitlements`.

***

## 7. Quy tắc vàng (cho AI Agent)

1. **Provider managed luôn ngang hàng với custom provider** – không ẩn logic billing sau provider hiện có.
2. **Không tự động chuyển đổi billing source** – luôn hỏi user trước khi switch từ managed sang BYO hoặc ngược lại.
3. **Entitlement là lớp trung gian** – app chỉ đọc `entitlements.enabled`, không đọc trực tiếp `subscriptions`.
4. **Usage tracking phải minh bạch** – user luôn thấy "X/Y phút đã dùng" trong UI.
5. **Free = BYO không giới hạn tính năng dịch (non-AI)** – chỉ khóa các managed providers, không khóa tính năng core.
6. **Trial 3 ngày có giới hạn thấp hơn Pro** (ví dụ 1 giờ STT, 50 AI requests) để tránh abuse.

***

## 8. Lợi ích của mô hình này

- **Dễ marketing:** "Free nếu bạn tự lo key, Pro nếu bạn muốn mở app và dùng ngay."
- **Dễ kỹ thuật:** provider registry không thay đổi, chỉ thêm 3 builtin providers có entitlement check.
- **Dễ mở rộng:** thêm gói mới, thêm provider managed mới chỉ cần insert row vào `plans` và `entitlements`.
- **Dễ debug/support:** mỗi request đều ghi rõ `billing_source = managed | byo`, dễ truy vết khi user báo lỗi.

***

## 9. File artifact đã sinh

Toàn bộ schema SQL, Edge Functions, client SDK, và UI component sẽ được tạo bởi AI Agent với cấu trúc:

```
db/schema.sql
supabase/functions/stripe-webhook/index.ts
supabase/functions/me-entitlements/index.ts
supabase/functions/create-checkout-session/index.ts
supabase/functions/consume-usage/index.ts
src/lib/transkit-cloud.ts
src/providers/transkit-cloud-stt.ts
src/components/ProviderSettings.tsx
```