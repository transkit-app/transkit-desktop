import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTheme } from 'next-themes';
import { motion } from 'framer-motion';
import Database from 'tauri-plugin-sql-api';
import React from 'react';

// Icons
import { BsInfoSquareFill } from 'react-icons/bs';
import { PiTranslateFill, PiTextboxFill } from 'react-icons/pi';
import { AiFillAppstore, AiFillCloud } from 'react-icons/ai';
import { MdKeyboardAlt, MdExtension, MdHeadset, MdPerson, MdAccountCircle } from 'react-icons/md';
import { FaHistory } from 'react-icons/fa';
import { HiSun, HiMoon } from 'react-icons/hi';

// Navigation configuration with sections
const navigationConfig = [
    {
        section: 'MAIN',
        items: [
            { id: 'general', path: '/general', icon: AiFillAppstore, labelKey: 'config.general.label' },
            { id: 'translate', path: '/translate', icon: PiTranslateFill, labelKey: 'config.translate.label' },
            { id: 'recognize', path: '/recognize', icon: PiTextboxFill, labelKey: 'config.recognize.label' },
            { id: 'audio-translate', path: '/audio-translate', icon: MdHeadset, labelKey: 'config.audio_translate.label' },
            { id: 'profile', path: '/profile', icon: MdPerson, labelKey: 'config.profile.label' },
            { id: 'hotkey', path: '/hotkey', icon: MdKeyboardAlt, labelKey: 'config.hotkey.label' },
        ],
    },
    {
        section: 'SERVICES',
        items: [
            { id: 'service', path: '/service', icon: MdExtension, labelKey: 'config.service.label' },
            { id: 'history', path: '/history', icon: FaHistory, labelKey: 'config.history.label', hasBadge: true },
        ],
    },
    {
        section: 'SYSTEM',
        items: [
            { id: 'account', path: '/account', icon: MdAccountCircle, labelKey: 'config.account.label' },
            { id: 'backup', path: '/backup', icon: AiFillCloud, labelKey: 'config.backup.label' },
            { id: 'about', path: '/about', icon: BsInfoSquareFill, labelKey: 'config.about.label' },
        ],
    },
];

// Animation variants
const itemVariants = {
    inactive: {
        x: 0,
        backgroundColor: 'rgba(0, 0, 0, 0)',
    },
    active: {
        x: 0,
        backgroundColor: 'rgba(14, 165, 233, 0.1)',
    },
    hover: {
        x: 4,
        transition: { duration: 0.2 },
    },
};

// Navigation Item Component
function NavItem({ item, isActive, onClick, t, badgeCount }) {
    const Icon = item.icon;
    const displayBadge = item.hasBadge && badgeCount > 0;

    return (
        <motion.button
            onClick={onClick}
            className={`
                nav-item group relative w-full flex items-center gap-3 px-4 py-2.5 rounded-xl
                text-left transition-all duration-200 outline-none
                ${isActive
                    ? 'bg-brand-500/10 dark:bg-brand-400/10 text-brand-600 dark:text-brand-400'
                    : 'text-default-600 dark:text-default-400 hover:text-foreground dark:hover:text-foreground'
                }
            `}
            initial="inactive"
            animate={isActive ? "active" : "inactive"}
            whileHover="hover"
            variants={itemVariants}
        >
            {/* Icon */}
            <span className={`
                flex items-center justify-center w-8 h-8 rounded-lg transition-all duration-200
                ${isActive
                    ? 'bg-gradient-to-br from-brand-500 to-accent-cyan text-white shadow-glow-sm'
                    : 'bg-content2 dark:bg-content2 text-default-500 group-hover:text-brand-500 dark:group-hover:text-brand-400'
                }
            `}>
                <Icon className="text-[18px]" />
            </span>

            {/* Label */}
            <span className={`
                flex-1 text-[14px] font-medium transition-colors duration-200
                ${isActive ? 'text-brand-600 dark:text-brand-400' : ''}
            `}>
                {t(item.labelKey)}
            </span>

            {/* Badge */}
            {displayBadge && (
                <span className="badge-count text-xs px-2 py-0.5 rounded-full">
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            )}
        </motion.button>
    );
}

// Section Header Component
function SectionHeader({ title }) {
    return (
        <div className="px-4 pt-4 pb-2">
            <span className="text-[10px] font-semibold tracking-wider text-default-400 dark:text-default-500 uppercase">
                {title}
            </span>
        </div>
    );
}

// Theme Toggle Component
function ThemeToggle() {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);

    React.useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return null;

    const isDark = resolvedTheme === 'dark';

    return (
        <div className="px-3 py-2">
            <div className="flex items-center bg-content2 dark:bg-content2 rounded-xl p-1">
                <button
                    onClick={() => setTheme('light')}
                    className={`
                        flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg
                        text-xs font-medium transition-all duration-200
                        ${!isDark
                            ? 'bg-white dark:bg-content3 text-brand-600 shadow-sm'
                            : 'text-default-500 hover:text-default-700'
                        }
                    `}
                >
                    <HiSun className="text-base" />
                    <span>Light</span>
                </button>
                <button
                    onClick={() => setTheme('dark')}
                    className={`
                        flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg
                        text-xs font-medium transition-all duration-200
                        ${isDark
                            ? 'bg-content3 text-brand-400 shadow-sm'
                            : 'text-default-500 hover:text-default-700'
                        }
                    `}
                >
                    <HiMoon className="text-base" />
                    <span>Dark</span>
                </button>
            </div>
        </div>
    );
}

// Main Sidebar Component
export default function SideBar() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const location = useLocation();
    const [historyCount, setHistoryCount] = React.useState(0);

    React.useEffect(() => {
        Database.load('sqlite:history.db')
            .then(db => db.select('SELECT COUNT(*) as cnt FROM history'))
            .then(result => {
                if (result[0]?.cnt != null) setHistoryCount(result[0].cnt);
            })
            .catch(() => {});
    }, []);

    const isActive = (path) => location.pathname === path;

    const getBadgeCount = (id) => {
        if (id === 'history') return historyCount;
        return 0;
    };

    return (
        <div className="flex flex-col h-full">
            {/* Navigation Groups */}
            <nav className="flex-1 overflow-y-auto px-2 scrollbar-hide">
                {navigationConfig.map((group, groupIndex) => (
                    <div key={group.section}>
                        <SectionHeader title={group.section} />
                        <div className="space-y-1">
                            {group.items.map((item) => (
                                <NavItem
                                    key={item.id}
                                    item={item}
                                    isActive={isActive(item.path)}
                                    onClick={() => navigate(item.path)}
                                    t={t}
                                    badgeCount={getBadgeCount(item.id)}
                                />
                            ))}
                        </div>
                        {/* Divider between sections (not after last) */}
                        {groupIndex < navigationConfig.length - 1 && (
                            <div className="mx-4 my-2 h-px bg-content3 dark:bg-content3" />
                        )}
                    </div>
                ))}
            </nav>

            {/* Theme Toggle at Bottom */}
            <div className="border-t border-content3 dark:border-content3 mt-auto">
                <ThemeToggle />
            </div>
        </div>
    );
}
