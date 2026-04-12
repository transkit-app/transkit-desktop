import { Card, CardBody, CardHeader, Select, SelectItem, Switch, Slider, Textarea } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { MdMic, MdLanguage, MdTune, MdAutoFixHigh, MdAdd, MdDeleteOutline, MdRestartAlt } from 'react-icons/md';
import { POLISH_LEVEL_LABELS, AI_SERVICE_FRIENDLY_NAMES, DEFAULT_PROMPTS, BUILTIN_LEVELS } from '../../../../utils/polishTranscript';
import React from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { useConfig } from '../../../../hooks';
import { getServiceName } from '../../../../utils/service_instance';
import { store } from '../../../../utils/store';
import * as builtinTranscriptionServices from '../../../../services/transcription';

function getTranscriptionServiceLabel(instanceKey, t) {
    const serviceName = getServiceName(instanceKey);
    const title = t(`services.transcription.${serviceName}.title`, { defaultValue: serviceName });
    if (instanceKey.includes('@')) {
        return `${title} (${instanceKey.split('@')[1].slice(0, 6)})`;
    }
    return title;
}

const ACTIONS      = ['clipboard', 'paste'];
const INJECT_MODES = ['replace', 'append'];
const FAB_SIZES = [48, 56, 64, 72, 88, 104];
const DEFAULT_IDLE_BUTTON_COLOR = '#3f3f46';

