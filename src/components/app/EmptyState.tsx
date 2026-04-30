import { useEffect, useState } from 'react'
import { FileText, Trash2, Upload, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useT } from '@/utils/useT'
import {
  clearRecentFiles,
  formatBytes,
  formatRelativeTime,
  loadRecentFile,
  loadRecentFiles,
  removeRecentFile,
  type RecentFileMeta,
} from '@/utils/recentFiles'

interface EmptyStateProps {
  onFile: (file: File) => void
}

export function EmptyState({ onFile }: EmptyStateProps) {
  const t = useT()
  const [over, setOver] = useState(false)
  const [recents, setRecents] = useState<RecentFileMeta[]>([])

  useEffect(() => {
    loadRecentFiles().then(setRecents)
  }, [])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files?.[0]
    if (f && f.type === 'application/pdf') onFile(f)
  }

  function handleClick() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = () => { if (input.files?.[0]) onFile(input.files[0]) }
    input.click()
  }

  async function openRecent(meta: RecentFileMeta) {
    const r = await loadRecentFile(meta.id)
    if (!r) {
      setRecents((rs) => rs.filter((x) => x.id !== meta.id))
      return
    }
    const blob = new Blob([r.bytes as BlobPart], { type: 'application/pdf' })
    const file = new File([blob], r.name, { type: 'application/pdf' })
    onFile(file)
  }

  async function removeRecent(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    await removeRecentFile(id)
    setRecents((rs) => rs.filter((x) => x.id !== id))
  }

  async function clearAll() {
    if (!confirm('Remove all cached recent PDFs?')) return
    await clearRecentFiles()
    setRecents([])
  }

  return (
    <div className="anim-fade-in flex h-full items-start justify-center p-8 pt-20">
      <div className="w-full max-w-xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight">{t('es.heading')}</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t('es.description')}
        </p>
        <div
          onDragEnter={(e) => { e.preventDefault(); setOver(true) }}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={handleDrop}
          onClick={handleClick}
          className={cn(
            'frosted mt-8 cursor-pointer rounded-2xl border border-dashed p-14 text-sm text-muted-foreground transition-all duration-200',
            over
              ? 'scale-[1.01] border-primary shadow-[0_0_0_1px_var(--primary),0_8px_30px_-8px_color-mix(in_oklch,var(--primary)_30%,transparent)]'
              : 'hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-[0_0_0_1px_color-mix(in_oklch,var(--primary)_30%,transparent),0_4px_24px_-8px_color-mix(in_oklch,var(--primary)_18%,transparent)]',
          )}
        >
          <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/30">
            <Upload className="size-5" />
          </div>
          <div className="font-medium text-foreground">{t('es.drag')}</div>
          <div className="mt-1 text-xs">{t('es.or_click')}</div>
        </div>
        <Button onClick={handleClick} className="mt-8 px-6 transition-transform hover:scale-[1.02]">
          {t('es.open_pdf')}
        </Button>

        {recents.length > 0 && (
          <div className="mt-10 text-left">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t('es.recent')}
              </h3>
              <button
                type="button"
                onClick={clearAll}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3" />
                {t('es.clear_recents')}
              </button>
            </div>
            <ul className="divide-y rounded-lg border bg-card">
              {recents.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => openRecent(r)}
                    className="group flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent"
                  >
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {formatBytes(r.size)} · {formatRelativeTime(r.openedAt)}
                      </div>
                    </div>
                    <span
                      onClick={(e) => removeRecent(r.id, e)}
                      role="button"
                      tabIndex={0}
                      title="Remove from recent"
                      className="invisible flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive group-hover:visible"
                    >
                      <X className="size-3.5" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
