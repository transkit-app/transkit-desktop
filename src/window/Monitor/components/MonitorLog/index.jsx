import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { MdMicNone, MdVolumeUp, MdVolumeOff, MdAutoAwesome, MdClose, MdKeyboardArrowDown, MdBookmark, MdBookmarkBorder, MdPlayCircle, MdTune, MdRefresh } from 'react-icons/md';
import { motion, AnimatePresence } from 'framer-motion';
import { writeTextFile } from '@tauri-apps/api/fs';
import { generateAiSuggestion } from '../../../../utils/generateAiSuggestion';
import { getServiceName } from '../../../../utils/service_instance';

// ── Speaker helpers ───────────────────────────────────────────────────────────

const SPEAKER_COLORS = [
    '#60a5fa', '#f472b6', '#34d399', '#fb923c',
    '#a78bfa', '#22d3ee', '#facc15', '#f87171',
];

function formatSpeaker(speaker) {
    if (!speaker) return null;
    const m = speaker.match(/^S?(\d+)$/);
    return m ? `Speaker ${m[1]}` : speaker;
}

function getSpeakerColor(speaker) {
    if (!speaker) return null;
    const m = speaker.match(/^S?(\d+)$/);
    const idx = m ? (parseInt(m[1], 10) - 1) : Math.abs(speaker.charCodeAt(0));
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

const TTS_DISPLAY_NAMES = {
    edge_tts:       'Edge TTS',
    google_tts:     'Google TTS',
    elevenlabs_tts: 'ElevenLabs',
    vieneu_tts:     'VieNeu TTS',
    openai_tts:     'OpenAI TTS',
};

// ── Tooltip wrapper ───────────────────────────────────────────────────────────

function Tooltip({ label, children, placement = 'top' }) {
    const [show, setShow] = useState(false);
    const isBottom = placement === 'bottom';
    return (
        <div
            className='relative flex items-center'
            onMouseEnter={() => setShow(true)}
            onMouseLeave={() => setShow(false)}
        >
            {children}
            <AnimatePresence>
                {show && label && (
                    <motion.div
                        initial={{ opacity: 0, y: isBottom ? -4 : 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: isBottom ? -4 : 4 }}
                        transition={{ duration: 0.12 }}
                        className={`absolute ${isBottom ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} left-1/2 -translate-x-1/2 px-2 py-1 rounded-md text-[10px] font-medium whitespace-nowrap pointer-events-none z-50 shadow-lg`}
                        style={{ background: 'hsl(var(--nextui-foreground))', color: 'hsl(var(--nextui-background))' }}
                    >
                        {label}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── AI Suggestion card ────────────────────────────────────────────────────────

function AiSuggestionCard({ state, onDismiss, onRegenerate, onFontSizeChange, fontSize, t }) {
    const [collapsed, setCollapsed] = useState(false);
    if (state.status === 'idle') return null;
    const fs = fontSize ?? 16;
    const r = state.result;
    const modes = r?.modes ?? ['suggest_answer'];
    const isLoading = state.status === 'loading';

    // Sections render in fixed order; each only shows if mode is active AND has content
    const has = (m) => modes.includes(m);

    const sections = [];

    if (state.status === 'done' && r) {
        if (has('suggest_answer') && r.research) {
            sections.push(
                <div key='research' className='px-4 py-3 border-b border-secondary/10'>
                    <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-2'>
                        📖 {t('monitor.ai_suggestion_research')}
                    </p>
                    <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap' style={{ fontSize: fs }}>
                        {r.research}
                        {r.research_t && <span className='block text-default-400 mt-0.5 whitespace-pre-wrap' style={{ fontSize: fs - 1 }}>{r.research_t}</span>}
                    </p>
                </div>
            );
        }

        if (has('suggest_answer') && (r.suggestedAnswerSource || r.suggestedAnswerTarget)) {
            const rl = r.responseLang ?? 'both';
            const showSource = (rl === 'source' || rl === 'both') && r.suggestedAnswerSource;
            const showTarget = rl === 'target' && r.suggestedAnswerTarget;
            sections.push(
                <div key='answer' className='px-4 py-3 border-b border-secondary/10'>
                    <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-2'>
                        💬 {t('monitor.ai_suggestion_answer')}
                    </p>
                    {showSource && (
                        <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-secondary/40' style={{ fontSize: fs }}>
                            {r.suggestedAnswerSource}
                            {rl === 'both' && r.suggestedAnswerTarget && (
                                <span className='block text-default-400 mt-0.5' style={{ fontSize: fs - 1 }}>{r.suggestedAnswerTarget}</span>
                            )}
                        </p>
                    )}
                    {showTarget && (
                        <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-primary/40' style={{ fontSize: fs }}>
                            {r.suggestedAnswerTarget}
                        </p>
                    )}
                </div>
            );
        }

        if (has('quick_insight') && (r.key_point || r.suggested_next_step)) {
            sections.push(
                <div key='insight' className='px-4 py-3 flex flex-col gap-3 border-b border-secondary/10'>
                    {r.key_point && (
                        <div>
                            <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-1.5'>
                                💡 {t('monitor.ci_key_point')}
                            </p>
                            <p className='text-default-700 dark:text-default-300 leading-relaxed' style={{ fontSize: fs }}>
                                {r.key_point}
                                {r.key_point_t && <span className='block text-default-400 mt-0.5' style={{ fontSize: fs - 1 }}>{r.key_point_t}</span>}
                            </p>
                        </div>
                    )}
                    {r.suggested_next_step && (
                        <div>
                            <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-1.5'>
                                → {t('monitor.ci_next_step')}
                            </p>
                            <p className='text-default-700 dark:text-default-300 leading-relaxed' style={{ fontSize: fs }}>
                                {r.suggested_next_step}
                                {r.suggested_next_step_t && <span className='block text-default-400 mt-0.5' style={{ fontSize: fs - 1 }}>{r.suggested_next_step_t}</span>}
                            </p>
                        </div>
                    )}
                </div>
            );
        }

        if (has('summarize') && r.bullet_points?.length > 0) {
            sections.push(
                <div key='summary' className='px-4 py-3 border-b border-secondary/10'>
                    <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-2'>
                        📋 {t('monitor.ci_summary_points')}
                    </p>
                    <ul className='flex flex-col gap-1.5'>
                        {r.bullet_points.map((pt, i) => (
                            <li key={i} className='flex gap-2 text-default-700 dark:text-default-300 leading-relaxed' style={{ fontSize: fs }}>
                                <span className='text-secondary/50 flex-shrink-0 mt-0.5'>·</span>
                                <span>
                                    {pt}
                                    {r.bullet_points_t?.[i] && <span className='block text-default-400' style={{ fontSize: fs - 1 }}>{r.bullet_points_t[i]}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }

        if (has('follow_up') && r.questions?.length > 0) {
            sections.push(
                <div key='followup' className='px-4 py-3 border-b border-secondary/10'>
                    <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-2'>
                        ❓ {t('monitor.ci_questions')}
                    </p>
                    <ul className='flex flex-col gap-1.5'>
                        {r.questions.map((q, i) => (
                            <li key={i} className='flex gap-2 text-default-700 dark:text-default-300 leading-relaxed' style={{ fontSize: fs }}>
                                <span className='text-secondary/50 flex-shrink-0 font-semibold'>{i + 1}.</span>
                                <span>
                                    {q}
                                    {r.questions_t?.[i] && <span className='block text-default-400' style={{ fontSize: fs - 1 }}>{r.questions_t[i]}</span>}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            );
        }
    }

    // Strip trailing border from last section
    const renderedSections = sections.map((s, i) =>
        i === sections.length - 1
            ? React.cloneElement(s, { className: s.props.className.replace(' border-b border-secondary/10', '') })
            : s
    );

    const btnCls = 'text-default-400 hover:text-default-600 transition-colors p-0.5 rounded disabled:opacity-40 disabled:cursor-not-allowed';

    return (
        <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className='mt-2 ml-2 rounded-xl border border-secondary/30 overflow-hidden'
            style={{ background: 'rgba(120, 80, 220, 0.06)' }}
        >
            {/* Header — click to collapse/expand */}
            <div
                className='flex items-center justify-between px-3 py-2 border-b border-secondary/20 cursor-pointer select-none'
                style={{ background: 'rgba(120, 80, 220, 0.10)' }}
                onClick={() => setCollapsed(c => !c)}
            >
                <div className='flex items-center gap-1.5'>
                    <MdAutoAwesome className='text-secondary text-[14px] flex-shrink-0' />
                    <span className='text-[11px] font-bold text-secondary uppercase tracking-widest'>AI Suggestion</span>
                </div>
                <div className='flex items-center gap-0.5' onClick={e => e.stopPropagation()}>
                    <Tooltip label='A−'>
                        <button className={btnCls} onClick={() => onFontSizeChange?.(Math.max(10, fs - 1))}>
                            <span className='text-[10px] font-bold leading-none'>A−</span>
                        </button>
                    </Tooltip>
                    <Tooltip label='A+'>
                        <button className={btnCls} onClick={() => onFontSizeChange?.(Math.min(28, fs + 1))}>
                            <span className='text-[11px] font-bold leading-none'>A+</span>
                        </button>
                    </Tooltip>
                    <Tooltip label={t('monitor.ai_suggestion_regenerate')}>
                        <button className={btnCls} onClick={() => onRegenerate?.()} disabled={isLoading}>
                            <MdRefresh className={`text-[14px] ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </Tooltip>
                    <Tooltip label={t('monitor.ai_suggestion_dismiss')}>
                        <button className={btnCls} onClick={onDismiss}>
                            <MdClose className='text-[14px]' />
                        </button>
                    </Tooltip>
                    <MdKeyboardArrowDown
                        className='text-default-400 text-[14px] ml-0.5 transition-transform'
                        style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
                    />
                </div>
            </div>

            {!collapsed && (
                <>
                    {/* Loading */}
                    {isLoading && (
                        <div className='flex items-center gap-2 px-4 py-4'>
                            <MdAutoAwesome className='text-secondary text-[16px] animate-spin' />
                            <span style={{ fontSize: fs - 2 }} className='text-default-500'>{t('monitor.ai_suggestion_loading')}</span>
                        </div>
                    )}

                    {/* Error */}
                    {state.status === 'error' && (
                        <div className='px-4 py-3'>
                            <p style={{ fontSize: fs - 2 }} className='text-danger'>{state.error || t('monitor.ai_suggestion_error')}</p>
                        </div>
                    )}

                    {/* Result sections (may show stale result while reloading) */}
                    {(state.status === 'done' || (isLoading && r)) && renderedSections.length > 0 && (
                        <div className={`flex flex-col ${isLoading ? 'opacity-50' : ''}`}>{renderedSections}</div>
                    )}
                </>
            )}
        </motion.div>
    );
}

// ── Bookmark minimap widget ───────────────────────────────────────────────────

const BOOKMARK_WIDGET_W = 22;

function BookmarkSidebar({ entries, bookmarks, entryRefs, scrollContainerRef }) {
    const [showPanel, setShowPanel] = useState(false);
    const [hoveredId, setHoveredId] = useState(null);
    const hideTimer = useRef(null);

    const bookmarkedEntries = entries.filter(e => bookmarks.has(e.id));
    if (bookmarkedEntries.length === 0) return null;

    const cancelHide = () => {
        clearTimeout(hideTimer.current);
        setShowPanel(true);
    };
    const scheduleHide = () => {
        hideTimer.current = setTimeout(() => {
            setShowPanel(false);
            setHoveredId(null);
        }, 120);
    };

    const scrollToEntry = (entryId) => {
        const el = entryRefs.current[entryId];
        const container = scrollContainerRef.current;
        if (!el || !container) return;
        container.scrollTo({ top: Math.max(0, el.offsetTop - 40), behavior: 'smooth' });
    };

    return (
        <div
            className='absolute right-0 top-1/2 -translate-y-1/2 z-20 flex items-center'
            style={{ width: BOOKMARK_WIDGET_W }}
            onMouseEnter={cancelHide}
            onMouseLeave={scheduleHide}
        >
            {/* Bookmark list panel */}
            {showPanel && (
                <div
                    className='absolute right-full mr-2 w-[420px] rounded-xl shadow-2xl border border-content3/40 overflow-hidden'
                    onMouseEnter={cancelHide}
                    onMouseLeave={scheduleHide}
                    style={{
                        top: '50%',
                        transform: 'translateY(-50%)',
                        maxHeight: '480px',
                        background: 'hsl(var(--nextui-content1))',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
                    }}
                >
                    {/* Panel header */}
                    <div className='px-3 py-2 border-b border-content3/40 flex items-center gap-1.5'>
                        <MdBookmark className='text-secondary text-[13px]' />
                        <span className='text-[10px] font-semibold text-default-400 uppercase tracking-wider'>
                            Bookmarks
                        </span>
                        <span className='ml-auto text-[10px] font-medium text-default-300'>
                            {bookmarkedEntries.length}
                        </span>
                    </div>

                    {/* Bookmark list */}
                    <div className='overflow-y-auto' style={{ maxHeight: '436px' }}>
                        {bookmarkedEntries.map((entry, i) => {
                            const isActive = hoveredId === entry.id;
                            const original = (entry.original || '').slice(0, 100);
                            const translation = (entry.translation || '').slice(0, 100);
                            return (
                                <button
                                    key={entry.id}
                                    className='w-full text-left flex items-start gap-2.5 px-3 py-2.5 transition-colors border-b border-content3/20 last:border-0'
                                    style={{ background: isActive ? 'rgba(168,85,247,0.08)' : undefined }}
                                    onMouseEnter={() => setHoveredId(entry.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    onClick={() => { scrollToEntry(entry.id); setShowPanel(false); }}
                                >
                                    <span className='text-[10px] text-default-300 font-mono mt-0.5 flex-shrink-0 w-4 text-right select-none'>
                                        {i + 1}
                                    </span>
                                    <div className='flex flex-col gap-0.5 min-w-0'>
                                        {original && (
                                            <p className='text-[11px] leading-snug text-default-400 line-clamp-2'>
                                                {original}{original.length >= 100 ? '…' : ''}
                                            </p>
                                        )}
                                        {translation && (
                                            <p className='text-[12px] leading-snug text-foreground/85 font-medium line-clamp-2'>
                                                {translation}{translation.length >= 100 ? '…' : ''}
                                            </p>
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Minimap bars — stacked in center */}
            <div className='flex flex-col items-center gap-[4px] py-2.5 px-1 cursor-pointer'>
                {bookmarkedEntries.map(entry => {
                    const isActive = hoveredId === entry.id;
                    return (
                        <div
                            key={entry.id}
                            className='rounded-full'
                            style={{
                                width: isActive ? 16 : 13,
                                height: 3,
                                background: isActive
                                    ? 'rgba(168,85,247,0.95)'
                                    : showPanel
                                        ? 'rgba(168,85,247,0.45)'
                                        : 'rgba(168,85,247,0.28)',
                                boxShadow: isActive ? '0 0 7px rgba(168,85,247,0.6)' : 'none',
                                transition: 'all 0.13s ease',
                            }}
                            onMouseEnter={() => setHoveredId(entry.id)}
                            onMouseLeave={() => setHoveredId(null)}
                        />
                    );
                })}
            </div>
        </div>
    );
}

// ── Service chip group ────────────────────────────────────────────────────────

function ServiceChipGroup({ label, icon, items, activeKey, onSelect, getLabel, activeColor = 'primary' }) {
    // Compare by full key first, fall back to service-name-only match
    // (handles cases where active key lacks @id suffix)
    const isKeyActive = (instanceKey) =>
        instanceKey === activeKey ||
        (activeKey && getServiceName(instanceKey) === getServiceName(activeKey));

    return (
        <div className='flex flex-col items-center gap-2 w-full'>
            <div className='flex items-center gap-1.5' style={{ color: 'hsl(var(--nextui-default-400))' }}>
                {icon}
                <p className='text-[10px] uppercase tracking-widest font-semibold'>{label}</p>
            </div>
            <div className='flex flex-wrap justify-center gap-1.5'>
                {items.map(instanceKey => {
                    const isActive = isKeyActive(instanceKey);
                    return (
                        <button
                            key={instanceKey}
                            onClick={() => onSelect?.(instanceKey)}
                            className='px-3 py-1 rounded-full text-[11px] font-semibold border transition-all'
                            style={isActive ? {
                                borderColor: `hsl(var(--nextui-${activeColor}) / 0.7)`,
                                color: `hsl(var(--nextui-${activeColor}))`,
                                background: `hsl(var(--nextui-${activeColor}) / 0.12)`,
                            } : {
                                borderColor: 'hsl(var(--nextui-default-200))',
                                color: 'hsl(var(--nextui-default-400))',
                                background: 'transparent',
                            }}
                        >
                            {getLabel(instanceKey)}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MonitorLog({
    entries,
    provisional,
    fontSize = 14,
    isSubMode = false,
    showOriginal = true,
    playingText = null,
    onReplayEntry,
    status = 'disconnected',
    sortOrder = 'asc',
    aiSuggestionService = '',
    aiSuggestionContextLines = 10,
    aiSuggestionResponseLang = 'both',
    aiSuggestionFontSize = 16,
    aiSuggestionModes = ['suggest_answer'],
    userProfile = {},
    sourceLang = 'auto',
    targetLang = 'vi',
    transcriptFileRef = null,
    onToggleRun,
    activeTranscriptionService = '',
    onSetTranscriptionService,
    transcriptionServiceList = [],
    activeTtsService = '',
    onSetTtsService,
    ttsServiceList = [],
    isTTSEnabled = false,
    onSetAiSuggestionFontSize,
}) {
    const { t } = useTranslation();
    const scrollRef = useRef(null);
    const bottomRef = useRef(null);
    const topRef = useRef(null);
    const isUserScrolledRef = useRef(false);
    const entryRefs = useRef({});

    const [isUserScrolled, setIsUserScrolled] = useState(false);
    const [suggestions, setSuggestions] = useState({});
    const [bookmarks, setBookmarks] = useState(new Set());

    // ── Reset scroll lock and jump to latest when sort order flips.
    useEffect(() => {
        isUserScrolledRef.current = false;
        setIsUserScrolled(false);
        const el = scrollRef.current;
        if (!el) return;
        if (sortOrder === 'desc') {
            el.scrollTop = 0;
        } else {
            el.scrollTop = el.scrollHeight;
        }
    }, [sortOrder]);

    // ── Auto-scroll to latest — instant scroll to avoid jitter with new content.
    useEffect(() => {
        if (!isUserScrolledRef.current) {
            const el = scrollRef.current;
            if (!el) return;
            if (sortOrder === 'desc') {
                el.scrollTop = 0;
            } else {
                el.scrollTop = el.scrollHeight;
            }
        }
    }, [entries, provisional]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const scrolled = sortOrder === 'desc'
            ? el.scrollTop > 80
            : el.scrollHeight - el.scrollTop - el.clientHeight > 80;
        if (scrolled !== isUserScrolledRef.current) {
            isUserScrolledRef.current = scrolled;
            setIsUserScrolled(scrolled);
        }
    }, [sortOrder]);

    const scrollToLatest = useCallback(() => {
        if (sortOrder === 'desc') {
            topRef.current?.scrollIntoView({ behavior: 'smooth' });
        } else {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
        isUserScrolledRef.current = false;
        setIsUserScrolled(false);
    }, [sortOrder]);

    // ── Bookmark toggle ───────────────────────────────────────────────────────
    const toggleBookmark = useCallback((entryId) => {
        setBookmarks(prev => {
            const next = new Set(prev);
            next.has(entryId) ? next.delete(entryId) : next.add(entryId);
            return next;
        });
    }, []);

    // ── AI Suggestion ─────────────────────────────────────────────────────────
    const handleAiSuggest = useCallback(async (entry, regen = false) => {
        if (!aiSuggestionService) return;

        // Lock viewport at current position — prevent auto-scroll to latest
        isUserScrolledRef.current = true;
        setIsUserScrolled(true);

        // Auto-bookmark the entry when requesting a suggestion
        setBookmarks(prev => new Set([...prev, entry.id]));

        setSuggestions(prev => ({
            ...prev,
            [entry.id]: { status: 'loading', result: regen ? (prev[entry.id]?.result ?? null) : null, error: null },
        }));

        const entryIdx = entries.findIndex(e => e.id === entry.id);
        const contextEntries = entries
            .slice(Math.max(0, entryIdx - aiSuggestionContextLines), entryIdx)
            .filter(e => e.translation);

        try {
            const result = await generateAiSuggestion({
                entry, contextEntries, userProfile,
                aiServiceKey: aiSuggestionService,
                modes: aiSuggestionModes,
                responseLang: aiSuggestionResponseLang,
                sourceLang, targetLang,
            });

            setSuggestions(prev => ({ ...prev, [entry.id]: { status: 'done', result, error: null } }));

            if (transcriptFileRef?.current) {
                const lines = [
                    `\n\n> ✨ **AI Suggestion** for: "${entry.translation}"`,
                    result.research ? `> 📖 Research: ${result.research}` : null,
                    result.suggestedAnswerSource ? `> 💬 [Source] ${result.suggestedAnswerSource}` : null,
                    result.suggestedAnswerTarget ? `> 💬 [Target] ${result.suggestedAnswerTarget}` : null,
                    result.key_point ? `> 💡 Key point: ${result.key_point}` : null,
                    result.suggested_next_step ? `> → Next step: ${result.suggested_next_step}` : null,
                    ...(result.bullet_points ?? []).map(pt => `> · ${pt}`),
                    ...(result.questions ?? []).map((q, i) => `> ${i + 1}. ${q}`),
                ].filter(Boolean).join('\n');
                if (lines.trim()) writeTextFile(transcriptFileRef.current, lines, { append: true }).catch(() => {});
            }
        } catch (err) {
            const msg = err.message === 'no_service'
                ? t('monitor.ai_suggestion_no_service')
                : t('monitor.ai_suggestion_error');
            setSuggestions(prev => ({ ...prev, [entry.id]: { status: 'error', result: null, error: msg } }));
        }
    }, [entries, aiSuggestionService, aiSuggestionContextLines, aiSuggestionResponseLang,
        aiSuggestionModes, userProfile, sourceLang, targetLang, transcriptFileRef, t]);

    const dismissSuggestion = useCallback((entryId) => {
        setSuggestions(prev => { const n = { ...prev }; delete n[entryId]; return n; });
    }, []);

    // ── Sub mode ──────────────────────────────────────────────────────────────
    if (isSubMode) {
        const visibleEntries = entries.slice(-2);
        return (
            <div className='flex-1 flex flex-col justify-end min-h-0 overflow-hidden pb-1.5'>
                <AnimatePresence initial={false} mode='popLayout'>
                    {visibleEntries.map((entry, i) => {
                        const isLatest = i === visibleEntries.length - 1;
                        const isThisPlaying = entry.translation && entry.translation === playingText;
                        return (
                            <motion.div
                                key={entry.id} layout
                                initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                                animate={{ opacity: isLatest ? 1 : 0.45, y: 0, filter: 'blur(0px)', scale: isLatest ? 1 : 0.96 }}
                                exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } }}
                                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                                className='flex flex-col items-center gap-0.5 px-4'
                            >
                                {showOriginal && entry.original && (
                                    <p className='text-white/40 text-center leading-snug w-full'
                                        style={{ fontSize: Math.max(8, fontSize - 4) }}>
                                        {entry.original}
                                    </p>
                                )}
                                {entry.translation && (
                                    <div className='flex items-center justify-center gap-2 w-full'>
                                        <p className='text-white font-semibold text-center leading-tight'
                                            style={{ fontSize, textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.9)' }}>
                                            {entry.translation}
                                        </p>
                                        {isThisPlaying && (
                                            <button className='pointer-events-auto flex-shrink-0' onClick={() => onReplayEntry?.(entry.translation)}>
                                                <MdVolumeUp className='text-secondary animate-pulse' style={{ fontSize: Math.max(14, fontSize * 0.4) }} />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
                <div ref={bottomRef} />
            </div>
        );
    }

    // ── Normal mode ───────────────────────────────────────────────────────────
    const isEmpty = entries.length === 0 && !provisional;
    const hasSidebar = bookmarks.size > 0;

    return (
        <div className='flex-1 relative min-h-0'>
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className='h-full overflow-y-auto py-2 space-y-2'
                style={{ paddingLeft: '12px', paddingRight: hasSidebar ? '24px' : '12px' }}
            >
                {isEmpty ? (
                    status === 'connected' ? (
                        <>
                            <style>{`@keyframes wave-bar{0%,100%{height:5px;opacity:0.35}50%{height:20px;opacity:0.85}}`}</style>
                            <div className='flex flex-col items-center justify-center h-full gap-3 select-none'>
                                <div className='flex items-end gap-1' style={{ height: '24px' }}>
                                    {[0, 1, 2, 3, 4].map(i => (
                                        <div key={i} className='w-1.5 rounded-full bg-primary'
                                            style={{ animation: 'wave-bar 1.2s ease-in-out infinite', animationDelay: `${i * 0.15}s` }} />
                                    ))}
                                </div>
                                <p className='text-xs text-default-400'>{t('monitor.listening')}</p>
                            </div>
                        </>
                    ) : (
                        <div className='flex flex-col items-center justify-center h-full gap-5 select-none px-4 text-center w-full'>
                            {/* Clickable play button */}
                            <button
                                onClick={onToggleRun}
                                className='group flex flex-col items-center gap-1.5 focus:outline-none'
                                title={t('monitor.start')}
                            >
                                <MdPlayCircle className='text-[52px] text-default-300 group-hover:text-primary transition-colors duration-150' />
                                <p className='text-sm font-medium text-default-400 group-hover:text-primary transition-colors duration-150'>
                                    {t('monitor.placeholder')}
                                </p>
                            </button>

                            {/* STT quick-switch — configured providers only */}
                            {transcriptionServiceList.length > 0 && (
                                <ServiceChipGroup
                                    label='Transcription'
                                    icon={<MdMicNone className='text-[13px]' />}
                                    items={transcriptionServiceList}
                                    activeKey={activeTranscriptionService}
                                    onSelect={onSetTranscriptionService}
                                    getLabel={k => t(`services.transcription.${getServiceName(k)}.title`, { defaultValue: getServiceName(k) })}
                                    activeColor='primary'
                                />
                            )}

                            {/* TTS quick-switch — configured providers only */}
                            {ttsServiceList.length > 0 && (
                                <ServiceChipGroup
                                    label='TTS'
                                    icon={isTTSEnabled
                                        ? <MdVolumeUp className='text-[13px] text-secondary' />
                                        : <MdVolumeOff className='text-[13px]' />}
                                    items={ttsServiceList}
                                    activeKey={activeTtsService}
                                    onSelect={onSetTtsService}
                                    getLabel={k => t(`services.tts.${getServiceName(k)}.title`, { defaultValue: TTS_DISPLAY_NAMES[getServiceName(k)] ?? getServiceName(k) })}
                                    activeColor='secondary'
                                />
                            )}

                            {/* Context hint */}
                            <div className='flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-content2/60 w-full'>
                                <MdTune className='text-[14px] text-default-400 flex-shrink-0' />
                                <p className='text-[11px] text-default-400 leading-relaxed text-center'>
                                    {t('monitor.placeholder_context_hint')}
                                </p>
                            </div>
                        </div>
                    )
                ) : (
                    <>
                        <div ref={topRef} />

                        {/* Provisional — top position when newest-first */}
                        {sortOrder === 'desc' && provisional && (
                            <div className='flex items-start gap-1.5 opacity-60'>
                                <div className='w-1.5 h-1.5 rounded-full bg-primary animate-pulse mt-1.5 flex-shrink-0' />
                                <p className='text-default-500 italic leading-relaxed' style={{ fontSize }}>
                                    {provisional}
                                </p>
                            </div>
                        )}

                        <AnimatePresence initial={false}>
                        {(sortOrder === 'desc' ? [...entries].reverse() : entries).map((entry) => {
                            const speakerLabel = formatSpeaker(entry.speaker);
                            const speakerColor = getSpeakerColor(entry.speaker);
                            const isThisPlaying = entry.translation && entry.translation === playingText;
                            const suggestion = suggestions[entry.id];
                            const hasSuggestion = suggestion && suggestion.status !== 'idle';
                            const isBookmarked = bookmarks.has(entry.id);

                            return (
                                <motion.div
                                    key={entry.id}
                                    initial={{ opacity: 0, y: sortOrder === 'desc' ? -6 : 6, filter: 'blur(3px)' }}
                                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    exit={{ opacity: 0, transition: { duration: 0.15 } }}
                                    transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                                    ref={el => { if (el) entryRefs.current[entry.id] = el; else delete entryRefs.current[entry.id]; }}
                                    className={`flex flex-col gap-0.5 rounded-lg transition-colors ${isBookmarked ? 'bg-secondary/5' : ''}`}
                                    style={isBookmarked ? { padding: '2px 4px' } : undefined}
                                >
                                    {/* Original */}
                                    {showOriginal && (
                                        <div className='flex items-start gap-1.5'>
                                            {speakerLabel && (
                                                <span className='font-semibold rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap'
                                                    style={{ fontSize: Math.max(8, fontSize - 3), color: speakerColor, backgroundColor: speakerColor ? `${speakerColor}22` : undefined }}>
                                                    {speakerLabel}
                                                </span>
                                            )}
                                            <p className='text-default-500 leading-relaxed' style={{ fontSize: fontSize - 1 }}>
                                                {entry.original}
                                            </p>
                                        </div>
                                    )}

                                    {/* Translation row */}
                                    {entry.translation && (
                                        <div
                                            className='flex items-center gap-1.5 pl-2 group/entry'
                                            style={{ borderLeft: `2px solid ${speakerColor ?? 'rgba(var(--nextui-primary)/0.4)'}` }}
                                        >
                                            {!showOriginal && speakerLabel && (
                                                <span className='font-semibold rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap'
                                                    style={{ fontSize: Math.max(8, fontSize - 3), color: speakerColor, backgroundColor: speakerColor ? `${speakerColor}22` : undefined }}>
                                                    {speakerLabel}
                                                </span>
                                            )}

                                            {/* Text + inline AI button — flows inline so button always follows last word */}
                                            <div className='flex-1'>
                                                <span className='text-foreground font-medium leading-relaxed' style={{ fontSize }}>
                                                    {entry.translation}
                                                </span>
                                                {aiSuggestionService && (
                                                    <button
                                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all ml-1.5
                                                            ${hasSuggestion
                                                                ? 'border-secondary/40 text-secondary bg-secondary/8'
                                                                : 'border-transparent opacity-0 group-hover/entry:opacity-60 hover:!opacity-100 text-default-400 hover:text-secondary hover:border-secondary/30 hover:bg-secondary/5'
                                                            } ${suggestion?.status === 'loading' ? 'cursor-wait' : 'cursor-pointer'}`}
                                                        style={{ fontSize: 10, verticalAlign: 'middle' }}
                                                        onClick={() => hasSuggestion ? dismissSuggestion(entry.id) : handleAiSuggest(entry)}
                                                        disabled={suggestion?.status === 'loading'}
                                                    >
                                                        <MdAutoAwesome
                                                            className={suggestion?.status === 'loading' ? 'animate-spin' : ''}
                                                            style={{ fontSize: 11 }}
                                                        />
                                                        <span className='font-semibold'>
                                                            {suggestion?.status === 'loading'
                                                                ? t('monitor.ai_suggestion_loading')
                                                                : hasSuggestion
                                                                    ? t('monitor.ai_suggestion_dismiss')
                                                                    : 'AI Suggest'}
                                                        </span>
                                                    </button>
                                                )}
                                            </div>

                                            {/* Far-right: bookmark + TTS */}
                                            <div className='flex items-center gap-0.5 flex-shrink-0'>
                                                <Tooltip label={isBookmarked ? t('monitor.bookmark_remove') : t('monitor.bookmark_add')}>
                                                    <button
                                                        className={`rounded p-0.5 transition-all
                                                            ${isBookmarked
                                                                ? 'opacity-100 text-secondary'
                                                                : 'opacity-0 group-hover/entry:opacity-50 hover:!opacity-100 text-default-400 hover:text-secondary'
                                                            }`}
                                                        onClick={() => toggleBookmark(entry.id)}
                                                    >
                                                        {isBookmarked
                                                            ? <MdBookmark style={{ fontSize: Math.max(12, fontSize) }} />
                                                            : <MdBookmarkBorder style={{ fontSize: Math.max(12, fontSize) }} />
                                                        }
                                                    </button>
                                                </Tooltip>
                                                <Tooltip label={t('monitor.tts_replay')}>
                                                    <button
                                                        className={`rounded p-0.5 transition-opacity
                                                            ${isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover/entry:opacity-50 hover:!opacity-100'}`}
                                                        onClick={() => onReplayEntry?.(entry.translation)}
                                                    >
                                                        <MdVolumeUp
                                                            className={isThisPlaying ? 'text-secondary animate-pulse' : 'text-default-400'}
                                                            style={{ fontSize: Math.max(12, fontSize) }}
                                                        />
                                                    </button>
                                                </Tooltip>
                                            </div>
                                        </div>
                                    )}

                                    {/* AI Suggestion card */}
                                    <AnimatePresence>
                                        {hasSuggestion && (
                                            <AiSuggestionCard
                                                state={suggestion}
                                                onDismiss={() => dismissSuggestion(entry.id)}
                                                onRegenerate={() => handleAiSuggest(entry, true)}
                                                onFontSizeChange={onSetAiSuggestionFontSize}
                                                fontSize={aiSuggestionFontSize}
                                                t={t}
                                            />
                                        )}
                                    </AnimatePresence>

                                </motion.div>
                            );
                        })}
                        </AnimatePresence>

                        {/* Provisional — bottom position when newest-last (default) */}
                        {sortOrder !== 'desc' && provisional && (
                            <div className='flex items-start gap-1.5 opacity-60'>
                                <div className='w-1.5 h-1.5 rounded-full bg-primary animate-pulse mt-1.5 flex-shrink-0' />
                                <p className='text-default-500 italic leading-relaxed' style={{ fontSize }}>
                                    {provisional}
                                </p>
                            </div>
                        )}
                    </>
                )}
                <div ref={bottomRef} />
            </div>

            {/* Bookmark sidebar */}
            <BookmarkSidebar
                entries={entries}
                bookmarks={bookmarks}
                entryRefs={entryRefs}
                scrollContainerRef={scrollRef}
            />

            {/* Go to Latest */}
            <AnimatePresence>
                {isUserScrolled && entries.length > 0 && (
                    <motion.button
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 8 }}
                        transition={{ duration: 0.18 }}
                        onClick={scrollToLatest}
                        className='absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium shadow-lg border border-primary/30 hover:scale-105 active:scale-95 transition-transform'
                        style={{ background: 'hsl(var(--nextui-background))', color: 'hsl(var(--nextui-primary))' }}
                    >
                        <MdKeyboardArrowDown className='text-[15px]' />
                        {t('monitor.scroll_to_latest')}
                    </motion.button>
                )}
            </AnimatePresence>
        </div>
    );
}
