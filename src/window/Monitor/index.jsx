import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { documentDir, join } from '@tauri-apps/api/path';
import { open as openPath } from '@tauri-apps/api/shell';
import { save as saveDialog } from '@tauri-apps/api/dialog';
import { writeTextFile, createDir, exists } from '@tauri-apps/api/fs';
import { useTranslation } from 'react-i18next';
import { Button, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@nextui-org/react';
import { BsPinFill } from 'react-icons/bs';
import { MdOpenInFull, MdBlurOn, MdVolumeUp, MdVolumeOff, MdSettings, MdSave, MdSaveAlt, MdFolderOpen, MdDownload, MdClose, MdRemove, MdMic, MdRecordVoiceOver } from 'react-icons/md';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useConfig } from '../../hooks';
import { osType } from '../../utils/env';
import { store } from '../../utils/store';
import { getServiceName } from '../../utils/service_instance';
import MonitorToolbar from './components/MonitorToolbar';
import MonitorLog from './components/MonitorLog';
import ContextPanel from './components/ContextPanel';
import AIPanel from './components/AIPanel';
import NarrationPanel from './components/NarrationPanel';
import NarrationReviewOverlay from './components/NarrationReviewOverlay';
import PttCaption from './components/PttCaption';
import VoiceFab from '../VoiceAnywhere/VoiceFab';
import * as transcriptionServices from '../../services/transcription';
import * as translateServices from '../../services/translate';
import { getTTSQueue } from './tts';
import { reportUsage, CLOUD_ENABLED, callCloudAI } from '../../lib/transkit-cloud';
import { polishTranscript, DEFAULT_PROMPTS } from '../../utils/polishTranscript';
import { useVoiceAnywhere } from '../VoiceAnywhere/useVoiceAnywhere';

