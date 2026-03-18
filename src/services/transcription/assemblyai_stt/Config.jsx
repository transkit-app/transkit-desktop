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
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.assemblyai_stt.title'),
            apiKey: '',
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
                        label={t('services.transcription.assemblyai_stt.api_key')}
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
                        {t('services.transcription.assemblyai_stt.api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://app.assemblyai.com')}
                        >
                            app.assemblyai.com
                        </span>
                    </p>
                </div>
                <div className='config-item'>
                    <p className='text-xs text-default-400 italic'>
                        {t('services.transcription.assemblyai_stt.no_translation_note')}
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
