import { Button, Progress, Chip } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { open } from '@tauri-apps/api/shell';
import React, { useState, useEffect, useCallback } from 'react';
import { SignOutButton } from '../../../components/SignOutButton';

import { INSTANCE_NAME_CONFIG_KEY } from '../../../utils/service_instance';
import { useConfig } from '../../../hooks/useConfig';
import {
    CLOUD_ENABLED,
    getUserProfile,
    signInWithGoogle,
    signInWithGitHub,
    onAuthStateChange,
} from '../../../lib/transkit-cloud';

const BASE = 'services.ai.transkit_cloud_ai';

export function Config({ instanceKey, updateServiceList, onClose }) {
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        { [INSTANCE_NAME_CONFIG_KEY]: t(`${BASE}.title`) },
        { sync: false }
    );

    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [authLoading, setAuthLoading] = useState(false);

    const loadProfile = useCallback(async () => {
        setLoading(true);
        try {
            const p = await getUserProfile();
            setProfile(p);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!CLOUD_ENABLED) return;
        const unsub = onAuthStateChange((u) => {
            setUser(u);
            if (u) loadProfile();
            else setProfile(null);
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

                        {/* AI request quota */}
                        {profile && (() => {
                            const limit = profile.plan_ai_requests_limit ?? 0;
                            const used  = profile.ai_requests_used ?? 0;
                            if (limit === 0) return null;
                            const isUnlimited = limit === -1;
                            const pct = isUnlimited ? 0 : used / limit;
                            return (
                                <div className='flex flex-col gap-1.5'>
                                    <div className='flex items-center justify-between text-xs text-default-500'>
                                        <span>{t(`${BASE}.ai_usage`)}</span>
                                        {isUnlimited
                                            ? <span className='font-mono'>{used} {t(`${BASE}.requests_label`)}</span>
                                            : <span className='font-mono'>{used} / {limit} {t(`${BASE}.requests_label`)}</span>
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

                        {/* Informational note — no model config exposed */}
                        <p className='text-xs text-default-400'>{t(`${BASE}.powered_by_note`)}</p>
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
