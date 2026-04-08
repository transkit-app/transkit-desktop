import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useTranslation } from 'react-i18next';
import { store } from '../../utils/store';
import { getServiceName } from '../../utils/service_instance';
import * as transcriptionServices from '../../services/transcription';
import { polishTranscript } from '../../utils/polishTranscript';

/**
 * Core hook for Voice Anywhere.
 *
 * @param {object} opts
 * @param {string}  opts.sttServiceKey    - reactive: voice_anywhere_stt_service config
 * @param {string}  opts.monitorSvcKey    - reactive: transcription_active_service config
 * @param {string}  opts.language         - reactive: voice_anywhere_language config
 * @param {string}  opts.injectMode       - reactive: voice_anywhere_inject_mode ('replace'|'append') — Transkit windows only
 * @param {string}  opts.action           - reactive: voice_anywhere_action ('clipboard'|'paste') — external apps
 * @param {boolean} opts.autostart        - reactive: voice_anywhere_autostart config
 * @param {boolean} opts.preferAsyncApi   - reactive: opt-in async STT mode for Voice Anywhere
 * @param {boolean} opts.polishEnabled    - reactive: voice_anywhere_polish_enabled config
 * @param {string}  opts.polishPrompt     - reactive: resolved system prompt for the selected level
 * @param {string}  opts.polishServiceKey - reactive: voice_anywhere_polish_service config
 */
