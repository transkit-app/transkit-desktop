# Codebase Concerns

**Analysis Date:** 2026-03-18

## Tech Debt

**Large Component Files with Mixed Responsibilities:**
- Issue: Multiple React components exceed 800+ lines with intertwined state management, event handling, and business logic
- Files: `src/window/Monitor/index.jsx` (908 lines), `src/window/Translate/components/TargetArea/index.jsx` (836 lines), `src/window/Monitor/tts.js` (747 lines), `src/window/Translate/index.jsx` (648 lines), `src/window/Config/pages/General/index.jsx` (612 lines)
- Impact: Difficult to test, debug, and maintain. High cognitive load when modifying features. Increased risk of unintended side effects.
- Fix approach: Extract into smaller, focused components with clear boundaries. Move state management to custom hooks. Separate TTS logic into dedicated modules.

**Silent Error Handling Throughout Codebase:**
- Issue: Many catch blocks swallow errors without logging or user notification. Pattern: `catch (_) {}` or `catch (err) { /* silent */ }`
- Files: `src/window/Monitor/index.jsx` (lines 284, 290, 445, 545, 593), `src/window/Monitor/elevenlabs-tts.js` (lines 142, 250, 252), `src/window/Monitor/tts.js` (lines 668, 720), `src/services/transcription/assemblyai_stt/client.js` (line 170), `src/utils/store.js` (line 12)
- Impact: Failures go undetected, making debugging hard. Users never know operations failed. Silent failures in file I/O can lose transcript data.
- Fix approach: Log errors to console in development, emit user-facing toasts for critical operations (autosave, file writes). Create error boundary wrapper component.

**Dynamic Code Execution via eval():**
- Issue: `eval()` used to execute plugin scripts dynamically without validation
- Files: `src/utils/invoke_plugin.js` (line 35)
- Impact: Major security vulnerability. Malicious or corrupted plugin scripts execute with full app privileges. No sandboxing or validation.
- Fix approach: Replace eval() with Function constructor + strict scope, or use Web Workers with postMessage API. Implement plugin manifest validation and code signing.

**Unsafe HTML Rendering:**
- Issue: `dangerouslySetInnerHTML` used to render translation output directly from external API responses
- Files: `src/window/Translate/components/TargetArea/index.jsx` (lines 794-796, 805-807)
- Impact: XSS vulnerability if translation API is compromised or returns malicious HTML. User input sanitization not visible in translate flow.
- Fix approach: Parse HTML with DOMPurify before rendering. Use react-markdown with xss-safe config for markdown content. Add CSP headers to prevent inline script execution.

**Unvalidated JSON Parsing Without Fallbacks:**
- Issue: `JSON.parse()` called throughout codebase without try-catch or schema validation
- Files: `src/services/translate/openai/index.jsx` (lines 56, 87, 98), `src/window/Translate/index.jsx` (line 201), `src/services/transcription/soniox_stt/client.js` (line 153), multiple service implementations
- Impact: Malformed API responses or corrupted config files crash features. No graceful degradation.
- Fix approach: Create JSONParser utility with schema validation using Zod or similar. Add default fallback values. Wrap all JSON.parse in try-catch with specific error handling.

**Global State Leakage:**
- Issue: Global variables used at module level without proper initialization: `let timer = null`, `let blurTimeout = null`, `let unlisten = listenBlur()` in component files
- Files: `src/window/Config/pages/General/index.jsx` (line 24), `src/window/Translate/index.jsx` (lines 24-45), shared event listener setup at top level
- Impact: Race conditions between component instances, memory leaks from uncleared timers, event listeners not properly cleaned up across hot reloads.
- Fix approach: Move global state into custom hooks using useRef(). Initialize listeners only once with useEffect. Create singleton pattern for Tauri event handlers.

## Known Bugs

**Transcript Auto-save Queue May Lose Data on Window Close:**
- Symptoms: Typed or translated text not saved when monitor window is force-closed before auto-save queue is flushed
- Files: `src/window/Monitor/index.jsx` (lines 574-577, 276-291)
- Trigger: Close monitor window during active transcription while saveQueueRef has pending entries
- Impact: User loses recent transcript entries
- Workaround: Manual save before closing. Current code uses fire-and-forget `writeTextFile().catch(() => {})` in beforeunload which may not execute
- Fix approach: Implement synchronous flush or use sessionStorage fallback. Add delay before window close to ensure queue is empty.

**Soniox WebSocket Reconnect Can Create Duplicate Clients:**
- Symptoms: Audio might be processed twice or connections leak during rapid reconnects
- Files: `src/services/transcription/soniox_stt/client.js` (lines 64-209)
- Trigger: Network dropout followed by immediate reconnect triggers old WS handler callbacks racing with new connection
- Impact: Memory leak from multiple WebSocket connections. Duplicate transcriptions added to log.
- Workaround: Mark old WS with `_isOld` flag and check before processing (currently implemented but not airtight during race)
- Fix approach: Use AbortController for clean cancellation. Ensure all pending callbacks from old connection are cancelled before creating new one.

