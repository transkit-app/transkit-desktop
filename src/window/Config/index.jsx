import { useLocation, useRoutes } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { checkUpdate } from '@tauri-apps/api/updater';
import { invoke } from '@tauri-apps/api';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { MdSystemUpdate } from 'react-icons/md';
import { HiSun, HiMoon } from 'react-icons/hi';

import WindowControl from '../../components/WindowControl';
import SideBar from './components/SideBar';
import { osType, appVersion } from '../../utils/env';
import { useConfig } from '../../hooks';
import routes from './routes';
import './style.css';

// Compact theme toggle for the header
function HeaderThemeToggle() {
    const { resolvedTheme, setTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => { setMounted(true); }, []);
    if (!mounted) return null;
    const isDark = resolvedTheme === 'dark';
    return (
        <div className="flex items-center bg-content2 dark:bg-content2 rounded-lg p-0.5 gap-0.5">
            <button
                onClick={() => setTheme('light')}
                title="Light"
                className={`p-1.5 rounded-md transition-all duration-200 ${
                    !isDark
                        ? 'bg-white dark:bg-content3 text-brand-600 shadow-sm'
                        : 'text-default-400 hover:text-default-600 dark:hover:text-default-300'
                }`}
            >
                <HiSun className="text-[15px]" />
            </button>
            <button
                onClick={() => setTheme('dark')}
                title="Dark"
                className={`p-1.5 rounded-md transition-all duration-200 ${
                    isDark
                        ? 'bg-content3 text-brand-400 shadow-sm'
                        : 'text-default-400 hover:text-default-600 dark:hover:text-default-300'
                }`}
            >
                <HiMoon className="text-[15px]" />
            </button>
        </div>
    );
}

// Logo Component
function Logo() {
    return (
        <div className="flex items-center gap-3 px-4" data-tauri-drag-region="true">
            <img src="icon.png" alt="TransKit" className="w-10 h-10" />
            <div className="flex flex-col">
                <span className="text-base font-heading font-semibold text-gradient">
                    TransKit
                </span>
                <span className="text-[10px] text-default-400 dark:text-default-500">
                    Desktop {appVersion ? `- V${appVersion}` : ''}
                </span>
            </div>
        </div>
    );
}

export default function Config() {
    const [transparent] = useConfig('transparent', true);
    const { t } = useTranslation();
    const location = useLocation();
    const page = useRoutes(routes);
    const [updateAvailable, setUpdateAvailable] = useState(false);

    useEffect(() => {
        if (appWindow.label === 'config') {
            appWindow.show();
        }
        checkUpdate().then((update) => {
            if (update.shouldUpdate) {
                setUpdateAvailable(true);
            }
        }).catch(() => {});
    }, []);

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <aside
                className={`
                    w-[250px] h-screen flex flex-col
                    ${transparent && osType !== 'Windows_NT' ? 'bg-background/80 backdrop-blur-lg' : 'bg-content1'}
                    border-r border-content3 dark:border-content3
                    ${osType === 'Linux' && 'rounded-l-[10px] border-l border-t border-b'}
                    select-none
                `}
            >
                {/* Drag Region */}
                <div
                    className="h-[12px] w-full shrink-0"
                    data-tauri-drag-region="true"
                />

                {/* Logo Area */}
                <div className="py-4 shrink-0">
                    <Logo />
                    {updateAvailable && (
                        <div className="px-4 pt-2">
                            <button
                                onClick={() => invoke('updater_window')}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold
                                    bg-amber-500/10 text-amber-600 dark:bg-amber-400/10 dark:text-amber-400
                                    hover:bg-amber-500/20 dark:hover:bg-amber-400/20 transition-colors duration-200
                                    border border-amber-500/20 dark:border-amber-400/20"
                            >
                                <span className="relative flex h-2 w-2 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                                </span>
                                {t('updater.update_available')}
                                <MdSystemUpdate className="text-sm shrink-0" />
                            </button>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <div className="flex-1 overflow-hidden">
                    <SideBar />
                </div>
            </aside>

            {/* Main Content */}
            <main
                className={`
                    flex-1 h-screen flex flex-col bg-background
                    ${osType === 'Linux' && 'rounded-r-[10px] border-r border-t border-b border-content3'}
                    select-none
                `}
            >
                {/* Header */}
                <header className="h-[52px] shrink-0 flex items-center justify-between px-4 border-b border-content3 dark:border-content3">
                    {/* Drag region for header */}
                    <div
                        data-tauri-drag-region="true"
                        className="absolute top-0 left-[210px] right-0 h-[12px]"
                    />

                    {/* Page Title */}
                    <div className="flex items-center gap-3">
                        <h1 className="text-[16px] font-heading font-semibold text-foreground">
                            {t(`config.${location.pathname.slice(1).replaceAll('-', '_')}.title`)}
                        </h1>
                    </div>

                    {/* Right side: theme toggle + window controls */}
                    <div className="flex items-center gap-2">
                        <HeaderThemeToggle />
                        {osType !== 'Darwin' && <WindowControl />}
                    </div>
                </header>

                {/* Page Content */}
                <div className="relative flex-1 min-h-0 overflow-hidden">
                    <motion.div
                        key={location.pathname}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }}
                        className="absolute inset-0 overflow-y-auto config-scroll p-4"
                    >
                        {page}
                    </motion.div>
                </div>
            </main>
        </div>
    );
}
