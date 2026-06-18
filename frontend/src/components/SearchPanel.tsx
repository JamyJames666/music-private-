import { useState, useRef, useCallback } from 'react'
import { Search, Plus, ArrowUp, Clock, Music } from 'lucide-react'
import { searchSongs, play, type SearchResult } from '@/lib/api'
import { fmtTime, cn } from '@/lib/utils'
import SourceBadge from './SourceBadge'
import { toast } from '@/lib/use-toast'

interface Props {
  token: string
  guildId: string
  channelId: string
  onRefresh: () => void
}

type Source = 'youtube' | 'spotify'

export default function SearchPanel({ token, guildId, channelId, onRefresh }: Props) {
  const [query,   setQuery]   = useState('')
  const [source,  setSource]  = useState<Source>('youtube')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [adding,  setAdding]  = useState<string | null>(null)
  const [added,   setAdded]   = useState<string | null>(null)

  const debounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  const doSearch = useCallback(async (q: string, src: Source) => {
    setLoading(true)
    setError(null)
    try {
      const res = await searchSongs(token, guildId, q, src, 10)
      setResults(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [token, guildId])

  const handleInput = (value: string) => {
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) { setResults([]); setError(null); return }
    debounceRef.current = setTimeout(() => void doSearch(value, source), 400)
  }

  const handleSourceSwitch = (src: Source) => {
    setSource(src)
    if (query.trim()) void doSearch(query, src)
  }

  const handleAdd = useCallback(async (result: SearchResult, insertAt: 'bottom' | 'top') => {
    const key = `${result.url}-${insertAt}`
    setAdding(key)
    try {
      await play(token, guildId, result.url, channelId || undefined, false, insertAt)
      setAdded(key)
      onRefresh()
      toast(insertAt === 'top' ? 'Playing next' : 'Added to queue')
      setTimeout(() => setAdded(null), 2000)
    } catch { /* best-effort */ } finally {
      setAdding(null)
    }
  }, [token, guildId, channelId, onRefresh])

  const btnBase = 'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full transition-all font-medium border'
  const btnActive = 'text-white border-purple-500/60'
  const btnInactive = 'border-white/10 text-app-muted hover:text-white'

  return (
    <div className="flex flex-col h-full">
      {/* Search input + source toggle */}
      <div className="px-5 pt-4 pb-3 space-y-3 flex-shrink-0">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#666' }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => handleInput(e.target.value)}
            placeholder="Search for songs, artists…"
            className="input pl-8 text-sm"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => handleSourceSwitch('youtube')}
            className={cn(btnBase, source === 'youtube' ? btnActive : btnInactive)}
            style={source === 'youtube' ? { background: 'rgb(var(--accent-rgb) / 0.18)' } : {}}
          >
            YouTube
          </button>
          <button
            type="button"
            onClick={() => handleSourceSwitch('spotify')}
            className={cn(btnBase, source === 'spotify' ? btnActive : btnInactive)}
            style={source === 'spotify' ? { background: 'rgb(var(--accent-rgb) / 0.18)' } : {}}
          >
            Spotify
          </button>
        </div>
      </div>

      {/* Results area */}
      <div className="flex-1 overflow-y-auto px-5 pb-5">

        {/* Skeletons */}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex gap-3 p-3 rounded-xl border border-app-border animate-fade-in">
                <div className="skeleton w-14 h-14 rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="skeleton h-3 rounded w-3/4" />
                  <div className="skeleton h-2.5 rounded w-1/2" />
                  <div className="skeleton h-2.5 rounded w-1/4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {!loading && error && (
          <p className="text-sm text-app-danger text-center py-8">{error}</p>
        )}

        {/* Empty / idle state */}
        {!loading && !error && results.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            {query.trim() ? (
              <>
                <Music size={32} style={{ color: '#333' }} />
                <p className="mt-3 text-sm" style={{ color: '#555' }}>No results found</p>
              </>
            ) : (
              <>
                <Search size={32} style={{ color: '#333' }} />
                <p className="mt-3 text-sm" style={{ color: '#555' }}>Search YouTube or Spotify</p>
                <p className="mt-1 text-xs" style={{ color: '#444' }}>
                  Type a song name, artist, or paste a link
                </p>
              </>
            )}
          </div>
        )}

        {/* Result cards */}
        {!loading && results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((result, i) => {
              const addKey  = `${result.url}-bottom`
              const nextKey = `${result.url}-top`
              const isAddingThis  = adding === addKey || adding === nextKey
              const wasAdded      = added === addKey || added === nextKey

              return (
                <div
                  key={i}
                  className="group flex items-center gap-3 p-3 rounded-xl border border-transparent
                             hover:border-app-border hover:bg-white/[0.03] transition-all animate-fade-up"
                >
                  {/* Thumbnail */}
                  <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 bg-app-panel">
                    {result.thumbnailUrl ? (
                      <img
                        src={result.thumbnailUrl}
                        alt={result.title}
                        className="w-full h-full object-cover"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center" style={{ color: '#444' }}>
                        <Music size={18} />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white leading-tight line-clamp-1">{result.title}</p>
                    <p className="text-xs mt-0.5 truncate" style={{ color: '#888' }}>{result.artist}</p>
                    <div className="flex items-center gap-2 mt-1">
                      {result.duration > 0 && (
                        <span className="text-[11px] tabular-nums flex items-center gap-0.5" style={{ color: '#555' }}>
                          <Clock size={9} />
                          {fmtTime(result.duration)}
                        </span>
                      )}
                      <SourceBadge source={result.source} />
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* Play Next */}
                    <button
                      onClick={() => void handleAdd(result, 'top')}
                      disabled={isAddingThis}
                      title="Play next"
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg
                                 border border-white/10 text-app-muted hover:text-white hover:border-white/25
                                 transition-all disabled:opacity-30"
                    >
                      <ArrowUp size={10} />
                      Next
                    </button>

                    {/* Add to queue */}
                    <button
                      onClick={() => void handleAdd(result, 'bottom')}
                      disabled={isAddingThis}
                      title="Add to queue"
                      className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg font-medium
                                 transition-all active:scale-95 disabled:opacity-40"
                      style={wasAdded
                        ? { background: 'rgb(34,197,94,0.15)', color: 'rgb(34,197,94)', border: '1px solid rgb(34,197,94,0.3)' }
                        : { background: 'rgb(var(--accent-rgb) / 0.2)', color: 'rgb(var(--accent-rgb))', border: '1px solid rgb(var(--accent-rgb) / 0.4)' }
                      }
                    >
                      {wasAdded ? '✓' : isAddingThis ? '…' : <><Plus size={10} /> Add</>}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
