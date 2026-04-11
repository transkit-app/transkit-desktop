import {
    Card, CardBody, CardHeader,
    Button, Switch, Select, SelectItem, Slider, Chip, Checkbox, Input, Progress,
    Tabs, Tab,
} from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/tauri';
import { open as openFileDialog, ask } from '@tauri-apps/api/dialog';
import { listen } from '@tauri-apps/api/event';
import {
    MdMemory, MdPlayArrow, MdStop, MdDownload,
    MdMic, MdRecordVoiceOver, MdWarning, MdCheckCircle, MdError, MdDelete, MdStorage, MdRefresh,
    MdFolderOpen, MdHourglassEmpty,
} from 'react-icons/md';
import React, { useState, useEffect, useRef, useCallback } from 'react';

import { useConfig } from '../../../../hooks/useConfig';
import { store } from '../../../../utils/store';
import { osType } from '../../../../utils/env';

const LLM_MODELS = [
    { key: 'mlx-community/gemma-3-4b-it-qat-4bit',    label: 'Gemma 4B  (recommended, ~3 GB)' },
    { key: 'mlx-community/gemma-3-12b-it-4bit',        label: 'Gemma 12B  (~7 GB)' },
    { key: 'mlx-community/gemma-3-27b-it-4bit',        label: 'Gemma 27B  (~15 GB)' },
    { key: 'mlx-community/Qwen2.5-3B-Instruct-4bit',   label: 'Qwen 2.5 3B  (~2 GB)' },
    { key: 'mlx-community/Qwen2.5-7B-Instruct-4bit',   label: 'Qwen 2.5 7B  (~4 GB)' },
    { key: 'mlx-community/Llama-3.2-3B-Instruct-4bit', label: 'Llama 3.2 3B  (~2 GB)' },
];

const ASR_MODELS = [
    { key: 'mlx-community/whisper-tiny',           label: 'Whisper Tiny  (~39 MB)' },
    { key: 'mlx-community/whisper-base',           label: 'Whisper Base  (~74 MB)' },
    { key: 'mlx-community/whisper-small',          label: 'Whisper Small  (~244 MB)' },
    { key: 'mlx-community/whisper-large-v3-turbo', label: 'Whisper Large-v3-turbo  (~809 MB)' },
    { key: 'mlx-community/whisper-large-v3',       label: 'Whisper Large-v3  (~1.5 GB)' },
    { key: 'custom',                               label: 'Custom HuggingFace model…' },
];

const CHUNK_OPTIONS = [3, 5, 7, 10];
const TTS_VOICES = ['af_heart','af_bella','af_nicole','af_sarah','af_sky','am_adam','am_michael','bf_emma','bf_isabella','bm_george','bm_lewis'];
const TTS_ENGINES = [
    { key: 'kokoro',    label: 'Kokoro',                       pkg: 'kokoro-mlx',  placeholder: 'e.g. prince-canuma/Kokoro-82M' },
    { key: 'mlx_audio', label: 'mlx-audio  (ZipVoice, etc.)', pkg: 'mlx-audio',   placeholder: 'e.g. mlx-community/zipvoice-vietnamese' },
];
const DEFAULT_TTS_PACKAGE = 'kokoro-mlx';

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i >= 2 ? 1 : 0) + ' ' + units[i];
}

const INSTALL_STATE = {
    IDLE:       'idle',
    CHECKING:   'checking',
    CONFIRM:    'confirm',
    INSTALLING: 'installing',
    ERROR:      'error',
    SUCCESS:    'success',
};

