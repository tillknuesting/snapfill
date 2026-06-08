import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePdfStore } from '@/store/usePdfStore'
import { useT } from '@/utils/useT'

// First-visit guided tour. Steps adapt to whether a PDF is open, but the
// post-open walkthrough stays intentionally short; the Help button can replay
// it on demand.

// Versioned storage key. Bump the suffix when the tour content changes
// substantively — that way users who already dismissed an older version
// see the new walkthrough once, instead of being permanently locked out.
// v2: Current storage marker. Kept stable so existing dismissed tours stay
// dismissed while the walkthrough content gets shorter.
const STORAGE_KEY = 'pdfhelper.onboardingDone.v2'

interface Step {
  // CSS selector for the element to point at; null = centered welcome card.
  // Selector uses the toolbar button's *English* aria-label since that's
  // baked into the source. Keep the picker in sync if any of those rename.
  target: string | null
  titleKey: string
  bodyKey: string
}

const PRE_OPEN_STEPS: Step[] = [
  { target: null, titleKey: 'ob.welcome.title',      bodyKey: 'ob.welcome.body' },
  { target: null, titleKey: 'ob.privacy.title',      bodyKey: 'ob.privacy.body' },
]

// Targets keyed off the (translated) aria-label means we have to look up the
// label per current language. Build the selector with the matching string.
//
// The order tracks a real workflow and deliberately limits the tour to the
// decisions users need first. Secondary tools remain discoverable in Help.
function buildPostOpenSteps(t: (k: string) => string): Step[] {
  return [
    { target: `button[aria-label="${t('tb.add_text')}"]`,      titleKey: 'ob.add_text.title', bodyKey: 'ob.add_text.body' },
    { target: `button[aria-label="${t('tb.add_signature')}"]`, titleKey: 'ob.sign.title',     bodyKey: 'ob.sign.body' },
    { target: null,                                            titleKey: 'ob.reorder.title',  bodyKey: 'ob.reorder.body' },
    { target: `button[aria-label="${t('tb.download')}"]`,      titleKey: 'ob.download.title', bodyKey: 'ob.download.body' },
  ]
}

function readDone(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === '1' } catch { return false }
}
function markDone() {
  try { localStorage.setItem(STORAGE_KEY, '1') } catch { /* ignore */ }
}
// `?tour=1` forces the tour to start regardless of the dismissal flag.
// Useful for the user replaying the tour, for sharing the app with others,
// and for devs verifying tour content during a session.
function forceShow(): boolean {
  if (typeof window === 'undefined') return false
  try { return new URLSearchParams(window.location.search).get('tour') === '1' }
  catch { return false }
}

