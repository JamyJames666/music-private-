import { useState } from 'react'
import { Lock, Upload, CheckCircle, AlertCircle } from 'lucide-react'
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

// Parse a line like "B.o.B,Hayley Williams - Airplanes (feat. ...)"
// into a ytsearch query: "Airplanes (feat. ...) B.o.B Hayley Williams"
function parseLine(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed) return null

  const dashIdx = trimmed.indexOf(' - ')
  if (dashIdx === -1) {
    // No dash — treat the whole line as a search query
    return trimmed
  }

  const artistsPart = trimmed.slice(0, dashIdx).trim()
  const titlePart   = trimmed.slice(dashIdx + 3).trim()
  // Normalise "Artist1,Artist2" → "Artist1 Artist2"
  const artists = artistsPart.split(',').map(a => a.trim()).join(' ')
  return `${titlePart} ${artists}`
}

export default function BulkImport({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [password,   setPassword]   = useState('')
  const [unlocked,   setUnlocked]   = useState(false)
  const [wrongPw,    setWrongPw]    = useState(false)
  const [text,       setText]       = useState('')
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState<{ ok: boolean; msg: string } | null>(null)

  const lines   = text.split('\n').filter(l => l.trim())
  const queries = lines.map(parseLine).filter((q): q is string => Boolean(q))

  // Password is validated for real on submit — just unlock locally on enter
  const tryUnlock = () => {
    if (password.trim()) {
      setUnlocked(true)
      setWrongPw(false)
    }
  }

  const handleSubmit = async () => {
    if (queries.length === 0) return
    setLoading(true)
    setResult(null)
    try {
      const res = await bulkImport(token, guildId, queries, channelId, password)
      setResult({ ok: true, msg: `Added ${res.added} song${res.added !== 1 ? 's' : ''} to the queue` })
      setText('')
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed'
      if (msg.toLowerCase().includes('password') || msg.includes('401')) {
        setUnlocked(false)
        setWrongPw(true)
        setResult({ ok: false, msg: 'Wrong password — enter it again' })
      } else {
        setResult({ ok: false, msg })
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Bulk Import</h1>
        <p className="text-sm mt-1" style={{ color: '#888' }}>
          Paste a list of songs — one per line — and add them all to the queue at once.
        </p>
      </div>

      {/* Password gate */}
      {!unlocked ? (
        <div className="card p-6 space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium" style={{ color: '#a855f7' }}>
            <Lock size={14} /> Enter the Bulk Import password to continue
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              className="input flex-1"
              placeholder="Password…"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && tryUnlock()}
            />
            <button
              onClick={tryUnlock}
              disabled={!password}
              className="btn-primary px-4 py-2"
            >
              Unlock
            </button>
          </div>
          {wrongPw && (
            <p className="text-xs text-app-danger">Wrong password — try again.</p>
          )}
          <p className="text-xs" style={{ color: '#555' }}>
            Set <code className="bg-app-panel px-1 rounded">BULK_ADD_PASSWORD</code> in your <code className="bg-app-panel px-1 rounded">.env</code> to configure this.
          </p>
        </div>
      ) : (
        <>
          {/* Channel selector */}
          {channels.length > 0 && (
            <div className="flex items-center gap-3">
              <label className="text-xs text-app-muted whitespace-nowrap">Voice channel</label>
              <select
                value={channelId}
                onChange={e => onChannelChange(e.target.value)}
                className="input text-sm flex-1"
              >
                {channels.map(c => (
                  <option key={c.id} value={c.id}>🔊 {c.name}</option>
                ))}
              </select>
            </div>
          )}

          {/* Song list textarea */}
          <div className="space-y-2">
            <label className="text-xs text-app-muted">
              Song list — one per line in <code className="bg-app-panel px-1 rounded text-app-accent">Artist - Title</code> format
            </label>
            <textarea
              className="input w-full font-mono text-sm resize-none"
              rows={12}
              placeholder={`B.o.B,Hayley Williams - Airplanes (feat. Hayley Williams of Paramore)
Train - Hey, Soul Sister
Rihanna,Calvin Harris - We Found Love
Bruno Mars - Grenade
Maroon 5 - One More Night`}
              value={text}
              onChange={e => setText(e.target.value)}
              spellCheck={false}
            />
            <p className="text-xs" style={{ color: '#555' }}>
              Multiple artists: separate with commas. No dash? The line is used as a raw search.
            </p>
          </div>

          {/* Preview + submit */}
          {queries.length > 0 && (
            <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
              <p className="text-xs font-semibold" style={{ color: '#a855f7' }}>
                {queries.length} song{queries.length !== 1 ? 's' : ''} ready to queue
              </p>
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {queries.slice(0, 20).map((q, i) => (
                  <li key={i} className="text-xs text-app-muted truncate">
                    {i + 1}. {q}
                  </li>
                ))}
                {queries.length > 20 && (
                  <li className="text-xs" style={{ color: '#555' }}>…and {queries.length - 20} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={handleSubmit}
              disabled={loading || queries.length === 0}
              className={cn('btn-primary flex items-center gap-2 px-5 py-2.5', loading && 'opacity-60')}
            >
              <Upload size={14} />
              {loading ? 'Adding…' : `Add ${queries.length || ''} Songs`}
            </button>
            {result && (
              <div className={cn('flex items-center gap-1.5 text-sm', result.ok ? 'text-green-400' : 'text-app-danger')}>
                {result.ok ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                {result.msg}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
