import { appWindow, LogicalSize } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import { useTranslation } from 'react-i18next';
import { Button } from '@nextui-org/react';
import { BsPinFill } from 'react-icons/bs';
import { AiFillCloseCircle } from 'react-icons/ai';
import { MdOpenInFull, MdBlurOn, MdVolumeUp, MdVolumeOff } from 'react-icons/md';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useConfig } from '../../hooks';
import { osType } from '../../utils/env';
import MonitorToolbar from './components/MonitorToolbar';
import MonitorLog from './components/MonitorLog';
import { SonioxClient } from './soniox';
import { getTTSQueue } from './tts';

const MAX_ENTRIES = 100;
const SUB_MODE_HEIGHT = 190;   // fits 2 lines at ~44px + hover bar + padding
const NORMAL_HEIGHT = 400;
const CONTEXT_PANEL_HEIGHT = 110;
const WINDOW_WIDTH = 720;
const SUB_FONT_MIN = 6;
const SUB_FONT_MAX = 72;

const CONTEXT_PRESETS = [
    { key: 'meeting',  domain: 'Business meeting, conference call, workplace discussion' },
    { key: 'movie_cn', domain: 'Chinese drama or movie, casual conversational Mandarin' },
    { key: 'movie_en', domain: 'English action or drama movie dialogue' },
    { key: 'tech',     domain: 'Software engineering and technology conference talk' },
    { key: 'medical',  domain: 'Medical and healthcare discussion' },
    { key: 'sport',    domain: 'Sports commentary and game analysis' },
];

