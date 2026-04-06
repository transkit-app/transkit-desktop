import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import Database from 'tauri-plugin-sql-api';
import React from 'react';

// Icons
import { BsInfoSquareFill } from 'react-icons/bs';
import { PiTranslateFill, PiTextboxFill } from 'react-icons/pi';
import { AiFillAppstore, AiFillCloud } from 'react-icons/ai';
import { MdKeyboardAlt, MdExtension, MdHeadset, MdPerson, MdMic } from 'react-icons/md';
import { FaHistory } from 'react-icons/fa';

import { getUser, onAuthStateChange } from '../../../../lib/transkit-cloud';
import { useConfig } from '../../../../hooks';

// Navigation configuration with sections
const navigationConfig = [
    {
        section: 'MAIN',
        items: [
            { id: 'general', path: '/general', icon: AiFillAppstore, labelKey: 'config.general.label' },
            { id: 'translate', path: '/translate', icon: PiTranslateFill, labelKey: 'config.translate.label' },
            { id: 'recognize', path: '/recognize', icon: PiTextboxFill, labelKey: 'config.recognize.label' },
            { id: 'audio-translate', path: '/audio-translate', icon: MdHeadset, labelKey: 'config.audio_translate.label' },
            { id: 'voice-input', path: '/voice-input', icon: MdMic, labelKey: 'config.voice_input.label' },
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
                nav-item group relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg
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
                flex items-center justify-center w-7 h-7 rounded-md transition-all duration-200 flex-shrink-0
                ${isActive
                    ? 'bg-gradient-to-br from-brand-500 to-accent-cyan text-white shadow-glow-sm'
                    : 'bg-content2 dark:bg-content2 text-default-500 group-hover:text-brand-500 dark:group-hover:text-brand-400'
                }
            `}>
                <Icon className="text-[15px]" />
            </span>

            {/* Label */}
            <span className={`
                flex-1 text-[13px] font-medium transition-colors duration-200
                ${isActive ? 'text-brand-600 dark:text-brand-400' : ''}
            `}>
                {t(item.labelKey)}
            </span>

            {/* Badge */}
            {displayBadge && (
                <span className="badge-count text-xs px-1.5 py-0.5 rounded-full">
                    {badgeCount > 99 ? '99+' : badgeCount}
                </span>
            )}
        </motion.button>
    );
}

// Section Header Component
function SectionHeader({ title }) {
    return (
        <div className="px-3 pt-3 pb-1">
            <span className="text-[10px] font-semibold tracking-wider text-default-400 dark:text-default-500 uppercase">
                {title}
            </span>
        </div>
    );
}

// Account Widget — fixed at the bottom of the sidebar
function AccountWidget({ navigate }) {
    const { t } = useTranslation();
    const [user, setUser] = React.useState(undefined); // undefined = loading
    const [localProfile] = useConfig('user_profile', {});

    React.useEffect(() => {
        getUser().then(setUser);
        const unsub = onAuthStateChange(setUser);
        return unsub;
    }, []);

    if (user === undefined) return null;

    // Not logged in — show local profile name if available
    if (!user) {
        const localName = localProfile?.name;
        return (
            <button
                onClick={() => navigate('/account')}
                className="w-full flex items-center gap-3 px-3 py-2 rounded-xl
                    text-default-600 dark:text-default-400 hover:text-foreground dark:hover:text-foreground
                    hover:bg-content2 dark:hover:bg-content2 transition-all duration-200"
            >
                {/* Icon sized like an avatar */}
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-content2 dark:bg-content2 text-default-500 flex-shrink-0">
                    <MdPerson className="text-[26px]" />
                </span>
                <div className="flex-1 min-w-0 text-left">
                    <p className="text-[13px] font-medium truncate text-foreground">
                        {localName || t('config.account.profile_title')}
                    </p>
                    <p className="text-[11px] text-default-400 truncate">{t('config.account.not_signed_in')}</p>
                </div>
            </button>
        );
    }

    // Logged in — show avatar + name + email
    return (
        <button
            onClick={() => navigate('/account')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl
                hover:bg-content2 dark:hover:bg-content2 transition-all duration-200"
        >
            {user.user_metadata?.avatar_url ? (
                <img
                    src={user.user_metadata.avatar_url}
                    alt=""
                    className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                />
            ) : (
                <span className="flex items-center justify-center w-8 h-8 rounded-full bg-brand-500/10 text-brand-600 dark:text-brand-400 text-sm font-semibold flex-shrink-0">
                    {user.email?.[0]?.toUpperCase()}
                </span>
            )}
            <div className="flex-1 min-w-0 text-left">
                <p className="text-[13px] font-medium truncate text-foreground">
                    {user.user_metadata?.full_name || user.email}
                </p>
                <p className="text-[11px] text-default-400 truncate">{user.email}</p>
            </div>
        </button>
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
                            <div className="mx-3 my-1.5 h-px bg-content3 dark:bg-content3" />
                        )}
                    </div>
                ))}
            </nav>

            {/* Account Widget — fixed at bottom */}
            <div className="border-t border-content3 dark:border-content3 px-2 py-2 mt-auto">
                <AccountWidget navigate={navigate} />
            </div>
        </div>
    );
}
