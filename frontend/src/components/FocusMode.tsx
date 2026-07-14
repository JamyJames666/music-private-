import { useState, useEffect, useCallback } from 'react'
import { X, Play, Pause, SkipForward, Square, Repeat, Repeat1, Minimize2, Maximize2 } from 'lucide-react'
import { pause, resume, skip, stop, toggleLoopSong, toggleLoopQueue, type PlayerStatus } from '@/lib/api'
import { fmtTime } from '@/lib/utils'
import { usePlaybackProgress } from '@/lib/use-playback-progress'
import CrossfadeImage from './CrossfadeImage'
import SourceBadge from './SourceBadge'

interface Props {
  status: PlayerStatus | null
  token: string
  guildId: string
  onRefresh: () => void
  onPositionChange?: (pos: number) => void
  onClose: () => void
}

export default function FocusMode({ status, token, guildId, onRefresh, onPositionChange, onClose }: Props) {
  const { playback, barRef, elapsedRef } = usePlaybackProgress(status, onPositionChange)
  const [minimal, setMinimal] = useState(() => localStorage.getItem('muse_focus_minimal') === 'true')

  useEffect(() => {
    localStorage.setItem('muse_focus_minimal', String(minimal))
  }, [minimal])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const np = status?.nowPlaying ?? null
  const len = np?.length ?? 0

  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null)
  const serverPlaying = status?.status === 'PLAYING'
  useEffect(() => {
    if (optimisticPlaying !== null && serverPlaying === optimisticPlaying) setOptimisticPlaying(null)
  }, [serverPlaying, optimisticPlaying])
  const isPlaying = optimisticPlaying ?? serverPlaying

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

  const handlePlayPause = useCallback(async () => {
    const wasPlaying = isPlaying
    setOptimisticPlaying(!wasPlaying)
    playback.current.playing = !wasPlaying
    try { await (wasPlaying ? pause(token, guildId) : resume(token, guildId)) }
    catch { setOptimisticPlaying(null); playback.current.playing = wasPlaying }
    onRefresh()
  }, [isPlaying, playback, token, guildId, onRefresh])

  const handleSkip = useCallback(async () => { await skip(token, guildId).catch(() => null); onRefresh() }, [token, guildId, onRefresh])
  const handleStop = useCallback(async () => { await stop(token, guildId).catch(() => null); onRefresh() }, [token, guildId, onRefresh])

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

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!len) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const pos = Math.round(pct * len)
    playback.current.pos = pos
    void import('@/lib/api').then(({ seek }) => seek(token, guildId, pos)).then(onRefresh)
  }, [len, token, guildId, onRefresh, playback])

  const loopBtnStyle = (on: boolean) => on
    ? { color: 'rgb(var(--accent-rgb))', background: 'rgb(var(--accent-rgb) / 0.15)', border: '1px solid rgb(var(--accent-rgb) / 0.4)' }
    : { color: '#666', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center animate-fade-in"
      style={{ background: 'rgba(6,5,14,0.97)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Ambient blurred backdrop from the current art */}
      {np?.thumbnailUrl && (
        <CrossfadeImage
          src={np.thumbnailUrl}
          className="absolute inset-0 pointer-events-none"
          imgStyle={{ filter: 'blur(100px) saturate(2.2) brightness(0.7)', opacity: 0.35, transform: 'scale(1.15)' }}
          duration={900}
        />
      )}

      {/* Top-right controls */}
      <div className="absolute top-5 right-5 z-10 flex items-center gap-2">
        <button
          onClick={() => setMinimal(m => !m)}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
          style={{ color: '#999', background: 'rgba(255,255,255,0.08)' }}
          title={minimal ? 'Show controls' : 'Minimal mode'}
        >
          {minimal ? <Maximize2 size={15} /> : <Minimize2 size={15} />}
        </button>
        <button
          onClick={onClose}
          className="w-9 h-9 rounded-full flex items-center justify-center transition-all hover:scale-105"
          style={{ color: '#999', background: 'rgba(255,255,255,0.08)' }}
          title="Close (Esc)"
        >
          <X size={16} />
        </button>
      </div>

      <div className="relative z-10 flex flex-col items-center w-full px-6" style={{ maxWidth: 480 }}>
        {/* Album art */}
        {np?.thumbnailUrl ? (
          <CrossfadeImage
            src={np.thumbnailUrl}
            alt={np.title}
            className="w-full rounded-3xl"
            style={{ aspectRatio: '1', boxShadow: '0 30px 100px rgba(0,0,0,0.85), 0 0 60px rgb(var(--accent-rgb) / 0.3)' }}
            imgClassName="rounded-3xl object-contain"
            duration={700}
          />
        ) : (
          <div className="w-full rounded-3xl flex items-center justify-center"
            style={{ aspectRatio: '1', background: 'linear-gradient(135deg,#2a1060,#1a1040)' }}>
            <Play size={72} style={{ color: 'rgb(var(--accent-dark-rgb))' }} />
          </div>
        )}

        {!minimal && (
          <>
            {/* Title + artist */}
            <div className="text-center w-full mt-5">
              <p className="font-bold text-white leading-snug truncate" style={{ fontSize: 20 }} title={np?.title}>
                {np?.title ?? 'Nothing playing'}
              </p>
              <div className="flex items-center justify-center gap-2 mt-1">
                <p className="text-sm truncate" style={{ color: '#999' }}>{np?.artist ?? '—'}</p>
                {np?.source && <SourceBadge source={np.source} />}
              </div>
            </div>

            {/* Progress bar */}
            <div className="w-full mt-4">
              <div
                onClick={handleSeek}
                className="relative rounded-full overflow-hidden cursor-pointer"
                style={{ height: 4, background: 'rgba(255,255,255,0.12)' }}
              >
                <div
                  ref={barRef}
                  className="h-full rounded-full"
                  style={{ width: '0%', background: 'linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent-dark-rgb)))', boxShadow: '0 0 6px rgb(var(--accent-rgb) / 0.6)' }}
                />
              </div>
              <div className="flex justify-between text-xs mt-1.5" style={{ color: '#666' }}>
                <span ref={elapsedRef}>0:00</span>
                <span>{fmtTime(len)}</span>
              </div>
            </div>
          </>
        )}

        {/* Controls */}
        <div className="flex items-center gap-4 mt-6">
          {!minimal && (
            <button onClick={handleLoopQueue} className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ ...loopBtnStyle(loopQueue), width: 32, height: 32 }} title={loopQueue ? 'Loop queue: on' : 'Loop queue: off'}>
              <Repeat size={13} />
            </button>
          )}

          {!minimal && (
            <button onClick={handleStop} className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ width: 36, height: 36, color: '#666', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
              title="Stop">
              <Square size={14} />
            </button>
          )}

          <button
            onClick={() => void handlePlayPause()}
            disabled={!np}
            className="flex items-center justify-center rounded-full transition-all hover:scale-105 active:scale-95 disabled:opacity-30"
            style={{ width: 60, height: 60, background: '#fff', boxShadow: '0 0 0 6px rgb(var(--accent-rgb) / 0.20), 0 6px 24px rgba(0,0,0,0.5)' }}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? <Pause size={20} style={{ color: '#000' }} /> : <Play size={20} style={{ color: '#000', marginLeft: 2 }} />}
          </button>

          <button
            onClick={() => void handleSkip()}
            disabled={!np}
            className="flex items-center justify-center rounded-full transition-all hover:scale-110 disabled:opacity-30"
            style={{ width: 36, height: 36, color: '#666', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}
            title="Skip (N)"
          >
            <SkipForward size={14} />
          </button>

          {!minimal && (
            <button onClick={handleLoopSong} className="flex items-center justify-center rounded-full transition-all hover:scale-110"
              style={{ ...loopBtnStyle(loopSong), width: 32, height: 32 }} title={loopSong ? 'Loop song: on' : 'Loop song: off'}>
              <Repeat1 size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