export function Onboarding({ replayKey = 0 }: { replayKey?: number }) {
  const t = useT()
  const pdfBytes = usePdfStore((s) => s.pdfBytes)
  const [active, setActive] = useState<boolean>(() => forceShow() || !readDone())
  const [step, setStep] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    if (replayKey <= 0) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setStep(0)
      setActive(true)
    })
    return () => { cancelled = true }
  }, [replayKey])

  // If the first-visit card is still active when a PDF opens, transition it
  // into the short post-open tour. If the user already completed or dismissed
  // the pre-open cards, do not revive it unexpectedly.
  const [hasOpenedAtLeastOnce, setHasOpenedAtLeastOnce] = useState(false)
  useEffect(() => {
    if (!pdfBytes || hasOpenedAtLeastOnce || readDone() || !active) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setHasOpenedAtLeastOnce(true)
      setStep(0)
      setActive(true)
    })
    return () => { cancelled = true }
  }, [pdfBytes, hasOpenedAtLeastOnce, active])

  const postOpenSteps = useMemo(() => buildPostOpenSteps(t), [t])
  const steps = pdfBytes ? postOpenSteps : PRE_OPEN_STEPS
  const current = steps[step]

  // Position the card near its target element. Centered when target is null
  // OR when the viewport is too narrow for a side-by-side anchor to make
  // sense (the toolbar scrolls horizontally on phones, so anchoring next to
  // an off-screen button would push the card to a corner).
  useLayoutEffect(() => {
    if (!active || !current) return
    function place() {
      if (!current?.target) { setPos(null); return }
      const el = document.querySelector(current.target as string) as HTMLElement | null
      // Always scroll the target into the visible portion of its scroll
      // container — on mobile the horizontal-scrolling toolbar may have
      // pushed the targeted button off-screen.
      if (el && typeof el.scrollIntoView === 'function') {
        try { el.scrollIntoView({ inline: 'center', block: 'nearest' }) }
        catch { /* old browsers */ }
      }
      // Below the `sm` breakpoint, fall back to centered placement — the
      // toolbar is in a scroll pane and a button anchor doesn't read well.
      if (!el || window.innerWidth < 640) { setPos(null); return }
      const r = el.getBoundingClientRect()
      const cardW = Math.min(320, window.innerWidth - 16)
      const left = Math.max(8, Math.min(window.innerWidth - cardW - 8, r.left + r.width / 2 - cardW / 2))
      const top = Math.min(window.innerHeight - 200 - 8, r.bottom + 12)
      setPos({ left, top })
    }
    place()
    if (!current.target) return
    window.addEventListener('resize', place)
    // The card is anchored to a target's bounding rect; if the user scrolls
    // (very common on the empty-state sample list) the target moves but the
    // card stayed put. Re-place on scroll keeps it pinned.
    window.addEventListener('scroll', place, { passive: true, capture: true })
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [active, current])

  if (!active || !current) return null

  function dismiss() {
    markDone()
    setActive(false)
  }
  function next() {
    if (step + 1 >= steps.length) {
      dismiss()
      return
    }
    setStep(step + 1)
  }

  const isLastStep = step + 1 >= steps.length
  const positioned = !!pos
  // Outer wrapper handles positioning ONLY. The inner card handles the
  // pop-in animation. Splitting the concerns is what unblocks centering on
  // mobile: the .anim-pop-in animation animates `transform: scale(...)`
  // with fill-mode `both`, which leaves a `transform: scale(1)` parked on
  // the element after the animation. If positioning and animation share
  // the same node, any inline `transform: translate(-50%, 0)` we'd use to
  // centre is overwritten and the card slides off-screen on narrow phones.
  // Solution: outer is `left:0 right:0` (full-viewport strip) for the
  // centred case, and the inner card uses `mx-auto` to centre within it
  // — no transform on the outer means nothing for the animation to fight.
  const wrapperStyle: React.CSSProperties = positioned
    ? { left: pos.left, top: pos.top, pointerEvents: 'auto' }
    : { left: 0, right: 0, top: '22%', pointerEvents: 'auto' }

  return (
    <div
      data-testid="onboarding-root"
      className="fixed inset-0 z-50"
      // The backdrop dims for visibility but clicks pass through — the user
      // can interact with the underlying app (e.g. pick a sample form to
      // advance from the welcome step) while the card stays up. Only the
      // card itself captures clicks.
      style={{ pointerEvents: 'none' }}
    >
      <div className="absolute inset-0 bg-black/20" />
      <div
        data-testid="onboarding-card"
        className="absolute"
        style={wrapperStyle}
      >
        <div className="anim-pop-in relative mx-auto w-[320px] max-w-[calc(100vw-1rem)] rounded-lg border bg-card p-4 text-card-foreground shadow-xl">
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('ob.skip')}
            data-testid="onboarding-skip"
            className="absolute end-2 top-2 size-7 rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="mx-auto size-4" />
          </button>
          <h3 className="pr-8 text-sm font-semibold">{t(current.titleKey)}</h3>
          <p className="mt-2 text-sm text-muted-foreground">{t(current.bodyKey)}</p>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              {step + 1} / {steps.length}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={dismiss}
                data-testid="onboarding-skip-text"
              >
                {t('ob.skip')}
              </Button>
              {step > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(step - 1)}
                  data-testid="onboarding-back"
                >
                  {t('ob.back')}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={next}
                data-testid="onboarding-next"
              >
                {isLastStep ? t('ob.done') : t('ob.next')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
