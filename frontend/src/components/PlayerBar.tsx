import { useCallback } from 'react'
import { Play, Pause, SkipForward, Square } from 'lucide-react'
import { pause, resume, skip, stop, seek, type PlayerStatus } from '@/lib/api'
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
}

export default function PlayerBar({ status, token, guildId, onRefresh, onPositionChange }: Props) {
  const { playback, barRef, elapsedRef } = usePlaybackProgress(status, onPositionChange)

  const np = status?.nowPlaying ?? null
  const isPlaying = status?.status === 'PLAYING'
  const len = np?.length ?? 0
  const queue = status?.queue ?? []
  const trackIndex = np ? queue.findIndex(t => t.url === np.url) : -1
  const trackNum = trackIndex >= 0 ? trackIndex + 1 : null
  const trackTotal = queue.length

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!len) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    const pos = Math.round(pct * len)
    playback.current.pos = pos
    void seek(token, guildId, pos).then(onRefresh)
  }, [len, token, guildId, onRefresh, playback])

  const call = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn() } catch { /* best-effort */ } finally { onRefresh() }
  }, [onRefresh])

  return (
    <div
      className="fixed bottom-0 inset-x-0 z-40"
      style={{
        background: 'rgba(13,11,28,0.88)',
        backdropFilter: 'blur(20px) saturate(1.8)',
        borderTop: '1px solid rgba(255,255,255,0.07)',
        boxShadow: '0 -8px 40px rgba(0,0,0,0.6)',
      }}
    >
      {/* Progress bar — full width, 3px, RAF-driven */}
      <div
        className="relative h-[3px] cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.08)' }}
        onClick={handleSeek}
      >
        <div
          ref={barRef}
          className="h-full absolute left-0 top-0"
          style={{
            background: 'linear-gradient(90deg, rgb(var(--accent-rgb)), rgb(var(--accent-dark-rgb)))',
            boxShadow: '0 0 6px rgb(var(--accent-rgb) / 0.5)',
            width: '0%',
          }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 h-[69px]">
        {/* Album art */}
        <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-app-panel">
          {np?.thumbnailUrl ? (
            <CrossfadeImage
              src={np.thumbnailUrl}
              alt={np.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{ color: '#444' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
              </svg>
            </div>
          )}
        </div>

        {/* Title + artist */}
        <div className="flex-1 min-w-0 hidden sm:block">
          <div className="text-sm font-medium text-white truncate leading-tight">
            {np?.title ?? 'Nothing playing'}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs truncate" style={{ color: '#888' }}>
              {np?.artist ?? '—'}
            </span>
            {np?.source && <SourceBadge source={np.source} />}
            {trackNum !== null && trackTotal > 0 && (
              <span className="text-[11px] tabular-nums flex-shrink-0" style={{ color: '#555' }}>
                {trackNum}/{trackTotal}
              </span>
            )}
          </div>
        </div>

        {/* Time */}
        <div className="text-xs tabular-nums flex-shrink-0" style={{ color: '#666' }}>
          <span ref={elapsedRef}>0:00</span>
          {len > 0 && <span> / {fmtTime(len)}</span>}
        </div>

        {/* Controls — visible on all sizes */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => void call(() => isPlaying ? pause(token, guildId) : resume(token, guildId))}
            disabled={!np}
            className="w-9 h-9 rounded-full flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
            style={{
              background: np ? 'rgb(var(--accent-rgb) / 0.2)' : 'transparent',
              border: '1px solid rgb(var(--accent-rgb) / 0.4)',
            }}
          >
            {isPlaying
              ? <Pause size={15} fill="currentColor" style={{ color: 'rgb(var(--accent-rgb))' }} />
              : <Play  size={15} fill="currentColor" style={{ color: 'rgb(var(--accent-rgb))', marginLeft: 1 }} />
            }
          </button>
          <button
            onClick={() => void call(() => skip(token, guildId))}
            disabled={!np}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 disabled:opacity-30 text-app-muted hover:text-white"
          >
            <SkipForward size={14} />
          </button>
          <button
            onClick={() => void call(() => stop(token, guildId))}
            disabled={!np}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 disabled:opacity-30 text-app-muted hover:text-red-400"
          >
            <Square size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