export function useVoiceAnywhere({ sttServiceKey, monitorSvcKey, language, injectMode, action, autostart, preferAsyncApi, polishEnabled, polishPrompt, polishServiceKey }) {
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
    // Accumulates chunk-finals that arrive while user is still recording
    // (e.g. local_sidecar sends is_final:true after each chunk even mid-dictation)
    const accumulatedRef = useRef('');
    // Tracks whether the current interimRef value is a status/loading message
    // (isStatus:true from local_sidecar). Status messages must never be used as fallback text.
    const interimIsStatusRef = useRef(false);

    // Keep reactive config in refs so callbacks always see the latest values
    const sttKeyRef = useRef(sttServiceKey);
    const monitorKeyRef = useRef(monitorSvcKey);
    const languageRef = useRef(language);
    const injectModeRef = useRef(injectMode);
    const actionRef = useRef(action);
    const preferAsyncRef = useRef(preferAsyncApi);
    const polishEnabledRef = useRef(polishEnabled);
    const polishPromptRef = useRef(polishPrompt);
    const polishServiceKeyRef = useRef(polishServiceKey);
    useEffect(() => { sttKeyRef.current = sttServiceKey; }, [sttServiceKey]);
    useEffect(() => { monitorKeyRef.current = monitorSvcKey; }, [monitorSvcKey]);
    useEffect(() => { languageRef.current = language; }, [language]);
    useEffect(() => { injectModeRef.current = injectMode; }, [injectMode]);
    useEffect(() => { actionRef.current = action; }, [action]);
    useEffect(() => { preferAsyncRef.current = preferAsyncApi; }, [preferAsyncApi]);
    useEffect(() => { polishEnabledRef.current = polishEnabled; }, [polishEnabled]);
    useEffect(() => { polishPromptRef.current = polishPrompt; }, [polishPrompt]);
    useEffect(() => { polishServiceKeyRef.current = polishServiceKey; }, [polishServiceKey]);

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
        const NO_KEY_SERVICES = ['transkit_cloud_stt', 'local_sidecar_stt'];
        if (!NO_KEY_SERVICES.includes(serviceName) && !config.apiKey && !config.token) {
            throw new Error(`No API key for "${serviceName}". Configure it in Settings → Service.`);
        }

        const lang = languageRef.current;
        const sourceLang = (lang && lang !== 'auto') ? lang : null;

        const preferAsync = !!preferAsyncRef.current;
        const client = service.createClient({ preferAsync });
        client.connect({ ...config, sourceLanguage: sourceLang, targetLanguage: null });
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

    const injectText = useCallback(async (rawText) => {
        if (!rawText?.trim()) return;
        setFabState('processing');
        try {
            // ── Polish step (optional middleware) ─────────────────────────────
            let text = rawText;
            if (polishEnabledRef.current && polishServiceKeyRef.current) {
                try {
                    text = await polishTranscript(rawText, {
                        prompt: polishPromptRef.current,
                        aiServiceKey: polishServiceKeyRef.current,
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
        interimRef.current = '';
        lastTranscriptRef.current = '';
        accumulatedRef.current = '';

        try {
            const client = await createSTTClient();

            client.onProvisional = (text, opts = {}) => {
                const nextText = text ?? '';
                interimRef.current = nextText;
                interimIsStatusRef.current = !!opts?.isStatus;
                // Don't track sidecar status/loading messages as potential final transcript
                if (!opts?.isStatus && !isPlaceholderTranscript(nextText)) lastTranscriptRef.current = nextText;
                setInterim(nextText);
            };
            client.onOriginal = async (text) => {
                if (!text?.trim()) return;
                clearStopFallbackTimer();

                if (isRecordingRef.current && preferAsyncRef.current) {
                    // Mid-stream chunk-final while user is still recording (e.g. local_sidecar
                    // sends is_final:true after every chunk). Accumulate — don't stop yet.
                    const joined = accumulatedRef.current
                        ? `${accumulatedRef.current} ${text}`
                        : text;
                    accumulatedRef.current = joined;
                    lastTranscriptRef.current = joined;
                    interimRef.current = '';
                    setInterim('');
                    setFinalText(joined);
                    console.log('[VoiceAnywhere] onOriginal mid-stream (async), accumulated:', joined);
                    return;
                }

                // User has already stopped (isRecordingRef = false) or realtime mode:
                // combine any accumulated chunks with this final result and inject.
                const fullText = accumulatedRef.current
                    ? `${accumulatedRef.current} ${text}`
                    : text;
                accumulatedRef.current = '';
                lastTranscriptRef.current = fullText;
                setFinalText(fullText);
                isRecordingRef.current = false;
                await invoke('stop_audio_capture').catch(() => {});
                unlistenAudioRef.current?.();
                unlistenAudioRef.current = null;
                await injectText(fullText);
            };
            client.onStatusChange = (status) => {
                if (status === 'error') setError('STT connection error');
                if (status === 'disconnected' && finalizingRef.current) {
                    const fallbackText = finalTextRef.current?.trim?.()
                        || (isPlaceholderTranscript(lastTranscriptRef.current) ? '' : lastTranscriptRef.current?.trim())
                        || (isPlaceholderTranscript(interimRef.current) ? '' : interimRef.current?.trim());
                    if (fallbackText) {
                        clearStopFallbackTimer();
                        injectText(fallbackText);
                    }
                }
            };
            client.onError = (err) => {
                clearStopFallbackTimer();
                setError(String(err));
                isRecordingRef.current = false;
                invoke('stop_audio_capture').catch(() => {});
                disconnectClient();
            };

            clientRef.current = client;
            await attachAudioListener();
            await invoke('start_audio_capture', { source: 'microphone', batchIntervalMs: 100 });
            isRecordingRef.current = true;
            setFabState('listening');
        } catch (err) {
            setError(String(err));
        }
    }, [createSTTClient, attachAudioListener, injectText, setError, disconnectClient]);

    const stopRecording = useCallback(async () => {
        if (!isRecordingRef.current) return;
        isRecordingRef.current = false;
        finalizingRef.current = true;
        await invoke('stop_audio_capture').catch(() => {});
        unlistenAudioRef.current?.();
        unlistenAudioRef.current = null;
        try { clientRef.current?.finalize?.(); } catch (_) {}
        setFabState('processing');
        clearStopFallbackTimer();
        // Give extra time if the model is still loading (status message showing).
        // Local sidecar needs time to finish inference before sending is_final.
        const fallbackDelay = interimIsStatusRef.current ? 12000 : 1500;
        stopFallbackTimerRef.current = setTimeout(async () => {
            if (!finalizingRef.current) return;
            // Never use a status/loading string as the fallback transcript
            const interimCandidate = interimIsStatusRef.current ? '' : interimRef.current?.trim();
            const fallbackText = (isPlaceholderTranscript(lastTranscriptRef.current) ? '' : lastTranscriptRef.current?.trim())
                || (isPlaceholderTranscript(interimCandidate) ? '' : interimCandidate);
            if (fallbackText) {
                setFinalText(fallbackText);
                await injectText(fallbackText);
                return;
            }
            finalizingRef.current = false;
            disconnectClient();
            setError(t('voice_anywhere.errors.no_speech_detected'));
        }, 1500);
        setTimeout(() => {
            setFabState((s) => s === 'processing' ? 'idle' : s);
        }, 5000);
    }, [injectText, disconnectClient]);

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
            invoke('stop_audio_capture').catch(() => {});
            unlistenAudioRef.current?.();
            unlistenTriggerRef.current?.();
            clearStopFallbackTimer();
            disconnectClient();
            clearInjectingTimer();
        };
    }, [disconnectClient]);

    return { fabState, interim, finalText, injected, errorMsg, toggle };
}
