import { useState, useEffect } from 'react'
import { Shield, Users, Lock } from 'lucide-react'
import { getSongRequestSetting, setSongRequestSetting } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
  guildName: string
}

export default function Settings({ token, guildId, guildName }: Props) {
  const [songRequestsOpen, setSongRequestsOpen] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!guildId) return
    getSongRequestSetting(token, guildId)
      .then(r => setSongRequestsOpen(r.open))
      .catch(() => null)
  }, [token, guildId])

  const toggle = async (open: boolean) => {
    setSaving(true)
    setSaved(false)
    try {
      await setSongRequestSetting(token, guildId, open)
      setSongRequestsOpen(open)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* non-fatal */ } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
      <div className="flex items-center gap-3">
        <Shield size={20} style={{ color: '#a855f7' }} />
        <div>
          <h1 className="text-lg font-bold text-white">Superadmin Settings</h1>
          <p className="text-xs" style={{ color: '#666' }}>{guildName}</p>
        </div>
      </div>

      <div className="card p-6 space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
          Song Requests
        </h2>

        <div className="flex items-start justify-between gap-6">
          <div className="space-y-1">
            <p className="text-sm font-medium text-white">
              {songRequestsOpen ? 'Open to everyone' : 'Admin only'}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: '#666' }}>
              {songRequestsOpen
                ? 'Anyone with the dashboard URL can add songs to the queue without logging in.'
                : 'Only the admin (logged-in user) can add songs to the queue.'}
            </p>
          </div>

          {songRequestsOpen !== null && (
            <div className="flex gap-2 flex-shrink-0">
              <button
                onClick={() => toggle(true)}
                disabled={saving}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all',
                  songRequestsOpen
                    ? 'border-purple-500/40 text-purple-400'
                    : 'border-app-border text-app-muted hover:border-app-muted/50',
                )}
                style={songRequestsOpen ? { background: 'rgba(168,85,247,0.15)' } : { background: 'transparent' }}
              >
                <Users size={12} /> Everyone
              </button>
              <button
                onClick={() => toggle(false)}
                disabled={saving}
                className={cn(
                  'flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border transition-all',
                  !songRequestsOpen
                    ? 'border-purple-500/40 text-purple-400'
                    : 'border-app-border text-app-muted hover:border-app-muted/50',
                )}
                style={!songRequestsOpen ? { background: 'rgba(168,85,247,0.15)' } : { background: 'transparent' }}
              >
                <Lock size={12} /> Admin only
              </button>
            </div>
          )}
        </div>

        {saved && (
          <p className="text-xs" style={{ color: '#a855f7' }}>Saved.</p>
        )}
      </div>
    </div>
  )
}
