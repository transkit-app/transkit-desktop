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

const BASE = 'services.transcription.transkit_cloud_dictation';

function fmtSec(seconds) {
    if (seconds >= 60) {
        const min = seconds / 60;
        return min.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 }) + ' min';
    }
    return Math.round(seconds) + ' s';
}

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
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

    const handleGoogle = async () => {
        setAuthLoading(true);
        try { await signInWithGoogle(); } catch (e) { console.error(e); }
        finally { setAuthLoading(false); }
    };

    const handleGitHub = async () => {
        setAuthLoading(true);
        try { await signInWithGitHub(); } catch (e) { console.error(e); }
        finally { setAuthLoading(false); }
    };

    const handleSave = () => {
        setConfig(config, true);
        updateServiceList(instanceKey);
        onClose();
    };

    if (!CLOUD_ENABLED) {
        return (
            <div className='config-item'>
                <p className='text-sm text-default-500'>
                    {t(`${BASE}.not_available`)}
                </p>
            </div>
        );
    }

    return (
        config !== null && (
            <>
                {!user ? (
                    <div className='flex flex-col gap-3'>
                        <p className='text-sm text-default-600'>
                            {t(`${BASE}.sign_in_desc`)}
                        </p>
                        <Button
                            fullWidth
                            variant='bordered'
                            isLoading={authLoading}
                            onPress={handleGoogle}
                        >
                            {t(`${BASE}.continue_google`)}
                        </Button>
                        <Button
                            fullWidth
                            variant='bordered'
                            isLoading={authLoading}
                            onPress={handleGitHub}
                        >
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

                        {/* Dictation Quota */}
                        {profile && (() => {
                            const limit = profile.plan_dictation_limit ?? 0;
                            const used  = profile.dictation_seconds_used ?? 0;
                            const isUnlimited = limit === -1;
                            const pct  = isUnlimited ? 0 : (limit > 0 ? used / limit : 1);
                            return (
                                <div className='flex flex-col gap-1.5'>
                                    <div className='flex items-center justify-between text-xs text-default-500'>
                                        <span>{t(`${BASE}.dictation_usage`)}</span>
                                        {isUnlimited
                                            ? <span className='font-mono'>{fmtSec(used)}</span>
                                            : <span className='font-mono'>{fmtSec(used)} / {fmtSec(limit)}</span>
                                        }
                                    </div>
                                    {!isUnlimited && (
                                        <Progress
                                            size='sm'
                                            value={used}
                                            maxValue={limit}
                                            color={pct >= 0.9 ? 'danger' : pct >= 0.7 ? 'warning' : 'primary'}
                                        />
                                    )}
                                    {!isUnlimited && used >= limit && (
                                        <p className='text-xs text-danger'>
                                            {t(`${BASE}.quota_reached`)}{' '}
                                            <span
                                                className='cursor-pointer underline'
                                                onClick={() => open('https://transkit.app/pricing')}
                                            >
                                                {t(`${BASE}.upgrade_plan`)}
                                            </span>
                                        </p>
                                    )}
                                </div>
                            );
                        })()}

                        {loading && (
                            <p className='text-xs text-default-400'>
                                {t(`${BASE}.loading_usage`)}
                            </p>
                        )}

                        <p className='text-xs text-default-400'>
                            {t(`${BASE}.use_case_note`)}
                        </p>
                    </div>
                )}

                <div className='mt-2'>
                    <Button fullWidth color='primary' onPress={handleSave}>
                        {t('common.save')}
                    </Button>
                </div>
            </>
        )
    );
}
