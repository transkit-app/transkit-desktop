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

const BASE = 'services.transcription.transkit_cloud_stt';

// Convert seconds → minutes with 1 decimal when not a whole number, locale separators.
// e.g. 90 → "1.5", 3600 → "60", 18000 → "300"
function fmtMin(seconds) {
    const min = seconds / 60;
    return min.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 });
}

export function Config(props) {
    const { instanceKey, updateServiceList, onClose } = props;
    const { t } = useTranslation();

    const [config, setConfig] = useConfig(
        instanceKey,
        {
            [INSTANCE_NAME_CONFIG_KEY]: t(`${BASE}.title`),
            endpointing: 0.3,
            speechThreshold: 0.3,
        },
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
                    // ── Not logged in ──────────────────────────────────────────
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
                    // ── Logged in ──────────────────────────────────────────────
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

                        {/* STT Quota */}
                        {profile && (() => {
                            const limit = profile.plan_stt_limit;
                            const used  = profile.stt_seconds_used;
                            const isUnlimited = limit === -1;
                            const pct  = isUnlimited ? 0 : used / limit;
                            return (
                                <div className='flex flex-col gap-1.5'>
                                    <div className='flex items-center justify-between text-xs text-default-500'>
                                        <span>{t(`${BASE}.stt_usage`)}</span>
                                        {isUnlimited
                                            ? <span className='font-mono'>{fmtMin(used)} {t(`${BASE}.min_label`)}</span>
                                            : <span className='font-mono'>{fmtMin(used)} / {fmtMin(limit)} {t(`${BASE}.min_label`)}</span>
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
                                            </span>{' '}
                                            {t(`${BASE}.quota_reached_hint`)}
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
                            {t(`${BASE}.auto_provider_note`)}
                        </p>

                        {/* Advanced provider settings */}
                        <div className='flex flex-col gap-3 pt-1 border-t border-default-100'>
                            <p className='text-xs text-default-500 font-medium'>{t(`${BASE}.advanced_settings`)}</p>

                            {/* Endpointing */}
                            <div className='flex flex-col gap-1'>
                                <p className='text-sm'>{t(`${BASE}.endpointing`)}</p>
                                <div className='flex items-center gap-3'>
                                    <input
                                        type='range' min={0.1} max={3.0} step={0.1}
                                        value={config.endpointing ?? 0.3}
                                        onChange={e => setConfig({ ...config, endpointing: parseFloat(e.target.value) })}
                                        className='flex-1 accent-warning'
                                    />
                                    <span className='text-xs text-default-500 w-12 text-right font-mono'>
                                        {(config.endpointing ?? 0.3).toFixed(1)}s
                                    </span>
                                </div>
                                <p className='text-xs text-default-400'>{t(`${BASE}.endpointing_hint`)}</p>
                            </div>

                            {/* Speech threshold */}
                            <div className='flex flex-col gap-1'>
                                <p className='text-sm'>{t(`${BASE}.speech_threshold`)}</p>
                                <div className='flex items-center gap-3'>
                                    <input
                                        type='range' min={0.1} max={0.9} step={0.05}
                                        value={config.speechThreshold ?? 0.3}
                                        onChange={e => setConfig({ ...config, speechThreshold: parseFloat(e.target.value) })}
                                        className='flex-1 accent-warning'
                                    />
                                    <span className='text-xs text-default-500 w-12 text-right font-mono'>
                                        {(config.speechThreshold ?? 0.3).toFixed(2)}
                                    </span>
                                </div>
                                <p className='text-xs text-default-400'>{t(`${BASE}.speech_threshold_hint`)}</p>
                            </div>
                        </div>
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
