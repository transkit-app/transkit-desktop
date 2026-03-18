# Testing Patterns

**Analysis Date:** 2026-03-18

## Test Framework

**Runner:**
- Not detected — No Jest, Vitest, or other test runner configured
- No `jest.config.js`, `vitest.config.js`, or similar test configuration files found
- No test scripts in `package.json`

**Assertion Library:**
- Not detected

## Current Testing Status

No automated test framework is present in this codebase. The project contains:
- No unit test files (`.test.js`, `.test.jsx`, `.test.ts`, `.test.tsx`)
- No integration test files (`.spec.js`, etc.)
- No test configuration files
- No `__tests__/` or `test/` directories in `src/`
- No test scripts in `package.json`

This is a production Tauri desktop application relying on manual testing during development.

## Recommended Testing Approach

### Unit Testing (Vitest)

**For utility functions** — Location: `src/utils/__tests__/` (co-located)

Example test structure for `src/utils/service_instance.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { createServiceInstanceKey, getServiceName, whetherPluginService } from '../service_instance';

describe('service_instance', () => {
    it('should create a key with serviceName@randomId format', () => {
        const key = createServiceInstanceKey('openai_ai');
        expect(key).toMatch(/^openai_ai@[a-z0-9]+$/);
    });

    it('should extract service name from instance key', () => {
        expect(getServiceName('openai_ai@abc123')).toBe('openai_ai');
    });

    it('should identify plugin services', () => {
        expect(whetherPluginService('plugin:my_plugin@id')).toBe(true);
        expect(whetherPluginService('openai_ai@id')).toBe(false);
    });
});
```

**For pure utilities** like `debounce`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { debounce } from '../index';

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('should delay function execution', () => {
        const mockFn = vi.fn();
        const debouncedFn = debounce(mockFn, 300);

        debouncedFn('test');
        expect(mockFn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(300);
        expect(mockFn).toHaveBeenCalledWith('test');
    });

    it('should cancel previous calls on subsequent invocations', () => {
        const mockFn = vi.fn();
        const debouncedFn = debounce(mockFn, 300);

        debouncedFn('first');
        debouncedFn('second');

        vi.advanceTimersByTime(300);
        expect(mockFn).toHaveBeenCalledTimes(1);
        expect(mockFn).toHaveBeenCalledWith('second');
    });
});
```

### Component Testing (Vitest + React Testing Library)

**For React components** — Location: `src/window/Monitor/components/__tests__/MonitorToolbar.test.jsx`

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MonitorToolbar from '../MonitorToolbar';

describe('MonitorToolbar', () => {
    const mockProps = {
        isRunning: false,
        sourceAudio: 'system',
        sourceLang: 'en',
        targetLang: 'vi',
        audioCapabilities: { system_audio: true },
        fontSize: 14,
        isSubMode: false,
        isTTSEnabled: false,
        showContextPanel: false,
        showOriginal: true,
        bgOpacity: 100,
        onToggleRun: vi.fn(),
        onSetSourceAudio: vi.fn(),
        onSetSourceLang: vi.fn(),
        onSetTargetLang: vi.fn(),
        onFontSizeChange: vi.fn(),
    };

    it('should render audio source buttons', () => {
        render(<MonitorToolbar {...mockProps} />);
    });
});
```

### Integration Testing

For Tauri-specific functionality (store, invoke, window management), integration tests should be run in the Tauri environment.

**Manual testing checklist**:
- [ ] Store initialization and persistence (`src/utils/store.js`)
- [ ] Configuration sync across windows (emit/listen pattern)
- [ ] TTS queue pipeline (audio ordering and playback)
- [ ] Service instance creation and lookup
- [ ] Transcription/translation service switching
- [ ] Monitor window audio capture and display

## Testing Best Practices

### What to Mock

- **Tauri API calls**: `@tauri-apps/api/*` modules (`appWindow.show()`, `invoke()`, `listen()`, `emit()`)
  - Use `vi.mock()` in Vitest
- **External services**: Mock API calls to transcription/translation services
  - Mock `transcriptionServices`, `aiServices`
- **Audio context**: Mock `AudioContext` and `BufferSource` for TTS tests
  - See `src/hooks/useVoice.jsx` for actual usage

### What NOT to Mock

- Utility functions — test pure utilities directly
- Constants and enums — use real values
- Store operations — can be tested with real Tauri store in integration tests

### Async Testing Pattern

```javascript
it('should generate context from topic', async () => {
    const result = await generateSonioxContext('meeting notes', 'openai_ai@123');
    expect(result).toHaveProperty('general');
    expect(result).toHaveProperty('text');
});
```

### Error Testing Pattern

```javascript
it('should throw "no_service" when AI service not found', async () => {
    await expect(generateSonioxContext('topic', 'nonexistent_ai@id'))
        .rejects
        .toThrow('no_service');
});

it('should throw "parse_error" when JSON parsing fails', async () => {
    await expect(generateSonioxContext('topic', 'ai@id'))
        .rejects
        .toThrow('parse_error');
});
```

## Test File Organization

Recommended structure:

```
src/
├── utils/
│   ├── __tests__/
│   │   ├── service_instance.test.ts
│   │   ├── index.test.js
│   │   └── generateSonioxContext.test.js
│   ├── service_instance.ts
│   ├── index.js
│   └── generateSonioxContext.js
├── hooks/
│   ├── __tests__/
│   │   ├── useConfig.test.jsx
│   │   ├── useGetState.test.jsx
│   │   └── useSyncAtom.test.jsx
│   └── [hook files]
└── window/
    └── Monitor/
        ├── components/__tests__/
        │   └── MonitorToolbar.test.jsx
        └── __tests__/
            └── tts.test.js
```

## Test Configuration

**Recommended `vitest.config.js`**:

```javascript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./src/__tests__/setup.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html'],
            exclude: [
                'node_modules/',
                'src/__tests__/',
                '**/*.test.*',
                '**/*.spec.*',
            ],
        },
    },
});
```

## Coverage Expectations

**Current state**: No coverage enforced

**Recommended targets**:
- Utility functions: 80%+ coverage
- Hooks: 70%+ coverage (higher complexity due to Tauri dependencies)
- Components: 50%+ for critical UI components
- Service integrations: Integration tests preferred over unit tests

---

*Testing analysis: 2026-03-18*
