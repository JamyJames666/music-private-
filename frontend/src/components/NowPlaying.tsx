import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, SkipForward, Square, Music, Repeat, Repeat1, Volume2 } from 'lucide-react'
import { pause, resume, skip, stop, setVolume, toggleLoopSong, toggleLoopQueue, type PlayerStatus } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'
import CrossfadeImage from './CrossfadeImage'

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
  onPositionChange?: (pos: number) => void
}

export default function NowPlaying({ status, token, guildId, onRefresh, onPositionChange }: Props) {
  const playback   = useRef({ pos: 0, len: 0, rate: 1, playing: false, url: '' })
  const barRef     = useRef<HTMLDivElement>(null)
  const elapsedRef = useRef<HTMLSpanElement>(null)
  const rafRef     = useRef<number | null>(null)
  const lastTsRef  = useRef<number | null>(null)

  const paint = useCallback(() => {
    const pb = playback.current
    const pct = pb.len > 0 ? Math.min(100, (pb.pos / pb.len) * 100) : 0
    if (barRef.current) barRef.current.style.width = `${pct}%`
    if (elapsedRef.current) elapsedRef.current.textContent = fmtTime(pb.pos)
  }, [])

  useEffect(() => {
    const frame = (ts: number) => {
      const pb = playback.current
      if (lastTsRef.current !== null && pb.playing && pb.len > 0) {
        pb.pos = Math.min(pb.pos + ((ts - lastTsRef.current) / 1000) * pb.rate, pb.len)
        paint()
        onPositionChange?.(pb.pos)
      }
      lastTsRef.current = ts
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [paint]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const pb = playback.current
    if (!status?.nowPlaying) {
      pb.playing = false
      pb.pos = 0
      pb.len = 0
      pb.url = ''
      paint()
      return
    }
    const np = status.nowPlaying
    const srvPos = status.position ?? 0
    pb.rate = status.speed ?? 1
    pb.len = np.length
    pb.playing = status.status === 'PLAYING'
    if (np.url !== pb.url) {
      pb.url = np.url
      pb.pos = srvPos
      onPositionChange?.(srvPos)
    } else {
      const diff = srvPos - pb.pos
      const shouldSync = srvPos > 0 && Math.abs(diff) > 3 && !(srvPos < 5 && pb.pos > 10)
      if (shouldSync) {
        pb.pos = srvPos
        onPositionChange?.(srvPos)
      }
    }
    paint()
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null)
  const serverPlaying = status?.status === 'PLAYING'
  useEffect(() => {
    if (optimisticPlaying !== null && serverPlaying === optimisticPlaying) setOptimisticPlaying(null)
  }, [serverPlaying, optimisticPlaying])

  const [optimisticLoop, setOptimisticLoop] = useState<{ song?: boolean; queue?: boolean }>({})
  useEffect(() => {
    setOptimisticLoop(o => {
      const next = { ...o }
      if (o.song !== undefined && status?.loopSong === o.song) delete next.song
      if (o.queue !== undefined && status?.loopQueue === o.queue) delete next.queue
      return next.song === o.song && next.queue === o.queue ? o : next
    })
  }, [status?.loopSong, status?.loopQueue])
  const loopSong  = optimisticLoop.song ?? status?.loopSong ?? false
  const loopQueue = optimisticLoop.queue ?? status?.loopQueue ?? false

  const [optimisticVolume, setOptimisticVolume] = useState<number | null>(null)
  const volTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const serverVolume = status?.volume ?? 100
  useEffect(() => {
    if (optimisticVolume !== null && serverVolume === optimisticVolume) setOptimisticVolume(null)
  }, [serverVolume, optimisticVolume])
  const volume = optimisticVolume ?? serverVolume
  const handleVolume = (v: number) => {
    setOptimisticVolume(v)
    if (volTimer.current) clearTimeout(volTimer.current)
    volTimer.current = setTimeout(() => {
      setVolume(token, guildId, v).then(onRefresh).catch(() => setOptimisticVolume(null))
    }, 250)
  }

  const isPlaying = optimisticPlaying ?? serverPlaying
  const active    = status?.status === 'PLAYING' || status?.status === 'PAUSED'
  const np        = status?.nowPlaying ?? null

  // Live countdown for pause-disconnect and queue-clear timers
  const [, setTick] = useState(0)
  useEffect(() => {
    const hasCountdown = status?.pauseDisconnectsAt || status?.queueClearsAt
    if (!hasCountdown) return
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [status?.pauseDisconnectsAt, status?.queueClearsAt])

  const fmtCountdown = (endsAt: number) => {
    const secs = Math.max(0, Math.round((endsAt - Date.now()) / 1000))
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }
  const pb        = playback.current
  const pct       = pb.len > 0 ? Math.min(100, (pb.pos / pb.len) * 100) : 0

  const handlePause = async () => {
    const wasPlaying = isPlaying
    setOptimisticPlaying(!wasPlaying)
    playback.current.playing = !wasPlaying
    try { await (wasPlaying ? pause(token, guildId) : resume(token, guildId)) }
    catch { setOptimisticPlaying(null); playback.current.playing = wasPlaying }
    onRefresh()
  }
  const handleSkip  = async () => { await skip(token, guildId).catch(() => null); onRefresh() }
  const handleStop  = async () => { await stop(token, guildId).catch(() => null); onRefresh() }

  const handleLoopSong = async () => {
    setOptimisticLoop(o => ({ ...o, song: !loopSong }))
    try { await toggleLoopSong(token, guildId) } catch { setOptimisticLoop(o => ({ ...o, song: undefined })) }
    onRefresh()
  }
  const handleLoopQueue = async () => {
    setOptimisticLoop(o => ({ ...o, queue: !loopQueue }))
    try { await toggleLoopQueue(token, guildId) } catch { setOptimisticLoop(o => ({ ...o, queue: undefined })) }
    onRefresh()
  }

  const progressRef = useRef<HTMLDivElement>(null)
  const handleSeek  = useCallback(async (e: React.MouseEvent<HTMLDivElement>) => {
    const pbc = playback.current
    if (!active || pbc.len === 0) return
    const r = progressRef.current?.getBoundingClientRect(); if (!r) return
    const pos = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * pbc.len)
    pbc.pos = pos
    paint()
    const {seek: seekFn} = await import('@/lib/api')
    await seekFn(token, guildId, pos).catch(() => null)
    onRefresh()
  }, [active, token, guildId, onRefresh, paint])

  const loopBtnStyle = (on: boolean) => on
    ? { width: 32, height: 32, color: 'rgb(var(--accent-rgb))', background: 'rgb(var(--accent-rgb) / 0.15)', border: '1px solid rgb(var(--accent-rgb) / 0.4)' }
    : { width: 32, height: 32, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }

  return (
    <div className="relative flex flex-col items-center z-10 w-full max-w-xl mx-auto">

      {/* Ambient glow */}
      <div
        className="absolute pointer-events-none transition-opacity duration-700"
        style={{
          top: -20,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 520,
          height: 520,
          background: active
            ? 'radial-gradient(circle, rgb(var(--accent-rgb) / 0.45) 0%, rgb(var(--accent-dark-rgb) / 0.22) 40%, transparent 70%)'
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
            className="w-full rounded-3xl flex items-center justify-center"
            style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#1a1a2e,#16162a)' }}
          >
            <Music size={72} style={{ color: '#333' }} />
          </div>
          <p className="text-white font-bold text-xl">Nothing playing</p>
          <p className="text-sm" style={{ color: '#555' }}>Add a song to get started</p>
          {status?.queueClearsAt && (
            <div
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
              style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
            >
              <span style={{ fontSize: 10 }}>🗑</span>
              Queue clears in {fmtCountdown(status.queueClearsAt)}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Album art */}
          <div className="relative z-10 mt-2 mb-2 w-full">
            {np?.thumbnailUrl ? (
              <CrossfadeImage
                src={np.thumbnailUrl}
                alt={np.title}
                className="w-full rounded-3xl"
                style={{
                  aspectRatio: '1',
                  boxShadow: '0 20px 80px rgba(0,0,0,0.8), 0 0 40px rgb(var(--accent-rgb) / 0.25)',
                }}
                imgClassName="rounded-3xl object-contain"
                duration={700}
              />
            ) : (
              <div
                className="w-full rounded-3xl flex items-center justify-center"
                style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}
              >
                <Music size={72} style={{ color: 'rgb(var(--accent-dark-rgb))' }} />
              </div>
            )}
            {/* Animated bars */}
            <div className={cn('absolute bottom-4 right-4 flex items-end gap-[3px] h-5', !isPlaying && 'opacity-0')}>
              <span className="block w-1 rounded-sm animate-bar"   style={{ background: 'rgba(255,255,255,0.8)' }} />
              <span className="block w-1 rounded-sm animate-bar-2" style={{ background: 'rgba(255,255,255,0.8)' }} />
              <span className="block w-1 rounded-sm animate-bar-3" style={{ background: 'rgba(255,255,255,0.8)' }} />
            </div>
          </div>

          {/* Title + artist */}
          <div className="text-center w-full z-10 px-6" style={{ maxWidth: 440 }}>
            <p className="font-bold text-white leading-snug truncate" style={{ fontSize: 17 }} title={np?.title}>
              {np?.title ?? '—'}
            </p>
            <div className="flex items-center justify-center gap-2 mt-0.5">
              <p className="text-sm truncate" style={{ color: '#888' }}>{np?.artist ?? '—'}</p>
              {np?.source && <SourceBadge source={np.source} />}
            </div>
          </div>

          {/* Disconnect / queue-clear countdown pills */}
          {(status?.pauseDisconnectsAt || status?.queueClearsAt) && (
            <div className="flex flex-col items-center gap-1 z-10 mt-1 mb-1">
              {status?.pauseDisconnectsAt && (
                <div
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
                  style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.25)' }}
                >
                  <span style={{ fontSize: 10 }}>⏸</span>
                  Disconnects in {fmtCountdown(status.pauseDisconnectsAt)}
                </div>
              )}
              {status?.queueClearsAt && (
                <div
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full"
                  style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  <span style={{ fontSize: 10 }}>🗑</span>
                  Queue clears in {fmtCountdown(status.queueClearsAt)}
                </div>
              )}
            </div>
          )}

          {/* Progress bar */}
          <div className="w-full z-10 mt-2 mb-3 px-6" style={{ maxWidth: 440 }}>
            <div
              ref={progressRef}
              onClick={handleSeek}
              className={cn('relative rounded-full overflow-hidden', active && 'cursor-pointer')}
              style={{ height: 4, background: 'rgba(255,255,255,0.12)' }}
            >
              <div
                ref={barRef}
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  background: 'linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent-dark-rgb)))',
                  boxShadow: '0 0 6px rgb(var(--accent-rgb) / 0.6)',
                }}
              />
            </div>
            <div className="flex justify-between text-xs mt-1.5" style={{ color: '#555' }}>
              <span ref={elapsedRef}>{fmtTime(pb.pos)}</span>
              <span>{fmtTime(np?.length ?? 0)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-4 z-10">
            <button
              onClick={handleLoopQueue}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={loopBtnStyle(loopQueue)}
              title={loopQueue ? 'Loop queue: on' : 'Loop queue: off'}
            >
              <Repeat size={13} />
            </button>

            <button
              onClick={handleStop}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 36, height: 36, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Stop"
            >
              <Square size={14} />
            </button>

            <button
              onClick={handlePause}
              className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95"
              style={{
                width: 54, height: 54,
                background: '#fff',
                boxShadow: '0 0 0 6px rgb(var(--accent-rgb) / 0.20), 0 6px 24px rgba(0,0,0,0.5)',
              }}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            >
              {isPlaying
                ? <Pause size={18} style={{ color: '#000' }} />
                : <Play  size={18} style={{ color: '#000', marginLeft: 2 }} />}
            </button>

            <button
              onClick={handleSkip}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 36, height: 36, color: '#555', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#555' }}
              title="Skip (N)"
            >
              <SkipForward size={14} />
            </button>

            <button
              onClick={handleLoopSong}
              className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={loopBtnStyle(loopSong)}
              title={loopSong ? 'Loop song: on' : 'Loop song: off'}
            >
              <Repeat1 size={13} />
            </button>
          </div>

          {/* Volume */}
          <div className="flex items-center gap-2.5 z-10 mt-3 w-full px-6" style={{ maxWidth: 440 }}>
            <Volume2 size={14} style={{ color: '#666' }} className="flex-shrink-0" />
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={e => handleVolume(Number(e.target.value))}
              className="vol-slider flex-1"
              style={{ '--vol': `${volume}%` } as React.CSSProperties}
              aria-label="Volume"
            />
            <span className="text-xs tabular-nums w-9 text-right flex-shrink-0" style={{ color: '#666' }}>{volume}%</span>
          </div>
        </>
      )}
    </div>
  )
}
