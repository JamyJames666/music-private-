import { useState, useEffect } from 'react'
import { Users, Lock, Sun, Moon, Plus, X } from 'lucide-react'
import { getSongRequestSetting, setSongRequestSetting, type Guild } from '@/lib/api'
import { cn } from '@/lib/utils'

const ACCENT_PRESETS = [
  { label: 'Purple', rgb: '168 85 247',  darkRgb: '147 51 234' },
  { label: 'Blue',   rgb: '59 130 246',  darkRgb: '37 99 235'  },
  { label: 'Cyan',   rgb: '6 182 212',   darkRgb: '8 145 178'  },
  { label: 'Green',  rgb: '34 197 94',   darkRgb: '22 163 74'  },
  { label: 'Orange', rgb: '249 115 22',  darkRgb: '234 88 12'  },
  { label: 'Pink',   rgb: '236 72 153',  darkRgb: '219 39 119' },
]

function applyAccent(preset: typeof ACCENT_PRESETS[number]) {
  document.documentElement.style.setProperty('--accent-rgb', preset.rgb)
  document.documentElement.style.setProperty('--accent-dark-rgb', preset.darkRgb)
  localStorage.setItem('muse_accent', JSON.stringify(preset))
}

interface Props {
  token: string
  guildId: string
  guildName: string
  theme: 'dark' | 'light'
  onThemeChange: (t: 'dark' | 'light') => void
  guilds: Guild[]
  selectedIds: string[]
  onAddGuild: (id: string) => void
  onRemoveGuild: (id: string) => void
  onSetPrimary: (id: string) => void
}

export { applyAccent, ACCENT_PRESETS }

export default function Settings({ token, guildId, guildName, theme, onThemeChange, guilds, selectedIds, onAddGuild, onRemoveGuild, onSetPrimary }: Props) {
  const [songRequestsOpen, setSongRequestsOpen] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [accent, setAccent] = useState<typeof ACCENT_PRESETS[number]>(() => {
    try {
      return JSON.parse(localStorage.getItem('muse_accent') ?? 'null') ?? ACCENT_PRESETS[0]
    } catch {
      return ACCENT_PRESETS[0]
    }
  })

  useEffect(() => {
    if (!guildId) return
    getSongRequestSetting(token, guildId)
      .then(r => setSongRequestsOpen(r.open))
      .catch(() => null)
  }, [token, guildId])

  const toggleSongRequests = async (open: boolean) => {
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

  const handleAccentPick = (preset: typeof ACCENT_PRESETS[number]) => {
    setAccent(preset)
    applyAccent(preset)
  }

  const available = guilds.filter(g => !selectedIds.includes(g.id))

  return (
    <div className="max-w-2xl space-y-6">

      {/* Appearance */}
      <div className="card p-6 space-y-6">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
          Appearance
        </h2>

        {/* Theme */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-white">Theme</p>
            <p className="text-xs mt-0.5" style={{ color: '#666' }}>Switch between dark and light mode</p>
          </div>
          <button
            onClick={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-app-border transition-colors hover:border-app-muted/50"
            style={{ color: '#aaa', background: 'transparent' }}
          >
            {theme === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
            {theme === 'dark' ? 'Dark' : 'Light'}
          </button>
        </div>

        {/* Accent colour */}
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-white">Accent colour</p>
            <p className="text-xs mt-0.5" style={{ color: '#666' }}>Changes buttons, highlights and interactive elements</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            {ACCENT_PRESETS.map(preset => {
              const isActive = accent.rgb === preset.rgb
              const hex = `rgb(${preset.rgb.replace(/ /g, ',')})`
              return (
                <button
                  key={preset.label}
                  onClick={() => handleAccentPick(preset)}
                  title={preset.label}
                  className="w-8 h-8 rounded-full transition-all"
                  style={{
                    background: hex,
                    boxShadow: isActive ? `0 0 0 2px #0e0c1c, 0 0 0 4px ${hex}` : 'none',
                    transform: isActive ? 'scale(1.15)' : 'scale(1)',
                  }}
                />
              )
            })}
          </div>
        </div>
      </div>

      {/* Server management */}
      <div className="card p-6 space-y-4">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: '#888' }}>
          Servers
        </h2>
        <div className="space-y-2">
          {selectedIds.map(id => {
            const g = guilds.find(g => g.id === id)
            const isPrimary = id === selectedIds[0]
            return (
              <div key={id} className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-app-border"
                style={{ background: 'rgba(168,85,247,0.05)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{g?.name ?? id}</span>
                  {isPrimary && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(168,85,247,0.15)', color: '#c084fc' }}>
                      Primary
                    </span>
                  )}
                </div>
                {!isPrimary && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onSetPrimary(id)}
                      className="text-xs px-2 py-0.5 rounded border transition-colors"
                      style={{ borderColor: '#a855f7', color: '#a855f7' }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(168,85,247,0.15)' }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                    >
                      Set primary
                    </button>
                    <button
                      onClick={() => onRemoveGuild(id)}
                      className="text-app-muted hover:text-app-danger transition-colors"
                      title="Remove server"
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {selectedIds.length < 2 && available.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs" style={{ color: '#555' }}>Add a second server to monitor alongside the primary:</p>
            <div className="flex flex-wrap gap-2">
              {available.map(g => (
                <button
                  key={g.id}
                  onClick={() => onAddGuild(g.id)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-app-border text-app-muted hover:text-white hover:border-app-muted/50 transition-colors"
                >
                  <Plus size={11} /> {g.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {selectedIds.length >= 2 && (
          <p className="text-xs" style={{ color: '#555' }}>Maximum of 2 servers reached.</p>
        )}
      </div>

      {/* Song requests */}
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
                onClick={() => toggleSongRequests(true)}
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
                onClick={() => toggleSongRequests(false)}
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

        {saved && <p className="text-xs" style={{ color: '#a855f7' }}>Saved.</p>}
      </div>

      {/* Guild label for context */}
      {guildName && (
        <p className="text-xs text-center" style={{ color: '#444' }}>Settings apply to: {guildName}</p>
      )}
    </div>
  )
}
