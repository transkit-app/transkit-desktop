import { Input, Button, Textarea } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../utils/service_instance';
import { useConfig } from '../../hooks/useConfig';
import { useToastStyle } from '../../hooks';

const DEFAULT_SYSTEM_PROMPT =
    'You are a professional translation assistant. Synthesize the provided translations into one clear, accurate, and natural result. Output only the final translation without explanation.';

/**
 * @param {string} serviceName  — i18n key prefix, e.g. 'openai_ai'
 * @param {object} defaults     — { requestPath, model } overrides
 * @param {function} summarizeFn — the service's summarize() export
 */
export function makeAiConfig(serviceName, defaults, summarizeFn) {
    return function Config(props) {
        const { instanceKey, updateServiceList, onClose } = props;
        const { t } = useTranslation();
        const [isLoading, setIsLoading] = useState(false);
        const [isVisible, setIsVisible] = useState(false);
        const toastStyle = useToastStyle();

        const [config, setConfig] = useConfig(
            instanceKey,
            {
                [INSTANCE_NAME_CONFIG_KEY]: t(`services.ai.${serviceName}.title`),
                requestPath: defaults.requestPath,
                apiKey: '',
                model: defaults.model,
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
                            labelPlacement='outside'
                            value={config[INSTANCE_NAME_CONFIG_KEY]}
                            variant='bordered'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            onValueChange={v => setConfig({ ...config, [INSTANCE_NAME_CONFIG_KEY]: v })}
                        />
                    </div>
                    <div className='config-item'>
                        <Input
                            label={t('services.ai.openai_compat_ai.request_path')}
                            labelPlacement='outside'
                            value={config.requestPath ?? defaults.requestPath}
                            variant='bordered'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
                            onValueChange={v => setConfig({ ...config, requestPath: v })}
                        />
                    </div>
                    <div className='config-item'>
                        <Input
                            label={t('services.ai.openai_compat_ai.api_key')}
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
                            label={t('services.ai.openai_compat_ai.model')}
                            labelPlacement='outside'
                            value={config.model ?? defaults.model}
                            variant='bordered'
                            classNames={{ label: 'text-xs text-default-500 pb-1' }}
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
                                summarizeFn('Hello world', { config }).then(
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
    };
}
