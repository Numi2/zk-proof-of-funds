import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RouteErrorBoundary } from './components/ErrorBoundary';
import './App.css';

const ZKPFApp = lazy(() =>
  import('./components/ZKPFApp').then((module) => ({ default: module.ZKPFApp })),
);

const ZKPassportApp = lazy(() =>
  import('./components/ZKPassportApp').then((module) => ({ default: module.ZKPassportApp })),
);

const BoundIdentityApp = lazy(() =>
  import('./components/BoundIdentityApp').then((module) => ({ default: module.BoundIdentityApp })),
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
            path="/*"
            element={<ZKPFApp />}
          />
        </Routes>
      </Suspense>
    </RouteErrorBoundary>
  );
}

export default App;
