import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music, ImageIcon, Video } from 'lucide-react'
import { pause, resume, skip, stop, type PlayerStatus } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
  onPositionChange?: (pos: number) => void
}

export default function NowPlaying({ status, token, guildId, onRefresh, onPositionChange }: Props) {
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songUrl,  setSongUrl]  = useState('')
  const [viewMode, setViewMode] = useState<'art' | 'video'>(() =>
    (localStorage.getItem('muse_view_mode') ?? 'art') as 'art' | 'video',
  )
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track position at the moment we switched to video so iframe starts there
  const videoStartPos = useRef(0)

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }
    const np = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos = status.position ?? 0
    if (np.url !== songUrl) {
      setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick()
      onPositionChange?.(srvPos)
    } else {
      setLocalLen(np.length)
      // Only sync when srvPos is ahead of localPos (not a transient reset to 0).
      // A backwards jump (srvPos < localPos by more than 3s) only applies
      // if srvPos is non-zero — zero means a transient skip/seek reset, ignore it.
      const diff = srvPos - localPos
      const shouldSync = srvPos > 0 && (diff > 3 || diff < -3) && !(srvPos < 5 && localPos > 10)
      if (shouldSync) {
        setLocalPos(srvPos)
        onPositionChange?.(srvPos)
      }
    }
    if (playing && !tickRef.current) {
      const rate = status.speed ?? 1
      tickRef.current = setInterval(() => setLocalPos(p => {
        const next = Math.min(p + rate, np.length)
        onPositionChange?.(next)
        return next
      }), 1000)
    } else if (!playing) { stopTick() }
    return stopTick
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const isPlaying = status?.status === 'PLAYING'
  const active    = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np        = status?.nowPlaying ?? null
  const pct       = localLen > 0 ? Math.min(100, (localPos / localLen) * 100) : 0
  const ytIdFromUrl = (url: string | undefined) => {
    if (!url) return null
    const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
    if (m) return m[1]
    if (!url.startsWith('http') && !url.includes('/') && url.length === 11) return url
    return null
  }
  const videoId  = ytIdFromUrl(np?.url)
  const isYoutube = np?.source === 'youtube' || !!videoId

  const setView = (mode: 'art' | 'video') => {
    if (mode === 'video') videoStartPos.current = Math.floor(localPos)
    setViewMode(mode)
    localStorage.setItem('muse_view_mode', mode)
  }

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const progressRef = useRef<HTMLDivElement>(null)
  const handleSeek  = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || localLen === 0) return
    const r = progressRef.current?.getBoundingClientRect(); if (!r) return
    const pos = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * localLen)
    setLocalPos(pos)
    const {seek: seekFn} = await import('@/lib/api')
    await seekFn(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [active, localLen, token, guildId, onRefresh])

  return (
    <div className="relative flex flex-col items-center z-10 w-full max-w-lg mx-auto">

      {/* Big ambient glow — pulsing when playing */}
      <div
        className="absolute pointer-events-none transition-opacity duration-700"
        style={{
          top: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 480,
          height: 480,
          background: active
            ? 'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(99,102,241,0.22) 40%, transparent 70%)'
            : 'radial-gradient(circle, rgba(80,40,120,0.15) 0%, transparent 70%)',
          filter: 'blur(60px)',
          borderRadius: '50%',
          zIndex: 0,
          animation: isPlaying ? 'pulse 3s ease-in-out infinite' : 'none',
        }}
      />

      {!active ? (
        <div className="flex flex-col items-center gap-5 py-12 z-10">
          <div
            className="rounded-3xl flex items-center justify-center"
            style={{ width: '100%', maxWidth: 480, aspectRatio: '1', background: 'linear-gradient(135deg,#1a1a2e,#16162a)' }}
          >
            <Music size={72} style={{ color: '#333' }} />
          </div>
          <p className="text-white font-bold text-xl">Nothing playing</p>
          <p className="text-sm" style={{ color: '#555' }}>Add a song to get started</p>
        </div>
      ) : (
        <>
          {/* Art / Video toggle */}
          {isYoutube && (
            <div className="z-10 mt-4 mb-2 flex items-center gap-1 rounded-full p-0.5"
              style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.10)' }}>
              <button
                onClick={() => setView('art')}
                className={cn('flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-all', viewMode === 'art' ? 'text-white' : 'text-app-muted hover:text-white')}
                style={viewMode === 'art' ? { background: 'rgba(168,85,247,0.25)' } : {}}
              >
                <ImageIcon size={11} /> Art
              </button>
              <button
                onClick={() => setView('video')}
                className={cn('flex items-center gap-1.5 text-xs px-3 py-1 rounded-full transition-all', viewMode === 'video' ? 'text-white' : 'text-app-muted hover:text-white')}
                style={viewMode === 'video' ? { background: 'rgba(168,85,247,0.25)' } : {}}
              >
                <Video size={11} /> Video
              </button>
            </div>
          )}

          {/* Media area */}
          <div className="relative z-10 mb-5 w-full" style={{ maxWidth: 480 }}>
            {viewMode === 'video' && isYoutube && videoId ? (
              <iframe
                key={`${videoId}-${videoStartPos.current}`}
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&start=${videoStartPos.current}&rel=0&modestbranding=1&iv_load_policy=3`}
                className="w-full rounded-3xl"
                style={{ aspectRatio: '16/9', border: 'none', boxShadow: '0 20px 80px rgba(0,0,0,0.8), 0 0 40px rgba(168,85,247,0.25)' }}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            ) : (
              <>
                {np?.thumbnailUrl ? (
                  <img
                    src={np.thumbnailUrl}
                    alt={np.title}
                    className="w-full rounded-3xl object-cover"
                    style={{
                      aspectRatio: '1',
                      boxShadow: '0 20px 80px rgba(0,0,0,0.8), 0 0 40px rgba(168,85,247,0.25)',
                    }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div
                    className="w-full rounded-3xl flex items-center justify-center"
                    style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}
                  >
                    <Music size={72} style={{ color: '#7c3aed' }} />
                  </div>
                )}
                {/* Animated bars — bottom right corner */}
                <div className={cn('absolute bottom-4 right-4 flex items-end gap-[3px] h-5', !isPlaying && 'opacity-0')}>
                  <span className="block w-1 rounded-sm animate-bar"   style={{ background: 'rgba(255,255,255,0.8)' }} />
                  <span className="block w-1 rounded-sm animate-bar-2" style={{ background: 'rgba(255,255,255,0.8)' }} />
                  <span className="block w-1 rounded-sm animate-bar-3" style={{ background: 'rgba(255,255,255,0.8)' }} />
                </div>
              </>
            )}
          </div>

          {/* Title + artist */}
          <div className="text-center w-full px-6 z-10 mb-1" style={{ maxWidth: 380 }}>
            <p className="font-bold text-white leading-snug truncate" style={{ fontSize: 22 }} title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1.5">
              <p className="text-base truncate" style={{ color: '#888' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full px-6 z-10 mt-4 mb-5" style={{ maxWidth: 380 }}>
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative rounded-full overflow-hidden', active && 'cursor-pointer')}
              style={{ height: 5, background: 'rgba(255,255,255,0.12)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #a855f7, #6366f1)',
                  boxShadow: '0 0 8px rgba(168,85,247,0.6)',
                }}
              />
            </div>
            <div className="flex justify-between text-xs mt-2" style={{ color: '#555' }}>
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-6 z-10">
            <button
              onClick={handleStop}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 44, height: 44, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Stop"
            >
              <Square size={18} />
            </button>

            {/* Big play/pause */}
            <button
              onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
              style={{
                width: 68, height: 68,
                background: '#fff',
                boxShadow: '0 0 0 8px rgba(168,85,247,0.20), 0 8px 32px rgba(0,0,0,0.5)',
              }}
            >
              {isPlaying
                ? <Pause size={24} style={{ color: '#000' }} />
                : <Play  size={24} style={{ color: '#000', marginLeft: 3 }} />}
            </button>

            <button
              onClick={handleSkip}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 44, height: 44, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Skip"
            >
              <SkipForward size={18} />
            </button>

          </div>
        </>
      )}
    </div>
  )
}
