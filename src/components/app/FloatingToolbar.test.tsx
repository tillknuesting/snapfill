import { describe, expect, it, vi } from 'vitest'
import { useEffect, useRef, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FloatingToolbar } from './FloatingToolbar'

describe('FloatingToolbar — Delete', () => {
  it('always shows the Delete button and calls onDelete', async () => {
    const onDelete = vi.fn()
    render(<FloatingToolbar anchorLeft={0} anchorTop={0} onDelete={onDelete} />)
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(onDelete).toHaveBeenCalledOnce()
  })
})

describe('FloatingToolbar — rich text', () => {
  function RichTextHarness({ onCommand }: { onCommand: () => void }) {
    const editorRef = useRef<HTMLDivElement>(null)
    return (
      <>
        <div ref={editorRef} contentEditable suppressContentEditableWarning />
        <FloatingToolbar
          anchorLeft={0} anchorTop={0}
          onDelete={vi.fn()}
          richText={{ editorRef, onCommandApplied: onCommand }}
        />
      </>
    )
  }

  it('shows Bold / Italic / Underline toggles', () => {
    render(<RichTextHarness onCommand={vi.fn()} />)
    expect(screen.getByRole('button', { name: /^bold$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^italic$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^underline$/i })).toBeInTheDocument()
  })

  it('clicking Bold runs document.execCommand and notifies the parent', async () => {
    const onCommand = vi.fn()
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true)
    render(<RichTextHarness onCommand={onCommand} />)
    await userEvent.click(screen.getByRole('button', { name: /^bold$/i }))
    expect(execSpy).toHaveBeenCalledWith('bold', false)
    expect(onCommand).toHaveBeenCalled()
    execSpy.mockRestore()
  })
})

describe('FloatingToolbar — date format', () => {
  it('shows the format select when a date prop is supplied', () => {
    render(
      <FloatingToolbar
        anchorLeft={0} anchorTop={0}
        onDelete={vi.fn()}
        date={{ locale: undefined, onChange: vi.fn() }}
      />,
    )
    // The select trigger has role=combobox in the Radix shadcn select
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  // Regression — user reported the dropdown opened then immediately closed.
  // Two failure modes were folded together:
  //   (1) toolbar root preventDefault swallowed the trigger's open click;
  //   (2) trigger gained focus, blurred the editor, the parent unmounted
  //       the toolbar before the user could pick.
  // The fix preventDefaults on the SelectTrigger's mousedown so focus stays
  // put. These tests lock that behaviour.

  it('opens the dropdown and emits onChange for the picked locale', async () => {
    const onChange = vi.fn()
    render(
      <FloatingToolbar
        anchorLeft={0} anchorTop={0}
        onDelete={vi.fn()}
        date={{ locale: undefined, onChange }}
      />,
    )
    const trigger = screen.getByRole('combobox')
    await userEvent.click(trigger)
    // After click, options are rendered into a Radix portal.
    const usOption = await waitFor(() => screen.getByRole('option', { name: /US/ }))
    await userEvent.click(usOption)
    expect(onChange).toHaveBeenCalledWith('en-US')
  })

  it('emits `undefined` when the System default is picked', async () => {
    const onChange = vi.fn()
    render(
      <FloatingToolbar
        anchorLeft={0} anchorTop={0}
        onDelete={vi.fn()}
        // start on a non-default so the picker has somewhere to go
        date={{ locale: 'en-US', onChange }}
      />,
    )
    await userEvent.click(screen.getByRole('combobox'))
    const sysOption = await waitFor(() => screen.getByRole('option', { name: /System/ }))
    await userEvent.click(sysOption)
    expect(onChange).toHaveBeenCalledWith(undefined)
  })

  // Reproduces the parent-unmount layer of the bug, which the in-isolation
  // tests above cannot. A parent that gates the toolbar on `editorFocused`
  // (clearing the flag on the editor's blur) would unmount the toolbar the
  // moment Radix moves focus into the portal, before the option click lands.
  // The fix lives in Annotation.tsx (no blur dismissal; outside-click via
  // pointerdown that excludes Radix popper portals). This test mimics that
  // gating so the regression is caught at the right layer.
  it("doesn't unmount when focus moves into the dropdown's portal", async () => {
    const onChange = vi.fn()
    function Harness() {
      const editorRef = useRef<HTMLDivElement>(null)
      const [active, setActive] = useState(true)
      // Mimic Annotation.tsx: pointerdown outside wrapper AND outside any
      // Radix popper-content-wrapper deactivates. Crucially, do NOT deactivate
      // on the editor's blur.
      useEffect(() => {
        if (!active) return
        const onDown = (e: PointerEvent) => {
          const t = e.target as Element | null
          if (!t) return
          if (t.closest('[data-test-wrap]')) return
          if (t.closest(
            '[data-radix-popper-content-wrapper],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="dialog"]',
          )) return
          setActive(false)
        }
        document.addEventListener('pointerdown', onDown, true)
        return () => document.removeEventListener('pointerdown', onDown, true)
      }, [active])
      return (
        <div data-test-wrap>
          <div ref={editorRef} contentEditable suppressContentEditableWarning />
          {active && (
            <FloatingToolbar
              anchorLeft={0} anchorTop={0}
              date={{ locale: undefined, onChange }}
            />
          )}
        </div>
      )
    }
    render(<Harness />)
    const trigger = screen.getByRole('combobox')
    await userEvent.click(trigger)
    const ukOption = await waitFor(() => screen.getByRole('option', { name: /UK/ }))
    await userEvent.click(ukOption)
    expect(onChange).toHaveBeenCalledWith('en-GB')
    // And the toolbar is still mounted afterwards.
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('preventDefaults the trigger mousedown so the editor keeps focus', () => {
    // Reproduces the second layer of the bug: if mousedown on the trigger
    // is *not* preventDefault'd, the trigger gains focus and the parent
    // (which gates the floating chip on `editorFocused`) would unmount the
    // toolbar mid-click. Verify our trigger applies preventDefault.
    render(
      <FloatingToolbar
        anchorLeft={0} anchorTop={0}
        onDelete={vi.fn()}
        date={{ locale: undefined, onChange: vi.fn() }}
      />,
    )
    const trigger = screen.getByRole('combobox')
    const result = fireEvent.mouseDown(trigger)
    // fireEvent returns false if any handler called preventDefault on the event.
    expect(result).toBe(false)
  })
})

describe('FloatingToolbar — pen settings', () => {
  it('shows a swatch with the current color when a pen prop is supplied', () => {
    render(
      <FloatingToolbar
        anchorLeft={0} anchorTop={0}
        onDelete={vi.fn()}
        pen={{ color: '#dc2626', opacity: 0.5, width: 4, onChange: vi.fn() }}
      />,
    )
    expect(screen.getByText(/4\.0 pt/)).toBeInTheDocument()
  })
})
