import { useCallback, useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useTranslation } from 'react-i18next';
import { store } from '../../utils/store';
import { getServiceName } from '../../utils/service_instance';
import * as transcriptionServices from '../../services/transcription';

/**
 * Core hook for Voice Anywhere.
 *
 * @param {object} opts
 * @param {string} opts.sttServiceKey  - reactive: current value of voice_anywhere_stt_service config
 * @param {string} opts.monitorSvcKey  - reactive: current value of transcription_active_service config
 * @param {string} opts.language       - reactive: voice_anywhere_language config
 * @param {string} opts.injectMode     - reactive: voice_anywhere_inject_mode config
 * @param {boolean} opts.autostart     - reactive: voice_anywhere_autostart config
 * @param {boolean} opts.preferAsyncApi - reactive: opt-in async STT mode for Voice Anywhere
 */
export function useVoiceAnywhere({ sttServiceKey, monitorSvcKey, language, injectMode, autostart, preferAsyncApi }) {
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

    // Keep reactive config in refs so callbacks always see the latest values
    const sttKeyRef = useRef(sttServiceKey);
    const monitorKeyRef = useRef(monitorSvcKey);
    const languageRef = useRef(language);
    const injectModeRef = useRef(injectMode);
    const preferAsyncRef = useRef(preferAsyncApi);
    useEffect(() => { sttKeyRef.current = sttServiceKey; }, [sttServiceKey]);
    useEffect(() => { monitorKeyRef.current = monitorSvcKey; }, [monitorSvcKey]);
    useEffect(() => { languageRef.current = language; }, [language]);
    useEffect(() => { injectModeRef.current = injectMode; }, [injectMode]);
    useEffect(() => { preferAsyncRef.current = preferAsyncApi; }, [preferAsyncApi]);

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

    const injectText = useCallback(async (text) => {
        if (!text?.trim()) return;
        setFabState('processing');
        try {
            const currentFocusedWindow = await invoke('get_current_voice_anywhere_target').catch(() => null);
            const previousFocusedWindow = await invoke('get_voice_anywhere_focused').catch(() => null);
            const focusedWindow = currentFocusedWindow || previousFocusedWindow;
            const mode = injectModeRef.current ?? 'replace';
            const transKitWindows = ['translate', 'monitor', 'config'];
            if (focusedWindow && transKitWindows.includes(focusedWindow)) {
                await invoke('voice_inject_to_window', { label: focusedWindow, text, mode });
                console.log('[VoiceAnywhere] injected into window:', focusedWindow);
            } else {
                await invoke('voice_copy_to_clipboard', { text });
                console.log('[VoiceAnywhere] copied transcript to clipboard');
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

        try {
            const client = await createSTTClient();

            client.onProvisional = (text) => {
                const nextText = text ?? '';
                interimRef.current = nextText;
                if (!isPlaceholderTranscript(nextText)) lastTranscriptRef.current = nextText;
                setInterim(nextText);
            };
            client.onOriginal = async (text) => {
                if (!text?.trim()) return;
                clearStopFallbackTimer();
                lastTranscriptRef.current = text;
                setFinalText(text);
                isRecordingRef.current = false;
                await invoke('stop_audio_capture').catch(() => {});
                unlistenAudioRef.current?.();
                unlistenAudioRef.current = null;
                await injectText(text);
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
        stopFallbackTimerRef.current = setTimeout(async () => {
            if (!finalizingRef.current) return;
            const fallbackText = (isPlaceholderTranscript(lastTranscriptRef.current) ? '' : lastTranscriptRef.current?.trim())
                || (isPlaceholderTranscript(interimRef.current) ? '' : interimRef.current?.trim());
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
