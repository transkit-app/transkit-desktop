import React, { useState, useEffect, useCallback, useRef, memo } from 'react'
import { Button, Avatar, Card, CardBody, Chip, Progress, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, useDisclosure } from '@nextui-org/react'
import { FaGoogle, FaGithub } from 'react-icons/fa'
import { MdLogout, MdSync, MdPerson, MdCloudDone, MdMic, MdVolumeUp, MdAutoAwesome, MdTranslate } from 'react-icons/md'
import { open as openBrowser } from '@tauri-apps/api/shell'
import toast, { Toaster } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import {
  signInWithGoogle,
  signInWithGitHub,
  signOut,
  getUser,
  getSession,
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

const ServiceRow = memo(function ServiceRow({ icon, label, used, limit, unlimited, comingSoon, unit = 'minutes', t }) {
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

  const fmt = (n) => {
    if (unit === 'minutes') {
      return (n / 60).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })
    }
    if (unit === 'chars') {
      return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
    }
    return String(n)
  }

  const unitLabel = unit === 'minutes' ? t('config.account.unit_min')
    : unit === 'chars' ? t('config.account.unit_chars')
    : t('config.account.unit_requests')

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-2'>
          <span className={pct >= 90 ? 'text-danger' : 'text-foreground'}>{icon}</span>
          <span className='text-xs font-medium'>{label}</span>
        </div>
        <span className={`text-xs font-mono ${pct >= 90 ? 'text-danger' : pct >= 70 ? 'text-warning-600 dark:text-warning-400' : 'text-default-500'}`}>
          {fmt(used)} / {fmt(limit)} {unitLabel}
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
})

