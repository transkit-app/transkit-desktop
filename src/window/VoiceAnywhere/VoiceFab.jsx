import React, { useRef, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { MdMic, MdCheck } from 'react-icons/md';
import AmplitudeBars from './AmplitudeBars';

/**
 * Floating Action Button (FAB) with 5 visual states:
 *   idle        — mic icon + slow pulse ring
 *   listening   — amplitude bars + glow
 *   processing  — spinner + bars paused
 *   injecting   — green checkmark flash (400ms)
 *   error       — red tint + error tooltip
 *
 * Distinguishes tap (toggle recording) from drag (reposition window).
 * A press > 300ms OR mouse travel > 4px is treated as a drag.
 */
export default function VoiceFab({ fabState, amplitude, onToggle, errorMsg, size = 72 }) {
    const dragTimerRef = useRef(null);
    const startPosRef = useRef({ x: 0, y: 0 });
    const isDraggingRef = useRef(false);

    function handlePointerDown(e) {
        isDraggingRef.current = false;
        startPosRef.current = { x: e.clientX, y: e.clientY };
        dragTimerRef.current = setTimeout(() => {
            isDraggingRef.current = true;
            appWindow.startDragging();
        }, 300);
    }

    function handlePointerMove(e) {
        if (isDraggingRef.current) return;
        const dx = e.clientX - startPosRef.current.x;
        const dy = e.clientY - startPosRef.current.y;
        if (Math.hypot(dx, dy) > 4) {
            clearTimeout(dragTimerRef.current);
            isDraggingRef.current = true;
            appWindow.startDragging();
        }
    }

    function handlePointerUp() {
        clearTimeout(dragTimerRef.current);
        if (!isDraggingRef.current) {
            onToggle();
        }
        isDraggingRef.current = false;
    }

    // ── Derived visuals ─────────────────────────────────────────────────────
    const isListening = fabState === 'listening';
    const isProcessing = fabState === 'processing';
    const isInjecting = fabState === 'injecting';
    const isError = fabState === 'error';
    const isIdle = fabState === 'idle';

    const bgColor = isError
        ? 'rgba(220, 38, 38, 0.85)'
        : isInjecting
        ? 'rgba(22, 163, 74, 0.90)'
        : isListening || isProcessing
        ? 'rgba(14, 165, 233, 0.90)'
        : 'rgba(30, 30, 35, 0.85)';

    const boxShadow = isListening
        ? `0 0 0 6px rgba(14,165,233,0.25), 0 4px 20px rgba(0,0,0,0.5)`
        : isInjecting
        ? `0 0 0 6px rgba(22,163,74,0.25), 0 4px 20px rgba(0,0,0,0.5)`
        : isError
        ? `0 0 0 6px rgba(220,38,38,0.25), 0 4px 20px rgba(0,0,0,0.5)`
        : `0 4px 20px rgba(0,0,0,0.5)`;

    return (
        <div style={{ position: 'relative', width: size, height: size }}>
            {/* Slow pulse ring for idle state */}
            {isIdle && (
                <div
                    style={{
                        position: 'absolute',
                        inset: '-6px',
                        borderRadius: '50%',
                        border: '2px solid rgba(255,255,255,0.15)',
                        animation: 'va-pulse 2.5s ease-in-out infinite',
                        pointerEvents: 'none',
                    }}
                />
            )}

            <div
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                style={{
                    width: size,
                    height: size,
                    borderRadius: '50%',
                    background: bgColor,
                    boxShadow,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'background 200ms ease, box-shadow 200ms ease',
                    animation: isError ? 'va-shake 400ms ease' : undefined,
                    // No backdropFilter — it causes WebKit to render a gray compositing
                    // layer that bleeds outside the border-radius clip on transparent windows.
                    border: '1px solid rgba(255,255,255,0.15)',
                    // Isolation prevents stacking context bleed to parent layers.
                    isolation: 'isolate',
                    overflow: 'hidden',
                }}
            >
                {isIdle && (
                    <>
                        <div
                            style={{
                                position: 'absolute',
                                inset: '6%',
                                borderRadius: '50%',
                                background: 'radial-gradient(circle at 50% 42%, rgba(255,255,255,0.30), rgba(255,255,255,0.12) 42%, rgba(255,255,255,0.04) 62%, transparent 78%)',
                                filter: 'blur(1.8px)',
                                animation: 'va-idle-breathe 2.7s ease-in-out infinite',
                                pointerEvents: 'none',
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                inset: '-11%',
                                borderRadius: '44%',
                                background: 'conic-gradient(from 0deg, rgba(255,255,255,0.00), rgba(255,255,255,0.17), rgba(255,255,255,0.03), rgba(255,255,255,0.12), rgba(255,255,255,0.00))',
                                opacity: 0.86,
                                mixBlendMode: 'screen',
                                animation: 'va-idle-swirl 5.8s linear infinite',
                                pointerEvents: 'none',
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                inset: '-16%',
                                borderRadius: '46%',
                                background: 'conic-gradient(from 180deg, rgba(255,255,255,0.00), rgba(255,255,255,0.09), rgba(255,255,255,0.00), rgba(255,255,255,0.14), rgba(255,255,255,0.00))',
                                opacity: 0.62,
                                mixBlendMode: 'screen',
                                animation: 'va-idle-swirl-rev 7.8s linear infinite',
                                pointerEvents: 'none',
                            }}
                        />
                        <div
                            style={{
                                position: 'absolute',
                                inset: '4px',
                                borderRadius: '50%',
                                border: '1px solid rgba(255,255,255,0.10)',
                                boxShadow: 'inset 0 0 12px rgba(255,255,255,0.06)',
                                animation: 'va-idle-ring 3.4s ease-in-out infinite',
                                pointerEvents: 'none',
                            }}
                        />
                    </>
                )}
                {isListening && <AmplitudeBars amplitude={amplitude} active={true} />}
                {isProcessing && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <AmplitudeBars amplitude={0} active={false} />
                        <div
                            style={{
                                position: 'absolute',
                                width: '20px',
                                height: '20px',
                                border: '2px solid rgba(255,255,255,0.3)',
                                borderTopColor: 'white',
                                borderRadius: '50%',
                                animation: 'va-spin 0.8s linear infinite',
                            }}
                        />
                    </div>
                )}
                {isInjecting && <MdCheck style={{ fontSize: '32px', color: 'white' }} />}
                {(isIdle || isError) && (
                    <MdMic style={{ fontSize: '30px', color: 'rgba(255,255,255,0.9)' }} />
                )}
            </div>

            <style>{`
                @keyframes va-pulse {
                    0%,100% { transform: scale(1); opacity: 0.6; }
                    50%      { transform: scale(1.15); opacity: 0.2; }
                }
                @keyframes va-spin {
                    to { transform: rotate(360deg); }
                }
                @keyframes va-shake {
                    0%,100% { transform: translateX(0); }
                    20%     { transform: translateX(-4px); }
                    40%     { transform: translateX(4px); }
                    60%     { transform: translateX(-4px); }
                    80%     { transform: translateX(4px); }
                }
                @keyframes va-idle-breathe {
                    0%, 100% { transform: scale(0.92); opacity: 0.48; }
                    50% { transform: scale(1.10); opacity: 1; }
                }
                @keyframes va-idle-swirl {
                    0% { transform: rotate(0deg) scale(0.95); }
                    50% { transform: rotate(180deg) scale(1.04); }
                    100% { transform: rotate(360deg) scale(0.95); }
                }
                @keyframes va-idle-swirl-rev {
                    0% { transform: rotate(360deg) scale(0.94); }
                    50% { transform: rotate(180deg) scale(1.03); }
                    100% { transform: rotate(0deg) scale(0.94); }
                }
                @keyframes va-idle-ring {
                    0%, 100% { opacity: 0.38; transform: scale(0.98); }
                    50% { opacity: 0.82; transform: scale(1.01); }
                }
            `}</style>
        </div>
    );
}
