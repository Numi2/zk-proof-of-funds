import { Suspense, lazy, useMemo } from 'react';
import { NavLink, Link, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import { ZKPassportPolicyClient } from '../api/zkpassport-policies';
import { detectDefaultBase } from '../api/zkpf';
import { MobileBottomNav } from './MobileBottomNav';
import { ThemeToggle } from './ThemeToggle';
import './mobile.css';

const ZKPassportPage = lazy(() =>
  import('./ZKPassportPage').then((module) => ({ default: module.ZKPassportPage })),
);

const ZKPassportPolicyConsole = lazy(() =>
  import('./ZKPassportPolicyConsole').then((module) => ({ default: module.ZKPassportPolicyConsole })),
);

const ZKPassportVerifier = lazy(() =>
  import('./ZKPassportVerifier').then((module) => ({ default: module.ZKPassportVerifier })),
);

const ZKPassportSharedProofVerifier = lazy(() =>
  import('./ZKPassportSharedProofVerifier').then((module) => ({ default: module.ZKPassportSharedProofVerifier })),
);

const DEFAULT_BASE = detectDefaultBase();

export function ZKPassportApp() {
  const zkpassportPolicyClient = useMemo(() => new ZKPassportPolicyClient(DEFAULT_BASE, true), []);
  const location = useLocation();
  const isZKPassportRoute = location.pathname.startsWith('/zkpassport');

  return (
    <div className="app-shell zkpassport-app">
      <div className="top-bar">
        <div className="top-nav-links">
          <Link to="/wallet" className="top-nav-link">Wallet</Link>
          <Link to="/p2p" className="top-nav-link">P2P</Link>
          <Link to="/defi" className="top-nav-link">CrossChain</Link>
          <Link to="/dex" className="top-nav-link">DEX</Link>
          <Link to="/zkpassport" className="top-nav-link">ZKPassport</Link>
        </div>
        <ThemeToggle />
      </div>
      <header className="hero">
        <NavLink to="/" className="zkpassport-back-link">
          ← Back to ZKPF
        </NavLink>
        <div className="header-top">
          <div className="brand">
            {!isZKPassportRoute && (
              <div className="logo">
              </div>
            )}
            <div>
              <p className="eyebrow">ZKPassport Integration</p>
              <h1>Zero-Knowledge Identity Verification</h1>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="hero-subtitle"></div>
          </div>
        </div>
        <p>
          Verify identity and eligibility using zero-knowledge proofs, without exposing sensitive information.
        </p>

        <nav className="main-nav">
          <NavLink
            to="."
            end
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Overview
          </NavLink>
          <NavLink
            to="policies"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Policies
          </NavLink>
          <NavLink
            to="verify"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Verify Identity
          </NavLink>
          <NavLink
            to="verify/shared"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Verify Proof
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
                  <p className="muted small">Preparing ZKPassport overview…</p>
                </section>
              )}
            >
              <ZKPassportPage />
            </Suspense>
          )}
        />
        <Route
          path="policies"
          element={(
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading</p>
                  <p className="muted small">Fetching ZKPassport policies…</p>
                </section>
              )}
            >
              <ZKPassportPolicyConsole client={zkpassportPolicyClient} />
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
                  <p className="muted small">Preparing ZKPassport verifier…</p>
                </section>
              )}
            >
              <ZKPassportVerifier client={zkpassportPolicyClient} />
            </Suspense>
          )}
        />
        <Route
          path="verify/shared"
          element={(
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading</p>
                  <p className="muted small">Preparing proof verifier…</p>
                </section>
              )}
            >
              <ZKPassportSharedProofVerifier />
            </Suspense>
          )}
        />
        <Route path="*" element={<Navigate to="/zkpassport" replace />} />
      </Routes>

      <footer>
        <p>
          <a href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>
            ← Back to ZKPF
          </a>
        </p>
        <p style={{ marginTop: '0.75rem', color: '#64748b', fontSize: '0.85rem' }}>
          <code style={{ background: 'rgba(100, 116, 139, 0.2)', padding: '0.2rem 0.5rem', borderRadius: '4px' }}>@zkpassport/sdk</code>
          <br />
          integrated by Numan Thabit.
        </p>
      </footer>

      {/* Mobile bottom navigation */}
      <MobileBottomNav />
    </div>
  );
}

