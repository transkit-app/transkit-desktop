import { Card, CardBody, CardHeader, Select, SelectItem, Switch } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { MdMicNone, MdVolumeUp, MdSaveAlt, MdAutoAwesome } from 'react-icons/md';
import React from 'react';
import { useConfig } from '../../../../hooks';
import { Toaster } from 'react-hot-toast';
import { getServiceName } from '../../../../utils/service_instance';
import { store } from '../../../../utils/store';

function getAiServiceLabel(instanceKey) {
    const serviceName = getServiceName(instanceKey);
    if (instanceKey.includes('@')) {
        return `${serviceName} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return serviceName;
}

function getTranscriptionServiceLabel(instanceKey, t) {
    const serviceName = getServiceName(instanceKey);
    const title = t(`services.transcription.${serviceName}.title`, { defaultValue: serviceName });
    if (instanceKey.includes('@')) {
        return `${title} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return title;
}

function getTtsServiceLabel(instanceKey, t) {
    const serviceName = getServiceName(instanceKey);
    const title = t(`services.tts.${serviceName}.title`, { defaultValue: serviceName });
    if (instanceKey.includes('@')) {
        return `${title} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return title;
}

export default function AudioTranslate() {
    const { t } = useTranslation();

    // ── Transcription provider selector ──────────────────────────────────────
    const [transcriptionServiceList] = useConfig('transcription_service_list', ['soniox_stt']);
    const [activeTranscriptionService, setActiveTranscriptionService] = useConfig('transcription_active_service', 'soniox_stt');

    // ── Auto-save ────────────────────────────────────────────────────────────
    const [autosaveEnabled, setAutosaveEnabled] = useConfig('monitor_autosave_enabled', false);

    // ── AI Suggestion ────────────────────────────────────────────────────────
    const [aiServiceList] = useConfig('ai_service_list', []);
    const [aiSuggestionService, setAiSuggestionService] = useConfig('monitor_ai_suggestion_service', '');
    const [aiSuggestionContextLines, setAiSuggestionContextLines] = useConfig('monitor_ai_suggestion_context_lines', 10);
    const [aiSuggestionResponseLang, setAiSuggestionResponseLang] = useConfig('monitor_ai_suggestion_response_lang', 'both');
    const [aiSuggestionFontSize, setAiSuggestionFontSize] = useConfig('monitor_ai_suggestion_font_size', 16);
    const [aiServiceNames, setAiServiceNames] = React.useState({});

    React.useEffect(() => {
        if (!aiServiceList?.length) return;
        Promise.all(
            aiServiceList.map(async key => {
                const cfg = await store.get(key).catch(() => null);
                const displayName = cfg?.instanceName || cfg?.service_instance_name || getAiServiceLabel(key);
                return [key, displayName];
            })
        ).then(pairs => setAiServiceNames(Object.fromEntries(pairs)));
    }, [aiServiceList?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── TTS selector (global) ────────────────────────────────────────────────
    const [ttsActiveService, setTtsActiveService] = useConfig('tts_active_service', 'edge_tts');
    const [ttsServiceList] = useConfig('tts_service_list', ['google_tts', 'edge_tts']);
    const [ttsPlaybackRate, setTtsPlaybackRate] = useConfig('tts_playback_rate', 1);

    return (
        <div className='config-page flex flex-col gap-4 p-1'>
            <Toaster />

            {/* ── Transcription Provider ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMicNone className='text-[20px] text-primary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.stt_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.stt_active_service')}</p>
                        <Select
                            size='sm'
                            selectedKeys={activeTranscriptionService ? new Set([activeTranscriptionService]) : new Set()}
                            onSelectionChange={keys => {
                                const key = [...keys][0];
                                if (key) setActiveTranscriptionService(key);
                            }}
                        >
                            {(transcriptionServiceList ?? []).map(instanceKey => (
                                <SelectItem key={instanceKey} textValue={getTranscriptionServiceLabel(instanceKey, t)}>
                                    {getTranscriptionServiceLabel(instanceKey, t)}
                                </SelectItem>
                            ))}
                        </Select>
                        <p className='text-xs text-default-400'>{t('config.service.audio.stt_active_service_hint')}</p>
                    </div>
                </CardBody>
            </Card>

            {/* ── Transcript Auto-save ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdSaveAlt className='text-[20px] text-primary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.autosave_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-2'>
                    <div className='flex items-center justify-between'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.autosave_enable_label')}</p>
                        <Switch
                            size='sm'
                            isSelected={autosaveEnabled === true}
                            onValueChange={setAutosaveEnabled}
                            color='primary'
                        />
                    </div>
                    <p className='text-xs text-default-400'>{t('config.service.audio.autosave_enable_hint')}</p>
                </CardBody>
            </Card>

            {/* ── AI Suggestion ── */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdAutoAwesome className='text-[20px] text-secondary' />
                    <p className='text-sm font-semibold'>{t('config.service.audio.ai_suggestion_title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-3'>
                    {/* Provider */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.ai_suggestion_service')}</p>
                        {aiServiceList?.length > 0 ? (
                            <Select
                                size='sm'
                                selectedKeys={aiSuggestionService ? new Set([aiSuggestionService]) : new Set()}
                                onSelectionChange={keys => {
                                    const key = [...keys][0];
                                    if (key) setAiSuggestionService(key);
                                }}
                                placeholder={t('config.service.audio.ai_suggestion_service_placeholder')}
                            >
                                {(aiServiceList ?? []).map(key => (
                                    <SelectItem key={key} textValue={aiServiceNames[key] || getAiServiceLabel(key)}>
                                        {aiServiceNames[key] || getAiServiceLabel(key)}
                                    </SelectItem>
                                ))}
                            </Select>
                        ) : (
                            <p className='text-xs text-danger'>{t('config.service.audio.ai_suggestion_no_service')}</p>
                        )}
                    </div>

                    {/* Response language */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.ai_suggestion_response_lang')}</p>
                        <Select
                            size='sm'
                            selectedKeys={new Set([aiSuggestionResponseLang ?? 'both'])}
                            onSelectionChange={keys => {
                                const key = [...keys][0];
                                if (key) setAiSuggestionResponseLang(key);
                            }}
                        >
                            <SelectItem key='both'>{t('config.service.audio.ai_suggestion_lang_both')}</SelectItem>
                            <SelectItem key='source'>{t('config.service.audio.ai_suggestion_lang_source')}</SelectItem>
                            <SelectItem key='target'>{t('config.service.audio.ai_suggestion_lang_target')}</SelectItem>
                        </Select>
                        <p className='text-xs text-default-400'>{t('config.service.audio.ai_suggestion_response_lang_hint')}</p>
                    </div>

                    {/* Context lines */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.ai_suggestion_context_lines')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range' min={3} max={20} step={1}
                                value={aiSuggestionContextLines ?? 10}
                                onChange={e => setAiSuggestionContextLines(parseInt(e.target.value))}
                                className='flex-1 accent-secondary'
                            />
                            <span className='text-xs text-default-500 w-8 text-right font-mono tabular-nums'>
                                {aiSuggestionContextLines ?? 10}
                            </span>
                        </div>
                        <p className='text-xs text-default-400'>{t('config.service.audio.ai_suggestion_context_lines_hint')}</p>
                    </div>

                    {/* Font size */}
                    <div className='flex flex-col gap-1'>
                        <p className='text-xs text-default-500'>{t('config.service.audio.ai_suggestion_font_size')}</p>
                        <div className='flex items-center gap-3'>
                            <input
                                type='range' min={11} max={24} step={1}
                                value={aiSuggestionFontSize ?? 16}
                                onChange={e => setAiSuggestionFontSize(parseInt(e.target.value))}
                                className='flex-1 accent-secondary'
                            />
                            <span className='text-xs text-default-500 w-10 text-right font-mono tabular-nums'>
                                {aiSuggestionFontSize ?? 16}px
                            </span>
                        </div>
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
