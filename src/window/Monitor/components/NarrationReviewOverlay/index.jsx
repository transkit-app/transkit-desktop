import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * NarrationReviewOverlay
 *
 * Shown above the PTT button when "Review before send" is enabled.
 * Lets the user read/edit the polished transcript before it is sent to TTS.
 * Auto-discards after `timeoutSeconds` if no action is taken.
 */
export default function NarrationReviewOverlay({ pending, onAccept, onDiscard, timeoutSeconds = 30 }) {
    const { t } = useTranslation();
    const [editedText, setEditedText] = useState('');
    const [countdown, setCountdown] = useState(timeoutSeconds);
    const intervalRef = useRef(null);

    // Reset text + countdown whenever a new pending item arrives
    useEffect(() => {
        if (!pending) return;
        setEditedText(pending.text ?? '');
        setCountdown(timeoutSeconds);
    }, [pending, timeoutSeconds]);

    // Countdown tick → auto-discard at 0
    useEffect(() => {
        if (!pending) return;
        intervalRef.current = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    onDiscard();
                    return 0;
                }
                return prev - 1;
            });
        }, 1000);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [pending, onDiscard]);

    if (!pending) return null;

    const urgency = countdown <= 5 ? 'text-danger' : countdown <= 10 ? 'text-warning-600 dark:text-warning-400' : 'text-default-400';

    return (
        <div
            className='absolute right-3 z-30 w-72 rounded-xl border border-warning/30 shadow-2xl overflow-hidden'
            style={{ bottom: 56, background: 'hsl(var(--nextui-content2))' }}
        >
            {/* Header */}
            <div className='flex items-center justify-between px-3 py-2 border-b border-content3/30'>
                <span className='text-[11px] font-semibold text-warning-700 dark:text-warning-400'>
                    {t('monitor.narration_review_title', { defaultValue: '✎ Review before sending' })}
                </span>
                <span className={`text-[10px] tabular-nums font-mono ${urgency}`}>
                    {countdown}s
                </span>
            </div>

            {/* Editable transcript */}
            <div className='px-3 pt-2 pb-1'>
                <textarea
                    value={editedText}
                    onChange={e => setEditedText(e.target.value)}
                    className='w-full text-[12px] leading-relaxed bg-transparent resize-none outline-none text-default-800 dark:text-default-200 min-h-[56px] max-h-[120px] overflow-y-auto'
                    rows={3}
                    placeholder={t('monitor.narration_review_placeholder', { defaultValue: 'Transcript…' })}
                    autoFocus
                />
            </div>

            {/* Progress bar */}
            <div className='px-3 pb-0.5'>
                <div className='h-0.5 rounded-full bg-content3/40 overflow-hidden'>
                    <div
                        className='h-full rounded-full bg-warning/60 transition-all duration-1000 ease-linear'
                        style={{ width: `${(countdown / timeoutSeconds) * 100}%` }}
                    />
                </div>
            </div>

            {/* Action buttons */}
            <div className='flex gap-2 px-3 py-2.5'>
                <button
                    onClick={() => onAccept(editedText.trim() || pending.text)}
                    className='flex-1 py-1.5 rounded-lg text-[11px] font-semibold
                               bg-success/15 text-success border border-success/30
                               hover:bg-success/25 active:scale-95 transition-all'
                >
                    {t('monitor.narration_review_accept', { defaultValue: '✓ Accept & Send' })}
                </button>
                <button
                    onClick={onDiscard}
                    className='px-3 py-1.5 rounded-lg text-[11px] font-medium
                               bg-content3/30 text-default-500 border border-content3/40
                               hover:bg-content3/50 active:scale-95 transition-all'
                >
                    {t('monitor.narration_review_discard', { defaultValue: '✗' })}
                </button>
            </div>
        </div>
    );
}
