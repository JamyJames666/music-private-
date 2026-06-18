import { useState, useCallback, useMemo, useEffect, useRef, memo } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Shuffle, GripVertical, X, Music, Trash2, ListMusic,
  ChevronsUp, Search, LogOut, SkipForward,
} from 'lucide-react'
import { shuffle, clearQueue, move, remove, disconnect, skip, type TrackInfo } from '@/lib/api'
import { fmtTime, fmtDuration, cn } from '@/lib/utils'
import { toast } from '@/lib/use-toast'
// fmtDuration kept for compatibility
const _fmtDuration = fmtTime; void _fmtDuration
import SourceBadge from './SourceBadge'

const PAGE_SIZE = 99999 // no pagination — one scrollable list

function getHighQualityThumb(url: string | null): string | null {
  if (!url) return null
  if (url.includes('ytimg.com') && url.includes('mqdefault')) {
    return url.replace('mqdefault', 'hqdefault')
  }
  return url
}

// Deterministic color gradient from title string
function titleToGradient(title: string): string {
  let hash = 0
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0
  }
  const hue = Math.abs(hash) % 360
  const hue2 = (hue + 40) % 360
  return `linear-gradient(135deg, hsl(${hue},55%,28%) 0%, hsl(${hue2},50%,20%) 100%)`
}

// ── Row ───────────────────────────────────────────────────────────────────────

interface RowProps {
  id: string
  item: TrackInfo
  index: number
  displayNumber: number
  onRemove: (index: number) => void
  onMoveToTop: (index: number) => void
  draggable: boolean
  isUpNext?: boolean
}

const QueueRow = memo(function QueueRow({ id, item, index, displayNumber, onRemove, onMoveToTop, draggable, isUpNext }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !draggable })

  const [thumbSrc, setThumbSrc] = useState<string | null>(getHighQualityThumb(item.thumbnailUrl))

  useEffect(() => {
    setThumbSrc(getHighQualityThumb(item.thumbnailUrl))
  }, [item.thumbnailUrl])

  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={{ ...style }}
      className={cn(
        'flex items-center gap-3 px-3 py-3.5 rounded-xl transition-all duration-100 group border-l-2 border-transparent',
        isDragging ? 'opacity-40' : 'hover:bg-app-panel hover:border-l-purple-500/40',
      )}
    >
      {/* Queue number */}
      <span className="text-xs tabular-nums w-5 text-right flex-shrink-0 font-mono"
        style={{ color: '#555' }}>
        {displayNumber}
      </span>

      {/* Up next badge */}
      {isUpNext && (
        <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded flex-shrink-0"
          style={{ background: 'rgb(var(--accent-rgb) / 0.15)', color: 'rgb(var(--accent-rgb))' }}>
          Up next
        </span>
      )}

      {/* Drag handle */}
      {draggable && (
        <button
          className="flex-shrink-0 cursor-grab active:cursor-grabbing touch-none opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: '#555' }}
          {...attributes}
          {...listeners}
          aria-label="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
      )}

      {/* Thumbnail */}
      {thumbSrc ? (
        <img
          src={thumbSrc}
          alt=""
          loading="lazy"
          className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
          onError={e => {
            const img = e.target as HTMLImageElement
            if (img.src.includes('ytimg.com') && img.src.includes('hqdefault')) {
              setThumbSrc(img.src.replace('hqdefault', 'mqdefault'))
            } else {
              setThumbSrc(null)
            }
          }}
        />
      ) : (
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: titleToGradient(item.title ?? '') }}
        >
          <Music size={18} style={{ color: 'rgba(255,255,255,0.45)' }} />
        </div>
      )}

      {/* Title + artist */}
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold truncate text-white" title={item.title}>
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <p className="text-sm truncate" style={{ color: '#888' }}>{item.artist}</p>
          {item.source && <SourceBadge source={item.source} />}
        </div>
      </div>

      {/* Duration */}
      <span className="text-xs flex-shrink-0 tabular-nums font-mono" style={{ color: '#666' }}>
        {fmtTime(item.length)}
      </span>

      {/* Skip to top */}
      {displayNumber > 1 && (
        <button
          className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-all hover:bg-app-border"
          style={{ color: '#888' }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#fff' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
          onClick={() => onMoveToTop(index)}
          title="Play next"
        >
          <ChevronsUp size={14} />
        </button>
      )}

      {/* Remove */}
      <button
        className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center
                   opacity-0 group-hover:opacity-100 transition-all hover:bg-app-danger/20"
        style={{ color: '#888' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f43f5e' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#888' }}
        onClick={() => onRemove(index)}
        title="Remove"
      >
        <X size={14} />
      </button>
    </li>
  )
})

