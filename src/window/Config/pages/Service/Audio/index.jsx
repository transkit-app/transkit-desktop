import { Input, Button, Divider, Card, CardBody, CardHeader, Select, SelectItem, Switch } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { MdMicNone, MdVolumeUp, MdTune } from 'react-icons/md';
import React, { useState } from 'react';
import { useConfig } from '../../../../../hooks';
import toast, { Toaster } from 'react-hot-toast';
import { useToastStyle } from '../../../../../hooks';
import { open } from '@tauri-apps/api/shell';
import { getServiceName } from '../../../../../utils/service_instance';

function getTtsServiceLabel(instanceKey, t) {
    const serviceName = getServiceName(instanceKey);
    const title = t(`services.tts.${serviceName}.title`, { defaultValue: serviceName });
    if (instanceKey.includes('@')) {
        return `${title} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return title;
}

export default function Audio() {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    // ── Soniox STT ──────────────────────────────────────────────────────────────
    const [apiKey, setApiKey] = useConfig('soniox_api_key', '');
    const [sonioxEndpointDelay, setSonioxEndpointDelay] = useConfig('soniox_endpoint_delay_ms', 250);
    const [sonioxBatchInterval, setSonioxBatchInterval] = useConfig('soniox_batch_interval_ms', 100);
    const [sonioxSpeakerDiarization, setSonioxSpeakerDiarization] = useConfig('soniox_speaker_diarization', true);

    // ── TTS selector (global) ────────────────────────────────────────────────────
    const [ttsActiveService, setTtsActiveService] = useConfig('tts_active_service', 'edge_tts');
    const [ttsServiceList] = useConfig('tts_service_list', ['transkit_cloud_tts', 'google_tts', 'edge_tts']);
    const [ttsPlaybackRate, setTtsPlaybackRate] = useConfig('tts_playback_rate', 1);

    const [isVisible, setIsVisible] = useState(false);

    return (
        <div className='config-page flex flex-col gap-4 p-1'>
            <Toaster />

            {/* ── Soniox STT ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMicNone className='text-[20px] text-primary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.api_key_label')}</p>
                        <Input
                            size='sm'
                            type={isVisible ? 'text' : 'password'}
                            value={apiKey ?? ''}
                            placeholder={t('config.service.audio.api_key_placeholder')}
                            onValueChange={setApiKey}
                            endContent={
                                <Button
                                    isIconOnly size='sm' variant='light'
                                    className='h-6 w-6 min-w-0'
                                    onPress={() => setIsVisible(!isVisible)}
                                >
                                    {isVisible
                                        ? <AiFillEyeInvisible className='text-default-500' />
                                        : <AiFillEye className='text-default-500' />}
                                </Button>
                            }
                        />
                        <p className='text-xs text-default-400'>
                            {t('config.service.audio.api_key_hint')}{' '}
                            <span
                                className='text-primary cursor-pointer hover:underline'
                                onClick={() => open('https://console.soniox.com/signup')}
                            >
                                console.soniox.com
                            </span>
                        </p>
                    </div>
                    <Divider />
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.info_label')}</p>
                        <p className='text-xs text-default-400'>{t('config.service.audio.info_desc')}</p>
                    </div>
                </CardBody>
            </Card>

            {/* ── Soniox Advanced ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdTune className='text-[20px] text-warning' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.soniox_advanced_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.soniox_endpoint_delay')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range' min={50} max={2000} step={50}
                                value={sonioxEndpointDelay ?? 250}
                                onChange={e => setSonioxEndpointDelay(parseInt(e.target.value))}
                                className='flex-1 accent-warning'
                            />
                            <span className='text-xs text-default-500 w-16 text-right font-mono'>
                                {sonioxEndpointDelay ?? 250} ms
                            </span>
                        </div>
                        <p className='text-xs text-default-400'>{t('config.service.audio.soniox_endpoint_delay_hint')}</p>
                    </div>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.soniox_batch_interval')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range' min={20} max={500} step={10}
                                value={sonioxBatchInterval ?? 100}
                                onChange={e => setSonioxBatchInterval(parseInt(e.target.value))}
                                className='flex-1 accent-warning'
                            />
                            <span className='text-xs text-default-500 w-16 text-right font-mono'>
                                {sonioxBatchInterval ?? 100} ms
                            </span>
                        </div>
                        <p className='text-xs text-default-400'>{t('config.service.audio.soniox_batch_interval_hint')}</p>
                    </div>
                    <div className='flex flex-col gap-1'>
                        <div className='flex items-center justify-between'>
                            <p className='text-xs text-default-500'>{t('config.service.audio.soniox_speaker_diarization')}</p>
                            <Switch
                                size='sm'
                                isSelected={sonioxSpeakerDiarization !== false}
                                onValueChange={setSonioxSpeakerDiarization}
                                color='warning'
                            />
                        </div>
                        <p className='text-xs text-default-400'>{t('config.service.audio.soniox_speaker_diarization_hint')}</p>
                    </div>
                </CardBody>
            </Card>

            {/* ── TTS Playback ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdVolumeUp className='text-[20px] text-secondary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.tts_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.tts_active_service')}</p>
                        <Select
                            size='sm'
                            selectedKeys={ttsActiveService ? new Set([ttsActiveService]) : new Set()}
                            onSelectionChange={keys => {
                                const key = [...keys][0];
                                if (key) setTtsActiveService(key);
                            }}
                        >
                            {(ttsServiceList ?? []).map(instanceKey => (
                                <SelectItem key={instanceKey} textValue={getTtsServiceLabel(instanceKey, t)}>
                                    {getTtsServiceLabel(instanceKey, t)}
                                </SelectItem>
                            ))}
                        </Select>
                        <p className='text-xs text-default-400'>{t('config.service.audio.tts_active_service_hint')}</p>
                    </div>

                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.tts_playback_rate')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range' min={0.5} max={3} step={0.1}
                                value={ttsPlaybackRate ?? 1}
                                onChange={e => setTtsPlaybackRate(parseFloat(e.target.value))}
                                className='flex-1 accent-secondary'
                            />
                            <span className='text-xs text-default-500 w-10 text-right font-mono'>
                                {(ttsPlaybackRate ?? 1).toFixed(1)}×
                            </span>
                        </div>
                        <p className='text-xs text-default-400'>{t('config.service.audio.tts_playback_rate_hint')}</p>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
