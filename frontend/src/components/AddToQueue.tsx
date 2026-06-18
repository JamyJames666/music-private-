import { useState, type FormEvent } from 'react'
import { Plus, ChevronDown, ArrowDown, ArrowUp, Hash } from 'lucide-react'
import { play, moveChannel, type Channel } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
  channels: Channel[]
  channelId: string
  onChannelChange: (id: string) => void
  onRefresh: () => void
  activeChannelIds: string[]
}

type InsertMode = 'bottom' | 'top' | 'custom'

export default function AddToQueue({ token, guildId, channels, channelId, onChannelChange, onRefresh, activeChannelIds }: Props) {
  const [query,   setQuery]   = useState('')
  const [loading, setLoading] = useState(false)
  const [status,  setStatus]  = useState<{ ok: boolean; msg: string } | null>(null)

  const [insertMode, setInsertMode] = useState<InsertMode>(() =>
    (localStorage.getItem('muse_insert_mode') as InsertMode) ?? 'bottom',
  )
  const [customPos, setCustomPos] = useState(1)

  const saveInsertMode = (m: InsertMode) => {
    setInsertMode(m)
    localStorage.setItem('muse_insert_mode', m)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q || !guildId) return

    setLoading(true)
    setStatus(null)

    const insertAt: 'top' | 'bottom' | number =
      insertMode === 'top'    ? 'top' :
      insertMode === 'custom' ? Math.max(1, customPos) :
      'bottom'

    try {
      const res = await play(token, guildId, q, channelId || undefined, false, insertAt)
      setStatus({ ok: true, msg: `Added ${res.added} song${res.added === 1 ? '' : 's'} — ${res.first}` })
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
  const btnActive = 'text-white border-purple-500/60'
  const btnInactive = 'border-white/10 text-gray-500'

  return (
    <div className="card p-3 space-y-2.5">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
        Add to queue
      </h2>

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
            style={insertMode === 'bottom' ? { background: 'rgb(var(--accent-rgb) / 0.25)' } : {}}
          >
            <ArrowDown size={10} /> End
          </button>
          <button
            type="button"
            onClick={() => saveInsertMode('top')}
            title="Play next (top of queue)"
            className={cn(btnBase, insertMode === 'top' ? btnActive : btnInactive)}
            style={insertMode === 'top' ? { background: 'rgb(var(--accent-rgb) / 0.25)' } : {}}
          >
            <ArrowUp size={10} /> Next
          </button>
          <button
            type="button"
            onClick={() => saveInsertMode('custom')}
            title="Insert at specific queue position"
            className={cn(btnBase, insertMode === 'custom' ? btnActive : btnInactive)}
            style={insertMode === 'custom' ? { background: 'rgb(var(--accent-rgb) / 0.25)' } : {}}
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
      <form onSubmit={handleSubmit} className="flex gap-2 items-start">
        <textarea
          rows={Math.min(Math.max(1, query.split('\n').filter(Boolean).length), 6)}
          className="input flex-1 text-sm resize-none leading-relaxed"
          placeholder="Song name or link (YouTube or Spotify)…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && query.split('\n').filter(Boolean).length <= 1) {
              e.preventDefault()
              void handleSubmit(e as unknown as FormEvent)
            }
          }}
        />
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="btn-primary flex items-center gap-1 px-3 py-1.5 whitespace-nowrap text-sm"
        >
          <Plus size={13} />
          {loading ? 'Adding…' : 'Add'}
        </button>
      </form>

      {(() => {
        const trackCount = query.split('\n').filter(l => l.trim()).length
        if (trackCount > 1) {
          return (
            <p className="text-xs font-medium" style={{ color: 'rgb(var(--accent-rgb))' }}>
              {trackCount} tracks detected — click Add to queue them all
            </p>
          )
        }

        return (
          <p className="text-xs" style={{ color: '#4a4860' }}>
            Tip: paste multiple links or names (one per line). On Spotify, Ctrl+A then Ctrl+C to copy all tracks from a playlist.
          </p>
        )
      })()}

      {status && (
        <p className={cn('text-xs animate-fade-up', status.ok ? 'text-app-muted' : 'text-app-danger')}>
          {status.msg}
        </p>
      )}

      {/* Switch channel */}
      {channels.length > 0 && (
        <div className="pt-2 border-t space-y-1.5" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>Switch channel</p>
          <div className="flex flex-wrap gap-1.5">
            {channels.map(c => {
              const active = activeChannelIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => moveChannel(token, guildId, c.id).then(onRefresh).catch(() => null)}
                  className="text-xs px-2.5 py-1 rounded-lg border transition-all"
                  style={active
                    ? { background: 'rgb(var(--accent-rgb) / 0.15)', color: 'rgb(var(--accent-rgb))', borderColor: 'rgb(var(--accent-rgb) / 0.4)' }
                    : { background: 'transparent', color: '#666', borderColor: '#333' }}
                >
                  🔊 {c.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
