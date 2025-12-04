import { Suspense, lazy, type ComponentType } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import './App.css';

// Error handling wrapper for lazy imports
const lazyWithErrorHandling = (importFn: () => Promise<{ default: ComponentType<any> }>, componentName: string) => {
  return lazy(() =>
    importFn()
      .catch((error) => {
        console.error(`[App] Failed to load ${componentName}:`, error);
        // Return a fallback component that shows an error
        return {
          default: () => (
            <div className="app-shell">
              <section className="card">
                <p className="eyebrow" style={{ color: '#ef4444' }}>Error</p>
                <p className="muted small">Failed to load {componentName}</p>
                <details style={{ marginTop: '1rem', textAlign: 'left' }}>
                  <summary style={{ cursor: 'pointer', color: '#888' }}>Error details</summary>
                  <pre style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: '0.5rem' }}>
                    {error instanceof Error ? error.message : String(error)}
                  </pre>
                </details>
                <button
                  onClick={() => window.location.reload()}
                  style={{
                    marginTop: '1rem',
                    padding: '0.5rem 1rem',
                    background: '#f59e0b',
                    color: '#0a0a14',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Reload Page
                </button>
              </section>
            </div>
          ),
        };
      })
  );
};

const ZKPFApp = lazyWithErrorHandling(
  () => import('./components/ZKPFApp').then((module) => ({ default: module.ZKPFApp })),
  'ZKPFApp'
);

const ZKPassportApp = lazyWithErrorHandling(
  () => import('./components/ZKPassportApp').then((module) => ({ default: module.ZKPassportApp })),
  'ZKPassportApp'
);

const BoundIdentityApp = lazyWithErrorHandling(
  () => import('./components/BoundIdentityApp').then((module) => ({ default: module.BoundIdentityApp })),
  'BoundIdentityApp'
);

const DexApp = lazyWithErrorHandling(
  () => import('./components/dex/DexApp').then((module) => ({ default: module.DexApp })),
  'DexApp'
);

function App() {
  return (
    <RouteErrorBoundary>
      <Suspense
        fallback={(
          <div className="app-shell">
            <section className="card">
              <p className="eyebrow">Loading</p>
              <p className="muted small">Preparing the console…</p>
            </section>
          </div>
        )}
      >
        <Routes>
          <Route
            path="/zkpassport/*"
            element={<ZKPassportApp />}
          />
          <Route
            path="/bound-identity/*"
            element={<BoundIdentityApp />}
          />
          <Route
            path="/dex/*"
            element={<DexApp />}
          />
          <Route
            path="/*"
            element={<ZKPFApp />}
          />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}

export default App;
