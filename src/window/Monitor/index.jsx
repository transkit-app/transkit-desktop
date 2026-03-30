import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { documentDir, join } from '@tauri-apps/api/path';
import { open as openPath } from '@tauri-apps/api/shell';
import { writeTextFile, createDir, exists } from '@tauri-apps/api/fs';
import { useTranslation } from 'react-i18next';
import { Button } from '@nextui-org/react';
import { BsPinFill } from 'react-icons/bs';
import { MdOpenInFull, MdBlurOn, MdVolumeUp, MdVolumeOff, MdSettings, MdSave, MdSaveAlt, MdFolderOpen, MdClose, MdRemove, MdMic } from 'react-icons/md';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConfig } from '../../hooks';
import { osType } from '../../utils/env';
import { store } from '../../utils/store';
import { getServiceName } from '../../utils/service_instance';
import MonitorToolbar from './components/MonitorToolbar';
import MonitorLog from './components/MonitorLog';
import ContextPanel from './components/ContextPanel';
import AIPanel from './components/AIPanel';
import * as transcriptionServices from '../../services/transcription';
import { getTTSQueue } from './tts';
import { reportUsage, CLOUD_ENABLED } from '../../lib/transkit-cloud';

const MAX_ENTRIES = 100;
const SUB_MODE_HEIGHT = 190;
const NORMAL_HEIGHT = 400;
const CONTEXT_PANEL_HEIGHT = 110;
const WINDOW_WIDTH = 720;
const SUB_FONT_MIN = 6;
const SUB_FONT_MAX = 72;

const EMPTY_CONTEXT = {
    general: [],
    text: '',
    terms: [],
    translation_terms: [],
};