export default function LocalSidecar() {
    const { t } = useTranslation();

    // ── Engine selection ───────────────────────────────────────────────────────
    const [activeEngine, setActiveEngine] = useConfig('local_model_engine', null);
    const isMacOS = osType === 'Darwin';
    const effectiveEngine = activeEngine ?? (isMacOS ? 'mlx' : 'onnx');

    // ── MLX state ─────────────────────────────────────────────────────────────
    const [enabled,       setEnabled]       = useConfig('local_sidecar_enabled',           false);
    const [llmModel,      setLlmModel]       = useConfig('local_sidecar_llm_model',         'mlx-community/gemma-3-4b-it-qat-4bit');
    const [asrModel,      setAsrModel]       = useConfig('local_sidecar_asr_model',         'mlx-community/whisper-large-v3-turbo');
    const [customAsrModel, setCustomAsrModel] = useConfig('local_sidecar_custom_asr_model',  '');
    const [asrTask,       setAsrTask]        = useConfig('local_sidecar_asr_task',           'transcribe');
    const [temperature,   setTemperature]    = useConfig('local_sidecar_llm_temperature',   0.3);
    const [maxTokens,     setMaxTokens]      = useConfig('local_sidecar_llm_max_tokens',    512);
    const [chunkSeconds,  setChunkSeconds]   = useConfig('local_sidecar_asr_chunk_seconds', 7);
    const [ttsVoice,      setTtsVoice]       = useConfig('local_sidecar_tts_voice',         'af_heart');
    const [ttsModel,      setTtsModel]       = useConfig('local_sidecar_tts_model',         '');
    const [ttsEngine,     setTtsEngine]      = useConfig('local_sidecar_tts_engine',        'kokoro');
    const [ttsRefAudio,   setTtsRefAudio]    = useConfig('local_sidecar_tts_ref_audio',     '');

    const [setupStatus,   setSetupStatus]    = useState(null);
    const [running,       setRunning]        = useState(false);
    const [runningPort,   setRunningPort]    = useState(0);
    const [setupLog,      setSetupLog]       = useState([]);
    const [setupProgress, setSetupProgress]  = useState(0);
    const [installState,  setInstallState]   = useState(INSTALL_STATE.IDLE);
    const [prereqs,       setPrereqs]        = useState(null);
    const [errorMsg,      setErrorMsg]       = useState('');

    const [modelStatus, setModelStatus] = useState({ llm: 'idle', tts: 'idle', stt: 'idle' });
    const [modelTook,   setModelTook]   = useState({});
    const [modelError,  setModelError]  = useState({});

    const [compLlm,       setCompLlm]        = useState(false);
    const [compStt,       setCompStt]        = useState(true);
    const [compTts,       setCompTts]        = useState(false);
    const [ttsPackage,    setTtsPackage]     = useState(DEFAULT_TTS_PACKAGE);

    useEffect(() => {
        const eng = TTS_ENGINES.find(e => e.key === ttsEngine);
        if (eng) setTtsPackage(eng.pkg);
    }, [ttsEngine]);

    const [cachedModels,   setCachedModels]   = useState(null);
    const [deletingModel,  setDeletingModel]  = useState(null);
    const [restartNeeded,  setRestartNeeded]  = useState(false);

    const [downloadingRepo,   setDownloadingRepo]   = useState(null);
    const [downloadProgress,  setDownloadProgress]  = useState(0);
    const [downloadMessage,   setDownloadMessage]   = useState('');

    const logContainerRef = useRef(null);

    const scrollLogToBottom = useCallback(() => {
        const el = logContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, []);

    // ── ONNX state ─────────────────────────────────────────────────────────────
    const [onnxActiveModel,  setOnnxActiveModel]  = useConfig('onnx_active_model', '');
    const [onnxSetup,        setOnnxSetup]        = useState(null);
    const [onnxEngineStatus, setOnnxEngineStatus] = useState({ running: false, port: 0 });
    const [onnxModels,       setOnnxModels]       = useState([]);
    const [onnxRepoInput,    setOnnxRepoInput]    = useState('csukuangfj2/sherpa-onnx-zipformer-vi-30M-int8-2026-02-09');
    const [onnxInstalling,   setOnnxInstalling]   = useState(false);
    const [onnxInstallProgress, setOnnxInstallProgress] = useState(null);
    const [onnxDownloading,  setOnnxDownloading]  = useState(false);
    const [onnxDownloadProgress, setOnnxDownloadProgress] = useState(null);

    // ── MLX initial load ───────────────────────────────────────────────────────
    useEffect(() => {
        invoke('local_sidecar_check_setup').then((s) => {
            setSetupStatus(s);
            if (s?.components?.length) {
                setCompLlm(s.components.includes('llm'));
                setCompStt(s.components.includes('stt'));
                setCompTts(s.components.includes('tts'));
            }
        }).catch(console.error);
        invoke('local_sidecar_status').then((s) => {
            setRunning(s.running);
            setRunningPort(s.port);
        }).catch(console.error);
        invoke('local_sidecar_list_cached_models').then(setCachedModels).catch(() => setCachedModels([]));
    }, []);

    // ── ONNX initial load ──────────────────────────────────────────────────────
    useEffect(() => {
        invoke('onnx_engine_check_setup').then(setOnnxSetup).catch(() => {});
        invoke('onnx_engine_status').then(setOnnxEngineStatus).catch(() => {});
        invoke('onnx_model_list').then(setOnnxModels).catch(() => {});
    }, []);

    // ── MLX event listeners ────────────────────────────────────────────────────
    useEffect(() => {
        const listeners = [];

        listen('local-sidecar://ready', (e) => {
            const port = e.payload?.port ?? 0;
            setRunning(true);
            setRunningPort(port);
            store.set('local_sidecar_port', port).then(() => store.save()).catch(() => {});
        }).then((fn) => listeners.push(fn)).catch(console.error);

        listen('local-sidecar://stopped', () => {
            setRunning(false);
            setRunningPort(0);
            setModelStatus({ llm: 'idle', tts: 'idle', stt: 'idle' });
            setModelTook({});
            setModelError({});
        }).then((fn) => listeners.push(fn)).catch(console.error);

        listen('local-sidecar://model-status', (e) => {
            const p = e.payload;
            if (!p?.component) return;
            const comp = p.component;
            if (p.type === 'model_loading') {
                setModelStatus(prev => ({ ...prev, [comp]: 'loading' }));
            } else if (p.type === 'model_ready') {
                setModelStatus(prev => ({ ...prev, [comp]: 'ready' }));
                if (p.took_s != null) setModelTook(prev => ({ ...prev, [comp]: p.took_s }));
            } else if (p.type === 'model_error') {
                setModelStatus(prev => ({ ...prev, [comp]: 'error' }));
                if (p.error) setModelError(prev => ({ ...prev, [comp]: p.error }));
            }
        }).then((fn) => listeners.push(fn)).catch(console.error);

        listen('local-sidecar://download-progress', (e) => {
            const p = e.payload;
            if (!p) return;
            if (p.type === 'progress') {
                if (p.percent >= 0) setDownloadProgress(p.percent);
                if (p.message)      setDownloadMessage(p.message);
            } else if (p.type === 'status') {
                if (p.message) setDownloadMessage(p.message);
            } else if (p.type === 'done') {
                setDownloadProgress(100);
                setDownloadingRepo(null);
                setDownloadMessage('');
                invoke('local_sidecar_list_cached_models').then(setCachedModels).catch(() => {});
            } else if (p.type === 'error') {
                setDownloadingRepo(null);
                setDownloadMessage('');
            }
        }).then((fn) => listeners.push(fn)).catch(console.error);

        listen('local-sidecar://setup-progress', (e) => {
            const p = e.payload;
            if (!p) return;
            if (p.message) setSetupLog((prev) => [...prev, p.message]);
            if (p.percent != null) setSetupProgress(p.percent);
            if (p.type === 'done') {
                setInstallState(INSTALL_STATE.SUCCESS);
                setSetupProgress(100);
                invoke('local_sidecar_check_setup').then(setSetupStatus).catch(console.error);
            }
            if (p.type === 'error') {
                const msg = p.message || 'Unknown error';
                setErrorMsg(msg);
                setInstallState(INSTALL_STATE.ERROR);
                setSetupLog((prev) => [...prev, 'Error: ' + msg]);
            }
        }).then((fn) => listeners.push(fn)).catch(console.error);

        return () => { listeners.forEach((fn) => fn()); };
    }, []);

    // ── ONNX event listeners ───────────────────────────────────────────────────
    useEffect(() => {
        const listeners = [];

        listen('onnx-engine://setup-progress', (e) => {
            const payload = e.payload;
            if (payload.type === 'done') {
                setOnnxInstalling(false);
                setOnnxInstallProgress(null);
                invoke('onnx_engine_check_setup').then(setOnnxSetup).catch(() => {});
            } else if (payload.type === 'error') {
                setOnnxInstalling(false);
                setOnnxInstallProgress({ message: `Error: ${payload.message}`, percent: 0, error: true });
            } else {
                setOnnxInstallProgress({ message: payload.message, percent: payload.percent ?? 0 });
            }
        }).then(fn => listeners.push(fn)).catch(() => {});

        listen('onnx-engine://ready', (e) => {
            setOnnxEngineStatus({ running: true, port: e.payload.port });
        }).then(fn => listeners.push(fn)).catch(() => {});

        listen('onnx-engine://stopped', () => {
            setOnnxEngineStatus({ running: false, port: 0 });
        }).then(fn => listeners.push(fn)).catch(() => {});

        listen('onnx-model://progress', (e) => {
            const payload = e.payload;
            if (payload.step === 'done') {
                setOnnxDownloading(false);
                setOnnxDownloadProgress(null);
                invoke('onnx_model_list').then(setOnnxModels).catch(() => {});
            } else if (payload.step === 'error') {
                setOnnxDownloading(false);
                setOnnxDownloadProgress({ message: `Error: ${payload.message}`, percent: 0, error: true });
            } else {
                setOnnxDownloadProgress({ message: payload.message, percent: payload.percent ?? 0 });
            }
        }).then(fn => listeners.push(fn)).catch(() => {});

        return () => { listeners.forEach(fn => fn()); };
    }, []);

    useEffect(() => { scrollLogToBottom(); }, [setupLog, scrollLogToBottom]);

    // ── MLX helpers ────────────────────────────────────────────────────────────
    const isModelCached = useCallback((repoId) =>
        repoId && cachedModels?.some(m => m.repo_id === repoId), [cachedModels]);

    const handleDownloadModel = useCallback(async (repoId) => {
        if (!repoId) return;
        setDownloadingRepo(repoId);
        setDownloadProgress(0);
        setDownloadMessage('');
        invoke('local_sidecar_download_model', { repoId }).catch((e) => {
            setDownloadingRepo(null);
            setDownloadMessage('');
            console.error('[Download] failed to start:', e);
        });
    }, []);

    const renderDownloadBtn = useCallback((repoId) => {
        if (!setupStatus?.ready || !repoId) return null;
        const cached      = isModelCached(repoId);
        const downloading = downloadingRepo === repoId;
        const busy        = !!downloadingRepo && downloadingRepo !== repoId;
        if (cached) {
            return (
                <Button size='sm' color='success' variant='flat' isDisabled startContent={<MdCheckCircle />}>
                    {t('config.local_sidecar.model.downloaded', { defaultValue: 'Downloaded' })}
                </Button>
            );
        }
        if (downloading) {
            return (
                <div className='flex flex-col gap-0.5 min-w-[130px]'>
                    <Button size='sm' color='primary' variant='flat' isLoading>
                        {downloadProgress > 0 ? `${downloadProgress}%` : '…'}
                    </Button>
                    {downloadMessage && (
                        <p className='text-[10px] text-default-400 truncate max-w-[160px]'>{downloadMessage}</p>
                    )}
                </div>
            );
        }
        return (
            <Button size='sm' color='primary' variant='flat' isDisabled={busy}
                startContent={<MdDownload />}
                onPress={() => handleDownloadModel(repoId)}>
                {t('config.local_sidecar.model.download', { defaultValue: 'Download' })}
            </Button>
        );
    }, [setupStatus, isModelCached, downloadingRepo, downloadProgress, downloadMessage, handleDownloadModel, t]);

    const buildConfig = useCallback(() => ({
        llmModel:          llmModel  ?? 'mlx-community/gemma-3-4b-it-qat-4bit',
        asrModel:          asrModel  ?? 'mlx-community/whisper-large-v3-turbo',
        llmTemperature:    temperature ?? 0.3,
        llmMaxTokens:      maxTokens  ?? 512,
        asrChunkSeconds:   chunkSeconds ?? 7,
        asrStrideSeconds:  5,
        asrTask:           asrTask ?? 'transcribe',
        ttsEngine:         ttsEngine ?? 'kokoro',
        ttsModel:          ttsModel ?? '',
        ttsRefAudio:       ttsRefAudio ?? '',
        logLevel:          'info',
        enabledComponents: [compLlm && 'llm', compStt && 'stt', compTts && 'tts'].filter(Boolean).join(','),
    }), [llmModel, asrModel, asrTask, temperature, maxTokens, chunkSeconds, ttsEngine, ttsModel, ttsRefAudio, compLlm, compStt, compTts]);

    const buildComponentArgs = useCallback(() => {
        const parts = [];
        if (compLlm) parts.push('llm');
        if (compStt) parts.push('stt');
        if (compTts) parts.push('tts');
        return { components: parts.join(','), ttsPackage: compTts ? (ttsPackage.trim() || '') : '' };
    }, [compLlm, compStt, compTts, ttsPackage]);

    const handleInstallClick = useCallback(async () => {
        if (!compLlm && !compStt && !compTts) return;
        setInstallState(INSTALL_STATE.CHECKING);
        setErrorMsg('');
        setSetupLog([]);
        setSetupProgress(0);
        try {
            const result = await invoke('local_sidecar_check_prereqs');
            setPrereqs(result);
            setInstallState(INSTALL_STATE.CONFIRM);
        } catch (e) {
            setErrorMsg(String(e));
            setInstallState(INSTALL_STATE.ERROR);
        }
    }, [compLlm, compStt, compTts]);

    const handleConfirmInstall = useCallback(() => {
        const { components, ttsPackage: tpkg } = buildComponentArgs();
        setInstallState(INSTALL_STATE.INSTALLING);
        setSetupLog([]);
        setSetupProgress(0);
        invoke('local_sidecar_run_setup', { components, ttsPackage: tpkg }).catch((e) => {
            setErrorMsg(String(e));
            setInstallState(INSTALL_STATE.ERROR);
            setSetupLog((prev) => [...prev, 'Error: ' + String(e)]);
        });
    }, [buildComponentArgs]);

    const handleCancelConfirm = useCallback(() => {
        setInstallState(INSTALL_STATE.IDLE);
        setPrereqs(null);
    }, []);

    const loadCachedModels = useCallback(() => {
        invoke('local_sidecar_list_cached_models').then(setCachedModels).catch(() => setCachedModels([]));
    }, []);

    const handleDeleteModel = useCallback(async (repoId) => {
        const confirmed = await ask(
            `Delete "${repoId}" from cache?\nThis will free up disk space but cannot be undone.`,
            { title: 'Delete Cached Model', type: 'warning' }
        );
        if (!confirmed) return;
        setDeletingModel(repoId);
        try {
            await invoke('local_sidecar_delete_cached_model', { repoId });
            loadCachedModels();
        } catch (e) {
            console.error('Delete model failed:', e);
        } finally {
            setDeletingModel(null);
        }
    }, [loadCachedModels]);

    const handleRetry = useCallback(() => {
        setInstallState(INSTALL_STATE.IDLE);
        setErrorMsg('');
        setSetupLog([]);
        setPrereqs(null);
    }, []);

    const handleStart = useCallback(() => {
        setRestartNeeded(false);
        invoke('local_sidecar_start', { config: buildConfig() }).catch(console.error);
    }, [buildConfig]);

    const handleRestart = useCallback(() => {
        invoke('local_sidecar_stop').catch(() => {});
        setTimeout(() => {
            setRestartNeeded(false);
            invoke('local_sidecar_start', { config: buildConfig() }).catch(console.error);
        }, 800);
    }, [buildConfig]);

    const handleStop = useCallback(() => {
        invoke('local_sidecar_stop').catch(console.error);
        store.set('local_sidecar_port', 0).then(() => store.save()).catch(() => {});
    }, []);

    const handleEnabledChange = useCallback((value) => {
        setEnabled(value);
        if (value && setupStatus?.ready) handleStart();
        else if (!value) handleStop();
    }, [setEnabled, setupStatus, handleStart, handleStop]);

    const isInstalling = installState === INSTALL_STATE.INSTALLING;
    const nothingSelected = !compLlm && !compStt && !compTts;

    // ── ONNX handlers ──────────────────────────────────────────────────────────
    const handleOnnxInstall = async () => {
        setOnnxInstalling(true);
        setOnnxInstallProgress({ message: 'Starting installation...', percent: 0 });
        try {
            await invoke('onnx_engine_install');
        } catch (err) {
            setOnnxInstalling(false);
            setOnnxInstallProgress({ message: `Failed: ${err}`, percent: 0, error: true });
        }
    };

    const handleOnnxStart = async () => {
        try {
            await invoke('onnx_engine_start', {
                config: { asr_model: onnxActiveModel || undefined }
            });
            invoke('onnx_engine_status').then(setOnnxEngineStatus).catch(() => {});
        } catch (err) {
            console.error('[OnnxSTT] Start failed:', err);
        }
    };

    const handleOnnxStop = async () => {
        try {
            await invoke('onnx_engine_stop');
            invoke('onnx_engine_status').then(setOnnxEngineStatus).catch(() => {});
        } catch (err) {
            console.error('[OnnxSTT] Stop failed:', err);
        }
    };

    const handleOnnxDownload = async () => {
        const r = onnxRepoInput.trim();
        if (!r) return;
        setOnnxDownloading(true);
        setOnnxDownloadProgress({ message: `Starting download of ${r}...`, percent: 0 });
        try {
            await invoke('onnx_model_download', { repo: r });
        } catch (err) {
            setOnnxDownloading(false);
            setOnnxDownloadProgress({ message: `Failed: ${err}`, percent: 0, error: true });
        }
    };

    const handleOnnxDelete = async (repoId) => {
        try {
            await invoke('onnx_model_delete', { repo: repoId });
            invoke('onnx_model_list').then(setOnnxModels).catch(() => {});
        } catch (err) {
            console.error('[OnnxSTT] Delete failed:', err);
        }
    };

    // ── Prereq confirmation (MLX) ──────────────────────────────────────────────
    const renderConfirm = () => {
        if (!prereqs) return null;
        const canInstall = prereqs.python_found || prereqs.homebrew_found;
        const { components, ttsPackage: tpkg } = buildComponentArgs();
        const componentLabels = {
            llm: 'Translate & AI (mlx-lm, ~2 GB)',
            stt: 'Speech Recognition (mlx-whisper, ~800 MB)',
            tts: 'Text to Speech (' + (tpkg || 'skipped') + ')',
        };
        const selectedComps = components.split(',').filter(Boolean);

        return (
            <div className='flex flex-col gap-3 p-3 bg-content2 rounded-lg text-sm'>
                <p className='font-medium text-sm'>
                    {t('config.local_sidecar.setup.confirm_title', { defaultValue: 'The following will be installed:' })}
                </p>
                <ul className='flex flex-col gap-1.5 text-xs'>
                    {prereqs.python_found ? (
                        <li className='flex items-center gap-2 text-success-600'>
                            <MdCheckCircle className='shrink-0' />
                            Python {prereqs.python_version} — {prereqs.python_path}
                        </li>
                    ) : prereqs.homebrew_found ? (
                        <li className='flex items-center gap-2 text-warning-600'>
                            <MdWarning className='shrink-0' />
                            {t('config.local_sidecar.setup.python_missing_brew', {
                                defaultValue: 'Python 3.10+ not found — will auto-install via Homebrew',
                            })}
                        </li>
                    ) : (
                        <li className='flex items-center gap-2 text-danger-600'>
                            <MdError className='shrink-0' />
                            {t('config.local_sidecar.setup.python_missing_no_brew', {
                                defaultValue: 'Python 3.10+ not found and Homebrew is not installed. Run: brew install python3',
                            })}
                        </li>
                    )}
                    {selectedComps.map((c) => (
                        <li key={c} className='flex items-center gap-2 text-default-500'>
                            <MdCheckCircle className='shrink-0 text-default-400' />
                            {componentLabels[c] || c}
                        </li>
                    ))}
                    <li className='flex items-center gap-2 text-default-500'>
                        <MdCheckCircle className='shrink-0 text-default-400' />
                        Core: numpy, fastapi, uvicorn, websockets
                    </li>
                </ul>
                {!canInstall && (
                    <p className='text-xs text-danger-600 font-medium'>
                        {t('config.local_sidecar.setup.install_blocked', {
                            defaultValue: 'Cannot proceed without Python 3.10+. Install Homebrew first, then run: brew install python3',
                        })}
                    </p>
                )}
                <div className='flex gap-2 mt-1'>
                    <Button size='sm' color='primary' onPress={handleConfirmInstall} isDisabled={!canInstall}>
                        {t('config.local_sidecar.setup.confirm_button', { defaultValue: 'Confirm & Install' })}
                    </Button>
                    <Button size='sm' variant='flat' onPress={handleCancelConfirm}>
                        {t('config.local_sidecar.setup.cancel_button', { defaultValue: 'Cancel' })}
                    </Button>
                </div>
            </div>
        );
    };

    // ── ONNX Panel ─────────────────────────────────────────────────────────────
    const renderONNXPanel = () => (
        <>
            {/* ONNX Environment */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdDownload className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.setup.title', { defaultValue: 'Environment' })}
                    </h3>
                    {onnxSetup && (
                        <Chip size='sm' color={onnxSetup.ready ? 'success' : 'warning'} variant='flat' className='ml-auto'>
                            {onnxSetup.ready
                                ? t('config.local_sidecar.setup.ready', { defaultValue: 'Ready' })
                                : t('config.local_sidecar.setup.not_installed', { defaultValue: 'Not installed' })}
                        </Chip>
                    )}
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                        onnxSetup?.ready
                            ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                            : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
                    }`}>
                        {onnxSetup?.ready
                            ? <MdCheckCircle className='text-lg flex-shrink-0' />
                            : <MdHourglassEmpty className='text-lg flex-shrink-0' />}
                        <div className='flex flex-col gap-0.5 min-w-0'>
                            <span className='font-medium'>
                                {onnxSetup?.ready
                                    ? t('config.onnx_stt.engine.ready', { defaultValue: 'ONNX engine installed' })
                                    : t('config.onnx_stt.engine.not_installed', { defaultValue: 'ONNX engine not installed' })}
                            </span>
                            {onnxSetup?.platform && (
                                <span className='text-xs opacity-70'>
                                    {onnxSetup.platform === 'macos_mlx_venv'
                                        ? t('config.onnx_stt.engine.platform_sidecar', { defaultValue: 'Uses shared sidecar venv' })
                                        : onnxSetup.platform}
                                </span>
                            )}
                        </div>
                    </div>

                    {!onnxSetup?.ready && !onnxInstalling && (
                        <Button size='sm' color='warning' variant='flat' onPress={handleOnnxInstall} className='self-start'>
                            {t('config.onnx_stt.engine.install', { defaultValue: 'Install Engine' })}
                        </Button>
                    )}

                    {onnxInstallProgress && (
                        <div className='flex flex-col gap-1'>
                            <p className={`text-xs ${onnxInstallProgress.error ? 'text-danger-500' : 'text-default-500'}`}>
                                {onnxInstallProgress.message}
                            </p>
                            {!onnxInstallProgress.error && (
                                <Progress size='sm' value={onnxInstallProgress.percent} color='primary' aria-label='Install progress' />
                            )}
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* ONNX Server */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdPlayArrow className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.onnx_stt.server.title', { defaultValue: 'ONNX Server' })}
                    </h3>
                    <Chip size='sm' color={onnxEngineStatus.running ? 'success' : 'default'} variant='flat' className='ml-auto'>
                        {onnxEngineStatus.running
                            ? t('config.local_sidecar.startup.status_running', { defaultValue: 'Running' })
                            : t('config.local_sidecar.startup.status_stopped', { defaultValue: 'Stopped' })}
                    </Chip>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    {onnxEngineStatus.running && (
                        <p className='text-xs text-default-400'>
                            {t('config.onnx_stt.server.running', { defaultValue: 'Running on port {{port}}', port: onnxEngineStatus.port })}
                        </p>
                    )}

                    {/* Default model for server */}
                    <div className='flex flex-col gap-1'>
                        {onnxModels.length > 0 ? (
                            <Select
                                label={t('config.onnx_stt.model.active', { defaultValue: 'Default model' })}
                                labelPlacement='outside'
                                variant='bordered'
                                classNames={{ label: 'text-xs text-default-500 pb-1' }}
                                selectedKeys={onnxActiveModel ? [onnxActiveModel] : []}
                                onSelectionChange={keys => {
                                    const v = Array.from(keys)[0];
                                    if (v) setOnnxActiveModel(String(v));
                                }}
                            >
                                {onnxModels.map(m => (
                                    <SelectItem key={m.repo_id} textValue={m.repo_id}>
                                        <span className='font-mono text-xs'>{m.repo_id}</span>
                                    </SelectItem>
                                ))}
                            </Select>
                        ) : (
                            <Input
                                label={t('config.onnx_stt.model.active', { defaultValue: 'Default model' })}
                                labelPlacement='outside'
                                placeholder='e.g. csukuangfj2/sherpa-onnx-zipformer-vi-30M-int8-2026-02-09'
                                variant='bordered'
                                classNames={{ label: 'text-xs text-default-500 pb-1' }}
                                value={onnxActiveModel ?? ''}
                                onValueChange={setOnnxActiveModel}
                            />
                        )}
                        <p className='text-xs text-default-400'>
                            {t('config.onnx_stt.model.active_hint', { defaultValue: 'Model loaded at server startup (each service instance can override this)' })}
                        </p>
                    </div>

                    {onnxSetup?.ready && onnxModels.length === 0 && !onnxEngineStatus.running && (
                        <div className='flex items-start gap-2 p-2.5 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400 text-xs'>
                            <MdWarning className='text-base flex-shrink-0 mt-0.5' />
                            <span>{t('config.onnx_stt.server.no_model_warning', { defaultValue: 'No model downloaded yet. Download a model in the Models section below before starting the server.' })}</span>
                        </div>
                    )}
                    <div className='flex gap-2'>
                        <Button size='sm' color='primary' variant='flat'
                            isDisabled={!onnxSetup?.ready || onnxEngineStatus.running || onnxModels.length === 0}
                            startContent={<MdPlayArrow />}
                            onPress={handleOnnxStart}>
                            {t('config.local_sidecar.startup.start', { defaultValue: 'Start' })}
                        </Button>
                        <Button size='sm' color='danger' variant='flat'
                            isDisabled={!onnxEngineStatus.running}
                            startContent={<MdStop />}
                            onPress={handleOnnxStop}>
                            {t('config.local_sidecar.startup.stop', { defaultValue: 'Stop' })}
                        </Button>
                    </div>
                </CardBody>
            </Card>

            {/* ONNX Models */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdStorage className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.onnx_stt.model.download_title', { defaultValue: 'Models' })}
                    </h3>
                    <Button size='sm' variant='light' isIconOnly className='ml-auto'
                        onPress={() => invoke('onnx_model_list').then(setOnnxModels).catch(() => {})}
                        title='Refresh'>
                        <MdRefresh className='text-base' />
                    </Button>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    {/* Download input */}
                    <div className='flex items-end gap-2'>
                        <Input
                            label={t('config.onnx_stt.model.download_title', { defaultValue: 'Download from HuggingFace' })}
                            labelPlacement='outside'
                            placeholder='csukuangfj2/sherpa-onnx-zipformer-vi-30M-int8-2026-02-09'
                            variant='bordered'
                            className='flex-1'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            value={onnxRepoInput}
                            onValueChange={setOnnxRepoInput}
                            isDisabled={onnxDownloading}
                        />
                        <Button
                            color='primary' variant='flat'
                            startContent={<MdDownload />}
                            onPress={handleOnnxDownload}
                            isLoading={onnxDownloading}
                            isDisabled={!onnxRepoInput.trim() || onnxDownloading}
                            className='h-10'
                        >
                            {t('config.onnx_stt.model.download_btn', { defaultValue: 'Download' })}
                        </Button>
                    </div>
                    <p className='text-xs text-default-400'>
                        {t('config.onnx_stt.model.download_hint', { defaultValue: 'Enter a HuggingFace repo ID for a sherpa-onnx compatible Zipformer model.' })}
                    </p>

                    {onnxDownloadProgress && (
                        <div className='flex flex-col gap-1'>
                            <p className={`text-xs ${onnxDownloadProgress.error ? 'text-danger-500' : 'text-default-500'}`}>
                                {onnxDownloadProgress.message}
                            </p>
                            {!onnxDownloadProgress.error && (
                                <Progress size='sm' value={onnxDownloadProgress.percent} color='primary' aria-label='Download progress' />
                            )}
                        </div>
                    )}

                    {/* Downloaded models list */}
                    {onnxModels.length > 0 && (
                        <div className='flex flex-col gap-2 mt-1'>
                            <p className='text-xs font-medium text-default-500'>
                                {t('config.onnx_stt.model.downloaded', { defaultValue: 'Downloaded models' })}
                            </p>
                            <div className='flex flex-col gap-1'>
                                {onnxModels.map(model => (
                                    <div key={model.repo_id}
                                        className='flex items-center justify-between px-3 py-2 rounded-lg bg-content2 text-sm group'>
                                        <div className='flex flex-col min-w-0'>
                                            <span className='font-mono text-xs truncate'>{model.repo_id}</span>
                                            <span className='text-xs text-default-400'>
                                                {formatBytes(model.size_bytes)}
                                                {(!model.has_encoder || !model.has_tokens || (!model.is_ctc && (!model.has_decoder || !model.has_joiner))) && (
                                                    <span className='text-warning-500 ml-1'>
                                                        {t('config.onnx_stt.model.incomplete', { defaultValue: '(incomplete)' })}
                                                    </span>
                                                )}
                                            </span>
                                        </div>
                                        <Button size='sm' variant='light' color='danger' isIconOnly
                                            onPress={() => handleOnnxDelete(model.repo_id)}
                                            className='opacity-0 group-hover:opacity-100 transition-opacity'
                                            title={t('common.delete', { defaultValue: 'Delete' })}>
                                            <MdDelete className='text-base' />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {onnxModels.length === 0 && (
                        <p className='text-xs text-default-400'>
                            {t('config.local_sidecar.cache.empty', { defaultValue: 'No models downloaded yet.' })}
                        </p>
                    )}
                </CardBody>
            </Card>

            {/* Usage hint */}
            <div className='flex items-start gap-2 p-3 rounded-lg bg-content2 text-xs text-default-500'>
                <MdSettings className='flex-shrink-0 text-sm mt-0.5' />
                <span>{t('config.onnx_stt.usage_hint', { defaultValue: 'To use ONNX speech recognition, go to Settings → Services → Transcription and add an "Offline STT (ONNX)" service instance.' })}</span>
            </div>
        </>
    );

    // ── MLX Panel (existing content) ───────────────────────────────────────────
    const renderMLXPanel = () => (
        <>
            {/* Environment */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdDownload className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.setup.title', { defaultValue: 'Environment' })}
                    </h3>
                    {setupStatus && (
                        <Chip size='sm' color={setupStatus.ready ? 'success' : 'warning'} variant='flat' className='ml-auto'>
                            {setupStatus.ready
                                ? t('config.local_sidecar.setup.ready', { defaultValue: 'Ready' })
                                : t('config.local_sidecar.setup.not_installed', { defaultValue: 'Not installed' })}
                        </Chip>
                    )}
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    {setupStatus?.ready && (
                        <p className='text-xs text-default-400'>{setupStatus.env_dir}</p>
                    )}

                    {installState !== INSTALL_STATE.INSTALLING && installState !== INSTALL_STATE.CONFIRM && (
                        <div className='flex flex-col gap-2'>
                            <p className='text-xs text-default-500 font-medium'>
                                {t('config.local_sidecar.setup.select_components', { defaultValue: 'Select components to install:' })}
                            </p>
                            <div className='flex flex-col gap-1.5 pl-1'>
                                <Checkbox size='sm' isSelected={compLlm} onValueChange={setCompLlm}>
                                    <span className='text-xs'>
                                        {t('config.local_sidecar.setup.comp_llm', { defaultValue: 'Translate & AI (LLM)' })}
                                        <span className='text-default-400 ml-1'>— mlx-lm, ~2 GB</span>
                                    </span>
                                </Checkbox>
                                <Checkbox size='sm' isSelected={compStt} onValueChange={setCompStt}>
                                    <span className='text-xs'>
                                        {t('config.local_sidecar.setup.comp_stt', { defaultValue: 'Speech Recognition (STT)' })}
                                        <span className='text-default-400 ml-1'>— mlx-whisper, ~800 MB</span>
                                    </span>
                                </Checkbox>
                                <div className='flex flex-col gap-1.5'>
                                    <Checkbox size='sm' isSelected={compTts} onValueChange={setCompTts}>
                                        <span className='text-xs'>
                                            {t('config.local_sidecar.setup.comp_tts', { defaultValue: 'Text to Speech (TTS)' })}
                                        </span>
                                    </Checkbox>
                                    {compTts && (
                                        <div className='pl-6'>
                                            <Input size='sm' variant='bordered'
                                                label={t('config.local_sidecar.setup.tts_package', { defaultValue: 'pip package name' })}
                                                placeholder='kokoro-mlx'
                                                value={ttsPackage}
                                                onValueChange={setTtsPackage}
                                                description={t('config.local_sidecar.setup.tts_package_hint', { defaultValue: 'Leave empty to skip TTS installation' })}
                                                className='max-w-xs'
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>

                            {!setupStatus?.ready && (
                                <Button color='primary' size='sm'
                                    isDisabled={nothingSelected || installState === INSTALL_STATE.CHECKING}
                                    isLoading={installState === INSTALL_STATE.CHECKING}
                                    onPress={handleInstallClick}
                                    className='self-start mt-1'>
                                    {installState === INSTALL_STATE.CHECKING
                                        ? t('config.local_sidecar.setup.checking', { defaultValue: 'Checking prerequisites…' })
                                        : t('config.local_sidecar.setup.install_button', { defaultValue: 'Install Selected Components' })}
                                </Button>
                            )}

                            {setupStatus?.ready && (
                                <Button color='default' size='sm' variant='flat'
                                    isDisabled={nothingSelected || installState === INSTALL_STATE.CHECKING}
                                    isLoading={installState === INSTALL_STATE.CHECKING}
                                    onPress={handleInstallClick}
                                    className='self-start mt-1'>
                                    {installState === INSTALL_STATE.CHECKING
                                        ? t('config.local_sidecar.setup.checking', { defaultValue: 'Checking prerequisites…' })
                                        : t('config.local_sidecar.setup.add_components', { defaultValue: 'Install / Update Selected' })}
                                </Button>
                            )}
                        </div>
                    )}

                    {installState === INSTALL_STATE.CONFIRM && renderConfirm()}

                    {isInstalling && (
                        <>
                            <Button color='primary' size='sm' isLoading className='self-start'>
                                {t('config.local_sidecar.setup.installing', { defaultValue: 'Installing…' })}
                            </Button>
                            <div className='w-full bg-content2 rounded-full h-1.5 overflow-hidden'>
                                <div className='bg-brand-500 h-full transition-all duration-500' style={{ width: `${setupProgress}%` }} />
                            </div>
                        </>
                    )}

                    {installState === INSTALL_STATE.ERROR && (
                        <div className='flex flex-col gap-2 p-3 bg-danger-50 border border-danger-200 rounded-lg'>
                            <div className='flex items-start gap-2 text-danger-700'>
                                <MdError className='shrink-0 mt-0.5 text-base' />
                                <p className='text-xs font-medium break-words whitespace-pre-wrap'>{errorMsg}</p>
                            </div>
                            <Button size='sm' color='danger' variant='flat' onPress={handleRetry} className='self-start'>
                                {t('config.local_sidecar.setup.retry', { defaultValue: 'Retry' })}
                            </Button>
                        </div>
                    )}

                    {installState === INSTALL_STATE.SUCCESS && (
                        <div className='flex items-center gap-2 p-3 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-700 rounded-lg'>
                            <MdCheckCircle className='shrink-0 text-success-600 dark:text-success-400 text-base' />
                            <span className='flex-1 text-xs text-success-700 dark:text-success-400 font-medium'>
                                {t('config.local_sidecar.setup.success', { defaultValue: 'Environment installed / updated successfully.' })}
                            </span>
                            <Button size='sm' variant='light' onPress={() => setInstallState(INSTALL_STATE.IDLE)}>
                                {t('common.ok', { defaultValue: 'OK' })}
                            </Button>
                        </div>
                    )}

                    {setupLog.length > 0 && (
                        <div ref={logContainerRef}
                            className='bg-content2 rounded-lg p-3 max-h-40 overflow-y-auto font-mono text-xs text-default-600 space-y-0.5'>
                            {setupLog.map((line, i) => (
                                <div key={i} className={line.startsWith('Error:') ? 'text-danger-600' : ''}>{line}</div>
                            ))}
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* Restart required banner */}
            {restartNeeded && (
                <div className='flex items-center gap-3 p-3 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-700 rounded-lg text-sm text-warning-700 dark:text-warning-400'>
                    <MdWarning className='shrink-0 text-base' />
                    <span className='flex-1'>{t('config.local_sidecar.restart_required', { defaultValue: 'Model config changed — restart the server to apply.' })}</span>
                    <Button size='sm' variant='light' onPress={() => setRestartNeeded(false)}>
                        {t('common.later', { defaultValue: 'Later' })}
                    </Button>
                    <Button size='sm' color='warning' variant='flat' onPress={handleRestart}>
                        {t('config.local_sidecar.restart_now', { defaultValue: 'Restart Now' })}
                    </Button>
                </div>
            )}

            {/* Startup */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdPlayArrow className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.startup.title', { defaultValue: 'Startup' })}
                    </h3>
                    <Chip size='sm' color={running ? 'success' : 'default'} variant='flat' className='ml-auto'>
                        {running
                            ? t('config.local_sidecar.startup.status_running', { defaultValue: 'Running' })
                            : t('config.local_sidecar.startup.status_stopped', { defaultValue: 'Stopped' })}
                    </Chip>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    <div className='config-item'>
                        <div>
                            <h3 className='text-sm'>{t('config.local_sidecar.startup.enable', { defaultValue: 'Enable Local Model' })}</h3>
                            <p className='text-xs text-default-400'>
                                {t('config.local_sidecar.startup.enable_hint', { defaultValue: 'Start the inference server when Transkit launches' })}
                            </p>
                        </div>
                        <Switch isSelected={!!enabled} isDisabled={!setupStatus?.ready} onValueChange={handleEnabledChange} />
                    </div>
                    {running && <p className='text-xs text-default-400'>Port: {runningPort}</p>}

                    {running && (
                        <div className='flex items-start gap-2 p-2.5 rounded-lg bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400 text-xs'>
                            <MdWarning className='text-base flex-shrink-0 mt-0.5' />
                            <span>{t('config.local_sidecar.startup.perf_warning', { defaultValue: 'Local models run entirely on your device. On low-end machines, inference may be slow and will use significant RAM and CPU/GPU resources while active.' })}</span>
                        </div>
                    )}

                    {running && Object.entries(modelStatus).some(([, s]) => s !== 'idle') && (
                        <div className='flex flex-col gap-1.5'>
                            <p className='text-xs font-medium text-default-500'>{t('config.local_sidecar.startup.models_title', { defaultValue: 'Model Status' })}</p>
                            {[
                                { key: 'llm', label: 'LLM (Translate / AI)' },
                                { key: 'tts', label: 'TTS' },
                                { key: 'stt', label: 'STT (Whisper)' },
                            ].filter(({ key }) => modelStatus[key] !== 'idle').map(({ key, label }) => {
                                const st = modelStatus[key];
                                return (
                                    <div key={key} className='flex items-center gap-2 text-xs'>
                                        {st === 'loading' && <span className='w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0' />}
                                        {st === 'ready'   && <MdCheckCircle className='text-success-500 flex-shrink-0' />}
                                        {st === 'error'   && <MdError className='text-danger-500 flex-shrink-0' />}
                                        <span className={
                                            st === 'ready' ? 'text-success-600 dark:text-success-400' :
                                            st === 'error' ? 'text-danger-600 dark:text-danger-400' :
                                            'text-default-500'
                                        }>
                                            {label}
                                            {st === 'ready' && modelTook[key] != null && ` — loaded in ${modelTook[key]}s`}
                                            {st === 'error' && modelError[key] && `: ${modelError[key]}`}
                                            {st === 'loading' && ' — loading…'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className='flex gap-2'>
                        <Button size='sm' color='primary' variant='flat'
                            isDisabled={!setupStatus?.ready || running}
                            startContent={<MdPlayArrow />}
                            onPress={handleStart}>
                            {t('config.local_sidecar.startup.start', { defaultValue: 'Start' })}
                        </Button>
                        <Button size='sm' color='danger' variant='flat'
                            isDisabled={!running}
                            startContent={<MdStop />}
                            onPress={handleStop}>
                            {t('config.local_sidecar.startup.stop', { defaultValue: 'Stop' })}
                        </Button>
                    </div>
                </CardBody>
            </Card>

            {/* LLM */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMemory className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.llm.section', { defaultValue: 'Language Model  (Translate · AI)' })}
                    </h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <h3 className='my-auto text-sm'>{t('config.local_sidecar.llm.model', { defaultValue: 'Model' })}</h3>
                        <div className='flex items-center gap-2 max-w-[65%] w-full'>
                            <Select variant='bordered' selectedKeys={llmModel ? [llmModel] : []} className='flex-1'
                                onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setLlmModel(v); }}>
                                {LLM_MODELS.map(m => <SelectItem key={m.key}>{m.label}</SelectItem>)}
                            </Select>
                            {renderDownloadBtn(llmModel)}
                        </div>
                    </div>
                    <div className='config-item'>
                        <div>
                            <h3 className='text-sm'>{t('config.local_sidecar.llm.temperature', { defaultValue: 'Temperature' })}</h3>
                            <p className='text-xs text-default-400'>
                                {t('config.local_sidecar.llm.temperature_hint', { defaultValue: 'Lower = more deterministic, higher = more creative' })}
                            </p>
                        </div>
                        <div className='flex items-center gap-3 max-w-[55%] w-full'>
                            <Slider minValue={0} maxValue={1} step={0.05} value={temperature ?? 0.3} onChange={setTemperature} aria-label='Temperature' />
                            <span className='text-sm text-default-500 w-8 text-right'>{(temperature ?? 0.3).toFixed(2)}</span>
                        </div>
                    </div>
                    <div className='config-item'>
                        <h3 className='my-auto text-sm'>{t('config.local_sidecar.llm.context_tokens', { defaultValue: 'Max output tokens' })}</h3>
                        <Select variant='bordered' selectedKeys={maxTokens ? [String(maxTokens)] : ['512']} className='max-w-[40%]'
                            onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setMaxTokens(Number(v)); }}>
                            {[256, 512, 1024, 2048].map(n => <SelectItem key={String(n)} textValue={String(n)}>{n}</SelectItem>)}
                        </Select>
                    </div>
                    {setupStatus?.components?.includes('llm') && (
                        <p className='text-xs text-default-400'>
                            {t('config.local_sidecar.llm.download_note', {
                                defaultValue: 'Model weights are downloaded automatically on first use (~3–15 GB). This may take a few minutes — status appears in the Monitor log.',
                            })}
                        </p>
                    )}
                </CardBody>
            </Card>

            {/* ASR */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMic className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.asr.section', { defaultValue: 'Speech Recognition (STT)' })}
                    </h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    {(() => {
                        const currentModel = asrModel ?? 'mlx-community/whisper-large-v3-turbo';
                        const isCustom = !ASR_MODELS.some(m => m.key === currentModel && m.key !== 'custom');
                        const selectValue = isCustom ? 'custom' : currentModel;
                        return (<>
                            <div className='config-item'>
                                <h3 className='my-auto text-sm'>{t('config.local_sidecar.asr.model', { defaultValue: 'Whisper model' })}</h3>
                                <div className='flex items-center gap-2 max-w-[65%] w-full'>
                                    <Select variant='bordered' selectedKeys={[selectValue]} className='flex-1'
                                        onSelectionChange={(keys) => {
                                            const v = Array.from(keys)[0];
                                            if (!v) return;
                                            setAsrModel(v === 'custom' ? customAsrModel : v);
                                            if (running) setRestartNeeded(true);
                                        }}>
                                        {ASR_MODELS.map(m => <SelectItem key={m.key}>{m.label}</SelectItem>)}
                                    </Select>
                                    {selectValue !== 'custom' && renderDownloadBtn(currentModel)}
                                </div>
                            </div>
                            {(selectValue === 'custom' || isCustom) && (
                                <div className='config-item'>
                                    <p className='text-xs text-default-400 my-auto'>
                                        {t('config.local_sidecar.asr.custom_model', { defaultValue: 'HuggingFace repo ID' })}
                                    </p>
                                    <Input size='sm' variant='bordered'
                                        placeholder='e.g. toantam1290/whisper-large-v3-vietnamese'
                                        value={isCustom ? currentModel : ''}
                                        onValueChange={v => { setAsrModel(v); setCustomAsrModel(v); }}
                                        className='max-w-[60%]'
                                    />
                                </div>
                            )}
                        </>);
                    })()}
                    <div className='config-item'>
                        <div>
                            <h3 className='text-sm'>{t('config.local_sidecar.asr.task', { defaultValue: 'Task' })}</h3>
                            <p className='text-xs text-default-400'>
                                {t('config.local_sidecar.asr.task_hint', { defaultValue: 'Translate always outputs English regardless of source language' })}
                            </p>
                        </div>
                        <Select variant='bordered' selectedKeys={asrTask ? [asrTask] : ['transcribe']} className='max-w-[60%]'
                            onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setAsrTask(v); }}>
                            <SelectItem key='transcribe'>
                                {t('config.local_sidecar.asr.task_transcribe', { defaultValue: 'Transcribe (keep original language)' })}
                            </SelectItem>
                            <SelectItem key='translate'>
                                {t('config.local_sidecar.asr.task_translate', { defaultValue: 'Transcribe + Translate → English' })}
                            </SelectItem>
                        </Select>
                    </div>
                    <div className='config-item'>
                        <h3 className='my-auto text-sm'>{t('config.local_sidecar.asr.chunk_seconds', { defaultValue: 'Chunk size' })}</h3>
                        <Select key={`chunk-${chunkSeconds ?? 7}`} variant='bordered' disallowEmptySelection
                            selectedKeys={chunkSeconds ? [String(chunkSeconds)] : ['7']} className='max-w-[40%]'
                            onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setChunkSeconds(Number(v)); }}>
                            {CHUNK_OPTIONS.map(s => <SelectItem key={String(s)} textValue={`${s}s`}>{s}s</SelectItem>)}
                        </Select>
                    </div>
                </CardBody>
            </Card>

            {/* TTS */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdRecordVoiceOver className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.tts.section', { defaultValue: 'Text to Speech (TTS)' })}
                    </h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <h3 className='my-auto text-sm'>{t('config.local_sidecar.tts.engine', { defaultValue: 'Engine' })}</h3>
                        <Select variant='bordered' selectedKeys={ttsEngine ? [ttsEngine] : ['kokoro']} className='max-w-[60%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) { setTtsEngine(v); if (running) setRestartNeeded(true); }
                            }}>
                            {TTS_ENGINES.map(e => <SelectItem key={e.key}>{e.label}</SelectItem>)}
                        </Select>
                    </div>
                    <div className='config-item'>
                        <div>
                            <h3 className='text-sm'>{t('config.local_sidecar.tts.model', { defaultValue: 'Model' })}</h3>
                            <p className='text-xs text-default-400'>
                                {t('config.local_sidecar.tts.model_hint', { defaultValue: 'HuggingFace repo ID (leave empty for default)' })}
                            </p>
                        </div>
                        <div className='flex items-center gap-2 max-w-[60%] w-full'>
                            <Input size='sm' variant='bordered'
                                placeholder={TTS_ENGINES.find(e => e.key === (ttsEngine ?? 'kokoro'))?.placeholder ?? ''}
                                value={ttsModel ?? ''}
                                onValueChange={(v) => { setTtsModel(v); if (running) setRestartNeeded(true); }}
                                className='flex-1'
                            />
                            {renderDownloadBtn(ttsModel?.trim() || null)}
                        </div>
                    </div>
                    {(ttsEngine ?? 'kokoro') === 'kokoro' && (
                        <div className='config-item'>
                            <h3 className='my-auto text-sm'>{t('config.local_sidecar.tts.voice', { defaultValue: 'Voice' })}</h3>
                            <Select variant='bordered' selectedKeys={ttsVoice ? [ttsVoice] : ['af_heart']} className='max-w-[50%]'
                                onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setTtsVoice(v); }}>
                                {TTS_VOICES.map(v => <SelectItem key={v}>{v}</SelectItem>)}
                            </Select>
                        </div>
                    )}
                    {(ttsEngine ?? 'kokoro') === 'mlx_audio' && (
                        <div className='config-item'>
                            <h3 className='my-auto text-sm'>{t('config.local_sidecar.tts.voice', { defaultValue: 'Voice' })}</h3>
                            <Input size='sm' variant='bordered' placeholder='e.g. serena'
                                value={ttsVoice ?? ''} onValueChange={(v) => setTtsVoice(v)} className='max-w-[50%]' />
                        </div>
                    )}
                    {(ttsEngine ?? 'kokoro') === 'mlx_audio' && (
                        <div className='config-item'>
                            <h3 className='my-auto text-sm'>{t('config.local_sidecar.tts.ref_audio', { defaultValue: 'Ref audio (optional)' })}</h3>
                            <div className='flex gap-2 flex-1'>
                                <Input size='sm' variant='bordered'
                                    placeholder={t('config.local_sidecar.tts.ref_audio_placeholder', { defaultValue: 'Select a .wav file…' })}
                                    value={ttsRefAudio ?? ''}
                                    onValueChange={(v) => { setTtsRefAudio(v); if (running) setRestartNeeded(true); }}
                                    className='flex-1' isReadOnly
                                />
                                <Button size='sm' variant='flat' onPress={async () => {
                                    const path = await openFileDialog({ filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'm4a', 'flac'] }] });
                                    if (path && typeof path === 'string') { setTtsRefAudio(path); if (running) setRestartNeeded(true); }
                                }}>
                                    {t('common.browse', { defaultValue: 'Browse' })}
                                </Button>
                                {ttsRefAudio && (
                                    <Button size='sm' variant='flat' color='danger' isIconOnly
                                        onPress={() => { setTtsRefAudio(''); if (running) setRestartNeeded(true); }}>✕</Button>
                                )}
                            </div>
                        </div>
                    )}
                </CardBody>
            </Card>

            {/* Cached Models */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdStorage className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>
                        {t('config.local_sidecar.cache.section', { defaultValue: 'Cached Models' })}
                    </h3>
                    <div className='ml-auto flex gap-1'>
                        <Button size='sm' variant='light' isIconOnly
                            onPress={() => invoke('local_sidecar_reveal_cache').catch(console.error)}
                            title='Open cache folder'>
                            <MdFolderOpen className='text-base' />
                        </Button>
                        <Button size='sm' variant='light' isIconOnly onPress={loadCachedModels} title='Refresh'>
                            <MdRefresh className='text-base' />
                        </Button>
                    </div>
                </CardHeader>
                <CardBody className='flex flex-col gap-2'>
                    {cachedModels === null ? (
                        <Button size='sm' variant='flat' className='self-start' onPress={loadCachedModels}>
                            {t('config.local_sidecar.cache.load', { defaultValue: 'Show cached models' })}
                        </Button>
                    ) : cachedModels.length === 0 ? (
                        <p className='text-xs text-default-400'>
                            {t('config.local_sidecar.cache.empty', { defaultValue: 'No models cached yet. Models are downloaded automatically on first use.' })}
                        </p>
                    ) : (
                        <div className='flex flex-col gap-1'>
                            {cachedModels.map(m => (
                                <div key={m.repo_id} className='flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-content2 group'>
                                    <div className='flex-1 min-w-0'>
                                        <p className='text-xs font-mono truncate'>{m.repo_id}</p>
                                        <p className='text-xs text-default-400'>{formatBytes(m.size_bytes)}</p>
                                    </div>
                                    <Button size='sm' variant='light' color='danger' isIconOnly
                                        isLoading={deletingModel === m.repo_id}
                                        onPress={() => handleDeleteModel(m.repo_id)}
                                        className='opacity-0 group-hover:opacity-100 transition-opacity'
                                        title={t('config.local_sidecar.cache.delete', { defaultValue: 'Delete from cache' })}>
                                        <MdDelete className='text-base' />
                                    </Button>
                                </div>
                            ))}
                            <p className='text-xs text-default-400 mt-1'>
                                {t('config.local_sidecar.cache.total', {
                                    defaultValue: 'Total: {{size}}',
                                    size: formatBytes(cachedModels.reduce((s, m) => s + m.size_bytes, 0)),
                                })}
                            </p>
                        </div>
                    )}
                </CardBody>
            </Card>
        </>
    );

    // ── Main render ────────────────────────────────────────────────────────────
    // On macOS: show MLX / ONNX tabs (same Tabs pattern as Service/index.jsx).
    // On Windows / Linux: ONNX only — render directly without tabs.
    if (isMacOS) {
        return (
            <Tabs
                selectedKey={effectiveEngine}
                onSelectionChange={key => setActiveEngine(String(key))}
                aria-label='Local Model Engine'
            >
                <Tab key='mlx' title={t('config.local_sidecar.engine_tab.mlx', { defaultValue: 'MLX' })}>
                    <div className='flex flex-col gap-4'>
                        {renderMLXPanel()}
                    </div>
                </Tab>
                <Tab key='onnx' title={t('config.local_sidecar.engine_tab.onnx', { defaultValue: 'ONNX' })}>
                    <div className='flex flex-col gap-4'>
                        {renderONNXPanel()}
                    </div>
                </Tab>
            </Tabs>
        );
    }

    return (
        <div className='flex flex-col gap-4'>
            {renderONNXPanel()}
        </div>
    );
}
