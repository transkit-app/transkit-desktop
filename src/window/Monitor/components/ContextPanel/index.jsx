import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MdAdd, MdClose, MdAutoAwesome, MdSave, MdExpandMore, MdExpandLess } from 'react-icons/md';
import { generateSonioxContext } from '../../../../utils/generateSonioxContext';
import { store } from '../../../../utils/store';
import { getServiceName } from '../../../../utils/service_instance';

// ─── Built-in presets ────────────────────────────────────────────────────────

const BUILTIN_PRESETS = [
    {
        id: 'meeting',
        nameKey: 'ctx_preset_meeting',
        context: {
            general: [
                { key: 'domain', value: 'Business meeting' },
                { key: 'setting', value: 'Conference call or office meeting' },
                { key: 'style', value: 'Formal and semi-formal workplace language' },
            ],
            text: 'A professional workplace meeting or conference call discussing business topics, project updates, decisions, and action items.',
            terms: [],
            translation_terms: [],
        },
    },
    {
        id: 'movie_cn',
        nameKey: 'ctx_preset_movie_cn',
        context: {
            general: [
                { key: 'domain', value: 'Chinese drama or movie' },
                { key: 'language style', value: 'Casual conversational Mandarin with slang' },
                { key: 'setting', value: 'Contemporary or period Chinese drama' },
            ],
            text: 'Chinese drama or movie dialogue with casual conversational Mandarin, including colloquial expressions and cultural references.',
            terms: [],
            translation_terms: [],
        },
    },
    {
        id: 'movie_en',
        nameKey: 'ctx_preset_movie_en',
        context: {
            general: [
                { key: 'domain', value: 'English action or drama movie' },
                { key: 'language style', value: 'Contemporary colloquial English' },
                { key: 'setting', value: 'Hollywood movie or TV show dialogue' },
            ],
            text: 'English movie or TV dialogue with colloquial expressions, idioms, and dramatized speech.',
            terms: [],
            translation_terms: [],
        },
    },
    {
        id: 'tech',
        nameKey: 'ctx_preset_tech',
        context: {
            general: [
                { key: 'domain', value: 'Software engineering and technology' },
                { key: 'setting', value: 'Tech conference talk or developer podcast' },
            ],
            text: 'A software engineering or technology conference presentation covering programming, system architecture, developer tools, and tech industry topics.',
            terms: ['API', 'SDK', 'WebSocket', 'microservice', 'backend', 'frontend', 'CI/CD', 'LLM', 'GPU', 'latency'],
            translation_terms: [],
        },
    },
    {
        id: 'medical',
        nameKey: 'ctx_preset_medical',
        context: {
            general: [
                { key: 'domain', value: 'Medical and healthcare' },
                { key: 'setting', value: 'Clinical consultation or medical conference' },
            ],
            text: 'A medical consultation or healthcare discussion involving clinical terminology, treatment plans, diagnosis, and patient care.',
            terms: [],
            translation_terms: [],
        },
    },
    {
        id: 'sport',
        nameKey: 'ctx_preset_sport',
        context: {
            general: [
                { key: 'domain', value: 'Sports commentary' },
                { key: 'setting', value: 'Live game broadcast or sports analysis show' },
            ],
            text: 'Sports commentary or game analysis with fast-paced narration, player names, team names, and sports-specific terminology.',
            terms: [],
            translation_terms: [],
        },
    },
];

const EMPTY_CONTEXT = { general: [], text: '', terms: [], translation_terms: [] };

function contextCharCount(ctx) {
    return JSON.stringify(ctx ?? EMPTY_CONTEXT).length;
}

// ─── Shared input className ───────────────────────────────────────────────────

