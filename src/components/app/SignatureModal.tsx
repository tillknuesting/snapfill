import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useT } from '@/utils/useT'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { usePdfStore } from '@/store/usePdfStore'
import { HANDWRITING_FONTS, type HandwritingFont } from '@/utils/fonts'
import { trimCanvas } from '@/utils/trimSignature'
import {
  addSavedSignature,
  loadSavedSignatures,
  removeSavedSignature,
} from '@/utils/savedSignatures'
import type { SavedSignature } from '@/types'
import { cn } from '@/lib/utils'

const COLORS: Array<{ value: string; label: string }> = [
  { value: '#000000', label: 'Black' },
  { value: '#0a1f3d', label: 'Ink' },
  { value: '#1d4ed8', label: 'Blue' },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SignatureModal({ open, onOpenChange }: Props) {
  const t = useT()
  const sigColor = usePdfStore((s) => s.sigColor)
  const setSigColor = usePdfStore((s) => s.setSigColor)
  const setPendingSignature = usePdfStore((s) => s.setPendingSignature)
  const setMode = usePdfStore((s) => s.setMode)

  const [tab, setTab] = useState<'draw' | 'type'>('draw')
  const [typedText, setTypedText] = useState('')
  const [typedFont, setTypedFont] = useState<HandwritingFont>('Caveat')
  const [saved, setSaved] = useState<SavedSignature[]>([])

  // Reset on open
  useEffect(() => {
    if (open) {
      setTab('draw')
      setTypedText('')
      setSaved(loadSavedSignatures())
    }
  }, [open])

  // Preload handwriting fonts
  useEffect(() => {
    HANDWRITING_FONTS.forEach((f) => {
      try { void document.fonts.load(`72px "${f}"`) } catch { /* noop */ }
    })
  }, [])

  function commitDataUrl(dataUrl: string) {
    setSaved(addSavedSignature(dataUrl))
    armPlacement(dataUrl)
  }

  // Stage the signature so the next click on a page places it there.
  function armPlacement(dataUrl: string) {
    setPendingSignature(dataUrl)
    setMode('signature')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('sm.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-3">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">{t('sm.color')}</span>
          {COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => setSigColor(c.value)}
              title={t(`sm.color.${c.label.toLowerCase()}`)}
              className={cn(
                'size-6 rounded-full border-2 transition-colors',
                sigColor === c.value ? 'border-primary' : 'border-border',
              )}
              style={{ background: c.value }}
            />
          ))}
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'draw' | 'type')} className="mt-2">
          <TabsList>
            <TabsTrigger value="draw">{t('sm.tab.draw')}</TabsTrigger>
            <TabsTrigger value="type">{t('sm.tab.type')}</TabsTrigger>
          </TabsList>

          <TabsContent value="draw" className="mt-3">
            <DrawPad onCommit={commitDataUrl} color={sigColor} />
          </TabsContent>

          <TabsContent value="type" className="mt-3">
            <TypePad
              text={typedText}
              setText={setTypedText}
              font={typedFont}
              setFont={setTypedFont}
              color={sigColor}
              onCommit={commitDataUrl}
            />
          </TabsContent>
        </Tabs>

        {saved.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              {t('sm.saved')}
            </div>
            <div className="flex flex-wrap gap-2">
              {saved.map((s) => (
                <div key={s.id} className="relative">
                  <button
                    type="button"
                    onClick={() => armPlacement(s.dataUrl)}
                    className="flex h-12 w-28 items-center justify-center rounded-md border bg-card p-1 hover:border-primary"
                  >
                    <img src={s.dataUrl} alt="" className="max-h-full max-w-full" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSaved(removeSavedSignature(s.id))}
                    className="absolute -right-2 -top-2 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow"
                    aria-label={t('sm.delete_saved')}
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

interface DrawPadProps {
  onCommit: (dataUrl: string) => void
  color: string
}
function DrawPad({ onCommit, color }: DrawPadProps) {
  const tDraw = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const last = useRef<[number, number]>([0, 0])

  function getPos(e: React.PointerEvent | PointerEvent): [number, number] {
    // The canvas can render at a CSS size smaller than its bitmap (we use
    // `width: 100%` for responsiveness). Scale pointer-event CSS coords back
    // into bitmap coords so strokes land where the cursor is.
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const sx = c.width / r.width
    const sy = c.height / r.height
    return [(e.clientX - r.left) * sx, (e.clientY - r.top) * sy]
  }

  function down(e: React.PointerEvent) {
    e.preventDefault()
    canvasRef.current?.setPointerCapture(e.pointerId)
    drawing.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.5
    ctx.strokeStyle = color
    last.current = getPos(e)
  }

  function move(e: React.PointerEvent) {
    if (!drawing.current) return
    e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const [x, y] = getPos(e)
    ctx.beginPath()
    ctx.moveTo(last.current[0], last.current[1])
    ctx.lineTo(x, y)
    ctx.stroke()
    last.current = [x, y]
  }

  function up() { drawing.current = false }

  function clear() {
    const c = canvasRef.current!
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
  }

  function isEmpty(): boolean {
    const c = canvasRef.current!
    const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return false
    return true
  }

  function commit() {
    if (isEmpty()) { alert(tDraw('sm.draw.empty_alert')); return }
    onCommit(trimCanvas(canvasRef.current!))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{tDraw('sm.draw.help')}</p>
      <canvas
        ref={canvasRef}
        width={500}
        height={200}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="touch-none cursor-crosshair rounded-md border bg-white"
        style={{ width: '100%', maxWidth: 500, aspectRatio: '5 / 2', height: 'auto' }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={clear}>{tDraw('sm.clear')}</Button>
        <Button type="button" onClick={commit}>{tDraw('sm.use')}</Button>
      </div>
    </div>
  )
}

interface TypePadProps {
  text: string
  setText: (s: string) => void
  font: HandwritingFont
  setFont: (f: HandwritingFont) => void
  color: string
  onCommit: (dataUrl: string) => void
}
function TypePad({ text, setText, font, setFont, color, onCommit }: TypePadProps) {
  const tType = useT()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    if (!text.trim()) return
    let cancelled = false
    document.fonts.load(`72px "${font}"`).then(() => {
      if (cancelled) return
      ctx.fillStyle = color
      ctx.textBaseline = 'middle'
      ctx.textAlign = 'center'
      let size = 72
      ctx.font = `${size}px "${font}", cursive`
      while (ctx.measureText(text).width > c.width - 24 && size > 18) {
        size -= 2
        ctx.font = `${size}px "${font}", cursive`
      }
      ctx.fillText(text, c.width / 2, c.height / 2)
    })
    return () => { cancelled = true }
  }, [text, font, color])

  function commit() {
    if (!text.trim()) { alert(tType('sm.type.empty_alert')); return }
    onCommit(trimCanvas(canvasRef.current!))
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{tType('sm.type.help')}</p>
      <div className="flex gap-2">
        <Input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={tType('sm.type.placeholder')}
          className="flex-1"
        />
        <Select value={font} onValueChange={(v) => setFont(v as HandwritingFont)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HANDWRITING_FONTS.map((f) => (
              <SelectItem key={f} value={f} style={{ fontFamily: `"${f}", cursive`, fontSize: 18 }}>
                {f}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <canvas
        ref={canvasRef}
        width={500}
        height={200}
        className="rounded-md border bg-white"
        style={{ width: '100%', maxWidth: 500, aspectRatio: '5 / 2', height: 'auto' }}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => setText('')}>{tType('sm.clear')}</Button>
        <Button type="button" onClick={commit}>{tType('sm.use')}</Button>
      </div>
      {/* Hidden Label keeps shadcn/Label visible to tree-shaker if no other use */}
      <Label className="sr-only">{tType('sm.signature_text')}</Label>
    </div>
  )
}

