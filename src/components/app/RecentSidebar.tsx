import { useEffect, useRef, useState } from 'react'
import { ChevronRight, FileText, Plus, Trash2, X } from 'lucide-react'
import { useT } from '@/utils/useT'

// Detect once whether the primary input device supports hover. Touch devices
// (phones, tablets) report `hover: none`, in which case we switch the panel
// to a tap-to-toggle interaction instead of mouse-hover.
const supportsHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches
import { Button } from '@/components/ui/button'
import { usePdfStore } from '@/store/usePdfStore'
import {
  formatRelativeTime, loadRecentFiles, removeRecentFile, type RecentFileMeta,
} from '@/utils/recentFiles'
import { cn } from '@/lib/utils'

interface RecentSidebarProps {
  onPickFile: () => void
  onSwitchTo: (id: string) => void
  // Increment to force a reload of the list (e.g. after adding a new file).
  refreshKey: number
}

const COLLAPSE_DELAY_MS = 250

export function RecentSidebar({ onPickFile, onSwitchTo, refreshKey }: RecentSidebarProps) {
  const t = useT()
  const [items, setItems] = useState<RecentFileMeta[]>([])
  const [open, setOpen] = useState(false)
  const recentId = usePdfStore((s) => s.recentId)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    loadRecentFiles().then(setItems)
  }, [refreshKey])

  function handleEnter() {
    if (!supportsHover) return  // touch devices use tap-to-toggle instead
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    setOpen(true)
  }
  function handleLeave() {
    if (!supportsHover) return
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setOpen(false), COLLAPSE_DELAY_MS)
  }

  return (
    <div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className="relative shrink-0"
    >
      {/* Always-visible 40 px rail */}
      <aside
        className="frosted flex h-full w-10 flex-col items-center gap-1 border-e py-2"
        // Touch fallback: tapping the rail toggles the panel. Desktop hover
        // already handles the open state via mouseenter; an extra click here
        // is harmless (re-asserts open) so we don't gate it.
        onClick={() => { if (!supportsHover) setOpen((o) => !o) }}
      >
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onPickFile() }}
          className="h-9 w-9 p-0"
          aria-label={t('rs.open_new')}
          title={t('rs.open_new')}
        >
          <Plus className="size-4" />
        </Button>
        <div
          className="text-muted-foreground"
          title={t(supportsHover ? 'rs.title_hover' : 'rs.title_tap')}
          aria-hidden="true"
        >
          <ChevronRight className="size-3.5 rtl:rotate-180" />
        </div>
        {/* Tiny indicator that there are items in the cache */}
        {items.length > 0 && (
          <span className="mt-1 font-mono text-[10px] tabular-nums text-primary/80" aria-label={`${items.length} ${t('rs.recent')}`}>
            {items.length}
          </span>
        )}
      </aside>

      {/* Touch-only backdrop so tapping anywhere outside closes the panel */}
      {open && !supportsHover && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-30"
          aria-hidden="true"
        />
      )}

      {/* Floating panel — desktop slides in on hover, touch toggles via tap */}
      {open && (
        <aside
          role="navigation"
          aria-label={t('rs.recent_files')}
          className="frosted anim-slide-right absolute start-0 top-0 z-40 flex h-full w-64 flex-col border-e shadow-2xl shadow-primary/10"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('rs.recent')}
            </span>
            {!supportsHover && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                aria-label={t('rs.close')}
                className="h-7 w-7 p-0"
              >
                <X className="size-4" />
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onPickFile}
            className="m-2 justify-start gap-2"
          >
            <Plus className="size-4" />
            {t('rs.new_pdf')}
          </Button>
          <div className="min-h-0 flex-1 overflow-y-auto pb-2">
            {items.length === 0 ? (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                {t('rs.no_cached')}
              </p>
            ) : (
              <ul>
                {items.map((it) => (
                  <RecentRow
                    key={it.id}
                    item={it}
                    active={it.id === recentId}
                    onPick={() => onSwitchTo(it.id)}
                    onRemove={async () => {
                      await removeRecentFile(it.id)
                      setItems((xs) => xs.filter((x) => x.id !== it.id))
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        </aside>
      )}
    </div>
  )
}

function RecentRow({
  item, active, onPick, onRemove,
}: {
  item: RecentFileMeta
  active: boolean
  onPick: () => void
  onRemove: () => void
}) {
  const t = useT()
  const [hovered, setHovered] = useState(false)
  return (
    <li
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        'group relative cursor-pointer border-l-2 border-transparent px-3 py-2 hover:bg-accent',
        active && 'border-l-primary bg-accent/60',
      )}
    >
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-start gap-2 text-left"
      >
        <FileText className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', active && 'text-primary')} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{item.name}</span>
          <span className="block text-xs text-muted-foreground">
            {formatRelativeTime(item.openedAt)}
          </span>
        </span>
      </button>
      {hovered && (
        <button
          type="button"
          aria-label={`${t('rs.remove')} ${item.name}`}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="absolute end-2 top-2 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={t('rs.remove')}
        >
          {active ? <Trash2 className="size-3.5" /> : <X className="size-3.5" />}
        </button>
      )}
    </li>
  )
}
