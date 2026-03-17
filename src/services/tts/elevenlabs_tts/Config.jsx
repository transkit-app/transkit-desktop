import { Input, Button } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import { useToastStyle } from '../../../hooks';
import { tts, Language } from './index';

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const toastStyle = useToastStyle();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.tts.elevenlabs_tts.title'),
            apiKey: '',
            voiceId: 'QqID1ZB0DTItNxAKGBNW',
            modelId: 'eleven_flash_v2_5',
            mode: 'wss',
        },
        { sync: false }
    );

    return (
        config !== null && (
            <>
                <Toaster />
                <div className='config-item'>
                    <Input
                        label={t('services.instance_name')}
                        labelPlacement='outside-left'
                        value={config[INSTANCE_NAME_CONFIG_KEY]}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.elevenlabs_tts.api_key')}
                        labelPlacement='outside-left'
                        type={isVisible ? 'text' : 'password'}
                        value={config.apiKey ?? ''}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
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
                        label={t('services.tts.elevenlabs_tts.voice_id')}
                        labelPlacement='outside-left'
                        value={config.voiceId ?? 'FTYCiQT21H9XQvhRu0ch'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, voiceId: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.elevenlabs_tts.model')}
                        labelPlacement='outside-left'
                        value={config.modelId ?? 'eleven_flash_v2_5'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, modelId: v })}
                    />
                </div>
                <div className='config-item'>
                    <h3 className='my-auto'>{t('services.tts.elevenlabs_tts.mode')}</h3>
                    <div className='flex gap-2'>
                        {[
                            { key: 'wss', label: 'WebSocket', hint: t('services.tts.elevenlabs_tts.mode_wss_hint') },
                            { key: 'http', label: 'HTTP', hint: t('services.tts.elevenlabs_tts.mode_http_hint') },
                        ].map(opt => (
                            <button
                                key={opt.key}
                                type='button'
                                onClick={() => setConfig({ ...config, mode: opt.key })}
                                className={`flex-1 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                                    (config.mode ?? 'wss') === opt.key
                                        ? 'bg-secondary/20 border-secondary/50 text-secondary'
                                        : 'bg-content2 border-content3 text-default-500 hover:text-default-foreground'
                                }`}
                            >
                                <div>{opt.label}</div>
                                <div className='text-[10px] font-normal opacity-70 mt-0.5'>{opt.hint}</div>
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <Button
                        isLoading={isLoading}
                        fullWidth
                        color='primary'
                        onPress={() => {
                            setIsLoading(true);
                            tts('hello', Language.en, { config }).then(
                                () => {
                                    setIsLoading(false);
                                    setConfig(config, true);
                                    updateServiceList(instanceKey);
                                    onClose();
                                },
                                e => {
                                    setIsLoading(false);
                                    toast.error(t('config.service.test_failed') + e.toString(), { style: toastStyle });
                                }
                            );
                        }}
                    >
                        {t('common.save')}
                    </Button>
                </div>
            </>
        )
    );
}
