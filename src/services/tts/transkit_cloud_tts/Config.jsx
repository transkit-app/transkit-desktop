import { Button, Progress, Chip, Select, SelectItem } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import React, { useState, useEffect, useCallback } from 'react';
import { SignOutButton } from '../../../components/SignOutButton';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import {
    CLOUD_ENABLED,
    getCloudTTSConfig,
    getUserProfile,
    signInWithGoogle,
    signInWithGitHub,
    onAuthStateChange,
} from '../../../lib/transkit-cloud';

const BASE = 'services.tts.transkit_cloud_tts';

function fmtChars(n) {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
}

export function Config({ instanceKey, updateServiceList, onClose }) {
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        { [INSTANCE_NAME_CONFIG_KEY]: t(`${BASE}.title`), voiceId: 'auto' },
        { sync: false }
    );

    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [voices, setVoices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);

    const loadProfile = useCallback(async () => {
        setLoading(true);
        try {
            const [p, cfg] = await Promise.all([getUserProfile(), getCloudTTSConfig()]);
            setProfile(p);
            if (cfg.available && cfg.voices?.length) setVoices(cfg.voices);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!CLOUD_ENABLED) return;
        const unsub = onAuthStateChange((u) => {
            setUser(u);
            if (u) loadProfile();
            else { setProfile(null); setVoices([]); }
        });
        return unsub;
    }, [loadProfile]);

    if (!CLOUD_ENABLED) {
        return (
            <div className='config-item'>
                <p className='text-sm text-default-500'>{t(`${BASE}.not_available`)}</p>
            </div>
        );
    }

    return (
        config !== null && (
            <>
                {!user ? (
                    <div className='flex flex-col gap-3'>
                        <p className='text-sm text-default-600'>{t(`${BASE}.sign_in_desc`)}</p>
                        <Button fullWidth variant='bordered' isLoading={authLoading}
                            onPress={() => { setAuthLoading(true); signInWithGoogle().catch(console.error).finally(() => setAuthLoading(false)); }}>
                            {t(`${BASE}.continue_google`)}
                        </Button>
                        <Button fullWidth variant='bordered' isLoading={authLoading}
                            onPress={() => { setAuthLoading(true); signInWithGitHub().catch(console.error).finally(() => setAuthLoading(false)); }}>
                            {t(`${BASE}.continue_github`)}
                        </Button>
                    </div>
                ) : (
                    <div className='flex flex-col gap-4'>
                        {/* Account info */}
                        <div className='flex items-center justify-between'>
                            <div className='flex flex-col gap-0.5'>
                                <p className='text-sm font-medium'>{user.email}</p>
                                {profile && (
                                    <Chip size='sm' variant='flat' color='primary' className='capitalize'>
                                        {profile.plan ?? 'trial'}
                                    </Chip>
                                )}
                            </div>
                            <SignOutButton label={t(`${BASE}.sign_out`)} />
                        </div>

                        {/* Voice selector */}
                        {voices.length > 0 && (
                            <Select
                                label={t(`${BASE}.voice`)}
                                labelPlacement='outside'
                                variant='bordered'
                                classNames={{ label: 'text-xs text-default-500 pb-1' }}
                                selectedKeys={[config.voiceId ?? 'auto']}
                                onSelectionChange={(keys) => {
                                    const v = [...keys][0] ?? 'auto';
                                    setConfig({ ...config, voiceId: v });
                                }}
                            >
                                {voices.map(v => (
                                    <SelectItem key={v.id} value={v.id}>
                                        {v.label}
                                    </SelectItem>
                                ))}
                            </Select>
                        )}

                        {/* TTS Quota */}
                        {profile && (() => {
                            const limit = profile.plan_tts_chars_limit ?? 0;
                            const used  = profile.tts_chars_used ?? 0;
                            if (limit === 0) return null;
                            const isUnlimited = limit === -1;
                            const pct = isUnlimited ? 0 : used / limit;
                            return (
                                <div className='flex flex-col gap-1.5'>
                                    <div className='flex items-center justify-between text-xs text-default-500'>
                                        <span>{t(`${BASE}.tts_usage`)}</span>
                                        {isUnlimited
                                            ? <span className='font-mono'>{fmtChars(used)} {t(`${BASE}.chars_label`)}</span>
                                            : <span className='font-mono'>{fmtChars(used)} / {fmtChars(limit)} {t(`${BASE}.chars_label`)}</span>
                                        }
                                    </div>
                                    {!isUnlimited && (
                                        <Progress size='sm' value={used} maxValue={limit}
                                            color={pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warning' : 'primary'} />
                                    )}
                                    {!isUnlimited && used >= limit && (
                                        <p className='text-xs text-danger'>
                                            {t(`${BASE}.quota_reached`)}{' '}
                                            <span className='cursor-pointer underline' onClick={() => open('https://transkit.app/pricing')}>
                                                {t(`${BASE}.upgrade_plan`)}
                                            </span>
                                        </p>
                                    )}
                                </div>
                            );
                        })()}

                        {loading && <p className='text-xs text-default-400'>{t(`${BASE}.loading_usage`)}</p>}

                        <p className='text-xs text-default-400'>{t(`${BASE}.auto_provider_note`)}</p>
                    </div>
                )}

                <div className='mt-2'>
                    <Button fullWidth color='primary' onPress={() => {
                        setConfig(config, true);
                        updateServiceList(instanceKey);
                        onClose();
                    }}>
                        {t('common.save')}
                    </Button>
                </div>
            </>
        )
    );
}
