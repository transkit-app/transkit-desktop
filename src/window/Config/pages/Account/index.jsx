import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Avatar, Card, CardBody, Chip, Progress } from '@nextui-org/react'
import { FaGoogle, FaGithub } from 'react-icons/fa'
import { MdLogout, MdSync, MdPerson, MdCloudDone, MdMic, MdVolumeUp, MdAutoAwesome } from 'react-icons/md'
import { open as openBrowser } from '@tauri-apps/api/shell'
import toast, { Toaster } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  signInWithGoogle,
  signInWithGitHub,
  signOut,
  getUser,
  getUserProfile,
  updateUserProfile,
  onAuthStateChange,
  CLOUD_ENABLED,
} from '../../../../lib/transkit-cloud'
import { useConfig } from '../../../../hooks'

const PRICING_URL = 'https://transkit.app/pricing'

// ─── Constants ────────────────────────────────────────────────────────────────

const EXPERIENCE_LEVELS = ['Junior', 'Mid', 'Senior', 'Lead', 'Expert']

// ─── Tag Input ────────────────────────────────────────────────────────────────

function TagInput({ tags, onChange, placeholder }) {
  const [draft, setDraft] = useState('')

  const commitDraft = () => {
    const trimmed = draft.trim()
    if (!trimmed) return
    onChange([...(tags ?? []), ...trimmed.split(',').map(s => s.trim()).filter(Boolean)])
    setDraft('')
  }

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
          if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commitDraft() }
          if (e.key === 'Backspace' && !draft && (tags ?? []).length) onChange((tags ?? []).slice(0, -1))
        }}
        onBlur={commitDraft}
        placeholder={(tags ?? []).length === 0 ? placeholder : ''}
        className='flex-1 min-w-[80px] bg-transparent text-sm text-foreground placeholder:text-default-400 outline-none'
      />
    </div>
  )
}

// ─── Profile Form ─────────────────────────────────────────────────────────────
// authUser  — supabase User object when logged in, null otherwise
// cloudProfile — latest cloud profile data for syncing

function ProfileForm({ authUser, cloudProfile, onCloudSynced }) {
  const { t } = useTranslation()
  const [localProfile, setLocalProfile] = useConfig('user_profile', {})
  const saveTimerRef = useRef(null)
  const [syncStatus, setSyncStatus] = useState(null) // null | 'saving' | 'saved'

  const update = (patch) => {
    const next = { ...(localProfile ?? {}), ...patch }
    setLocalProfile(next)

    // When logged in, debounce-save to cloud
    if (authUser) {
      clearTimeout(saveTimerRef.current)
      setSyncStatus('saving')
      saveTimerRef.current = setTimeout(async () => {
        try {
          await updateUserProfile({
            full_name: next.name ?? null,
            role: next.role ?? null,
            company: next.company ?? null,
            experience_level: next.experienceLevel ?? null,
            expertise: next.expertise?.length ? next.expertise : null,
            notes: next.notes ?? null,
          })
          setSyncStatus('saved')
          setTimeout(() => setSyncStatus(null), 2000)
        } catch {
          setSyncStatus(null)
        }
      }, 800)
    }
  }

  // Pull all cloud profile fields into local config
  const handlePullFromCloud = () => {
    if (!cloudProfile) return
    const patch = {
      name: cloudProfile.full_name ?? localProfile?.name ?? '',
      role: cloudProfile.role ?? localProfile?.role ?? '',
      company: cloudProfile.company ?? localProfile?.company ?? '',
      experienceLevel: cloudProfile.experience_level ?? localProfile?.experienceLevel ?? '',
      expertise: cloudProfile.expertise ?? localProfile?.expertise ?? [],
      notes: cloudProfile.notes ?? localProfile?.notes ?? '',
    }
    setLocalProfile({ ...(localProfile ?? {}), ...patch })
    onCloudSynced?.()
    toast.success('Pulled profile from cloud')
  }

  useEffect(() => () => clearTimeout(saveTimerRef.current), [])

  const p = localProfile ?? {}
  const hasCloudData = cloudProfile && (
    cloudProfile.full_name || cloudProfile.role || cloudProfile.company ||
    cloudProfile.experience_level || cloudProfile.expertise?.length || cloudProfile.notes
  )

  return (
    <div className='flex flex-col gap-4'>
      {/* Header row */}
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <MdPerson className='text-[18px] text-primary' />
          <p className='text-sm font-semibold'>{t('config.profile.title')}</p>
        </div>
        <div className='flex items-center gap-2'>
          {syncStatus === 'saving' && (
            <span className='text-xs text-default-400'>Saving…</span>
          )}
          {syncStatus === 'saved' && (
            <span className='flex items-center gap-1 text-xs text-brand-500'>
              <MdCloudDone className='text-sm' /> Saved
            </span>
          )}
          {authUser && hasCloudData && (
            <button
              onClick={handlePullFromCloud}
              className='flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors'
            >
              <MdSync className='text-sm' />
              Sync
            </button>
          )}
        </div>
      </div>

      <p className='text-xs text-default-400 -mt-2'>{t('config.profile.hint')}</p>

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

      {/* Notes */}
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
    </div>
  )
}