const inputCls = [
    'bg-default-100 dark:bg-default-50/[0.06]',
    'border border-default-200 dark:border-default-700',
    'text-foreground text-xs rounded-lg px-2.5 py-1.5',
    'placeholder:text-default-400',
    'outline-none focus:border-primary/60 dark:focus:border-primary/50',
    'transition-colors duration-150',
].join(' ');

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label, count }) {
    return (
        <div className='flex items-center gap-1.5 mb-2'>
            <span className='text-[10px] font-bold text-default-600 dark:text-default-400 uppercase tracking-widest'>
                {label}
            </span>
            {count != null && count > 0 && (
                <span className='text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary leading-none'>
                    {count}
                </span>
            )}
        </div>
    );
}

function SectionCard({ children }) {
    return (
        <div className='rounded-xl border border-default-200 dark:border-default-700/60 bg-default-50 dark:bg-default-100/[0.04] p-3'>
            {children}
        </div>
    );
}

function KeyValueTable({ rows, onChange, keyPlaceholder, valuePlaceholder, addLabel }) {
    const addRow = () => onChange([...rows, { key: '', value: '' }]);
    const removeRow = (i) => onChange(rows.filter((_, idx) => idx !== i));
    const updateRow = (i, field, val) =>
        onChange(rows.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

    return (
        <div className='flex flex-col gap-1.5'>
            {rows.map((row, i) => (
                <div key={i} className='flex items-center gap-1.5'>
                    <input
                        value={row.key}
                        onChange={e => updateRow(i, 'key', e.target.value)}
                        placeholder={keyPlaceholder}
                        className={`w-[90px] flex-shrink-0 ${inputCls}`}
                    />
                    <input
                        value={row.value}
                        onChange={e => updateRow(i, 'value', e.target.value)}
                        placeholder={valuePlaceholder}
                        className={`flex-1 min-w-0 ${inputCls}`}
                    />
                    <button
                        onClick={() => removeRow(i)}
                        className='flex-shrink-0 w-5 h-5 flex items-center justify-center rounded text-default-400 hover:text-danger hover:bg-danger/10 transition-colors'
                    >
                        <MdClose className='text-[13px]' />
                    </button>
                </div>
            ))}
            <button
                onClick={addRow}
                className='flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors w-fit mt-0.5'
            >
                <MdAdd className='text-[14px]' />
                {addLabel}
            </button>
        </div>
    );
}

function TagInput({ tags, onChange, placeholder }) {
    const [draft, setDraft] = useState('');

    const commitDraft = () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        onChange([...tags, ...trimmed.split(',').map(s => s.trim()).filter(Boolean)]);
        setDraft('');
    };

    return (
        <div className='flex flex-wrap gap-1.5 p-2 rounded-lg border border-default-200 dark:border-default-700 bg-default-100 dark:bg-default-50/[0.06] focus-within:border-primary/60 dark:focus-within:border-primary/50 min-h-[36px] transition-colors duration-150'>
            {tags.map((tag, i) => (
                <span key={i} className='flex items-center gap-0.5 bg-primary/10 border border-primary/20 text-primary text-[11px] font-medium px-2 py-0.5 rounded-full leading-none'>
                    {tag}
                    <button
                        onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                        className='text-primary/60 hover:text-danger transition-colors ml-0.5'
                    >
                        <MdClose className='text-[10px]' />
                    </button>
                </span>
            ))}
            <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitDraft(); }
                    if (e.key === 'Backspace' && !draft && tags.length) onChange(tags.slice(0, -1));
                }}
                onBlur={commitDraft}
                placeholder={tags.length === 0 ? placeholder : ''}
                className='flex-1 min-w-[80px] bg-transparent text-xs text-foreground placeholder:text-default-400 outline-none'
            />
        </div>
    );
}

// ─── Main ContextPanel ────────────────────────────────────────────────────────