function StatusDot({ status }) {
    const colors = {
        connecting: 'bg-yellow-400 animate-pulse',
        connected: 'bg-green-400',
        disconnected: 'bg-default-300',
        error: 'bg-red-400',
    };
    return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status] ?? colors.disconnected}`} />;
}

// Short display label for service names shown in the bottom status bar
const SVC_LABELS = {
    deepgram_stt: 'Deepgram', soniox_stt: 'Soniox', gladia_stt: 'Gladia',
    transkit_cloud_stt: 'Transkit Cloud', openai_whisper_stt: 'Whisper',
    assemblyai_stt: 'AssemblyAI',
    edge_tts: 'Edge TTS', elevenlabs_tts: 'ElevenLabs', google_tts: 'Google TTS',
    openai_tts: 'OpenAI TTS', vieneu_tts: 'VieNeu', lingva: 'Lingva',
};
function _svcLabel(name) {
    return SVC_LABELS[name] ?? name.replace(/_stt|_tts/g, '').replace(/_/g, ' ');
}

function mapServiceConfigToTTSParams(serviceName, config) {
    const c = config ?? {};
    switch (serviceName) {
        case 'edge_tts':
            return {
                apiType: 'edge_tts',
                edgeVoice: c.voice ?? 'vi-VN-HoaiMyNeural',
                edgeRate: c.rate ?? '+0%',
                edgePitch: c.pitch ?? '+0Hz',
            };
        case 'google_tts':
            return {
                apiType: 'google',
                googleLang: c.lang ?? 'vi',
                googleSpeed: c.speed ?? 1,
            };
        case 'elevenlabs_tts':
            return {
                apiType: 'elevenlabs',
                elevenLabsApiKey: c.apiKey ?? '',
                elevenLabsVoiceId: c.voiceId ?? 'FTYCiQT21H9XQvhRu0ch',
                elevenLabsModelId: c.modelId ?? 'eleven_flash_v2_5',
                elevenLabsMode: c.mode ?? 'wss',
            };
        case 'vieneu_tts':
            return {
                apiType: 'vieneu_stream',
                serverUrl: c.serverUrl ?? 'http://localhost:8001',
                voiceId: c.voiceId ?? 'NgocHuyen',
                model: c.model ?? 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf',
            };
        case 'openai_tts':
            return {
                apiType: 'openai_compat',
                serverUrl: c.serverUrl ?? 'http://localhost:8080',
                voiceId: c.voice ?? '',
                model: c.model ?? 'tts-1',
            };
        case 'transkit_cloud_tts':
            return {
                apiType: 'transkit_cloud',
                voiceId: c.voiceId ?? 'auto',
            };
        default:
            return { apiType: 'google', googleLang: 'vi', googleSpeed: 1 };
    }
}


// ─── Transcript file helpers ──────────────────────────────────────────────────

function formatEntryMarkdown(entry, index) {
    const speaker = entry.speaker ? `[${entry.speaker}] ` : '';
    const lines = [];
    if (entry.original) lines.push(`> ${speaker}${entry.original}`);
    if (entry.translation) lines.push(entry.translation);
    return lines.join('\n');
}

async function getTranscriptFilePath() {
    const docsDir = await documentDir();
    const dir = await join(docsDir, 'TransKit');
    if (!(await exists(dir))) {
        await createDir(dir, { recursive: true });
    }
    const now = new Date();
    const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
    return await join(dir, `transcript_${ts}.md`);
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function Monitor() {
    const { t } = useTranslation();

    const [activeTranscriptionService, setActiveTranscriptionService] = useConfig('transcription_active_service', 'deepgram_stt');
    const [transcriptionServiceList] = useConfig('transcription_service_list', ['deepgram_stt']);
    const [sourceLang, setSourceLang] = useConfig('audio_source_lang', 'auto');
    const [targetLang, setTargetLang] = useConfig('audio_target_lang', 'vi');
    const [sourceAudio, setSourceAudio] = useConfig('audio_source', 'system');
    const [fontSize, setFontSize] = useConfig('monitor_font_size', 14);

    // TTS config
    const [activeTtsService, setActiveTtsService] = useConfig('tts_active_service', 'edge_tts');
    const [ttsServiceList] = useConfig('tts_service_list', ['google_tts', 'edge_tts']);
    const [ttsPlaybackRate] = useConfig('tts_playback_rate', 1);
    const [ttsVolume, setTtsVolume] = useConfig('tts_volume', 1.0);

    // Active AI service (for context generation)
    const [aiServiceList] = useConfig('ai_service_list', []);

    // AI Suggestion config
    const [aiSuggestionService, setAiSuggestionService] = useConfig('monitor_ai_suggestion_service', '');
    const [aiSuggestionContextLines, setAiSuggestionContextLines] = useConfig('monitor_ai_suggestion_context_lines', 10);
    const [aiSuggestionResponseLang, setAiSuggestionResponseLang] = useConfig('monitor_ai_suggestion_response_lang', 'both');
    const [aiSuggestionFontSize, setAiSuggestionFontSize] = useConfig('monitor_ai_suggestion_font_size', 16);
    const [aiSuggestionModes, setAiSuggestionModes] = useConfig('monitor_ai_suggestion_modes', ['suggest_answer']);
    const [showAIPanel, setShowAIPanel] = useState(false);

    // User profile (for AI suggestion context)
    const [userProfile] = useConfig('user_profile', {});

    // Context — passed to the active transcription provider (providers use what they support)
    const [transcriptionContext, setTranscriptionContext] = useConfig('monitor_context', EMPTY_CONTEXT);
    // User-defined context templates (presets)
    const [contextTemplates, setContextTemplates] = useConfig('monitor_context_templates', []);

    // Auto-save
    const [autosaveEnabled, setAutosaveEnabled] = useConfig('monitor_autosave_enabled', false);

    // Show/hide original
    const [sortOrder, setSortOrder] = useConfig('monitor_sort_order', 'asc');
    const [showOriginal, setShowOriginal] = useConfig('monitor_show_original', true);
    const [showOriginalSub, setShowOriginalSub] = useConfig('monitor_sub_show_original', false);

    // Background opacity
    const [bgOpacity, setBgOpacity] = useConfig('monitor_bg_opacity', 100);
    const [subFontSize, setSubFontSize] = useConfig('monitor_sub_font_size', 44);
    const [subWidth, setSubWidth] = useConfig('monitor_sub_width', WINDOW_WIDTH);
    const [subHeight, setSubHeight] = useConfig('monitor_sub_height', SUB_MODE_HEIGHT);
    const [showContextPanel, setShowContextPanel] = useState(false);

    const [isPinned, setIsPinned] = useState(true); // mirrors alwaysOnTop:true in tauri.conf.json
    const [isTTSEnabled, setIsTTSEnabled] = useState(false);
    const [ttsPlayingText, setTtsPlayingText] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isSubMode, setIsSubMode] = useState(false);
    const [status, setStatus] = useState('disconnected');
    const [entries, setEntries] = useState([]);
    const [provisional, setProvisional] = useState('');
    const [audioCapabilities, setAudioCapabilities] = useState({ system_audio: false, microphone: true });
    const [errorMsg, setErrorMsg] = useState('');
    const [errorMeta, setErrorMeta] = useState(null); // { code, used?, limit? } for structured errors
    const [cloudConnecting, setCloudConnecting] = useState(false); // shown in status bar while fetching cloud credentials

    // Auto-save state
    const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
    const [savePath, setSavePath] = useState('');
    const [savedNotification, setSavedNotification] = useState(null); // { path } | null
    const transcriptFileRef = useRef(null); // current session file path
    const saveQueueRef = useRef([]); // entries pending write
    const autosaveEnabledRef = useRef(autosaveEnabled);

    const transcriptionClientRef = useRef({ name: null, client: null });
    const pendingOriginalRef = useRef(null);
    const unlistenAudioRef = useRef(null);

    // Cloud session tracking (used when BYO key is absent)
    const cloudSessionRef = useRef(null); // { id, startTime, remainingSeconds }
    const [cloudCountdown, setCloudCountdown] = useState(null); // seconds remaining
    const [cloudWarningLevel, setCloudWarningLevel] = useState(null); // null | 'warning' | 'danger'
    const countdownTimerRef = useRef(null);

    // ── Backward migration: old context keys → new format ────────────────────
    useEffect(() => {
        (async () => {
            const oldDomain = await store.get('monitor_context_domain');
            const oldTerms = await store.get('monitor_context_terms');
            if (oldDomain || oldTerms) {
                const migrated = {
                    general: oldDomain?.trim()
                        ? [{ key: 'domain', value: oldDomain.trim() }]
                        : [],
                    text: '',
                    terms: oldTerms?.trim()
                        ? oldTerms.split(',').map(s => s.trim()).filter(Boolean)
                        : [],
                    translation_terms: [],
                };
                setTranscriptionContext(migrated);
                await store.delete('monitor_context_domain');
                await store.delete('monitor_context_terms');
                await store.save();
            }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Migration: old soniox_ keys → new transcription service config ────────
    useEffect(() => {
        (async () => {
            const existingConfig = await store.get('soniox_stt');
            if (!existingConfig?.apiKey) {
                const oldApiKey = await store.get('soniox_api_key');
                if (oldApiKey) {
                    await store.set('soniox_stt', {
                        apiKey: oldApiKey,
                        endpointDelayMs: (await store.get('soniox_endpoint_delay_ms')) ?? 250,
                        batchIntervalMs: (await store.get('soniox_batch_interval_ms')) ?? 100,
                        speakerDiarization: (await store.get('soniox_speaker_diarization')) ?? true,
                    });
                    await store.save();
                    console.log('[Monitor] Migrated old soniox_ config keys to soniox_stt');
                }
            }
        })();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── TTS config sync ───────────────────────────────────────────────────────
    useEffect(() => {
        const serviceKey = activeTtsService ?? 'edge_tts';
        const serviceName = getServiceName(serviceKey);

        const applyConfig = (cfg) => {
            getTTSQueue().updateConfig({
                ...mapServiceConfigToTTSParams(serviceName, cfg),
                baseRate: ttsPlaybackRate,
                volume: ttsVolume ?? 1.0,
                cloudLang: targetLang,
            });
        };

        store.get(serviceKey).then(applyConfig);

        const eventKey = serviceKey.replaceAll('.', '_').replaceAll('@', ':');
        const unlistenPromise = listen(`${eventKey}_changed`, (e) => applyConfig(e.payload));
        return () => { unlistenPromise.then(f => f()); };
    }, [activeTtsService, ttsPlaybackRate, ttsVolume, targetLang]);

    // ── Load audio capabilities ───────────────────────────────────────────────
    useEffect(() => {
        invoke('get_audio_capabilities')
            .then(caps => setAudioCapabilities(caps))
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (audioCapabilities && !audioCapabilities.system_audio && sourceAudio === 'system') {
            setSourceAudio('microphone');
        }
    }, [audioCapabilities]);

    // ── TTS callbacks ─────────────────────────────────────────────────────────
    useEffect(() => {
        const tts = getTTSQueue();
        tts.onPlayStart = (text) => setTtsPlayingText(text);
        tts.onPlayEnd = () => setTtsPlayingText(null);
        tts.enabled = isTTSEnabled;
        return () => { tts.onPlayStart = null; tts.onPlayEnd = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const tts = getTTSQueue();
        if (tts.enabled !== isTTSEnabled) {
            if (isTTSEnabled) {
                tts.enabled = true;
            } else {
                tts.stop();
                tts.enabled = false;
            }
        }
    }, [isTTSEnabled]);

    // Keep ref in sync so close handler can read it without stale closure
    useEffect(() => { autosaveEnabledRef.current = autosaveEnabled; }, [autosaveEnabled]);

    // ── Finalize transcript file (flush queue + write footer) ─────────────────
    const finalizeTranscript = useCallback(async (filePath) => {
        if (!filePath) return;
        // Flush remaining queue first
        if (saveQueueRef.current.length > 0) {
            const toWrite = saveQueueRef.current.splice(0);
            const lines = toWrite.map(formatEntryMarkdown).join('\n\n');
            try {
                await writeTextFile(filePath, '\n\n' + lines, { append: true });
            } catch (_) {}
        }
        // Write footer
        try {
            const footer = `\n\n---\n\n**Ended:** ${new Date().toLocaleString()}`;
            await writeTextFile(filePath, footer, { append: true });
        } catch (_) {}
    }, []);

    // ── Auto-save: append entry to file ──────────────────────────────────────
    const flushSaveQueue = useCallback(async () => {
        if (!transcriptFileRef.current || saveQueueRef.current.length === 0) return;
        const toWrite = saveQueueRef.current.splice(0);
        const lines = toWrite.map(formatEntryMarkdown).join('\n\n');
        setSaveStatus('saving');
        try {
            await writeTextFile(transcriptFileRef.current, '\n\n' + lines, { append: true });
            setSaveStatus('saved');
        } catch (err) {
            console.error('[Monitor] Auto-save write failed:', err);
            setSaveStatus('error');
        }
    }, []);

    // ── Transcription client callbacks are attached in start() ────────────────

    const sourceAudioRef = useRef(sourceAudio);
    useEffect(() => { sourceAudioRef.current = sourceAudio; }, [sourceAudio]);
    const batchIntervalRef = useRef(100);


    const addAudioChunkListener = useCallback(async () => {
        if (unlistenAudioRef.current) {
            unlistenAudioRef.current();
            unlistenAudioRef.current = null;
        }
        const unlisten = await listen('audio_chunk', (event) => {
            const binary = atob(event.payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            transcriptionClientRef.current?.client?.sendAudio(bytes.buffer);
        });
        unlistenAudioRef.current = unlisten;
    }, []);

    // ── Transcription client factory ──────────────────────────────────────────
    const getOrCreateTranscriptionClient = useCallback((serviceName) => {
        const cached = transcriptionClientRef.current;
        if (cached.name === serviceName && cached.client) return cached.client;
        const service = transcriptionServices[serviceName];
        if (!service?.createClient) {
            throw new Error(`Unknown transcription service: ${serviceName}`);
        }
        const client = service.createClient();
        transcriptionClientRef.current = { name: serviceName, client };
        return client;
    }, []);

    // ── Start / Stop ──────────────────────────────────────────────────────────
    const start = useCallback(async () => {
        const serviceName = getServiceName(activeTranscriptionService);
        const transcriptionConfig = (await store.get(activeTranscriptionService)) ?? {};

        setErrorMsg(''); setErrorMeta(null); // clear any leftover error from previous attempt

        // If a previous cloud session was never properly reported (e.g. WS failed before
        // connecting), report it now with 0s so the server refunds the pre-debit.
        if (cloudSessionRef.current) {
            const { id, startTime, debitedSeconds } = cloudSessionRef.current;
            const elapsed = startTime !== null ? Math.min(Math.floor((Date.now() - startTime) / 1000), debitedSeconds) : 0;
            cloudSessionRef.current = null;
            reportUsage(id, elapsed);
        }

        // Non-cloud providers: require an API key / token before proceeding.
        // transkit_cloud_stt handles its own credential fetching internally.
        if (serviceName !== 'transkit_cloud_stt' && !transcriptionConfig.apiKey && !transcriptionConfig.token) {
            setErrorMsg(t('monitor.no_api_key', {
                service: t('config.service.label'),
                transcription: t('config.service.transcription'),
            }));
            return;
        }

        const client = getOrCreateTranscriptionClient(serviceName);
        const batchInterval = transcriptionConfig.batchIntervalMs ?? 100;
        batchIntervalRef.current = batchInterval;

        // Tracks remaining seconds shown in the trial notice popup (populated via onCloudSession).
        let pendingRemainingSeconds = null;

        // Attach callbacks
        // transkit_cloud_stt fires this once credentials are ready (before WS connects).
        // We register the session immediately so stop() always finds it to report usage,
        // even if the WebSocket never connects (startTime stays null → 0s → full refund).
        if (client.onCredentialRequest !== undefined) {
            client.onCredentialRequest = (loading) => setCloudConnecting(loading);
        }

        if (client.onCloudSession !== undefined) {
            client.onCloudSession = ({ session_id, remaining_seconds, debited_seconds }) => {
                cloudSessionRef.current = { id: session_id, startTime: null, debitedSeconds: debited_seconds };
                pendingRemainingSeconds = remaining_seconds;
            };
        }

        client.onOriginal = (text, speaker) => {
            pendingOriginalRef.current = { text, speaker };
        };
        client.onTranslation = (text) => {
            const pending = pendingOriginalRef.current;
            pendingOriginalRef.current = null;
            const entry = {
                id: `${Date.now()}-${Math.random()}`,
                original: pending?.text ?? '',
                translation: text,
                speaker: pending?.speaker ?? null,
            };
            setEntries(prev => {
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
            setProvisional('');
            if (transcriptFileRef.current) {
                saveQueueRef.current.push(entry);
                flushSaveQueue();
            }
            getTTSQueue().enqueue(text);
        };
        client.onProvisional = (text) => setProvisional(text || '');
        client.onStatusChange = (s) => {
            setStatus(s);
            if (s === 'connected') setErrorMsg('');

            // Auto-cleanup on unrecoverable error (quota, invalid key, max reconnects exceeded…).
            // 'error' is only set when no further reconnect will be attempted, so stopping here
            // is always correct — the user must click Start again to retry.
            if (s === 'error') {
                setIsRunning(false);
                setCloudConnecting(false);
                clearInterval(countdownTimerRef.current);
                setCloudCountdown(null);
                invoke('stop_audio_capture').catch(() => {});
                if (unlistenAudioRef.current) {
                    unlistenAudioRef.current();
                    unlistenAudioRef.current = null;
                }
                getTTSQueue().stop();
                // Reconcile any cloud session that was already pre-debited
                if (cloudSessionRef.current) {
                    const { id, startTime, debitedSeconds } = cloudSessionRef.current;
                    const elapsed = startTime !== null
                        ? Math.min(Math.floor((Date.now() - startTime) / 1000), debitedSeconds)
                        : 0;
                    cloudSessionRef.current = null;
                    reportUsage(id, elapsed);
                }
            }

            // Start cloud countdown only once the WebSocket is actually connected
            if (s === 'connected' && cloudSessionRef.current?.startTime === null) {
                cloudSessionRef.current.startTime = Date.now();
                setCloudCountdown(cloudSessionRef.current.debitedSeconds);
                countdownTimerRef.current = setInterval(() => {
                    setCloudCountdown((prev) => {
                        if (prev <= 1) { clearInterval(countdownTimerRef.current); return 0; }
                        return prev - 1;
                    });
                }, 1000);
            }
        };
        client.onError = (msg, meta) => {
            setErrorMeta(meta ?? null);
            setErrorMsg(meta?.code ? '' : msg); // structured errors use meta; plain strings use msg
            if (!meta?.code) setTimeout(() => setErrorMsg(''), 5000);
        };
        client.onReconnect = async () => {
            console.log('[Monitor] Transcription reconnected — restarting audio capture');
            await addAudioChunkListener();
            try {
                await invoke('start_audio_capture', {
                    source: sourceAudioRef.current,
                    batchIntervalMs: batchIntervalRef.current,
                });
            } catch (err) {
                setErrorMsg(String(err));
            }
        };

        setIsRunning(true);
        setProvisional('');

        client.connect({
            ...transcriptionConfig,
            sourceLanguage: sourceLang === 'auto' ? null : sourceLang,
            targetLanguage: targetLang,
            customContext: transcriptionContext,
        });

        await addAudioChunkListener();

        // Init auto-save file
        if (autosaveEnabled) {
            try {
                const filePath = await getTranscriptFilePath();
                const header = `# TransKit Transcript\n\n**Started:** ${new Date().toLocaleString()}\n**Source language:** ${sourceLang}\n**Target language:** ${targetLang}\n\n---\n\n`;
                await writeTextFile(filePath, header);
                transcriptFileRef.current = filePath;
                setSavePath(filePath);
                setSaveStatus('saved');
            } catch (err) {
                console.error('[Monitor] Auto-save init failed:', err);
                setSaveStatus('error');
            }
        }

        try {
            await invoke('start_audio_capture', {
                source: sourceAudio,
                batchIntervalMs: batchInterval,
            });
        } catch (err) {
            setErrorMsg(String(err));
            setIsRunning(false);
            client.disconnect();
            if (unlistenAudioRef.current) {
                unlistenAudioRef.current();
                unlistenAudioRef.current = null;
            }
            transcriptFileRef.current = null;
        }
    }, [activeTranscriptionService, sourceLang, targetLang, sourceAudio, transcriptionContext, autosaveEnabled, addAudioChunkListener, getOrCreateTranscriptionClient, flushSaveQueue, t]);

    const stop = useCallback(async (silent = false) => {
        setIsRunning(false);

        // Reconcile cloud usage: report actual duration so server refunds unused debited seconds
        if (cloudSessionRef.current) {
            const { id, startTime, debitedSeconds } = cloudSessionRef.current;
            const durationSeconds = startTime !== null
                ? Math.min(Math.floor((Date.now() - startTime) / 1000), debitedSeconds)
                : 0;
            cloudSessionRef.current = null;
            clearInterval(countdownTimerRef.current);
            setCloudCountdown(null);
            setCloudWarningLevel(null);
            reportUsage(id, durationSeconds); // fire-and-forget
        }

        try { await invoke('stop_audio_capture'); } catch (_) {}
        transcriptionClientRef.current?.client?.disconnect();
        if (unlistenAudioRef.current) {
            unlistenAudioRef.current();
            unlistenAudioRef.current = null;
        }
        setProvisional('');
        getTTSQueue().stop();

        // Finalize transcript file
        const filePath = transcriptFileRef.current;
        if (filePath) {
            transcriptFileRef.current = null;
            await finalizeTranscript(filePath);
            setSaveStatus('saved');
            if (!silent) {
                setSavedNotification({ path: filePath });
            }
        }
    }, [finalizeTranscript]);

    // ── Cloud session expiry: warn at 2 min / 1 min, auto-stop at 0 ──────────
    useEffect(() => {
        if (cloudCountdown === null) return;
        if (cloudCountdown === 0) {
            stop();
        } else if (cloudCountdown === 120) {
            setCloudWarningLevel('warning');
        } else if (cloudCountdown === 60) {
            setCloudWarningLevel('danger');
        }
    }, [cloudCountdown, stop]);

    const toggleTTS = useCallback(() => {
        const next = !isTTSEnabled;
        setIsTTSEnabled(next);
        getTTSQueue().setEnabled(next);
    }, [isTTSEnabled]);

    const handleReplayEntry = useCallback((text) => {
        if (!isTTSEnabled) setIsTTSEnabled(true);
        getTTSQueue().setEnabled(true);
        getTTSQueue().replay(text);
    }, [isTTSEnabled]);

    const toggleRun = useCallback(() => {
        isRunning ? stop() : start();
    }, [isRunning, start, stop]);

    const togglePin = useCallback(() => {
        const next = !isPinned;
        setIsPinned(next);
        appWindow.setAlwaysOnTop(next);
    }, [isPinned]);

    const toggleContextPanel = useCallback(() => {
        setShowContextPanel(prev => !prev);
    }, []);

    const toggleAIPanel = useCallback(() => setShowAIPanel(v => !v), []);

    const openAudioConfig = useCallback(() => {
        invoke('open_config_window');
    }, []);

    const handleClear = useCallback(() => {
        // Block clear when running with auto-save enabled
        if (isRunning && autosaveEnabled) {
            setErrorMsg(t('monitor.autosave_clear_blocked'));
            setTimeout(() => setErrorMsg(''), 5000);
            return;
        }
        setEntries([]);
        setProvisional('');
    }, [isRunning, autosaveEnabled, t]);

    const toggleOriginal = useCallback(() => setShowOriginal(!(showOriginal ?? true)), [showOriginal, setShowOriginal]);
    const toggleOriginalSub = useCallback(() => setShowOriginalSub(!(showOriginalSub ?? false)), [showOriginalSub, setShowOriginalSub]);

    // ── Template management ───────────────────────────────────────────────────
    const handleSaveTemplate = useCallback((name, context) => {
        const id = `custom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        setContextTemplates([...(contextTemplates ?? []), { id, name, context }]);
    }, [contextTemplates, setContextTemplates]);

    const handleDeleteTemplate = useCallback((id) => {
        setContextTemplates((contextTemplates ?? []).filter(t => t.id !== id));
    }, [contextTemplates, setContextTemplates]);

    // ── Sub mode position persistence ─────────────────────────────────────────
    const [subX, setSubX] = useConfig('monitor_sub_x', null);
    const [subY, setSubY] = useConfig('monitor_sub_y', null);

    const toggleSubMode = useCallback(async () => {
        const entering = !isSubMode;
        setIsSubMode(entering);
        try {
            if (entering) {
                await invoke('set_window_buttons_hidden', { hidden: true });
                await appWindow.setSize(new LogicalSize(subWidth ?? WINDOW_WIDTH, subHeight ?? SUB_MODE_HEIGHT));
                if (subX != null && subY != null) {
                    const { LogicalPosition } = await import('@tauri-apps/api/window');
                    await appWindow.setPosition(new LogicalPosition(subX, subY));
                }
                await appWindow.setAlwaysOnTop(true);
            } else {
                try {
                    const scale = await appWindow.scaleFactor();
                    const physical = await appWindow.innerSize();
                    const pos = await appWindow.outerPosition();
                    setSubWidth(Math.round(physical.width / scale));
                    setSubHeight(Math.round(physical.height / scale));
                    setSubX(Math.round(pos.x / scale));
                    setSubY(Math.round(pos.y / scale));
                } catch (_) {}
                await appWindow.setSize(new LogicalSize(WINDOW_WIDTH, NORMAL_HEIGHT));
                await appWindow.center();
                await appWindow.setAlwaysOnTop(isPinned);
                await invoke('set_window_buttons_hidden', { hidden: false });
            }
        } catch (e) {
            console.error('Failed to toggle sub mode:', e);
        }
    }, [isSubMode, isPinned, subWidth, subHeight, subX, subY, setSubWidth, setSubHeight, setSubX, setSubY]);

    useEffect(() => {
        return () => { stop(true); };
    }, []);

    // Hide window + remove from taskbar (used by close button and OS close events)
    const handleHideWindow = useCallback(async () => {
        try { await appWindow.setSkipTaskbar(true); } catch (_) {}
        await appWindow.hide();
    }, []);

    // ── Flush on app close (Cmd+Q, OS close, taskbar right-click→Close, etc.) ──
    useEffect(() => {
        const unlistenPromise = appWindow.onCloseRequested(async (event) => {
            // Always prevent actual window destruction — the monitor window must
            // survive closes so it can be re-opened from the tray/shortcut.
            event.preventDefault();
            if (autosaveEnabledRef.current && transcriptFileRef.current) {
                const filePath = transcriptFileRef.current;
                transcriptFileRef.current = null;
                await finalizeTranscript(filePath);
            }
            await handleHideWindow();
        });
        // Best-effort sync flush for browser-level unload
        const handleUnload = () => {
            if (transcriptFileRef.current && saveQueueRef.current.length > 0) {
                const lines = saveQueueRef.current.splice(0).map(formatEntryMarkdown).join('\n\n');
                // Fire-and-forget — can't await in beforeunload
                writeTextFile(transcriptFileRef.current, '\n\n' + lines, { append: true }).catch(() => {});
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => {
            unlistenPromise.then(f => f());
            window.removeEventListener('beforeunload', handleUnload);
        };
    }, [finalizeTranscript]);

    // ── Open transcripts folder ───────────────────────────────────────────────
    const handleOpenTranscriptFolder = useCallback(async () => {
        try {
            const docsDir = await documentDir();
            const dir = await join(docsDir, 'TransKit');
            await openPath(dir);
        } catch (_) {}
    }, []);

    // ── Save status label ─────────────────────────────────────────────────────
    const saveStatusLabel = () => {
        if (!autosaveEnabled) {
            return (
                <span className='text-[11px] font-medium text-default-400 flex items-center gap-0.5'>
                    <MdSaveAlt className='text-[12px]' />
                    {t('monitor.autosave_disabled_warning')}
                </span>
            );
        }
        const labelMap = {
            idle: t('monitor.autosave_off'),
            saving: t('monitor.autosave_saving'),
            saved: t('monitor.autosave_on'),
            error: t('monitor.autosave_error'),
        };
        const colorMap = {
            idle: 'text-default-400',
            saving: 'text-warning animate-pulse',
            saved: 'text-success',
            error: 'text-danger',
        };
        return (
            <span className={`text-[11px] font-medium ${colorMap[saveStatus] ?? 'text-default-400'} flex items-center gap-0.5`}>
                <MdSaveAlt className='text-[12px]' />
                {labelMap[saveStatus] ?? ''}
            </span>
        );
    };

    // ── Active AI service key — picked inside ContextPanel ───────────────────
    // (aiServiceList is passed down so ContextPanel can render its own selector)

    // ── Sub mode layout ───────────────────────────────────────────────────────
    const bgAlpha = (bgOpacity ?? 100) / 100;
    const subBgAlpha = 0.25 + bgAlpha * 0.63;

    if (isSubMode) {
        return (
            <div
                className='group w-screen h-screen flex flex-col overflow-hidden rounded-[10px]'
                style={{ background: `rgba(18,18,20,${subBgAlpha.toFixed(2)})`, backdropFilter: bgAlpha < 1 ? 'blur(16px)' : undefined }}
            >
                <div
                    className='absolute top-0 left-0 right-0 h-7 z-10 flex items-center justify-between px-2
                               rounded-t-[10px] border-b border-white/10
                               opacity-0 group-hover:opacity-100 transition-opacity duration-200'
                    style={{ background: 'rgba(18,18,20,0.96)' }}
                    data-tauri-drag-region='true'
                >
                    <div className='flex items-center gap-1'>
                        <div className='pointer-events-none'>
                            <StatusDot status={status} />
                        </div>
                        <button
                            onClick={() => setSubFontSize(Math.max(SUB_FONT_MIN, (subFontSize ?? 44) - 2))}
                            className='w-5 h-5 flex items-center justify-center text-white/60 hover:text-white text-[11px] font-bold transition-colors'
                            title={t('monitor.font_smaller')}
                        >A-</button>
                        <span className='text-[10px] text-white/40 w-5 text-center select-none tabular-nums'>{subFontSize ?? 44}</span>
                        <button
                            onClick={() => setSubFontSize(Math.min(SUB_FONT_MAX, (subFontSize ?? 44) + 2))}
                            className='w-5 h-5 flex items-center justify-center text-white/60 hover:text-white text-[11px] font-bold transition-colors'
                            title={t('monitor.font_larger')}
                        >A+</button>
                    </div>

                    <div className='flex items-center gap-1'>
                        <button
                            onClick={toggleOriginalSub}
                            className={`
                                w-5 h-5 rounded-full flex items-center justify-center text-white text-[9px] font-bold
                                ${(showOriginalSub ?? false) ? 'bg-white/30' : 'bg-white/10'}
                                hover:bg-white/30 transition-colors
                            `}
                            title={(showOriginalSub ?? false) ? t('monitor.hide_original') : t('monitor.show_original')}
                        >
                            S
                        </button>
                        <button
                            onClick={() => setBgOpacity((bgOpacity ?? 100) >= 100 ? 70 : 100)}
                            className={`
                                w-5 h-5 rounded-full flex items-center justify-center
                                ${(bgOpacity ?? 100) < 100 ? 'bg-secondary/50 text-white' : 'bg-white/10 text-white/50'}
                                hover:bg-white/30 transition-colors
                            `}
                            title={(bgOpacity ?? 100) < 100 ? t('monitor.transparent_off') : t('monitor.transparent_on')}
                        >
                            <MdBlurOn className='text-[11px]' />
                        </button>
                        <button
                            onClick={toggleTTS}
                            className={`
                                w-5 h-5 rounded-full flex items-center justify-center
                                ${isTTSEnabled ? 'bg-secondary/50 text-white' : 'bg-white/10 text-white/50'}
                                hover:bg-white/30 transition-colors
                            `}
                            title={isTTSEnabled ? t('monitor.tts_disable') : t('monitor.tts_enable')}
                        >
                            {isTTSEnabled
                                ? <MdVolumeUp className='text-[11px]' />
                                : <MdVolumeOff className='text-[11px]' />}
                        </button>
                        <button
                            onClick={toggleRun}
                            className={`
                                w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px]
                                ${isRunning ? 'bg-red-500/80' : 'bg-primary/80'}
                                hover:opacity-100 transition-opacity
                            `}
                            title={isRunning ? t('monitor.stop') : t('monitor.start')}
                        >
                            {isRunning ? '■' : '▶'}
                        </button>
                        <button
                            onClick={toggleSubMode}
                            className='w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-white/60 hover:text-white hover:bg-white/30 transition-all'
                            title={t('monitor.exit_sub_mode')}
                        >
                            <MdOpenInFull className='text-[10px]' />
                        </button>
                    </div>
                </div>

                <div className='pointer-events-none w-full h-full flex flex-col'>
                    <MonitorLog
                        entries={entries}
                        provisional={provisional}
                        fontSize={subFontSize ?? 44}
                        isSubMode={true}
                        showOriginal={showOriginalSub ?? false}
                        playingText={ttsPlayingText}
                        onReplayEntry={handleReplayEntry}
                    />
                </div>
            </div>
        );
    }

    // ── Normal mode layout ────────────────────────────────────────────────────
    return (
        <div
            className='w-screen h-screen flex flex-col overflow-hidden rounded-[12px] border border-white/[0.08] relative'
            style={{
                background: bgAlpha >= 1
                    ? 'hsl(var(--nextui-background))'
                    : `hsl(var(--nextui-background) / ${bgAlpha.toFixed(2)})`,
                // backdrop-filter causes Core Animation layer invalidation on macOS every
                // time a transcript entry lands (React repaint → re-composite → flicker).
                // SubMode avoids this because its layout is simpler and uses rgba() directly.
                // On macOS we skip the blur and rely on the semi-transparent solid bg instead.
                backdropFilter: bgAlpha < 1 && osType !== 'Darwin' ? 'blur(24px) saturate(1.6)' : undefined,
            }}
        >
            {/* Header */}
            <div
                className='h-[30px] flex items-center justify-between px-2 z-10 relative select-none'
                data-tauri-drag-region='true'
            >
                {/* Left: status */}
                <div className='flex items-center gap-1.5 pointer-events-none'>
                    <StatusDot status={status} />
                    <span className='text-[11px] text-default-500 font-medium'>
                        {t(`monitor.status_${status}`) || status}
                    </span>
                </div>

                {/* Right: auto-save toggle + Config + Pin + Close */}
                <div className='flex items-center gap-0.5'>
                    <Button
                        isIconOnly
                        size='sm'
                        variant={autosaveEnabled ? 'flat' : 'light'}
                        color={autosaveEnabled ? 'primary' : 'default'}
                        className='h-[26px] w-[26px] min-w-0'
                        onPress={() => setAutosaveEnabled(!autosaveEnabled)}
                        title={autosaveEnabled ? t('monitor.autosave_on') : t('monitor.autosave_off')}
                    >
                        <MdSave className='text-[16px]' />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={handleOpenTranscriptFolder}
                        title={t('monitor.autosave_open_folder')}
                    >
                        <MdFolderOpen className='text-[16px] text-default-400' />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={openAudioConfig}
                        title={t('monitor.open_audio_config')}
                    >
                        <MdSettings className='text-[16px] text-default-400' />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={togglePin}
                        title={isPinned ? t('monitor.unpin') : t('monitor.pin')}
                    >
                        <BsPinFill className={`text-[16px] ${isPinned ? 'text-primary' : 'text-default-400'}`} />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={() => appWindow.minimize()}
                        title={t('monitor.minimize')}
                    >
                        <MdRemove className='text-[16px] text-default-400' />
                    </Button>
                    <Button
                        isIconOnly
                        size='sm'
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={handleHideWindow}
                        title={t('monitor.close')}
                    >
                        <MdClose className='text-[16px] text-default-400' />
                    </Button>
                </div>
            </div>

            {/* Toolbar */}
            <MonitorToolbar
                isRunning={isRunning}
                sourceAudio={sourceAudio}
                sourceLang={sourceLang ?? 'auto'}
                targetLang={targetLang ?? 'vi'}
                audioCapabilities={audioCapabilities}
                fontSize={fontSize ?? 14}
                isSubMode={isSubMode}
                isTTSEnabled={isTTSEnabled}
                showContextPanel={showContextPanel}
                showOriginal={showOriginal ?? true}
                bgOpacity={bgOpacity ?? 100}
                onToggleRun={toggleRun}
                onToggleOriginal={toggleOriginal}
                onSetBgOpacity={setBgOpacity}
                onClear={handleClear}
                onSetSourceAudio={setSourceAudio}
                onSetSourceLang={setSourceLang}
                onSetTargetLang={setTargetLang}
                onFontSizeChange={setFontSize}
                onToggleSubMode={toggleSubMode}
                onToggleTTS={toggleTTS}
                onToggleContextPanel={toggleContextPanel}
                sortOrder={sortOrder}
                onToggleSortOrder={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                showAIPanel={showAIPanel}
                onToggleAIPanel={toggleAIPanel}
            />

            {/* Context panel — absolute overlay, does not affect window size */}
            {showContextPanel && (
                <div className='absolute left-2 right-2 z-50 overflow-y-auto rounded-lg border border-content3/40 shadow-xl'
                    style={{
                        top: '72px', // below header + toolbar
                        maxHeight: 'calc(100% - 72px)',
                        background: 'hsl(var(--nextui-content2))',
                    }}
                >
                    <div className='p-3'>
                        <ContextPanel
                            context={transcriptionContext ?? EMPTY_CONTEXT}
                            templates={contextTemplates ?? []}
                            aiServiceList={aiServiceList ?? []}
                            onContextChange={setTranscriptionContext}
                            onSaveTemplate={handleSaveTemplate}
                            onDeleteTemplate={handleDeleteTemplate}
                            onOpenAiSettings={openAudioConfig}
                        />
                    </div>
                </div>
            )}

            {/* AI Panel overlay */}
            {showAIPanel && !isSubMode && (
                <>
                    {/* Backdrop — click outside to close */}
                    <div className='absolute inset-0 z-40' onClick={() => setShowAIPanel(false)} />
                    <div className='absolute left-2 right-2 z-50 overflow-y-auto rounded-lg border border-content3/40 shadow-xl'
                        style={{ top: '72px', maxHeight: 'calc(100% - 72px)', background: 'hsl(var(--nextui-content2))' }}
                    >
                    <div className='p-3'>
                        <AIPanel
                            aiSuggestionModes={aiSuggestionModes}
                            aiSuggestionContextLines={aiSuggestionContextLines}
                            aiSuggestionResponseLang={aiSuggestionResponseLang}
                            aiServiceKey={aiSuggestionService || (aiServiceList?.[0] ?? '')}
                            aiServiceList={aiServiceList ?? []}
                            onSetAiService={setAiSuggestionService}
                            onSetModes={setAiSuggestionModes}
                            onSetContextLines={setAiSuggestionContextLines}
                            onSetResponseLang={setAiSuggestionResponseLang}
                        />
                    </div>
                </div>
                </>
            )}

            {/* Saved notification */}
            {savedNotification && (
                <div
                    className='absolute bottom-2 left-2 right-2 z-50 flex items-start gap-2 px-3 py-2 rounded-lg shadow-xl border border-success/50'
                    style={{ background: 'rgba(17, 24, 20, 0.97)', backdropFilter: 'none' }}
                >
                    <MdSaveAlt className='text-success text-[16px] flex-shrink-0 mt-0.5' />
                    <div className='flex-1 min-w-0'>
                        <p className='text-xs font-semibold' style={{ color: '#4ade80' }}>{t('monitor.autosave_saved')}</p>
                        <button
                            className='text-[10px] truncate text-left w-full hover:underline cursor-pointer'
                            style={{ color: '#9ca3af' }}
                            title={savedNotification.path}
                            onClick={() => openPath(savedNotification.path).catch(() => {})}
                        >
                            {savedNotification.path}
                        </button>
                    </div>
                    <button
                        onClick={() => {
                            const dir = savedNotification.path.substring(0, savedNotification.path.lastIndexOf('/') + 1) ||
                                        savedNotification.path.substring(0, savedNotification.path.lastIndexOf('\\') + 1);
                            openPath(dir || savedNotification.path).catch(() => {});
                        }}
                        className='flex-shrink-0 hover:opacity-70 transition-opacity'
                        style={{ color: '#9ca3af' }}
                        title={t('monitor.autosave_open_folder')}
                    >
                        <MdFolderOpen className='text-[14px]' />
                    </button>
                    <button
                        onClick={() => setSavedNotification(null)}
                        className='flex-shrink-0 hover:opacity-70 transition-opacity'
                        style={{ color: '#9ca3af' }}
                    >
                        <MdClose className='text-[14px]' />
                    </button>
                </div>
            )}

            {/* Quota exceeded — structured error with action hints */}
            {errorMeta?.code === 'quota_exceeded' && (
                <div className='mx-2 mt-1 px-2 py-2 bg-danger/10 border border-danger/20 rounded-lg flex flex-col gap-1.5'>
                    <p className='text-xs text-danger font-medium'>
                        {errorMeta.used != null && errorMeta.limit != null
                            ? t('monitor.quota_exceeded_title', { used: errorMeta.used, limit: errorMeta.limit })
                            : t('monitor.quota_exceeded_title_short')}
                    </p>
                    <button
                        onClick={() => openPath('https://transkit.app/pricing').catch(() => {})}
                        className='text-xs text-primary hover:underline text-left'
                    >
                        → {t('monitor.quota_action_upgrade')}
                    </button>
                    <p className='text-xs text-default-500'>
                        → {t('monitor.quota_action_byok', {
                            service: t('config.service.label'),
                            transcription: t('config.service.transcription'),
                        })}
                    </p>
                </div>
            )}

            {/* Auth lock conflict — Supabase concurrent token refresh race */}
            {errorMeta?.code === 'auth_lock_conflict' && (
                <div className='mx-2 mt-1 px-2 py-2 bg-warning/10 border border-warning/20 rounded-lg flex flex-col gap-1'>
                    <p className='text-xs text-warning-700 dark:text-warning-400 font-medium'>
                        {t('monitor.auth_lock_conflict_title')}
                    </p>
                    <p className='text-xs text-default-500'>
                        {t('monitor.auth_lock_conflict_hint')}
                    </p>
                </div>
            )}

            {/* Plain error message */}
            {errorMsg && (
                <div className='mx-2 mt-1 px-2 py-1 bg-danger/10 border border-danger/20 rounded-lg'>
                    <p className='text-xs text-danger'>{errorMsg}</p>
                </div>
            )}

            {/* Log */}
            <MonitorLog
                entries={entries}
                provisional={provisional}
                fontSize={fontSize ?? 14}
                isSubMode={false}
                showOriginal={showOriginal ?? true}
                playingText={ttsPlayingText}
                onReplayEntry={handleReplayEntry}
                status={status}
                aiSuggestionService={aiSuggestionService || (aiServiceList?.[0] ?? '')}
                aiSuggestionContextLines={aiSuggestionContextLines ?? 10}
                aiSuggestionResponseLang={aiSuggestionResponseLang ?? 'both'}
                aiSuggestionFontSize={aiSuggestionFontSize ?? 16}
                onSetAiSuggestionFontSize={setAiSuggestionFontSize}
                userProfile={userProfile ?? {}}
                sourceLang={sourceLang ?? 'auto'}
                targetLang={targetLang ?? 'vi'}
                transcriptFileRef={transcriptFileRef}
                sortOrder={sortOrder}
                onToggleRun={toggleRun}
                activeTranscriptionService={activeTranscriptionService ?? 'soniox_stt'}
                onSetTranscriptionService={setActiveTranscriptionService}
                transcriptionServiceList={transcriptionServiceList ?? []}
                activeTtsService={activeTtsService ?? 'edge_tts'}
                onSetTtsService={setActiveTtsService}
                ttsServiceList={ttsServiceList ?? []}
                isTTSEnabled={isTTSEnabled}
                aiSuggestionModes={aiSuggestionModes}
            />

            {/* ── Bottom status bar ────────────────────────────────────────── */}
            <div className='flex items-center justify-between px-2 h-[22px] border-t border-content2/60 flex-shrink-0 select-none'>
                {/* Left: transcription + TTS provider + cloud countdown */}
                <div className='flex items-center gap-2.5'>
                    {/* Transcription */}
                    <span className={`flex items-center gap-1 text-[10px] ${status === 'connected' ? 'text-foreground' : 'text-default-400'}`}>
                        <MdMic className='text-[11px]' />
                        {_svcLabel(getServiceName(activeTranscriptionService ?? ''))}
                    </span>
                    {/* Cloud: connecting indicator or countdown */}
                    {cloudConnecting && isRunning && (
                        <span className='flex items-center gap-1 text-[10px] text-default-400'>
                            <span className='text-default-300'>·</span>
                            <span className='w-2.5 h-2.5 rounded-full border border-primary/70 border-t-transparent animate-spin flex-shrink-0' />
                        </span>
                    )}
                    {!cloudConnecting && cloudCountdown !== null && isRunning && (
                        <span className={`text-[10px] font-mono ${
                            cloudWarningLevel === 'danger'  ? 'text-danger' :
                            cloudWarningLevel === 'warning' ? 'text-warning' :
                            'text-default-400'
                        }`}>
                            · {`${Math.floor(cloudCountdown / 60)}:${String(cloudCountdown % 60).padStart(2, '0')}`}
                            {cloudWarningLevel === 'warning' && ` · ${t('monitor.cloud_session_ending_soon')}`}
                            {cloudWarningLevel === 'danger'  && ` · ${t('monitor.cloud_session_last_minute')}`}
                        </span>
                    )}
                    {/* TTS — only when enabled */}
                    {isTTSEnabled && (
                        <span className='flex items-center gap-1 text-[10px] text-default-400'>
                            <span className='text-default-300'>·</span>
                            <MdVolumeUp className='text-[11px]' />
                            {_svcLabel(getServiceName(activeTtsService ?? ''))}
                        </span>
                    )}
                </div>
                {/* Right: auto-save status */}
                <span className={`flex items-center gap-1 text-[10px] font-medium ${
                    saveStatus === 'saving' ? 'text-warning animate-pulse' :
                    saveStatus === 'saved'  ? 'text-success' :
                    saveStatus === 'error'  ? 'text-danger' :
                    autosaveEnabled        ? 'text-success' : 'text-default-300'
                }`}>
                    <MdSave className='text-[11px]' />
                    {saveStatus === 'saving' ? t('monitor.autosave_saving') :
                     saveStatus === 'saved'  ? t('monitor.autosave_saved') :
                     saveStatus === 'error'  ? t('monitor.autosave_error') :
                     autosaveEnabled        ? t('monitor.autosave_label') :
                                             t('monitor.autosave_disabled_warning')}
                </span>
            </div>
        </div>
    );
}
