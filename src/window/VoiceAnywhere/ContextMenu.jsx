import React, { useEffect, useRef } from 'react';
import { MdCheck, MdClose, MdSettings } from 'react-icons/md';
import { invoke } from '@tauri-apps/api/tauri';
import { appWindow } from '@tauri-apps/api/window';

const LANGUAGES = [
    { code: 'auto', label: 'Auto (same as Monitor)' },
    { code: 'en', label: 'English' },
    { code: 'vi', label: 'Tiếng Việt' },
    { code: 'zh', label: '中文' },
    { code: 'ja', label: '日本語' },
    { code: 'ko', label: '한국어' },
    { code: 'fr', label: 'Français' },
    { code: 'de', label: 'Deutsch' },
    { code: 'es', label: 'Español' },
    { code: 'pt', label: 'Português' },
    { code: 'ru', label: 'Русский' },
];

function MenuItem({ label, checked, onClick, icon: Icon, danger }) {
    return (
        <button
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                width: '100%',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: '12.5px',
                color: danger ? 'rgba(248,113,113,0.9)' : 'rgba(255,255,255,0.88)',
                textAlign: 'left',
                borderRadius: '6px',
                transition: 'background 120ms',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
        >
            <span style={{ width: 14, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                {checked && <MdCheck style={{ fontSize: 13, color: 'rgba(56,189,248,0.9)' }} />}
            </span>
            {Icon && <Icon style={{ fontSize: 13, opacity: 0.7, flexShrink: 0 }} />}
            {label}
        </button>
    );
}

function Separator() {
    return <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '4px 0' }} />;
}

function SectionLabel({ label }) {
    return (
        <div style={{
            padding: '4px 12px 2px',
            fontSize: '10px',
            fontWeight: 600,
            letterSpacing: '0.08em',
            color: 'rgba(255,255,255,0.35)',
            textTransform: 'uppercase',
        }}>
            {label}
        </div>
    );
}

export default function ContextMenu({
    x, y,
    services,           // [{ key, label }]
    currentSvcKey,      // e.g. 'soniox_stt' or 'inherit'
    monitorSvcKey,      // fallback when inherit
    language,
    injectMode,
    onSelectService,
    onSelectLanguage,
    onSelectInjectMode,
    onClose,
}) {
    const ref = useRef(null);

    // Close on click outside
    useEffect(() => {
        const handler = (e) => {
            if (ref.current && !ref.current.contains(e.target)) onClose();
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [onClose]);

    // Clamp to the current viewport (window is dynamically resized before menu opens,
    // so there is enough room above and to the left of the FAB).
    const menuW = 210;
    const menuH = 390;
    const clampedX = Math.max(4, Math.min(x, window.innerWidth - menuW - 4));
    const clampedY = Math.max(4, Math.min(y, window.innerHeight - menuH - 4));

    const effectiveSvc = (currentSvcKey && currentSvcKey !== 'inherit') ? currentSvcKey : monitorSvcKey;

    return (
        <div
            ref={ref}
            data-voice-anywhere-menu='true'
            style={{
                position: 'fixed',
                left: clampedX,
                top: clampedY,
                width: menuW,
                background: 'rgba(22, 22, 28, 0.96)',
                backdropFilter: 'blur(16px)',
                borderRadius: '10px',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                zIndex: 9999,
                padding: '6px 4px',
                userSelect: 'none',
            }}
        >
            <SectionLabel label="STT Provider" />
            <MenuItem
                label="Inherit from Monitor"
                checked={!currentSvcKey || currentSvcKey === 'inherit'}
                onClick={() => { onSelectService('inherit'); onClose(); }}
            />
            {services.map(({ key, label }) => (
                <MenuItem
                    key={key}
                    label={label}
                    checked={currentSvcKey === key}
                    onClick={() => { onSelectService(key); onClose(); }}
                />
            ))}

            <Separator />
            <SectionLabel label="Language" />
            {LANGUAGES.map(({ code, label }) => (
                <MenuItem
                    key={code}
                    label={label}
                    checked={(language ?? 'auto') === code}
                    onClick={() => { onSelectLanguage(code); onClose(); }}
                />
            ))}

            <Separator />
            <SectionLabel label="Inject Mode" />
            <MenuItem label="Replace" checked={(injectMode ?? 'replace') === 'replace'}
                onClick={() => { onSelectInjectMode('replace'); onClose(); }} />
            <MenuItem label="Append" checked={injectMode === 'append'}
                onClick={() => { onSelectInjectMode('append'); onClose(); }} />

            <Separator />
            <MenuItem
                label="Settings…"
                icon={MdSettings}
                onClick={() => { invoke('open_config_window'); onClose(); }}
            />
            <MenuItem
                label="Hide icon"
                icon={MdClose}
                onClick={() => { appWindow.hide(); onClose(); }}
            />
        </div>
    );
}
