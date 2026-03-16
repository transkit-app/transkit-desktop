import { Input, Button, Divider, Card, CardBody, CardHeader, Select, SelectItem, Chip } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { AiFillEye, AiFillEyeInvisible } from 'react-icons/ai';
import { MdMicNone, MdVolumeUp } from 'react-icons/md';
import React, { useState, useCallback } from 'react';
import { useConfig } from '../../../../../hooks';
import toast, { Toaster } from 'react-hot-toast';
import { useToastStyle } from '../../../../../hooks';
import { open } from '@tauri-apps/api/shell';
import { fetch as tauriFetch } from '@tauri-apps/api/http';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

const API_TYPES = [
    { key: 'vieneu_stream', label: 'VieNeu (POST /synthesize)' },
    { key: 'openai_compat', label: 'OpenAI Compatible (POST /v1/audio/speech)' },
    { key: 'google', label: 'Google Translate TTS (free)' },
    { key: 'edge_tts', label: 'Microsoft Edge TTS (built-in, free)' },
];

const EDGE_VI_VOICES = [
    { key: 'vi-VN-HoaiMyNeural', label: 'vi-VN-HoaiMyNeural (Female)' },
    { key: 'vi-VN-NamMinhNeural', label: 'vi-VN-NamMinhNeural (Male)' },
];

const EDGE_EN_VOICES = [
    { key: 'en-US-EmmaMultilingualNeural', label: 'en-US-EmmaMultilingualNeural' },
    { key: 'en-US-AndrewNeural', label: 'en-US-AndrewNeural (Male)' },
    { key: 'en-US-AriaNeural', label: 'en-US-AriaNeural (Female)' },
    { key: 'en-GB-SoniaNeural', label: 'en-GB-SoniaNeural (Female)' },
];

const EDGE_VOICES = [...EDGE_VI_VOICES, ...EDGE_EN_VOICES];

