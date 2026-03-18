# Coding Conventions

**Analysis Date:** 2026-03-18

## Naming Patterns

**Files:**
- Components: `PascalCase` with `.jsx` extension: `MonitorToolbar.jsx`, `WindowControl.jsx`
- Utilities/helpers: `camelCase` with `.js`, `.ts`, or `.jsx` extension: `useConfig.jsx`, `store.js`, `service_instance.ts`
- Index files: Use `index.jsx` or `index.js` for barrel exports from directories (e.g., `src/hooks/index.jsx`)

**Functions:**
- Regular functions: `camelCase`: `debounce()`, `formatEntryMarkdown()`, `generateSonioxContext()`
- React hooks: `camelCase` with `use` prefix: `useConfig()`, `useGetState()`, `useSyncAtom()`, `useVoice()`
- Event/callback handlers: `camelCase` prefixed with `on`: `onToggleRun()`, `onSetSourceAudio()`, `onClear()`
- Service initialization functions: `camelCase`: `initStore()`, `initEnv()`

**Variables:**
- Standard variables: `camelCase`: `audioContext`, `source`, `stateRef`, `timer`
- Constants: `UPPER_SNAKE_CASE`: `MAX_ENTRIES`, `SUB_MODE_HEIGHT`, `NORMAL_HEIGHT`, `FONT_STEP`, `FONT_MIN`, `FONT_MAX`
- State/props destructured from hooks: `camelCase`: `[property, setProperty, getProperty]`

**Types & Enums:**
- Enum names: `PascalCase`: `ServiceType`, `ServiceSourceType`, `LanguageFlag`
- Enum values: `UPPER_SNAKE_CASE` or `camelCase` depending on use: `TRANSLATE`, `RECOGNIZE`, `BUILDIN`, `PLUGIN`
- TypeScript exports: Use `export enum` for type enums

## Code Style

**Formatting:**
- Tool: Prettier 3.3.2
- Print width: 120 characters
- Indent: 4 spaces (not tabs)
- Semicolons: Always present
- Quote style: Single quotes (`'`) for JSX attributes and strings
- JSX single quotes: Enabled (`jsxSingleQuote: true`)
- Arrow parentheses: Always (`arrowParens: "always"`)
- Trailing commas: ES5 compatible (commas in objects/arrays, not function params)
- End of line: LF

**File structure in Prettier config** (`/.prettierrc.json`):
- `singleQuote: true` — Use single quotes by default
- `tabWidth: 4` — Four spaces per indent
- `bracketSameLine: false` — Closing JSX brackets on new line
- `singleAttributePerLine: true` — One JSX attribute per line

**Linting:**
- No ESLint or Biome config detected
- Formatting is enforced via Prettier only

## Import Organization

**Order:**
1. **Tauri API imports** — From `@tauri-apps/api/*`: `import { appWindow } from '@tauri-apps/api/window'`
2. **External libraries** — Third-party packages: `import React from 'react'`, `import { Button } from '@nextui-org/react'`
3. **i18n imports** — Localization: `import { useTranslation } from 'react-i18next'`
4. **UI framework/icons** — React icons and UI components: `import { MdMic } from 'react-icons/md'`
5. **Internal utilities and hooks** — Project utilities: `import { useConfig } from '../../hooks'`, `import { osType } from '../../utils/env'`
6. **Component imports** — Local components: `import MonitorToolbar from './components/MonitorToolbar'`
7. **Services** — Wildcard imports of service modules: `import * as transcriptionServices from '../../services/transcription'`
8. **Local CSS imports** — Last: `import './style.css'`

**Path Aliases:**
- No path aliases configured
- Imports use relative paths with `../` notation

**Barrel Exports:**
- Used in `/src/hooks/index.jsx`: Exports all hooks via `export * from './useConfig'` pattern
- Allows importing multiple hooks from single path: `import { useConfig, useToastStyle } from '../../hooks'`

## Error Handling

**Patterns:**
- **Try-catch blocks**: Used for async operations and JSON parsing
  - Example: `store.load()` wrapped in try-catch with empty catch `catch (_)` for expected failures
  - Example: JSON parsing in `generateSonioxContext()` catches and throws custom error: `throw new Error('parse_error')`
- **Promise chaining with `.catch()`**: Used for async operations
  - Example: `this._audio.play().catch(e => console.debug('[TTS] silent audio.play() error:', e?.name))`
  - Error handlers may log, silently ignore (empty catch), or perform recovery
- **Conditional validation**: Throw errors early for missing config
  - Example: `if (!aiServiceKey) throw new Error('no_service')`
  - Example: Check service existence: `if (!service?.summarize) throw new Error('no_service')`
- **Nullish checks**: Use optional chaining and nullish coalescing
  - Example: `entry.onDone?.()`
  - Example: `c.voice ?? 'vi-VN-HoaiMyNeural'` (default to fallback)

## Logging

**Framework:** `console` object directly (no logging library)

**Patterns:**
- **Debug logs**: `console.debug('[TTS] message')` — Used for detailed operation tracking
  - Prefix format: `[Module]` in brackets: `[TTS]`, `[Monitor]`, `[AudioScheduler]`
  - Examples: Operation flow, state changes, queue status
