import { Input, Button, Select, SelectItem, Switch } from '@nextui-org/react';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { Toaster } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import React, { useState } from 'react';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';

const DEEPGRAM_MODELS = [
    { key: 'nova-3', label: 'Nova-3 (latest)' },
    { key: 'nova-2', label: 'Nova-2' },
    { key: 'nova',   label: 'Nova' },
    { key: 'enhanced', label: 'Enhanced' },
    { key: 'base',   label: 'Base' },
];

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();
    const [isDeepgramVisible, setIsDeepgramVisible] = useState(false);
    const [isGoogleVisible, setIsGoogleVisible] = useState(false);

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t('services.transcription.deepgram_stt.title'),
            apiKey: '',
            googleApiKey: '',
            model: 'nova-3',
            endpointing: 100,
            batchIntervalMs: 100,
            speakerDiarization: true,
            provisionalTimeoutMs: 1500,
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

                {/* Deepgram API Key */}
                <div className='config-item'>
                    <Input
                        label={t('services.transcription.deepgram_stt.api_key')}
                        labelPlacement='outside'
                        type={isDeepgramVisible ? 'text' : 'password'}
                        value={config.apiKey ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, apiKey: v })}
                        endContent={
                            <Button isIconOnly size='sm' variant='light' className='h-6 w-6 min-w-0' onPress={() => setIsDeepgramVisible(!isDeepgramVisible)}>
                                {isDeepgramVisible ? <AiFillEyeInvisible className='text-default-500' /> : <AiFillEye className='text-default-500' />}
                            </Button>
                        }
                    />
                </div>
                <div className='config-item'>
                    <p className='text-xs text-default-400'>
                        {t('services.transcription.deepgram_stt.api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://console.deepgram.com/signup')}
                        >
                            console.deepgram.com
                        </span>
                    </p>
                </div>

                {/* Google Cloud Translation API Key */}
                <div className='config-item'>
                    <Input
                        label={t('services.transcription.deepgram_stt.google_api_key')}
                        labelPlacement='outside'
                        type={isGoogleVisible ? 'text' : 'password'}
                        value={config.googleApiKey ?? ''}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onValueChange={v => setConfig({ ...config, googleApiKey: v })}
                        endContent={
                            <Button isIconOnly size='sm' variant='light' className='h-6 w-6 min-w-0' onPress={() => setIsGoogleVisible(!isGoogleVisible)}>
                                {isGoogleVisible ? <AiFillEyeInvisible className='text-default-500' /> : <AiFillEye className='text-default-500' />}
                            </Button>
                        }
                    />
                </div>
                <div className='config-item'>
                    <p className='text-xs text-default-400'>
                        {t('services.transcription.deepgram_stt.google_api_key_hint')}{' '}
                        <span
                            className='text-primary cursor-pointer hover:underline'
                            onClick={() => open('https://console.cloud.google.com/apis/library/translate.googleapis.com')}
                        >
                            Google Cloud Console
                        </span>
                        {'. '}
                        {t('services.transcription.deepgram_stt.google_api_key_optional')}
                    </p>
                </div>

                {/* Model */}
                <div className='config-item'>
                    <Select
                        label={t('services.transcription.deepgram_stt.model')}
                        labelPlacement='outside'
                        selectedKeys={[config.model ?? 'nova-3']}
                        variant='bordered'
                        classNames={{ label: 'text-xs text-default-500 pb-1' }}
                        onSelectionChange={keys => setConfig({ ...config, model: [...keys][0] })}
                    >
                        {DEEPGRAM_MODELS.map(m => (
                            <SelectItem key={m.key} value={m.key}>{m.label}</SelectItem>
                        ))}
                    </Select>
                </div>

                {/* Endpointing */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.deepgram_stt.endpointing')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={10} max={2000} step={10}
                            value={config.endpointing ?? 100}
                            onChange={e => setConfig({ ...config, endpointing: parseInt(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {config.endpointing ?? 100} ms
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.deepgram_stt.endpointing_hint')}</p>
                </div>

                {/* Batch interval */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.deepgram_stt.batch_interval')}</p>
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
                    <p className='text-xs text-default-400'>{t('services.transcription.deepgram_stt.batch_interval_hint')}</p>
                </div>

                {/* Provisional timeout */}
                <div className='config-item-row flex-col gap-1'>
                    <p className='text-sm'>{t('services.transcription.deepgram_stt.provisional_timeout')}</p>
                    <div className='flex items-center gap-3'>
                        <input
                            type='range' min={500} max={5000} step={100}
                            value={config.provisionalTimeoutMs ?? 1500}
                            onChange={e => setConfig({ ...config, provisionalTimeoutMs: parseInt(e.target.value) })}
                            className='flex-1 accent-warning'
                        />
                        <span className='text-xs text-default-500 w-16 text-right font-mono'>
                            {config.provisionalTimeoutMs ?? 1500} ms
                        </span>
                    </div>
                    <p className='text-xs text-default-400'>{t('services.transcription.deepgram_stt.provisional_timeout_hint')}</p>
                </div>

                {/* Speaker diarization */}
                <div className='config-item'>
                    <div className='flex items-center justify-between w-full'>
                        <div className='flex flex-col gap-0.5'>
                            <p className='text-sm'>{t('services.transcription.deepgram_stt.speaker_diarization')}</p>
                            <p className='text-xs text-default-400'>{t('services.transcription.deepgram_stt.speaker_diarization_hint')}</p>
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
