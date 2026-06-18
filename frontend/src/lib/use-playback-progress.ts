import { useRef, useEffect, useCallback } from 'react'
import type { PlayerStatus } from './api'
import { fmtTime } from './utils'

export function usePlaybackProgress(
  status: PlayerStatus | null,
  onPositionChange?: (pos: number) => void,
) {
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

  return { playback, barRef, elapsedRef }
}
