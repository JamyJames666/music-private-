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
  viewMode: 'art' | 'video'
  videoStartPos: number
}

export default function NowPlaying({ status, token, guildId, onRefresh, onPositionChange, viewMode, videoStartPos }: Props) {
  const [localPos, setLocalPos] = useState(0)
  const [localLen, setLocalLen] = useState(0)
  const [songUrl,  setSongUrl]  = useState('')
  const tickRef     = useRef<ReturnType<typeof setInterval> | null>(null)
  const ytIframeRef = useRef<HTMLIFrameElement>(null)

  const stopTick = () => { if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null } }

  const seekYT = (pos: number) => {
    ytIframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func: 'seekTo', args: [pos, true] }),
      'https://www.youtube.com',
    )
  }

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
      const diff = srvPos - localPos
      const shouldSync = srvPos > 0 && (diff > 3 || diff < -3) && !(srvPos < 5 && localPos > 10)
      if (shouldSync) {
        setLocalPos(srvPos)
        onPositionChange?.(srvPos)
        seekYT(srvPos)
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
  const videoId = ytIdFromUrl(np?.url)
  const isVideo = viewMode === 'video' && !!videoId

  const handlePause = async () => { await (isPlaying ? pause(token, guildId) : resume(token, guildId)).catch(() => null); onRefresh() }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const progressRef = useRef<HTMLDivElement>(null)
  const handleSeek  = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!active || localLen === 0) return
    const r = progressRef.current?.getBoundingClientRect(); if (!r) return
    const pos = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * localLen)
    setLocalPos(pos)
    seekYT(pos)
    const {seek: seekFn} = await import('@/lib/api')
    await seekFn(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [active, localLen, token, guildId, onRefresh])

  return (
    <div className={cn('relative flex flex-col items-center z-10 w-full', !isVideo && 'max-w-sm mx-auto')}>

      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none transition-opacity duration-700"
        style={{
          top: -10,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 300,
          height: 300,
          background: active
            ? 'radial-gradient(circle, rgba(168,85,247,0.45) 0%, rgba(99,102,241,0.22) 40%, transparent 70%)'
            : 'radial-gradient(circle, rgba(80,40,120,0.15) 0%, transparent 70%)',
          filter: 'blur(50px)',
          borderRadius: '50%',
          zIndex: 0,
          animation: isPlaying ? 'pulse 3s ease-in-out infinite' : 'none',
        }}
      />

      {!active ? (
        <div className="flex flex-col items-center gap-4 py-8 z-10">
          <div
            className="rounded-2xl flex items-center justify-center"
            style={{ width: '100%', maxWidth: 240, aspectRatio: '1', background: 'linear-gradient(135deg,#1a1a2e,#16162a)' }}
          >
            <Music size={56} style={{ color: '#333' }} />
          </div>
          <p className="text-white font-bold text-lg">Nothing playing</p>
          <p className="text-xs" style={{ color: '#555' }}>Add a song to get started</p>
        </div>
      ) : (
        <>
          {/* Media area */}
          <div
            className="relative z-10 mt-2 mb-3 w-full"
            style={isVideo ? { maxWidth: 360, margin: '8px auto 12px' } : { maxWidth: 260 }}
          >
            {isVideo ? (
              <iframe
                ref={ytIframeRef}
                key={`${videoId}-${videoStartPos}`}
                src={`https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1&start=${videoStartPos}&rel=0&modestbranding=1&iv_load_policy=3&enablejsapi=1`}
                className="w-full rounded-xl"
                style={{ aspectRatio: '16/9', border: 'none', display: 'block', boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 24px rgba(168,85,247,0.2)' }}
                allow="autoplay; encrypted-media; fullscreen"
                allowFullScreen
              />
            ) : (
              <>
                {np?.thumbnailUrl ? (
                  <img
                    src={np.thumbnailUrl}
                    alt={np.title}
                    className="w-full rounded-2xl object-cover"
                    style={{
                      aspectRatio: '1',
                      boxShadow: '0 12px 48px rgba(0,0,0,0.7), 0 0 24px rgba(168,85,247,0.2)',
                    }}
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div
                    className="w-full rounded-2xl flex items-center justify-center"
                    style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}
                  >
                    <Music size={56} style={{ color: '#7c3aed' }} />
                  </div>
                )}
                <div className={cn('absolute bottom-3 right-3 flex items-end gap-[3px] h-4', !isPlaying && 'opacity-0')}>
                  <span className="block w-1 rounded-sm animate-bar"   style={{ background: 'rgba(255,255,255,0.8)' }} />
                  <span className="block w-1 rounded-sm animate-bar-2" style={{ background: 'rgba(255,255,255,0.8)' }} />
                  <span className="block w-1 rounded-sm animate-bar-3" style={{ background: 'rgba(255,255,255,0.8)' }} />
                </div>
              </>
            )}
          </div>

          {/* Title + artist */}
          <div className="text-center w-full z-10 px-4" style={{ maxWidth: isVideo ? 360 : 280 }}>
            <p className="font-bold text-white leading-snug truncate" style={{ fontSize: 17 }} title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-1">
              <p className="text-sm truncate" style={{ color: '#888' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full z-10 mt-3 mb-3 px-4" style={{ maxWidth: isVideo ? 360 : 280 }}>
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative rounded-full overflow-hidden', active && 'cursor-pointer')}
              style={{ height: 4, background: 'rgba(255,255,255,0.12)' }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-1000"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, #a855f7, #6366f1)',
                  boxShadow: '0 0 6px rgba(168,85,247,0.6)',
                }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1.5" style={{ color: '#555' }}>
              <span>{fmtTime(localPos)}</span>
              <span>{fmtTime(localLen)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 z-10 mb-1">
            <button
              onClick={handleStop}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 36, height: 36, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Stop"
            >
              <Square size={15} />
            </button>

            <button
              onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
              style={{
                width: 52, height: 52,
                background: '#fff',
                boxShadow: '0 0 0 6px rgba(168,85,247,0.20), 0 6px 24px rgba(0,0,0,0.5)',
              }}
            >
              {isPlaying
                ? <Pause size={20} style={{ color: '#000' }} />
                : <Play  size={20} style={{ color: '#000', marginLeft: 2 }} />}
            </button>

            <button
              onClick={handleSkip}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 36, height: 36, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Skip"
            >
              <SkipForward size={15} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
