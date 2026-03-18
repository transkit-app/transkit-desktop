import { Input, Button, Switch } from '@nextui-org/react';
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
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.soniox_stt.title'),
            apiKey: '',
            endpointDelayMs: 250,
            batchIntervalMs: 100,
            speakerDiarization: true,
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
                        label={t('services.transcription.soniox_stt.api_key')}
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
                        {t('services.transcription.soniox_stt.api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://console.soniox.com/signup')}
                        >
                            console.soniox.com
                        </span>
                    </p>
                </div>

                {/* Endpoint delay */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.soniox_stt.endpoint_delay')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={50} max={2000} step={50}
                            value={config.endpointDelayMs ?? 250}
                            onChange={e => setConfig({ ...config, endpointDelayMs: parseInt(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {config.endpointDelayMs ?? 250} ms
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.soniox_stt.endpoint_delay_hint')}</p>
                </div>

                {/* Batch interval */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.soniox_stt.batch_interval')}</p>
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
                    <p className='text-xs text-default-400'>{t('services.transcription.soniox_stt.batch_interval_hint')}</p>
                </div>

                {/* Speaker diarization */}
                <div className='config-item'>
                    <div className='flex items-center justify-between w-full'>
                        <div className='flex flex-col gap-0.5'>
                            <p className='text-sm'>{t('services.transcription.soniox_stt.speaker_diarization')}</p>
                            <p className='text-xs text-default-400'>{t('services.transcription.soniox_stt.speaker_diarization_hint')}</p>
                        </div>
                        <Switch
                            size='sm'
                            isSelected={config.speakerDiarization !== false}
                            onValueChange={v => setConfig({ ...config, speakerDiarization: v })}
                            color='warning'
                        />
                    </div>
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
