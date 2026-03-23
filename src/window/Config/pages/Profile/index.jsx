import { Card, CardBody, CardHeader } from '@nextui-org/react';
import { useTranslation } from 'react-i18next';
import { MdPerson, MdSync } from 'react-icons/md';
import React from 'react';
import { useConfig } from '../../../../hooks';
import { getUser, onAuthStateChange } from '../../../../lib/transkit-cloud';

const EXPERIENCE_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead', 'Expert'];

function TagInput({ tags, onChange, placeholder }) {
    const [draft, setDraft] = React.useState('');

    const commitDraft = () => {
        const trimmed = draft.trim();
        if (!trimmed) return;
        onChange([...(tags ?? []), ...trimmed.split(',').map(s => s.trim()).filter(Boolean)]);
        setDraft('');
    };

    return (
        <div className='flex flex-wrap gap-1.5 p-2 bg-content2 rounded-lg border border-content3/50 focus-within:border-primary/60 min-h-[38px]'>
            {(tags ?? []).map((tag, i) => (
                <span key={i} className='flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-0.5 rounded-full'>
                    {tag}
                    <button
                        onClick={() => onChange((tags ?? []).filter((_, idx) => idx !== i))}
                        className='text-primary/60 hover:text-danger transition-colors ml-0.5 leading-none'
                    >
                        ×
                    </button>
                </span>
            ))}
            <input
                value={draft}
                onChange={e => setDraft(e.target.value)}
                onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitDraft(); }
                    if (e.key === 'Backspace' && !draft && (tags ?? []).length) onChange((tags ?? []).slice(0, -1));
                }}
                onBlur={commitDraft}
                placeholder={(tags ?? []).length === 0 ? placeholder : ''}
                className='flex-1 min-w-[80px] bg-transparent text-sm text-foreground placeholder:text-default-400 outline-none'
            />
        </div>
    );
}

