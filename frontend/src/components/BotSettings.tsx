import { useState, useEffect, useCallback } from 'react'
import { ChevronDown, Settings, Check, Shield, Users } from 'lucide-react'
import {
  getTextChannels,
  getAnnouncementChannel,
  setAnnouncementChannel,
  getSongRequestSetting,
  setSongRequestSetting,
  getAdminOnlySetting,
  setAdminOnlySetting,
  type Channel,
} from '@/lib/api'
import { cn } from '@/lib/utils'

interface Props {
  token: string
  guildId: string
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 rounded-full border-2 border-transparent',
        'transition-colors duration-200 focus:outline-none cursor-pointer',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        checked ? 'bg-app-accent' : 'bg-app-border',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow',
          'transition duration-200',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  )
}

export default function BotSettings({ token, guildId }: Props) {
  const [channels, setChannels] = useState<Channel[]>([])
  const [current,  setCurrent]  = useState<string | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const [songRequestsOpen, setSongRequestsOpen] = useState(true)
  const [srSaving,         setSrSaving]         = useState(false)
  const [srSaved,          setSrSaved]          = useState(false)

  const [adminOnly,   setAdminOnly]   = useState(false)
  const [aoSaving,    setAoSaving]    = useState(false)
  const [aoSaved,     setAoSaved]     = useState(false)

  const load = useCallback(async () => {
    if (!guildId) return
    setLoading(true)
    try {
      const [chs, setting, sr, ao] = await Promise.all([
        getTextChannels(token, guildId),
        getAnnouncementChannel(token, guildId),
        getSongRequestSetting(token, guildId).catch(() => ({ open: true })),
        getAdminOnlySetting(token, guildId).catch(() => ({ adminOnly: false })),
      ])
      setChannels(chs)
      setCurrent(setting.announcementChannelId)
      setSongRequestsOpen(sr.open)
      setAdminOnly(ao.adminOnly)
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false)
    }
  }, [token, guildId])

  useEffect(() => { void load() }, [load])

  const handleChannelChange = async (channelId: string) => {
    const value = channelId === '' ? null : channelId
    setCurrent(value)
    setSaving(true)
    setSaved(false)
    try {
      await setAnnouncementChannel(token, guildId, value)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      /* best-effort */
    } finally {
      setSaving(false)
    }
  }

  const handleSongRequests = async (open: boolean) => {
    setSongRequestsOpen(open)
    setSrSaving(true)
    setSrSaved(false)
    try {
      await setSongRequestSetting(token, guildId, open)
      setSrSaved(true)
      setTimeout(() => setSrSaved(false), 2000)
    } catch {
      setSongRequestsOpen(!open)
    } finally {
      setSrSaving(false)
    }
  }

  const handleAdminOnly = async (value: boolean) => {
    setAdminOnly(value)
    setAoSaving(true)
    setAoSaved(false)
    try {
      await setAdminOnlySetting(token, guildId, value)
      setAoSaved(true)
      setTimeout(() => setAoSaved(false), 2000)
    } catch {
      setAdminOnly(!value)
    } finally {
      setAoSaving(false)
    }
  }

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2">
        <Settings size={13} className="text-app-muted" />
        <h2 className="text-xs font-semibold text-app-muted uppercase tracking-widest">
          Bot Settings
        </h2>
      </div>

      {/* Announcement channel */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-app-muted">
          Announcement channel
          <span className="ml-1.5 text-app-border font-normal">
            (where "added via web" messages go)
          </span>
        </label>

        {loading ? (
          <div className="h-8 w-52 rounded-lg bg-app-panel animate-pulse" />
        ) : (
          <div className="flex items-center gap-2">
            <div className="relative w-fit">
              <select
                value={current ?? ''}
                onChange={e => handleChannelChange(e.target.value)}
                disabled={saving}
                className={cn(
                  'appearance-none bg-app-panel border border-app-border rounded-lg',
                  'text-app-text text-sm pl-3 pr-8 py-1.5 cursor-pointer',
                  'focus:outline-none focus:border-app-accent hover:border-app-muted/50',
                  'transition-colors min-w-[200px]',
                  saving && 'opacity-60 cursor-not-allowed',
                )}
              >
                <option value="">⚡ Auto-detect (musicbot → system)</option>
                {channels.map(c => (
                  <option key={c.id} value={c.id}># {c.name}</option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none"
              />
            </div>

            {saved && (
              <span className="flex items-center gap-1 text-xs text-green-400 animate-fade-up">
                <Check size={12} /> Saved
              </span>
            )}
          </div>
        )}

        <p className="text-xs text-app-border leading-relaxed">
          When set to{' '}
          <strong className="text-app-muted">Auto-detect</strong>, the bot looks for a channel
          named <strong className="text-app-muted">#musicbot</strong> first, then falls back to the
          server's system channel.
        </p>
      </div>

      <div className="border-t border-app-border" />

      {/* Command access control */}
      <div className="space-y-3">
        <p className="text-xs font-semibold text-app-muted uppercase tracking-widest">
          Discord command access
        </p>

        {/* Song requests toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Users size={13} className="flex-shrink-0 text-app-muted" />
            <div>
              <p className="text-sm text-app-text">Song requests</p>
              <p className="text-xs text-app-border">
                Allow anyone to use <strong className="text-app-muted">/play</strong> without being an admin
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {srSaved && <Check size={12} className="text-green-400" />}
            <Toggle checked={songRequestsOpen} onChange={handleSongRequests} disabled={srSaving} />
          </div>
        </div>

        {/* Admin only commands toggle */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 min-w-0">
            <Shield size={13} className="flex-shrink-0 text-app-muted" />
            <div>
              <p className="text-sm text-app-text">Admin only commands</p>
              <p className="text-xs text-app-border">
                Restrict all Discord bot commands to server admins only
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {aoSaved && <Check size={12} className="text-green-400" />}
            <Toggle checked={adminOnly} onChange={handleAdminOnly} disabled={aoSaving} />
          </div>
        </div>
      </div>
    </div>
  )
}
