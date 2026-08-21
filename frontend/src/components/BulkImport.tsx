import { useState } from 'react'
import { Upload, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { bulkImport, type Channel } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
  channels: Channel[]
  channelId: string
  onChannelChange: (id: string) => void
  onRefresh: () => void
}

function parseLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  const dashIdx = trimmed.indexOf(' - ')
  if (dashIdx === -1) return trimmed
  const artistsPart = trimmed.slice(0, dashIdx).trim()
  const titlePart   = trimmed.slice(dashIdx + 3).trim()
  const artists = artistsPart.split(',').map(a => a.trim()).join(' ')
  return `${titlePart} ${artists}`
}

// Rendered only inside the admin panel: reaching this component already proves
// the session logged in with the admin password, so it just uses the main token.
export default function BulkImport({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  const lines   = text.split('\n').filter(l => l.trim())
  const queries = lines.map(parseLine).filter((q): q is string => Boolean(q))

  const handleSubmit = async () => {
    if (queries.length === 0) return
    setLoading(true)
    setResult(null)
    try {
      const res = await bulkImport(token, guildId, queries, channelId)
      setResult({ ok: true, msg: `Added ${res.added} song${res.added !== 1 ? 's' : ''} to the queue` })
      setText('')
      onRefresh()
    } catch (err) {
      setResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Bulk Import</h1>
        <p className="text-sm mt-1" style={{ color: '#888' }}>
          Paste songs one per line, they'll all queue up at once.
        </p>
      </div>

      {/* Channel selector */}
      {channels.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-xs text-app-muted whitespace-nowrap">Voice channel</label>
          <div className="relative flex-1">
            <select
              value={channelId}
              onChange={e => onChannelChange(e.target.value)}
              className="input w-full appearance-none pr-8 text-sm"
            >
              {channels.map(c => (
                <option key={c.id} value={c.id}>🔊 {c.name}</option>
              ))}
            </select>
            <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#888' }} />
          </div>
        </div>
      )}

      {/* Textarea */}
      <div className="space-y-2">
        <label className="text-xs text-app-muted">
          One song per line — <code className="bg-app-panel px-1 rounded text-app-accent">Artist - Title</code> or <code className="bg-app-panel px-1 rounded text-app-accent">Artist1,Artist2 - Title</code>
        </label>
        <textarea
          className="input w-full font-mono text-sm resize-none"
          rows={10}
          placeholder={`Bruno Mars - Grenade
Train - Hey, Soul Sister
Rihanna,Calvin Harris - We Found Love
B.o.B,Hayley Williams - Airplanes (feat. Hayley Williams of Paramore)
Maroon 5,Christina Aguilera - Moves Like Jagger`}
          value={text}
          onChange={e => setText(e.target.value)}
          spellCheck={false}
        />
      </div>

      {/* Preview */}
      {queries.length > 0 && (
        <div className="rounded-xl p-4 space-y-2"
          style={{ background: 'rgb(var(--accent-rgb) / 0.06)', border: '1px solid rgb(var(--accent-rgb) / 0.2)' }}>
          <p className="text-xs font-semibold" style={{ color: 'rgb(var(--accent-rgb))' }}>
            {queries.length} song{queries.length !== 1 ? 's' : ''} ready to queue
          </p>
          <ul className="space-y-0.5 max-h-36 overflow-y-auto">
            {queries.slice(0, 25).map((q, i) => (
              <li key={i} className="text-xs text-app-muted truncate">{i + 1}. {q}</li>
            ))}
            {queries.length > 25 && (
              <li className="text-xs" style={{ color: '#555' }}>…and {queries.length - 25} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Submit + result */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSubmit}
          disabled={loading || queries.length === 0}
          className={cn('btn-primary flex items-center gap-2 px-5 py-2.5', loading && 'opacity-60')}
        >
          <Upload size={14} />
          {loading ? 'Adding…' : `Add ${queries.length > 0 ? queries.length : ''} Songs`}
        </button>
        {result && (
          <div className={cn('flex items-center gap-1.5 text-sm', result.ok ? 'text-green-400' : 'text-app-danger')}>
            {result.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            {result.msg}
          </div>
        )}
      </div>
    </div>
  )
}