- **Warning logs**: `console.warn('[TTS] warning message')` — Configuration issues
  - Example: `console.warn('[TTS] ElevenLabs: no API key configured')`
- **Error logs**: `console.error('[TTS] error message')` — Exceptions and failures
  - Include context: `console.error('[TTS] ElevenLabs synthesize failed:', e)`
  - Include operation details: `console.error('[TTS] order-chain error:', String(err))`
- **Silent failures**: Some errors caught with empty catch or silently handled
  - Example: `this._audioCtx.close().catch(() => {})`

**Log prefixes standardized by module**, making output searchable and traceable.

## Comments

**When to Comment:**
- **File-level comments**: Used for complex systems (e.g., `tts.js` has ASCII art pipeline diagram explaining queue architecture)
- **Complex algorithms**: When logic is non-obvious, especially for performance-critical code
- **Configuration notes**: Explain magic numbers and constants
  - Example: Comment on `FONT_STEP = 2` explains "A-/A+ buttons change by this amount"
  - Example: `SUB_MODE_HEIGHT = 190` and `NORMAL_HEIGHT = 400` are config constants
- **State transitions**: Comments on event handlers and side effects
  - Example in `store.js`: `/* first run — config.json doesn't exist yet */`
  - Example in `useConfig.jsx`: `// 同步到Store (State -> Store)` and `// 同步到State (Store -> State)` explain data flow

**JSDoc/TSDoc:**
- Used for utility functions and module documentation
- Format: Standard JSDoc with `@param`, `@returns` tags
- Example from `generateSonioxContext.js`:
  ```javascript
  /**
   * Generate a Soniox context object from a topic description using AI.
   *
   * @param {string} topic - User's description of what they want to listen to
   * @param {string} aiServiceKey - Service instance key (e.g. "openai_ai@abc123")
   * @returns {Promise<{general, text, terms, translation_terms}>}
   */
  ```
- Used in TypeScript files: Type annotations in JSDoc comments for JS files
- Example from `tts.js`: `/** @type {ElevenLabsTTS|null} */` for property type hints

## Function Design

**Size:** No hard limit enforced, but functions range from 5 to 200+ lines
- Utility functions: Typically 5-20 lines
- React component render functions: 50-200+ lines (includes JSX)
- Complex service handlers (e.g., `tts.js` methods): 30-100+ lines

**Parameters:**
- Destructuring: Preferred for many props
  - Example in `MonitorToolbar`: Function parameters destructure 15+ props from parent
  - Object parameters used for options: `useConfig(key, defaultValue, options = {})`
- Default values: Used frequently
  - Example: `debounce(fn, delay = 500)`
  - Example: `(v, forceSync = false)`
- Callbacks: Named explicitly in destructuring
  - Example: `onToggleRun`, `onSetSourceAudio` passed as separate parameters

**Return Values:**
- Hooks return arrays: `[state, setter, getter]` tuple pattern
  - Example: `useGetState()` returns `[state, setState, getState]`
  - Example: `useConfig()` returns `[property, setProperty, getProperty]`
- Functions return single objects when multiple values needed
  - Example: `{ buffer: ArrayBuffer, mime: string }` for audio fetch results
- Async functions always return Promises with typed payloads
  - Example: `generateSonioxContext()` returns `Promise<{general, text, terms, translation_terms}>`

## Module Design

**Exports:**
- Named exports preferred for utilities: `export const debounce = (...)`
- Default exports for components: `export default function MonitorToolbar(...)`
- Type exports in TypeScript: `export enum ServiceType { ... }`

**Barrel Files:**
- Used in `src/hooks/index.jsx` to re-export all hooks
- Pattern: `export * from './useConfig'`
- Enables clean imports: `import { useConfig, useToastStyle } from '../../hooks'`
- Applied selectively (hooks directory uses it, services use wildcard namespace imports instead)

**Service module organization:**
- Wildcard namespace imports: `import * as transcriptionServices from '../../services/transcription'`
- Services accessed as: `transcriptionServices[serviceName]`
- Allows dynamic service selection by string key

## State Management

**Jotai atoms** used in some contexts but not globally
- Example: `useSyncAtom()` hook synchronizes Jotai atoms with local state
- Not found in all files — mixed with React hooks pattern

**React hooks** as primary state management:
- `useState()` for component-level state
- Custom hooks (`useConfig`, `useGetState`, `useSyncAtom`) for reusable logic
- `useCallback()` for memoized callbacks and event handlers

**Tauri store** for persistent configuration:
- `store.js` wraps Tauri's Store plugin
- Configuration persisted to JSON: `config.json`
- Watched for external changes via `tauri-plugin-fs-watch-api`
- Events emitted when store changes: `emit('${eventKey}_changed', v)`

## CSS & Styling

**Tailwind CSS** primary styling framework
- Tailwind config: `tailwind.config.cjs`
- NextUI components styled via Tailwind
- Custom theme extensions: Font families, sizes, colors
- Post-processing: autoprefixer enabled

**Class naming** in JSX:
- Template literals for conditional classes: `` className={`w-[240px] h-screen flex flex-col ${transparent ? 'bg-background/80 backdrop-blur-lg' : 'bg-content1'}`} ``
- Tailwind utility classes directly applied

---

*Convention analysis: 2026-03-18*
