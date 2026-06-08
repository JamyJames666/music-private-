import { useState, type FormEvent } from 'react'
import { Plus, ChevronDown, Music, Film, ArrowDown, ArrowUp, Hash } from 'lucide-react'
import { play, type Channel } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
  channels: Channel[]
  channelId: string
  onChannelChange: (id: string) => void
  onRefresh: () => void
}

type VideoType  = 'lyric' | 'music' | null
type InsertMode = 'bottom' | 'top' | 'custom'

export default function AddToQueue({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [query,      setQuery]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const [status,     setStatus]     = useState<{ ok: boolean; msg: string } | null>(null)

  const [videoType, setVideoType] = useState<VideoType>(() => {
    const s = localStorage.getItem('muse_video_type')
    return (s === 'lyric' || s === 'music') ? s : null
  })

  const [insertMode,   setInsertMode]   = useState<InsertMode>(() =>
    (localStorage.getItem('muse_insert_mode') as InsertMode) ?? 'bottom',
  )
  const [customPos, setCustomPos] = useState(1)

  const saveVideoType = (t: VideoType) => {
    setVideoType(t)
    if (t) {
      localStorage.setItem('muse_video_type', t)
    } else {
      localStorage.removeItem('muse_video_type')
    }
  }

  const saveInsertMode = (m: InsertMode) => {
    setInsertMode(m)
    localStorage.setItem('muse_insert_mode', m)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q || !guildId || !videoType) return

    setLoading(true)
    setStatus(null)

    const lyricVideo = videoType === 'lyric'
    const insertAt: 'top' | 'bottom' | number =
      insertMode === 'top'    ? 'top' :
      insertMode === 'custom' ? Math.max(1, customPos) :
      'bottom'

    try {
      const res = await play(token, guildId, q, channelId || undefined, lyricVideo, insertAt)
      const pendingMsg = (res.pending ?? 0) > 0 ? ` · ${res.pending} lazy` : ''
      setStatus({ ok: true, msg: `Added ${res.added} songs (${res.queued ?? res.added} queued${pendingMsg}) — ${res.first}` })
      setQuery('')
      setTimeout(() => setStatus(null), 4000)
      onRefresh()
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Failed to add.' })
    } finally {
      setLoading(false)
    }
  }

  const btnBase = 'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-all font-medium border'
  const btnActive = 'text-white border-purple-500/60' // background set inline
  const btnInactive = 'border-white/10 text-gray-500'

  return (
    <div className="card p-3 space-y-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
        Add to queue
      </h2>

      {/* Required: video type */}
      <div className="space-y-1">
        <p className="text-xs" style={{ color: '#666' }}>Video type <span style={{ color: '#a855f7' }}>*</span></p>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => saveVideoType('lyric')}
            className={cn(btnBase, videoType === 'lyric' ? btnActive : btnInactive)}
            style={videoType === 'lyric' ? { background: 'rgba(168,85,247,0.25)' } : {}}
          >
            <Music size={10} /> Lyric video
          </button>
          <button
            type="button"
            onClick={() => saveVideoType('music')}
            className={cn(btnBase, videoType === 'music' ? btnActive : btnInactive)}
            style={videoType === 'music' ? { background: 'rgba(168,85,247,0.25)' } : {}}
          >
            <Film size={10} /> Music video
          </button>
        </div>
      </div>

      {/* Channel + queue position */}
      <div className="flex flex-wrap items-center gap-2">
        {channels.length > 0 && (
          <div className="relative">
            <select
              value={channelId}
              onChange={e => onChannelChange(e.target.value)}
              className="appearance-none bg-app-panel border border-app-border rounded-lg
                         text-app-text text-xs pl-2.5 pr-7 py-1.5 cursor-pointer
                         focus:outline-none focus:border-app-accent transition-colors"
              style={{ minWidth: 120 }}
            >
              {channels.map(c => (
                <option key={c.id} value={c.id}>🔊 {c.name}</option>
              ))}
            </select>
            <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#888' }} />
          </div>
        )}

        {/* Queue position */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => saveInsertMode('bottom')}
            title="Add to end of queue"
            className={cn(btnBase, insertMode === 'bottom' ? btnActive : btnInactive)}
            style={insertMode === 'bottom' ? { background: 'rgba(168,85,247,0.25)' } : {}}
          >
            <ArrowDown size={10} /> End
          </button>
          <button
            type="button"
            onClick={() => saveInsertMode('top')}
            title="Play next (top of queue)"
            className={cn(btnBase, insertMode === 'top' ? btnActive : btnInactive)}
            style={insertMode === 'top' ? { background: 'rgba(168,85,247,0.25)' } : {}}
          >
            <ArrowUp size={10} /> Next
          </button>
          <button
            type="button"
            onClick={() => saveInsertMode('custom')}
            title="Insert at specific queue position"
            className={cn(btnBase, insertMode === 'custom' ? btnActive : btnInactive)}
            style={insertMode === 'custom' ? { background: 'rgba(168,85,247,0.25)' } : {}}
          >
            <Hash size={10} /> Pos
          </button>
          {insertMode === 'custom' && (
            <input
              type="number"
              min={1}
              value={customPos}
              onChange={e => setCustomPos(Math.max(1, Number(e.target.value)))}
              className="input text-xs w-14 py-1 px-2 text-center"
              style={{ height: 26 }}
            />
          )}
        </div>
      </div>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          type="text"
          className="input flex-1 text-sm"
          placeholder="Song name or link (YouTube or Spotify)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button
          type="submit"
          disabled={loading || !query.trim() || !videoType}
          className="btn-primary flex items-center gap-1 px-3 py-1.5 whitespace-nowrap text-sm"
        >
          <Plus size={13} />
          {loading ? 'Adding…' : 'Add'}
        </button>
      </form>

      {!videoType && query.trim() && (
        <p className="text-xs" style={{ color: '#a855f7' }}>Select a video type above to add</p>
      )}

      {status && (
        <p className={cn('text-xs animate-fade-up', status.ok ? 'text-app-muted' : 'text-app-danger')}>
          {status.msg}
        </p>
      )}
    </div>
  )
}
