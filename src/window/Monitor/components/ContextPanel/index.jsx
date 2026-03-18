import React, { useState, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MdAdd, MdClose, MdAutoAwesome, MdSave } from 'react-icons/md';
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

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionLabel({ label }) {
    return (
        <p className='text-xs font-semibold text-default-500 uppercase tracking-wide mb-1.5'>
            {label}
        </p>
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
                        className='w-[100px] flex-shrink-0 bg-content1 text-xs rounded px-2 py-1 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/60'
                    />
                    <input
                        value={row.value}
                        onChange={e => updateRow(i, 'value', e.target.value)}
                        placeholder={valuePlaceholder}
                        className='flex-1 min-w-0 bg-content1 text-xs rounded px-2 py-1 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/60'
                    />
                    <button
                        onClick={() => removeRow(i)}
                        className='text-default-400 hover:text-danger transition-colors flex-shrink-0'
                    >
                        <MdClose className='text-[14px]' />
                    </button>
                </div>
            ))}
            <button
                onClick={addRow}
                className='flex items-center gap-1 text-xs text-secondary hover:text-secondary/80 transition-colors'
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
        <div className='flex flex-wrap gap-1.5 p-2 bg-content1 rounded border border-content3/50 focus-within:border-secondary/60 min-h-[32px]'>
            {tags.map((tag, i) => (
                <span key={i} className='flex items-center gap-0.5 bg-content3/60 text-xs px-2 py-0.5 rounded text-default-foreground'>
                    {tag}
                    <button
                        onClick={() => onChange(tags.filter((_, idx) => idx !== i))}
                        className='text-default-400 hover:text-danger transition-colors ml-0.5'
                    >
                        <MdClose className='text-[11px]' />
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
                className='flex-1 min-w-[80px] bg-transparent text-xs text-default-foreground placeholder:text-default-400 outline-none'
            />
        </div>
    );
}

// ─── Main ContextPanel ────────────────────────────────────────────────────────

export default function ContextPanel({
    context,
    templates,
    aiServiceList,       // string[] of service instance keys
    onContextChange,
    onSaveTemplate,
    onDeleteTemplate,
    onOpenAiSettings,
}) {
    const { t } = useTranslation();
    const ctx = context ?? EMPTY_CONTEXT;

    // ── Preset save UI ─────────────────────────────────────────────────────────
    const [savingPreset, setSavingPreset] = useState(false);
    const [presetName, setPresetName] = useState('');

    // ── AI service names ───────────────────────────────────────────────────────
    const [serviceNames, setServiceNames] = useState({}); // { [key]: displayName }
    const [selectedAiKey, setSelectedAiKey] = useState('');

    useEffect(() => {
        if (!aiServiceList?.length) return;
        // Load instance names from store
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
        // Default to first
        setSelectedAiKey(prev => prev && aiServiceList.includes(prev) ? prev : aiServiceList[0]);
    }, [aiServiceList?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── AI generate ────────────────────────────────────────────────────────────
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiMsg, setAiMsg] = useState('');
    const [aiMsgType, setAiMsgType] = useState(''); // 'success' | 'error'

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

    // ── Preset actions ─────────────────────────────────────────────────────────
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
        <div className='flex flex-col gap-3 text-sm'>

            {/* ── Presets ── */}
            <div>
                <div className='flex items-center justify-between mb-1.5'>
                    <SectionLabel label={t('monitor.ctx_presets_label')} />
                    <button
                        onClick={() => setSavingPreset(v => !v)}
                        className='flex items-center gap-1 text-xs text-secondary hover:text-secondary/80 transition-colors'
                    >
                        <MdSave className='text-[13px]' />
                        {t('monitor.ctx_preset_save')}
                    </button>
                </div>

                <div className='flex flex-wrap gap-1.5'>
                    {allPresets.map(preset => (
                        <div key={preset.id} className='flex items-center'>
                            <button
                                onClick={() => onContextChange(preset.context)}
                                className={`px-2.5 py-1 text-xs rounded-l-md border transition-colors ${
                                    isActive(preset.context)
                                        ? 'bg-secondary/20 border-secondary/50 text-secondary font-medium'
                                        : 'bg-content3/40 border-content3/50 text-default-600 hover:text-default-foreground hover:bg-content3/60'
                                } ${preset.builtin ? 'rounded-r-md' : ''}`}
                            >
                                {preset.name}
                                {preset.builtin && (
                                    <span className='ml-1 text-[9px] opacity-40'>{t('monitor.ctx_preset_builtin')}</span>
                                )}
                            </button>
                            {!preset.builtin && (
                                <button
                                    onClick={() => onDeleteTemplate(preset.id)}
                                    className='px-1.5 py-1 rounded-r-md border-t border-b border-r border-content3/50 text-default-400 hover:text-danger hover:border-danger/30 transition-colors'
                                    title={t('monitor.ctx_preset_delete')}
                                >
                                    <MdClose className='text-[12px]' />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {savingPreset && (
                    <div className='flex items-center gap-1.5 mt-2'>
                        <input
                            autoFocus
                            value={presetName}
                            onChange={e => setPresetName(e.target.value)}
                            onKeyDown={e => {
                                if (e.key === 'Enter') handleSavePreset();
                                if (e.key === 'Escape') setSavingPreset(false);
                            }}
                            placeholder={t('monitor.ctx_preset_name_placeholder')}
                            className='flex-1 bg-content1 text-xs rounded px-2 py-1 border border-secondary/40 text-default-foreground placeholder:text-default-400 outline-none'
                        />
                        <button
                            onClick={handleSavePreset}
                            disabled={!presetName.trim()}
                            className='px-3 py-1 text-xs bg-secondary/20 text-secondary rounded border border-secondary/40 hover:bg-secondary/30 transition-colors disabled:opacity-40'
                        >
                            {t('monitor.ctx_preset_confirm_save')}
                        </button>
                        <button onClick={() => setSavingPreset(false)} className='text-default-400 hover:text-default-foreground'>
                            <MdClose className='text-[14px]' />
                        </button>
                    </div>
                )}
            </div>

            <div className='border-t border-content3/30' />

            {/* ── AI Generate ── */}
            <div>
                <SectionLabel label={t('monitor.ctx_ai_label')} />

                {/* AI Provider select */}
                {aiServiceList?.length > 0 ? (
                    <div className='flex flex-col gap-1.5'>
                        <select
                            value={selectedAiKey}
                            onChange={e => setSelectedAiKey(e.target.value)}
                            className='w-full bg-content1 text-xs rounded px-2 py-1 border border-content3/50 text-default-foreground outline-none focus:border-secondary/60 cursor-pointer'
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
                                className='flex-1 min-w-0 bg-content1 text-xs rounded px-2 py-1 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/60 disabled:opacity-50'
                            />
                            <button
                                onClick={handleGenerate}
                                disabled={aiLoading || !aiPrompt.trim()}
                                className='flex items-center gap-1 px-3 py-1 text-xs bg-secondary/20 text-secondary rounded border border-secondary/40 hover:bg-secondary/30 transition-colors disabled:opacity-40 flex-shrink-0'
                            >
                                <MdAutoAwesome className={`text-[13px] ${aiLoading ? 'animate-spin' : ''}`} />
                                {aiLoading ? t('monitor.ctx_ai_generating') : t('monitor.ctx_ai_generate')}
                            </button>
                        </div>
                        {aiMsg && (
                            <p className={`text-xs ${aiMsgType === 'success' ? 'text-success' : 'text-danger'}`}>
                                {aiMsg}
                            </p>
                        )}
                    </div>
                ) : (
                    <div className='flex flex-col gap-1 p-2.5 bg-danger/5 border border-danger/20 rounded-lg'>
                        <p className='text-xs text-danger'>{t('monitor.ctx_ai_no_service')}</p>
                        <button
                            onClick={onOpenAiSettings}
                            className='text-xs text-secondary underline text-left hover:opacity-80 transition-opacity'
                        >
                            Settings → Service → AI
                        </button>
                    </div>
                )}
            </div>

            <div className='border-t border-content3/30' />

            {/* ── General key-value ── */}
            <div>
                <SectionLabel label={`${t('monitor.ctx_general_label')}${ctx.general?.length ? ` (${ctx.general.length})` : ''}`} />
                <KeyValueTable
                    rows={ctx.general ?? []}
                    onChange={rows => updateCtx({ general: rows })}
                    keyPlaceholder={t('monitor.ctx_general_key_placeholder')}
                    valuePlaceholder={t('monitor.ctx_general_value_placeholder')}
                    addLabel={t('monitor.ctx_general_add')}
                />
            </div>

            {/* ── Background text ── */}
            <div>
                <SectionLabel label={t('monitor.ctx_text_label')} />
                <textarea
                    value={ctx.text ?? ''}
                    onChange={e => updateCtx({ text: e.target.value })}
                    placeholder={t('monitor.ctx_text_placeholder')}
                    rows={3}
                    className='w-full bg-content1 text-xs rounded px-2 py-1.5 border border-content3/50 text-default-foreground placeholder:text-default-400 outline-none focus:border-secondary/60 resize-none'
                />
            </div>

            {/* ── Terms ── */}
            <div>
                <SectionLabel label={`${t('monitor.ctx_terms_label')}${ctx.terms?.length ? ` (${ctx.terms.length})` : ''}`} />
                <TagInput
                    tags={ctx.terms ?? []}
                    onChange={tags => updateCtx({ terms: tags })}
                    placeholder={t('monitor.ctx_terms_new_placeholder')}
                />
            </div>

            {/* ── Translation terms ── */}
            <div>
                <SectionLabel label={`${t('monitor.ctx_translation_terms_label')}${ctx.translation_terms?.length ? ` (${ctx.translation_terms.length})` : ''}`} />
                <KeyValueTable
                    rows={ctx.translation_terms ?? []}
                    onChange={rows => updateCtx({ translation_terms: rows })}
                    keyPlaceholder={t('monitor.ctx_translation_src_placeholder')}
                    valuePlaceholder={t('monitor.ctx_translation_tgt_placeholder')}
                    addLabel={t('monitor.ctx_translation_add')}
                />
            </div>

            {/* ── Char count warning ── */}
            {nearLimit && (
                <p className='text-xs text-warning'>{t('monitor.ctx_char_limit_warning')} ({charCount.toLocaleString()} / 10,000)</p>
            )}
        </div>
    );
}
