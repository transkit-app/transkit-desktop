import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const N_BARS = 20;

const BAR_CONFIGS = Array.from({ length: N_BARS }, (_, i) => {
    const norm = i / (N_BARS - 1);
    const envelope = Math.sin(norm * Math.PI);
    const maxH = Math.round(6 + envelope * 18);
    const minH = Math.max(2, Math.round(maxH * 0.15));
    const dur = (0.5 + Math.sin(i * 1.37) * 0.2).toFixed(2);
    const del = ((i * 0.05) % 0.7).toFixed(3);
    const hue = Math.round(196 + norm * 49);
    const light = Math.round(58 + envelope * 12);
    return { maxH, minH, dur, del, hue, light };
});

/**
 * Compact PTT caption bar fixed at the bottom center of Monitor.
 *
 * Props:
 *   fabState  — 'idle' | 'listening' | 'processing' | 'injecting' | 'error'
 *   interim   — provisional transcript text from pttVA
 *   visible   — whether to show the bar at all
 */
export default function PttCaption({ fabState, interim, visible }) {
    const { t } = useTranslation();
    const isListening  = fabState === 'listening';

    if (!visible) return null;

    return (
        <>
            <style>{`
                @keyframes ptt-wave {
                    0%, 100% { transform: scaleY(0.15); }
                    50%       { transform: scaleY(1);    }
                }
                @keyframes ptt-dot {
                    0%, 100% { opacity: 1;   transform: scale(1);    }
                    50%      { opacity: 0.4; transform: scale(0.72); }
                }
                @keyframes ptt-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes ptt-bar-in {
                    from { opacity: 0; transform: translateX(-50%) translateY(6px); }
                    to   { opacity: 1; transform: translateX(-50%) translateY(0);   }
                }
            `}</style>

            <div
                style={{
                    position: 'absolute',
                    left: '50%',
                    bottom: 10,
                    transform: 'translateX(-50%)',
                    zIndex: 40,
                    width: 'min(320px, calc(100vw - 48px))',
                    pointerEvents: 'none',
                    animation: 'ptt-bar-in 180ms ease forwards',
                }}
            >
                <div
                    style={{
                        background: 'rgba(8, 8, 14, 0.78)',
                        backdropFilter: 'blur(16px)',
                        WebkitBackdropFilter: 'blur(16px)',
                        border: '1px solid rgba(255,255,255,0.07)',
                        borderRadius: 14,
                        boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
                        padding: '7px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                    }}
                >
                    {/* Status dot / spinner */}
                    {isListening ? (
                        <span
                            style={{
                                width: 6, height: 6, borderRadius: '50%',
                                background: '#38bdf8',
                                boxShadow: '0 0 6px #38bdf8',
                                animation: 'ptt-dot 1.1s ease-in-out infinite',
                                flexShrink: 0,
                            }}
                        />
                    ) : (
                        <div style={{
                            width: 11, height: 11, borderRadius: '50%',
                            border: '1.5px solid rgba(255,255,255,0.18)',
                            borderTopColor: 'rgba(255,255,255,0.7)',
                            animation: 'ptt-spin 0.7s linear infinite',
                            flexShrink: 0,
                        }} />
                    )}

                    {/* Wave bars */}
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            height: 26,
                            flexShrink: 0,
                            opacity: isListening ? 1 : 0.2,
                            transition: 'opacity 400ms ease',
                        }}
                    >
                        {BAR_CONFIGS.map(({ maxH, minH, dur, del, hue, light }, i) => (
                            <div
                                key={i}
                                style={{
                                    width: 2.5,
                                    height: maxH,
                                    borderRadius: 2,
                                    background: isListening
                                        ? `hsl(${hue}, 82%, ${light}%)`
                                        : 'rgba(255,255,255,0.3)',
                                    transformOrigin: 'center',
                                    transform: isListening ? undefined : `scaleY(${(minH / maxH).toFixed(2)})`,
                                    animation: isListening
                                        ? `ptt-wave ${dur}s ease-in-out ${del}s infinite`
                                        : undefined,
                                    transition: 'background 300ms, transform 300ms',
                                    flexShrink: 0,
                                }}
                            />
                        ))}
                    </div>

                    {/* Recognized text */}
                    <p
                        style={{
                            fontSize: 12,
                            lineHeight: 1.4,
                            color: interim ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.32)',
                            fontStyle: interim ? 'normal' : 'italic',
                            margin: 0,
                            flex: 1,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            transition: 'color 200ms',
                        }}
                    >
                        {interim || (isListening
                            ? t('monitor.narration_ptt_speak_now', { defaultValue: 'Speak now…' })
                            : t('monitor.narration_ptt_finalizing', { defaultValue: 'Finalizing…' })
                        )}
                    </p>
                </div>
            </div>
        </>
    );
}
