import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useTranslation } from 'react-i18next';
import { store } from '../../utils/store';
import { getServiceName } from '../../utils/service_instance';
import { normalizeAppLanguageToVoiceCode, normalizeVoiceLanguageToAppKey } from '../../utils/voiceLanguage';
import * as transcriptionServices from '../../services/transcription';
import * as translateServices from '../../services/translate';
import { polishTranscript } from '../../utils/polishTranscript';

/**
 * Core hook for Voice Anywhere.
 *
 * @param {object} opts
 * @param {string}  opts.sttServiceKey       - reactive: voice_anywhere_stt_service config
 * @param {string}  opts.monitorSvcKey       - reactive: transcription_active_service config
 * @param {string}  opts.language            - reactive: voice_anywhere_language config (source)
 * @param {string}  opts.targetLanguage      - reactive: voice_anywhere_target_language config
 * @param {string}  opts.translateServiceKey - reactive: voice_anywhere_translate_service config (fallback for offline STT)
 * @param {string}  opts.injectMode          - reactive: voice_anywhere_inject_mode ('replace'|'append') — Transkit windows only
 * @param {string}  opts.action              - reactive: voice_anywhere_action ('clipboard'|'paste') — external apps
 * @param {boolean} opts.autostart           - reactive: voice_anywhere_autostart config
 * @param {boolean} opts.preferAsyncApi      - reactive: opt-in async STT mode for Voice Anywhere
 * @param {boolean} opts.polishEnabled       - reactive: voice_anywhere_polish_enabled config
 * @param {string}  opts.polishPrompt        - reactive: resolved system prompt for the selected level
 * @param {string}  opts.polishServiceKey    - reactive: voice_anywhere_polish_service config
 */

// Friendly display names for STT services shown in caption status messages.
const STT_FRIENDLY_NAMES = {
    onnx_stt:                  'Offline STT (ONNX)',
    local_sidecar_stt:         'Offline STT (MLX)',
    transkit_cloud_stt:        'Transkit Cloud',
    transkit_cloud_dictation:  'Transkit Cloud',
    soniox_stt:                'Soniox',
    deepgram_stt:              'Deepgram',
    openai_whisper_stt:        'OpenAI Whisper',
    assemblyai_stt:            'AssemblyAI',
    gladia_stt:                'Gladia',
    custom_stt:                'Custom STT',
};

// STT services that only transcribe and do NOT translate natively.
// For these, the translate-service fallback runs in injectText.
const OFFLINE_STT_SERVICES = ['onnx_stt', 'local_sidecar_stt'];

function playSfx(type = 'start', enabled = true) {
    if (!enabled) return;
    try {
        const sampleRate = 24000;
        const duration = type === 'start' ? 0.4 : 0.25;
        const numSamples = Math.floor(sampleRate * duration);
        const buffer = new Float32Array(numSamples);

        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            if (type === 'start') {
                // High-pitched chime (C6 + C7 harmonics) - Louder (0.35)
                const s1 = Math.sin(2 * Math.PI * 1046.5 * t);
                const s2 = Math.sin(2 * Math.PI * 2093.0 * t);
                const envelope = Math.exp(-t * 10) * Math.min(1, t * 100);
                buffer[i] = (s1 * 0.5 + s2 * 0.5) * 0.35 * envelope;
            } else {
                // Slightly lower and shorter chime (A5) - Louder (0.25)
                const s = Math.sin(2 * Math.PI * 880 * t);
                const envelope = Math.exp(-t * 15) * Math.min(1, t * 100);
                buffer[i] = s * 0.25 * envelope;
            }
        }

        const bytes = new Uint8Array(buffer.buffer);
        invoke('play_audio_bytes', { data: Array.from(bytes) }).catch(err => {
            console.warn('[VoiceAnywhere] Native Sfx failed', err);
        });
    } catch (e) {
        console.warn('[VoiceAnywhere] Sfx generation failed', e);
    }
}

