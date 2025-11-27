/**
 * Error Boundary Component
 * 
 * Catches React rendering errors and displays a fallback UI instead of crashing.
 * This prevents the "UI disappears" issue when navigating between pages.
 */

import React, { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary-fallback" style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--card-bg, #1a1a2e)',
          borderRadius: '12px',
          margin: '1rem',
        }}>
          <h2 style={{ color: 'var(--accent, #f59e0b)', marginBottom: '1rem' }}>
            Something went wrong
          </h2>
          <p style={{ color: 'var(--muted, #888)', marginBottom: '1.5rem' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={this.handleRetry}
            style={{
              background: 'var(--accent, #f59e0b)',
              color: 'var(--bg, #0a0a14)',
              border: 'none',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
              marginRight: '0.5rem',
            }}
          >
            Try Again
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'transparent',
              color: 'var(--accent, #f59e0b)',
              border: '1px solid var(--accent, #f59e0b)',
              padding: '0.75rem 1.5rem',
              borderRadius: '8px',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Route-level error boundary with navigation awareness
 */
interface RouteErrorBoundaryProps {
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorKey: number;
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  constructor(props: RouteErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorKey: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<RouteErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[RouteErrorBoundary] Caught error:', error, errorInfo);
  }

  // Reset error state when children change (i.e., when navigating)
  componentDidUpdate(prevProps: RouteErrorBoundaryProps): void {
    if (prevProps.children !== this.props.children && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null, errorKey: this.state.errorKey + 1 });
  };

  handleGoBack = (): void => {
    window.history.back();
    // Reset after navigation
    setTimeout(() => {
      this.setState({ hasError: false, error: null });
    }, 100);
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-fallback" style={{
          padding: '2rem',
          textAlign: 'center',
          background: 'var(--card-bg, #1a1a2e)',
          borderRadius: '12px',
          margin: '1rem',
          maxWidth: '500px',
          marginLeft: 'auto',
          marginRight: 'auto',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
          <h2 style={{ color: 'var(--text, #fff)', marginBottom: '0.5rem' }}>
            Page Error
          </h2>
          <p style={{ color: 'var(--muted, #888)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
            This page encountered an error. You can try again or go back.
          </p>
          {this.state.error && (
            <details style={{ 
              textAlign: 'left', 
              marginBottom: '1.5rem',
              padding: '1rem',
              background: 'rgba(0,0,0,0.2)',
              borderRadius: '8px',
            }}>
              <summary style={{ cursor: 'pointer', color: 'var(--muted, #888)' }}>
                Error details
              </summary>
              <pre style={{ 
                fontSize: '0.75rem', 
                color: 'var(--error, #ef4444)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                marginTop: '0.5rem',
              }}>
                {this.state.error.message}
              </pre>
            </details>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center' }}>
            <button
              onClick={this.handleGoBack}
              style={{
                background: 'transparent',
                color: 'var(--accent, #f59e0b)',
                border: '1px solid var(--accent, #f59e0b)',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              ← Go Back
            </button>
            <button
              onClick={this.handleRetry}
              style={{
                background: 'var(--accent, #f59e0b)',
                color: 'var(--bg, #0a0a14)',
                border: 'none',
                padding: '0.75rem 1.5rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return <React.Fragment key={this.state.errorKey}>{this.props.children}</React.Fragment>;
  }
}

export default ErrorBoundary;

