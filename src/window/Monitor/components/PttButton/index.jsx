import React, { useRef } from 'react';
import { MdMic, MdMicOff } from 'react-icons/md';
import { useTranslation } from 'react-i18next';

/**
 * Dedicated Push-to-Talk button for Monitor narration.
 * Completely independent of VoiceFab / Voice Anywhere.
 *
 * States:  idle | listening | processing
 * Interaction: hold = record, release = stop
 */
export default function PttButton({ fabState, onPttStart, onPttEnd, size = 52, disabled = false }) {
    const { t } = useTranslation();
    const pointerCapturedRef = useRef(false);

    const isListening  = fabState === 'listening';
    const isProcessing = fabState === 'processing' || fabState === 'injecting';

    function handlePointerDown(e) {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerCapturedRef.current = true;
        onPttStart?.();
    }

    function handlePointerUp() {
        if (!pointerCapturedRef.current) return;
        pointerCapturedRef.current = false;
        onPttEnd?.();
    }

    const label = isListening
        ? t('monitor.narration_ptt_speaking', { defaultValue: 'Speaking…' })
        : isProcessing
        ? t('monitor.narration_ptt_processing', { defaultValue: 'Processing…' })
        : t('monitor.narration_ptt_hold', { defaultValue: 'Push to Talk' });

    const iconSize = Math.round(size * 0.38);
    const fontSize = Math.max(9, Math.round(size * 0.17));

    return (
        <>
            <style>{`
                @keyframes ptt-btn-ring {
                    0%   { transform: scale(1);   opacity: 0.6; }
                    100% { transform: scale(1.55); opacity: 0;   }
                }
                @keyframes ptt-btn-spin {
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                {/* Listening ring */}
                {isListening && (
                    <div style={{
                        position: 'absolute',
                        inset: -4,
                        borderRadius: 14,
                        border: '2px solid rgba(59,130,246,0.7)',
                        animation: 'ptt-btn-ring 1s ease-out infinite',
                        pointerEvents: 'none',
                    }} />
                )}

                <div
                    onPointerDown={handlePointerDown}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 2,
                        width: size * 1.6,
                        height: size,
                        borderRadius: 12,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        userSelect: 'none',
                        transition: 'background 150ms, box-shadow 150ms, transform 100ms',
                        transform: isListening ? 'scale(0.96)' : 'scale(1)',
                        background: isListening
                            ? 'rgba(37, 99, 235, 0.92)'
                            : isProcessing
                            ? 'rgba(30, 30, 40, 0.85)'
                            : 'rgba(30, 58, 95, 0.90)',
                        boxShadow: isListening
                            ? '0 0 0 2px rgba(59,130,246,0.5), 0 4px 16px rgba(37,99,235,0.4)'
                            : '0 2px 10px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.08)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        opacity: disabled ? 0.45 : 1,
                    }}
                >
                    {isProcessing ? (
                        <div style={{
                            width: iconSize,
                            height: iconSize,
                            borderRadius: '50%',
                            border: '2px solid rgba(255,255,255,0.18)',
                            borderTopColor: 'rgba(255,255,255,0.75)',
                            animation: 'ptt-btn-spin 0.7s linear infinite',
                        }} />
                    ) : (
                        <MdMic style={{
                            fontSize: iconSize,
                            color: isListening ? '#fff' : 'rgba(255,255,255,0.75)',
                            filter: isListening ? 'drop-shadow(0 0 4px rgba(255,255,255,0.5))' : undefined,
                        }} />
                    )}
                    <span style={{
                        fontSize,
                        fontWeight: 600,
                        letterSpacing: '0.04em',
                        color: isListening ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)',
                        textTransform: 'uppercase',
                        lineHeight: 1,
                        whiteSpace: 'nowrap',
                    }}>
                        {label}
                    </span>
                </div>
            </div>
        </>
    );
}