**TTS Playback Rate Calculation Fragile:**
- Symptoms: TTS audio may play at wrong speed if config values are missing or have type mismatches
- Files: `src/window/Monitor/index.jsx` (line 226), `src/window/Monitor/tts.js` (lines 122-139)
- Trigger: Edge TTS rate string (`+0%`, `+50%`) sent to non-Edge services; playback rate calculated without bounds checking
- Impact: Audio plays at incorrect speed (too fast, too slow, or inaudible)
- Workaround: None visible
- Fix approach: Normalize rate values per service type before playback. Add bounds validation (0.25x to 4x). Create test matrix for all TTS service combinations.

**Monitor Window Position State Desync After Reopen:**
- Symptoms: Window appears in unexpected position when monitor is reopened after close
- Files: `src/window/Monitor/index.jsx` (lines 533, 540)
- Trigger: Position is read from state during render, but Tauri async calls may resolve after state changes
- Impact: Poor UX, users must reposition window
- Workaround: None
- Fix approach: Use Tauri's native window event listeners instead of manual position tracking. Persist position after close, not during open.

**Plugin Loading Race Condition:**
- Symptoms: Plugin list may show stale data or duplicate entries after rapid config changes
- Files: `src/window/Translate/index.jsx` (lines 217-222)
- Trigger: `loadPluginList()` called twice concurrently, then results from first overwrite results from second
- Impact: Incorrect service list, broken plugin selection
- Workaround: None
- Fix approach: Add abort signal or debounce to loadPluginList(). Use useReducer for consistent state updates.

## Security Considerations

**API Keys Stored in Plain Text in Config:**
- Risk: API keys for Soniox, ElevenLabs, OpenAI, Groq, etc. stored unencrypted in `config.json`
- Files: `src/utils/store.js`, all `*/Config.jsx` files for services (e.g., `src/services/tts/elevenlabs_tts/Config.jsx`)
- Current mitigation: Uses Tauri's appConfigDir() which is OS user-only readable, but no encryption
- Impact: Compromised device = compromised API keys. Keys visible if config file is backed up or synced unencrypted
- Recommendations:
  - Use OS keychain/credential manager (Tauri SecureStorage or native bindings)
  - Encrypt sensitive fields in config.json with master password or device-derived key
  - Rotate API keys after compromise detection
  - Add warning banner when connecting services without encryption

**Plugin Script Execution Without Sandbox:**
- Risk: User plugins execute with same privileges as main app. No code review or signature requirement.
- Files: `src/utils/invoke_plugin.js` (line 35)
- Current mitigation: Plugins must be in user's appConfigDir (not easily accessible)
- Impact: Malicious plugin can read all files, send data to attacker, intercept credentials
- Recommendations:
  - Implement plugin permission system (file access, network, etc.)
  - Require plugin manifest.json with declared permissions
  - Use Web Workers for plugin execution with message passing API
  - Add manual review/signing step for first-party plugins

**Tauri Invoke Calls Lack Input Validation:**
- Risk: Frontend sends unvalidated data to Tauri backend (e.g., file paths, service names)
- Files: Throughout components using `invoke()` (e.g., `src/window/Monitor/index.jsx` lines 390, 445)
- Current mitigation: None visible
- Impact: Backend may be exploited with path traversal, resource exhaustion, or type confusion
- Recommendations:
  - Create typed Tauri command builders with input validation
  - Sanitize all file paths on frontend before sending
  - Add rate limiting to invokes
  - Log all invokes for audit trail

**XSS via External API Responses:**
- Risk: Translation, AI, and recognition services return HTML/markdown that is rendered unsanitized
- Files: `src/window/Translate/components/TargetArea/index.jsx` (lines 794-806), AI context generation
- Current mitigation: None visible
- Impact: If API is compromised, attacker injects malicious script into user's context
- Recommendations:
  - Use DOMPurify library to sanitize all HTML
  - Render markdown with xss-safe renderer (react-markdown + xss plugin)
  - Implement CSP strict policy
  - Add iframe sandbox for iframe-based content

## Performance Bottlenecks

**Monitor Window Re-renders on Every Audio Chunk:**
- Problem: Monitor log entries added to state array for each transcription chunk, triggering full component re-render
- Files: `src/window/Monitor/index.jsx` (lines 369-378)
- Cause: `setEntries(prev => [...prev, entry])` re-renders 908-line component each time a new entry arrives
- Impact: On high-frequency services (Soniox real-time), monitor lags, CPU spike
- Improvement path:
  - Virtualize entry list with react-window or tanstack/react-virtual
  - Move entry list to separate component to isolate re-renders
  - Use `useTransition` or `useDeferredValue` to defer log updates
  - Implement entry batching (collect 10 entries before state update)

