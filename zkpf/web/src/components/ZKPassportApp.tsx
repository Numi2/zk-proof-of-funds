import { useMemo } from 'react';
import { NavLink, Route, Routes, Navigate } from 'react-router-dom';
import { ZKPassportPage } from './ZKPassportPage';
import { ZKPassportPolicyConsole } from './ZKPassportPolicyConsole';
import { ZKPassportVerifier } from './ZKPassportVerifier';
import { ZKPassportPolicyClient } from '../api/zkpassport-policies';
import { detectDefaultBase } from '../api/zkpf';

const DEFAULT_BASE = detectDefaultBase();

export function ZKPassportApp() {
  const zkpassportPolicyClient = useMemo(() => new ZKPassportPolicyClient(DEFAULT_BASE, true), []);

  return (
    <div className="app-shell zkpassport-app">
      <header className="hero">
        <div className="header-top">
          <div className="brand">
            <div className="logo">
              <span style={{ fontSize: '3rem' }}>🌐</span>
            </div>
            <div>
              <p className="eyebrow">ZKPassport Integration</p>
              <h1>Zero-Knowledge Identity Verification</h1>
            </div>
          </div>
          <div className="hero-subtitle"></div>
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
        </nav>
      </header>

      <Routes>
        <Route
          index
          element={<ZKPassportPage />}
        />
        <Route
          path="policies"
          element={<ZKPassportPolicyConsole client={zkpassportPolicyClient} />}
        />
        <Route
          path="verify"
          element={<ZKPassportVerifier client={zkpassportPolicyClient} />}
        />
        <Route path="*" element={<Navigate to="/zkpassport" replace />} />
      </Routes>

      <footer>
        <p>
          <a href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>
            ← Back to ZKPF
          </a>
        </p>
      </footer>
    </div>
  );
}

