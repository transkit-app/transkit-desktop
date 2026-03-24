import { Input, Button } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isVisible, setIsVisible] = useState(false);

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.gladia_stt.title'),
            apiKey: '',
            endpointing: 0.1,
            speechThreshold: 0.3,
            batchIntervalMs: 100,
        },
        { sync: false }
    );

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    return (
        config !== null && (
            <>
                <Toaster />
                <div className='config-item'>
                    <Input
                        label={t('services.instance_name')}
                        labelPlacement='outside'
                        value={config[INSTANCE_NAME_CONFIG_KEY] ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.transcription.gladia_stt.api_key')}
                        labelPlacement='outside'
                        type={isVisible ? 'text' : 'password'}
                        value={config.apiKey ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, apiKey: v })}
                        endContent={
                            <Button isIconOnly size='sm' variant='light' className='h-6 w-6 min-w-0' onPress={() => setIsVisible(!isVisible)}>
                                {isVisible ? <AiFillEyeInvisible className='text-default-500' /> : <AiFillEye className='text-default-500' />}
                            </Button>
                        }
                    />
                </div>
                <div className='config-item'>
                    <p className='text-xs text-default-400'>
                        {t('services.transcription.gladia_stt.api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://app.gladia.io/auth/signup')}
                        >
                            app.gladia.io
                        </span>
                    </p>
                </div>

                {/* Endpointing */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.gladia_stt.endpointing')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={0.05} max={2.0} step={0.05}
                            value={config.endpointing ?? 0.3}
                            onChange={e => setConfig({ ...config, endpointing: parseFloat(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {(config.endpointing ?? 0.3).toFixed(2)} s
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.gladia_stt.endpointing_hint')}</p>
                </div>

                {/* Speech threshold */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.gladia_stt.speech_threshold')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={0} max={1} step={0.05}
                            value={config.speechThreshold ?? 0.3}
                            onChange={e => setConfig({ ...config, speechThreshold: parseFloat(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {(config.speechThreshold ?? 0.3).toFixed(2)}
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.gladia_stt.speech_threshold_hint')}</p>
                </div>

                {/* Batch interval */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.gladia_stt.batch_interval')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={20} max={500} step={10}
                            value={config.batchIntervalMs ?? 100}
                            onChange={e => setConfig({ ...config, batchIntervalMs: parseInt(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {config.batchIntervalMs ?? 100} ms
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.gladia_stt.batch_interval_hint')}</p>
                </div>

                <div>
                    <Button fullWidth color='primary' onPress={handleSave}>
                        {t('common.save')}
                    </Button>
                </div>
            </>
        )
    );
}
