import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MdMicNone, MdVolumeUp } from 'react-icons/md';
import { motion, AnimatePresence } from 'framer-motion';

// Consistent color palette per speaker index
const SPEAKER_COLORS = [
    '#60a5fa', // blue-400
    '#f472b6', // pink-400
    '#34d399', // emerald-400
    '#fb923c', // orange-400
    '#a78bfa', // violet-400
    '#22d3ee', // cyan-400
    '#facc15', // yellow-400
    '#f87171', // red-400
];

// Convert Soniox speaker codes to "Speaker N"
function formatSpeaker(speaker) {
    if (!speaker) return null;
    const m = speaker.match(/^S?(\d+)$/);
    return m ? `Speaker ${m[1]}` : speaker;
}

// Returns a deterministic color for a given speaker code
function getSpeakerColor(speaker) {
    if (!speaker) return null;
    const m = speaker.match(/^S?(\d+)$/);
    const idx = m ? (parseInt(m[1], 10) - 1) : Math.abs(speaker.charCodeAt(0));
    return SPEAKER_COLORS[idx % SPEAKER_COLORS.length];
}

export default function MonitorLog({ entries, provisional, fontSize = 14, isSubMode = false, showOriginal = true, playingText = null, onReplayEntry, status = 'disconnected' }) {
    const { t } = useTranslation();
    const bottomRef = useRef(null);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [entries, provisional]);

    // ── Sub mode: transparent overlay, shows recent entries from bottom ──
    if (isSubMode) {
        // Show only the 2 most recent completed translations
        const visibleEntries = entries.slice(-2);

        return (
            <div className='flex-1 flex flex-col justify-end min-h-0 overflow-hidden pb-1.5'>
                <AnimatePresence initial={false} mode='popLayout'>
                    {visibleEntries.map((entry, i) => {
                        const isLatest = i === visibleEntries.length - 1;
                        const isThisPlaying = entry.translation && entry.translation === playingText;
                        return (
                            <motion.div
                                key={entry.id}
                                layout
                                initial={{ opacity: 0, y: 16, filter: 'blur(6px)' }}
                                animate={{
                                    opacity: isLatest ? 1 : 0.45,
                                    y: 0,
                                    filter: 'blur(0px)',
                                    scale: isLatest ? 1 : 0.96,
                                }}
                                exit={{ opacity: 0, y: -8, filter: 'blur(4px)', transition: { duration: 0.2 } }}
                                transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                                className='flex flex-col items-center gap-0.5 px-4'
                            >
                                {/* Original (small, muted, centered) */}
                                {showOriginal && entry.original && (
                                    <p
                                        className='text-white/40 text-center leading-snug w-full'
                                        style={{ fontSize: Math.max(8, fontSize - 4) }}
                                    >
                                        {entry.original}
                                    </p>
                                )}
                                {/* Translation — centered, large */}
                                {entry.translation && (
                                    <div className='flex items-center justify-center gap-2 w-full'>
                                        <p
                                            className='text-white font-semibold text-center leading-tight'
                                            style={{
                                                fontSize,
                                                textShadow: '0 2px 8px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.9)',
                                            }}
                                        >
                                            {entry.translation}
                                        </p>
                                        {isThisPlaying && (
                                            <button
                                                className='pointer-events-auto flex-shrink-0'
                                                onClick={() => onReplayEntry?.(entry.translation)}
                                            >
                                                <MdVolumeUp
                                                    className='text-secondary animate-pulse'
                                                    style={{ fontSize: Math.max(14, fontSize * 0.4) }}
                                                />
                                            </button>
                                        )}
                                    </div>
                                )}
                            </motion.div>
                        );
                    })}
                </AnimatePresence>
                {/* Provisional hidden in submode — only show final translations */}
                <div ref={bottomRef} />
            </div>
        );
    }

    // ── Normal mode ──
    const isEmpty = entries.length === 0 && !provisional;

    return (
        <div className='flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0'>
            {isEmpty ? (
                status === 'connected' ? (
                    <>
                        <style>{`
                            @keyframes wave-bar {
                                0%, 100% { height: 5px; opacity: 0.35; }
                                50% { height: 20px; opacity: 0.85; }
                            }
                        `}</style>
                        <div className='flex flex-col items-center justify-center h-full gap-3 select-none'>
                            <div className='flex items-end gap-1' style={{ height: '24px' }}>
                                {[0, 1, 2, 3, 4].map(i => (
                                    <div
                                        key={i}
                                        className='w-1.5 rounded-full bg-primary'
                                        style={{
                                            animation: 'wave-bar 1.2s ease-in-out infinite',
                                            animationDelay: `${i * 0.15}s`,
                                        }}
                                    />
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
                        return (
                            <div key={entry.id} className='flex flex-col gap-0.5'>
                                {/* Original */}
                                {showOriginal && (
                                    <div className='flex items-start gap-1.5'>
                                        {speakerLabel && (
                                            <span
                                                className='font-semibold rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap'
                                                style={{
                                                    fontSize: Math.max(8, fontSize - 3),
                                                    color: speakerColor,
                                                    backgroundColor: speakerColor ? `${speakerColor}22` : undefined,
                                                }}
                                            >
                                                {speakerLabel}
                                            </span>
                                        )}
                                        <p
                                            className='text-default-500 leading-relaxed'
                                            style={{ fontSize: fontSize - 1 }}
                                        >
                                            {entry.original}
                                        </p>
                                    </div>
                                )}
                                {/* Translation */}
                                {entry.translation && (
                                    <div
                                        className='flex items-center gap-1.5 pl-2 group/entry'
                                        style={{ borderLeft: `2px solid ${speakerColor ?? 'rgba(var(--nextui-primary)/0.4)'}` }}
                                    >
                                        {!showOriginal && speakerLabel && (
                                            <span
                                                className='font-semibold rounded px-1.5 py-0.5 flex-shrink-0 whitespace-nowrap'
                                                style={{
                                                    fontSize: Math.max(8, fontSize - 3),
                                                    color: speakerColor,
                                                    backgroundColor: speakerColor ? `${speakerColor}22` : undefined,
                                                }}
                                            >
                                                {speakerLabel}
                                            </span>
                                        )}
                                        <p
                                            className='text-foreground font-medium leading-relaxed flex-1'
                                            style={{ fontSize }}
                                        >
                                            {entry.translation}
                                        </p>
                                        <button
                                            className={`flex-shrink-0 rounded p-0.5 transition-opacity
                                                ${isThisPlaying ? 'opacity-100' : 'opacity-0 group-hover/entry:opacity-60 hover:!opacity-100'}`}
                                            onClick={() => onReplayEntry?.(entry.translation)}
                                            title='Replay'
                                        >
                                            <MdVolumeUp
                                                className={isThisPlaying ? 'text-secondary animate-pulse' : 'text-default-400'}
                                                style={{ fontSize: Math.max(12, fontSize) }}
                                            />
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {/* Provisional */}
                    {provisional && (
                        <div className='flex items-start gap-1.5 opacity-60'>
                            <div className='w-1.5 h-1.5 rounded-full bg-primary animate-pulse mt-1.5 flex-shrink-0' />
                            <p
                                className='text-default-500 italic leading-relaxed'
                                style={{ fontSize }}
                            >
                                {provisional}
                            </p>
                        </div>
                    )}
                </>
            )}
            <div ref={bottomRef} />
        </div>
    );
}
