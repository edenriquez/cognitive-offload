import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary] caught:', error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div style={{
          display: 'grid', placeItems: 'center', height: '100%', padding: 40,
          fontFamily: 'var(--font-inter)', color: 'var(--color-metal)',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <div style={{
              fontSize: 24, fontFamily: 'var(--font-tiempos)',
              color: 'var(--color-ink)', marginBottom: 8,
            }}>
              Something went wrong
            </div>
            <div style={{ fontSize: 13, marginBottom: 16, lineHeight: 1.5 }}>
              {this.state.error?.message || 'An unexpected error occurred.'}
            </div>
            <button
              className="btn-secondary"
              onClick={() => this.setState({ hasError: false, error: null })}
            >
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
