import { Suspense, lazy } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { MobileBottomNav } from './MobileBottomNav';
import './mobile.css';

const BoundIdentityBuilder = lazy(() =>
  import('./BoundIdentityBuilder').then((module) => ({ default: module.BoundIdentityBuilder })),
);

const BoundIdentityVerifier = lazy(() =>
  import('./BoundIdentityVerifier').then((module) => ({ default: module.BoundIdentityVerifier })),
);

export function BoundIdentityApp() {
  return (
    <div className="app-shell bound-identity-app">
      <header className="hero">
        <NavLink to="/" className="bound-identity-back-link">
          ← Back to ZKPF
        </NavLink>
        <div className="header-top">
          <div className="brand">
            <div className="logo">
              <span style={{ fontSize: '3rem' }}>🔗</span>
            </div>
            <div>
              <p className="eyebrow">Identity Bond</p>
              <h1>Bound Identity Proof</h1>
            </div>
          </div>
          <div className="hero-subtitle"></div>
        </div>
        <p>
          Create cryptographic bonds between identity proofs and funds proofs for privacy-preserving KYC+PoF.
        </p>

        <nav className="main-nav">
          <NavLink
            to="."
            end
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Build Bond
          </NavLink>
          <NavLink
            to="verify"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Verify Bond
          </NavLink>
        </nav>
      </header>

      <Routes>
        <Route
          index
          element={(
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading</p>
                  <p className="muted small">Preparing identity bond builder…</p>
                </section>
              )}
            >
              <BoundIdentityBuilder />
            </Suspense>
          )}
        />
        <Route
          path="verify"
          element={(
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading</p>
                  <p className="muted small">Preparing bond verifier…</p>
                </section>
              )}
            >
              <BoundIdentityVerifier />
            </Suspense>
          )}
        />
        <Route path="*" element={<Navigate to="/bound-identity" replace />} />
      </Routes>

      <footer>
        <p>
          <a href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>
            ← Back to ZKPF
          </a>
        </p>
        <p style={{ marginTop: '0.75rem', color: '#64748b', fontSize: '0.85rem' }}>
          Privacy-preserving KYC+PoF verification.
        </p>
      </footer>

      {/* Mobile bottom navigation */}
      <MobileBottomNav />
    </div>
  );
}