export default function VoiceInput() {
    const { t } = useTranslation();

    // STT service — inherits from Audio Monitor by default
    const [transcriptionServiceList] = useConfig('transcription_service_list', ['deepgram_stt']);
    const [voiceSttService, setVoiceSttService] = useConfig('voice_anywhere_stt_service', 'inherit');

    // Language — inherits from Audio Monitor source lang by default
    const [voiceLanguage, setVoiceLanguage] = useConfig('voice_anywhere_language', 'auto');
    const [targetLanguage, setTargetLanguage] = useConfig('voice_anywhere_target_language', 'none');

    // After-stop action for external apps: clipboard | paste
    const [action, setAction] = useConfig('voice_anywhere_action', 'clipboard');
    // Text injection mode for Transkit windows: replace | append
    const [injectMode, setInjectMode] = useConfig('voice_anywhere_inject_mode', 'replace');

    // Polish — AI middleware between STT transcript and inject/paste
    const [polishEnabled, setPolishEnabled] = useConfig('voice_anywhere_polish_enabled', false);
    const [polishLevel, setPolishLevel] = useConfig('voice_anywhere_polish_level', 'mild');
    const [polishService, setPolishService] = useConfig('voice_anywhere_polish_service', '');
    const [polishPromptOverrides, setPolishPromptOverrides] = useConfig('voice_anywhere_polish_prompt_overrides', {});
    const [polishCustomLevels, setPolishCustomLevels] = useConfig('voice_anywhere_polish_custom_levels', []);
    const [aiServiceList] = useConfig('ai_service_list', []);
    const [aiDisplayNames, setAiDisplayNames] = React.useState({});
    React.useEffect(() => {
        if (!aiServiceList?.length) return;
        Promise.all(
            aiServiceList.map(async (key) => {
                const cfg = await store.get(key).catch(() => null);
                const svcName = getServiceName(key);
                const label = cfg?.instanceName || cfg?.service_instance_name
                    || AI_SERVICE_FRIENDLY_NAMES[svcName]
                    || svcName;
                return [key, label];
            })
        ).then((pairs) => setAiDisplayNames(Object.fromEntries(pairs)));
    }, [aiServiceList]);

    // Derived: the prompt currently shown in the editor
    const currentLevelPrompt = React.useMemo(() => {
        if (BUILTIN_LEVELS.includes(polishLevel)) {
            return (polishPromptOverrides ?? {})[polishLevel] ?? DEFAULT_PROMPTS[polishLevel] ?? '';
        }
        return (polishCustomLevels ?? []).find(c => c.key === polishLevel)?.prompt ?? '';
    }, [polishLevel, polishPromptOverrides, polishCustomLevels]);

    const isPromptModified = BUILTIN_LEVELS.includes(polishLevel) && !!(polishPromptOverrides ?? {})[polishLevel];

    const handlePromptChange = React.useCallback((val) => {
        if (BUILTIN_LEVELS.includes(polishLevel)) {
            setPolishPromptOverrides({ ...(polishPromptOverrides ?? {}), [polishLevel]: val });
        } else {
            setPolishCustomLevels((polishCustomLevels ?? []).map(c =>
                c.key === polishLevel ? { ...c, prompt: val } : c
            ));
        }
    }, [polishLevel, polishPromptOverrides, polishCustomLevels, setPolishPromptOverrides, setPolishCustomLevels]);

    const handlePromptReset = React.useCallback(() => {
        const next = { ...(polishPromptOverrides ?? {}) };
        delete next[polishLevel];
        setPolishPromptOverrides(next);
    }, [polishLevel, polishPromptOverrides, setPolishPromptOverrides]);

    const handleAddCustomLevel = React.useCallback(() => {
        const idx = (polishCustomLevels ?? []).length + 1;
        const key = `custom_${Date.now()}`;
        const newLevel = { key, label: `Custom ${idx}`, prompt: DEFAULT_PROMPTS.mild };
        setPolishCustomLevels([...(polishCustomLevels ?? []), newLevel]);
        setPolishLevel(key);
    }, [polishCustomLevels, setPolishCustomLevels, setPolishLevel]);

    const handleDeleteCustomLevel = React.useCallback(() => {
        setPolishCustomLevels((polishCustomLevels ?? []).filter(c => c.key !== polishLevel));
        setPolishLevel('mild');
    }, [polishLevel, polishCustomLevels, setPolishCustomLevels, setPolishLevel]);

    // Auto-start recording when hotkey fires
    const [autostart, setAutostart] = useConfig('voice_anywhere_autostart', true);
    const [sfxEnabled, setSfxEnabled] = useConfig('voice_anywhere_sfx_enabled', true);
    const [showContextMenu, setShowContextMenu] = useConfig('voice_anywhere_show_context_menu', true);
    const [preferAsyncApi, setPreferAsyncApi] = useConfig('voice_anywhere_prefer_async_api', true);

    // FAB size
    const [fabSize, setFabSize] = useConfig('voice_anywhere_fab_size', 72);
    const [idleButtonColor, setIdleButtonColor] = useConfig('voice_anywhere_idle_button_color', DEFAULT_IDLE_BUTTON_COLOR);

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

    // Sync tray menu whenever VA quick-access settings change from this UI.
    // Rust handlers already call update_tray() for tray-initiated changes;
    // this covers changes made inside the Config window.
    React.useEffect(() => {
        invoke('update_tray', { language: '', copyMode: '' }).catch(() => {});
    }, [voiceSttService, voiceLanguage, action, injectMode]);

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
                            {Object.keys(builtinTranscriptionServices)
                                .filter((name) =>
                                    builtinTranscriptionServices[name].info?.voiceInputOnly &&
                                    !(transcriptionServiceList ?? []).some((k) => getServiceName(k) === name)
                                )
                                .map((name) => (
                                    <SelectItem key={name}>
                                        {t(`services.transcription.${name}.title`, { defaultValue: name })}
                                    </SelectItem>
                                ))
                            }
                        </Select>
                    </div>

                    <div className='config-item'>
                        <h3 className='my-auto'>{t('config.voice_input.language', { defaultValue: 'Source Language' })}</h3>
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

                    <div className='config-item'>
                        <h3 className='my-auto'>{t('config.voice_input.target_language', { defaultValue: 'Target Language (Translate)' })}</h3>
                        <Select
                            variant='bordered'
                            selectedKeys={[targetLanguage ?? 'none']}
                            className='max-w-[50%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setTargetLanguage(v);
                            }}
                        >
                            <SelectItem key='none'>
                                {t('config.voice_input.no_translate', { defaultValue: 'No translate (Dictation)' })}
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
                            <h3>{t('config.voice_input.action', { defaultValue: 'After Stop Action' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.action_desc', { defaultValue: 'Clipboard: copy text only. Paste: re-focus last app and paste automatically.' })}
                            </p>
                        </div>
                        <Select
                            variant='bordered'
                            selectedKeys={[action ?? 'clipboard']}
                            className='max-w-[50%]'
                            onSelectionChange={(keys) => {
                                const v = Array.from(keys)[0];
                                if (v) setAction(v);
                            }}
                        >
                            {ACTIONS.map((a) => (
                                <SelectItem key={a}>
                                    {t(`config.voice_input.action_${a}`, { defaultValue: a === 'clipboard' ? 'Clipboard' : 'Paste to last app' })}
                                </SelectItem>
                            ))}
                        </Select>
                    </div>

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.inject_mode', { defaultValue: 'Text Injection (Transkit windows)' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.inject_mode_desc', { defaultValue: 'Replace: clears existing text. Append: adds after current text. Only applies when a Transkit window is focused.' })}
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
                            <h3>{t('config.voice_input.sfx_enabled', { defaultValue: 'Enable start/stop sounds' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.sfx_enabled_desc', { defaultValue: 'Play an auditory chime when recording starts or stops.' })}
                            </p>
                        </div>
                        <Switch
                            isSelected={sfxEnabled ?? true}
                            onValueChange={setSfxEnabled}
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

            {/* Polish */}
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdAutoFixHigh className='text-lg text-brand-500' />
                    <h3 className='font-semibold text-sm'>{t('config.voice_input.polish_section', { defaultValue: 'Transcript Polish (AI)' })}</h3>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.polish_enabled', { defaultValue: 'Enable Polish' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.polish_enabled_desc', { defaultValue: 'Pass the transcript through an AI service before injecting/pasting.' })}
                            </p>
                        </div>
                        <Switch isSelected={polishEnabled ?? false} onValueChange={setPolishEnabled} />
                    </div>

                    {polishEnabled && (<>
                        {/* Level selector + add/delete custom level */}
                        <div className='config-item'>
                            <div>
                                <h3>{t('config.voice_input.polish_level', { defaultValue: 'Polish Level' })}</h3>
                                <p className='text-xs text-default-400 mt-0.5'>
                                    {t('config.voice_input.polish_level_desc', { defaultValue: 'Mild: fix errors only. Medium: improve fluency. Aggressive: restructure & format.' })}
                                </p>
                            </div>
                            <div className='flex items-center gap-2 max-w-[50%] w-full justify-end'>
                                <Select
                                    variant='bordered'
                                    selectedKeys={[polishLevel ?? 'mild']}
                                    className='flex-1 min-w-0'
                                    onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setPolishLevel(v); }}
                                >
                                    {Object.entries(POLISH_LEVEL_LABELS).map(([key, label]) => (
                                        <SelectItem key={key}>{label}</SelectItem>
                                    ))}
                                    {(polishCustomLevels ?? []).map(({ key, label }) => (
                                        <SelectItem key={key}>{label}</SelectItem>
                                    ))}
                                </Select>
                                {/* Delete button — only for custom levels */}
                                {!BUILTIN_LEVELS.includes(polishLevel) && (
                                    <button
                                        type='button'
                                        title='Delete this level'
                                        onClick={handleDeleteCustomLevel}
                                        className='flex-shrink-0 p-1.5 rounded-md text-danger-400 hover:bg-danger-50 transition-colors'
                                    >
                                        <MdDeleteOutline className='text-base' />
                                    </button>
                                )}
                                {/* Add custom level */}
                                <button
                                    type='button'
                                    title='Add custom level'
                                    onClick={handleAddCustomLevel}
                                    className='flex-shrink-0 p-1.5 rounded-md text-default-500 hover:bg-default-100 transition-colors'
                                >
                                    <MdAdd className='text-base' />
                                </button>
                            </div>
                        </div>

                        {/* Prompt editor */}
                        <div className='flex flex-col gap-1.5'>
                            <div className='flex items-center justify-between'>
                                <h3 className='text-sm text-default-700'>
                                    {t('config.voice_input.polish_prompt', { defaultValue: 'System Prompt' })}
                                </h3>
                                {isPromptModified && (
                                    <button
                                        type='button'
                                        onClick={handlePromptReset}
                                        className='flex items-center gap-1 text-xs text-default-400 hover:text-default-600 transition-colors'
                                    >
                                        <MdRestartAlt className='text-sm' />
                                        {t('config.voice_input.reset_prompt', { defaultValue: 'Reset to default' })}
                                    </button>
                                )}
                            </div>
                            <Textarea
                                variant='bordered'
                                minRows={5}
                                maxRows={10}
                                value={currentLevelPrompt}
                                onValueChange={handlePromptChange}
                                classNames={{ input: 'text-xs font-mono', inputWrapper: 'text-xs' }}
                                placeholder='Enter system prompt…'
                            />
                        </div>

                        {/* AI Service */}
                        <div className='config-item'>
                            <div>
                                <h3>{t('config.voice_input.polish_service', { defaultValue: 'AI Service' })}</h3>
                                <p className='text-xs text-default-400 mt-0.5'>
                                    {t('config.voice_input.polish_service_desc', { defaultValue: 'AI provider used for polishing. Configure providers in Settings → AI Services.' })}
                                </p>
                            </div>
                            <Select
                                variant='bordered'
                                selectedKeys={polishService ? [polishService] : []}
                                placeholder='Select AI service…'
                                className='max-w-[50%]'
                                onSelectionChange={(keys) => { const v = Array.from(keys)[0]; if (v) setPolishService(v); }}
                            >
                                {(aiServiceList ?? []).map((key) => (
                                    <SelectItem key={key}>{aiDisplayNames[key] ?? getServiceName(key)}</SelectItem>
                                ))}
                            </Select>
                        </div>
                    </>)}
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

                    <div className='config-item'>
                        <div>
                            <h3>{t('config.voice_input.idle_button_color', { defaultValue: 'Idle Button Color' })}</h3>
                            <p className='text-xs text-default-400 mt-0.5'>
                                {t('config.voice_input.idle_button_color_desc', { defaultValue: 'Choose the standby color for the Voice Anywhere button.' })}
                            </p>
                        </div>
                        <div className='flex items-center justify-end gap-3 max-w-[50%] w-full'>
                            <input
                                type='color'
                                value={idleButtonColor ?? DEFAULT_IDLE_BUTTON_COLOR}
                                aria-label={t('config.voice_input.idle_button_color', { defaultValue: 'Idle Button Color' })}
                                onChange={(e) => setIdleButtonColor(e.target.value)}
                                style={{
                                    width: '44px',
                                    height: '32px',
                                    padding: 0,
                                    border: 'none',
                                    background: 'transparent',
                                    cursor: 'pointer',
                                }}
                            />
                            <button
                                type='button'
                                className='text-xs px-2 py-1 rounded-md border border-default-200 text-default-500'
                                onClick={() => setIdleButtonColor(DEFAULT_IDLE_BUTTON_COLOR)}
                            >
                                {t('config.voice_input.reset_idle_button_color', { defaultValue: 'Reset' })}
                            </button>
                        </div>
                    </div>
                </CardBody>
            </Card>
        </div>
    );
}
