import { useLocation, useRoutes } from 'react-router-dom';
import React, { useEffect } from 'react';
import { appWindow } from '@tauri-apps/api/window';
import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import WindowControl from '../../components/WindowControl';
import SideBar from './components/SideBar';
import { osType } from '../../utils/env';
import { useConfig } from '../../hooks';
import routes from './routes';
import './style.css';

// Logo Component
function Logo() {
    return (
        <div className="flex items-center gap-3 px-4" data-tauri-drag-region="true">
            <div className="relative">
                {/* Logo Icon with gradient background */}
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-accent-cyan flex items-center justify-center shadow-glow-sm">
                    <svg
                        width="24"
                        height="24"
                        viewBox="0 0 24 24"
                        fill="none"
                        className="text-white"
                    >
                        <path
                            d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0014.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z"
                            fill="currentColor"
                        />
                    </svg>
                </div>
            </div>
            <div className="flex flex-col">
                <span className="text-base font-heading font-semibold text-gradient">
                    Transkit
                </span>
                <span className="text-[10px] text-default-400 dark:text-default-500">
                    Desktop
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

    useEffect(() => {
        if (appWindow.label === 'config') {
            appWindow.show();
        }
    }, []);

    return (
        <div className="flex h-screen">
            {/* Sidebar */}
            <aside
                className={`
                    w-[240px] h-screen flex flex-col
                    ${transparent ? 'bg-background/80 backdrop-blur-lg' : 'bg-content1'}
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
                        className="absolute top-0 left-[240px] right-0 h-[12px]"
                    />

                    {/* Page Title */}
                    <div className="flex items-center gap-3">
                        <h1 className="text-[16px] font-heading font-semibold text-foreground">
                            {t(`config.${location.pathname.slice(1).replaceAll('-', '_')}.title`)}
                        </h1>
                    </div>

                    {/* Window Controls (non-macOS) */}
                    {osType !== 'Darwin' && (
                        <div className="flex items-center">
                            <WindowControl />
                        </div>
                    )}
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
