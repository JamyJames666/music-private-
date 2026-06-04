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
      if (shouldSync) { setLocalPos(srvPos); onPositionChange?.(srvPos) }
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

  return (
    // Full height container — centres the square art + overlay vertically
    <div className="w-full h-full flex items-center justify-center" style={{ padding: '16px' }}>
      {!active ? (
        <div className="flex flex-col items-center gap-4">
          <div className="rounded-3xl flex items-center justify-center"
            style={{ width: 320, height: 320, background: 'linear-gradient(135deg,#1a1030,#0a0820)' }}>
            <Music size={64} style={{ color: '#333' }} />
          </div>
          <p className="text-white font-bold text-lg">Nothing playing</p>
          <p className="text-sm" style={{ color: '#555' }}>Add a song to get started</p>
        </div>
      ) : (
        // Square art box — glass overlay sits inside at the bottom
        <div className="relative rounded-3xl overflow-hidden"
          style={{
            // Square: width fills available space, height matches
            width: '100%',
            maxWidth: 480,
            aspectRatio: '1',
            boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          }}>

          {/* Album art — fills the square */}
          {np?.thumbnailUrl ? (
            <img
              src={np.thumbnailUrl}
              alt={np?.title ?? ''}
              className="absolute inset-0 w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
            />
          ) : (
            <div className="absolute inset-0"
              style={{ background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <Music size={72} style={{ color: '#7c3aed' }} />
              </div>
            </div>
          )}

          {/* Dark vignette at bottom so controls are readable */}
          <div className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.80) 0%, rgba(0,0,0,0.10) 45%, transparent 100%)' }} />

          {/* Frosted glass controls — pinned inside the square at the bottom */}
          <div
            className="absolute left-3 right-3 bottom-3 rounded-2xl px-4 py-3 space-y-2.5"
            style={{
              background: 'rgba(10,8,20,0.60)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.09)',
              boxShadow: '0 2px 20px rgba(0,0,0,0.4)',
            }}
          >
            {/* Title + artist + badge */}
            <div className="min-w-0">
              <p className="font-bold text-white text-sm leading-tight truncate" title={np?.title}>
                {np?.title ?? '—'}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="text-xs truncate" style={{ color: '#bbb' }}>{np?.artist ?? '—'}</p>
                {np?.source && <SourceBadge source={np.source} />}
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-1">
              <div
                ref={progressRef}
                onClick={handleSeek}
                className={cn('relative h-1.5 rounded-full overflow-hidden', active && 'cursor-pointer')}
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
              <div className="flex justify-between text-[10px]" style={{ color: '#888' }}>
                <span>{fmtTime(localPos)}</span>
                <span>{fmtTime(localLen)}</span>
              </div>
            </div>

            {/* Transport */}
            <div className="flex items-center justify-center gap-4">
              <button onClick={handleStop}
                className="flex items-center justify-center rounded-full transition-all hover:scale-110"
                style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.08)', color: '#888' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}>
                <Square size={14} />
              </button>

              <button onClick={handlePause}
                className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
                style={{
                  width: 52, height: 52, background: '#fff',
                  boxShadow: '0 0 0 5px rgba(168,85,247,0.22), 0 4px 16px rgba(0,0,0,0.4)',
                }}>
                {isPlaying
                  ? <Pause size={18} style={{ color: '#000' }} />
                  : <Play  size={18} style={{ color: '#000', marginLeft: 2 }} />}
              </button>

              <button onClick={handleSkip}
                className="flex items-center justify-center rounded-full transition-all hover:scale-110"
                style={{ width: 34, height: 34, background: 'rgba(255,255,255,0.08)', color: '#888' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}>
                <SkipForward size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
