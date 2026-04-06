import { Card, CardBody, CardHeader, Select, SelectItem, Switch, Slider } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { MdMic, MdLanguage, MdTune } from 'react-icons/md';
import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useConfig } from '../../../../hooks';
import { getServiceName } from '../../../../utils/service_instance';
import { store } from '../../../../utils/store';

function getTranscriptionServiceLabel(instanceKey, t) {
    const serviceName = getServiceName(instanceKey);
    const title = t(`services.transcription.${serviceName}.title`, { defaultValue: serviceName });
    if (instanceKey.includes('@')) {
        return `${title} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return title;
}

const INJECT_MODES = ['replace', 'append'];
const FAB_SIZES = [48, 56, 64, 72, 88, 104];

export default function VoiceInput() {
    const { t } = useTranslation();

    // STT service — inherits from Audio Monitor by default
    const [transcriptionServiceList] = useConfig('transcription_service_list', ['deepgram_stt']);
    const [voiceSttService, setVoiceSttService] = useConfig('voice_anywhere_stt_service', 'inherit');

    // Language — inherits from Audio Monitor source lang by default
    const [voiceLanguage, setVoiceLanguage] = useConfig('voice_anywhere_language', 'auto');

    // Inject mode (replace | append)
    const [injectMode, setInjectMode] = useConfig('voice_anywhere_inject_mode', 'replace');

    // Auto-start recording when hotkey fires
    const [autostart, setAutostart] = useConfig('voice_anywhere_autostart', true);
    const [showContextMenu, setShowContextMenu] = useConfig('voice_anywhere_show_context_menu', true);
    const [preferAsyncApi, setPreferAsyncApi] = useConfig('voice_anywhere_prefer_async_api', true);

    // FAB size
    const [fabSize, setFabSize] = useConfig('voice_anywhere_fab_size', 72);

    // Always visible — show FAB without needing to press the hotkey
    const [alwaysVisible, setAlwaysVisible] = useConfig('voice_anywhere_always_visible', false);
    const handleAlwaysVisibleChange = async (value) => {
        setAlwaysVisible(value);
        try {
            if (value) {
                await invoke('show_voice_anywhere_window');
            } else {
                await invoke('hide_voice_anywhere_window');
            }
        } catch (e) {
            console.error('voice_anywhere window toggle failed:', e);
        }
    };

    // Build display names for transcription services
    const [svcDisplayNames, setSvcDisplayNames] = React.useState({});
    React.useEffect(() => {
        if (!transcriptionServiceList?.length) return;
        Promise.all(
            transcriptionServiceList.map(async (key) => {
                const cfg = await store.get(key).catch(() => null);
                const displayName = cfg?.instanceName || cfg?.service_instance_name || getTranscriptionServiceLabel(key, t);
                return [key, displayName];
            })
        ).then((pairs) => setSvcDisplayNames(Object.fromEntries(pairs)));
    }, [transcriptionServiceList, t]);

    return (
        <div className='flex flex-col gap-4'>
            {/* STT Service */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdMic className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>{t('config.voice_input.stt_section', { defaultValue: 'Speech Recognition' })}</h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <h3 className='my-auto'>{t('config.voice_input.stt_service', { defaultValue: 'STT Service' })}</h3>
                        <Select
                            variant='bordered'
                            selectedKeys={voiceSttService ? [voiceSttService] : ['inherit']}
                            className='max-w-[50%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setVoiceSttService(v);
                            }}
                        >
                            <SelectItem key='inherit'>
                                {t('config.voice_input.inherit_monitor', { defaultValue: 'Same as Audio Monitor' })}
                            </SelectItem>
                            {(transcriptionServiceList ?? []).map((key) => (
                                <SelectItem key={key}>
                                    {svcDisplayNames[key] ?? getTranscriptionServiceLabel(key, t)}
                                </SelectItem>
                            ))}
                        </Select>
                    </div>

                    <div className='config-item'>
                        <h3 className='my-auto'>{t('config.voice_input.language', { defaultValue: 'Language' })}</h3>
                        <Select
                            variant='bordered'
                            selectedKeys={[voiceLanguage ?? 'auto']}
                            className='max-w-[50%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setVoiceLanguage(v);
                            }}
                        >
                            <SelectItem key='auto'>
                                {t('config.voice_input.auto_detect', { defaultValue: 'Same as Audio Monitor' })}
                            </SelectItem>
                            <SelectItem key='en'>English</SelectItem>
                            <SelectItem key='vi'>Tiếng Việt</SelectItem>
                            <SelectItem key='zh'>中文</SelectItem>
                            <SelectItem key='ja'>日本語</SelectItem>
                            <SelectItem key='ko'>한국어</SelectItem>
                            <SelectItem key='fr'>Français</SelectItem>
                            <SelectItem key='de'>Deutsch</SelectItem>
                            <SelectItem key='es'>Español</SelectItem>
                            <SelectItem key='pt'>Português</SelectItem>
                            <SelectItem key='ru'>Русский</SelectItem>
                            <SelectItem key='ar'>العربية</SelectItem>
                        </Select>
                    </div>
                </CardBody>
            </Card>

            {/* Behaviour */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdTune className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>{t('config.voice_input.behaviour_section', { defaultValue: 'Behaviour' })}</h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.inject_mode', { defaultValue: 'Text Injection Mode' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.inject_mode_desc', { defaultValue: 'Replace: clears existing text. Append: adds after current text.' })}
                            </p>
                        </div>
                        <Select
                            variant='bordered'
                            selectedKeys={[injectMode ?? 'replace']}
                            className='max-w-[50%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setInjectMode(v);
                            }}
                        >
                            {INJECT_MODES.map((m) => (
                                <SelectItem key={m}>
                                    {t(`config.voice_input.inject_mode_${m}`, { defaultValue: m.charAt(0).toUpperCase() + m.slice(1) })}
                                </SelectItem>
                            ))}
                        </Select>
                    </div>

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.autostart', { defaultValue: 'Auto-start recording on hotkey' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.autostart_desc', { defaultValue: 'Immediately begin recording when the hotkey is pressed.' })}
                            </p>
                        </div>
                        <Switch
                            isSelected={autostart ?? true}
                            onValueChange={setAutostart}
                        />
                    </div>

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.always_visible', { defaultValue: 'Always visible' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.always_visible_desc', { defaultValue: 'Keep the mic button on screen at all times. No hotkey needed.' })}
                            </p>
                        </div>
                        <Switch
                            isSelected={alwaysVisible ?? false}
                            onValueChange={handleAlwaysVisibleChange}
                        />
                    </div>

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.show_context_menu', { defaultValue: 'Show context menu on icon' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.show_context_menu_desc', { defaultValue: 'Enable right-click on the Voice Anywhere button to open provider and action shortcuts.' })}
                            </p>
                        </div>
                        <Switch
                            isSelected={showContextMenu ?? true}
                            onValueChange={setShowContextMenu}
                        />
                    </div>

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.prefer_async_api', { defaultValue: 'Use async STT API when available' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.prefer_async_api_desc', { defaultValue: 'Recommended for dictation. Voice Anywhere records continuously until you stop, then sends the full audio to supported providers and falls back to realtime when unsupported.' })}
                            </p>
                        </div>
                        <Switch
                            isSelected={preferAsyncApi ?? false}
                            onValueChange={setPreferAsyncApi}
                        />
                    </div>
                </CardBody>
            </Card>

            {/* FAB appearance */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdLanguage className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>{t('config.voice_input.appearance_section', { defaultValue: 'Button Appearance' })}</h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.fab_size', { defaultValue: 'Button Size' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>{fabSize ?? 72} px</p>
                        </div>
                        <div className='max-w-[50%] w-full'>
                            <Slider
                                step={8}
                                minValue={48}
                                maxValue={104}
                                value={fabSize ?? 72}
                                onChange={setFabSize}
                                className='w-full'
                            />
                        </div>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
