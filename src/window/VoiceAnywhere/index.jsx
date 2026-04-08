import { appWindow, LogicalSize, LogicalPosition } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/tauri';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import VoiceFab from './VoiceFab';
import ContextMenu from './ContextMenu';
import { useVoiceAnywhere } from './useVoiceAnywhere';
import { useAmplitude } from './useAmplitude';
import { useConfig } from '../../hooks';
import { getServiceName } from '../../utils/service_instance';
import { store } from '../../utils/store';
import { DEFAULT_PROMPTS, BUILTIN_LEVELS } from '../../utils/polishTranscript';

// Context menu dimensions — used for dynamic window resize
const MENU_W = 220;
const MENU_H = 610;
const CAPTION_W = 380;
const CAPTION_H = 92;

export default function VoiceAnywhere() {
    // ── Reactive config ──────────────────────────────────────────────────────
    const [voiceSttService, setVoiceSttService] = useConfig('voice_anywhere_stt_service', 'inherit');
    const [monitorSvcKey] = useConfig('transcription_active_service', '');
    const [voiceLanguage, setVoiceLanguage] = useConfig('voice_anywhere_language', 'auto');
    const [injectMode, setInjectMode] = useConfig('voice_anywhere_inject_mode', 'replace');
    const [action, setAction] = useConfig('voice_anywhere_action', 'clipboard');
    const [autostart] = useConfig('voice_anywhere_autostart', true);
    const [showContextMenu] = useConfig('voice_anywhere_show_context_menu', true);
    const [preferAsyncApi] = useConfig('voice_anywhere_prefer_async_api', true);
    const [fabSize] = useConfig('voice_anywhere_fab_size', 72);
    const [idleButtonColor] = useConfig('voice_anywhere_idle_button_color', '#3f3f46');
    const [transcriptionServiceList] = useConfig('transcription_service_list', []);
    const [polishEnabled] = useConfig('voice_anywhere_polish_enabled', false);
    const [polishLevel] = useConfig('voice_anywhere_polish_level', 'mild');
    const [polishServiceKey] = useConfig('voice_anywhere_polish_service', '');
    const [polishPromptOverrides] = useConfig('voice_anywhere_polish_prompt_overrides', {});
    const [polishCustomLevels] = useConfig('voice_anywhere_polish_custom_levels', []);

    // Resolve the effective prompt for the selected level
    const polishPrompt = React.useMemo(() => {
        if (BUILTIN_LEVELS.includes(polishLevel)) {
            return (polishPromptOverrides ?? {})[polishLevel] || DEFAULT_PROMPTS[polishLevel];
        }
        // Custom level — find by key
        const custom = (polishCustomLevels ?? []).find(c => c.key === polishLevel);
        return custom?.prompt || DEFAULT_PROMPTS.mild;
    }, [polishLevel, polishPromptOverrides, polishCustomLevels]);

    const sz = fabSize ?? 72;

    // ── Core hook ────────────────────────────────────────────────────────────
    const { fabState, interim, finalText, injected, errorMsg, toggle } = useVoiceAnywhere({
        sttServiceKey: voiceSttService,
        monitorSvcKey,
        language: voiceLanguage,
        injectMode,
        action,
        autostart,
        preferAsyncApi,
        polishEnabled,
        polishPrompt,
        polishServiceKey,
    });

    const isRecording = fabState === 'listening';
    const amplitude = useAmplitude(isRecording);

    // ── Context menu state ───────────────────────────────────────────────────
    const [ctxMenu, setCtxMenu] = useState(null);
    const [svcDisplayNames, setSvcDisplayNames] = useState({});
    const baseWindowRef = useRef(null);

    // ── Global style override ────────────────────────────────────────────────
    // Override global CSS (html { border-radius: 10px; overflow: hidden }) and
    // NextUI dark-theme background.  Inline !important beats all stylesheet rules.
    useEffect(() => {
        const html = document.documentElement;
        // Remove the rounded-rectangle clip that other windows use
        html.style.setProperty('border-radius', '0px', 'important');
        // Keep overflow: hidden to prevent 100vw/100vh scrollbar feedback loops
        html.style.setProperty('overflow', 'hidden', 'important');
        html.style.setProperty('background', 'transparent', 'important');
        document.body.style.setProperty('background', 'transparent', 'important');
        document.body.style.setProperty('overflow', 'hidden', 'important');
        document.body.style.setProperty('margin', '0', 'important');
        document.body.style.setProperty('padding', '0', 'important');
        const root = document.getElementById('root');
        if (root) {
            root.style.setProperty('background', 'transparent', 'important');
            root.style.setProperty('overflow', 'hidden', 'important');
        }
    }, []);

    useEffect(() => {
        if (!transcriptionServiceList?.length) return;
        Promise.all(
            transcriptionServiceList.map(async (key) => {
                const cfg = await store.get(key).catch(() => null);
                const label = cfg?.instanceName || cfg?.service_instance_name || getServiceName(key);
                return [key, label];
            })
        ).then((pairs) => setSvcDisplayNames(Object.fromEntries(pairs)));
    }, [transcriptionServiceList]);

    // ── Context menu: expand window then show ────────────────────────────────
    const handleContextMenu = useCallback(async (e) => {
        e.preventDefault();
        try {
            if (!baseWindowRef.current) {
                const physPos = await appWindow.outerPosition();
                const sf = await appWindow.scaleFactor();
                const lx = physPos.x / sf;
                const ly = physPos.y / sf;
                const win = sz + PADDING * 2;
                baseWindowRef.current = { x: lx, y: ly, w: win, h: win };
            }

            const { x: lx, y: ly } = baseWindowRef.current;
            const fabRight = lx + PADDING + sz;
            const fabBottom = ly + PADDING + sz;

            // Expand upward/leftward; FAB moves to bottom-right of expanded window
            const newW = Math.max(MENU_W, sz);
            const newH = MENU_H + sz + 8;
            const newX = fabRight  - newW;
            const newY = fabBottom - newH;

            isMenuExpandedRef.current = true;
            await appWindow.setSize(new LogicalSize(newW, newH));
            await appWindow.setPosition(new LogicalPosition(newX, newY));
            setCtxMenu({ x: 4, y: 4 });
        } catch {
            isMenuExpandedRef.current = false;
            setCtxMenu({ x: 0, y: 0 });
        }
    }, [sz]);

    // ── Context menu: close and restore window ───────────────────────────────
    const closeCtxMenu = useCallback(async () => {
        setCtxMenu(null);
        if (baseWindowRef.current) {
            const { x, y, w, h } = baseWindowRef.current;
            try {
                await appWindow.setSize(new LogicalSize(w, h));
                await appWindow.setPosition(new LogicalPosition(x, y));
            } catch {}
        }
        isMenuExpandedRef.current = false;
    }, []);

    const handlePointerDownCapture = useCallback((e) => {
        if (!ctxMenu) return;
        const menuRoot = e.target?.closest?.('[data-voice-anywhere-menu="true"]');
        if (!menuRoot) {
            closeCtxMenu();
        }
    }, [ctxMenu, closeCtxMenu]);

    // ── Window lifecycle ─────────────────────────────────────────────────────
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'Escape') {
                if (ctxMenu) closeCtxMenu();
                else appWindow.hide();
            }
        };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [ctxMenu, closeCtxMenu]);

    useEffect(() => {
        const p = listen('tauri://close-requested', () => appWindow.hide());
        return () => { p.then((f) => f()); };
    }, []);

    // Persist user-dragged position so hotkey doesn't snap back to default corner.
    // Skip saves while context menu is open (window expands/contracts during that cycle).
    const isMenuExpandedRef = useRef(false);
    const savePosTimerRef = useRef(null);
    useEffect(() => {
        const p = listen('tauri://move', async () => {
            if (isMenuExpandedRef.current) return;
            clearTimeout(savePosTimerRef.current);
            savePosTimerRef.current = setTimeout(async () => {
                try {
                    const physPos = await appWindow.outerPosition();
                    await invoke('save_voice_anywhere_position', { x: physPos.x, y: physPos.y });
                    baseWindowRef.current = null; // invalidate cached base position
                } catch {}
            }, 400);
        });
        return () => { p.then((f) => f()); clearTimeout(savePosTimerRef.current); };
    }, []);

    // Close context menu when the window loses focus (user clicks elsewhere on screen)
    useEffect(() => {
        if (!ctxMenu) return;
        const p = listen('tauri://blur', () => closeCtxMenu());
        return () => { p.then((f) => f()); };
    }, [ctxMenu, closeCtxMenu]);

    const services = (transcriptionServiceList ?? []).map((key) => ({
        key,
        label: svcDisplayNames[key] ?? getServiceName(key),
    }));

    // PADDING must match padding_logical in window.rs voice_anywhere_window().
    // The window is (sz + PADDING*2) × (sz + PADDING*2); the FAB is centred inside it.
    const PADDING = 36;

    // Radial fade mask centred on the FAB (50%/50% of the larger window).
    // Opaque over the FAB circle, fades to transparent over the padding zone.
    // Removed when the context menu is open so the full expanded area is visible.
    const fadeMask = ctxMenu
        ? 'none'
        : `radial-gradient(circle at 50% 50%, black 0%, black ${sz / 2}px, transparent ${sz / 2 + PADDING}px)`;
    const hasCaptionContent = Boolean(errorMsg || interim || finalText);

    useEffect(() => {
        let cancelled = false;

        const syncCaptionWindow = async () => {
            try {
                if (!hasCaptionContent) {
                    await invoke('hide_voice_anywhere_caption');
                    return;
                }
                const physPos = await appWindow.outerPosition();
                const sf = await appWindow.scaleFactor();
                const lx = physPos.x / sf;
                const ly = physPos.y / sf;
                const baseW = sz + PADDING * 2;
                const captionX = lx + (baseW / 2) - (CAPTION_W / 2);
                const captionY = ly - CAPTION_H + 18;
                if (cancelled) return;
                await invoke('show_voice_anywhere_caption', {
                    x: captionX,
                    y: captionY,
                    width: CAPTION_W,
                    height: CAPTION_H,
                    interim,
                    finalText,
                    errorMsg,
                    fabState,
                });
            } catch (err) {
                console.warn('[VoiceAnywhere] caption sync failed', err);
            }
        };

        syncCaptionWindow();
        return () => { cancelled = true; };
    }, [hasCaptionContent, interim, finalText, errorMsg, fabState, sz]);

    useEffect(() => {
        return () => {
            invoke('hide_voice_anywhere_caption').catch(() => {});
        };
    }, []);

    return (
        <div
            onContextMenu={showContextMenu ? handleContextMenu : undefined}
            onPointerDownCapture={handlePointerDownCapture}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'transparent',
                overflow: 'visible',
            }}
        >
            <div
                style={{
                    position: 'absolute',
                    inset: 0,
                    overflow: 'hidden',
                    WebkitMaskImage: fadeMask,
                    maskImage: fadeMask,
                }}
            >
                {/* Normal: FAB centred in the (sz + PADDING*2) window for natural fade room.
                    Menu-open: pinned to bottom-right so it stays at the same screen position
                    while the window expands upward/leftward. */}
                <div style={{
                    position: 'absolute',
                    width: sz,
                    height: sz,
                    ...(ctxMenu
                        ? { right: 0, bottom: 0 }
                        : { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }
                    ),
                }}>
                    <VoiceFab
                        fabState={fabState}
                        amplitude={amplitude}
                        onToggle={toggle}
                        errorMsg={errorMsg}
                        size={sz}
                        idleColor={idleButtonColor}
                    />
                </div>
            </div>

            {ctxMenu && (
                <ContextMenu
                    x={ctxMenu.x}
                    y={ctxMenu.y}
                    services={services}
                    currentSvcKey={voiceSttService}
                    monitorSvcKey={monitorSvcKey}
                    language={voiceLanguage}
                    injectMode={injectMode}
                    action={action}
                    onSelectService={setVoiceSttService}
                    onSelectLanguage={setVoiceLanguage}
                    onSelectInjectMode={setInjectMode}
                    onSelectAction={setAction}
                    onClose={closeCtxMenu}
                />
            )}
        </div>
    );
}
