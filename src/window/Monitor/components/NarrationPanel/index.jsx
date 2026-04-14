import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { Select, SelectItem, Switch } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { open as openShell } from '@tauri-apps/api/shell';
import { MdGraphicEq, MdExpandMore, MdExpandLess, MdContentCopy } from 'react-icons/md';
import { osType } from '../../../../utils/env';
import { BUILTIN_LEVELS, DEFAULT_PROMPTS, AI_SERVICE_FRIENDLY_NAMES } from '../../../../utils/polishTranscript';
import { getServiceName } from '../../../../utils/service_instance';

const BLACKHOLE_URL = 'https://github.com/ExistentialAudio/BlackHole/releases';
const VBCABLE_URL   = 'https://vb-audio.com/Cable/';

// ─── Shared sub-components ────────────────────────────────────────────────────

function SectionCard({ children, className = '' }) {
    return (
        <div className={`rounded-xl border border-default-200 dark:border-default-700/60 bg-default-50 dark:bg-default-100/[0.04] p-3 ${className}`}>
            {children}
        </div>
    );
}

function SectionLabel({ label, badge, badgeColor = 'warning' }) {
    const colorMap = {
        warning: 'bg-warning/15 text-warning-700 dark:text-warning-400 border-warning/35',
        primary: 'bg-primary/15 text-primary border-primary/30',
        success: 'bg-success/15 text-success-700 dark:text-success-400 border-success/35',
    };
    return (
        <div className='flex items-center gap-1.5 mb-2.5'>
            <span className='text-[10px] font-bold text-default-600 dark:text-default-400 uppercase tracking-widest'>
                {label}
            </span>
            {badge && (
                <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide border ${colorMap[badgeColor] ?? colorMap.warning}`}>
                    {badge}
                </span>
            )}
        </div>
    );
}

function ToggleRow({ label, hint, isSelected, onValueChange, isDisabled }) {
    return (
        <div className='flex items-center gap-2.5'>
            <Switch size='sm' color='primary' isSelected={isSelected} onValueChange={onValueChange} isDisabled={isDisabled} />
            <div className='flex-1 min-w-0'>
                <span className='text-[11px] font-medium text-default-700 dark:text-default-300'>{label}</span>
                {hint && <span className='ml-1.5 text-[10px] text-default-400'>{hint}</span>}
            </div>
        </div>
    );
}

function SliderRow({ label, min, max, step, value, onChange, isDisabled, displayValue }) {
    return (
        <div className={`flex items-center gap-2.5 ${isDisabled ? 'opacity-40' : ''}`}>
            <span className='text-[10px] text-default-500 w-24 flex-shrink-0'>{label}</span>
            <input
                type='range' min={min} max={max} step={step} value={value}
                disabled={isDisabled}
                onChange={e => onChange(Number(e.target.value))}
                className='flex-1 h-1 cursor-pointer'
                style={{ accentColor: 'hsl(var(--nextui-primary))' }}
            />
            <span className='text-[10px] text-default-400 w-10 text-right font-mono flex-shrink-0'>
                {displayValue ?? value}
            </span>
        </div>
    );
}

function Divider() {
    return <div className='border-t border-default-200 dark:border-default-700' />;
}

// ─── Main ────────────────────────────────────────────────────────────────────

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
    pttPolishEnabled = false,
    onSetPttPolishEnabled,
    pttPolishLevel = 'mild',
    onSetPttPolishLevel,
    pttPolishPrompt = '',
    onSetPttPolishPrompt,
    pttPolishService = '',
    onSetPttPolishService,
    pttReviewEnabled = false,
    onSetPttReviewEnabled,
    pttTtsSpeed = 1.0,
    onSetPttTtsSpeed,
    aiServiceList = [],
    isUsingCloudDictation = false,
}) {
    const { t } = useTranslation();
    const [virtualDevices, setVirtualDevices] = useState([]);
    const [allDevices, setAllDevices]         = useState([]);
    const [showAllDevices, setShowAllDevices] = useState(false);
    const [loading, setLoading]               = useState(false);
    const [error, setError]                   = useState('');
    const [testStatus, setTestStatus]         = useState('');
    const [deviceOpen, setDeviceOpen]         = useState(true);
    const [copied, setCopied]                 = useState(false);

    const isMac     = osType === 'Darwin';
    const isWindows = osType === 'Windows_NT';

    useEffect(() => {
        invoke('narration_detect_devices').then(setVirtualDevices).catch(() => {});
        invoke('narration_list_devices').then(setAllDevices).catch(() => {});
    }, []);

    const hasVirtual     = virtualDevices.length > 0;
    const displayDevices = showAllDevices ? allDevices : virtualDevices;

    async function handleSetDevice(name) {
        if (!name) return;
        setLoading(true); setError('');
        try {
            const resolved = await invoke('narration_setup', { deviceName: name });
            onSetDevice(resolved);
        } catch (e) { setError(String(e)); }
        finally { setLoading(false); }
    }

    async function handleTestSignal() {
        if (!narrationDeviceName || testStatus === 'testing') return;
        setTestStatus('testing');
        try { await onTestSignal?.(); setTestStatus('ok'); }
        catch (e) { setError(String(e)); setTestStatus('error'); }
        setTimeout(() => setTestStatus(''), 2500);
    }

    function handleCopyPrompt() {
        navigator.clipboard.writeText(DEFAULT_PROMPTS[pttPolishLevel] ?? '').then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
        }).catch(() => {});
    }

    const testBtnCls = `flex items-center gap-1 px-2 py-1.5 rounded-lg text-[10px] font-medium border transition-colors flex-shrink-0 ${
        testStatus === 'testing' ? 'border-warning/40 text-warning bg-warning/10 animate-pulse'
        : testStatus === 'ok'    ? 'border-success/40 text-success bg-success/10'
        : testStatus === 'error' ? 'border-danger/40 text-danger bg-danger/10'
        : 'border-default-300 dark:border-default-600 text-default-500 hover:text-primary hover:border-primary/30 bg-default-100 dark:bg-default-50/[0.06]'
    }`;

    return (
        <div className='flex flex-col gap-2.5 text-sm'>

            {/* ── Header ── */}
            <div className='flex items-center gap-1.5 px-0.5'>
                <span className='text-[11px] font-bold text-success uppercase tracking-widest'>
                    🎙 {t('monitor.narration_title', { defaultValue: 'Narration' })}
                </span>
                <span className='px-1.5 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-wide border bg-warning/15 text-warning-700 dark:text-warning-400 border-warning/35'>
                    {t('monitor.narration_beta', { defaultValue: 'Beta' })}
                </span>
                <span className='text-[10px] text-default-400'>
                    · {t('monitor.narration_subtitle', { defaultValue: 'Speak VI → TTS EN → virtual mic' })}
                </span>
            </div>

            {/* ── 1. Thiết bị ── */}
            <SectionCard>
                <button className='flex items-center justify-between w-full' onClick={() => setDeviceOpen(v => !v)}>
                    <SectionLabel label={t('monitor.narration_device', { defaultValue: 'Thiết bị' })} />
                    {deviceOpen
                        ? <MdExpandLess className='text-default-400 text-[16px] flex-shrink-0 -mt-2.5' />
                        : <MdExpandMore className='text-default-400 text-[16px] flex-shrink-0 -mt-2.5' />
                    }
                </button>

                {deviceOpen && (
                    <div className='flex flex-col gap-2'>
                        {hasVirtual || showAllDevices ? (
                            <div className='flex gap-1.5 items-center'>
                                <Select
                                    size='sm'
                                    isLoading={loading}
                                    placeholder={t('monitor.narration_select_device', { defaultValue: 'Chọn mic ảo…' })}
                                    selectedKeys={narrationDeviceName ? new Set([narrationDeviceName]) : new Set()}
                                    onSelectionChange={keys => handleSetDevice([...keys][0])}
                                    aria-label={t('monitor.narration_virtual_mic_aria', { defaultValue: 'Virtual mic device' })}
                                    className='flex-1'
                                    classNames={{ trigger: 'border border-default-200 dark:border-default-700' }}
                                >
                                    {displayDevices.map(d => (
                                        <SelectItem key={d} textValue={d}>{d}</SelectItem>
                                    ))}
                                </Select>
                                {narrationDeviceName && (
                                    <button className={testBtnCls} onClick={handleTestSignal}>
                                        <MdGraphicEq className='text-[13px]' />
                                        {testStatus === 'testing' ? t('monitor.narration_test_testing', { defaultValue: 'Testing…' })
                                            : testStatus === 'ok'    ? t('monitor.narration_test_ok', { defaultValue: 'OK ✓' })
                                            : testStatus === 'error' ? t('monitor.narration_test_failed', { defaultValue: 'Failed' })
                                            : t('monitor.narration_test', { defaultValue: 'Test' })}
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className='rounded-lg bg-warning/8 border border-warning/20 px-2.5 py-2'>
                                <p className='text-[10px] text-warning-700 dark:text-warning-400 font-medium mb-1'>
                                    {t('monitor.narration_no_virtual', { defaultValue: 'No virtual device found' })}
                                </p>
                                {isMac && (
                                    <button className='text-[10px] text-primary underline' onClick={() => openShell(BLACKHOLE_URL)}>
                                        {t('monitor.narration_install_link', { defaultValue: 'Download BlackHole →' })}
                                    </button>
                                )}
                                {isWindows && (
                                    <button className='text-[10px] text-primary underline' onClick={() => openShell(VBCABLE_URL)}>
                                        {t('monitor.narration_win_install_link', { defaultValue: 'Download VB-Cable →' })}
                                    </button>
                                )}
                            </div>
                        )}

                        <button
                            className='text-[10px] text-default-400 hover:text-primary transition-colors underline w-fit'
                            onClick={() => setShowAllDevices(v => !v)}
                        >
                            {showAllDevices
                                ? t('monitor.narration_show_virtual', { defaultValue: 'Chỉ mic ảo' })
                                : t('monitor.narration_show_all', { defaultValue: 'Xem tất cả thiết bị' })}
                        </button>

                        {error && <p className='text-[10px] text-danger/80'>{error}</p>}
                    </div>
                )}
            </SectionCard>

            {/* ── 2. PTT — toggle only ── */}
            <SectionCard>
                <SectionLabel label='PTT' />
                <div className='flex flex-col gap-2.5'>
                    <ToggleRow
                        label={t('monitor.narration_ptt_active', { defaultValue: 'PTT Active' })}
                        hint={t('monitor.narration_ptt_active_hint', { defaultValue: 'Enable Hold to Speak button' })}
                        isSelected={Boolean(pttEnabled)}
                        onValueChange={onTogglePttEnabled}
                    />
                    {pttEnabled && (
                        <div className='rounded-lg bg-warning/8 border border-warning/20 px-2.5 py-1.5'>
                            <p className='text-[10px] text-warning-700 dark:text-warning-400'>
                                {t('monitor.narration_ptt_cost_warning', {
                                    defaultValue: 'PTT Active may create an extra STT cloud stream and consume additional tokens/minutes.',
                                })}
                            </p>
                        </div>
                    )}
                </div>
            </SectionCard>

            {/* ── 3. Tùy chọn — sliders + Review + Hear TTS ── */}
            <SectionCard>
                <SectionLabel label={t('monitor.narration_options', { defaultValue: 'Tùy chọn' })} />
                <div className={`flex flex-col gap-2.5 ${!pttEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                    <SliderRow
                        label={t('monitor.narration_ptt_size', { defaultValue: 'Kích thước PTT' })}
                        min={36} max={88} step={2}
                        value={pttFabSize ?? 52}
                        onChange={onSetPttFabSize}
                        isDisabled={!pttEnabled}
                        displayValue={`${pttFabSize ?? 52}px`}
                    />
                    <SliderRow
                        label={t('monitor.narration_ptt_tts_speed', { defaultValue: 'Tốc độ TTS' })}
                        min={0.5} max={2.0} step={0.05}
                        value={pttTtsSpeed ?? 1.0}
                        onChange={onSetPttTtsSpeed}
                        isDisabled={!pttEnabled}
                        displayValue={`${(pttTtsSpeed ?? 1.0).toFixed(2)}×`}
                    />
                    <Divider />
                    <ToggleRow
                        label={t('monitor.narration_ptt_review_label', { defaultValue: 'Xem trước TTS' })}
                        hint={t('monitor.narration_ptt_review_hint', { defaultValue: 'Xác nhận trước khi phát TTS' })}
                        isSelected={pttReviewEnabled}
                        onValueChange={onSetPttReviewEnabled}
                        isDisabled={!pttEnabled}
                    />
                    <ToggleRow
                        label={t('monitor.narration_monitor_audio', { defaultValue: 'Nghe TTS' })}
                        hint={monitorAudio
                            ? '⚠ ' + t('monitor.narration_monitor_on_warn', { defaultValue: 'có thể bị vọng âm' })
                            : t('monitor.narration_monitor_off', { defaultValue: 'Im lặng — chỉ ra mic ảo' })}
                        isSelected={monitorAudio}
                        onValueChange={onToggleMonitorAudio}
                        isDisabled={!pttEnabled}
                    />
                </div>
            </SectionCard>

            {/* ── 4. Làm mượt — always expanded ── */}
            <SectionCard>
                <SectionLabel
                    label={t('monitor.narration_ptt_polish', { defaultValue: 'Làm mượt văn bản' })}
                    badge={isUsingCloudDictation ? t('monitor.narration_cloud_dictation_badge', { defaultValue: 'Cloud Dictation' }) : null}
                    badgeColor='primary'
                />
                <div className='flex flex-col gap-3'>
                    <ToggleRow
                        label={t('monitor.narration_ptt_polish', { defaultValue: 'Bật làm mượt' })}
                        isSelected={pttPolishEnabled}
                        onValueChange={onSetPttPolishEnabled}
                        isDisabled={!pttEnabled}
                    />

                    <div className={`flex flex-col gap-2.5 ${!pttPolishEnabled ? 'opacity-40 pointer-events-none' : ''}`}>
                        {/* Level pills */}
                        <div className='flex flex-col gap-1.5'>
                            <span className='text-[10px] font-medium text-default-500'>
                                {t('monitor.narration_polish_level', { defaultValue: 'Mức độ' })}
                            </span>
                            <div className='flex gap-1 flex-wrap'>
                                {[...BUILTIN_LEVELS, 'custom'].map(lvl => (
                                    <button
                                        key={lvl}
                                        onClick={() => onSetPttPolishLevel?.(lvl)}
                                        className={`px-2.5 py-1 rounded-lg text-[10px] font-medium border transition-colors ${
                                            pttPolishLevel === lvl
                                                ? 'bg-primary text-white border-primary shadow-sm'
                                                : 'bg-default-100 dark:bg-default-50/[0.06] text-default-600 dark:text-default-400 border-default-200 dark:border-default-700 hover:border-primary/50 hover:text-primary'
                                        }`}
                                    >
                                        {t(`monitor.narration_polish_level_${lvl}`, {
                                            defaultValue: lvl === 'mild' ? 'Nhẹ' : lvl === 'medium' ? 'Vừa' : lvl === 'aggressive' ? 'Mạnh' : 'Tùy chỉnh',
                                        })}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Prompt */}
                        <div className='flex flex-col gap-1'>
                            <div className='flex items-center justify-between'>
                                <span className='text-[10px] font-medium text-default-500'>
                                    {t('monitor.narration_polish_prompt', { defaultValue: 'Prompt' })}
                                    {pttPolishLevel !== 'custom' && (
                                        <span className='ml-1 text-default-400 font-normal'>
                                            {t('monitor.narration_polish_prompt_readonly', { defaultValue: '(có sẵn)' })}
                                        </span>
                                    )}
                                </span>
                                {pttPolishLevel !== 'custom' && (
                                    <button
                                        onClick={handleCopyPrompt}
                                        className='flex items-center gap-0.5 text-[10px] text-default-400 hover:text-primary transition-colors'
                                    >
                                        <MdContentCopy className='text-[11px]' />
                                        {copied ? '✓' : 'Copy'}
                                    </button>
                                )}
                            </div>
                            {pttPolishLevel === 'custom' ? (
                                <textarea
                                    rows={4}
                                    value={pttPolishPrompt}
                                    onChange={e => onSetPttPolishPrompt?.(e.target.value)}
                                    placeholder={t('monitor.narration_polish_prompt_placeholder', { defaultValue: 'Nhập hướng dẫn tùy chỉnh…' })}
                                    className='w-full text-[10px] bg-default-100 dark:bg-default-50/[0.06] border border-default-200 dark:border-default-700 rounded-lg px-2.5 py-1.5 text-foreground placeholder:text-default-400 resize-none focus:outline-none focus:border-primary/60 transition-colors'
                                />
                            ) : (
                                <pre className='w-full text-[9px] leading-relaxed bg-default-100 dark:bg-default-50/[0.06] border border-default-200 dark:border-default-700 rounded-lg px-2.5 py-1.5 text-default-500 whitespace-pre-wrap font-mono overflow-hidden'>
                                    {DEFAULT_PROMPTS[pttPolishLevel] ?? ''}
                                </pre>
                            )}
                        </div>

                        {/* AI service */}
                        {aiServiceList.length > 0 && (
                            <div className='flex flex-col gap-1'>
                                <span className='text-[10px] font-medium text-default-500'>
                                    {t('monitor.narration_polish_service', { defaultValue: 'Dịch vụ AI' })}
                                </span>
                                <Select
                                    size='sm'
                                    placeholder={t('monitor.narration_polish_service_placeholder', { defaultValue: 'Chọn dịch vụ AI…' })}
                                    selectedKeys={pttPolishService ? new Set([pttPolishService]) : new Set([aiServiceList[0]])}
                                    onSelectionChange={keys => onSetPttPolishService?.([...keys][0] ?? '')}
                                    aria-label={t('monitor.narration_polish_service_aria', { defaultValue: 'AI service for polish' })}
                                    classNames={{ trigger: 'border border-default-200 dark:border-default-700 data-[focus=true]:border-primary/60' }}
                                >
                                    {aiServiceList.map(svc => {
                                        const label = AI_SERVICE_FRIENDLY_NAMES[getServiceName(svc)] ?? getServiceName(svc).replace(/_ai$/, '').replace(/_/g, ' ');
                                        return <SelectItem key={svc} textValue={label}>{label}</SelectItem>;
                                    })}
                                </Select>
                            </div>
                        )}
                    </div>
                </div>
            </SectionCard>

            {/* ── Status ── */}
            {narrationDeviceName && (
                <div className='flex items-center gap-1.5 px-0.5'>
                    <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        isPttActive || isNarrationActive ? 'bg-success animate-pulse' : 'bg-default-300'
                    }`} />
                    <span className='text-[10px] text-default-400'>
                        {isPttActive || isNarrationActive
                            ? t('monitor.narration_routing', { defaultValue: 'Đang phát TTS → mic ảo' })
                            : t('monitor.narration_idle', { defaultValue: 'Sẵn sàng' })}
                    </span>
                </div>
            )}

            {/* ── Cài đặt Zoom (bottom) ── */}
            {narrationDeviceName && (
                <div className='rounded-lg bg-default-100 dark:bg-default-50/[0.06] border border-default-200 dark:border-default-700 p-2.5 flex flex-col gap-0.5'>
                    <p className='text-[10px] font-medium text-default-500 mb-1'>
                        {t('monitor.narration_checklist_title', { defaultValue: 'Cài đặt Zoom / Teams:' })}
                    </p>
                    {[
                        t('monitor.narration_checklist_item1', { defaultValue: '① Mic trong Zoom → {{device}}', device: narrationDeviceName }),
                        t('monitor.narration_checklist_item2', { defaultValue: '② Tắt mic thật trong Zoom', device: narrationDeviceName }),
                        t('monitor.narration_checklist_item3', { defaultValue: '③ Nhấn giữ "Hold to Speak" để nói' }),
                    ].map((item, i) => (
                        <p key={i} className='text-[10px] text-default-400'>{item}</p>
                    ))}
                </div>
            )}

            {/* ── Footer ── */}
            <p className='text-[10px] text-default-400 px-0.5 border-t border-default-200 dark:border-default-700 pt-2'>
                {t('monitor.narration_footer', {
                    defaultValue: 'TTS audio được gửi tới mic ảo. Chọn nó trong Zoom/Teams làm microphone.',
                })}
            </p>
        </div>
    );
}
