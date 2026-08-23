import { useState, useEffect, useCallback } from 'react'
import { Radio, X, Plus, Check } from 'lucide-react'
import {
  getSpotifyConnect,
  setSpotifyConnect,
  submitSpotifyConnectCode,
  unlinkSpotifyAccount,
} from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
}

/**
 * Spotify Connect controls, sized to live on the player view rather than buried
 * in settings — it is a thing you reach for mid-session, not configure once.
 *
 * Several people can stay linked at the same time, but only one can drive:
 * there is a single voice connection, so picking someone hands playback over.
 */
export default function SpotifyConnectPanel({ token, guildId }: Props) {
  const [enabled,       setEnabled]       = useState(false)
  const [active,        setActive]        = useState(false)
  const [deviceName,    setDeviceName]    = useState('Muse')
  const [accounts,      setAccounts]      = useState<string[]>([])
  const [activeAccount, setActiveAccount] = useState<string | null>(null)
  const [authUrl,       setAuthUrl]       = useState<string | null>(null)
  const [code,          setCode]          = useState('')
  const [busy,          setBusy]          = useState(false)
  const [error,         setError]         = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!guildId) return
    try {
      const s = await getSpotifyConnect(token, guildId)
      setEnabled(s.enabled)
      setActive(s.active)
      setDeviceName(s.deviceName)
      setAccounts(s.accounts ?? [])
      setActiveAccount(s.activeAccount ?? null)
      setAuthUrl(s.authUrl ?? null)
    } catch {
      /* non-fatal — panel just stays hidden */
    }
  }, [token, guildId])

  useEffect(() => { void load() }, [load])

  const start = async (account?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await setSpotifyConnect(token, guildId, true, account)
      // No cached sign-in for this account yet, so a link is returned instead
      // of playback starting.
      if (res.authUrl) {
        setAuthUrl(res.authUrl)
        setActive(false)
        return
      }

      setAuthUrl(null)
      setActive(res.active)
      setActiveAccount(res.activeAccount ?? account ?? null)
      if (res.deviceName) setDeviceName(res.deviceName)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start Spotify Connect')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    setError(null)
    try {
      await setSpotifyConnect(token, guildId, false)
      setActive(false)
      setActiveAccount(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not stop Spotify Connect')
    } finally {
      setBusy(false)
    }
  }

  const finishSignIn = async () => {
    setBusy(true)
    setError(null)
    try {
      await submitSpotifyConnectCode(token, guildId, code)
      setAuthUrl(null)
      setCode('')
      await load()
      await start()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not complete sign-in')
    } finally {
      setBusy(false)
    }
  }

  const unlink = async (account: string) => {
    setBusy(true)
    try {
      await unlinkSpotifyAccount(token, guildId, account)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not unlink that account')
    } finally {
      setBusy(false)
    }
  }

  if (!enabled) return null

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Radio size={14} className={active ? 'text-green-400' : 'text-app-muted'} />
          <div className="min-w-0">
            <p className="text-sm text-app-text">Spotify Connect</p>
            <p className="text-xs text-app-border truncate">
              {active
                ? `${activeAccount ?? 'Someone'} is driving — pick "${deviceName}" in Spotify`
                : 'Play straight from your own Spotify app'}
            </p>
          </div>
        </div>

        {active && (
          <button
            type="button"
            onClick={stop}
            disabled={busy}
            className="text-xs px-3 py-1.5 rounded border border-app-border text-app-muted hover:text-white transition-colors disabled:opacity-40"
          >
            Stop
          </button>
        )}
      </div>

      {/* Linked accounts. Tapping one hands playback to that person. */}
      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {accounts.map(account => {
            const isDriving = active && account === activeAccount
            return (
              <div
                key={account}
                className={cn(
                  'group flex items-center gap-1.5 rounded-full border pl-3 pr-1.5 py-1 text-xs transition-colors',
                  isDriving ? 'border-transparent text-white' : 'border-app-border text-app-muted hover:text-white',
                )}
                style={isDriving ? { background: 'rgb(var(--accent-rgb))' } : undefined}
              >
                <button
                  type="button"
                  onClick={() => start(account)}
                  disabled={busy || isDriving}
                  className="disabled:cursor-default"
                >
                  {isDriving && <Check size={11} className="inline mr-1 -mt-0.5" />}
                  {account}
                </button>
                <button
                  type="button"
                  onClick={() => unlink(account)}
                  disabled={busy}
                  title={`Unlink ${account}`}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {!authUrl && (
        <button
          type="button"
          onClick={() => start()}
          disabled={busy}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded text-white disabled:opacity-40"
          style={{ background: 'rgb(var(--accent-rgb))' }}
        >
          <Plus size={12} />
          {accounts.length > 0 ? 'Link another Spotify' : 'Link your Spotify'}
        </button>
      )}

      {authUrl && (
        <div className="rounded-lg border border-app-border p-3 space-y-2">
          <p className="text-xs text-app-text font-medium">One-time Spotify sign-in</p>
          <p className="text-xs text-app-border">
            <a
              href={authUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
              style={{ color: 'rgb(var(--accent-rgb))' }}
            >
              Open Spotify sign-in
            </a>
            , approve, then paste the address of the page that fails to load.
          </p>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value)}
              placeholder="http://127.0.0.1:5588/login?code=..."
              className="flex-1 min-w-0 text-xs px-2 py-1.5 rounded border border-app-border bg-transparent text-app-text placeholder:text-app-border focus:outline-none"
            />
            <button
              type="button"
              onClick={finishSignIn}
              disabled={busy || !code.trim()}
              className="text-xs px-3 py-1.5 rounded text-white disabled:opacity-40"
              style={{ background: 'rgb(var(--accent-rgb))' }}
            >
              {busy ? 'Linking…' : 'Finish'}
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}