// ── Card ─────────────────────────────────────────────────────────────────────

interface Props {
  queue: TrackInfo[]
  token: string
  guildId: string
  onRefresh: () => void
  nowPlaying?: TrackInfo | null
  isPlaying?: boolean
  playerStatus?: string
}

function QueueCard({
  queue, token, guildId, onRefresh, nowPlaying = null, isPlaying = false, playerStatus,
}: Props) {
  const [optimisticQueue, setOptimisticQueue] = useState<TrackInfo[] | null>(null)
  const [search, setSearch]                   = useState('')
  const [page, setPage]                       = useState(0)

  const displayQueue = optimisticQueue ?? queue
  // Ref mirror so row callbacks can stay referentially stable (keeps QueueRow memo effective)
  const displayQueueRef = useRef(displayQueue)
  displayQueueRef.current = displayQueue

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const filteredItems = useMemo(() => {
    if (!search.trim()) return displayQueue.map((item, i) => ({ item, originalIndex: i }))
    const s = search.toLowerCase()
    return displayQueue
      .map((item, i) => ({ item, originalIndex: i }))
      .filter(({ item }) =>
        item.title.toLowerCase().includes(s) ||
        (item.artist ?? '').toLowerCase().includes(s),
      )
  }, [displayQueue, search])

  useEffect(() => { setPage(0) }, [search])

  const isSearching = search.trim() !== ''
  const totalPages  = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE))
  const safePage    = Math.min(page, totalPages - 1)
  const pageItems   = filteredItems.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const handleDragEnd = useCallback(async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = parseInt(active.id as string)
    const newIndex = parseInt(over.id as string)
    if (isNaN(oldIndex) || isNaN(newIndex)) return
    setOptimisticQueue(arrayMove(displayQueue, oldIndex, newIndex))
    try {
      await move(token, guildId, oldIndex + 1, newIndex + 1)
    } catch {
      setOptimisticQueue(null)
    } finally {
      setOptimisticQueue(null)
      onRefresh()
    }
  }, [displayQueue, token, guildId, onRefresh])

  const handleShuffle      = async () => { await shuffle(token, guildId).catch(() => null); onRefresh(); toast('Queue shuffled') }
  const handleClearQueue   = async () => { await clearQueue(token, guildId).catch(() => null); onRefresh() }
  const handleDisconnect   = async () => { await disconnect(token, guildId).catch(() => null); onRefresh() }

  const handleRemove = useCallback(async (originalIndex: number) => {
    setOptimisticQueue(displayQueueRef.current.filter((_, i) => i !== originalIndex))
    try { await remove(token, guildId, originalIndex + 1) }
    finally { setOptimisticQueue(null); onRefresh() }
  }, [token, guildId, onRefresh])

  const handleMoveToTop = useCallback(async (originalIndex: number) => {
    const next = [...displayQueueRef.current]
    const [song] = next.splice(originalIndex, 1)
    next.unshift(song)
    setOptimisticQueue(next)
    try { await move(token, guildId, originalIndex + 1, 1) }
    finally { setOptimisticQueue(null); onRefresh() }
  }, [token, guildId, onRefresh])

  return (
    <div className="flex flex-col overflow-hidden h-full">

      {/* Header */}
      <div className="flex items-center gap-3 px-8 pt-8 pb-3 flex-shrink-0">
        <ListMusic size={14} className="flex-shrink-0 text-app-accent" />
        <h2 className="text-sm font-semibold">Up Next</h2>

        {/* Idle skip — visible when player is IDLE and queue has songs */}
        {playerStatus === 'IDLE' && displayQueue.length > 0 && (
          <button
            onClick={async () => { await skip(token, guildId).catch(() => null); onRefresh() }}
            className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border transition-all active:scale-95"
            style={{ background: 'rgb(var(--accent-rgb) / 0.15)', color: 'rgb(var(--accent-rgb))', borderColor: 'rgb(var(--accent-rgb) / 0.4)' }}
            title="Player is idle — click to start next song"
          >
            <SkipForward size={11} /> Play next
          </button>
        )}

        {/* Song count + duration */}
        {displayQueue.length > 0 ? (
          <div className="flex items-center gap-2 mr-auto flex-wrap">
            <span className="text-xs tabular-nums" style={{ color: '#666' }}>
              {displayQueue.length} songs
              {(() => {
                const total = displayQueue.reduce((s, t) => s + (t.length ?? 0), 0)
                const d = fmtDuration(total)
                return d ? <span className="ml-1">· {d}</span> : null
              })()}
            </span>
          </div>
        ) : (
          <span className="mr-auto" />
        )}

        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
          onClick={handleShuffle}
          disabled={displayQueue.length < 2}
        >
          <Shuffle size={12} /> Shuffle
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5 hover:text-app-danger"
          onClick={handleClearQueue}
          disabled={displayQueue.length === 0}
        >
          <Trash2 size={12} /> Clear
        </button>
        <button
          className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
          onClick={handleDisconnect}
          title="Disconnect (queue preserved for 5 min)"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#f97316' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '' }}
        >
          <LogOut size={12} /> Disconnect
        </button>
      </div>

      {/* Search */}
      {displayQueue.length > 0 && (
        <div className="relative px-8 pb-3 flex-shrink-0">
          <Search size={12} className="absolute left-8 top-1/2 -translate-y-1/2" style={{ color: '#555' }} />
          <input
            type="text"
            className="input pl-7 text-xs h-8"
            placeholder="Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="absolute right-7 top-1/2 -translate-y-1/2" style={{ color: '#555' }}
              onClick={() => setSearch('')}>
              <X size={11} />
            </button>
          )}
        </div>
      )}

      {/* Queue list — scrollable; capped height when stacked below the player on mobile */}
      <div className="flex-1 overflow-y-auto px-6 min-h-0 max-h-[70vh] lg:max-h-none">
        {displayQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="w-14 h-14 rounded-xl bg-app-panel flex items-center justify-center">
              <Music size={22} style={{ color: '#555' }} />
            </div>
            <p className="text-sm" style={{ color: '#888' }}>Queue is empty</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="flex items-center justify-center h-24">
            <p className="text-sm" style={{ color: '#666' }}>No results for "{search}"</p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={isSearching ? [] : pageItems.map(({ originalIndex }) => String(originalIndex))}
              strategy={verticalListSortingStrategy}
            >
              <ul>
                {/* Pinned now-playing row */}
                {nowPlaying && !isSearching && (
                  <li className="flex items-center gap-3 px-3 py-3.5 rounded-xl border-l-2 mb-1"
                    style={{ background: 'rgb(var(--accent-rgb) / 0.07)', borderLeftColor: 'rgb(var(--accent-rgb))' }}>
                    <span className="text-xs tabular-nums w-5 text-right flex-shrink-0 font-mono"
                      style={{ color: 'rgb(var(--accent-rgb))' }}>♪</span>
                    {nowPlaying.thumbnailUrl ? (
                      <img src={nowPlaying.thumbnailUrl} alt="" loading="lazy"
                        className="w-14 h-14 rounded-xl object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center flex-shrink-0"
                        style={{ background: titleToGradient(nowPlaying.title ?? '') }}>
                        <Music size={18} style={{ color: 'rgba(255,255,255,0.45)' }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-semibold truncate" style={{ color: 'rgb(var(--accent-rgb))' }}
                        title={nowPlaying.title}>{nowPlaying.title}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-sm truncate" style={{ color: '#888' }}>{nowPlaying.artist}</p>
                        {nowPlaying.source && <SourceBadge source={nowPlaying.source} />}
                      </div>
                    </div>
                    <span className="text-xs flex-shrink-0 tabular-nums font-mono" style={{ color: '#666' }}>
                      {fmtTime(nowPlaying.length)}
                    </span>
                    {isPlaying && (
                      <div className="flex items-end gap-[2px] h-4 flex-shrink-0">
                        <span className="block w-[3px] rounded-sm animate-bar"   style={{ background: 'rgb(var(--accent-rgb))' }} />
                        <span className="block w-[3px] rounded-sm animate-bar-2" style={{ background: 'rgb(var(--accent-rgb))' }} />
                        <span className="block w-[3px] rounded-sm animate-bar-3" style={{ background: 'rgb(var(--accent-rgb))' }} />
                      </div>
                    )}
                  </li>
                )}
                {pageItems.map(({ item, originalIndex }) => (
                  <QueueRow
                    key={`${item.url}-${originalIndex}`}
                    id={String(originalIndex)}
                    item={item}
                    index={originalIndex}
                    displayNumber={originalIndex + 1}
                    draggable={!isSearching}
                    isUpNext={!isSearching && originalIndex === 0}
                    onRemove={handleRemove}
                    onMoveToTop={handleMoveToTop}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Search result count when filtering */}
      {isSearching && (
        <div className="px-5 py-1.5 flex-shrink-0 border-t border-app-border/60">
          <span className="text-xs" style={{ color: '#666' }}>{filteredItems.length} results</span>
        </div>
      )}

    </div>
  )
}

export default memo(QueueCard)