export function useVoiceAnywhere({ sttServiceKey, monitorSvcKey, language, targetLanguage, translateServiceKey, injectMode, action, autostart, preferAsyncApi, polishEnabled, polishPrompt, polishServiceKey, sfxEnabled, onFinalText, noCapture, noSfx }) {
    const { t } = useTranslation();
    const [fabState, setFabState] = useState('idle');
    const [interim, setInterim] = useState('');
    const [finalText, setFinalText] = useState('');
    const [injected, setInjected] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const clientRef = useRef(null);
    const unlistenAudioRef = useRef(null);
    const unlistenTriggerRef = useRef(null);
    const isRecordingRef = useRef(false);
    const injectingTimerRef = useRef(null);
    const stopFallbackTimerRef = useRef(null);
    const interimRef = useRef('');
    const lastTranscriptRef = useRef('');
    const finalizingRef = useRef(false);
    // Prevents concurrent injectText calls (race between fallback timer and onOriginal)
    const isInjectingRef = useRef(false);
    // Accumulates chunk-finals (source text) that arrive while user is still recording
    const accumulatedRef = useRef('');
    // Accumulates translated text arriving via onTranslation while recording
    const accumulatedTranslationRef = useRef('');
    // Resolves the post-stop promise waiting for the final onTranslation
    const pendingTranslationResolverRef = useRef(null);
    // True once onTranslation has fired for the current session — used to decide whether
    // the translate-service fallback in injectText should run.
    const nativeTranslationFiredRef = useRef(false);
    // Tracks whether the current interimRef value is a status/loading message
    // (isStatus:true from local_sidecar). Status messages must never be used as fallback text.
    const interimIsStatusRef = useRef(false);
    // Friendly display name of the active STT service (set when client is created).
    const activeServiceDisplayNameRef = useRef('');
    // Service name (e.g. 'onnx_stt') of the active STT — used to decide translate fallback.
    const activeServiceNameRef = useRef('');

    // Keep reactive config in refs so callbacks always see the latest values
    const sttKeyRef = useRef(sttServiceKey);
    const monitorKeyRef = useRef(monitorSvcKey);
    const languageRef = useRef(language);
    const targetLanguageRef = useRef(targetLanguage);
    const translateServiceKeyRef = useRef(translateServiceKey);
    const injectModeRef = useRef(injectMode);
    const actionRef = useRef(action);
    const preferAsyncRef = useRef(preferAsyncApi);
    const polishEnabledRef = useRef(polishEnabled);
    const polishPromptRef = useRef(polishPrompt);
    const polishServiceKeyRef = useRef(polishServiceKey);
    const sfxEnabledRef = useRef(sfxEnabled);
    const noCaptureRef = useRef(noCapture);
    const noSfxRef = useRef(noSfx);
    const onFinalTextRef = useRef(onFinalText);
    useEffect(() => { sttKeyRef.current = sttServiceKey; }, [sttServiceKey]);
    useEffect(() => { monitorKeyRef.current = monitorSvcKey; }, [monitorSvcKey]);
    useEffect(() => { languageRef.current = language; }, [language]);
    useEffect(() => { targetLanguageRef.current = targetLanguage; }, [targetLanguage]);
    useEffect(() => { translateServiceKeyRef.current = translateServiceKey; }, [translateServiceKey]);
    useEffect(() => { injectModeRef.current = injectMode; }, [injectMode]);
    useEffect(() => { actionRef.current = action; }, [action]);
    useEffect(() => { preferAsyncRef.current = preferAsyncApi; }, [preferAsyncApi]);
    useEffect(() => { polishEnabledRef.current = polishEnabled; }, [polishEnabled]);
    useEffect(() => { polishPromptRef.current = polishPrompt; }, [polishPrompt]);
    useEffect(() => { polishServiceKeyRef.current = polishServiceKey; }, [polishServiceKey]);
    useEffect(() => { sfxEnabledRef.current = sfxEnabled; }, [sfxEnabled]);
    useEffect(() => { noCaptureRef.current = noCapture; }, [noCapture]);
    useEffect(() => { noSfxRef.current = noSfx; }, [noSfx]);
    useEffect(() => { onFinalTextRef.current = onFinalText; }, [onFinalText]);

    const clearInjectingTimer = () => {
        if (injectingTimerRef.current) {
            clearTimeout(injectingTimerRef.current);
            injectingTimerRef.current = null;
        }
    };

    const clearStopFallbackTimer = () => {
        if (stopFallbackTimerRef.current) {
            clearTimeout(stopFallbackTimerRef.current);
            stopFallbackTimerRef.current = null;
        }
    };

    const normalizeTranscriptEvent = useCallback((value, aux = null) => {
        const payload = (value && typeof value === 'object' && !Array.isArray(value))
            ? value
            : { text: value };
        const auxMeta = (aux && typeof aux === 'object' && !Array.isArray(aux))
            ? aux
            : {};

        return {
            text: String(
                payload.text
                ?? payload.transcript
                ?? payload.original
                ?? payload.translation
                ?? ''
            ),
            speaker: payload.speaker ?? auxMeta.speaker ?? (typeof aux === 'string' ? aux : null),
            isStatus: Boolean(payload.isStatus ?? auxMeta.isStatus),
            isFinal: Boolean(payload.isFinal ?? auxMeta.isFinal),
            raw: payload,
        };
    }, []);

    const getBestTranscriptCandidate = useCallback(() => {
        const tgtLang = targetLanguageRef.current;
        const wantTranslation = tgtLang && tgtLang !== 'none';
        const candidates = [
            finalTextRef.current?.trim?.(),
            // Prefer accumulated translation when a target language is configured
            (wantTranslation ? accumulatedTranslationRef.current?.trim?.() : null),
            accumulatedRef.current?.trim?.(),
            (isPlaceholderTranscript(lastTranscriptRef.current) ? '' : lastTranscriptRef.current?.trim?.()),
            (interimIsStatusRef.current ? '' : interimRef.current?.trim?.()),
        ];
        return candidates.find(Boolean) || '';
    }, []);

    const isPlaceholderTranscript = (text) => {
        const normalized = (text ?? '').trim().toLowerCase();
        return normalized === '' || normalized === 'listening…' || normalized === 'processing…' || normalized === 'listening...' || normalized === 'processing...';
    };

    const disconnectClient = useCallback(() => {
        try { clientRef.current?.disconnect?.(); } catch (_) {}
        clientRef.current = null;
    }, []);

    const setError = useCallback((msg) => {
        console.error('[VoiceAnywhere]', msg);
        setFabState('error');
        setErrorMsg(msg);
        finalizingRef.current = false;
        setTimeout(() => { setFabState('idle'); setErrorMsg(''); }, 3500);
    }, []);

    // ── STT client factory ───────────────────────────────────────────────────

    const createSTTClient = useCallback(async () => {
        // Always reload store before reading so we get the latest saved values
        try { await store.load(); } catch (_) {}

        const vaKey = sttKeyRef.current;
        const svcKey = (vaKey && vaKey !== 'inherit') ? vaKey : monitorKeyRef.current;

        if (!svcKey) throw new Error('No STT service configured. Set one in Settings → Voice Input.');

        const serviceName = getServiceName(svcKey);
        const service = transcriptionServices[serviceName];
        if (!service?.createClient) throw new Error(`Unknown STT service: ${serviceName}`);

        const config = (await store.get(svcKey)) ?? {};
        const NO_KEY_SERVICES = ['transkit_cloud_stt', 'transkit_cloud_dictation', 'local_sidecar_stt', 'onnx_stt'];
        if (!NO_KEY_SERVICES.includes(serviceName) && !config.apiKey && !config.token) {
            throw new Error(`No API key for "${serviceName}". Configure it in Settings → Service.`);
        }

        // Store names for status messages and translate-fallback logic
        activeServiceNameRef.current = serviceName;
        activeServiceDisplayNameRef.current =
            config.instanceName || config.service_instance_name ||
            STT_FRIENDLY_NAMES[serviceName] || serviceName;

        const lang = languageRef.current;
        const sourceLang = (lang && lang !== 'auto') ? normalizeAppLanguageToVoiceCode(lang) : null;
        const targetLang = (targetLanguageRef.current && targetLanguageRef.current !== 'none')
            ? normalizeAppLanguageToVoiceCode(targetLanguageRef.current)
            : null;

        const preferAsync = !!preferAsyncRef.current;
        const client = service.createClient({ preferAsync });
        client.connect({ ...config, sourceLanguage: sourceLang, targetLanguage: targetLang });
        return client;
    }, []); // no deps — reads from refs

    // ── Audio listener ───────────────────────────────────────────────────────

    const attachAudioListener = useCallback(async () => {
        unlistenAudioRef.current?.();
        unlistenAudioRef.current = null;
        const unlisten = await listen('audio_chunk', (event) => {
            if (!clientRef.current || !isRecordingRef.current) return;
            try {
                const binary = atob(event.payload);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                clientRef.current.sendAudio(bytes.buffer);
            } catch (e) {
                console.warn('[VoiceAnywhere] audio chunk error', e);
            }
        });
        unlistenAudioRef.current = unlisten;
    }, []);

    // ── Inject ───────────────────────────────────────────────────────────────

    const injectText = useCallback(async (rawText, nativeOriginal = null) => {
        if (!rawText?.trim()) return;
        if (isInjectingRef.current) return;  // prevent race between fallback timer and onOriginal
        isInjectingRef.current = true;
        setFabState('processing');
        try {
            let text = rawText;

            // ── Translate step ──────────────────────────────────────────────────────────
            // Runs when the STT service cannot translate natively:
            //   • offline STT (onnx, local sidecar) — always
            //   • any other service that never fired onTranslation (e.g. cloud dictation with
            //     a Deepgram provider that doesn't support server-side translation)
            const tgtLang = targetLanguageRef.current;
            const translateKey = translateServiceKeyRef.current;
            const srcLang = languageRef.current;
            if (
                tgtLang && tgtLang !== 'none' &&
                translateKey && translateKey !== 'none' &&
                (OFFLINE_STT_SERVICES.includes(activeServiceNameRef.current) || !nativeTranslationFiredRef.current)
            ) {
                try {
                    const translateSvcName = getServiceName(translateKey);
                    const translateModule = translateServices[translateSvcName];
                    if (translateModule?.translate) {
                        const translateCfg = (await store.get(translateKey)) ?? {};
                        let setResultValue = null;
                        const returned = await translateModule.translate(
                            text,
                            srcLang === 'auto' ? 'auto' : normalizeVoiceLanguageToAppKey(srcLang || 'auto'),
                            normalizeVoiceLanguageToAppKey(tgtLang),
                            { config: translateCfg, setResult: (r) => { setResultValue = r; } }
                        );
                        if (typeof returned === 'string' && returned) {
                            text = returned;
                        } else if (typeof returned === 'object' && returned?.translation) {
                            text = returned.translation;
                        } else if (setResultValue !== null) {
                            text = setResultValue;
                        }
                        console.log('[VoiceAnywhere] Translate fallback applied:', text);
                    }
                } catch (translateErr) {
                    console.warn('[VoiceAnywhere] Translate fallback failed, using raw transcript:', translateErr);
                    text = rawText;
                }
            }

            // ── Polish step (optional AI middleware) ─────────────────────────────
            if (polishEnabledRef.current && polishServiceKeyRef.current) {
                try {
                    text = await polishTranscript(text, {
                        prompt: polishPromptRef.current,
                        aiServiceKey: polishServiceKeyRef.current,
                        targetLanguage: targetLanguageRef.current,
                    });
                } catch (polishErr) {
                    console.warn('[VoiceAnywhere] Polish failed, using raw transcript:', polishErr);
                    text = rawText; // fall back gracefully
                }
            }

            // injectMode (replace|append) applies only to Transkit windows.
            // action (clipboard|paste) applies to external apps.
            const injectMode = injectModeRef.current ?? 'replace';
            const action = actionRef.current ?? 'clipboard';

            if (onFinalTextRef.current) {
                // PTT/embedded mode: await so async work (translate + review) happens before
                // we reset state. This keeps fabState='processing' during the caller's async
                // work and avoids showing a premature green checkmark before review appears.
                // Pass nativeOriginal so the caller can skip an extra Cloud AI translation call
                // when the STT service already translated natively (Soniox, Deepgram, Gladia…).
                await onFinalTextRef.current(text, nativeOriginal);
                finalizingRef.current = false;
                clearStopFallbackTimer();
                disconnectClient();
                setFabState('idle');
                setInterim('');
                setFinalText('');
                isInjectingRef.current = false;
                return;
            } else {
                const currentFocusedWindow = await invoke('get_current_voice_anywhere_target').catch(() => null);
                const previousFocusedWindow = await invoke('get_voice_anywhere_focused').catch(() => null);
                const focusedWindow = currentFocusedWindow || previousFocusedWindow;
                const transKitWindows = ['translate', 'monitor', 'config'];

                if (focusedWindow && transKitWindows.includes(focusedWindow)) {
                    // Inject into Transkit window using replace/append mode
                    await invoke('voice_inject_to_window', { label: focusedWindow, text, mode: injectMode });
                    console.log('[VoiceAnywhere] injected into window:', focusedWindow, 'mode:', injectMode);
                } else if (action === 'paste') {
                    // Focus last external app and paste (VA is focus:false so input focus is preserved)
                    await invoke('voice_focus_and_paste', { text });
                    console.log('[VoiceAnywhere] pasted to last external app');
                } else {
                    // Default: copy to clipboard only
                    await invoke('voice_copy_to_clipboard', { text });
                    console.log('[VoiceAnywhere] copied to clipboard');
                }
            }
            setFabState('injecting');
            setInjected(true);
            finalizingRef.current = false;
            disconnectClient();
            clearInjectingTimer();
            injectingTimerRef.current = setTimeout(() => {
                setFabState('idle');
                setInjected(false);
                setInterim('');
                setFinalText('');
            }, 2200);
        } catch (err) {
            setError(String(err));
        }
    }, [setError, disconnectClient]);

    // ── Start / Stop ─────────────────────────────────────────────────────────

    const startRecording = useCallback(async () => {
        if (isRecordingRef.current) return;
        setInterim('');
        setFinalText('');
        setInjected(false);
        clearInjectingTimer();
        clearStopFallbackTimer();
        disconnectClient();
        finalizingRef.current = false;
        isInjectingRef.current = false;
        interimRef.current = '';
        lastTranscriptRef.current = '';
        accumulatedRef.current = '';
        accumulatedTranslationRef.current = '';
        pendingTranslationResolverRef.current = null;
        nativeTranslationFiredRef.current = false;

        // Capture focus target immediately (in case user clicked FAB instead of hotkey)
        if (!noCaptureRef.current) await invoke('capture_voice_anywhere_target').catch(() => {});
        if (!noSfxRef.current) playSfx('start', sfxEnabledRef.current ?? true);

        try {
            const client = await createSTTClient();

            client.onProvisional = (value, opts = {}) => {
                const event = normalizeTranscriptEvent(value, opts);
                const nextText = event.text ?? '';
                // Replace raw engine status/loading messages with a friendly "Using: Service..." label
                const displayText = event.isStatus
                    ? `Using: ${activeServiceDisplayNameRef.current || 'STT'}...`
                    : nextText;
                interimRef.current = displayText;
                interimIsStatusRef.current = event.isStatus;
                // Don't track sidecar status/loading messages as potential final transcript
                if (!event.isStatus && !isPlaceholderTranscript(nextText)) lastTranscriptRef.current = nextText;
                setInterim(displayText);
            };

            // onTranslation: fired by cloud STTs (Soniox, Deepgram, Gladia, Transkit Cloud)
            // when a target language is configured. We accumulate translated segments and
            // use them for injection instead of the source-language onOriginal text.
            client.onTranslation = (value) => {
                const event = normalizeTranscriptEvent(value);
                const text = event.text?.trim?.() ?? '';
                if (!text) return;

                nativeTranslationFiredRef.current = true;

                if (isRecordingRef.current) {
                    // Mid-stream: accumulate translated segments
                    const joined = accumulatedTranslationRef.current
                        ? `${accumulatedTranslationRef.current} ${text}`
                        : text;
                    accumulatedTranslationRef.current = joined;
                    console.log('[VoiceAnywhere] onTranslation mid-stream, accumulated:', joined);
                } else if (pendingTranslationResolverRef.current) {
                    // Post-stop: resolve the promise waiting for the last segment's translation
                    console.log('[VoiceAnywhere] onTranslation post-stop, resolving with:', text);
                    pendingTranslationResolverRef.current(text);
                    pendingTranslationResolverRef.current = null;
                } else {
                    // Translation arrived before onOriginal's async path set up the pending resolver
                    // (e.g. DictationClient fires onTranslation synchronously before onOriginal).
                    // Buffer it so onOriginal can pick it up immediately without a 600ms wait.
                    const joined = accumulatedTranslationRef.current
                        ? `${accumulatedTranslationRef.current} ${text}`
                        : text;
                    accumulatedTranslationRef.current = joined;
                    console.log('[VoiceAnywhere] onTranslation pre-resolver, buffered:', joined);
                }
            };

            client.onOriginal = async (value, opts = {}) => {
                const event = normalizeTranscriptEvent(value, opts);
                const text = event.text?.trim?.() ?? '';
                if (!text) return;
                clearStopFallbackTimer();

                if (isRecordingRef.current) {
                    // VoiceAnywhere is always PTT — never auto-inject mid-recording regardless
                    // of whether the provider fires onOriginal (Deepgram endpointing, Soniox
                    // auto-final, local_sidecar chunk-finals, etc.). Accumulate all mid-stream
                    // finals; inject only when the user explicitly releases (stopRecording).
                    const joined = accumulatedRef.current
                        ? `${accumulatedRef.current} ${text}`
                        : text;
                    accumulatedRef.current = joined;
                    lastTranscriptRef.current = joined;
                    interimRef.current = '';
                    setInterim('');
                    setFinalText(joined);
                    console.log('[VoiceAnywhere] onOriginal mid-stream, accumulated:', joined);
                    return;
                }

                // User has already stopped (isRecordingRef = false):
                // combine any accumulated chunks with this final result.
                const fullText = accumulatedRef.current
                    ? `${accumulatedRef.current} ${text}`
                    : text;
                accumulatedRef.current = '';
                lastTranscriptRef.current = fullText;
                setFinalText(fullText);
                isRecordingRef.current = false;
                if (!noCaptureRef.current) await invoke('stop_audio_capture').catch(() => {});
                unlistenAudioRef.current?.();
                unlistenAudioRef.current = null;

                // For cloud STTs that translate (Soniox, Deepgram, Gladia), wait briefly
                // for the corresponding onTranslation to arrive before injecting.
                const tgtLang = targetLanguageRef.current;
                const wantTranslation = tgtLang && tgtLang !== 'none';
                let textToInject = fullText;
                // When native STT translation fires, preserve the source-language original
                // so callers (e.g. PTT handlePttFinalText) can use both without an extra AI call.
                let nativeOriginal = null;

                if (wantTranslation && !OFFLINE_STT_SERVICES.includes(activeServiceNameRef.current)) {
                    // Check if translation already landed in the buffer before we got here.
                    // DictationClient fires onTranslation synchronously before onOriginal, so by the
                    // time we reach this point (after await stop_audio_capture) it's already buffered.
                    if (accumulatedTranslationRef.current) {
                        nativeOriginal = fullText;
                        textToInject = accumulatedTranslationRef.current;
                        accumulatedTranslationRef.current = '';
                        setFinalText(textToInject);
                        console.log('[VoiceAnywhere] Using pre-buffered translation:', textToInject);
                    } else if (activeServiceNameRef.current !== 'transkit_cloud_dictation') {
                        // For streaming STTs (Soniox, Deepgram direct, Gladia…): wait up to 600ms
                        // for the last segment's onTranslation to arrive.
                        const translatedLastSegment = await new Promise((resolve) => {
                            const timer = setTimeout(() => {
                                pendingTranslationResolverRef.current = null;
                                resolve(null);
                            }, 600);
                            pendingTranslationResolverRef.current = (t) => {
                                clearTimeout(timer);
                                resolve(t);
                            };
                        });

                        if (translatedLastSegment) {
                            const fullTranslation = accumulatedTranslationRef.current
                                ? `${accumulatedTranslationRef.current} ${translatedLastSegment}`
                                : translatedLastSegment;
                            accumulatedTranslationRef.current = '';
                            nativeOriginal = fullText;
                            textToInject = fullTranslation;
                            setFinalText(fullTranslation);
                            console.log('[VoiceAnywhere] Using translation for injection:', fullTranslation);
                        } else if (accumulatedTranslationRef.current) {
                            // Timed out but we have accumulated translations from earlier segments
                            nativeOriginal = fullText;
                            textToInject = accumulatedTranslationRef.current;
                            accumulatedTranslationRef.current = '';
                            setFinalText(textToInject);
                            console.log('[VoiceAnywhere] Using partial accumulated translation:', textToInject);
                        }
                    }
                }

                await injectText(textToInject, nativeOriginal);
            };
            client.onStatusChange = (status) => {
                if (status === 'error') setError('STT connection error');
                if (status === 'disconnected') {
                    if (isRecordingRef.current || finalizingRef.current) {
                        // Cancel any pending translation wait
                        if (pendingTranslationResolverRef.current) {
                            pendingTranslationResolverRef.current(null);
                            pendingTranslationResolverRef.current = null;
                        }
                        const fallbackText = getBestTranscriptCandidate();
                        if (fallbackText) {
                            if (isRecordingRef.current) playSfx('stop', sfxEnabledRef.current ?? true);
                            isRecordingRef.current = false;
                            clearStopFallbackTimer();
                            injectText(fallbackText);
                        } else {
                            if (isRecordingRef.current) {
                                playSfx('stop', sfxEnabledRef.current ?? true);
                                isRecordingRef.current = false;
                                setFabState('idle');
                            }
                        }
                    }
                }
            };
            client.onError = (err) => {
                clearStopFallbackTimer();
                if (pendingTranslationResolverRef.current) {
                    pendingTranslationResolverRef.current(null);
                    pendingTranslationResolverRef.current = null;
                }
                setError(String(err));
                isRecordingRef.current = false;
                if (!noCaptureRef.current) invoke('stop_audio_capture').catch(() => {});
                disconnectClient();
            };

            clientRef.current = client;
            await attachAudioListener();
            if (!noCaptureRef.current) await invoke('start_audio_capture', { source: 'microphone', batchIntervalMs: 100 });
            isRecordingRef.current = true;
            setFabState('listening');
        } catch (err) {
            setError(String(err));
        }
    }, [createSTTClient, attachAudioListener, injectText, setError, disconnectClient, normalizeTranscriptEvent, getBestTranscriptCandidate]);

    const stopRecording = useCallback(async () => {
        if (!isRecordingRef.current) return;
        if (!noSfxRef.current) playSfx('stop', sfxEnabledRef.current ?? true);
        isRecordingRef.current = false;
        finalizingRef.current = true;
        if (!noCaptureRef.current) await invoke('stop_audio_capture').catch(() => {});
        unlistenAudioRef.current?.();
        unlistenAudioRef.current = null;
        try { clientRef.current?.finalize?.(); } catch (_) {}
        setFabState('processing');
        clearStopFallbackTimer();
        // Give extra time if the model is still loading (status message showing).
        // Local sidecar needs time to finish inference before sending is_final.
        // Cloud dictation also needs more time for the final roundtrip + translation.
        const fallbackDelay = (interimIsStatusRef.current || activeServiceNameRef.current === 'transkit_cloud_dictation') ? 12000 : 1500;
        stopFallbackTimerRef.current = setTimeout(async () => {
            if (!finalizingRef.current) return;
            // Cancel any pending translation wait
            if (pendingTranslationResolverRef.current) {
                pendingTranslationResolverRef.current(null);
                pendingTranslationResolverRef.current = null;
            }
            const fallbackText = getBestTranscriptCandidate();
            if (fallbackText) {
                setFinalText(fallbackText);
                await injectText(fallbackText);
                return;
            }
            finalizingRef.current = false;
            disconnectClient();
            setError(t('voice_anywhere.errors.no_speech_detected'));
        }, fallbackDelay);
        setTimeout(() => {
            setFabState((s) => s === 'processing' ? 'idle' : s);
        }, 5000);
    }, [injectText, disconnectClient, getBestTranscriptCandidate, t]);

    const finalTextRef = useRef(finalText);
    useEffect(() => { finalTextRef.current = finalText; }, [finalText]);

    const toggle = useCallback(async () => {
        if (fabState === 'idle' || fabState === 'error') await startRecording();
        else if (fabState === 'listening') await stopRecording();
    }, [fabState, startRecording, stopRecording]);

    // ── Hotkey trigger ───────────────────────────────────────────────────────

    const autostartRef = useRef(autostart);
    useEffect(() => { autostartRef.current = autostart; }, [autostart]);

    useEffect(() => {
        let mounted = true;
        listen('voice_anywhere_trigger', async () => {
            if (!mounted) return;
            if (autostartRef.current ?? true) {
                if (isRecordingRef.current) await stopRecording();
                else await startRecording();
            }
        }).then((fn) => { unlistenTriggerRef.current = fn; });
        return () => {
            mounted = false;
            unlistenTriggerRef.current?.();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => {
            isRecordingRef.current = false;
            if (!noCaptureRef.current) invoke('stop_audio_capture').catch(() => {});
            unlistenAudioRef.current?.();
            unlistenTriggerRef.current?.();
            clearStopFallbackTimer();
            disconnectClient();
            clearInjectingTimer();
            if (pendingTranslationResolverRef.current) {
                pendingTranslationResolverRef.current(null);
                pendingTranslationResolverRef.current = null;
            }
        };
    }, [disconnectClient]);

    return { fabState, interim, finalText, injected, errorMsg, toggle, startRecording, stopRecording };
}