**TTS Synthesis Sequential on Google Translate Service:**
- Problem: Google TTS fetches and plays one chunk at a time. Cannot pipeline requests.
- Files: `src/window/Monitor/tts.js` (lines 530-537)
- Cause: Google TTS API fetches are serialized with 200ms delay between them
- Impact: 2-3 second delay for first TTS output, jerky playback of long texts
- Improvement path:
  - Use parallel batch fetching with configurable concurrency limit (3-5 parallel requests)
  - Pre-fetch next N chunks while current plays
  - Implement progressive streaming from edge-tts (already partially done for Edge)

**Language Detection Synchronous on App Startup:**
- Problem: `src/utils/lang_detect.js` (334 lines) runs expensive language detection at startup, blocks UI
- Files: `src/utils/lang_detect.js`
- Cause: Large precomputed language model loaded and initialized synchronously
- Impact: App takes 2-3 seconds to open first window
- Improvement path:
  - Load language detection in Web Worker on demand
  - Implement lazy initialization with loading UI
  - Cache detection results

**Translate Window Auto-Resize Calculation Expensive:**
- Problem: Resize triggered on every render with monitor size lookup and math
- Files: `src/window/Translate/index.jsx` (lines 257-307)
- Cause: `useEffect` with dependencies including service lists causes cascade of resizes
- Impact: Jank when changing translate service or language
- Improvement path:
  - Debounce resize with requestAnimationFrame
  - Cache monitor size lookup
  - Use ResizeObserver instead of setTimeout polling

## Fragile Areas

**Soniox Client Connection State Machine:**
- Files: `src/services/transcription/soniox_stt/client.js`
- Why fragile:
  - Complex state transitions (connecting → connected → reconnecting → error)
  - WebSocket close codes must be handled perfectly; missing one causes silent failure
  - Session timeout (3 min) and reconnect logic can race during network blips
  - `_isOld` flag scheme is clever but brittle if timing assumptions break
- Safe modification:
  - Add explicit state machine logging (log all transitions)
  - Add integration tests for all close code scenarios
  - Test on flaky networks (Chrome DevTools throttling)
  - Add timeout safeguards (e.g., max reconnect time)
- Test coverage: No visible test files for Soniox client

**TTS Queue Ordering and Timing:**
- Files: `src/window/Monitor/tts.js` (full file)
- Why fragile:
  - Complex pipeline with parallel fetches but serial playback
  - `_audioNextTime` tracking can drift if audio context stops
  - Different API types (edge_tts, google, vieneu, openai) have different timing characteristics
  - Rate adjustment math assumes fixed sample rate (24kHz) but some services vary
- Safe modification:
  - Never change fetch concurrency without stress testing
  - Test with very long texts (>5000 chars) that span multiple chunks
  - Validate audio context clock against system clock
  - Add instrumentation for queue timing metrics
- Test coverage: No visible test files

**Monitor Auto-Save Disk I/O:**
- Files: `src/window/Monitor/index.jsx` (lines 276-306)
- Why fragile:
  - File path construction is async, can fail mid-transcription
  - Queue flushing uses fire-and-forget error handling
  - No retry logic if disk is full
  - Window close can abort pending writes
- Safe modification:
  - Add disk space check before enabling autosave
  - Implement write queue with exponential backoff
  - Test with read-only filesystem
  - Add explicit error state to UI if autosave fails
- Test coverage: No visible test files

**Event Listener Cleanup in Effects:**
- Files: `src/window/Monitor/index.jsx` (lines 315-327, 580-584)
- Why fragile:
  - `listen()` promises and cleanup functions can be lost if effect re-runs
  - Global `unlisten` state in Translate component shares across instances
  - No protection against calling cleanup twice
- Safe modification:
  - Always store unlisten promise in useRef
  - Clear refs before effect cleanup
  - Test component mounting/unmounting cycles
  - Add console warnings if cleanup called twice (dev mode)
- Test coverage: No visible test files

## Scaling Limits

**Monitor Log Entry Array Unbounded:**
- Current capacity: MAX_ENTRIES = 100 entries in memory
- Limit: With frequent updates, older entries still kept in DOM causing slowdown
- Impact: After hours of transcription, Monitor becomes noticeably slower
- Scaling path:
  - Implement virtualization (only render visible entries)
  - Move old entries to disk after N hours
  - Implement entry batching (group by minute)
  - Use LinkedList instead of array for faster oldest-entry eviction

**Config Store Unbounded:**
- Current capacity: Single JSON file, all settings loaded into memory
- Limit: If users add 100+ service instances or large context presets, store becomes slow
- Impact: App startup time increases linearly
- Scaling path:
  - Implement lazy loading for service configs
  - Use IndexedDB for large datasets
  - Add migrations to prune old/unused settings

