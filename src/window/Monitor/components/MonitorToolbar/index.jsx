import { Button, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem } from '@nextui-org/react';
import { MdMic, MdSpeaker, MdPlayArrow, MdStop, MdSubtitles, MdDeleteOutline, MdVolumeUp, MdVolumeOff, MdTune, MdTextFields } from 'react-icons/md';
import { HiSwitchHorizontal } from 'react-icons/hi';
import { useTranslation } from 'react-i18next';
import React from 'react';

const SONIOX_LANGUAGES = [
    { code: 'auto', label: 'Auto' },
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Vietnamese' },
    { code: 'ja', label: 'Japanese' },
    { code: 'ko', label: 'Korean' },
    { code: 'zh', label: 'Chinese' },
    { code: 'fr', label: 'French' },
    { code: 'de', label: 'German' },
    { code: 'es', label: 'Spanish' },
    { code: 'ru', label: 'Russian' },
    { code: 'it', label: 'Italian' },
    { code: 'pt', label: 'Portuguese' },
    { code: 'th', label: 'Thai' },
    { code: 'id', label: 'Indonesian' },
];

const TARGET_LANGUAGES = SONIOX_LANGUAGES.filter(l => l.code !== 'auto');

const FONT_MIN = 10;
const FONT_MAX = 24;

