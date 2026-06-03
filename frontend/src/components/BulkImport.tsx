import { useState, useEffect } from 'react'
import { Lock, Upload, CheckCircle, AlertCircle, ChevronDown } from 'lucide-react'
import { bulkLogin, bulkImport, bulkConfigured, type Channel } from '@/lib/api'
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

export default function BulkImport({ token, guildId, channels, channelId, onChannelChange, onRefresh }: Props) {
  const [password,    setPassword]   = useState('')
  const [bulkToken,   setBulkToken]  = useState<string | null>(() => sessionStorage.getItem('bulk_token'))
  const [loginError,  setLoginError] = useState('')
  const [loginBusy,   setLoginBusy]  = useState(false)
  const [serverInfo,  setServerInfo] = useState<{configured: boolean; length: number} | null>(null)

  useEffect(() => {
    bulkConfigured().then(setServerInfo).catch(() => null)
  }, [])

  const [text,    setText]    = useState('')
  const [loading, setLoading] = useState(false)
  const [result,  setResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  const lines   = text.split('\n').filter(l => l.trim())
  const queries = lines.map(parseLine).filter((q): q is string => Boolean(q))

  // ── Login ─────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!password) return
    setLoginBusy(true)
    setLoginError('')
    try {
      const { bulkToken: bt } = await bulkLogin(password)
      setBulkToken(bt)
      sessionStorage.setItem('bulk_token', bt)
      setPassword('')
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoginBusy(false)
    }
  }

  const handleLogout = () => {
    setBulkToken(null)
    sessionStorage.removeItem('bulk_token')
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!bulkToken || queries.length === 0) return
    setLoading(true)
    setResult(null)
    try {
      const res = await bulkImport(token, guildId, queries, channelId, bulkToken)
      setResult({ ok: true, msg: `Added ${res.added} song${res.added !== 1 ? 's' : ''} to the queue` })
      setText('')
      onRefresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed'
      if (msg.includes('401') || msg.toLowerCase().includes('token') || msg.toLowerCase().includes('expired')) {
        // Token expired — force re-login
        handleLogout()
        setResult({ ok: false, msg: 'Session expired — please log in again' })
      } else {
        setResult({ ok: false, msg })
      }
    } finally {
      setLoading(false)
    }
  }

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!bulkToken) {
    return (
      <div className="max-w-sm mx-auto px-6 py-16 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-2xl mx-auto flex items-center justify-center"
            style={{ background: 'rgba(168,85,247,0.15)' }}>
            <Lock size={20} style={{ color: '#a855f7' }} />
          </div>
          <h1 className="text-lg font-bold text-white">Bulk Import</h1>
          <p className="text-sm" style={{ color: '#666' }}>Enter the Bulk Import password to continue</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <input
            type="password"
            className="input w-full"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoFocus
          />
          {loginError && (
            <p className="text-xs text-app-danger">{loginError}</p>
          )}
          <button
            type="submit"
            disabled={loginBusy || !password}
            className="btn-primary w-full py-2.5"
          >
            {loginBusy ? 'Checking…' : 'Unlock'}
          </button>
        </form>

        {/* Server diagnostic */}
        {serverInfo !== null && (
          <div className="text-xs text-center rounded-lg px-3 py-2"
            style={{ background: serverInfo.configured ? 'rgba(34,197,94,0.08)' : 'rgba(244,63,94,0.08)',
                     color: serverInfo.configured ? '#22c55e' : '#f43f5e',
                     border: `1px solid ${serverInfo.configured ? 'rgba(34,197,94,0.2)' : 'rgba(244,63,94,0.2)'}` }}>
            {serverInfo.configured
              ? `✓ Server has BULK_ADD_PASSWORD set (${serverInfo.length} chars)`
              : '✗ Server does not see BULK_ADD_PASSWORD — restart the bot after adding it to .env'}
          </div>
        )}

        <p className="text-xs text-center" style={{ color: '#444' }}>
          Set <code className="bg-app-panel px-1 rounded">BULK_ADD_PASSWORD</code> in <code className="bg-app-panel px-1 rounded">.env</code> to configure
        </p>
      </div>
    )
  }

  // ── Import screen ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Bulk Import</h1>
          <p className="text-sm mt-1" style={{ color: '#888' }}>
            Paste songs one per line — they'll all queue up at once.
          </p>
        </div>
        <button onClick={handleLogout} className="text-xs" style={{ color: '#555' }}>
          Log out
        </button>
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
          style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.2)' }}>
          <p className="text-xs font-semibold" style={{ color: '#a855f7' }}>
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
