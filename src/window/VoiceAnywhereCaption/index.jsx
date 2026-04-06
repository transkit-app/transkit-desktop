import { appWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import React, { useEffect, useState } from 'react';

function CaptionCard({ interim, finalText, errorMsg, fabState }) {
    const isError = fabState === 'error' && !!errorMsg;
    const text = isError ? errorMsg : finalText || interim;
    if (!text) return null;

    const bg = isError ? 'rgba(127, 29, 29, 0.96)' : 'rgba(20, 20, 25, 0.92)';
    const border = isError ? '1px solid rgba(248,113,113,0.35)' : '1px solid rgba(255,255,255,0.08)';
    const color = isError
        ? 'rgba(255,240,240,0.98)'
        : finalText
        ? 'rgba(255,255,255,0.95)'
        : 'rgba(255,255,255,0.72)';

    return (
        <div
            style={{
                maxWidth: '360px',
                background: bg,
                backdropFilter: 'blur(12px)',
                borderRadius: '12px',
                padding: '10px 14px',
                boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
                border,
                pointerEvents: 'none',
                textAlign: 'center',
            }}
        >
            <p
                style={{
                    margin: 0,
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color,
                    fontStyle: !isError && !finalText ? 'italic' : 'normal',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {text}
            </p>
        </div>
    );
}

export default function VoiceAnywhereCaption() {
    const [payload, setPayload] = useState({
        interim: '',
        finalText: '',
        errorMsg: '',
        fabState: 'idle',
    });

    useEffect(() => {
        const html = document.documentElement;
        html.style.setProperty('border-radius', '0px', 'important');
        html.style.setProperty('overflow', 'hidden', 'important');
        html.style.setProperty('background', 'transparent', 'important');
        document.body.style.setProperty('background', 'transparent', 'important');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        document.body.style.setProperty('margin', '0', 'important');
        document.body.style.setProperty('padding', '0', 'important');
    }, []);

    useEffect(() => {
        const closePromise = listen('tauri://close-requested', () => appWindow.hide());
        const updatePromise = listen('voice_anywhere_caption_update', (event) => {
            const next = event.payload ?? {};
            setPayload({
                interim: next.interim ?? '',
                finalText: next.finalText ?? '',
                errorMsg: next.errorMsg ?? '',
                fabState: next.fabState ?? 'idle',
            });
        });

        return () => {
            closePromise.then((off) => off());
            updatePromise.then((off) => off());
        };
    }, []);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'transparent',
                overflow: 'hidden',
            }}
        >
            <CaptionCard
                interim={payload.interim}
                finalText={payload.finalText}
                errorMsg={payload.errorMsg}
                fabState={payload.fabState}
            />
        </div>
    );
}