const MAX_ENTRIES = 100;
const SUB_MODE_HEIGHT = 190;
const NORMAL_HEIGHT = 750;
const CONTEXT_PANEL_HEIGHT = 110;
const WINDOW_WIDTH = 1160;
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
    transkit_cloud_stt: 'Transkit Cloud STT', transkit_cloud_dictation: 'Transkit Cloud Dictation',
    openai_whisper_stt: 'Whisper', assemblyai_stt: 'AssemblyAI', local_sidecar_stt: 'Offline STT (MLX)',
    edge_tts: 'Edge TTS', elevenlabs_tts: 'ElevenLabs', google_tts: 'Google TTS',
    google_cloud_tts: 'Google Cloud TTS',
    openai_tts: 'OpenAI TTS', vieneu_tts: 'VieNeu', lingva: 'Lingva',
    local_sidecar_tts: 'Local Model TTS', onnx_stt: 'ONNX STT',
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
        case 'google_cloud_tts':
            return {
                apiType: 'google_cloud_tts',
                gcpApiKey: c.apiKey ?? '',
                gcpVoice: c.voice ?? 'Charon',
                gcpSpeakingRate: parseFloat(c.speakingRate ?? '1.0') || 1.0,
                gcpPitch: parseFloat(c.pitch ?? '0') || 0,
            };
        case 'local_sidecar_tts':
            return {
                apiType: 'local_sidecar',
                voiceId: c.voice ?? 'af_heart',
                localSidecarSpeed: c.speed ?? 1.0,
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

    const [activeTranscriptionService, setActiveTranscriptionService] = useConfig('transcription_active_service', 'transkit_cloud_stt');
    const [transcriptionServiceList] = useConfig('transcription_service_list', ['transkit_cloud_stt', 'deepgram_stt']);
    const [sourceLang, setSourceLang] = useConfig('audio_source_lang', 'auto');
    const [targetLang, setTargetLang] = useConfig('audio_target_lang', 'vi');
    const [sourceAudio, setSourceAudio] = useConfig('audio_source', 'system');
    const [fontSize, setFontSize] = useConfig('monitor_font_size', 14);

    // TTS config
    const [activeTtsService, setActiveTtsService] = useConfig('tts_active_service', 'edge_tts');
    const [ttsServiceList] = useConfig('tts_service_list', ['google_tts', 'edge_tts', 'transkit_cloud_tts']);
    const [ttsPlaybackRate] = useConfig('tts_playback_rate', 1);
    const [ttsVolume, setTtsVolume] = useConfig('tts_volume', 1.0);

    // Offline STT translate service
    const [offlineTranslateService] = useConfig('offline_stt_translate_service', 'none');

    // Active AI service (for context generation)
    const [aiServiceList] = useConfig('ai_service_list', ['transkit_cloud_ai']);

    // AI Suggestion config
    const [aiSuggestionService, setAiSuggestionService] = useConfig('monitor_ai_suggestion_service', '');
    const [aiSuggestionContextLines, setAiSuggestionContextLines] = useConfig('monitor_ai_suggestion_context_lines', 10);
    const [aiSuggestionResponseLang, setAiSuggestionResponseLang] = useConfig('monitor_ai_suggestion_response_lang', 'both');
    const [aiSuggestionFontSize, setAiSuggestionFontSize] = useConfig('monitor_ai_suggestion_font_size', 16);
    const [aiSuggestionModes, setAiSuggestionModes] = useConfig('monitor_ai_suggestion_modes', ['suggest_answer']);
    const [showAIPanel, setShowAIPanel] = useState(false);

    // Narration (spoken translation → virtual mic)
    const [narrationEnabled, setNarrationEnabled]     = useConfig('narration_enabled', false);
    const [narrationPttEnabled, setNarrationPttEnabled] = useConfig('narration_ptt_enabled', false);
    const [narrationDeviceName, setNarrationDeviceName] = useConfig('narration_device_name', '');
    const [narrationMonitorAudio, setNarrationMonitorAudio] = useConfig('narration_monitor_audio', false);
    const [narrationPttFabSize, setNarrationPttFabSize] = useConfig('narration_ptt_fab_size', 52);
    const [narrationPttPolishEnabled, setNarrationPttPolishEnabled] = useConfig('narration_ptt_polish_enabled', false);
    const [narrationPttPolishLevel, setNarrationPttPolishLevel] = useConfig('narration_ptt_polish_level', 'mild');
    const [narrationPttPolishPrompt, setNarrationPttPolishPrompt] = useConfig('narration_ptt_polish_prompt', '');
    const [narrationPttPolishService, setNarrationPttPolishService] = useConfig('narration_ptt_polish_service', '');
    const [narrationPttReviewEnabled, setNarrationPttReviewEnabled] = useConfig('narration_ptt_review_enabled', false);
    const [narrationPttTtsSpeed, setNarrationPttTtsSpeed] = useConfig('narration_ptt_tts_speed', 1.0);
    const [cloudIdleWarningMinutes] = useConfig('cloud_idle_warning_minutes', 5);
    const [showNarrationPanel, setShowNarrationPanel] = useState(false);
    const [narrationPttActive, setNarrationPttActive] = useState(false);
    const [narrationDrainActive, setNarrationDrainActive] = useState(false);
    // PTT button drag position — null = default (bottom-right corner)
    const [pttBtnPos, setPttBtnPos] = useState(null);
    const pttDragRef = useRef(null);
    const monitorRootRef = useRef(null);
    const [narrationPendingReview, setNarrationPendingReview] = useState(null);
    const [narrationUsingDictation, setNarrationUsingDictation] = useState(false);
    const [showCloudIdleWarning, setShowCloudIdleWarning] = useState(false);
    const prevSourceAudioRef = useRef(null);
    const pttDrainTimerRef = useRef(null);
    const pttReleaseDeadlineRef = useRef(0);
    const pttRestoreCaptureTimerRef = useRef(null);
    const pttAwaitingTranslationRef = useRef(false);
    const narrationBusyRef = useRef(false);
    // Separate STT client for PTT narration (mirror direction), keeps main client untouched
    const narrationClientRef = useRef(null);
    const narrationClientKeyRef = useRef('');
    const narrationConfigRef = useRef(null); // { serviceName, config }
    const pttActiveRef = useRef(false);
    const pttPressAtRef = useRef(0); // timestamp of last PTT press start (ms)
    const pttPendingRawTextRef = useRef('');
    const narrationEnabledRef = useRef(narrationEnabled);
    const pttReviewEnabledRef = useRef(false);
    const narrationPttTtsSpeedRef = useRef(1.0);
    const cloudIdleWarnTimerRef = useRef(null);
    const aiServiceListRef = useRef([]);

    // ── PTT VA embed ──────────────────────────────────────────────────────────
    // Resolve the effective STT key for PTT: Cloud STT auto-routes to Cloud Dictation
    const narrationSttKey = useMemo(() => {
        if (!activeTranscriptionService) return 'transkit_cloud_stt';
        return getServiceName(activeTranscriptionService) === 'transkit_cloud_stt'
            ? 'transkit_cloud_dictation'
            : activeTranscriptionService;
    }, [activeTranscriptionService]);

    // Resolve the polish prompt for the current level/custom setting
    const pttPolishPromptResolved = useMemo(() => {
        if (!narrationPttPolishEnabled) return '';
        const level = narrationPttPolishLevel ?? 'mild';
        return level === 'custom'
            ? (narrationPttPolishPrompt || DEFAULT_PROMPTS.mild)
            : (DEFAULT_PROMPTS[level] ?? DEFAULT_PROMPTS.mild);
    }, [narrationPttPolishEnabled, narrationPttPolishLevel, narrationPttPolishPrompt]);

    // Called by pttVA once STT + polish are done.
    // Translates PTT text (user spoke in targetLang) → sourceLang for TTS,
    // adds a "Me" entry to the transcript, then routes to review or TTS.
    // nativeOriginal: VI text from the STT's own translation (Soniox/Deepgram/Gladia).
    // When provided, `text` is already EN — no Cloud AI roundtrip needed.
    // When null (offline STT or service without native translation), `text` is VI and we translate.
    const handlePttFinalText = useCallback(async (text, nativeOriginal = null) => {
        pttAwaitingTranslationRef.current = false;
        const pttSourceLang = targetLang;   // language user spoke in (PTT source)
        const pttTargetLang = sourceLang;   // language to translate to (for TTS / transcript)

        let rawText, ttsText;
        if (nativeOriginal) {
            // STT already translated natively — use both fields directly, zero extra AI call
            rawText = nativeOriginal;
            ttsText = text;
        } else {
            rawText = text;
            ttsText = text;
            if (pttTargetLang && pttTargetLang !== 'auto' && pttTargetLang !== pttSourceLang) {
                try {
                    const result = await callCloudAI(
                        [{ role: 'user', content: rawText }],
                        'translate',
                        { source_lang: pttSourceLang, target_lang: pttTargetLang }
                    );
                    ttsText = result?.text || rawText;
                } catch (e) {
                    console.warn('[PTT] translate failed, using raw text:', e);
                }
            }
        }

        if (pttReviewEnabledRef.current) {
            // Defer adding the transcript entry until the user accepts the review
            pttPendingRawTextRef.current = rawText;
            setNarrationPendingReview({ text: ttsText });
        } else {
            const entry = {
                id: `${Date.now()}-${Math.random()}`,
                original: rawText,
                translation: ttsText,
                speaker: 'me',
                isMe: true,
            };
            setEntries(prev => {
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
            getTTSQueue().stop();
            getTTSQueue().enqueue(ttsText, { injectNarration: true, force: true, rateOverride: narrationPttTtsSpeedRef.current });
        }
    }, [sourceLang, targetLang]);

    const pttVA = useVoiceAnywhere({
        sttServiceKey: narrationSttKey,
        monitorSvcKey: narrationSttKey,
        // PTT reverses the language pair: user speaks in targetLang (e.g. VI).
        // Cloud STTs (Soniox, Deepgram…) translate natively and deliver (EN, nativeOriginal=VI)
        // to onFinalText — no extra Cloud AI call needed. Offline STTs fall back to Cloud AI.
        language: targetLang,
        targetLanguage: sourceLang,
        translateServiceKey: 'none',
        polishEnabled: narrationPttPolishEnabled,
        polishPrompt: pttPolishPromptResolved,
        polishServiceKey: narrationPttPolishService,
        noCapture: true,
        noSfx: true,
        onFinalText: handlePttFinalText,
    });

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
    const [normalWindowWidth, setNormalWindowWidth] = useConfig('monitor_window_width', WINDOW_WIDTH);
    const [normalWindowHeight, setNormalWindowHeight] = useConfig('monitor_window_height', NORMAL_HEIGHT);
    const didInitWindowSizeRef = useRef(false);

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

    // Guard against double-start (e.g. rapid double-click before isRunning state updates)
    const isStartingRef = useRef(false);

    // Provider picker modals (status bar)
    const [sttPickerOpen, setSttPickerOpen] = useState(false);
    const [ttsPickerOpen, setTtsPickerOpen] = useState(false);
    const [pickedStt, setPickedStt] = useState(null);
    const [pickedTts, setPickedTts] = useState(null);
    const pendingSvcOverrideRef = useRef(null); // service key to use on next start()

    // ── Guard: activeTranscriptionService must be in the service list ────────
    // If it points to an orphaned/deleted instance (not in list), auto-heal to
    // the first item in the list so Monitor doesn't silently use a dangling key.
    useEffect(() => {
        if (!transcriptionServiceList || transcriptionServiceList.length === 0) return;
        if (!activeTranscriptionService) return;
        if (!transcriptionServiceList.includes(activeTranscriptionService)) {
            setActiveTranscriptionService(transcriptionServiceList[0]);
        }
    }, [transcriptionServiceList]); // eslint-disable-line react-hooks/exhaustive-deps

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

        const applyConfig = async (cfg) => {
            const params = mapServiceConfigToTTSParams(serviceName, cfg);
            if (serviceName === 'local_sidecar_tts') {
                const port = await invoke('local_sidecar_get_port').catch(() => 0) || 0;
                params.serverUrl = `http://127.0.0.1:${port}`;
            }
            getTTSQueue().updateConfig({
                ...params,
                baseRate: ttsPlaybackRate,
                volume: ttsVolume ?? 1.0,
                cloudLang: targetLang,
            });
        };

        store.get(serviceKey).then(applyConfig);

        const eventKey = serviceKey.replaceAll('.', '_').replaceAll('@', ':');
        const unlistenCfg = listen(`${eventKey}_changed`, (e) => applyConfig(e.payload));
        // Re-apply when Local Model server (re)starts — port may have changed
        const unlistenReady = serviceName === 'local_sidecar_tts'
            ? listen('local-sidecar://ready', () => store.get(serviceKey).then(applyConfig))
            : Promise.resolve(() => {});
        return () => {
            unlistenCfg.then(f => f());
            unlistenReady.then(f => f());
        };
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

    // ── Narration: sync enabled flag to TTSQueue + manage stream ─────────────
    // Only active when source = microphone (user's own speech → translate → BlackHole)
    // When source = system audio, TTS is for user to hear others — must NOT go to BlackHole
    const narrationEffectivelyActive =
        narrationPttActive
        || narrationDrainActive
        || (narrationEnabled && sourceAudio === 'microphone')
        // Keep BlackHole stream open whenever PTT is configured so inject_audio
        // never races against narration_start/stop between presses.
        || (narrationPttEnabled && Boolean(narrationDeviceName) && isRunning);
    useEffect(() => {
        const tts = getTTSQueue();
        tts.narrationEnabled = narrationEffectivelyActive;
        tts.muteWhenNarrating = !narrationMonitorAudio;
        if (narrationEffectivelyActive && narrationDeviceName) {
            invoke('narration_start', { deviceName: narrationDeviceName })
                .catch(err => console.error('[Narration] start failed:', err));
        } else {
            invoke('narration_stop').catch(() => {});
        }
    }, [narrationEffectivelyActive, narrationDeviceName, narrationMonitorAudio]);

    const clearPttDrainTimer = useCallback(() => {
        if (pttDrainTimerRef.current) {
            clearTimeout(pttDrainTimerRef.current);
            pttDrainTimerRef.current = null;
        }
    }, []);

    const clearPttRestoreCaptureTimer = useCallback(() => {
        if (pttRestoreCaptureTimerRef.current) {
            clearTimeout(pttRestoreCaptureTimerRef.current);
            pttRestoreCaptureTimerRef.current = null;
        }
    }, []);

    useEffect(() => () => {
        clearPttDrainTimer();
        clearPttRestoreCaptureTimer();
    }, [clearPttDrainTimer, clearPttRestoreCaptureTimer]);

    useEffect(() => {
        narrationBusyRef.current = narrationPttActive || narrationDrainActive;
    }, [narrationPttActive, narrationDrainActive]);

    const handleNarrationSetDevice = useCallback((deviceName) => {
        setNarrationDeviceName(deviceName);
    }, [setNarrationDeviceName]);

    const toggleNarration = useCallback(() => {
        setNarrationEnabled(!narrationEnabled);
    }, [narrationEnabled, setNarrationEnabled]);

    // ── Narration STT client (mirror of monitor language pair) ─────────────────
    const startNarrationClient = useCallback(({ quiet = false } = {}) => {
        const cfg = narrationConfigRef.current;
        if (!cfg) return;
        const reverseSourceLang = targetLang ?? 'vi';
        const reverseTargetLang = sourceLang;
        if (!reverseTargetLang || reverseTargetLang === 'auto') {
            if (!quiet) {
                setErrorMsg(t('monitor.narration_ptt_requires_fixed_source'));
                setTimeout(() => setErrorMsg(''), 5000);
            }
            return false;
        }
        // Auto-route: Cloud STT → Cloud Dictation (on-demand billing for PTT)
        const effectiveServiceName = cfg.serviceName === 'transkit_cloud_stt'
            ? 'transkit_cloud_dictation'
            : cfg.serviceName;
        const service = transcriptionServices[effectiveServiceName];
        if (!service?.createClient) return;
        const nextClientKey = `${effectiveServiceName}|${reverseSourceLang}|${reverseTargetLang}`;

        // Reuse only if still connected — DictationClient closes WS after each session
        if (narrationClientRef.current && narrationClientKeyRef.current === nextClientKey && narrationClientRef.current.isConnected) {
            return true;
        }

        narrationClientRef.current?.disconnect();
        narrationClientRef.current = null;
        narrationClientKeyRef.current = '';
        const client = service.createClient();

        const isDictationClient = effectiveServiceName === 'transkit_cloud_dictation';

        const _enqueuePttFinal = (ttsText, rawText) => {
            if (pttReviewEnabledRef.current) {
                pttPendingRawTextRef.current = rawText || ttsText;
                setNarrationPendingReview({ text: ttsText });
            } else {
                const entry = {
                    id: `${Date.now()}-${Math.random()}`,
                    original: rawText || ttsText,
                    translation: ttsText,
                    speaker: 'me',
                    isMe: true,
                };
                setEntries(prev => {
                    const next = [...prev, entry];
                    return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
                });
                setProvisional('');
                getTTSQueue().stop();
                getTTSQueue().enqueue(ttsText, { injectNarration: true, force: true, rateOverride: narrationPttTtsSpeedRef.current });
            }
        };

        if (isDictationClient) {
            // DictationClient only fires onOriginal (no provider-side translation).
            // Translate the transcript client-side via Cloud AI, then enqueue TTS.
            client.onOriginal = async (text) => {
                pttAwaitingTranslationRef.current = false;
                let ttsText = text;
                if (reverseTargetLang && reverseTargetLang !== reverseSourceLang) {
                    try {
                        const result = await callCloudAI(
                            [{ role: 'user', content: text }],
                            'translate',
                            { source_lang: reverseSourceLang, target_lang: reverseTargetLang }
                        );
                        ttsText = result.text;
                    } catch (e) {
                        console.warn('[Narration PTT] translate failed:', e);
                    }
                }
                _enqueuePttFinal(ttsText, text);
            };
            client.onTranslation = null;
        } else {
            client.onOriginal = (text, speaker) => {
                pendingOriginalRef.current = { text, speaker };
            };
            client.onTranslation = (text) => {
                pttAwaitingTranslationRef.current = false;
                const pending = pendingOriginalRef.current;
                pendingOriginalRef.current = null;
                _enqueuePttFinal(text, pending?.text ?? '');
            };
        }
        client.onProvisional = () => {};
        client.onStatusChange = () => {};
        client.onError = (err) => console.warn('[Narration STT]', err);

        client.connect({
            ...cfg.config,
            sourceLanguage: reverseSourceLang === 'auto' ? null : reverseSourceLang,
            targetLanguage: reverseTargetLang,
        });

        narrationClientRef.current = client;
        narrationClientKeyRef.current = nextClientKey;

        if (effectiveServiceName === 'transkit_cloud_dictation' && cfg.serviceName === 'transkit_cloud_stt') {
            setNarrationUsingDictation(true);
        } else {
            setNarrationUsingDictation(false);
        }

        return true;
    }, [sourceLang, targetLang, t]);

    const waitNarrationClientConnected = useCallback(async (timeoutMs = 6000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (narrationClientRef.current?.isConnected) return true;
            await new Promise(resolve => setTimeout(resolve, 60));
        }
        return !!narrationClientRef.current?.isConnected;
    }, []);

    // ── PTT handlers ─────────────────────────────────────────────────────────
    const restartCaptureWithSource = useCallback(async (source) => {
        if (!isRunning) return true;
        await invoke('stop_audio_capture').catch(() => {});

        const startOnce = () => invoke('start_audio_capture', {
            source,
            batchIntervalMs: batchIntervalRef.current,
        });

        try {
            await startOnce();
            return true;
        } catch (firstErr) {
            // Retry once to avoid transient switch races between cpal streams.
            await new Promise(resolve => setTimeout(resolve, 120));
            try {
                await startOnce();
                return true;
            } catch (secondErr) {
                const message = `[PTT] Failed to switch capture to '${source}': ${String(secondErr || firstErr)}`;
                console.error(message);
                setErrorMsg(message);
                setTimeout(() => setErrorMsg(''), 5000);
                return false;
            }
        }
    }, [isRunning]);

    const handlePttStart = useCallback(async () => {
        if (!narrationPttEnabled || !narrationDeviceName) return;
        // PTT translates to sourceLang — require a fixed source language
        if (!sourceLang || sourceLang === 'auto') {
            setErrorMsg(t('monitor.narration_ptt_requires_fixed_source'));
            setTimeout(() => setErrorMsg(''), 5000);
            return;
        }
        clearPttDrainTimer();
        clearPttRestoreCaptureTimer();
        setNarrationDrainActive(false);
        pttAwaitingTranslationRef.current = false;
        prevSourceAudioRef.current = sourceAudioRef.current;

        // Switch audio capture to microphone if currently on system audio
        if (isRunning && sourceAudioRef.current !== 'microphone') {
            const switched = await restartCaptureWithSource('microphone');
            if (!switched) {
                prevSourceAudioRef.current = null;
                return;
            }
        }

        // Eagerly open the virtual-mic stream before recording starts so the
        // BlackHole output is ready when TTS tries to inject_audio. Without
        // this, the useEffect that drives narration_start is async (runs after
        // render) and short utterances can miss the injection window.
        if (narrationDeviceName) {
            try { await invoke('narration_start', { deviceName: narrationDeviceName }); } catch (_) {}
        }

        pttPressAtRef.current = Date.now();
        pttActiveRef.current = true;
        setNarrationPttActive(true);
        pttVA.startRecording();
    }, [narrationPttEnabled, narrationDeviceName, sourceLang, isRunning, restartCaptureWithSource, pttVA, clearPttDrainTimer, clearPttRestoreCaptureTimer, t]);

    const handlePttEnd = useCallback(async () => {
        // Short tap (< 350 ms) — not a real utterance, show hold hint
        const pressDuration = pttPressAtRef.current > 0 ? Date.now() - pttPressAtRef.current : 999;
        pttPressAtRef.current = 0;
        if (pressDuration < 350) {
            setErrorMsg(t('monitor.ptt_hold_hint', { defaultValue: 'Hold the button to speak' }));
            setTimeout(() => setErrorMsg(''), 2200);
        }

        const prev = prevSourceAudioRef.current;
        setNarrationPttActive(false);
        prevSourceAudioRef.current = null;
        clearPttDrainTimer();
        clearPttRestoreCaptureTimer();
        pttVA.stopRecording();

        // Always keep narration route alive when a device is configured so the full
        // STT → translate → TTS fetch → narration_inject_audio pipeline has time to
        // complete even after the PTT button is released.
        const tts = getTTSQueue();

        if (narrationDeviceName) {
            setNarrationDrainActive(true);
            // Hard cap: 30 s covers STT latency + translation + ElevenLabs synthesis + playback.
            // The drain exits early once TTS finishes AND translation has arrived.
            pttReleaseDeadlineRef.current = Date.now() + 30_000;
            pttAwaitingTranslationRef.current = true;

            const finishWhenDrained = () => {
                const withinHardCap = Date.now() < pttReleaseDeadlineRef.current;
                // Keep alive while:
                //   a) TTS is playing (must finish before tearing down narration route)
                //   b) Translation hasn't arrived yet (up to hard cap)
                if (tts.isPlaying || (pttAwaitingTranslationRef.current && withinHardCap)) {
                    pttDrainTimerRef.current = setTimeout(finishWhenDrained, 160);
                    return;
                }
                pttDrainTimerRef.current = null;
                setNarrationDrainActive(false);
            };

            finishWhenDrained();
        } else {
            pttAwaitingTranslationRef.current = false;
            setNarrationDrainActive(false);
        }

        // Restore audio capture to original source with a short delay so STT can
        // finalize the just-spoken utterance after pointer release.
        if (isRunning && prev && prev !== 'microphone') {
            const releaseAt = Date.now();
            const maxWaitMs = 6000;
            const tryRestoreCapture = () => {
                const waited = Date.now() - releaseAt;
                if (pttAwaitingTranslationRef.current && waited < maxWaitMs) {
                    pttRestoreCaptureTimerRef.current = setTimeout(tryRestoreCapture, 180);
                    return;
                }
                pttRestoreCaptureTimerRef.current = null;
                // Stop routing to narration client before switching capture back to system
                pttActiveRef.current = false;
                restartCaptureWithSource(prev);
            };
            pttRestoreCaptureTimerRef.current = setTimeout(tryRestoreCapture, 2500);
        } else {
            pttActiveRef.current = false;
        }
    }, [isRunning, narrationDeviceName, restartCaptureWithSource, pttVA, clearPttDrainTimer, clearPttRestoreCaptureTimer]);

    const handlePttAcceptReview = useCallback((text) => {
        const rawText = pttPendingRawTextRef.current || text;
        pttPendingRawTextRef.current = '';
        const entry = {
            id: `${Date.now()}-${Math.random()}`,
            original: rawText,
            translation: text,
            speaker: 'me',
            isMe: true,
        };
        setEntries(prev => {
            const next = [...prev, entry];
            return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
        });
        setNarrationPendingReview(null);
        getTTSQueue().enqueue(text, { injectNarration: true, force: true });
    }, []);

    const handlePttDiscardReview = useCallback(() => {
        pttPendingRawTextRef.current = '';
        setNarrationPendingReview(null);
    }, []);

    // ── PTT button drag-to-reposition ────────────────────────────────────────
    const handlePttGripPointerDown = useCallback((e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        const container = monitorRootRef.current;
        if (!container) return;
        const cr = container.getBoundingClientRect();
        const curX = pttBtnPos ? pttBtnPos.x : cr.width - 200;
        const curY = pttBtnPos ? pttBtnPos.y : cr.height - 120;
        pttDragRef.current = { startX: e.clientX, startY: e.clientY, origX: curX, origY: curY, cw: cr.width, ch: cr.height };
    }, [pttBtnPos]);

    const handlePttGripPointerMove = useCallback((e) => {
        const d = pttDragRef.current;
        if (!d) return;
        const newX = Math.max(0, Math.min(d.cw - 180, d.origX + (e.clientX - d.startX)));
        const newY = Math.max(0, Math.min(d.ch - 100, d.origY + (e.clientY - d.startY)));
        setPttBtnPos({ x: newX, y: newY });
    }, []);

    const handlePttGripPointerUp = useCallback(() => {
        pttDragRef.current = null;
    }, []);

    // ── Narration test signal (440 Hz, 1 s) ──────────────────────────────────
    const handleNarrationTestSignal = useCallback(async () => {
        if (!narrationDeviceName) throw new Error('No device configured');
        const wasActive = narrationEffectivelyActive;
        if (!wasActive) {
            await invoke('narration_start', { deviceName: narrationDeviceName });
        }
        const sampleRate = 44100;
        const numSamples = sampleRate; // 1 second
        const pcm16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            pcm16[i] = Math.round(Math.sin(2 * Math.PI * 440 * i / sampleRate) * 16383);
        }
        const bytes = new Uint8Array(pcm16.buffer);
        let bin = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        await invoke('narration_inject_audio', { pcm16Base64: btoa(bin), sampleRate });
        if (!wasActive) {
            setTimeout(() => invoke('narration_stop').catch(() => {}), 1300);
        }
    }, [narrationDeviceName, narrationEffectivelyActive]);

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
    useEffect(() => { narrationEnabledRef.current = narrationEnabled; }, [narrationEnabled]);
    useEffect(() => { pttReviewEnabledRef.current = narrationPttReviewEnabled ?? false; }, [narrationPttReviewEnabled]);
    useEffect(() => { narrationPttTtsSpeedRef.current = narrationPttTtsSpeed ?? 1.0; }, [narrationPttTtsSpeed]);
    useEffect(() => { aiServiceListRef.current = aiServiceList ?? []; }, [aiServiceList]);
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
            const buffer = bytes.buffer;
            if (pttActiveRef.current) {
                // pttVA has its own audio_chunk listener during PTT — block main STT
            } else if (narrationEnabledRef.current && sourceAudioRef.current === 'microphone' && narrationClientRef.current) {
                narrationClientRef.current.sendAudio(buffer);
            } else {
                transcriptionClientRef.current?.client?.sendAudio(buffer);
            }
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
        if (isStartingRef.current) return;
        isStartingRef.current = true;

        const svcKey = pendingSvcOverrideRef.current ?? activeTranscriptionService;
        pendingSvcOverrideRef.current = null;
        const serviceName = getServiceName(svcKey);
        const transcriptionConfig = (await store.get(svcKey)) ?? {};

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
        // transkit_cloud_stt, transkit_cloud_dictation, and local_sidecar_stt handle credentials internally (no API key needed).
        const NO_KEY_SERVICES = ['transkit_cloud_stt', 'transkit_cloud_dictation', 'local_sidecar_stt', 'onnx_stt'];
        if (!NO_KEY_SERVICES.includes(serviceName) && !transcriptionConfig.apiKey && !transcriptionConfig.token) {
            setErrorMsg(t('monitor.no_api_key', {
                service: t('config.service.label'),
                transcription: t('config.service.transcription'),
            }));
            isStartingRef.current = false;
            return;
        }

        const client = getOrCreateTranscriptionClient(serviceName);
        const batchInterval = transcriptionConfig.batchIntervalMs ?? 100;
        batchIntervalRef.current = batchInterval;

        // Store config for narration client (same service + API key, different lang)
        narrationConfigRef.current = { serviceName, config: transcriptionConfig };
        // Only pre-connect narration STT when audio is actually routed to narration
        // right after Start (mic + narration mode). PTT-only flows will connect lazily
        // on first press to avoid creating a second cloud session up front.
        const shouldWarmupNarration = Boolean(narrationDeviceName) && narrationEnabled && sourceAudio === 'microphone';
        if (shouldWarmupNarration) {
            const narrationReady = startNarrationClient({ quiet: true });
            if (narrationReady === false && sourceLang === 'auto') {
                setErrorMsg(t('monitor.narration_ptt_requires_fixed_source'));
                setTimeout(() => setErrorMsg(''), 6000);
            }
        }

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
            const isMicSource = sourceAudioRef.current === 'microphone';
            const entry = {
                id: `${Date.now()}-${Math.random()}`,
                original: pending?.text ?? '',
                translation: text,
                speaker: isMicSource ? 'me' : (pending?.speaker ?? null),
                isMe: isMicSource,
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
            if (!narrationBusyRef.current) {
                getTTSQueue().enqueue(text, { injectNarration: false });
            }
        };
        // Offline STT translate: for ONNX / MLX STT, the engine only transcribes.
        // If the user has configured a translate service, wrap onTranslation to
        // translate the transcript before creating the entry.
        const OFFLINE_STT_SERVICES = ['onnx_stt', 'local_sidecar_stt'];
        if (
            OFFLINE_STT_SERVICES.includes(serviceName) &&
            offlineTranslateService && offlineTranslateService !== 'none' &&
            targetLang && sourceLang !== targetLang
        ) {
            const translateSvcName = getServiceName(offlineTranslateService);
            const translateModule = translateServices[translateSvcName];
            if (translateModule?.translate) {
                const translateCfg = (await store.get(offlineTranslateService)) ?? {};
                const _origOnTranslation = client.onTranslation;
                client.onTranslation = async (text) => {
                    let translated = text;
                    try {
                        let setResultValue = null;
                        const returned = await translateModule.translate(
                            text,
                            sourceLang === 'auto' ? 'auto' : sourceLang,
                            targetLang,
                            { config: translateCfg, setResult: (r) => { setResultValue = r; } }
                        );
                        if (typeof returned === 'string' && returned) {
                            translated = returned;
                        } else if (typeof returned === 'object' && returned?.translation) {
                            translated = returned.translation;
                        } else if (setResultValue !== null) {
                            translated = setResultValue;
                        }
                    } catch (err) {
                        console.warn('[Monitor] Offline STT translate failed:', err);
                    }
                    _origOnTranslation(translated);
                };
            }
        }

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
        isStartingRef.current = false; // state guard (isRunning) takes over from here
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
    }, [activeTranscriptionService, sourceLang, targetLang, sourceAudio, transcriptionContext, autosaveEnabled, narrationEnabled, narrationDeviceName, addAudioChunkListener, getOrCreateTranscriptionClient, startNarrationClient, flushSaveQueue, t]);

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

        pttActiveRef.current = false;
        try { await invoke('stop_audio_capture'); } catch (_) {}
        transcriptionClientRef.current?.client?.disconnect();
        narrationClientRef.current?.disconnect();
        narrationClientRef.current = null;
        narrationClientKeyRef.current = '';
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

    // ── Cloud idle warning: show banner after N idle minutes on Cloud STT ─────
    useEffect(() => {
        if (cloudIdleWarnTimerRef.current) clearTimeout(cloudIdleWarnTimerRef.current);
        if (!isRunning) { setShowCloudIdleWarning(false); return; }
        const isCloud = getServiceName(activeTranscriptionService ?? '') === 'transkit_cloud_stt';
        const warnMs = (cloudIdleWarningMinutes ?? 5) * 60_000;
        if (isCloud && warnMs > 0) {
            cloudIdleWarnTimerRef.current = setTimeout(() => setShowCloudIdleWarning(true), warnMs);
        }
        return () => { if (cloudIdleWarnTimerRef.current) clearTimeout(cloudIdleWarnTimerRef.current); };
    }, [isRunning, activeTranscriptionService, cloudIdleWarningMinutes]);

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

    // ── Provider picker (status bar) ─────────────────────────────────────────
    const openSttPicker = useCallback(() => {
        setPickedStt(activeTranscriptionService);
        setSttPickerOpen(true);
    }, [activeTranscriptionService]);

    const openTtsPicker = useCallback(() => {
        setPickedTts(activeTtsService);
        setTtsPickerOpen(true);
    }, [activeTtsService]);

    const confirmSttSwitch = useCallback(async () => {
        setSttPickerOpen(false);
        if (!pickedStt || pickedStt === activeTranscriptionService) return;
        setActiveTranscriptionService(pickedStt);
        if (isRunning) {
            pendingSvcOverrideRef.current = pickedStt;
            await stop(true);
            start();
        }
    }, [pickedStt, activeTranscriptionService, isRunning, stop, start, setActiveTranscriptionService]);

    const confirmTtsSwitch = useCallback(() => {
        setTtsPickerOpen(false);
        if (!pickedTts || pickedTts === activeTtsService) return;
        setActiveTtsService(pickedTts);
    }, [pickedTts, activeTtsService, setActiveTtsService]);

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

    // Voice Anywhere: inject dictated text into the monitor context panel
    useEffect(() => {
        const unlistenPromise = listen('voice_inject', (event) => {
            const { text, mode } = event.payload ?? {};
            if (!text?.trim()) return;
            setTranscriptionContext((prev) => {
                const current = prev ?? EMPTY_CONTEXT;
                const updated = mode === 'append'
                    ? current.text ? current.text + ' ' + text : text
                    : text;
                return { ...current, text: updated };
            });
        });
        return () => { unlistenPromise.then((f) => f()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleExport = useCallback(async () => {
        if (entries.length === 0) return;
        const header = `# Transcript\n\n**Exported:** ${new Date().toLocaleString()}\n\n---\n\n`;
        const content = header + entries.map(formatEntryMarkdown).join('\n\n');
        const now = new Date();
        const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        const filePath = await saveDialog({
            defaultPath: `transcript_${ts}.md`,
            filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
        if (!filePath) return;
        await writeTextFile(filePath, content);
        setSavedNotification({ path: filePath });
    }, [entries]);

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

    useEffect(() => {
        if (didInitWindowSizeRef.current || isSubMode) return;
        const width = normalWindowWidth ?? WINDOW_WIDTH;
        const height = normalWindowHeight ?? NORMAL_HEIGHT;
        if (!Number.isFinite(width) || !Number.isFinite(height)) return;
        didInitWindowSizeRef.current = true;
        appWindow.setSize(new LogicalSize(width, height)).catch(() => {});
    }, [normalWindowWidth, normalWindowHeight, isSubMode]);

    useEffect(() => {
        const unlistenPromise = appWindow.onResized(async () => {
            if (isSubMode) return;
            try {
                const scale = await appWindow.scaleFactor();
                const physical = await appWindow.innerSize();
                setNormalWindowWidth(Math.round(physical.width / scale));
                setNormalWindowHeight(Math.round(physical.height / scale));
            } catch (_) {}
        });
        return () => { unlistenPromise.then(f => f()); };
    }, [isSubMode, setNormalWindowWidth, setNormalWindowHeight]);

    const toggleSubMode = useCallback(async () => {
        const entering = !isSubMode;
        setIsSubMode(entering);
        try {
            if (entering) {
                // Sub mode is display-only: force-stop any active PTT/narration runtime state.
                pttActiveRef.current = false;
                pttAwaitingTranslationRef.current = false;
                clearPttDrainTimer();
                clearPttRestoreCaptureTimer();
                setNarrationPttActive(false);
                setNarrationDrainActive(false);
                setShowNarrationPanel(false);
                narrationClientRef.current?.disconnect();
                narrationClientRef.current = null;
                invoke('narration_stop').catch(() => {});
                await invoke('set_window_buttons_hidden', { hidden: true });
                await appWindow.setSize(new LogicalSize(subWidth ?? WINDOW_WIDTH, subHeight ?? SUB_MODE_HEIGHT));
                await appWindow.center();
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
                await appWindow.setSize(new LogicalSize(
                    normalWindowWidth ?? WINDOW_WIDTH,
                    normalWindowHeight ?? NORMAL_HEIGHT
                ));
                await appWindow.center();
                await appWindow.setAlwaysOnTop(isPinned);
                await invoke('set_window_buttons_hidden', { hidden: false });
            }
        } catch (e) {
            console.error('Failed to toggle sub mode:', e);
        }
    }, [isSubMode, isPinned, subWidth, subHeight, subX, subY, normalWindowWidth, normalWindowHeight, clearPttDrainTimer, clearPttRestoreCaptureTimer, setSubWidth, setSubHeight, setSubX, setSubY]);

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
            ref={monitorRootRef}
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
                        variant='light'
                        className='h-[26px] w-[26px] min-w-0 bg-transparent'
                        onPress={handleExport}
                        isDisabled={entries.length === 0}
                        title={t('monitor.export_snapshot')}
                    >
                        <MdDownload className='text-[16px] text-default-400' />
                    </Button>
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
                isConnecting={cloudConnecting && isRunning}
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
                showNarrationPanel={showNarrationPanel}
                onToggleNarrationPanel={() => setShowNarrationPanel(v => !v)}
                isNarrationActive={narrationEffectivelyActive}
                showPttButton={false}
                isPttActive={narrationPttActive}
                isPttConfigured={narrationPttEnabled && Boolean(narrationDeviceName)}
                isPttEnabled={Boolean(narrationDeviceName) && narrationPttEnabled && isRunning}
                onPttStart={handlePttStart}
                onPttEnd={handlePttEnd}
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

            {/* Narration Panel overlay */}
            {showNarrationPanel && !isSubMode && (
                <>
                    <div className='absolute inset-0 z-40' onClick={() => setShowNarrationPanel(false)} />
                    <div
                        className='absolute left-2 right-2 z-50 overflow-y-auto rounded-lg border border-content3/40 shadow-xl'
                        style={{ top: '72px', maxHeight: 'calc(100% - 72px)', background: 'hsl(var(--nextui-content2))' }}
                    >
                        <div className='p-3'>
                            <NarrationPanel
                                isNarrationActive={narrationEffectivelyActive}
                                narrationEnabled={narrationEnabled}
                                pttEnabled={narrationPttEnabled}
                                narrationDeviceName={narrationDeviceName ?? ''}
                                onSetDevice={handleNarrationSetDevice}
                                onToggleNarration={toggleNarration}
                                onTogglePttEnabled={() => setNarrationPttEnabled(!narrationPttEnabled)}
                                isPttActive={narrationPttActive}
                                onTestSignal={handleNarrationTestSignal}
                                monitorAudio={narrationMonitorAudio ?? false}
                                onToggleMonitorAudio={() => setNarrationMonitorAudio(!narrationMonitorAudio)}
                                pttFabSize={narrationPttFabSize ?? 52}
                                onSetPttFabSize={setNarrationPttFabSize}
                                pttPolishEnabled={narrationPttPolishEnabled ?? false}
                                onSetPttPolishEnabled={setNarrationPttPolishEnabled}
                                pttPolishLevel={narrationPttPolishLevel ?? 'mild'}
                                onSetPttPolishLevel={setNarrationPttPolishLevel}
                                pttPolishPrompt={narrationPttPolishPrompt ?? ''}
                                onSetPttPolishPrompt={setNarrationPttPolishPrompt}
                                pttPolishService={narrationPttPolishService ?? ''}
                                onSetPttPolishService={setNarrationPttPolishService}
                                pttReviewEnabled={narrationPttReviewEnabled ?? false}
                                onSetPttReviewEnabled={setNarrationPttReviewEnabled}
                                pttTtsSpeed={narrationPttTtsSpeed ?? 1.0}
                                onSetPttTtsSpeed={setNarrationPttTtsSpeed}
                                aiServiceList={aiServiceList ?? []}
                                isUsingCloudDictation={narrationUsingDictation}
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

            {/* Cloud idle warning */}
            {showCloudIdleWarning && (
                <div className='mx-2 mt-1 px-3 py-2 bg-warning/10 border border-warning/20 rounded-lg flex items-start gap-2'>
                    <span className='text-warning-600 dark:text-warning-400 text-[13px] flex-shrink-0 mt-0.5'>⚠</span>
                    <div className='flex-1 min-w-0'>
                        <p className='text-xs text-warning-700 dark:text-warning-400 font-medium'>
                            {t('monitor.cloud_idle_warning_title', { defaultValue: 'Cloud STT running — no activity detected' })}
                        </p>
                        <p className='text-[10px] text-default-500 mt-0.5'>
                            {t('monitor.cloud_idle_warning_hint', { defaultValue: 'Press Stop when not in use to avoid charges.' })}
                        </p>
                    </div>
                    <div className='flex items-center gap-1 flex-shrink-0'>
                        <button
                            onClick={() => { setShowCloudIdleWarning(false); stop(); }}
                            className='text-[10px] font-semibold text-danger hover:opacity-80 transition-opacity px-2 py-1 rounded bg-danger/10 border border-danger/20'
                        >
                            {t('monitor.stop')}
                        </button>
                        <button
                            onClick={() => setShowCloudIdleWarning(false)}
                            className='text-default-400 hover:text-default-600 transition-colors'
                        >
                            <MdClose className='text-[13px]' />
                        </button>
                    </div>
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
                isConnecting={cloudConnecting && isRunning}
                activeTranscriptionService={activeTranscriptionService ?? 'soniox_stt'}
                onSetTranscriptionService={setActiveTranscriptionService}
                transcriptionServiceList={transcriptionServiceList ?? []}
                activeTtsService={activeTtsService ?? 'edge_tts'}
                onSetTtsService={setActiveTtsService}
                ttsServiceList={ttsServiceList ?? []}
                isTTSEnabled={isTTSEnabled}
                aiSuggestionModes={aiSuggestionModes}
            />

            {/* PTT area — centered caption + review overlay + VoiceFab button */}
            {Boolean(narrationDeviceName) && narrationPttEnabled && (() => {
                const fabH = Math.min(Math.max(narrationPttFabSize ?? 52, 36), 88);
                const aboveFabBottom = 40 + fabH + 10;
                const captionVisible = narrationPttActive || pttVA.fabState === 'processing' || pttVA.fabState === 'injecting' || narrationDrainActive;

                return (
                    <>
                        {/* Review overlay */}
                        <NarrationReviewOverlay
                            pending={narrationPendingReview}
                            onAccept={handlePttAcceptReview}
                            onDiscard={handlePttDiscardReview}
                            timeoutSeconds={30}
                            bottomOffset={aboveFabBottom}
                        />

                        {/* Centered caption with animated waves */}
                        <PttCaption
                            fabState={pttVA.fabState}
                            interim={pttVA.finalText || pttVA.interim}
                            visible={captionVisible}
                        />

                        {/* PTT button — draggable within Monitor window */}
                        <div
                            style={pttBtnPos
                                ? { position: 'absolute', left: pttBtnPos.x, top: pttBtnPos.y, zIndex: 30 }
                                : { position: 'absolute', right: 12, bottom: 40, zIndex: 30 }
                            }
                        >
                            {/* Inner column: drag handle + FAB + label all centered */}
                            <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center' }}>
                                {/* Drag handle */}
                                <div
                                    onPointerDown={handlePttGripPointerDown}
                                    onPointerMove={handlePttGripPointerMove}
                                    onPointerUp={handlePttGripPointerUp}
                                    onPointerCancel={handlePttGripPointerUp}
                                    style={{
                                        cursor: 'grab',
                                        width: fabH,
                                        display: 'flex',
                                        justifyContent: 'center',
                                        alignItems: 'center',
                                        height: 12,
                                        borderRadius: '6px 6px 0 0',
                                        background: 'rgba(255,255,255,0.05)',
                                        marginBottom: 2,
                                        touchAction: 'none',
                                        userSelect: 'none',
                                    }}
                                    title={t('monitor.ptt_drag_hint', { defaultValue: 'Drag to reposition' })}
                                >
                                    <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 9, letterSpacing: 3 }}>• • •</span>
                                </div>
                                <VoiceFab
                                    fabState={isRunning
                                        ? (narrationDrainActive && pttVA.fabState === 'idle' ? 'processing' : pttVA.fabState)
                                        : 'idle'}
                                    onPttStart={isRunning ? handlePttStart : undefined}
                                    onPttEnd={isRunning ? handlePttEnd : undefined}
                                    size={fabH}
                                    embeddedMode={true}
                                    holdMode={true}
                                    idleColor='#1e3a5f'
                                />
                                {/* Context label — always blue, reflects current state */}
                                {(() => {
                                    const effectiveFabState = isRunning
                                        ? (narrationDrainActive && pttVA.fabState === 'idle' ? 'processing' : pttVA.fabState)
                                        : 'idle';
                                    const isGenerating = isRunning && narrationDrainActive && pttVA.fabState === 'idle';
                                    const labelText = effectiveFabState === 'listening'
                                        ? t('monitor.narration_ptt_speaking', { defaultValue: 'Speaking…' })
                                        : (effectiveFabState === 'processing' || effectiveFabState === 'injecting')
                                        ? t('monitor.narration_ptt_processing', { defaultValue: 'Processing…' })
                                        : isGenerating
                                        ? t('monitor.narration_ptt_generating', { defaultValue: 'Generating voice…' })
                                        : t('monitor.narration_ptt_hold', { defaultValue: 'Push to Talk' });
                                    return (
                                        <span style={{
                                            marginTop: 5,
                                            fontSize: 9,
                                            fontWeight: 600,
                                            letterSpacing: '0.06em',
                                            textTransform: 'uppercase',
                                            pointerEvents: 'none',
                                            color: 'rgba(59,130,246,0.85)',
                                            whiteSpace: 'nowrap',
                                        }}>
                                            {labelText}
                                        </span>
                                    );
                                })()}
                            </div>
                        </div>
                    </>
                );
            })()}

            {/* ── Bottom status bar ────────────────────────────────────────── */}
            <div className='flex items-center justify-between px-2 h-[22px] border-t border-content2/60 flex-shrink-0 select-none'>
                {/* Left: transcription + TTS provider + cloud countdown */}
                <div className='flex items-center gap-2.5'>
                    {/* Transcription — clickable to switch provider */}
                    <button
                        onClick={openSttPicker}
                        className={`flex items-center gap-1 text-[10px] rounded px-0.5 hover:bg-content2 transition-colors cursor-pointer ${status === 'connected' ? 'text-foreground' : 'text-default-400'}`}
                        title='Switch STT provider'
                    >
                        <MdMic className='text-[11px]' />
                        {_svcLabel(getServiceName(activeTranscriptionService ?? ''))}
                    </button>
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
                    {/* TTS — only when enabled; clickable to switch provider */}
                    {isTTSEnabled && (
                        <button
                            onClick={openTtsPicker}
                            className='flex items-center gap-1 text-[10px] text-default-400 rounded px-0.5 hover:bg-content2 transition-colors cursor-pointer'
                            title='Switch TTS provider'
                        >
                            <span className='text-default-300'>·</span>
                            <MdVolumeUp className='text-[11px]' />
                            {_svcLabel(getServiceName(activeTtsService ?? ''))}
                        </button>
                    )}
                    {/* PTT section */}
                    <button
                        onClick={() => setShowNarrationPanel(true)}
                        className={`flex items-center gap-1 text-[10px] rounded px-0.5 transition-colors cursor-pointer ${
                            narrationPttEnabled
                                ? 'text-warning-600 dark:text-warning-400 hover:bg-warning/10'
                                : 'text-default-400 hover:bg-content2'
                        }`}
                        title={t('monitor.narration_ptt_section', { defaultValue: 'PTT settings' })}
                    >
                        <span className='text-default-300'>·</span>
                        <MdRecordVoiceOver className='text-[11px]' />
                        {t('monitor.narration_ptt_label', { defaultValue: 'PTT' })} ({t('monitor.narration_beta', { defaultValue: 'Beta' })}):{' '}
                        {narrationPttEnabled
                            ? <>
                                {t('monitor.narration_ptt_on', { defaultValue: 'ON' })}
                                {targetLang && targetLang !== 'auto' && sourceLang && sourceLang !== 'auto' && (
                                    <span className='opacity-60 ml-0.5'>
                                        ({targetLang.split('-')[0].toUpperCase()}→{sourceLang.split('-')[0].toUpperCase()})
                                    </span>
                                )}
                              </>
                            : t('monitor.narration_ptt_off', { defaultValue: 'OFF' })}
                    </button>
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

            {/* ── STT Provider picker modal ─────────────────────────────────── */}
            <Modal isOpen={sttPickerOpen} onClose={() => setSttPickerOpen(false)} size='sm'>
                <ModalContent>
                    <ModalHeader className='text-sm font-semibold'>Switch STT Provider</ModalHeader>
                    <ModalBody>
                        <div className='flex flex-col gap-1'>
                            {(transcriptionServiceList ?? []).map(svcKey => (
                                <button
                                    key={svcKey}
                                    onClick={() => setPickedStt(svcKey)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors
                                        ${pickedStt === svcKey ? 'bg-primary/15 text-primary' : 'hover:bg-content2 text-default-700'}`}
                                >
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pickedStt === svcKey ? 'bg-primary' : 'bg-default-300'}`} />
                                    {_svcLabel(getServiceName(svcKey))}
                                    {svcKey === activeTranscriptionService && (
                                        <span className='ml-auto text-[10px] text-default-400'>current</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </ModalBody>
                    <ModalFooter className='gap-2'>
                        <Button size='sm' variant='flat' onPress={() => setSttPickerOpen(false)}>Cancel</Button>
                        <Button size='sm' color='primary' onPress={confirmSttSwitch}>
                            {isRunning ? 'Switch & Restart' : 'Confirm'}
                        </Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>

            {/* ── TTS Provider picker modal ─────────────────────────────────── */}
            <Modal isOpen={ttsPickerOpen} onClose={() => setTtsPickerOpen(false)} size='sm'>
                <ModalContent>
                    <ModalHeader className='text-sm font-semibold'>Switch TTS Provider</ModalHeader>
                    <ModalBody>
                        <div className='flex flex-col gap-1'>
                            {(ttsServiceList ?? []).map(svcKey => (
                                <button
                                    key={svcKey}
                                    onClick={() => setPickedTts(svcKey)}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left transition-colors
                                        ${pickedTts === svcKey ? 'bg-secondary/15 text-secondary' : 'hover:bg-content2 text-default-700'}`}
                                >
                                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pickedTts === svcKey ? 'bg-secondary' : 'bg-default-300'}`} />
                                    {_svcLabel(getServiceName(svcKey))}
                                    {svcKey === activeTtsService && (
                                        <span className='ml-auto text-[10px] text-default-400'>current</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    </ModalBody>
                    <ModalFooter className='gap-2'>
                        <Button size='sm' variant='flat' onPress={() => setTtsPickerOpen(false)}>Cancel</Button>
                        <Button size='sm' color='secondary' onPress={confirmTtsSwitch}>Confirm</Button>
                    </ModalFooter>
                </ModalContent>
            </Modal>
        </div>
    );
}
