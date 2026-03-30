import React from 'react';
import { Select, SelectItem } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { getServiceName } from '../../../../utils/service_instance';

const MODES = [
    { key: 'suggest_answer', icon: '💬' },
    { key: 'quick_insight',  icon: '💡' },
    { key: 'summarize',      icon: '📋' },
    { key: 'follow_up',      icon: '❓' },
];
const CONTEXT_SIZES = [5, 10, 20];
const RESPONSE_LANGS = ['both', 'source', 'target'];

export default function AIPanel({
    aiSuggestionModes,
    aiSuggestionContextLines,
    aiSuggestionResponseLang,
    aiServiceKey,
    aiServiceList,
    onSetAiService,
    onSetModes,
    onSetContextLines,
    onSetResponseLang,
}) {
    const { t } = useTranslation();
    const activeModes = Array.isArray(aiSuggestionModes) && aiSuggestionModes.length > 0
        ? aiSuggestionModes
        : ['suggest_answer'];

    function getLabel(key) {
        const name = getServiceName(key);
        return t(`services.ai.${name}.title`, { defaultValue: name });
    }

    function toggleMode(key) {
        if (activeModes.includes(key)) {
            if (activeModes.length === 1) return;
            onSetModes(activeModes.filter(m => m !== key));
        } else {
            onSetModes([...activeModes, key]);
        }
    }

    const showResponseLang = activeModes.includes('suggest_answer');
    const selectedServiceKey = aiServiceKey || '';

    return (
        <div className='space-y-3'>
            <div className='flex items-center gap-1.5 mb-1'>
                <span className='text-[11px] font-bold text-secondary uppercase tracking-widest'>AI Suggestion</span>
                <span className='text-[10px] text-default-400'>· {t('monitor.ai_panel_subtitle')}</span>
            </div>

            {/* AI Provider */}
            <div className='flex items-center gap-2'>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>{t('monitor.ai_panel_provider')}</span>
                {aiServiceList?.length > 0 ? (
                    <Select
                        size='sm'
                        className='flex-1'
                        selectedKeys={selectedServiceKey ? new Set([selectedServiceKey]) : new Set()}
                        onSelectionChange={(keys) => {
                            const val = [...keys][0];
                            if (val) onSetAiService(val);
                        }}
                        aria-label='AI provider'
                        placeholder={t('monitor.ci_no_service')}
                    >
                        {aiServiceList.map(key => (
                            <SelectItem key={key} textValue={getLabel(key)}>
                                {getLabel(key)}
                            </SelectItem>
                        ))}
                    </Select>
                ) : (
                    <span className='text-[11px] text-warning/80 flex-1'>{t('monitor.ci_no_service')}</span>
                )}
            </div>

            {/* Mode — multi-select toggle buttons */}
            <div className='flex items-start gap-2'>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0 pt-1'>{t('monitor.ai_panel_mode')}</span>
                <div className='flex flex-wrap gap-1.5 flex-1'>
                    {MODES.map(({ key, icon }) => {
                        const active = activeModes.includes(key);
                        return (
                            <button
                                key={key}
                                onClick={() => toggleMode(key)}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] border transition-all ${
                                    active
                                        ? 'bg-secondary/15 border-secondary/50 text-secondary font-medium'
                                        : 'border-content3/40 text-default-400 hover:border-secondary/30 hover:text-default-600'
                                }`}
                            >
                                <span>{icon}</span>
                                <span>{t(`monitor.ci_mode_${key}`)}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Context lines */}
            <div className='flex items-center gap-2'>
                <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>{t('monitor.ai_panel_context')}</span>
                <Select
                    size='sm'
                    className='flex-1'
                    selectedKeys={new Set([String(aiSuggestionContextLines)])}
                    onSelectionChange={(keys) => {
                        const val = [...keys][0];
                        if (val) onSetContextLines(Number(val));
                    }}
                    aria-label='Context lines'
                >
                    {CONTEXT_SIZES.map(n => (
                        <SelectItem key={String(n)} textValue={`${t('monitor.ci_last')} ${n} ${t('monitor.ci_messages')}`}>
                            {t('monitor.ci_last')} {n} {t('monitor.ci_messages')}
                        </SelectItem>
                    ))}
                </Select>
            </div>

            {/* Response language — only when suggest_answer is active */}
            {showResponseLang && (
                <div className='flex items-center gap-2'>
                    <span className='text-[11px] text-default-500 w-20 flex-shrink-0'>{t('monitor.ai_panel_reply_lang')}</span>
                    <Select
                        size='sm'
                        className='flex-1'
                        selectedKeys={new Set([aiSuggestionResponseLang ?? 'both'])}
                        onSelectionChange={(keys) => {
                            const val = [...keys][0];
                            if (val) onSetResponseLang(val);
                        }}
                        aria-label='Response language'
                    >
                        {RESPONSE_LANGS.map(l => (
                            <SelectItem key={l} textValue={t(`monitor.ai_panel_lang_${l}`)}>
                                {t(`monitor.ai_panel_lang_${l}`)}
                            </SelectItem>
                        ))}
                    </Select>
                </div>
            )}

            <p className='text-[10px] text-default-400 pt-1 border-t border-content3/30'>
                {t('monitor.ci_hint')}
            </p>
        </div>
    );
}
