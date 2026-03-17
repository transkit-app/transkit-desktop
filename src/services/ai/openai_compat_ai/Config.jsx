import { Input, Button, Textarea } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import { useToastStyle } from '../../../hooks';
import { summarize } from './index';

const DEFAULT_SYSTEM_PROMPT =
    'You are a professional translation assistant. Synthesize the provided translations into one clear, accurate, and natural result. Output only the final translation without explanation.';

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const toastStyle = useToastStyle();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.ai.openai_compat_ai.title'),
            requestPath: 'https://api.openai.com/v1/chat/completions',
            apiKey: '',
            model: 'gpt-4o-mini',
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
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
                        label={t('services.ai.openai_compat_ai.request_path')}
                        labelPlacement='outside-left'
                        value={config.requestPath ?? 'https://api.openai.com/v1/chat/completions'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, requestPath: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.ai.openai_compat_ai.api_key')}
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
                        label={t('services.ai.openai_compat_ai.model')}
                        labelPlacement='outside-left'
                        value={config.model ?? 'gpt-4o-mini'}
                        variant='bordered'
                        classNames={{
                            base: 'justify-between',
                            label: 'text-[length:--nextui-font-size-medium]',
                            mainWrapper: 'max-w-[50%]',
                        }}
                        onValueChange={v => setConfig({ ...config, model: v })}
                    />
                </div>
                <div className='config-item flex-col gap-1'>
                    <p className='text-sm'>{t('services.ai.openai_compat_ai.system_prompt')}</p>
                    <Textarea
                        variant='bordered'
                        minRows={4}
                        value={config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT}
                        onValueChange={v => setConfig({ ...config, systemPrompt: v })}
                    />
                    <p className='text-xs text-default-400'>{t('services.ai.openai_compat_ai.system_prompt_hint')}</p>
                </div>
                <div>
                    <Button
                        isLoading={isLoading}
                        fullWidth
                        color='primary'
                        onPress={() => {
                            setIsLoading(true);
                            summarize('Hello world', { config }).then(
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
