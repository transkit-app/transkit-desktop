# Transkit Desktop

## What This Is

Transkit Desktop là một bộ công cụ dịch thuật toàn diện dạng desktop app (Tauri + React + Rust), hỗ trợ real-time transcription, dịch đa nguồn, TTS, OCR và AI-powered suggestions. Ứng dụng phục vụ các tình huống thực tế: họp team, gặp khách hàng, xem video/tutorial, và phỏng vấn — giúp người dùng không chỉ nghe hiểu mà còn phản ứng nhanh, đúng tông, đúng bối cảnh.

## Core Value

AI hiểu context cuộc hội thoại và gợi ý hành động cụ thể ngay trong giao diện — không cần copy-paste, không cần rời khỏi luồng làm việc.

## Requirements

### Validated

<!-- Inferred from existing codebase -->

- ✓ Real-time audio transcription qua Soniox WebSocket (speaker diarization, seamless session reset) — existing
- ✓ Batch transcription qua OpenAI Whisper và AssemblyAI — existing
- ✓ Dịch đa nguồn: 20+ providers (Google, DeepL, OpenAI, Groq, Gemini, Baidu, DeepL, Bing, Yandex, Youdao, v.v.) — existing
- ✓ Text-to-Speech với nhiều engine plug-and-play — existing
- ✓ OCR / Screenshot translation — existing
- ✓ Multi-window Tauri app (Monitor, Translate, Recognize, Config, Screenshot, Updater) — existing
- ✓ Pluggable service architecture (built-in + plugin providers) — existing
- ✓ Persistent config via Tauri Store plugin — existing
- ✓ i18n / localization (18+ ngôn ngữ UI) — existing

### Active

<!-- AI Layer — milestone này -->

- [ ] Inline AI suggest button dưới mỗi câu dịch trong Monitor window
- [ ] Floating AI response div (highlight màu + AI icon) append ngay dưới câu được click — không mở tab mới
- [ ] AI tổng hợp N câu context trước đó + personal context khi generate suggestion
- [ ] Smart scroll detection: khi user click suggest → dừng auto-scroll, detect section đang xem, hiển thị "scroll to latest" button
- [ ] Hotkeys: "Suggest reply" / "Summarize last 5 min" / "Ask AI" (chat inline)
- [ ] Session memory lưu theo file/project: meeting goals, key points đã nói, decisions tạm thời
- [ ] Personal profile cố định (tên, vai trò, công ty) — dùng làm system context cho mọi AI call
- [ ] Per-session context input: mục tiêu cuộc họp, người tham gia, toàn cảnh dự án — nhập khi bắt đầu session
- [ ] AI nhận biết loại câu: câu hỏi / quyết định / action item / noise (chào hỏi, small talk)
- [ ] Trích action items tự động từ session
- [ ] Plug-and-play AI providers: OpenAI, Claude (Anthropic), Gemini — cùng pattern với translation services
- [ ] Hỗ trợ tất cả 4 use cases: họp team, gặp khách hàng, xem video/tutorial, phỏng vấn/1:1

### Out of Scope

- Audio generation / voice synthesis cho AI responses — text-only để giữ chi phí thấp và tốc độ cao
- Persistent cross-session memory (nhớ khách hàng qua nhiều lần gặp) — defer v2
- Local model (Ollama) — defer v2, trước mắt dùng cloud providers
- Mobile app — web-first / desktop-first

## Context

Codebase hiện tại đã có nền tảng vững: multi-window Tauri, pluggable service framework, real-time transcription pipeline. AI layer sẽ build on top của Monitor window (nơi transcript real-time hiển thị) và reuse pattern service plug-and-play đã có cho AI providers.

Concern cần chú ý từ codebase map:
- Một số component lớn (Monitor/index.jsx 908 lines, TargetArea 836 lines) — AI layer nên tách thành module riêng, không nhét vào component đã lớn
- Silent error handling phổ biến — AI calls cần explicit error states (user biết khi AI fail)
- eval() trong plugin system là security risk — AI provider plugins cần sandbox riêng

## Constraints

- **Tech Stack**: Tauri 1.8 + React 18 + TypeScript + Rust — không thay đổi nền tảng
- **Text-only AI**: Tất cả AI interactions là text (no audio generation) — giữ chi phí thấp
- **Plug-and-play pattern**: AI providers phải follow cùng pattern với translation services để maintainable
- **Performance**: AI suggestions không được block real-time transcription stream
- **Privacy**: API keys lưu local, không qua server trung gian

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Inline floating div thay vì sidebar panel | User muốn suggestion xuất hiện ngay tại câu đang xem, không phải nhìn sang bên | — Pending |
| Plug-and-play AI providers (OpenAI/Claude/Gemini) | Nhất quán với architecture hiện tại, user tự chọn provider | — Pending |
| Session memory lưu theo file | Đủ cho v1, không cần backend phức tạp | — Pending |
| Smart scroll detection khi trigger AI | UX quan trọng: user đang đọc thì không bị kéo xuống cuối | — Pending |

---
*Last updated: 2026-03-18 after initialization*