function StatusDot({ status }) {
    const colors = {
        connecting: 'bg-yellow-400 animate-pulse',
        connected: 'bg-green-400',
        disconnected: 'bg-default-300',
        error: 'bg-red-400',
    };
    return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[status] ?? colors.disconnected}`} />;
}

let sonioxClientInstance = null;
function getSonioxClient() {
    if (!sonioxClientInstance) sonioxClientInstance = new SonioxClient();
    return sonioxClientInstance;
}

export default function Monitor() {
    const { t } = useTranslation();

    const [apiKey] = useConfig('soniox_api_key', '');
    const [sourceLang, setSourceLang] = useConfig('audio_source_lang', 'auto');
    const [targetLang, setTargetLang] = useConfig('audio_target_lang', 'vi');
    const [sourceAudio, setSourceAudio] = useConfig('audio_source', 'microphone');
    const [fontSize, setFontSize] = useConfig('monitor_font_size', 14);

    // TTS config
    const [ttsServerUrl] = useConfig('tts_server_url', 'http://localhost:8001');
    const [ttsApiType] = useConfig('tts_api_type', 'vieneu_stream');
    const [ttsVoiceId] = useConfig('tts_voice_id', 'NgocHuyen');
    const [ttsModel] = useConfig('tts_model', 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf');
    const [ttsPlaybackRate] = useConfig('tts_playback_rate', 1);
    const [ttsGoogleLang] = useConfig('tts_google_lang', 'vi');
    const [ttsGoogleSpeed] = useConfig('tts_google_speed', 1);
    const [ttsEdgeServerUrl] = useConfig('tts_edge_server_url', 'http://localhost:3099');
    const [ttsEdgeVoice] = useConfig('tts_edge_voice', 'vi-VN-HoaiMyNeural');
    const [ttsEdgeRate] = useConfig('tts_edge_rate', '+0%');
    const [ttsEdgePitch] = useConfig('tts_edge_pitch', '+0Hz');
    const [ttsElevenLabsApiKey] = useConfig('tts_elevenlabs_api_key', '');
    const [ttsElevenLabsVoiceId] = useConfig('tts_elevenlabs_voice_id', 'FTYCiQT21H9XQvhRu0ch');
    const [ttsElevenLabsModelId] = useConfig('tts_elevenlabs_model_id', 'eleven_flash_v2_5');
    const [ttsVolume, setTtsVolume] = useConfig('tts_volume', 1.0);

    // Soniox advanced config
    const [sonioxEndpointDelay] = useConfig('soniox_endpoint_delay_ms', 250);
    const [sonioxSpeakerDiarization] = useConfig('soniox_speaker_diarization', true);
    const [sonioxBatchInterval] = useConfig('soniox_batch_interval_ms', 100);

    // Context panel config (persisted)
    const [contextDomain, setContextDomain] = useConfig('monitor_context_domain', '');
    const [contextTerms, setContextTerms] = useConfig('monitor_context_terms', '');

    // Show/hide original source text (separate defaults for each mode)
    const [showOriginal, setShowOriginal] = useConfig('monitor_show_original', true);
    const [showOriginalSub, setShowOriginalSub] = useConfig('monitor_sub_show_original', false);

    // Background opacity: 100 = fully opaque, lower = transparent + blur
    const [bgOpacity, setBgOpacity] = useConfig('monitor_bg_opacity', 100);
    // Separate font size for submode (default 44 — large enough to read from distance)
    const [subFontSize, setSubFontSize] = useConfig('monitor_sub_font_size', 44);
    // Remember last submode window size so the user's adjustments persist
    const [subWidth, setSubWidth] = useConfig('monitor_sub_width', WINDOW_WIDTH);
    const [subHeight, setSubHeight] = useConfig('monitor_sub_height', SUB_MODE_HEIGHT);
    const [showContextPanel, setShowContextPanel] = useState(false);

    const [isPinned, setIsPinned] = useState(false);
    const [isTTSEnabled, setIsTTSEnabled] = useState(false);
    const [ttsPlayingText, setTtsPlayingText] = useState(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isSubMode, setIsSubMode] = useState(false);
    const [status, setStatus] = useState('disconnected');
    const [entries, setEntries] = useState([]);
    const [provisional, setProvisional] = useState('');
    const [audioCapabilities, setAudioCapabilities] = useState({ system_audio: false, microphone: true });
    const [errorMsg, setErrorMsg] = useState('');

    const pendingOriginalRef = useRef(null);
    const unlistenAudioRef = useRef(null);

    // Sync TTS config whenever settings change
    useEffect(() => {
        getTTSQueue().updateConfig({
            serverUrl: ttsServerUrl,
            apiType: ttsApiType,
            voiceId: ttsVoiceId,
            model: ttsModel,
            baseRate: ttsPlaybackRate,
            volume: ttsVolume ?? 1.0,
            googleLang: ttsGoogleLang,
            googleSpeed: ttsGoogleSpeed,
            edgeServerUrl: ttsEdgeServerUrl,
            edgeVoice: ttsEdgeVoice,
            edgeRate: ttsEdgeRate,
            edgePitch: ttsEdgePitch,
            elevenLabsApiKey: ttsElevenLabsApiKey,
            elevenLabsVoiceId: ttsElevenLabsVoiceId,
            elevenLabsModelId: ttsElevenLabsModelId,
        });
    }, [ttsServerUrl, ttsApiType, ttsVoiceId, ttsModel, ttsPlaybackRate, ttsVolume, ttsGoogleLang, ttsGoogleSpeed, ttsEdgeServerUrl, ttsEdgeVoice, ttsEdgeRate, ttsEdgePitch, ttsElevenLabsApiKey, ttsElevenLabsVoiceId, ttsElevenLabsModelId]);

    // Load audio capabilities
    useEffect(() => {
        invoke('get_audio_capabilities')
            .then(caps => setAudioCapabilities(caps))
            .catch(() => {});
    }, []);

    // If system audio not supported and current source is system, switch to mic
    useEffect(() => {
        if (audioCapabilities && !audioCapabilities.system_audio && sourceAudio === 'system') {
            setSourceAudio('microphone');
        }
    }, [audioCapabilities]);

    // Wire up TTS callbacks + sync enabled state on mount.
    // The enabled sync handles HMR: when tts.js hot-reloads the singleton resets
    // (enabled=false) but React's isTTSEnabled state survives. Without this sync,
    // enqueue() drops all items until the user toggles TTS off+on again.
    useEffect(() => {
        const tts = getTTSQueue();
        tts.onPlayStart = (text) => setTtsPlayingText(text);
        tts.onPlayEnd = () => setTtsPlayingText(null);
        // Sync flag directly — no AudioContext unlock here (outside user gesture).
        // The unlock will happen on next toggle or replay click.
        tts.enabled = isTTSEnabled;
        return () => { tts.onPlayStart = null; tts.onPlayEnd = null; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep tts.enabled in sync whenever the React toggle state changes.
    useEffect(() => {
        const tts = getTTSQueue();
        if (tts.enabled !== isTTSEnabled) {
            if (isTTSEnabled) {
                tts.enabled = true; // toggleTTS already called setEnabled(true) with unlock
            } else {
                tts.stop();         // silence any in-flight audio
                tts.enabled = false;
            }
        }
    }, [isTTSEnabled]);

    // Wire up Soniox callbacks once
    useEffect(() => {
        const client = getSonioxClient();

        client.onOriginal = (text, speaker) => {
            pendingOriginalRef.current = { text, speaker };
        };

        client.onTranslation = (text) => {
            const pending = pendingOriginalRef.current;
            pendingOriginalRef.current = null;
            setEntries(prev => {
                const entry = {
                    id: `${Date.now()}-${Math.random()}`,
                    original: pending?.text ?? '',
                    translation: text,
                    speaker: pending?.speaker ?? null,
                };
                const next = [...prev, entry];
                return next.length > MAX_ENTRIES ? next.slice(-MAX_ENTRIES) : next;
            });
            setProvisional('');
            // Send translation to TTS queue
            getTTSQueue().enqueue(text);
        };

        client.onProvisional = (text) => {
            setProvisional(text || '');
        };

        client.onStatusChange = (s) => setStatus(s);

        client.onError = (msg) => {
            setErrorMsg(msg);
            setTimeout(() => setErrorMsg(''), 5000);
        };
    }, []);

    const sourceAudioRef = useRef(sourceAudio);
    useEffect(() => { sourceAudioRef.current = sourceAudio; }, [sourceAudio]);
    const batchIntervalRef = useRef(sonioxBatchInterval);
    useEffect(() => { batchIntervalRef.current = sonioxBatchInterval; }, [sonioxBatchInterval]);

    const addAudioChunkListener = useCallback(async () => {
        if (unlistenAudioRef.current) {
            unlistenAudioRef.current();
            unlistenAudioRef.current = null;
        }
        const client = getSonioxClient();
        const unlisten = await listen('audio_chunk', (event) => {
            const binary = atob(event.payload);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            client.sendAudio(bytes.buffer);
        });
        unlistenAudioRef.current = unlisten;
    }, []);

    // Wire onReconnect — restart audio capture after Soniox auto-reconnects
    useEffect(() => {
        const client = getSonioxClient();
        client.onReconnect = async () => {
            console.log('[Monitor] Soniox reconnected — restarting audio capture');
            await addAudioChunkListener();
            try {
                await invoke('start_audio_capture', {
                    source: sourceAudioRef.current,
                    batchIntervalMs: batchIntervalRef.current ?? 100,
                });
            } catch (err) {
                setErrorMsg(String(err));
            }
        };
    }, [addAudioChunkListener]);

    const start = useCallback(async () => {
        if (!apiKey) {
            setErrorMsg(t('monitor.no_api_key'));
            return;
        }
        const client = getSonioxClient();
        setIsRunning(true);
        setProvisional('');

        const terms = contextTerms?.trim()
            ? contextTerms.split(',').map(s => s.trim()).filter(Boolean)
            : [];
        const customContext = (contextDomain?.trim() || terms.length > 0)
            ? { domain: contextDomain?.trim() || '', terms }
            : null;

        client.connect({
            apiKey,
            sourceLanguage: sourceLang === 'auto' ? null : sourceLang,
            targetLanguage: targetLang,
            customContext,
            endpointDelayMs: sonioxEndpointDelay ?? 250,
            speakerDiarization: sonioxSpeakerDiarization !== false,
        });

        await addAudioChunkListener();

        try {
            await invoke('start_audio_capture', {
                source: sourceAudio,
                batchIntervalMs: sonioxBatchInterval ?? 100,
            });
        } catch (err) {
            setErrorMsg(String(err));
            setIsRunning(false);
            client.disconnect();
            if (unlistenAudioRef.current) {
                unlistenAudioRef.current();
                unlistenAudioRef.current = null;
            }
        }
    }, [apiKey, sourceLang, targetLang, sourceAudio, contextDomain, contextTerms, sonioxEndpointDelay, sonioxSpeakerDiarization, sonioxBatchInterval, addAudioChunkListener, t]);

    const stop = useCallback(async () => {
        setIsRunning(false);
        try { await invoke('stop_audio_capture'); } catch (_) {}
        getSonioxClient().disconnect();
        if (unlistenAudioRef.current) {
            unlistenAudioRef.current();
            unlistenAudioRef.current = null;
        }
        setProvisional('');
        getTTSQueue().stop();
    }, []);

    const toggleTTS = useCallback(() => {
        const next = !isTTSEnabled;
        setIsTTSEnabled(next);
        getTTSQueue().setEnabled(next);
    }, [isTTSEnabled]);

    const handleReplayEntry = useCallback((text) => {
        if (!isTTSEnabled) setIsTTSEnabled(true);
        // Always sync — handles HMR desync where React state is true but singleton is false.
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

    const toggleContextPanel = useCallback(async () => {
        const next = !showContextPanel;
        setShowContextPanel(next);
        if (!isSubMode) {
            const newH = next ? NORMAL_HEIGHT + CONTEXT_PANEL_HEIGHT : NORMAL_HEIGHT;
            try { await appWindow.setSize(new LogicalSize(WINDOW_WIDTH, newH)); } catch (_) {}
        }
    }, [showContextPanel, isSubMode]);

    const handleClear = useCallback(() => {
        setEntries([]);
        setProvisional('');
    }, []);

    const toggleOriginal = useCallback(() => setShowOriginal(!(showOriginal ?? true)), [showOriginal, setShowOriginal]);
    const toggleOriginalSub = useCallback(() => setShowOriginalSub(!(showOriginalSub ?? false)), [showOriginalSub, setShowOriginalSub]);

    // Also persist submode position so it opens where the user last placed it
    const [subX, setSubX] = useConfig('monitor_sub_x', null);
    const [subY, setSubY] = useConfig('monitor_sub_y', null);

    // ── Sub mode: resize window + hide/show native traffic lights ──
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
                // Snapshot submode geometry NOW (before any resize) — this is the
                // only reliable moment to capture what the user last set.
                try {
                    const scale = await appWindow.scaleFactor();
                    const physical = await appWindow.innerSize();
                    const pos = await appWindow.outerPosition();
                    setSubWidth(Math.round(physical.width / scale));
                    setSubHeight(Math.round(physical.height / scale));
                    setSubX(Math.round(pos.x / scale));
                    setSubY(Math.round(pos.y / scale));
                } catch (_) {}
                // Then restore main window to its fixed default
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
        return () => { stop(); };
    }, []);

    // ── Sub mode layout ──
    const bgAlpha = (bgOpacity ?? 100) / 100;
    // Sub mode always shows a darkened semi-transparent background for readability;
    // bgOpacity scales between 25% (fully transparent setting) and 88% (fully opaque setting).
    const subBgAlpha = 0.25 + bgAlpha * 0.63;

    if (isSubMode) {
        return (
            <div
                className='group w-screen h-screen flex flex-col overflow-hidden rounded-[10px]'
                style={{ background: `rgba(18,18,20,${subBgAlpha.toFixed(2)})`, backdropFilter: bgAlpha < 1 ? 'blur(16px)' : undefined }}
                data-tauri-drag-region='true'
            >
                {/* Top bar — auto-hide, appears on window hover */}
                <div
                    className='absolute top-0 left-0 right-0 h-7 z-10 flex items-center justify-between px-2
                               rounded-t-[10px] border-b border-white/10
                               opacity-0 group-hover:opacity-100 transition-opacity duration-200'
                    style={{ background: 'rgba(18,18,20,0.96)' }}
                    data-tauri-drag-region='true'
                >
                    {/* Left: status + font size */}
                    <div className='flex items-center gap-1'>
                        <div className='pointer-events-none'>
                            <StatusDot status={status} />
                        </div>
                        {/* Font size controls */}
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

                    {/* Right: original toggle, transparent, play/stop, expand */}
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

                {/* Log — fills full height; pointer-events-none keeps drag on root, icons within use pointer-events-auto */}
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

    // ── Normal mode layout ──
    return (
        <div
            className='w-screen h-screen flex flex-col overflow-hidden rounded-[12px] border border-white/[0.08]'
            style={{
                background: bgAlpha >= 1
                    ? 'hsl(var(--nextui-background))'
                    : `hsl(var(--nextui-background) / ${bgAlpha.toFixed(2)})`,
                backdropFilter: bgAlpha < 1 ? 'blur(24px) saturate(1.6)' : undefined,
            }}
        >
            {/* Header — acts as drag region */}
            <div
                className='h-[30px] flex items-center justify-between px-2 z-10 relative select-none'
                data-tauri-drag-region='true'
            >
                {/* Status indicator — far left, pointer-events-none so drag works through it */}
                <div className='flex items-center gap-1.5 pointer-events-none'>
                    <StatusDot status={status} />
                    <span className='text-[11px] text-default-500 font-medium'>
                        {t(`monitor.status_${status}`) || status}
                    </span>
                </div>

                {/* Right: Pin + Close (close only on non-macOS since macOS has traffic lights) */}
                <div className='flex items-center gap-0.5'>
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
                        onPress={() => appWindow.close()}
                    >
                        <AiFillCloseCircle className='text-[16px] text-default-400' />
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
                ttsVolume={ttsVolume ?? 1.0}
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
                onSetTtsVolume={setTtsVolume}
                onToggleContextPanel={toggleContextPanel}
            />

            {/* Context panel */}
            {showContextPanel && (
                <div className='mx-2 mb-1 p-2 bg-content2 rounded-lg border border-content3/30 flex-shrink-0'>
                    {/* Preset topic buttons */}
                    <div className='flex flex-wrap gap-1 mb-1.5'>
                        {CONTEXT_PRESETS.map(preset => (
                            <button
                                key={preset.key}
                                onClick={() => setContextDomain(preset.domain)}
                                className={`px-2 py-0.5 text-[11px] rounded-md border transition-colors ${
                                    contextDomain === preset.domain
                                        ? 'bg-secondary/20 border-secondary/40 text-secondary'
                                        : 'bg-content3/50 border-content3/50 text-default-500 hover:text-default-foreground'
                                }`}
                            >
                                {t(`monitor.ctx_preset_${preset.key}`)}
                            </button>
                        ))}
                    </div>
                    {/* Domain input */}
                    <input
                        value={contextDomain ?? ''}
                        onChange={e => setContextDomain(e.target.value)}
                        placeholder={t('monitor.ctx_domain_placeholder')}
                        className='w-full bg-content1 text-xs rounded-md px-2 py-1 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/50 mb-1'
                    />
                    {/* Terms input */}
                    <input
                        value={contextTerms ?? ''}
                        onChange={e => setContextTerms(e.target.value)}
                        placeholder={t('monitor.ctx_terms_placeholder')}
                        className='w-full bg-content1 text-xs rounded-md px-2 py-1 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/50'
                    />
                </div>
            )}

            {/* Error message */}
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
            />
        </div>
    );
}