// ─── Cloud Plan Card ──────────────────────────────────────────────────────────

const PLAN_BADGE_COLOR = { trial: 'warning', starter: 'primary', pro: 'success' }

function ServiceRow({ icon, label, used, limit, unlimited, comingSoon, t }) {
  if (comingSoon) {
    return (
      <div className='flex items-center justify-between py-0.5'>
        <div className='flex items-center gap-2'>
          <span className='text-default-400'>{icon}</span>
          <span className='text-xs text-default-500'>{label}</span>
        </div>
        <Chip size='sm' variant='flat' className='text-default-400 bg-content3'>{t('config.account.coming_soon')}</Chip>
      </div>
    )
  }

  if (unlimited) {
    return (
      <div className='flex items-center justify-between py-0.5'>
        <div className='flex items-center gap-2'>
          <span className='text-foreground'>{icon}</span>
          <span className='text-xs font-medium'>{label}</span>
        </div>
        <Chip size='sm' variant='flat' color='success'>{t('config.account.unlimited')}</Chip>
      </div>
    )
  }

  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const color = pct >= 90 ? 'danger' : pct >= 70 ? 'warning' : 'primary'
  const usedMin = Math.floor(used / 60)
  const limitMin = Math.floor(limit / 60)

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <span className={pct >= 90 ? 'text-danger' : 'text-foreground'}>{icon}</span>
          <span className='text-xs font-medium'>{label}</span>
        </div>
        <span className={`text-xs font-mono ${pct >= 90 ? 'text-danger' : pct >= 70 ? 'text-warning-600 dark:text-warning-400' : 'text-default-500'}`}>
          {t('config.account.usage_minutes', { used: usedMin, limit: limitMin })}
        </span>
      </div>
      <Progress size='sm' value={pct} maxValue={100} color={color} aria-label={label} />
      {pct >= 100 && (
        <p className='text-xs text-danger'>{t('config.account.quota_full')}</p>
      )}
      {pct >= 70 && pct < 100 && (
        <p className='text-xs text-warning-600 dark:text-warning-400'>{t('config.account.quota_low')}</p>
      )}
    </div>
  )
}