export default function Audio() {
    const { t } = useTranslation();
    const toastStyle = useToastStyle();

    const [apiKey, setApiKey] = useConfig('soniox_api_key', '');
    const [ttsServerUrl, setTtsServerUrl] = useConfig('tts_server_url', 'http://localhost:8001');
    const [ttsApiType, setTtsApiType] = useConfig('tts_api_type', 'vieneu_stream');
    const [ttsVoiceId, setTtsVoiceId] = useConfig('tts_voice_id', 'NgocHuyen');
    const [ttsModel, setTtsModel] = useConfig('tts_model', 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf');
    const [ttsGoogleLang, setTtsGoogleLang] = useConfig('tts_google_lang', 'vi');
    const [ttsGoogleSpeed, setTtsGoogleSpeed] = useConfig('tts_google_speed', 1);
    const [ttsPlaybackRate, setTtsPlaybackRate] = useConfig('tts_playback_rate', 1);
    const [ttsEdgeVoice, setTtsEdgeVoice] = useConfig('tts_edge_voice', 'vi-VN-HoaiMyNeural');
    const [ttsEdgeRate, setTtsEdgeRate] = useConfig('tts_edge_rate', '+0%');
    const [ttsEdgePitch, setTtsEdgePitch] = useConfig('tts_edge_pitch', '+0Hz');

    const [isVisible, setIsVisible] = useState(false);
    const [pingStatus, setPingStatus] = useState(null); // null | 'ok' | 'fail'
    const [pinging, setPinging] = useState(false);

    const handlePing = useCallback(async () => {
        setPinging(true);
        setPingStatus(null);
        try {
            if (ttsApiType === 'edge_tts') {
                // Test the built-in Rust Edge TTS client with a short synthesis.
                const testId = 'ping-' + Math.random().toString(36).slice(2);
                let gotChunk = false;
                const unlistenChunk = await listen('edge_tts_chunk', ({ payload }) => {
                    if (payload.id === testId) gotChunk = true;
                });
                await new Promise((resolve, reject) => {
                    listen('edge_tts_done', ({ payload }) => {
                        if (payload.id !== testId) return;
                        if (payload.error) reject(new Error(payload.error));
                        else resolve();
                    });
                    invoke('synthesize_edge_tts', {
                        id: testId,
                        text: 'test',
                        voice: ttsEdgeVoice || 'vi-VN-HoaiMyNeural',
                        rate: ttsEdgeRate || '+0%',
                        pitch: ttsEdgePitch || '+0Hz',
                    }).catch(reject);
                });
                unlistenChunk();
                setPingStatus(gotChunk ? 'ok' : 'fail');
            } else if (ttsApiType === 'google') {
                const res = await tauriFetch(
                    `https://translate.google.com/translate_tts?ie=UTF-8&q=test&tl=${ttsGoogleLang || 'vi'}&client=tw-ob`,
                    { method: 'GET', timeout: 5 }
                );
                setPingStatus(res.status < 500 ? 'ok' : 'fail');
            } else {
                const base = (ttsServerUrl ?? 'http://localhost:8001').replace(/\/+$/, '');
                const endpoint = ttsApiType === 'openai_compat'
                    ? `${base}/v1/models`
                    : `${base}/voices`;
                const res = await tauriFetch(endpoint, { method: 'GET', timeout: 5 });
                setPingStatus(res.status < 500 ? 'ok' : 'fail');
            }
        } catch (e) {
            console.error('[TTS ping]', e);
            setPingStatus('fail');
        } finally {
            setPinging(false);
        }
    }, [ttsServerUrl, ttsApiType, ttsGoogleLang, ttsEdgeVoice, ttsEdgeRate, ttsEdgePitch]);

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

            {/* ── TTS ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdVolumeUp className='text-[20px] text-secondary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.tts_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    {/* API Type */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.tts_api_type')}</p>
                        <Select
                            size='sm'
                            selectedKeys={new Set([ttsApiType ?? 'vieneu_stream'])}
                            onSelectionChange={keys => setTtsApiType([...keys][0])}
                        >
                            {API_TYPES.map(a => (
                                <SelectItem key={a.key}>{a.label}</SelectItem>
                            ))}
                        </Select>
                    </div>

                    {/* Server URL — hidden for Google / Edge TTS */}
                    {ttsApiType !== 'google' && ttsApiType !== 'edge_tts' && (
                        <div className='flex flex-col gap-1'>
                            <p className='text-xs text-default-500'>{t('config.service.audio.tts_server_url')}</p>
                            <Input
                                size='sm'
                                value={ttsServerUrl ?? 'http://localhost:8001'}
                                placeholder='http://localhost:8001'
                                onValueChange={setTtsServerUrl}
                            />
                        </div>
                    )}

                    {/* Model — VieNeu / OpenAI only */}
                    {ttsApiType !== 'google' && ttsApiType !== 'edge_tts' && (
                        <div className='flex flex-col gap-1'>
                            <p className='text-xs text-default-500'>{t('config.service.audio.tts_model')}</p>
                            <Input
                                size='sm'
                                value={ttsModel ?? 'pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf'}
                                placeholder='pnnbao-ump/VieNeu-TTS-0.3B-q4-gguf'
                                onValueChange={setTtsModel}
                            />
                        </div>
                    )}

                    {/* Voice ID — VieNeu / OpenAI only */}
                    {ttsApiType !== 'google' && ttsApiType !== 'edge_tts' && (
                        <div className='flex flex-col gap-1'>
                            <p className='text-xs text-default-500'>{t('config.service.audio.tts_voice_id')}</p>
                            <Input
                                size='sm'
                                value={ttsVoiceId ?? 'NgocHuyen'}
                                placeholder='NgocHuyen'
                                onValueChange={setTtsVoiceId}
                            />
                        </div>
                    )}

                    {/* Edge TTS options — built-in, no server needed */}
                    {ttsApiType === 'edge_tts' && (
                        <>
                            <div className='flex items-center gap-2'>
                                <Chip size='sm' color='success' variant='flat'>
                                    {t('config.service.audio.tts_edge_builtin')}
                                </Chip>
                                <p className='text-xs text-default-400'>
                                    {t('config.service.audio.tts_edge_builtin_hint')}
                                </p>
                            </div>
                            <div className='flex flex-col gap-1'>
                                <p className='text-xs text-default-500'>{t('config.service.audio.tts_edge_voice')}</p>
                                <Select
                                    size='sm'
                                    selectedKeys={new Set([ttsEdgeVoice ?? 'vi-VN-HoaiMyNeural'])}
                                    onSelectionChange={keys => setTtsEdgeVoice([...keys][0])}
                                >
                                    {EDGE_VOICES.map(v => (
                                        <SelectItem key={v.key}>{v.label}</SelectItem>
                                    ))}
                                </Select>
                            </div>
                            <div className='flex flex-col gap-1'>
                                <p className='text-xs text-default-500'>{t('config.service.audio.tts_edge_rate')}</p>
                                <Input
                                    size='sm'
                                    value={ttsEdgeRate ?? '+0%'}
                                    placeholder='+0%'
                                    onValueChange={setTtsEdgeRate}
                                />
                            </div>
                            <div className='flex flex-col gap-1'>
                                <p className='text-xs text-default-500'>{t('config.service.audio.tts_edge_pitch')}</p>
                                <Input
                                    size='sm'
                                    value={ttsEdgePitch ?? '+0Hz'}
                                    placeholder='+0Hz'
                                    onValueChange={setTtsEdgePitch}
                                />
                            </div>
                        </>
                    )}

                    {/* Google TTS options */}
                    {ttsApiType === 'google' && (
                        <>
                            <div className='flex flex-col gap-1'>
                                <p className='text-xs text-default-500'>{t('config.service.audio.tts_google_lang')}</p>
                                <Input
                                    size='sm'
                                    value={ttsGoogleLang ?? 'vi'}
                                    placeholder='vi'
                                    onValueChange={setTtsGoogleLang}
                                />
                            </div>
                            <div className='flex flex-col gap-1'>
                                <p className='text-xs text-default-500'>{t('config.service.audio.tts_google_speed')}</p>
                                <Input
                                    size='sm'
                                    type='number'
                                    min={0.5}
                                    max={2}
                                    step={0.1}
                                    value={String(ttsGoogleSpeed ?? 1)}
                                    placeholder='1'
                                    onValueChange={v => setTtsGoogleSpeed(parseFloat(v) || 1)}
                                />
                            </div>
                        </>
                    )}

                    {/* Test connection */}
                    <div className='flex items-center gap-2'>
                        <Button
                            size='sm'
                            variant='flat'
                            isLoading={pinging}
                            onPress={handlePing}
                        >
                            {t('config.service.audio.tts_test')}
                        </Button>
                        {pingStatus === 'ok' && (
                            <Chip size='sm' color='success' variant='flat'>
                                {t('config.service.audio.tts_test_ok')}
                            </Chip>
                        )}
                        {pingStatus === 'fail' && (
                            <Chip size='sm' color='danger' variant='flat'>
                                {t('config.service.audio.tts_test_fail')}
                            </Chip>
                        )}
                    </div>

                    {/* Base playback rate */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.tts_playback_rate')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range'
                                min={0.5} max={3} step={0.1}
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

                    <p className='text-xs text-default-400'>
                        {t('config.service.audio.tts_hint')}
                    </p>
                </CardBody>
            </Card>
        </div>
    );
}
