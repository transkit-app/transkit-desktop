import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Select, SelectItem, Switch } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { open as openShell } from '@tauri-apps/api/shell';
import { MdGraphicEq } from 'react-icons/md';
import { osType } from '../../../../utils/env';

const BLACKHOLE_URL  = 'https://github.com/ExistentialAudio/BlackHole/releases';
const VBCABLE_URL    = 'https://vb-audio.com/Cable/';

export default function NarrationPanel({
    isNarrationActive,
    narrationEnabled,
    pttEnabled,
    narrationDeviceName,
    onSetDevice,
    onToggleNarration,
    onTogglePttEnabled,
    isPttActive,
    onTestSignal,
    monitorAudio,
    onToggleMonitorAudio,
    pttFabSize = 52,
    onSetPttFabSize,
}) {
    const { t } = useTranslation();
    const controlsDisabled = !pttEnabled;
    const [virtualDevices, setVirtualDevices] = useState([]);
    const [allDevices, setAllDevices]         = useState([]);
    const [showAllDevices, setShowAllDevices] = useState(false);
    const [loading, setLoading]               = useState(false);
    const [error, setError]                   = useState('');
    const [testStatus, setTestStatus]         = useState(''); // '' | 'testing' | 'ok' | 'error'

    useEffect(() => {
        invoke('narration_detect_devices').then(setVirtualDevices).catch(() => {});
        invoke('narration_list_devices').then(setAllDevices).catch(() => {});
    }, []);

    const displayDevices = showAllDevices ? allDevices : virtualDevices;
    const hasVirtual  = virtualDevices.length > 0;
    const isMac       = osType === 'Darwin';
    const isWindows   = osType === 'Windows_NT';

    async function handleSetDevice(name) {
        if (!name) return;
        setLoading(true);
        setError('');
        try {
            const resolved = await invoke('narration_setup', { deviceName: name });
            onSetDevice(resolved);
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }

    async function handleTestSignal() {
        if (!narrationDeviceName || testStatus === 'testing') return;
        setTestStatus('testing');
        try {
            await onTestSignal?.();
            setTestStatus('ok');
        } catch (e) {
            setError(String(e));
            setTestStatus('error');
        }
        setTimeout(() => setTestStatus(''), 2500);
    }

    return (
        <div className='space-y-3'>
            {/* Header */}
            <div className='flex items-center gap-1.5 mb-1'>
                <span className='text-[11px] font-bold text-success uppercase tracking-widest'>
                    {`🎙 ${t('monitor.narration_title', { defaultValue: 'Narration' })}`}
                </span>
                <span className='px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide bg-warning/15 text-warning-700 dark:text-warning-400 border border-warning/35'>
                    {t('monitor.narration_beta', { defaultValue: 'Beta' })}
                </span>
                <span className='text-[10px] text-default-400'>
                    · {t('monitor.narration_subtitle', { defaultValue: 'Speak VI → TTS EN → virtual mic' })}
                </span>
            </div>

            {/* PTT active toggle */}
            <div className='flex items-center gap-2'>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>
                    {t('monitor.narration_ptt_active', { defaultValue: 'PTT Active' })}
                </span>
                <Switch
                    size='sm'
                    color='warning'
                    isSelected={Boolean(pttEnabled)}
                    onValueChange={onTogglePttEnabled}
                />
                <span className='text-[10px] text-default-400'>
                    {t('monitor.narration_ptt_active_hint', { defaultValue: 'Enable Hold to Speak button' })}
                </span>
            </div>

            {pttEnabled && (
                <div className='rounded-lg bg-warning/10 border border-warning/25 px-2 py-1.5'>
                    <p className='text-[10px] text-warning-700 dark:text-warning-400'>
                        {t('monitor.narration_ptt_cost_warning', {
                            defaultValue: 'PTT Active may create an extra STT cloud stream while pressed and can consume duplicate token/minutes.',
                        })}
                    </p>
                </div>
            )}

            <div className={controlsDisabled ? 'opacity-45 pointer-events-none select-none' : ''}>
                {/* Device selector */}
                <div className='flex items-start gap-2'>
                    <span className='text-[11px] text-default-500 w-20 flex-shrink-0 pt-2'>
                        {t('monitor.narration_device', { defaultValue: 'Device' })}
                    </span>
                    <div className='flex-1 space-y-1.5'>
                        {displayDevices.length > 0 ? (
                            <div className='flex gap-1.5 items-center'>
                                <Select
                                    size='sm'
                                    isLoading={loading}
                                    isDisabled={controlsDisabled}
                                    placeholder={t('monitor.narration_select_device', { defaultValue: 'Select virtual mic…' })}
                                    selectedKeys={narrationDeviceName ? new Set([narrationDeviceName]) : new Set()}
                                    onSelectionChange={keys => handleSetDevice([...keys][0])}
                                    aria-label={t('monitor.narration_virtual_mic_aria', { defaultValue: 'Virtual mic device' })}
                                    className='flex-1'
                                >
                                    {displayDevices.map(d => (
                                        <SelectItem key={d} textValue={d}>{d}</SelectItem>
                                    ))}
                                </Select>
                                {/* Test signal button */}
                                {narrationDeviceName && (
                                    <button
                                        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors
                                            ${testStatus === 'testing'
                                                ? 'border-warning/40 text-warning bg-warning/10 animate-pulse'
                                                : testStatus === 'ok'
                                                ? 'border-success/40 text-success bg-success/10'
                                                : testStatus === 'error'
                                                ? 'border-danger/40 text-danger bg-danger/10'
                                                : 'border-content3/40 text-default-500 hover:text-primary hover:border-primary/30 bg-content2/50'
                                            }`}
                                        onClick={handleTestSignal}
                                        disabled={controlsDisabled}
                                        title={t('monitor.narration_test_tone_title', { defaultValue: 'Send 440 Hz test tone to virtual device' })}
                                    >
                                        <MdGraphicEq className='text-[13px]' />
                                        {testStatus === 'testing' ? t('monitor.narration_test_testing', { defaultValue: 'Testing…' })
                                            : testStatus === 'ok' ? t('monitor.narration_test_ok', { defaultValue: 'OK ✓' })
                                            : testStatus === 'error' ? t('monitor.narration_test_failed', { defaultValue: 'Failed' })
                                            : t('monitor.narration_test', { defaultValue: 'Test' })}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <span className='text-[11px] text-warning/80'>
                                {t('monitor.narration_no_virtual', { defaultValue: 'No virtual device found' })}
                            </span>
                        )}

                        <button
                            className='text-[10px] text-default-400 hover:text-default-600 underline'
                            onClick={() => setShowAllDevices(v => !v)}
                            disabled={controlsDisabled}
                        >
                            {showAllDevices
                                ? t('monitor.narration_show_virtual', { defaultValue: 'Show virtual devices only' })
                                : t('monitor.narration_show_all', { defaultValue: 'Show all output devices' })}
                        </button>
                    </div>
                </div>

                {/* Always-on toggle (secondary) */}
                <div className='flex items-center gap-2'>
                    <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>
                        {t('monitor.narration_sticky', { defaultValue: 'Always on' })}
                    </span>
                    <Switch
                        size='sm'
                        color='success'
                        isSelected={Boolean(narrationEnabled)}
                        isDisabled={controlsDisabled || !narrationDeviceName}
                        onValueChange={onToggleNarration}
                    />
                    <span className='text-[10px] text-default-400'>
                        {t('monitor.narration_sticky_hint', { defaultValue: 'ON when mic mode is active' })}
                    </span>
                </div>
            </div>

            {/* PTT floating button size */}
            <div className={`flex items-center gap-2 ${controlsDisabled ? 'opacity-45' : ''}`}>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>
                    {t('monitor.narration_ptt_size', { defaultValue: 'PTT size' })}
                </span>
                <div className='flex-1 flex items-center gap-2'>
                    <input
                        type='range'
                        min={36}
                        max={88}
                        step={2}
                        value={pttFabSize ?? 52}
                        disabled={controlsDisabled}
                        onChange={(e) => onSetPttFabSize?.(Number(e.target.value))}
                        className='flex-1 h-1 accent-primary cursor-pointer'
                        style={{ accentColor: 'hsl(var(--nextui-primary))' }}
                    />
                    <span className='text-[10px] text-default-400 w-8 text-right'>{pttFabSize ?? 52}</span>
                </div>
            </div>

            {/* Monitor audio toggle */}
            <div className={`flex items-center gap-2 ${controlsDisabled ? 'opacity-45' : ''}`}>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>
                    {t('monitor.narration_monitor_audio', { defaultValue: 'Hear TTS' })}
                </span>
                <Switch
                    size='sm'
                    color='warning'
                    isDisabled={controlsDisabled}
                    isSelected={monitorAudio}
                    onValueChange={onToggleMonitorAudio}
                />
                <span className='text-[10px] text-default-400'>
                    {monitorAudio
                        ? t('monitor.narration_monitor_on', { defaultValue: 'Playing locally (test mode)' })
                        : t('monitor.narration_monitor_off', { defaultValue: 'Silent — virtual mic only' })}
                </span>
            </div>

            {narrationDeviceName && (
                <p className='text-[10px] text-default-400'>
                    {t('monitor.narration_ptt_toolbar_hint', {
                        defaultValue: 'Use "Hold to Speak" on the top toolbar to switch to mic and route TTS → virtual mic.',
                    })}
                </p>
            )}

            {/* Status indicator */}
            {narrationDeviceName && (
                <div className='flex items-center gap-1.5'>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isPttActive ? 'bg-success animate-pulse'
                        : isNarrationActive ? 'bg-success animate-pulse'
                        : 'bg-default-300'
                    }`} />
                    <span className='text-[10px] text-default-400'>
                        {isPttActive
                            ? t('monitor.narration_routing', { defaultValue: 'Routing TTS → virtual mic' })
                            : isNarrationActive
                            ? t('monitor.narration_routing', { defaultValue: 'Routing TTS → virtual mic' })
                            : t('monitor.narration_idle', { defaultValue: 'Ready' })}
                    </span>
                </div>
            )}

            {/* Error display */}
            {error && (
                <p className='text-[10px] text-danger/80'>{error}</p>
            )}

            {/* Install hint — macOS: BlackHole */}
            {!hasVirtual && isMac && (
                <div className='rounded-lg bg-content3/30 p-2 space-y-1'>
                    <p className='text-[11px] text-default-500'>
                        {t('monitor.narration_install_hint', {
                            defaultValue: 'Install BlackHole to use narration:',
                        })}
                    </p>
                    <button
                        className='text-[11px] text-primary underline'
                        onClick={() => openShell(BLACKHOLE_URL)}
                    >
                        {t('monitor.narration_install_link', { defaultValue: 'Download BlackHole →' })}
                    </button>
                    <p className='text-[10px] text-default-400'>
                        {t('monitor.narration_zoom_hint', {
                            defaultValue: 'After install, select "BlackHole 2ch" as mic in Zoom/Teams.',
                        })}
                    </p>
                </div>
            )}

            {/* Install hint — Windows: VB-Cable */}
            {!hasVirtual && isWindows && (
                <div className='rounded-lg bg-content3/30 p-2 space-y-1'>
                    <p className='text-[11px] text-default-500'>
                        {t('monitor.narration_win_install_hint', {
                            defaultValue: 'Install VB-Cable (free) to use narration:',
                        })}
                    </p>
                    <button
                        className='text-[11px] text-primary underline'
                        onClick={() => openShell(VBCABLE_URL)}
                    >
                        {t('monitor.narration_win_install_link', { defaultValue: 'Download VB-Cable →' })}
                    </button>
                    <p className='text-[10px] text-default-400'>
                        {t('monitor.narration_win_zoom_hint', {
                            defaultValue: 'After install & reboot, select "CABLE Output" as mic in Zoom/Teams.',
                        })}
                    </p>
                </div>
            )}

            {/* Zoom setup checklist */}
            {narrationDeviceName && (
                <div className='rounded-lg bg-content3/20 border border-content3/30 p-2 space-y-1'>
                    <p className='text-[10px] font-medium text-default-500'>
                        {t('monitor.narration_checklist_title', { defaultValue: 'Zoom / Teams setup:' })}
                    </p>
                    <p className='text-[10px] text-default-400'>
                        {t('monitor.narration_checklist_item1', {
                            defaultValue: '① Zoom mic → {{device}}',
                            device: narrationDeviceName,
                        })}
                    </p>
                    <p className='text-[10px] text-default-400'>
                        {t('monitor.narration_checklist_item2', {
                            defaultValue: '② Mute your real mic in Zoom (participants hear {{device}}, not your real mic)',
                            device: narrationDeviceName,
                        })}
                    </p>
                    <p className='text-[10px] text-default-400'>
                        {t('monitor.narration_checklist_item3', {
                            defaultValue: '③ Press & hold "Hold to Speak" to narrate',
                        })}
                    </p>
                </div>
            )}

            <p className='text-[10px] text-default-400 pt-1 border-t border-content3/30'>
                {t('monitor.narration_footer', {
                    defaultValue: 'TTS audio is sent to the virtual mic. Select it in Zoom/Teams as your microphone.',
                })}
            </p>
        </div>
    );
}
