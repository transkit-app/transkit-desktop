import { Button, Select, SelectItem, Input } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/tauri';
import React, { useState, useEffect } from 'react';
import { MdCheckCircle, MdHourglassEmpty } from 'react-icons/md';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';

const CHUNK_OPTIONS = [3, 5, 7, 10];

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.local_sidecar_stt.title', { defaultValue: 'Local Model STT' }),
            task:          'transcribe',
            chunkSeconds:  7,
            strideSeconds: 5,
        },
        { sync: false }
    );

    // Global ASR model from Local Model settings — read-only, shown for reference
    const [globalAsrModel] = useConfig('local_sidecar_asr_model', 'mlx-community/whisper-large-v3-turbo');

    const [setupStatus, setSetupStatus] = useState(null);

    useEffect(() => {
        invoke('local_sidecar_check_setup').then(setSetupStatus).catch(() => {});
    }, []);

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    if (!setupStatus) return null;

    return (
        config !== null && (
            <div className='flex flex-col gap-4'>
                {/* Setup status banner */}
                <div className={`flex items-center gap-2 p-3 rounded-lg text-sm ${
                    setupStatus.ready
                        ? 'bg-success-50 dark:bg-success-900/20 text-success-700 dark:text-success-400'
                        : 'bg-warning-50 dark:bg-warning-900/20 text-warning-700 dark:text-warning-400'
                }`}>
                    {setupStatus.ready
                        ? <MdCheckCircle className='text-lg flex-shrink-0' />
                        : <MdHourglassEmpty className='text-lg flex-shrink-0' />}
                    <span>
                        {setupStatus.ready
                            ? t('config.local_sidecar.setup.ready', { defaultValue: 'Environment ready' })
                            : t('config.local_sidecar.setup.not_installed', { defaultValue: 'Local environment not installed. Set it up in Settings → Local Model.' })}
                    </span>
                </div>

                {/* Instance name */}
                <div className='config-item'>
                    <h3 className='my-auto text-sm'>{t('services.instance_name')}</h3>
                    <input
                        className='input-base max-w-[60%]'
                        value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                        onChange={e => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: e.target.value })}
                    />
                </div>

                {/* Current model — read-only, configured in Local Model settings */}
                <div className='config-item'>
                    <div>
                        <h3 className='text-sm'>
                            {t('config.local_sidecar.asr.model', { defaultValue: 'Whisper model' })}
                        </h3>
                        <p className='text-xs text-default-400'>
                            {t('config.local_sidecar.asr.model_from_settings', { defaultValue: 'Configured in Settings → Local Model' })}
                        </p>
                    </div>
                    <p className='text-xs font-mono bg-content2 px-2 py-1.5 rounded-md text-default-600 max-w-[60%] truncate'>
                        {globalAsrModel || '—'}
                    </p>
                </div>

                {/* Task */}
                <div className='config-item'>
                    <div>
                        <h3 className='text-sm'>
                            {t('config.local_sidecar.asr.task', { defaultValue: 'Task' })}
                        </h3>
                        <p className='text-xs text-default-400'>
                            {t('config.local_sidecar.asr.task_hint', { defaultValue: 'Translate always outputs English regardless of source language' })}
                        </p>
                    </div>
                    <Select
                        variant='bordered'
                        disallowEmptySelection
                        selectedKeys={[config.task ?? 'transcribe']}
                        className='max-w-[60%]'
                        onSelectionChange={keys => {
                            const v = Array.from(keys)[0];
                            if (v) setConfig({ ...config, task: v });
                        }}
                    >
                        <SelectItem key='transcribe'>
                            {t('config.local_sidecar.asr.task_transcribe', { defaultValue: 'Transcribe (keep original language)' })}
                        </SelectItem>
                        <SelectItem key='translate'>
                            {t('config.local_sidecar.asr.task_translate', { defaultValue: 'Transcribe + Translate → English' })}
                        </SelectItem>
                    </Select>
                </div>

                {/* Chunk size */}
                <div className='config-item'>
                    <h3 className='my-auto text-sm'>
                        {t('config.local_sidecar.asr.chunk_seconds', { defaultValue: 'Chunk size' })}
                    </h3>
                    <Select
                        key={`chunk-${config.chunkSeconds ?? 7}`}
                        variant='bordered'
                        disallowEmptySelection
                        selectedKeys={[String(config.chunkSeconds ?? 7)]}
                        className='max-w-[60%]'
                        onSelectionChange={keys => {
                            const v = Array.from(keys)[0];
                            if (v) setConfig({ ...config, chunkSeconds: Number(v) });
                        }}
                    >
                        {CHUNK_OPTIONS.map(s => (
                            <SelectItem key={String(s)} textValue={`${s}s`}>{s}s</SelectItem>
                        ))}
                    </Select>
                </div>

                <Button fullWidth color='primary' size='sm' onPress={handleSave}>
                    {t('common.save', { defaultValue: 'Save' })}
                </Button>
            </div>
        )
    );
}
