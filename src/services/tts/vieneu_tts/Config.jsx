import { Input, Button } from '@nextui-org/react';
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
    const toastStyle = useToastStyle();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.tts.vieneu_tts.title'),
            serverUrl: 'http://localhost:8001',
            voiceId: 'NgocHuyen',
            model: 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf',
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
                        label={t('services.tts.vieneu_tts.server_url')}
                        labelPlacement='outside'
                        value={config.serverUrl ?? 'http://localhost:8001'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, serverUrl: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.vieneu_tts.voice_id')}
                        labelPlacement='outside'
                        value={config.voiceId ?? 'NgocHuyen'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, voiceId: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.vieneu_tts.model')}
                        labelPlacement='outside'
                        value={config.model ?? 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, model: v })}
                    />
                </div>
                <div>
                    <Button
                        isLoading={isLoading}
                        fullWidth
                        color='primary'
                        onPress={() => {
                            setIsLoading(true);
                            setConfig(config, true);
                            updateServiceList(instanceKey);
                            tts('xin chào', Language.vi, { config }).then(
                                () => {
                                    setIsLoading(false);
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
