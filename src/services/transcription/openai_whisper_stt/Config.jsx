import { Input, Button } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
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
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.openai_whisper_stt.title'),
            apiKey: '',
            serverUrl: 'https://api.openai.com',
            model: 'whisper-1',
            chunkIntervalMs: 5000,
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
                        label={t('services.transcription.openai_whisper_stt.server_url')}
                        labelPlacement='outside'
                        value={config.serverUrl ?? 'https://api.openai.com'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, serverUrl: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.transcription.openai_whisper_stt.api_key')}
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
                    <Input
                        label={t('services.transcription.openai_whisper_stt.model')}
                        labelPlacement='outside'
                        value={config.model ?? 'whisper-1'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, model: v })}
                    />
                </div>

                {/* Chunk interval */}
                <div className='config-item flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.openai_whisper_stt.chunk_interval')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={2000} max={15000} step={1000}
                            value={config.chunkIntervalMs ?? 5000}
                            onChange={e => setConfig({ ...config, chunkIntervalMs: parseInt(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {(config.chunkIntervalMs ?? 5000) / 1000}s
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.openai_whisper_stt.chunk_interval_hint')}</p>
                </div>

                <div className='config-item'>
                    <p className='text-xs text-warning italic'>
                        {t('services.transcription.openai_whisper_stt.batch_note')}
                    </p>
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