**Concurrent TTS Synthesis Requests:**
- Current capacity: 1 ongoing synthesis per service type
- Limit: Cannot queue more than ~10-20 transcriptions before memory pressure
- Impact: With fast speech input, TTS lags significantly behind
- Scaling path:
  - Increase synthesis concurrency limit (configurable per service)
  - Implement disk-based job queue for very long texts
  - Add memory pressure monitoring and auto-throttle

## Dependencies at Risk

**edge-tts-universal (1.4.0):**
- Risk: Unmaintained or slow-moving package for Edge TTS synthesis
- Impact: If Edge TTS API changes, package breaks until update available
- Migration plan: Monitor GitHub for updates. Consider forking if maintenance stops. Build native Edge TTS client if critical.

**tauri-plugin-store (v1):**
- Risk: Uses JSON file persistence, not designed for high-frequency updates
- Impact: Config writes can lose data on crash, race conditions with watchers
- Migration plan: Migrate to tauri-plugin-sql with proper transactions. Or implement custom SQLite schema.

**jose (5.9.6):**
- Risk: JWT library used for plugin signing (if implemented). May have crypto vulnerabilities.
- Impact: Plugin signature verification could be bypassed
- Migration plan: Keep updated with security patches. Consider using libsodium bindings for signing.

**crypto-js (4.2.0):**
- Risk: Known to be slower and have timing attack vulnerabilities compared to native crypto
- Impact: API key encryption (if implemented) would be suboptimal
- Migration plan: Replace with TweetNaCl.js or use native Web Crypto API. Do NOT use for sensitive key encryption.

## Missing Critical Features

**No API Key Encryption:**
- Problem: All API keys stored in plain config.json
- Blocks: Secure credential storage, multi-device sync, sharing configurations safely
- Recommendations: Add OS keychain integration as Phase 1. Add config encryption as Phase 2.

**No Error Recovery UI:**
- Problem: Silent failures mean users don't know transcription/translation stopped
- Blocks: Reliable production use, customer support investigation
- Recommendations: Add connection status indicator, error toast notifications, auto-retry UI.

**No Monitoring/Debugging Telemetry:**
- Problem: No way to diagnose why a service failed beyond console logs
- Blocks: Troubleshooting user issues, identifying systemic problems
- Recommendations: Add structured logging, error rate tracking, performance metrics export.

**No Plugin Sandboxing:**
- Problem: Plugins run with full app privileges
- Blocks: Safe third-party plugin ecosystem, risk mitigation
- Recommendations: Implement Web Worker sandbox with capability-based permissions.

**No Backup/Restore for Transcripts:**
- Problem: Transcripts are local-only, no cloud sync or backup
- Blocks: Multi-device use, disaster recovery
- Recommendations: Add cloud sync option (optional), local backup utility.

## Test Coverage Gaps

**Soniox Client Connection Logic:**
- What's not tested: Reconnection logic, close code handling, session timeout edge cases
- Files: `src/services/transcription/soniox_stt/client.js`
- Risk: Connection bugs go undetected, flaky network causes user-facing failures
- Priority: High (core feature)

**TTS Queue Ordering and Playback:**
- What's not tested: Multi-service TTS, rate changes during playback, concurrent enqueue calls
- Files: `src/window/Monitor/tts.js`
- Risk: Audio plays in wrong order or at wrong speed without warning
- Priority: High (user-facing audio)

**Transcript Auto-Save:**
- What's not tested: Save failures, concurrent writes, window close during save
- Files: `src/window/Monitor/index.jsx`
- Risk: Data loss on any I/O error
- Priority: High (data integrity)

**Translation Result Rendering:**
- What's not tested: XSS attack vectors via malicious translation results, HTML sanitization
- Files: `src/window/Translate/components/TargetArea/index.jsx`
- Risk: Security vulnerability if API compromised
- Priority: High (security)

**Plugin Loading and Execution:**
- What's not tested: Invalid plugin manifests, plugin crash isolation, permission enforcement
- Files: `src/utils/invoke_plugin.js`, `src/window/Translate/index.jsx`
- Risk: Broken or malicious plugins crash main app or compromise data
- Priority: High (security + stability)

**Monitor Component Re-render Performance:**
- What's not tested: Render time with 1000+ log entries, memory usage with large transcript
- Files: `src/window/Monitor/index.jsx`
- Risk: Monitor becomes unusable on long sessions
- Priority: Medium (performance)

**Configuration Persistence and Migration:**
- What's not tested: Config version upgrades, backward compatibility, corruption recovery
- Files: `src/utils/store.js`
- Risk: Config upgrades fail, users lose settings
- Priority: Medium (reliability)

---

*Concerns audit: 2026-03-18*
