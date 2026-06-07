import { useState, useEffect, useCallback, useRef, type FormEvent } from 'react'
import { Settings as SettingsIcon, ChevronRight, ChevronDown, Lock, X, ImageIcon, Video } from 'lucide-react'
import {
  getGuilds, getChannels, getStatus, pause, resume, skip, bulkLogin, moveChannel,
  ApiError,
  type Guild, type Channel, type PlayerStatus,
} from '@/lib/api'
import { applyAccent, ACCENT_PRESETS } from './Settings'
import NowPlaying from './NowPlaying'
import QueueCard from './QueueCard'
import AddToQueue from './AddToQueue'
import BotSettings from './BotSettings'
import BulkImport from './BulkImport'
import Settings from './Settings'

interface Props {
  token: string
  onSessionExpired: () => void
  onReconnecting: (v: boolean) => void
}

function GuildSwitcher({ guilds, primaryGuildId, onSwitch }: { guilds: Guild[]; primaryGuildId: string; onSwitch: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = guilds.find(g => g.id === primaryGuildId)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (guilds.length <= 1) return current ? <span className="text-sm" style={{ color: '#555' }}>· {current.name}</span> : null

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-sm transition-colors"
        style={{ color: open ? '#a855f7' : '#555' }}
      >
        · {current?.name ?? '—'} <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 rounded-lg border border-app-border overflow-hidden z-50"
          style={{ background: '#0e0c1c', minWidth: 160 }}>
          {guilds.map(g => (
            <button
              key={g.id}
              onClick={() => { onSwitch(g.id); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center justify-between"
              style={g.id === primaryGuildId
                ? { color: '#a855f7', background: 'rgba(168,85,247,0.1)' }
                : { color: '#ccc' }}
              onMouseEnter={e => { if (g.id !== primaryGuildId) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.05)' }}
              onMouseLeave={e => { if (g.id !== primaryGuildId) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            >
              {g.name}
              {g.id === primaryGuildId && <span className="text-[10px] px-1.5 py-0.5 rounded ml-2" style={{ background: 'rgba(168,85,247,0.2)', color: '#c084fc' }}>active</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function JammyLogo({ playing }: { playing: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="28" height="28" rx="8" fill="url(#logoGrad)" />
      <rect x="5"  y="16" width="3.5" height="7"  rx="1.5" fill="white" opacity="0.9"  className={playing ? 'animate-bar'   : undefined} />
      <rect x="10" y="10" width="3.5" height="13" rx="1.5" fill="white"                className={playing ? 'animate-bar-2' : undefined} />
      <rect x="15" y="13" width="3.5" height="10" rx="1.5" fill="white" opacity="0.85" className={playing ? 'animate-bar-3' : undefined} />
      <rect x="20" y="7"  width="3.5" height="16" rx="1.5" fill="white" opacity="0.7"  className={playing ? 'animate-bar'   : undefined} />
      <defs>
        <linearGradient id="logoGrad" x1="0" y1="0" x2="28" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="100%" stopColor="#6366f1" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function fmtTime(s: number) {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

// ── Secondary guild compact card ──────────────────────────────────────────────

interface SecondaryCardProps {
  token: string
  guildId: string
  guildName: string
  channels: Channel[]
  channelId: string
  onChannelChange: (id: string) => void
  onRemove: () => void
}

function SecondaryGuildCard({ token, guildId, guildName, channels, channelId, onChannelChange, onRemove }: SecondaryCardProps) {
  const [status, setStatus] = useState<PlayerStatus | null>(null)

  useEffect(() => {
    if (!guildId) return
    const poll = async () => {
      try { setStatus(await getStatus(token, guildId)) } catch { /* non-fatal */ }
    }
    poll()
    const t = setInterval(poll, 3000)
    return () => clearInterval(t)
  }, [token, guildId])

  const np = status?.nowPlaying

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChevronRight size={11} style={{ color: '#a855f7' }} />
          <span className="text-xs font-semibold" style={{ color: '#a855f7' }}>{guildName}</span>
        </div>
        <button onClick={onRemove} className="text-app-muted hover:text-white transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* Channel picker */}
      {channels.length > 0 && (
        <div className="relative w-fit">
          <select
            value={channelId}
            onChange={e => onChannelChange(e.target.value)}
            className="appearance-none bg-app-panel border border-app-border rounded-lg
                       text-app-text text-xs pl-3 pr-7 py-1.5 cursor-pointer
                       focus:outline-none focus:border-app-accent transition-colors min-w-[140px]"
          >
            {channels.map(c => (
              <option key={c.id} value={c.id}>🔊 {c.name}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#888' }} />
        </div>
      )}

      {/* Now playing */}
      <div className="flex items-center gap-3">
        {np?.thumbnailUrl ? (
          <img src={np.thumbnailUrl} className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
        ) : (
          <div className="w-10 h-10 rounded-lg flex-shrink-0" style={{ background: '#1c1c1c' }} />
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium text-white truncate">{np?.title ?? (status?.status === 'IDLE' ? 'Idle' : '—')}</p>
          <p className="text-[11px] truncate" style={{ color: '#666' }}>{np?.artist ?? ''}</p>
          {np && (
            <p className="text-[10px] tabular-nums" style={{ color: '#555' }}>
              {fmtTime(status?.position ?? 0)} / {fmtTime(np.length)}
            </p>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        {status?.status === 'PLAYING' ? (
          <button
            onClick={() => pause(token, guildId).catch(() => null)}
            className="text-xs px-2.5 py-1 rounded-lg border border-app-border text-app-muted hover:text-white transition-colors"
          >Pause</button>
        ) : status?.status === 'PAUSED' ? (
          <button
            onClick={() => resume(token, guildId).catch(() => null)}
            className="text-xs px-2.5 py-1 rounded-lg border border-app-border text-app-muted hover:text-white transition-colors"
          >Resume</button>
        ) : null}
        {status?.status !== 'IDLE' && (
          <button
            onClick={() => skip(token, guildId).catch(() => null)}
            className="text-xs px-2.5 py-1 rounded-lg border border-app-border text-app-muted hover:text-white transition-colors"
          >Skip</button>
        )}
        {status && (
          <span className="text-[10px] ml-auto" style={{ color: '#555' }}>
            {status.queue.length} in queue
          </span>
        )}
      </div>
    </div>
  )
}

const MAX_GUILDS = 2

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function Dashboard({ token, onSessionExpired, onReconnecting }: Props) {
  const [guilds, setGuilds] = useState<Guild[]>([])

  // Up to 2 selected guild IDs — primary is [0], secondary is [1]
  const [selectedGuildIds, setSelectedGuildIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('muse_guilds') ?? '[]') } catch { return [] }
  })

  const primaryGuildId   = selectedGuildIds[0] ?? ''
  const secondaryGuildId = selectedGuildIds[1] ?? ''

  const [primaryChannels,   setPrimaryChannels]   = useState<Channel[]>([])
  const [secondaryChannels, setSecondaryChannels] = useState<Channel[]>([])
  const [primaryChannelId,  setPrimaryChannelId]  = useState<string>('')
  const [secondaryChannelId, setSecondaryChannelId] = useState<string>('')

  const [status,         setStatus]         = useState<PlayerStatus | null>(null)
  const [smoothPosition, setSmoothPosition] = useState(0)
  const [view, setView] = useState<'player' | 'admin'>('player')
  const [viewMode, setViewMode] = useState<'art' | 'video'>(() =>
    (localStorage.getItem('muse_view_mode') ?? 'art') as 'art' | 'video',
  )
  const [videoStartPos, setVideoStartPos] = useState(0)
  const switchView = (mode: 'art' | 'video') => {
    if (mode === 'video') setVideoStartPos(Math.floor(smoothPosition))
    setViewMode(mode)
    localStorage.setItem('muse_view_mode', mode)
  }

  // Admin unlock — bulkToken stored in localStorage (never the raw password)
  const [adminToken,    setAdminToken]    = useState<string | null>(() => localStorage.getItem('muse_admin_token'))
  const [adminUnlocked, setAdminUnlocked] = useState(() => Boolean(localStorage.getItem('muse_admin_token')))
  const [showAdminPw,   setShowAdminPw]   = useState(false)
  const [adminPw,       setAdminPw]       = useState('')
  const [adminPwError,  setAdminPwError]  = useState('')
  const [adminPwLoading, setAdminPwLoading] = useState(false)
  const [rememberMe,    setRememberMe]    = useState(false)

  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('muse_theme') as 'dark' | 'light') ?? 'dark',
  )
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('muse_theme', theme)
  }, [theme])

  // Apply saved accent colour on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('muse_accent') ?? 'null') as typeof ACCENT_PRESETS[number] | null
      if (saved?.rgb) applyAccent(saved)
    } catch { /* use CSS default */ }
  }, [])

  // Load all guilds
  useEffect(() => {
    getGuilds(token)
      .then(gs => {
        setGuilds(gs)
        // Auto-select first guild if nothing selected yet
        if (selectedGuildIds.length === 0 && gs.length > 0) {
          const ids = [gs[0].id]
          setSelectedGuildIds(ids)
          localStorage.setItem('muse_guilds', JSON.stringify(ids))
        }
      })
      .catch(err => {
        if (err instanceof ApiError && err.status === 401) onSessionExpired()
      })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load primary guild channels
  useEffect(() => {
    if (!primaryGuildId) return
    getChannels(token, primaryGuildId)
      .then(cs => {
        setPrimaryChannels(cs)
        const saved = localStorage.getItem(`muse_channel_${primaryGuildId}`)
        const match = saved && cs.find(c => c.id === saved)
        setPrimaryChannelId(match ? saved! : cs[0]?.id ?? '')
      })
      .catch(() => { /* non-fatal */ })
  }, [token, primaryGuildId])

  // Load secondary guild channels
  useEffect(() => {
    if (!secondaryGuildId) { setSecondaryChannels([]); return }
    getChannels(token, secondaryGuildId)
      .then(cs => {
        setSecondaryChannels(cs)
        const saved = localStorage.getItem(`muse_channel_${secondaryGuildId}`)
        const match = saved && cs.find(c => c.id === saved)
        setSecondaryChannelId(match ? saved! : cs[0]?.id ?? '')
      })
      .catch(() => { /* non-fatal */ })
  }, [token, secondaryGuildId])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!primaryGuildId) return
    try {
      const s = await getStatus(token, primaryGuildId)
      setStatus(s)
      onReconnecting(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired()
      } else {
        onReconnecting(true)
      }
    }
  }, [token, primaryGuildId, onSessionExpired, onReconnecting])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll])

  const addGuild = (id: string) => {
    const next = [...selectedGuildIds.filter(g => g !== id), id].slice(0, MAX_GUILDS)
    setSelectedGuildIds(next)
    localStorage.setItem('muse_guilds', JSON.stringify(next))
  }

  const removeGuild = (id: string) => {
    const next = selectedGuildIds.filter(g => g !== id)
    setSelectedGuildIds(next)
    localStorage.setItem('muse_guilds', JSON.stringify(next))
    setStatus(null)
  }

  const setPrimaryGuild = (id: string) => {
    const next = [id, ...selectedGuildIds.filter(g => g !== id)].slice(0, MAX_GUILDS)
    setSelectedGuildIds(next)
    localStorage.setItem('muse_guilds', JSON.stringify(next))
    setStatus(null)
  }

  const handlePrimaryChannelChange = (id: string) => {
    setPrimaryChannelId(id)
    localStorage.setItem(`muse_channel_${primaryGuildId}`, id)
  }

  const handleSecondaryChannelChange = (id: string) => {
    setSecondaryChannelId(id)
    localStorage.setItem(`muse_channel_${secondaryGuildId}`, id)
  }

  const primaryGuild   = guilds.find(g => g.id === primaryGuildId)
  const secondaryGuild = guilds.find(g => g.id === secondaryGuildId)

  return (
    <div className="min-h-screen bg-app-bg">
      <header className="sticky top-0 z-30 backdrop-blur-md px-6 py-3"
        style={{ background: 'rgba(7,6,15,0.75)' }}>
        <div className="max-w-[1800px] mx-auto flex items-center gap-3">
          <JammyLogo playing={status?.status === 'PLAYING'} />
          <span className="font-bold text-white text-base tracking-tight">Jammy Beat Box</span>
          {guilds.length > 0 && (
            <GuildSwitcher
              guilds={guilds}
              primaryGuildId={primaryGuildId}
              onSwitch={setPrimaryGuild}
            />
          )}
          <div className="ml-auto">
            <button
              onClick={() => {
                if (view === 'admin') { setView('player'); return }
                if (adminUnlocked) { setView('admin'); return }
                setShowAdminPw(true)
              }}
              className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-app-border"
              style={view === 'admin'
                ? { color: '#a855f7', borderColor: 'rgba(168,85,247,0.4)', background: 'rgba(168,85,247,0.1)' }
                : { color: '#888', background: 'transparent' }}
              title="Settings"
            >
              <SettingsIcon size={14} />
            </button>
          </div>
        </div>
      </header>

      {view === 'admin' ? (
        adminUnlocked ? (
          <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <SettingsIcon size={18} style={{ color: '#a855f7' }} />
                <h1 className="text-lg font-bold text-white">Admin Panel</h1>
                <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>
                  {primaryGuild?.name ?? primaryGuildId}
                </span>
              </div>
              <button
                onClick={() => {
                  setAdminUnlocked(false)
                  setAdminToken(null)
                  localStorage.removeItem('muse_admin_token')
                  setView('player')
                }}
                className="text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-white transition-colors"
              >
                Sign out
              </button>
            </div>

            {/* Settings section */}
            <Settings
              token={token}
              guildId={primaryGuildId}
              guildName={primaryGuild?.name ?? ''}
              theme={theme}
              onThemeChange={setTheme}
              guilds={guilds}
              selectedIds={selectedGuildIds}
              onAddGuild={addGuild}
              onRemoveGuild={removeGuild}
              onSetPrimary={setPrimaryGuild}
            />

            {/* Divider */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)' }} />

            {/* Bulk Import section */}
            <BulkImport
              token={token}
              guildId={primaryGuildId}
              channels={primaryChannels}
              channelId={primaryChannelId}
              onChannelChange={handlePrimaryChannelChange}
              onRefresh={poll}
              externalBulkToken={adminToken ?? undefined}
            />
          </div>
        ) : (
          // Not yet unlocked — show password prompt inline
          <div className="max-w-sm mx-auto px-6 py-16 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
                style={{ background: 'rgba(168,85,247,0.15)' }}>
                <Lock size={20} style={{ color: '#a855f7' }} />
              </div>
              <h1 className="text-lg font-bold text-white">Admin Panel</h1>
              <p className="text-sm" style={{ color: '#666' }}>Enter the admin password to continue.</p>
            </div>
            <form onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setAdminPwLoading(true)
              setAdminPwError('')
              try {
                const { bulkToken: bt } = await bulkLogin(adminPw)
                setAdminToken(bt)
                setAdminUnlocked(true)
                if (rememberMe) localStorage.setItem('muse_admin_token', bt)
                setAdminPw('')
              } catch {
                setAdminPwError('Incorrect password.')
              } finally {
                setAdminPwLoading(false)
              }
            }} className="space-y-3">
              <input
                type="password"
                autoFocus
                className="input w-full"
                placeholder="Password"
                value={adminPw}
                onChange={e => setAdminPw(e.target.value)}
              />
              {adminPwError && <p className="text-xs text-app-danger">{adminPwError}</p>}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="sr-only"
                />
                <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${rememberMe ? 'bg-app-accent' : 'bg-app-border'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${rememberMe ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </span>
                <span className="text-xs" style={{ color: '#aaa' }}>Remember me</span>
              </label>
              <button
                type="submit"
                disabled={adminPwLoading || !adminPw}
                className="btn-primary w-full py-2.5"
              >
                {adminPwLoading ? 'Checking…' : 'Unlock'}
              </button>
            </form>
          </div>
        )
      ) : (
        <div className="relative flex overflow-hidden" style={{ height: 'calc(100vh - 53px)' }}>

          {status?.nowPlaying?.thumbnailUrl && (
            <div
              key={status.nowPlaying.thumbnailUrl}
              className="absolute inset-0 pointer-events-none animate-fade-in"
              style={{
                backgroundImage:    `url(${status.nowPlaying.thumbnailUrl})`,
                backgroundSize:     'cover',
                backgroundPosition: 'center',
                filter:             'blur(80px) saturate(2.2) brightness(1.3)',
                opacity:            0.32,
                transform:          'scale(1.1)',
                zIndex:             0,
              }}
            />
          )}

          {/* Left: Now Playing */}
          <div className="w-1/2 relative flex flex-col" style={{ zIndex: 1 }}>
            <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none"
              style={{
                top: 40, width: 420, height: 420,
                background: 'radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(99,102,241,0.10) 45%, transparent 70%)',
                filter: 'blur(60px)',
                borderRadius: '50%',
                zIndex: 0,
              }} />
            <div className="relative z-10 flex flex-col h-full overflow-y-auto">
              <div className="px-8 pt-6 pb-4">
                <NowPlaying status={status} token={token} guildId={primaryGuildId} onRefresh={poll} onPositionChange={setSmoothPosition} viewMode={viewMode} videoStartPos={videoStartPos} />
              </div>
              <div className="flex flex-col gap-3 px-8 pb-6">
                {/* Art / Video toggle — only shown when something is playing */}
                {status?.nowPlaying && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#666' }}>View</span>
                    <div className="flex items-center gap-0.5 rounded-full p-0.5" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
                      <button
                        onClick={() => switchView('art')}
                        className="flex items-center gap-1 text-xs px-3 py-1 rounded-full transition-all font-medium"
                        style={viewMode === 'art' ? { background: 'rgba(168,85,247,0.5)', color: '#fff' } : { color: '#888' }}
                      >
                        <ImageIcon size={10} /> Art
                      </button>
                      <button
                        onClick={() => switchView('video')}
                        className="flex items-center gap-1 text-xs px-3 py-1 rounded-full transition-all font-medium"
                        style={viewMode === 'video' ? { background: 'rgba(168,85,247,0.5)', color: '#fff' } : { color: '#888' }}
                      >
                        <Video size={10} /> Video
                      </button>
                    </div>
                  </div>
                )}
                <AddToQueue
                  token={token}
                  guildId={primaryGuildId}
                  channels={primaryChannels}
                  channelId={primaryChannelId}
                  onChannelChange={handlePrimaryChannelChange}
                  onRefresh={poll}
                />

                {/* Channel switcher */}
                {primaryChannels.length > 0 && (
                  <div className="card p-4 space-y-2">
                    <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
                      Switch channel
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {primaryChannels.map(c => {
                        const active = status?.activeChannelIds?.includes(c.id)
                        return (
                          <button
                            key={c.id}
                            onClick={() => moveChannel(token, primaryGuildId, c.id).then(poll).catch(() => null)}
                            className="text-xs px-3 py-1.5 rounded-lg border transition-all"
                            style={active
                              ? { background: 'rgba(168,85,247,0.15)', color: '#c084fc', borderColor: 'rgba(168,85,247,0.4)' }
                              : { background: 'transparent', color: '#666', borderColor: '#333' }}
                          >
                            🔊 {c.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                <BotSettings token={token} guildId={primaryGuildId} />
              </div>
            </div>
          </div>

          {/* Right: Queue + optional secondary guild card */}
          <div className="w-1/2 flex flex-col overflow-hidden" style={{ zIndex: 1, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
            {secondaryGuildId && secondaryGuild && (
              <SecondaryGuildCard
                token={token}
                guildId={secondaryGuildId}
                guildName={secondaryGuild.name}
                channels={secondaryChannels}
                channelId={secondaryChannelId}
                onChannelChange={handleSecondaryChannelChange}
                onRemove={() => removeGuild(secondaryGuildId)}
              />
            )}
            <QueueCard
              queue={status?.queue ?? []}
              token={token}
              guildId={primaryGuildId}
              onRefresh={poll}
              pendingCount={status?.pendingCount ?? 0}
              nowPlaying={status?.nowPlaying ?? null}
              position={smoothPosition}
              isPlaying={status?.status === 'PLAYING'}
            />
          </div>

        </div>
      )}

      {/* Admin password modal — triggered from settings gear when not yet unlocked */}
      {showAdminPw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowAdminPw(false); setAdminPw(''); setAdminPwError('') } }}>
          <div className="card p-6 w-full max-w-sm space-y-4 mx-4">
            <div className="flex items-center gap-2">
              <Lock size={16} style={{ color: '#a855f7' }} />
              <h2 className="text-sm font-semibold text-white">Admin Panel</h2>
            </div>
            <p className="text-xs" style={{ color: '#666' }}>
              Enter the admin password to access settings and bulk import.
            </p>
            <form onSubmit={async (e: FormEvent) => {
              e.preventDefault()
              setAdminPwLoading(true)
              setAdminPwError('')
              try {
                const { bulkToken: bt } = await bulkLogin(adminPw)
                setAdminToken(bt)
                setAdminUnlocked(true)
                if (rememberMe) localStorage.setItem('muse_admin_token', bt)
                setShowAdminPw(false)
                setAdminPw('')
                setView('admin')
              } catch {
                setAdminPwError('Incorrect password.')
              } finally {
                setAdminPwLoading(false)
              }
            }} className="space-y-3">
              <input
                type="password"
                autoFocus
                className="input w-full"
                placeholder="Password"
                value={adminPw}
                onChange={e => setAdminPw(e.target.value)}
              />
              {adminPwError && (
                <p className="text-xs text-app-danger">{adminPwError}</p>
              )}
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  className="sr-only"
                />
                <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 ${rememberMe ? 'bg-app-accent' : 'bg-app-border'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${rememberMe ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </span>
                <span className="text-xs" style={{ color: '#aaa' }}>Remember me</span>
              </label>
              <button
                type="submit"
                disabled={adminPwLoading || !adminPw}
                className="btn-primary w-full py-2 text-sm"
              >
                {adminPwLoading ? 'Checking…' : 'Unlock'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
