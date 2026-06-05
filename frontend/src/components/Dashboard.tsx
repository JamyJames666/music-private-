import { useState, useEffect, useCallback, useRef } from 'react'
import { Sun, Moon } from 'lucide-react'
import {
  getGuilds, getChannels, getStatus,
  ApiError,
  type Channel, type PlayerStatus,
} from '@/lib/api'
import NowPlaying from './NowPlaying'
import QueueCard from './QueueCard'
import AddToQueue from './AddToQueue'

interface Props {
  token: string
  onSessionExpired: () => void
  onReconnecting: (v: boolean) => void
}

function MusicBotLogo({ playing }: { playing: boolean }) {
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

export default function Dashboard({ token, onSessionExpired, onReconnecting }: Props) {
  const [guildId,   setGuildId]   = useState<string>('')
  const [channels,  setChannels]  = useState<Channel[]>([])
  const [channelId, setChannelId] = useState<string>('')
  const [status,    setStatus]    = useState<PlayerStatus | null>(null)
  const [smoothPosition, setSmoothPosition] = useState(0)

  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('muse_theme') as 'dark' | 'light') ?? 'dark',
  )
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    localStorage.setItem('muse_theme', theme)
  }, [theme])

  // Auto-select first guild
  useEffect(() => {
    getGuilds(token)
      .then(gs => { if (gs.length > 0) setGuildId(gs[0].id) })
      .catch(err => { if (err instanceof ApiError && err.status === 401) onSessionExpired() })
  }, [token]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load channels for guild
  useEffect(() => {
    if (!guildId) return
    getChannels(token, guildId)
      .then(cs => {
        setChannels(cs)
        const saved = localStorage.getItem(`muse_channel_${guildId}`)
        const match = saved && cs.find(c => c.id === saved)
        setChannelId(match ? saved! : cs[0]?.id ?? '')
      })
      .catch(() => { /* non-fatal */ })
  }, [token, guildId])

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!guildId) return
    try {
      const s = await getStatus(token, guildId)
      setStatus(s)
      onReconnecting(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onSessionExpired()
      } else {
        onReconnecting(true)
      }
    }
  }, [token, guildId, onSessionExpired, onReconnecting])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll])

  const handleChannelChange = (id: string) => {
    setChannelId(id)
    localStorage.setItem(`muse_channel_${guildId}`, id)
  }

  return (
    <div className="min-h-screen bg-app-bg">
      <header className="sticky top-0 z-30 backdrop-blur-md px-6 py-3"
        style={{ background: 'rgba(7,6,15,0.75)' }}>
        <div className="max-w-[1800px] mx-auto flex items-center gap-4">
          <div className="flex items-center gap-2.5 mr-auto">
            <MusicBotLogo playing={status?.status === 'PLAYING'} />
            <span className="font-bold text-white text-base tracking-tight">MusicBot</span>
          </div>

          <button
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors border border-app-border"
            style={{ color: '#888' }}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
          </button>
        </div>
      </header>

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

        {/* Left: Now Playing + Add to Queue */}
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
              <NowPlaying status={status} token={token} guildId={guildId} onRefresh={poll} onPositionChange={setSmoothPosition} />
            </div>
            <div className="flex flex-col gap-3 px-8 pb-6">
              <AddToQueue
                token={token}
                guildId={guildId}
                channels={channels}
                channelId={channelId}
                onChannelChange={handleChannelChange}
                onRefresh={poll}
              />
            </div>
          </div>
        </div>

        {/* Right: Queue */}
        <div className="w-1/2 flex flex-col overflow-hidden" style={{ zIndex: 1, borderLeft: '1px solid rgba(255,255,255,0.07)' }}>
          <QueueCard
            queue={status?.queue ?? []}
            token={token}
            guildId={guildId}
            onRefresh={poll}
            pendingCount={status?.pendingCount ?? 0}
            nowPlaying={status?.nowPlaying ?? null}
            position={smoothPosition}
            isPlaying={status?.status === 'PLAYING'}
          />
        </div>

      </div>
    </div>
  )
}
