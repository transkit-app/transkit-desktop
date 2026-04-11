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
            asrModel: 'hynt/Zipformer-30M-RNNT-6000h',
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

    const refreshSetup = useCallback(() => {
        invoke('onnx_engine_check_setup').then(setSetupStatus).catch(() => {});
    }, []);

    const refreshModels = useCallback(() => {
        invoke('onnx_model_list').then(setModels).catch(() => {});
    }, []);

    useEffect(() => {
        refreshSetup();
        refreshModels();
    }, [refreshSetup, refreshModels]);

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

    const handleDownload = async () => {
        const repo = repoInput.trim();
        if (!repo) return;
        setDownloading(true);
        setDownloadProgress({ message: `Starting download of ${repo}...`, percent: 0 });
        try {
            await invoke('onnx_model_download', { repo });
        } catch (err) {
            setDownloading(false);
            setDownloadProgress({ message: `Failed: ${err}`, percent: 0, error: true });
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
                        <span>
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
                    {!isReady && !installing && (
                        <Button
                            size='sm'
                            color='warning'
                            variant='flat'
                            className='ml-auto flex-shrink-0'
                            onPress={handleInstall}
                        >
                            {t('config.onnx_stt.engine.install', { defaultValue: 'Install Engine' })}
                        </Button>
                    )}
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
                <div className='config-item'>
                    <h3 className='my-auto text-sm'>{t('services.instance_name')}</h3>
                    <input
                        className='input-base max-w-[60%]'
                        value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                        onChange={e => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: e.target.value })}
                    />
                </div>

                {/* Active model selector */}
                <div className='config-item'>
                    <div>
                        <h3 className='text-sm'>
                            {t('config.onnx_stt.model.active', { defaultValue: 'Active model' })}
                        </h3>
                        <p className='text-xs text-default-400'>
                            {t('config.onnx_stt.model.active_hint', { defaultValue: 'HuggingFace repo ID of the downloaded model' })}
                        </p>
                    </div>
                    <input
                        className='input-base max-w-[60%]'
                        value={config.asrModel ?? ''}
                        onChange={e => setConfig({ ...config, asrModel: e.target.value })}
                        placeholder='e.g. hynt/Zipformer-30M-RNNT-6000h'
                    />
                </div>

                {/* Download model section */}
                <div className='flex flex-col gap-2'>
                    <h3 className='text-sm font-medium'>
                        {t('config.onnx_stt.model.download_title', { defaultValue: 'Download model' })}
                    </h3>
                    <p className='text-xs text-default-400'>
                        {t('config.onnx_stt.model.download_hint', { defaultValue: 'Enter a HuggingFace repo ID for a Zipformer RNNT ONNX model.' })}
                    </p>
                    <div className='flex gap-2'>
                        <Input
                            size='sm'
                            variant='bordered'
                            placeholder='hynt/Zipformer-30M-RNNT-6000h'
                            value={repoInput}
                            onValueChange={setRepoInput}
                            className='flex-1'
                            isDisabled={downloading}
                        />
                        <Button
                            size='sm'
                            color='primary'
                            variant='flat'
                            startContent={<MdDownload />}
                            onPress={handleDownload}
                            isLoading={downloading}
                            isDisabled={!repoInput.trim() || downloading}
                        >
                            {t('config.onnx_stt.model.download_btn', { defaultValue: 'Download' })}
                        </Button>
                    </div>

                    {/* Download progress */}
                    {downloadProgress && (
                        <div className='flex flex-col gap-1'>
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
                                            {(!model.has_encoder || !model.has_decoder || !model.has_joiner || !model.has_tokens) && (
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