function CloudPlanCard({ profile }) {
  const { t } = useTranslation()
  const plan = profile.plan ?? 'trial'
  const badgeColor = PLAN_BADGE_COLOR[plan] ?? 'default'
  const planLabel = t(`config.account.plan_badge_${plan}`, { defaultValue: plan })
  const isUnlimited = profile.trial_limit_seconds === -1
  const isUpgradeable = plan === 'trial' || plan === 'starter'

  return (
    <Card>
      <CardBody className='flex flex-col gap-3 pb-3'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <p className='text-xs font-semibold text-default-500 uppercase tracking-wider'>
            {t('config.account.plan_section_title')}
          </p>
          <Chip size='sm' variant='flat' color={badgeColor} className='capitalize font-medium'>
            {planLabel}
          </Chip>
        </div>

        {/* Services */}
        <div className='flex flex-col gap-3'>
          <ServiceRow
            icon={<MdMic className='text-base' />}
            label={t('config.account.stt_label')}
            used={profile.trial_seconds_used}
            limit={profile.trial_limit_seconds}
            unlimited={isUnlimited}
            comingSoon={false}
            t={t}
          />
          <ServiceRow
            icon={<MdVolumeUp className='text-base' />}
            label={t('config.account.tts_label')}
            comingSoon
            t={t}
          />
          <ServiceRow
            icon={<MdAutoAwesome className='text-base' />}
            label={t('config.account.ai_label')}
            comingSoon
            t={t}
          />
        </div>

        {/* Upgrade CTA */}
        {isUpgradeable && (
          <div className='flex items-center justify-between pt-2 border-t border-content3 mt-1'>
            <p className='text-xs text-default-500'>
              {t(`config.account.upgrade_cta_${plan}`)}
            </p>
            <button
              onClick={() => openBrowser(PRICING_URL)}
              className='text-xs font-medium text-primary hover:text-primary-600 transition-colors'
            >
              {t('config.account.view_plans')}
            </button>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

// ─── Guest view (not logged in) ───────────────────────────────────────────────

function GuestView() {
  const { t } = useTranslation()
  const [loading, setLoading] = useState(null)

  const handleLogin = async (provider) => {
    setLoading(provider)
    try {
      if (provider === 'google') await signInWithGoogle()
      else await signInWithGitHub()
    } catch (err) {
      console.error('Login error:', err)
      toast.error('Sign in failed. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* Transkit Cloud sign-in */}
      <Card>
        <CardBody className='flex flex-col gap-4'>
          <div className='flex items-center gap-3'>
            <div className='flex-1 h-px bg-content3' />
            <span className='text-xs text-default-400 font-medium whitespace-nowrap'>Transkit Cloud</span>
            <div className='flex-1 h-px bg-content3' />
          </div>

          <div>
            <h2 className='text-sm font-semibold mb-1'>Sign in to Transkit</h2>
            <p className='text-xs text-default-500'>
              {t('config.account.sign_in_description')}
            </p>
          </div>

          <div className='grid grid-cols-2 gap-2.5'>
            <Button
              variant='bordered'
              startContent={<FaGoogle className='text-[#4285F4]' />}
              className='w-full justify-center gap-2 h-10'
              isLoading={loading === 'google'}
              isDisabled={!!loading}
              onPress={() => handleLogin('google')}
            >
              Google
            </Button>
            <Button
              variant='bordered'
              startContent={<FaGithub />}
              className='w-full justify-center gap-2 h-10'
              isLoading={loading === 'github'}
              isDisabled={!!loading}
              onPress={() => handleLogin('github')}
            >
              GitHub
            </Button>
          </div>

          <p className='text-xs text-default-400 text-center'>
            No password needed. Your data is end-to-end secured.
          </p>
        </CardBody>
      </Card>

      {/* Profile form */}
      <Card>
        <CardBody>
          <ProfileForm authUser={null} cloudProfile={null} />
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Logged-in dashboard ──────────────────────────────────────────────────────

function AccountDashboard({ user, cloudProfile, onSignOut }) {
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      onSignOut()
    } catch {
      toast.error('Sign out failed.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className='flex flex-col gap-4'>
      {/* User info */}
      <Card>
        <CardBody className='flex flex-row items-center gap-3'>
          <Avatar
            src={user?.user_metadata?.avatar_url}
            name={user?.email?.[0]?.toUpperCase()}
            size='md'
            className='flex-shrink-0'
          />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium truncate'>
              {user?.user_metadata?.full_name || user?.email}
            </p>
            <p className='text-xs text-default-400 truncate'>{user?.email}</p>
          </div>
          <Button
            variant='light'
            color='danger'
            size='sm'
            startContent={<MdLogout className='text-base' />}
            isLoading={signingOut}
            onPress={handleSignOut}
            className='flex-shrink-0'
          >
            Sign out
          </Button>
        </CardBody>
      </Card>

      {/* Transkit Cloud plan & quota */}
      {cloudProfile && <CloudPlanCard profile={cloudProfile} />}

      {/* Profile form — auto-saves to cloud */}
      <Card>
        <CardBody>
          <ProfileForm authUser={user} cloudProfile={cloudProfile} />
        </CardBody>
      </Card>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Account() {
  const [user, setUser] = useState(null)
  const [cloudProfile, setCloudProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    const p = await getUserProfile()
    setCloudProfile(p)
  }, [])

  useEffect(() => {
    getUser().then((u) => {
      setUser(u)
      if (u) refreshProfile()
      setLoading(false)
    })

    const unsub = onAuthStateChange((u) => {
      setUser(u)
      if (u) refreshProfile()
      else setCloudProfile(null)
    })

    // Refresh trial usage when the Config window regains focus
    // (e.g. after a Monitor session ends)
    const onFocus = () => {
      if (user) refreshProfile()
    }
    window.addEventListener('focus', onFocus)

    return () => {
      unsub()
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshProfile, user])

  if (!CLOUD_ENABLED) {
    return (
      <div className='page-wrapper'>
        <Card>
          <CardBody className='flex flex-col gap-3 py-6'>
            <div className='flex items-center gap-2 text-default-500'>
              <MdCloudDone className='text-2xl' />
              <h2 className='text-sm font-semibold'>Cloud not configured</h2>
            </div>
            <p className='text-xs text-default-400 leading-relaxed'>
              This build was compiled without Supabase credentials. Cloud features
              (sign-in, Soniox trial) are unavailable. Your local profile is stored
              on this device only.
            </p>
            <p className='text-xs text-default-400'>
              To enable cloud: add <code className='bg-content3 px-1 rounded'>VITE_SUPABASE_URL</code> and{' '}
              <code className='bg-content3 px-1 rounded'>VITE_SUPABASE_ANON_KEY</code> to <code className='bg-content3 px-1 rounded'>.env</code> and rebuild.
            </p>
          </CardBody>
        </Card>
        <Card className='mt-4'>
          <CardBody>
            <ProfileForm authUser={null} cloudProfile={null} />
          </CardBody>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className='flex items-center justify-center h-40'>
        <div className='w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin' />
      </div>
    )
  }

  return (
    <div className='page-wrapper'>
      <Toaster />
      {user ? (
        <AccountDashboard
          user={user}
          cloudProfile={cloudProfile}
          onSignOut={() => { setUser(null); setCloudProfile(null) }}
        />
      ) : (
        <GuestView />
      )}
    </div>
  )
}
