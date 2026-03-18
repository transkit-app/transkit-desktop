import React, { useEffect, useRef, useState, useCallback, useLayoutEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { MdMicNone, MdVolumeUp, MdAutoAwesome, MdClose, MdKeyboardArrowDown, MdBookmark, MdBookmarkBorder } from 'react-icons/md';
import { motion, AnimatePresence } from 'framer-motion';
import { writeTextFile } from '@tauri-apps/api/fs';
import { generateAiSuggestion } from '../../../../utils/generateAiSuggestion';

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

function AiSuggestionCard({ state, onDismiss, fontSize, t }) {
    if (state.status === 'idle') return null;
    const fs = fontSize ?? 16;

    return (
        <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className='mt-2 ml-2 rounded-xl border border-secondary/30 overflow-hidden'
            style={{ background: 'rgba(120, 80, 220, 0.06)' }}
        >
            {/* Header */}
            <div className='flex items-center justify-between px-3 py-2 border-b border-secondary/20'
                style={{ background: 'rgba(120, 80, 220, 0.10)' }}>
                <div className='flex items-center gap-1.5'>
                    <MdAutoAwesome className='text-secondary text-[14px]' />
                    <span className='text-[11px] font-bold text-secondary uppercase tracking-widest'>AI Suggestion</span>
                </div>
                <Tooltip label={t('monitor.ai_suggestion_dismiss')}>
                    <button onClick={onDismiss} className='text-default-400 hover:text-default-600 transition-colors p-0.5 rounded'>
                        <MdClose className='text-[14px]' />
                    </button>
                </Tooltip>
            </div>

            {/* Loading */}
            {state.status === 'loading' && (
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

            {/* Result */}
            {state.status === 'done' && state.result && (
                <div className='flex flex-col'>
                    {state.result.research && (
                        <div className='px-4 py-3 border-b border-secondary/10'>
                            <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-2'>
                                📖 {t('monitor.ai_suggestion_research')}
                            </p>
                            <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap' style={{ fontSize: fs }}>
                                {state.result.research}
                            </p>
                        </div>
                    )}
                    {(state.result.suggestedAnswerSource || state.result.suggestedAnswerTarget) && (
                        <div className='px-4 py-3'>
                            <p className='text-[10px] font-bold text-secondary/70 uppercase tracking-widest mb-3'>
                                💬 {t('monitor.ai_suggestion_answer')}
                            </p>
                            <div className='flex flex-col gap-4'>
                                {state.result.suggestedAnswerSource && (
                                    <div className='flex flex-col gap-1.5'>
                                        <span className='text-[9px] font-semibold text-default-400 uppercase tracking-wider'>
                                            {t('monitor.ai_suggestion_source_lang')}
                                        </span>
                                        <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-secondary/40'
                                            style={{ fontSize: fs }}>
                                            {state.result.suggestedAnswerSource}
                                        </p>
                                    </div>
                                )}
                                {state.result.suggestedAnswerSource && state.result.suggestedAnswerTarget && (
                                    <div className='border-t border-secondary/10' />
                                )}
                                {state.result.suggestedAnswerTarget && (
                                    <div className='flex flex-col gap-1.5'>
                                        <span className='text-[9px] font-semibold text-default-400 uppercase tracking-wider'>
                                            {t('monitor.ai_suggestion_target_lang')}
                                        </span>
                                        <p className='text-default-700 dark:text-default-300 leading-relaxed whitespace-pre-wrap pl-3 border-l-2 border-primary/40'
                                            style={{ fontSize: fs }}>
                                            {state.result.suggestedAnswerTarget}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </motion.div>
    );
}

// ── Bookmark sidebar ──────────────────────────────────────────────────────────

const BOOKMARK_DOT_SIZE = 22;   // px — 2× original ~11px
const BOOKMARK_MIN_GAP = 6;      // min gap between dots
const BOOKMARK_MARGIN_TOP = 48;  // px from top of sidebar to clear toolbar

function BookmarkSidebar({ entries, bookmarks, suggestions, entryRefs, scrollContainerRef, t }) {
    const sidebarRef = useRef(null);
    const [dotPositions, setDotPositions] = useState([]);

    const bookmarkedIds = entries
        .map((e, i) => ({ entry: e, index: i }))
        .filter(({ entry }) => bookmarks.has(entry.id));

    // Recompute dot positions after DOM settles (entries, bookmarks, or suggestions change layout)
    useEffect(() => {
        if (bookmarkedIds.length === 0) { setDotPositions([]); return; }

        const container = scrollContainerRef.current;
        const sidebar = sidebarRef.current;
        if (!container || !sidebar) return;

        const scrollH = container.scrollHeight;
        const sidebarH = sidebar.clientHeight;
        if (scrollH === 0 || sidebarH === 0) return;

        const usableH = sidebarH - BOOKMARK_MARGIN_TOP;
        const MIN_SPACING = BOOKMARK_DOT_SIZE + BOOKMARK_MIN_GAP;

        // Map each bookmarked entry to a pixel position in the sidebar
        let positions = bookmarkedIds.map(({ entry }) => {
            const el = entryRefs.current[entry.id];
            const entryTop = el ? el.offsetTop : 0;
            const ratio = entryTop / scrollH;
            return {
                id: entry.id,
                entry,
                // Map ratio to usable sidebar range, offset by MARGIN_TOP
                pos: Math.round(BOOKMARK_MARGIN_TOP + ratio * usableH),
            };
        });

        // Sort top-to-bottom and enforce minimum spacing (prevent overlaps)
        positions.sort((a, b) => a.pos - b.pos);
        for (let i = 1; i < positions.length; i++) {
            const minPos = positions[i - 1].pos + MIN_SPACING;
            if (positions[i].pos < minPos) positions[i].pos = minPos;
        }
        // Clamp to sidebar bounds
        const maxPos = sidebarH - BOOKMARK_DOT_SIZE;
        for (let i = positions.length - 1; i >= 0; i--) {
            if (positions[i].pos > maxPos) positions[i].pos = maxPos;
        }

        setDotPositions(positions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookmarks, entries.length, suggestions]);

    if (bookmarkedIds.length === 0) return null;

    const scrollToEntry = (entryId) => {
        const el = entryRefs.current[entryId];
        const container = scrollContainerRef.current;
        if (!el || !container) return;
        const top = el.offsetTop - 40;
        container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    };

    return (
        <div
            ref={sidebarRef}
            className='absolute right-0 top-0 bottom-0 pointer-events-none z-20'
            style={{ width: BOOKMARK_DOT_SIZE + 8 }}
        >
            {dotPositions.map(({ id, entry, pos }) => {
                const snippet = (entry.translation || entry.original || '').slice(0, 48);
                return (
                    <Tooltip key={id} label={snippet || 'Bookmark'} placement='bottom'>
                        <button
                            className='absolute pointer-events-auto flex items-center justify-center rounded-md transition-all hover:scale-110 active:scale-95'
                            style={{
                                top: pos,
                                right: 4,
                                width: BOOKMARK_DOT_SIZE,
                                height: BOOKMARK_DOT_SIZE,
                                color: '#a855f7',
                                background: 'rgba(168,85,247,0.15)',
                                border: '1px solid rgba(168,85,247,0.3)',
                            }}
                            onClick={() => scrollToEntry(id)}
                        >
                            <MdBookmark style={{ fontSize: BOOKMARK_DOT_SIZE - 4 }} />
                        </button>
                    </Tooltip>
                );
            })}
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
    aiSuggestionService = '',
    aiSuggestionContextLines = 10,
    aiSuggestionResponseLang = 'both',
    aiSuggestionFontSize = 16,
    userProfile = {},
    sourceLang = 'auto',
    targetLang = 'vi',
    transcriptFileRef = null,
}) {
    const { t } = useTranslation();
    const scrollRef = useRef(null);
    const bottomRef = useRef(null);
    const prevScrollHeightRef = useRef(0);
    const isUserScrolledRef = useRef(false);
    const entryRefs = useRef({});

    const [isUserScrolled, setIsUserScrolled] = useState(false);
    const [suggestions, setSuggestions] = useState({});
    const [bookmarks, setBookmarks] = useState(new Set());

    // ── Scroll anchor: preserve viewport position on ANY content height change ─
    // Runs synchronously after DOM update (before paint) to prevent any visual shift.
    // Handles both new entries added at bottom AND suggestion cards expanding inline.
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const newH = el.scrollHeight;
        const prevH = prevScrollHeightRef.current;

        // Always update the ref so next diff is correct
        prevScrollHeightRef.current = newH;

        if (!isUserScrolledRef.current || prevH === 0 || newH <= prevH) return;

        // Content grew — push scrollTop down by the same amount so viewport stays fixed
        el.scrollTop += newH - prevH;
    }, [entries, suggestions]); // Both new entries AND card expansions trigger this

    // ── Auto-scroll to bottom when user is NOT manually scrolled ─────────────
    useEffect(() => {
        if (!isUserScrolledRef.current) {
            bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [entries, provisional]);

    const handleScroll = useCallback(() => {
        const el = scrollRef.current;
        if (!el) return;
        const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        const scrolled = distFromBottom > 80;
        if (scrolled !== isUserScrolledRef.current) {
            isUserScrolledRef.current = scrolled;
            setIsUserScrolled(scrolled);
        }
    }, []);

    const scrollToLatest = useCallback(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        isUserScrolledRef.current = false;
        setIsUserScrolled(false);
    }, []);

    // ── Bookmark toggle ───────────────────────────────────────────────────────
    const toggleBookmark = useCallback((entryId) => {
        setBookmarks(prev => {
            const next = new Set(prev);
            next.has(entryId) ? next.delete(entryId) : next.add(entryId);
            return next;
        });
    }, []);

    // ── AI Suggestion ─────────────────────────────────────────────────────────
    const handleAiSuggest = useCallback(async (entry) => {
        if (!aiSuggestionService) return;

        // Auto-bookmark the entry when requesting a suggestion
        setBookmarks(prev => new Set([...prev, entry.id]));

        setSuggestions(prev => ({ ...prev, [entry.id]: { status: 'loading', result: null, error: null } }));

        const entryIdx = entries.findIndex(e => e.id === entry.id);
        const contextEntries = entries
            .slice(Math.max(0, entryIdx - aiSuggestionContextLines), entryIdx)
            .filter(e => e.translation);

        try {
            const result = await generateAiSuggestion({
                entry, contextEntries, userProfile,
                aiServiceKey: aiSuggestionService,
                responseLang: aiSuggestionResponseLang,
                sourceLang, targetLang,
            });

            setSuggestions(prev => ({ ...prev, [entry.id]: { status: 'done', result, error: null } }));

            if (transcriptFileRef?.current && (result.research || result.suggestedAnswerSource || result.suggestedAnswerTarget)) {
                const lines = [
                    `\n\n> ✨ **AI Suggestion** for: "${entry.translation}"`,
                    result.research ? `> 📖 Research: ${result.research}` : null,
                    result.suggestedAnswerSource ? `> 💬 [Source] ${result.suggestedAnswerSource}` : null,
                    result.suggestedAnswerTarget ? `> 💬 [Target] ${result.suggestedAnswerTarget}` : null,
                ].filter(Boolean).join('\n');
                writeTextFile(transcriptFileRef.current, lines, { append: true }).catch(() => {});
            }
        } catch (err) {
            const msg = err.message === 'no_service'
                ? t('monitor.ai_suggestion_no_service')
                : t('monitor.ai_suggestion_error');
            setSuggestions(prev => ({ ...prev, [entry.id]: { status: 'error', result: null, error: msg } }));
        }
    }, [entries, aiSuggestionService, aiSuggestionContextLines, aiSuggestionResponseLang,
        userProfile, sourceLang, targetLang, transcriptFileRef, t]);

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
                style={{ paddingLeft: '12px', paddingRight: hasSidebar ? '36px' : '12px' }}
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
                        <div className='flex flex-col items-center justify-center h-full text-default-300 gap-2 select-none'>
                            <MdMicNone className='text-[40px]' />
                            <p className='text-xs'>{t('monitor.placeholder')}</p>
                        </div>
                    )
                ) : (
                    <>
                        {entries.map((entry) => {
                            const speakerLabel = formatSpeaker(entry.speaker);
                            const speakerColor = getSpeakerColor(entry.speaker);
                            const isThisPlaying = entry.translation && entry.translation === playingText;
                            const suggestion = suggestions[entry.id];
                            const hasSuggestion = suggestion && suggestion.status !== 'idle';
                            const isBookmarked = bookmarks.has(entry.id);

                            return (
                                <div
                                    key={entry.id}
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

                                            {/* Text + inline ✨ AI button (wraps after text) */}
                                            <div className='flex-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0'>
                                                <p className='text-foreground font-medium leading-relaxed' style={{ fontSize }}>
                                                    {entry.translation}
                                                </p>
                                                {aiSuggestionService && (
                                                    <Tooltip label={hasSuggestion ? t('monitor.ai_suggestion_dismiss') : t('monitor.ai_suggestion_hint')}>
                                                        <button
                                                            className={`rounded p-0.5 transition-all self-center flex-shrink-0
                                                                ${hasSuggestion
                                                                    ? 'opacity-100 text-secondary'
                                                                    : 'opacity-0 group-hover/entry:opacity-50 hover:!opacity-100 text-default-400 hover:text-secondary'
                                                                } ${suggestion?.status === 'loading' ? 'cursor-wait' : ''}`}
                                                            onClick={() => hasSuggestion ? dismissSuggestion(entry.id) : handleAiSuggest(entry)}
                                                            disabled={suggestion?.status === 'loading'}
                                                        >
                                                            <MdAutoAwesome
                                                                className={suggestion?.status === 'loading' ? 'animate-spin' : ''}
                                                                style={{ fontSize: Math.max(11, fontSize - 2) }}
                                                            />
                                                        </button>
                                                    </Tooltip>
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
                                                fontSize={aiSuggestionFontSize}
                                                t={t}
                                            />
                                        )}
                                    </AnimatePresence>
                                </div>
                            );
                        })}

                        {/* Provisional */}
                        {provisional && (
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

            {/* Bookmark sidebar — proportional to scroll content height */}
            <BookmarkSidebar
                entries={entries}
                bookmarks={bookmarks}
                suggestions={suggestions}
                entryRefs={entryRefs}
                scrollContainerRef={scrollRef}
                t={t}
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
