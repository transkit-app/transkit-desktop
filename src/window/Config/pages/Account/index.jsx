import React, { useState, useEffect, useCallback } from 'react'
import { Button, Avatar } from '@nextui-org/react'
import { FaGoogle, FaGithub } from 'react-icons/fa'
import { MdLogout } from 'react-icons/md'
import toast, { Toaster } from 'react-hot-toast'
import {
  signInWithGoogle,
  signInWithGitHub,
  signOut,
  getUser,
  getUserProfile,
  onAuthStateChange,
} from '../../../../lib/transkit-cloud'

// ─── Trial usage bar ──────────────────────────────────────────────────────────

function TrialBar({ used, limit }) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const usedMin = Math.floor(used / 60)
  const usedSec = used % 60
  const limitMin = Math.floor(limit / 60)
  const isLow = pct >= 80

  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-center justify-between text-xs'>
        <span className='text-default-500'>Trial usage</span>
        <span className={`font-mono font-medium ${isLow ? 'text-danger' : 'text-default-600 dark:text-default-400'}`}>
          {usedMin}:{String(usedSec).padStart(2, '0')} / {limitMin}:00 min
        </span>
      </div>
      <div className='w-full h-2 rounded-full bg-content3 dark:bg-content3 overflow-hidden'>
        <div
          className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-danger' : 'bg-brand-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {pct >= 100 && (
        <p className='text-xs text-danger'>
          Trial expired. Coming soon: Pro plan for unlimited access.
        </p>
      )}
    </div>
  )
}

// ─── Login panel ─────────────────────────────────────────────────────────────

function LoginPanel({ onLogin }) {
  const [loading, setLoading] = useState(null)

  const handleLogin = async (provider) => {
    setLoading(provider)
    try {
      if (provider === 'google') await signInWithGoogle()
      else await signInWithGitHub()
      onLogin()
    } catch (err) {
      console.error('Login error:', err)
      toast.error('Sign in failed. Please try again.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      <div>
        <h2 className='text-base font-semibold mb-1'>Sign in to Transkit</h2>
        <p className='text-sm text-default-500'>
          Get 10 minutes of free Soniox transcription to try the real-time monitor.
        </p>
      </div>

      <div className='flex flex-col gap-3'>
        <Button
          variant='bordered'
          startContent={<FaGoogle className='text-[#4285F4]' />}
          className='w-full justify-start gap-3 h-11'
          isLoading={loading === 'google'}
          isDisabled={!!loading}
          onPress={() => handleLogin('google')}
        >
          Continue with Google
        </Button>

        <Button
          variant='bordered'
          startContent={<FaGithub />}
          className='w-full justify-start gap-3 h-11'
          isLoading={loading === 'github'}
          isDisabled={!!loading}
          onPress={() => handleLogin('github')}
        >
          Continue with GitHub
        </Button>
      </div>

      <p className='text-xs text-default-400 text-center'>
        No password needed. Your data is end-to-end secured.
      </p>
    </div>
  )
}

// ─── Logged-in dashboard ──────────────────────────────────────────────────────

function AccountDashboard({ user, profile, onSignOut }) {
  const [signingOut, setSigningOut] = useState(false)

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOut()
      onSignOut()
    } catch (err) {
      toast.error('Sign out failed.')
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className='flex flex-col gap-6'>
      {/* User info */}
      <div className='flex items-center gap-3 p-4 rounded-xl bg-content2 dark:bg-content2'>
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
      </div>

      {/* Trial usage */}
      {profile && (
        <div className='p-4 rounded-xl bg-content2 dark:bg-content2'>
          <p className='text-xs font-semibold text-default-500 uppercase tracking-wider mb-3'>
            Soniox Trial
          </p>
          <TrialBar
            used={profile.trial_seconds_used}
            limit={profile.trial_limit_seconds}
          />
        </div>
      )}

      {/* Sign out */}
      <Button
        variant='light'
        color='danger'
        startContent={<MdLogout />}
        className='w-full'
        isLoading={signingOut}
        onPress={handleSignOut}
      >
        Sign out
      </Button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Account() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  const refreshProfile = useCallback(async () => {
    const p = await getUserProfile()
    setProfile(p)
  }, [])

  useEffect(() => {
    // Load initial session
    getUser().then((u) => {
      setUser(u)
      if (u) refreshProfile()
      setLoading(false)
    })

    // Listen for auth state changes
    const unsub = onAuthStateChange((u) => {
      setUser(u)
      if (u) refreshProfile()
      else setProfile(null)
    })

    return unsub
  }, [refreshProfile])

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
      <div className='max-w-sm'>
        {user ? (
          <AccountDashboard
            user={user}
            profile={profile}
            onSignOut={() => { setUser(null); setProfile(null) }}
          />
        ) : (
          <LoginPanel onLogin={() => getUser().then(setUser)} />
        )}
      </div>
    </div>
  )
}