function CloudPlanCard({ profile, usage, onRefresh }) {
  const { t } = useTranslation()
  const [refreshing, setRefreshing] = useState(false)
  const plan = profile.plan ?? 'trial'
  const badgeColor = PLAN_BADGE_COLOR[plan] ?? 'default'
  const planLabel = t(`config.account.plan_badge_${plan}`, { defaultValue: plan })
  const sttLimit      = profile.plan_stt_limit
  const ttsLimit      = profile.plan_tts_chars_limit ?? 0
  const aiLimit       = profile.plan_ai_requests_limit ?? 0
  const translateLimit= profile.plan_translate_requests_limit ?? 0
  const isUpgradeable = plan === 'trial' || plan === 'starter'

  const handleRefresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    try { await onRefresh?.() } finally { setRefreshing(false) }
  }

  return (
    <Card>
      <CardBody className='flex flex-col gap-3 pb-3'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-1.5'>
            <p className='text-xs font-semibold text-default-500 uppercase tracking-wider'>
              {t('config.account.plan_section_title')}
            </p>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className='text-default-400 hover:text-default-600 transition-colors disabled:opacity-50'
              title='Refresh usage'
            >
              <MdSync className={`text-sm ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <Chip size='sm' variant='flat' color={badgeColor} className='capitalize font-medium'>
            {planLabel}
          </Chip>
        </div>

        {/* Services */}
        <div className='flex flex-col gap-3'>
          {/* STT */}
          <ServiceRow
            icon={<MdMic className='text-base' />}
            label={t('config.account.stt_label')}
            used={usage.stt}
            limit={sttLimit}
            unlimited={sttLimit === -1}
            unit='minutes'
            t={t}
          />

          {/* TTS */}
          {ttsLimit !== 0 ? (
            <ServiceRow
              icon={<MdVolumeUp className='text-base' />}
              label={t('config.account.tts_label')}
              used={usage.tts}
              limit={ttsLimit}
              unlimited={ttsLimit === -1}
              unit='chars'
              t={t}
            />
          ) : (
            <ServiceRow icon={<MdVolumeUp className='text-base' />} label={t('config.account.tts_label')} comingSoon t={t} />
          )}

          {/* AI */}
          {aiLimit !== 0 ? (
            <ServiceRow
              icon={<MdAutoAwesome className='text-base' />}
              label={t('config.account.ai_label')}
              used={usage.ai}
              limit={aiLimit}
              unlimited={aiLimit === -1}
              unit='requests'
              t={t}
            />
          ) : (
            <ServiceRow icon={<MdAutoAwesome className='text-base' />} label={t('config.account.ai_label')} comingSoon t={t} />
          )}

          {/* Translate */}
          {translateLimit !== 0 ? (
            <ServiceRow
              icon={<MdTranslate className='text-base' />}
              label={t('config.account.translate_label')}
              used={usage.translate}
              limit={translateLimit}
              unlimited={translateLimit === -1}
              unit='requests'
              t={t}
            />
          ) : (
            <ServiceRow icon={<MdTranslate className='text-base' />} label={t('config.account.translate_label')} comingSoon t={t} />
          )}
        </div>

        {/* Informational note about underlying models */}
        <p className='text-[10px] text-default-400 border-t border-content3 pt-2 mt-1'>
          {t('config.account.powered_by_note')}
        </p>

        {/* Upgrade CTA */}
        {isUpgradeable && (
          <div className='flex items-center justify-between border-t border-content3 mt-1 pt-2'>
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

function AccountDashboard({ user, cloudProfile, cloudUsage, onRefreshUsage, onSignOut }) {
  const [signingOut, setSigningOut] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()

  const handleSignOut = async () => {
    onClose()
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
            onPress={onOpen}
            className='flex-shrink-0'
          >
            Sign out
          </Button>
        </CardBody>
      </Card>

      {/* Transkit Cloud plan & quota */}
      {cloudProfile && cloudUsage && <CloudPlanCard profile={cloudProfile} usage={cloudUsage} onRefresh={onRefreshUsage} />}

      {/* Profile form — auto-saves to cloud */}
      <Card>
        <CardBody>
          <ProfileForm authUser={user} cloudProfile={cloudProfile} />
        </CardBody>
      </Card>

      {/* Sign-out confirmation modal */}
      <Modal isOpen={isOpen} onClose={onClose} size='sm'>
        <ModalContent>
          <ModalHeader className='text-sm font-semibold'>Sign out?</ModalHeader>
          <ModalBody>
            <p className='text-xs text-default-500'>
              You will be signed out on this device. Other sessions will remain active.
            </p>
          </ModalBody>
          <ModalFooter className='gap-2'>
            <Button size='sm' variant='flat' onPress={onClose}>Cancel</Button>
            <Button size='sm' color='danger' onPress={handleSignOut}>Sign out</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

const FOCUS_REFRESH_COOLDOWN_MS = 30_000 // min 30s between focus-triggered refreshes

// Extract usage counters from a profile object into a stable shape
function extractUsage(p) {
  return {
    stt:      p.stt_seconds_used         ?? 0,
    tts:      p.tts_chars_used           ?? 0,
    ai:       p.ai_requests_used         ?? 0,
    translate: p.translate_requests_used ?? 0,
  }
}

export default function Account() {
  const [user, setUser] = useState(null)
  const [cloudProfile, setCloudProfile] = useState(null)
  // Usage counters are kept in separate state so polling only re-renders
  // the ServiceRow components — not the whole plan card structure.
  const [cloudUsage, setCloudUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const lastFetchRef = useRef(0)
  // Track user in a ref so the focus handler doesn't need user in deps
  const userRef = useRef(null)

  const applyProfile = useCallback((p, { usageOnly = false } = {}) => {
    if (!p) return
    if (!usageOnly) setCloudProfile(p)
    setCloudUsage(prev => {
      const next = extractUsage(p)
      // Skip state update if nothing changed to avoid re-renders
      if (prev &&
          prev.stt === next.stt &&
          prev.tts === next.tts &&
          prev.ai === next.ai &&
          prev.translate === next.translate) return prev
      return next
    })
    lastFetchRef.current = Date.now()
  }, [])

  // Full fetch: updates both plan structure and usage counters
  const refreshProfile = useCallback(async () => {
    const p = await getUserProfile()
    if (p) applyProfile(p)
  }, [applyProfile])

  // Lightweight focus refresh: same fetch but only updates usage counters
  const refreshUsage = useCallback(async () => {
    const p = await getUserProfile()
    if (p) applyProfile(p, { usageOnly: true })
  }, [applyProfile])

  // Auth + initial load (runs once; does not re-run when user object changes)
  useEffect(() => {
    getUser().then(async (u) => {
      if (!u) {
        // Distinguish "never logged in" from "token expired/invalid"
        const session = await getSession()
        if (session) {
          // Had a session but server rejected it — force clean logout
          await signOut()
          toast.error(t('config.account.session_expired'))
        }
      }
      userRef.current = u
      setUser(u)
      if (u) refreshProfile()
      setLoading(false)
    })

    const unsub = onAuthStateChange((u) => {
      userRef.current = u
      setUser(u)
      if (u) refreshProfile()
      else { setCloudProfile(null); setCloudUsage(null) }
    })

    return () => unsub()
  }, [refreshProfile])

  // Focus listener uses userRef — no user in deps, no re-subscription on token refresh
  useEffect(() => {
    const onFocus = () => {
      if (!userRef.current) return
      const now = Date.now()
      if (now - lastFetchRef.current < FOCUS_REFRESH_COOLDOWN_MS) return
      refreshUsage()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshUsage])

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
          cloudUsage={cloudUsage}
          onRefreshUsage={refreshUsage}
          onSignOut={() => { userRef.current = null; setUser(null); setCloudProfile(null); setCloudUsage(null) }}
        />
      ) : (
        <GuestView />
      )}
    </div>
  )
}