export default function ContextPanel({
    context,
    templates,
    aiServiceList,
    onContextChange,
    onSaveTemplate,
    onDeleteTemplate,
    onOpenAiSettings,
}) {
    const { t } = useTranslation();
    const ctx = context ?? EMPTY_CONTEXT;

    // ── Collapsible sections ────────────────────────────────────────────────────
    const [openSections, setOpenSections] = useState({ general: true, text: true, terms: true, translation: false });
    const toggleSection = (key) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

    // ── Preset save UI ──────────────────────────────────────────────────────────
    const [savingPreset, setSavingPreset] = useState(false);
    const [presetName, setPresetName] = useState('');

    // ── AI service names ────────────────────────────────────────────────────────
    const [serviceNames, setServiceNames] = useState({});
    const [selectedAiKey, setSelectedAiKey] = useState('');

    useEffect(() => {
        if (!aiServiceList?.length) return;
        Promise.all(
            aiServiceList.map(async key => {
                const cfg = await store.get(key).catch(() => null);
                const displayName = cfg?.instanceName || cfg?.service_instance_name || getServiceName(key);
                return [key, displayName];
            })
        ).then(pairs => {
            const map = Object.fromEntries(pairs);
            setServiceNames(map);
        });
        setSelectedAiKey(prev => prev && aiServiceList.includes(prev) ? prev : aiServiceList[0]);
    }, [aiServiceList?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── AI generate ─────────────────────────────────────────────────────────────
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiMsg, setAiMsg] = useState('');
    const [aiMsgType, setAiMsgType] = useState('');

    const showAiMsg = (msg, type, ms = 4000) => {
        setAiMsg(msg); setAiMsgType(type);
        setTimeout(() => setAiMsg(''), ms);
    };

    const handleGenerate = async () => {
        if (!aiPrompt.trim()) return;
        if (!aiServiceList?.length || !selectedAiKey) {
            showAiMsg(t('monitor.ctx_ai_no_service'), 'error', 6000);
            return;
        }
        setAiLoading(true);
        setAiMsg('');
        try {
            const generated = await generateSonioxContext(aiPrompt.trim(), selectedAiKey);
            onContextChange(generated);
            showAiMsg(t('monitor.ctx_ai_success'), 'success');
        } catch (err) {
            const msg = err.message === 'no_service'
                ? t('monitor.ctx_ai_no_service')
                : t('monitor.ctx_ai_error');
            showAiMsg(msg, 'error');
        } finally {
            setAiLoading(false);
        }
    };

    // ── Preset actions ──────────────────────────────────────────────────────────
    const handleSavePreset = () => {
        const name = presetName.trim();
        if (!name) return;
        onSaveTemplate(name, ctx);
        setPresetName('');
        setSavingPreset(false);
    };

    const isActive = (presetCtx) => JSON.stringify(ctx) === JSON.stringify(presetCtx);

    const allPresets = [
        ...BUILTIN_PRESETS.map(p => ({
            id: p.id,
            name: t(`monitor.${p.nameKey}`),
            context: p.context,
            builtin: true,
        })),
        ...(templates ?? []).map(p => ({ ...p, builtin: false })),
    ];

    const updateCtx = (patch) => onContextChange({ ...ctx, ...patch });
    const charCount = contextCharCount(ctx);
    const nearLimit = charCount > 8000;

    return (
        <div className='flex flex-col gap-2.5 text-sm'>

            {/* ── Presets ── */}
            <SectionCard>
                <div className='flex items-center justify-between mb-2'>
                    <SectionLabel label={t('monitor.ctx_presets_label')} />
                    <button
                        onClick={() => setSavingPreset(v => !v)}
                        className='flex items-center gap-1 text-[11px] text-default-500 hover:text-primary transition-colors'
                    >
                        <MdSave className='text-[12px]' />
                        {t('monitor.ctx_preset_save')}
                    </button>
                </div>

                <div className='flex flex-wrap gap-1'>
                    {allPresets.map(preset => (
                        <div key={preset.id} className='flex items-stretch'>
                            <button
                                onClick={() => onContextChange(preset.context)}
                                className={`h-6 flex items-center px-2.5 text-[11px] font-medium rounded-l-lg border transition-all duration-150 ${
                                    isActive(preset.context)
                                        ? 'bg-primary/15 border-primary/40 text-primary'
                                        : 'bg-default-100 dark:bg-default-50/[0.06] border-default-200 dark:border-default-700 text-default-600 dark:text-default-400 hover:text-foreground hover:border-default-400 dark:hover:border-default-500'
                                } ${preset.builtin ? 'rounded-r-lg' : ''}`}
                            >
                                {preset.name}
                                {preset.builtin && (
                                    <span className='ml-1 text-[9px] opacity-40 font-normal'>{t('monitor.ctx_preset_builtin')}</span>
                                )}
                            </button>
                            {!preset.builtin && (
                                <button
                                    onClick={() => onDeleteTemplate(preset.id)}
                                    className='h-6 w-5 flex items-center justify-center rounded-r-lg border-t border-b border-r border-default-200 dark:border-default-700 text-default-400 hover:text-danger hover:border-danger/40 dark:hover:border-danger/40 transition-colors'
                                    title={t('monitor.ctx_preset_delete')}
                                >
                                    <MdClose className='text-[11px]' />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {savingPreset && (
                    <div className='flex items-center gap-1.5 mt-2 pt-2 border-t border-default-200 dark:border-default-700'>
                        <input
                            autoFocus
                            value={presetName}
                            onChange={e => setPresetName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSavePreset();
                                if (e.key === 'Escape') setSavingPreset(false);
                            }}
                            placeholder={t('monitor.ctx_preset_name_placeholder')}
                            className={`flex-1 ${inputCls}`}
                        />
                        <button
                            onClick={handleSavePreset}
                            disabled={!presetName.trim()}
                            className='px-3 py-1.5 text-[11px] font-medium bg-primary/15 text-primary rounded-lg border border-primary/30 hover:bg-primary/25 transition-colors disabled:opacity-40 flex-shrink-0'
                        >
                            {t('monitor.ctx_preset_confirm_save')}
                        </button>
                        <button
                            onClick={() => setSavingPreset(false)}
                            className='w-6 h-6 flex items-center justify-center rounded text-default-400 hover:text-foreground hover:bg-default-200 dark:hover:bg-default-700 transition-colors flex-shrink-0'
                        >
                            <MdClose className='text-[13px]' />
                        </button>
                    </div>
                )}
            </SectionCard>

            {/* ── AI Generate ── */}
            <SectionCard>
                <SectionLabel label={t('monitor.ctx_ai_label')} />

                {aiServiceList?.length > 0 ? (
                    <div className='flex flex-col gap-1.5'>
                        <select
                            value={selectedAiKey}
                            onChange={e => setSelectedAiKey(e.target.value)}
                            className={`w-full ${inputCls} cursor-pointer`}
                        >
                            {aiServiceList.map(key => (
                                <option key={key} value={key}>
                                    {serviceNames[key] || getServiceName(key)}
                                </option>
                            ))}
                        </select>
                        <div className='flex gap-1.5'>
                            <input
                                value={aiPrompt}
                                onChange={e => setAiPrompt(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleGenerate()}
                                placeholder={t('monitor.ctx_ai_placeholder')}
                                disabled={aiLoading}
                                className={`flex-1 min-w-0 ${inputCls} disabled:opacity-50`}
                            />
                            <button
                                onClick={handleGenerate}
                                disabled={aiLoading || !aiPrompt.trim()}
                                className='flex items-center gap-1 px-3 py-1.5 text-[11px] font-medium bg-primary/15 text-primary rounded-lg border border-primary/30 hover:bg-primary/25 transition-colors disabled:opacity-40 flex-shrink-0'
                            >
                                <MdAutoAwesome className={`text-[12px] ${aiLoading ? 'animate-spin' : ''}`} />
                                {aiLoading ? t('monitor.ctx_ai_generating') : t('monitor.ctx_ai_generate')}
                            </button>
                        </div>
                        {aiMsg && (
                            <p className={`text-[11px] ${aiMsgType === 'success' ? 'text-success' : 'text-danger'}`}>
                                {aiMsg}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className='flex flex-col gap-1 p-2.5 bg-danger/5 border border-danger/20 rounded-lg'>
                        <p className='text-xs text-danger'>{t('monitor.ctx_ai_no_service')}</p>
                        <button
                            onClick={onOpenAiSettings}
                            className='text-[11px] text-primary underline text-left hover:opacity-80 transition-opacity'
                        >
                            Settings → Service → AI
                        </button>
                    </div>
                )}
            </SectionCard>

            {/* ── General key-value ── */}
            <SectionCard>
                <button
                    className='flex items-center justify-between w-full mb-0'
                    onClick={() => toggleSection('general')}
                >
                    <SectionLabel label={t('monitor.ctx_general_label')} count={ctx.general?.length} />
                    {openSections.general
                        ? <MdExpandLess className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                        : <MdExpandMore className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                    }
                </button>
                {openSections.general && (
                    <KeyValueTable
                        rows={ctx.general ?? []}
                        onChange={rows => updateCtx({ general: rows })}
                        keyPlaceholder={t('monitor.ctx_general_key_placeholder')}
                        valuePlaceholder={t('monitor.ctx_general_value_placeholder')}
                        addLabel={t('monitor.ctx_general_add')}
                    />
                )}
            </SectionCard>

            {/* ── Background text ── */}
            <SectionCard>
                <button
                    className='flex items-center justify-between w-full mb-0'
                    onClick={() => toggleSection('text')}
                >
                    <SectionLabel label={t('monitor.ctx_text_label')} />
                    {openSections.text
                        ? <MdExpandLess className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                        : <MdExpandMore className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                    }
                </button>
                {openSections.text && (
                    <textarea
                        value={ctx.text ?? ''}
                        onChange={e => updateCtx({ text: e.target.value })}
                        placeholder={t('monitor.ctx_text_placeholder')}
                        rows={3}
                        className={`w-full ${inputCls} resize-none leading-relaxed`}
                    />
                )}
            </SectionCard>

            {/* ── Terms ── */}
            <SectionCard>
                <button
                    className='flex items-center justify-between w-full mb-0'
                    onClick={() => toggleSection('terms')}
                >
                    <SectionLabel label={t('monitor.ctx_terms_label')} count={ctx.terms?.length} />
                    {openSections.terms
                        ? <MdExpandLess className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                        : <MdExpandMore className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                    }
                </button>
                {openSections.terms && (
                    <TagInput
                        tags={ctx.terms ?? []}
                        onChange={tags => updateCtx({ terms: tags })}
                        placeholder={t('monitor.ctx_terms_new_placeholder')}
                    />
                )}
            </SectionCard>

            {/* ── Translation terms ── */}
            <SectionCard>
                <button
                    className='flex items-center justify-between w-full mb-0'
                    onClick={() => toggleSection('translation')}
                >
                    <SectionLabel label={t('monitor.ctx_translation_terms_label')} count={ctx.translation_terms?.length} />
                    {openSections.translation
                        ? <MdExpandLess className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                        : <MdExpandMore className='text-default-400 text-[16px] flex-shrink-0 mb-2' />
                    }
                </button>
                {openSections.translation && (
                    <KeyValueTable
                        rows={ctx.translation_terms ?? []}
                        onChange={rows => updateCtx({ translation_terms: rows })}
                        keyPlaceholder={t('monitor.ctx_translation_src_placeholder')}
                        valuePlaceholder={t('monitor.ctx_translation_tgt_placeholder')}
                        addLabel={t('monitor.ctx_translation_add')}
                    />
                )}
            </SectionCard>

            {/* ── Char count warning ── */}
            {nearLimit && (
                <p className='text-[11px] text-warning text-right'>
                    {t('monitor.ctx_char_limit_warning')} ({charCount.toLocaleString()} / 10,000)
                </p>
            )}
        </div>
    );
}
