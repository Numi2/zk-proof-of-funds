import { Suspense, lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import './App.css';

const ZKPFApp = lazy(() =>
  import('./components/ZKPFApp').then((module) => ({ default: module.ZKPFApp })),
);

const ZKPassportApp = lazy(() =>
  import('./components/ZKPassportApp').then((module) => ({ default: module.ZKPassportApp })),
);

function App() {
  return (
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
          path="/*"
          element={<ZKPFApp />}
        />
      </Routes>
    </Suspense>
  );
}

export default App;
