import { useEffect, useState } from 'react'
import { Plus, Trash2, ArrowRightFromLine } from 'lucide-react'
import { useT } from '@/utils/useT'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { usePdfStore } from '@/store/usePdfStore'
import { loadProfile, saveProfile } from '@/utils/profile'
import type { ProfileField } from '@/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProfileDialog({ open, onOpenChange }: Props) {
  const t = useT()
  const [fields, setFields] = useState<ProfileField[]>([])
  const setPendingTextValue = usePdfStore((s) => s.setPendingTextValue)
  const setMode = usePdfStore((s) => s.setMode)
  const pdfBytes = usePdfStore((s) => s.pdfBytes)

  useEffect(() => {
    if (open) setFields(loadProfile())
  }, [open])

  function update(next: ProfileField[]) {
    setFields(next)
    saveProfile(next)
  }

  function patch(id: string, p: Partial<ProfileField>) {
    update(fields.map((f) => (f.id === id ? { ...f, ...p } : f)))
  }

  function add() {
    update([...fields, { id: crypto.randomUUID(), label: 'New field', value: '' }])
  }

  function remove(id: string) {
    update(fields.filter((f) => f.id !== id))
  }

  function insert(value: string) {
    if (!value.trim()) return
    setPendingTextValue(value)
    setMode('text')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('pd.title')}</DialogTitle>
          <DialogDescription>
            {t('pd.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {fields.map((f) => (
            <div key={f.id} className="flex items-center gap-2">
              <Input
                value={f.label}
                onChange={(e) => patch(f.id, { label: e.target.value })}
                className="w-44 text-xs"
                placeholder={t('pd.label_placeholder')}
              />
              <Input
                value={f.value}
                onChange={(e) => patch(f.id, { value: e.target.value })}
                className="flex-1"
                placeholder={t('pd.value_placeholder')}
              />
              <Button
                size="sm"
                variant="default"
                disabled={!f.value.trim() || !pdfBytes}
                onClick={() => insert(f.value)}
                title={!pdfBytes ? t('pd.open_first') : t('pd.insert_into_click')}
              >
                <ArrowRightFromLine className="size-4" />
                {t('pd.insert')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => remove(f.id)}
                aria-label={t('pd.remove_field')}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>

        <div>
          <Button variant="outline" size="sm" onClick={add}>
            <Plus className="size-4" />
            {t('pd.add_field')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
