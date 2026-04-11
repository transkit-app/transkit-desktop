import React, { useState, useEffect, useCallback } from 'react';
import { Button, Input, Progress } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { MdCheckCircle, MdHourglassEmpty, MdDownload, MdDelete, MdStorage } from 'react-icons/md';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';

function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.onnx_stt.title', { defaultValue: 'Offline STT (ONNX)' }),
            asrModel: 'csukuangfj/sherpa-onnx-streaming-zipformer-small-en-2023-06-26',
        },
        { sync: false }
    );

    const [setupStatus, setSetupStatus] = useState(null);
    const [models, setModels] = useState([]);
    const [repoInput, setRepoInput] = useState('hynt/Zipformer-30M-RNNT-6000h');
    const [installing, setInstalling] = useState(false);
    const [installProgress, setInstallProgress] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const [downloadProgress, setDownloadProgress] = useState(null);
    const [engineStatus, setEngineStatus] = useState({ running: false, port: 0 });

    const refreshSetup = useCallback(() => {
        invoke('onnx_engine_check_setup').then(setSetupStatus).catch(() => {});
    }, []);

    const refreshModels = useCallback(() => {
        invoke('onnx_model_list').then(setModels).catch(() => {});
    }, []);

    const refreshStatus = useCallback(() => {
        invoke('onnx_engine_status').then(setEngineStatus).catch(() => {});
    }, []);

    useEffect(() => {
        refreshSetup();
        refreshModels();
        refreshStatus();
    }, [refreshSetup, refreshModels, refreshStatus]);

    // Listen for install progress events
    useEffect(() => {
        let unlisten;
        listen('onnx-engine://setup-progress', (e) => {
            const payload = e.payload;
            if (payload.type === 'done') {
                setInstalling(false);
                setInstallProgress(null);
                refreshSetup();
            } else if (payload.type === 'error') {
                setInstalling(false);
                setInstallProgress({ message: `Error: ${payload.message}`, percent: 0, error: true });
            } else {
                setInstallProgress({ message: payload.message, percent: payload.percent ?? 0 });
            }
        }).then(fn => { unlisten = fn; }).catch(() => {});
        return () => { if (unlisten) unlisten(); };
    }, [refreshSetup]);

    // Listen for engine status events
    useEffect(() => {
        const listeners = [];
        listen('onnx-engine://ready', (e) => {
            setEngineStatus({ running: true, port: e.payload.port });
        }).then(fn => listeners.push(fn));
        listen('onnx-engine://stopped', () => {
            setEngineStatus({ running: false, port: 0 });
        }).then(fn => listeners.push(fn));
        return () => { listeners.forEach(fn => fn()); };
    }, []);

    // Listen for model download progress events
    useEffect(() => {
        let unlisten;
        listen('onnx-model://progress', (e) => {
            const payload = e.payload;
            if (payload.step === 'done') {
                setDownloading(false);
                setDownloadProgress(null);
                refreshModels();
            } else if (payload.step === 'error') {
                setDownloading(false);
                setDownloadProgress({ message: `Error: ${payload.message}`, percent: 0, error: true });
            } else {
                setDownloadProgress({ message: payload.message, percent: payload.percent ?? 0 });
            }
        }).then(fn => { unlisten = fn; }).catch(() => {});
        return () => { if (unlisten) unlisten(); };
    }, [refreshModels]);

    const handleInstall = async () => {
        setInstalling(true);
        setInstallProgress({ message: 'Starting installation...', percent: 0 });
        try {
            await invoke('onnx_engine_install');
        } catch (err) {
            setInstalling(false);
            setInstallProgress({ message: `Failed: ${err}`, percent: 0, error: true });
        }
    };

    const downloadRepo = async (repo) => {
        const r = (repo || '').trim();
        if (!r) return;
        setDownloading(true);
        setDownloadProgress({ message: `Starting download of ${r}...`, percent: 0 });
        try {
            await invoke('onnx_model_download', { repo: r });
        } catch (err) {
            setDownloading(false);
            setDownloadProgress({ message: `Failed: ${err}`, percent: 0, error: true });
        }
    };

    const handleDownload = async () => {
        await downloadRepo(repoInput);
    };

    const handleStart = async () => {
        try {
            await invoke('onnx_engine_start', {
                config: {
                    asr_model: config.asrModel || undefined,
                }
            });
            refreshStatus();
        } catch (err) {
            console.error('[OnnxSTT] Start failed:', err);
        }
    };

    const handleStop = async () => {
        try {
            await invoke('onnx_engine_stop');
            refreshStatus();
        } catch (err) {
            console.error('[OnnxSTT] Stop failed:', err);
        }
    };

    const handleDelete = async (repoId) => {
        try {
            await invoke('onnx_model_delete', { repo: repoId });
            refreshModels();
        } catch (err) {
            console.error('[OnnxSTT] Delete failed:', err);
        }
    };

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    if (!setupStatus) return null;

    const isReady = setupStatus.ready;

    return (
        config !== null && (
            <div className='flex flex-col gap-4'>

                {/* Engine status banner */}
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    isReady
                        ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                        : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
                }`}>
                    {isReady
                        ? <MdCheckCircle className='text-lg flex-shrink-0' />
                        : <MdHourglassEmpty className='text-lg flex-shrink-0' />}
                    <div className='flex flex-col gap-0.5 min-w-0'>
                        <span className='font-medium'>
                            {isReady
                                ? t('config.onnx_stt.engine.ready', { defaultValue: 'ONNX engine installed' })
                                : t('config.onnx_stt.engine.not_installed', { defaultValue: 'ONNX engine not installed' })}
                        </span>
                        {setupStatus.platform && (
                            <span className='text-xs opacity-70'>
                                {setupStatus.platform === 'macos_mlx_venv'
                                    ? t('config.onnx_stt.engine.platform_sidecar', { defaultValue: 'Uses shared sidecar venv' })
                                    : setupStatus.platform}
                            </span>
                        )}
                    </div>
                </div>

                {/* Server controls */}
                <div className='flex flex-col gap-3 p-3 bg-content2 rounded-lg'>
                    <div className='flex items-center justify-between'>
                        <div className='flex flex-col'>
                            <span className='text-sm font-medium'>{t('config.onnx_stt.server.title', { defaultValue: 'ONNX Server' })}</span>
                            <span className='text-xs text-default-400'>
                                {engineStatus?.running 
                                    ? t('config.onnx_stt.server.running', { defaultValue: 'Running on port {{port}}', port: engineStatus.port })
                                    : t('config.onnx_stt.server.stopped', { defaultValue: 'Server is stopped' })}
                            </span>
                        </div>
                        <div className='flex gap-2'>
                            {!engineStatus?.running ? (
                                <Button
                                    size='sm'
                                    color='primary'
                                    variant='flat'
                                    isDisabled={!isReady || installing}
                                    onPress={handleStart}
                                >
                                    {t('common.start', { defaultValue: 'Start' })}
                                </Button>
                            ) : (
                                <Button
                                    size='sm'
                                    color='danger'
                                    variant='flat'
                                    onPress={handleStop}
                                >
                                    {t('common.stop', { defaultValue: 'Stop' })}
                                </Button>
                            )}
                            {!isReady && !installing && (
                                <Button
                                    size='sm'
                                    color='warning'
                                    variant='flat'
                                    onPress={handleInstall}
                                >
                                    {t('config.onnx_stt.engine.install', { defaultValue: 'Install Engine' })}
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Install progress */}
                {installProgress && (
                    <div className='flex flex-col gap-1'>
                        <p className={`text-xs ${installProgress.error ? 'text-danger-500' : 'text-default-500'}`}>
                            {installProgress.message}
                        </p>
                        {!installProgress.error && (
                            <Progress
                                size='sm'
                                value={installProgress.percent}
                                color='primary'
                                aria-label='Install progress'
                            />
                        )}
                    </div>
                )}

                {/* Instance name */}
                <div className='config-item flex-col items-stretch'>
                    <Input
                        label={t('services.instance_name')}
                        labelPlacement='outside'
                        value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                    />
                </div>

                {/* Active model selector */}
                <div className='config-item flex-col items-start gap-1'>
                    <div className='flex items-end gap-2 w-full'>
                        <Input
                            label={t('config.onnx_stt.model.active', { defaultValue: 'Active model' })}
                            labelPlacement='outside'
                            placeholder='e.g. csukuangfj/sherpa-onnx-streaming-zipformer-small-en-2023-06-26'
                            variant='bordered'
                            className='flex-1'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            value={config.asrModel ?? ''}
                            onValueChange={v => setConfig({ ...config, asrModel: v })}
                        />
                        {(() => {
                            const repo = (config.asrModel ?? '').trim();
                            if (!repo) return null;
                            const isDownloaded = models.some(m => m.repo_id === repo);
                            return isDownloaded ? (
                                <Button size='sm' color='success' variant='flat' isDisabled startContent={<MdCheckCircle />} className='h-10'>
                                    {t('config.onnx_stt.model.downloaded_badge', { defaultValue: 'Downloaded' })}
                                </Button>
                            ) : (
                                <Button
                                    size='sm'
                                    color='primary'
                                    variant='flat'
                                    startContent={<MdDownload />}
                                    onPress={() => downloadRepo(repo)}
                                    isLoading={downloading}
                                    isDisabled={downloading}
                                    className='h-10'
                                >
                                    {t('config.onnx_stt.model.download_btn', { defaultValue: 'Download' })}
                                </Button>
                            );
                        })()}
                    </div>
                    <p className='text-xs text-default-400'>
                        {t('config.onnx_stt.model.active_hint', { defaultValue: 'HuggingFace repo ID of the downloaded model' })}
                    </p>
                </div>

                {/* Download model section */}
                <div className='config-item flex-col items-start gap-1'>
                    <div className='flex items-end gap-2 w-full'>
                        <Input
                            label={t('config.onnx_stt.model.download_title', { defaultValue: 'Download model' })}
                            labelPlacement='outside'
                            placeholder='csukuangfj/sherpa-onnx-streaming-zipformer-small-en-2023-06-26'
                            variant='bordered'
                            className='flex-1'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            value={repoInput}
                            onValueChange={setRepoInput}
                            isDisabled={downloading}
                        />
                        <Button
                            color='primary'
                            variant='flat'
                            startContent={<MdDownload />}
                            onPress={handleDownload}
                            isLoading={downloading}
                            isDisabled={!repoInput.trim() || downloading}
                            className='h-10'
                        >
                            {t('config.onnx_stt.model.download_btn', { defaultValue: 'Download' })}
                        </Button>
                    </div>
                    <p className='text-xs text-default-400'>
                        {t('config.onnx_stt.model.download_hint', { defaultValue: 'Enter a HuggingFace repo ID for a sherpa-onnx compatible Zipformer model (e.g. csukuangfj/sherpa-onnx-streaming-zipformer-*).' })}
                    </p>

                    {/* Download progress */}
                    {downloadProgress && (
                        <div className='flex flex-col gap-1 w-full'>
                            <p className={`text-xs ${downloadProgress.error ? 'text-danger-500' : 'text-default-500'}`}>
                                {downloadProgress.message}
                            </p>
                            {!downloadProgress.error && (
                                <Progress
                                    size='sm'
                                    value={downloadProgress.percent}
                                    color='primary'
                                    aria-label='Download progress'
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Downloaded models list */}
                {models.length > 0 && (
                    <div className='flex flex-col gap-2'>
                        <h3 className='text-sm font-medium flex items-center gap-1'>
                            <MdStorage className='text-base' />
                            {t('config.onnx_stt.model.downloaded', { defaultValue: 'Downloaded models' })}
                        </h3>
                        <div className='flex flex-col gap-1'>
                            {models.map(model => (
                                <div
                                    key={model.repo_id}
                                    className='flex items-center justify-between px-3 py-2 rounded-lg bg-content2 text-sm'
                                >
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
                                    <Button
                                        size='sm'
                                        variant='light'
                                        color='danger'
                                        isIconOnly
                                        onPress={() => handleDelete(model.repo_id)}
                                        title={t('common.delete', { defaultValue: 'Delete' })}
                                    >
                                        <MdDelete />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <Button fullWidth color='primary' size='sm' onPress={handleSave}>
                    {t('common.save', { defaultValue: 'Save' })}
                </Button>
            </div>
        )
    );
}