export default function Profile() {
    const { t } = useTranslation();
    const [profile, setProfile] = useConfig('user_profile', {});
    const [authUser, setAuthUser] = React.useState(null);

    React.useEffect(() => {
        getUser().then(setAuthUser);
        const unsub = onAuthStateChange(setAuthUser);
        return unsub;
    }, []);

    const update = (patch) => setProfile({ ...(profile ?? {}), ...patch });
    const p = profile ?? {};

    return (
        <div className='config-page flex flex-col gap-4 p-1'>
            <Card>
                <CardHeader className='flex gap-2 items-center pb-0'>
                    <MdPerson className='text-[20px] text-primary' />
                    <p className='text-sm font-semibold'>{t('config.profile.title')}</p>
                </CardHeader>
                <CardBody className='flex flex-col gap-4'>
                    <p className='text-xs text-default-400'>{t('config.profile.hint')}</p>

                    {/* Sync from account — only shown when logged in */}
                    {authUser && (
                        <div className='flex items-center justify-between p-3 rounded-lg bg-brand-500/5 border border-brand-500/20'>
                            <div className='flex items-center gap-2 min-w-0'>
                                {authUser.user_metadata?.avatar_url && (
                                    <img
                                        src={authUser.user_metadata.avatar_url}
                                        alt=''
                                        className='w-6 h-6 rounded-full flex-shrink-0'
                                    />
                                )}
                                <span className='text-xs text-default-600 truncate'>
                                    {authUser.user_metadata?.full_name || authUser.email}
                                </span>
                            </div>
                            <button
                                onClick={() => {
                                    const name = authUser.user_metadata?.full_name;
                                    if (name && !p.name) update({ name });
                                }}
                                className='flex items-center gap-1.5 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 flex-shrink-0 ml-2 transition-colors'
                            >
                                <MdSync className='text-base' />
                                Sync name
                            </button>
                        </div>
                    )}

                    <div className='grid grid-cols-2 gap-3'>
                        {/* Name */}
                        <div className='flex flex-col gap-1'>
                            <label className='text-xs font-medium text-default-600'>{t('config.profile.name')}</label>
                            <input
                                value={p.name ?? ''}
                                onChange={e => update({ name: e.target.value })}
                                placeholder={t('config.profile.name_placeholder')}
                                className='bg-content2 text-sm rounded-lg px-3 py-2 border border-content3/50 text-foreground placeholder:text-default-400 outline-none focus:border-primary/60 transition-colors'
                            />
                        </div>

                        {/* Role */}
                        <div className='flex flex-col gap-1'>
                            <label className='text-xs font-medium text-default-600'>{t('config.profile.role')}</label>
                            <input
                                value={p.role ?? ''}
                                onChange={e => update({ role: e.target.value })}
                                placeholder={t('config.profile.role_placeholder')}
                                className='bg-content2 text-sm rounded-lg px-3 py-2 border border-content3/50 text-foreground placeholder:text-default-400 outline-none focus:border-primary/60 transition-colors'
                            />
                        </div>

                        {/* Company */}
                        <div className='flex flex-col gap-1'>
                            <label className='text-xs font-medium text-default-600'>{t('config.profile.company')}</label>
                            <input
                                value={p.company ?? ''}
                                onChange={e => update({ company: e.target.value })}
                                placeholder={t('config.profile.company_placeholder')}
                                className='bg-content2 text-sm rounded-lg px-3 py-2 border border-content3/50 text-foreground placeholder:text-default-400 outline-none focus:border-primary/60 transition-colors'
                            />
                        </div>

                        {/* Experience Level */}
                        <div className='flex flex-col gap-1'>
                            <label className='text-xs font-medium text-default-600'>{t('config.profile.experience_level')}</label>
                            <select
                                value={p.experienceLevel ?? ''}
                                onChange={e => update({ experienceLevel: e.target.value })}
                                className='bg-content2 text-sm rounded-lg px-3 py-2 border border-content3/50 text-foreground outline-none focus:border-primary/60 transition-colors cursor-pointer'
                            >
                                <option value=''>{t('config.profile.experience_placeholder')}</option>
                                {EXPERIENCE_LEVELS.map(level => (
                                    <option key={level} value={level}>{level}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Expertise domains */}
                    <div className='flex flex-col gap-1'>
                        <label className='text-xs font-medium text-default-600'>{t('config.profile.expertise')}</label>
                        <TagInput
                            tags={p.expertise ?? []}
                            onChange={tags => update({ expertise: tags })}
                            placeholder={t('config.profile.expertise_placeholder')}
                        />
                        <p className='text-xs text-default-400'>{t('config.profile.expertise_hint')}</p>
                    </div>

                    {/* Bio / Notes */}
                    <div className='flex flex-col gap-1'>
                        <label className='text-xs font-medium text-default-600'>{t('config.profile.notes')}</label>
                        <textarea
                            value={p.notes ?? ''}
                            onChange={e => update({ notes: e.target.value })}
                            placeholder={t('config.profile.notes_placeholder')}
                            rows={3}
                            className='bg-content2 text-sm rounded-lg px-3 py-2 border border-content3/50 text-foreground placeholder:text-default-400 outline-none focus:border-primary/60 transition-colors resize-none'
                        />
                    </div>

                    {/* Preview */}
                    {(p.name || p.role || p.company || (p.expertise ?? []).length > 0) && (
                        <div className='p-3 bg-primary/5 border border-primary/20 rounded-lg'>
                            <p className='text-xs font-semibold text-primary mb-1'>{t('config.profile.preview_label')}</p>
                            <p className='text-xs text-default-600 leading-relaxed'>
                                {[p.name, p.role, p.company].filter(Boolean).join(' · ')}
                                {(p.expertise ?? []).length > 0 && ` | ${p.expertise.join(', ')}`}
                                {p.experienceLevel && ` (${p.experienceLevel})`}
                            </p>
                        </div>
                    )}
                </CardBody>
            </Card>
        </div>
    );
}
