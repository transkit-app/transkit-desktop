import { Input, Button, Select, SelectItem } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import toast, { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import { useToastStyle } from '../../../hooks';
import { tts, Language } from './index';

// All Chirp3-HD voice personalities
const CHIRP3_VOICES = [
    { key: 'Achernar',      label: 'Achernar' },
    { key: 'Achird',        label: 'Achird' },
    { key: 'Aoede',         label: 'Aoede' },
    { key: 'Algenib',       label: 'Algenib' },
    { key: 'Algieba',       label: 'Algieba' },
    { key: 'Alnilam',       label: 'Alnilam' },
    { key: 'Autonoe',       label: 'Autonoe' },
    { key: 'Callirrhoe',    label: 'Callirrhoe' },
    { key: 'Charon',        label: 'Charon' },
    { key: 'Despina',       label: 'Despina' },
    { key: 'Enceladus',     label: 'Enceladus' },
    { key: 'Erinome',       label: 'Erinome' },
    { key: 'Fenrir',        label: 'Fenrir' },
    { key: 'Gacrux',        label: 'Gacrux' },
    { key: 'Iapetus',       label: 'Iapetus' },
    { key: 'Kore',          label: 'Kore' },
    { key: 'Laomedeia',     label: 'Laomedeia' },
    { key: 'Leda',          label: 'Leda' },
    { key: 'Orus',          label: 'Orus' },
    { key: 'Puck',          label: 'Puck' },
    { key: 'Rasalgethi',    label: 'Rasalgethi' },
    { key: 'Zephyr',        label: 'Zephyr' },
    { key: 'Zubenelgenubi', label: 'Zubenelgenubi' },
];

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isLoading, setIsLoading] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const toastStyle = useToastStyle();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.tts.google_cloud_tts.title'),
            apiKey: '',
            voice: 'Charon',
            speakingRate: '1.0',
            pitch: '0',
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
                        label={t('services.tts.google_cloud_tts.api_key')}
                        labelPlacement='outside'
                        type={isVisible ? 'text' : 'password'}
                        value={config.apiKey ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, apiKey: v })}
                        endContent={
                            <Button
                                isIconOnly size='sm' variant='light' className='h-6 w-6 min-w-0'
                                onPress={() => setIsVisible(!isVisible)}
                            >
                                {isVisible
                                    ? <AiFillEyeInvisible className='text-default-500' />
                                    : <AiFillEye className='text-default-500' />
                                }
                            </Button>
                        }
                    />
                </div>
                <div className='config-item'>
                    <p className='text-xs text-default-400'>
                        {t('services.tts.google_cloud_tts.api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://console.cloud.google.com/apis/library/texttospeech.googleapis.com')}
                        >
                            Google Cloud Console
                        </span>
                        {` → ${t('services.tts.google_cloud_tts.api_key_hint_enable')}`}
                    </p>
                </div>
                <div className='config-item'>
                    <h3 className='text-xs text-default-500 pb-1'>{t('services.tts.google_cloud_tts.voice')}</h3>
                    <Select
                        size='sm'
                        variant='bordered'
                        selectedKeys={new Set([config.voice ?? 'Charon'])}
                        onSelectionChange={keys => setConfig({ ...config, voice: [...keys][0] })}
                    >
                        {CHIRP3_VOICES.map(v => (
                            <SelectItem key={v.key}>{v.label}</SelectItem>
                        ))}
                    </Select>
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.google_cloud_tts.speaking_rate')}
                        labelPlacement='outside'
                        value={config.speakingRate ?? '1.0'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, speakingRate: v })}
                    />
                </div>
                <div className='config-item'>
                    <Input
                        label={t('services.tts.google_cloud_tts.pitch')}
                        labelPlacement='outside'
                        value={config.pitch ?? '0'}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, pitch: v })}
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
                            tts('Hello', Language.en, { config }).then(
                                () => {
                                    setIsLoading(false);
                                    onClose();
                                },
                                e => {
                                    setIsLoading(false);
                                    toast.error(
                                        t('config.service.test_failed') + e.toString(),
                                        { style: toastStyle }
                                    );
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
