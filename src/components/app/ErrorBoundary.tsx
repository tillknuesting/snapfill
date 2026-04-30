import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catch-all React error boundary. We don't have a backend to report to, so
 * the only "telemetry" is `console.error`. The user sees a calm fallback
 * with a reload action — better than a blank screen on any rogue throw.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Logged for the developer; don't dispatch anywhere external.
    console.error('App crashed:', error, info)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h2 className="text-xl font-semibold">Something went wrong.</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The app hit an unexpected error. Your most recent edits were
            auto-saved a moment ago and should reappear after reloading.
          </p>
          <pre className="mt-4 max-h-40 overflow-auto rounded border bg-muted p-3 text-left font-mono text-[11px] text-muted-foreground">
            {error.message}
          </pre>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
