import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music } from 'lucide-react'
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
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  useEffect(() => {
    if (!status?.nowPlaying) { stopTick(); return }
    const np      = status.nowPlaying
    const playing = status.status === 'PLAYING'
    const srvPos  = status.position ?? 0
    if (np.url !== songUrl) {
      setSongUrl(np.url); setLocalPos(srvPos); setLocalLen(np.length); stopTick()
      onPositionChange?.(srvPos)
    } else {
      setLocalLen(np.length)
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

  // Full-bleed: art fills the entire container, controls overlay at the bottom
  return (
    <div className="relative w-full h-full overflow-hidden" style={{ minHeight: 320 }}>

      {/* Album art — fills the full panel */}
      {np?.thumbnailUrl ? (
        <img
          src={np.thumbnailUrl}
          alt={np?.title ?? ''}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: active ? 'none' : 'brightness(0.4)' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div className="absolute inset-0 w-full h-full"
          style={{ background: 'linear-gradient(135deg,#1a1030 0%,#0a0820 100%)' }} />
      )}

      {/* Subtle dark vignette so controls are readable */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.15) 50%, rgba(0,0,0,0.05) 100%)' }} />

      {/* Nothing playing state */}
      {!active && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
          <Music size={52} style={{ color: '#333' }} />
          <p className="text-white font-bold text-lg">Nothing playing</p>
          <p className="text-sm" style={{ color: '#555' }}>Add a song to get started</p>
        </div>
      )}

      {/* Controls overlay — frosted glass panel at the bottom */}
      {active && (
        <div
          className="absolute left-4 right-4 bottom-4 z-10 rounded-2xl px-5 py-4 space-y-3"
          style={{
            background:   'rgba(12,10,20,0.65)',
            backdropFilter: 'blur(24px)',
            WebkitBackdropFilter: 'blur(24px)',
            border: '1px solid rgba(255,255,255,0.10)',
            boxShadow: '0 4px 32px rgba(0,0,0,0.5)',
          }}
        >
          {/* Title + artist + badge */}
          <div className="min-w-0">
            <p className="font-bold text-white text-base leading-tight truncate" title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-sm truncate" style={{ color: '#aaa' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative h-1.5 rounded-full overflow-hidden', active && 'cursor-pointer group')}
              style={{ background: 'rgba(255,255,255,0.15)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg,#a855f7,#6366f1)',
                  boxShadow: '0 0 6px rgba(168,85,247,0.5)',
                }}
              />
            </div>
            <div className="flex justify-between text-[11px]" style={{ color: '#888' }}>
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* Transport buttons */}
          <div className="flex items-center justify-center gap-5">
            <button onClick={handleStop}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.08)', color: '#888' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}>
              <Square size={16} />
            </button>

            <button onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
              style={{
                width: 56, height: 56,
                background: '#fff',
                boxShadow: '0 0 0 6px rgba(168,85,247,0.2), 0 4px 20px rgba(0,0,0,0.4)',
              }}>
              {isPlaying
                ? <Pause size={20} style={{ color: '#000' }} />
                : <Play  size={20} style={{ color: '#000', marginLeft: 2 }} />}
            </button>

            <button onClick={handleSkip}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 38, height: 38, background: 'rgba(255,255,255,0.08)', color: '#888' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}>
              <SkipForward size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