export default function MonitorToolbar({
    isRunning,
    sourceAudio,
    sourceLang,
    targetLang,
    audioCapabilities,
    fontSize,
    isSubMode,
    isTTSEnabled,
    showContextPanel,
    showOriginal,
    onToggleRun,
    onToggleOriginal,
    onClear,
    onSetSourceAudio,
    onSetSourceLang,
    onSetTargetLang,
    onFontSizeChange,
    onToggleSubMode,
    onToggleTTS,
    onToggleContextPanel,
}) {
    const { t } = useTranslation();

    return (
        <div className='flex items-center gap-1 px-2 py-1 border-b border-content3/50 flex-wrap'>
            {/* Audio source toggle */}
            <div className='flex items-center gap-0.5 bg-content2 rounded-lg p-0.5'>
                <Button
                    isIconOnly
                    size='sm'
                    variant={sourceAudio === 'system' ? 'solid' : 'light'}
                    color={sourceAudio === 'system' ? 'primary' : 'default'}
                    className='h-7 w-7 min-w-0'
                    isDisabled={!audioCapabilities?.system_audio}
                    title={audioCapabilities?.system_audio ? t('monitor.source_system') : t('monitor.source_system_unavailable')}
                    onPress={() => onSetSourceAudio('system')}
                >
                    <MdSpeaker className='text-[14px]' />
                </Button>
                <Button
                    isIconOnly
                    size='sm'
                    variant={sourceAudio === 'microphone' ? 'solid' : 'light'}
                    color={sourceAudio === 'microphone' ? 'primary' : 'default'}
                    className='h-7 w-7 min-w-0'
                    title={t('monitor.source_mic')}
                    onPress={() => onSetSourceAudio('microphone')}
                >
                    <MdMic className='text-[14px]' />
                </Button>
            </div>

            {/* Language pair */}
            <div className='flex items-center gap-1 flex-1 min-w-0'>
                <Dropdown size='sm'>
                    <DropdownTrigger>
                        <Button size='sm' variant='light' className='h-7 px-2 min-w-0 text-xs font-medium'>
                            {SONIOX_LANGUAGES.find(l => l.code === sourceLang)?.label ?? 'Auto'}
                        </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                        aria-label='Source Language'
                        selectedKeys={new Set([sourceLang])}
                        selectionMode='single'
                        onSelectionChange={keys => onSetSourceLang([...keys][0])}
                    >
                        {SONIOX_LANGUAGES.map(lang => (
                            <DropdownItem key={lang.code}>{lang.label}</DropdownItem>
                        ))}
                    </DropdownMenu>
                </Dropdown>

                <HiSwitchHorizontal className='text-default-400 text-[12px] flex-shrink-0' />

                <Dropdown size='sm'>
                    <DropdownTrigger>
                        <Button size='sm' variant='light' className='h-7 px-2 min-w-0 text-xs font-medium'>
                            {TARGET_LANGUAGES.find(l => l.code === targetLang)?.label ?? 'Vietnamese'}
                        </Button>
                    </DropdownTrigger>
                    <DropdownMenu
                        aria-label='Target Language'
                        selectedKeys={new Set([targetLang])}
                        selectionMode='single'
                        onSelectionChange={keys => onSetTargetLang([...keys][0])}
                    >
                        {TARGET_LANGUAGES.map(lang => (
                            <DropdownItem key={lang.code}>{lang.label}</DropdownItem>
                        ))}
                    </DropdownMenu>
                </Dropdown>
            </div>

            {/* Font size controls */}
            <div className='flex items-center gap-0.5 bg-content2 rounded-lg p-0.5'>
                <Button
                    isIconOnly
                    size='sm'
                    variant='light'
                    className='h-7 w-7 min-w-0'
                    isDisabled={fontSize <= FONT_MIN}
                    title={t('monitor.font_smaller')}
                    onPress={() => onFontSizeChange(Math.max(FONT_MIN, fontSize - 2))}
                >
                    <span className='text-[11px] font-bold leading-none'>A-</span>
                </Button>
                <span className='text-[10px] text-default-400 w-6 text-center select-none'>{fontSize}</span>
                <Button
                    isIconOnly
                    size='sm'
                    variant='light'
                    className='h-7 w-7 min-w-0'
                    isDisabled={fontSize >= FONT_MAX}
                    title={t('monitor.font_larger')}
                    onPress={() => onFontSizeChange(Math.min(FONT_MAX, fontSize + 2))}
                >
                    <span className='text-[13px] font-bold leading-none'>A+</span>
                </Button>
            </div>

            {/* Start/Stop */}
            <Button
                isIconOnly
                size='sm'
                color={isRunning ? 'danger' : 'primary'}
                variant='flat'
                className='h-7 w-7 min-w-0'
                onPress={onToggleRun}
                title={isRunning ? t('monitor.stop') : t('monitor.start')}
            >
                {isRunning ? <MdStop className='text-[16px]' /> : <MdPlayArrow className='text-[16px]' />}
            </Button>

            {/* Sub mode toggle */}
            <Button
                isIconOnly
                size='sm'
                variant={isSubMode ? 'solid' : 'light'}
                color={isSubMode ? 'secondary' : 'default'}
                className='h-7 w-7 min-w-0'
                onPress={onToggleSubMode}
                title={isSubMode ? t('monitor.exit_sub_mode') : t('monitor.sub_mode')}
            >
                <MdSubtitles className='text-[14px]' />
            </Button>

            {/* TTS toggle */}
            <Button
                isIconOnly
                size='sm'
                variant={isTTSEnabled ? 'solid' : 'light'}
                color={isTTSEnabled ? 'secondary' : 'default'}
                className='h-7 w-7 min-w-0'
                onPress={onToggleTTS}
                title={isTTSEnabled ? t('monitor.tts_disable') : t('monitor.tts_enable')}
            >
                {isTTSEnabled
                    ? <MdVolumeUp className='text-[14px]' />
                    : <MdVolumeOff className='text-[14px] text-default-400' />}
            </Button>

            {/* Context panel toggle */}
            <Button
                isIconOnly
                size='sm'
                variant={showContextPanel ? 'solid' : 'light'}
                color={showContextPanel ? 'secondary' : 'default'}
                className='h-7 w-7 min-w-0'
                onPress={onToggleContextPanel}
                title={t('monitor.context_panel')}
            >
                <MdTune className='text-[14px]' />
            </Button>

            {/* Show/hide original text toggle */}
            <Button
                isIconOnly
                size='sm'
                variant={showOriginal ? 'solid' : 'light'}
                color={showOriginal ? 'primary' : 'default'}
                className='h-7 w-7 min-w-0'
                onPress={onToggleOriginal}
                title={showOriginal ? t('monitor.hide_original') : t('monitor.show_original')}
            >
                <MdTextFields className={`text-[14px] ${showOriginal ? '' : 'text-default-400'}`} />
            </Button>

            {/* Clear */}
            <Button
                isIconOnly
                size='sm'
                variant='light'
                className='h-7 w-7 min-w-0'
                onPress={onClear}
                title={t('common.clear')}
            >
                <MdDeleteOutline className='text-[14px] text-default-400' />
            </Button>

        </div>
    );
}
