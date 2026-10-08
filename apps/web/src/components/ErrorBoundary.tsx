import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * [AUDIT item 1] A render error must never leave a rep staring at a blank screen — that reads as a dead
 * app. This boundary catches a throw in its subtree and shows a calm, reassuring fallback with a Reload
 * button, in the existing card/button styles. One wraps the whole app (main.tsx); one wraps each view
 * (keyed by the view, so navigating away clears a stuck screen). No external error logger is wired, so
 * the error is sent to console.error — the one sink that exists.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { hasError: boolean }> {
  override state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[error-boundary${this.props.label ? `:${this.props.label}` : ''}]`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <section className="tov-card" role="alert" aria-label="Something went wrong" style={{ margin: '2rem auto', maxWidth: 440, textAlign: 'center', display: 'grid', gap: '0.75rem' }}>
        <p style={{ margin: 0 }}>Something went wrong. Your data is safe.</p>
        <div>
          <button className="tov-primary" type="button" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </section>
    );
  }
}
