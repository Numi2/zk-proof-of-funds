import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import './App.css';
import { ZkpfClient, detectDefaultBase } from './api/zkpf';
import { VerifierEndpointCard } from './components/StatusCards';
import { ProofWorkbench, type ConnectionState } from './components/ProofWorkbench';
import { FinanceContext } from './components/FinanceContext';
import { UsageGuide } from './components/UsageGuide';
import { ProofBuilder } from './components/ProofBuilder';
import type { ProofBundle } from './types/zkpf';

const DEFAULT_BASE = detectDefaultBase();
const HERO_HIGHLIGHTS = [
  {
    title: 'Prime brokerage onboarding',
    description: 'Show total balances to credit teams without exposing individual wallets.',
  },
  {
    title: 'OTC settlement guardrails',
    description: 'Check that proofs meet your minimum balance rules before releasing fiat or stablecoins.',
  },
  {
    title: 'Regulator-ready audit trail',
    description: 'Save proof files and verifier responses so they are easy to reuse in audits.',
  },
];

function App() {
  const client = useMemo(() => new ZkpfClient(DEFAULT_BASE), []);
  const [prefillBundle, setPrefillBundle] = useState<string | null>(null);
  const navigate = useNavigate();

  const paramsQuery = useQuery({
    queryKey: ['params', client.baseUrl],
    queryFn: () => client.getParams(),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const epochQuery = useQuery({
    queryKey: ['epoch', client.baseUrl],
    queryFn: () => client.getEpoch(),
    staleTime: 30 * 1000,
    refetchInterval: 60 * 1000,
    retry: 1,
  });

  const isConnected = !paramsQuery.isLoading && !paramsQuery.error && paramsQuery.data !== undefined;
  const isConnecting = paramsQuery.isLoading || epochQuery.isLoading;
  const connectionState: ConnectionState = paramsQuery.error || epochQuery.error
    ? 'error'
    : isConnecting
      ? 'connecting'
      : isConnected
        ? 'connected'
        : 'idle';

  const handleBundleReady = (bundle: ProofBundle) => {
    setPrefillBundle(JSON.stringify(bundle, null, 2));
    navigate('/workbench');
  };

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="header-top">
          <div className="brand">
            <div className="logo">
              <img src="/zkpf.png" alt="zkpf - zero-knowledge proof of funds" />
            </div>
            <div>
              <p className="eyebrow">For institutional teams</p>
              <h1>Zero-knowledge proof-of-funds for capital markets</h1>
            </div>
          </div>
          <div className={`connection-status ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
            <span className="status-dot"></span>
            <span className="status-text">
              {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
            </span>
          </div>
        </div>
        <p>
          When a bank, exchange, or lender asks you to prove your funds, this console helps you create and
          share that proof without revealing your wallet details.
        </p>
        <div className="hero-highlights">
          {HERO_HIGHLIGHTS.map((item) => (
            <div key={item.title} className="hero-highlight">
              <p className="hero-highlight-title">{item.title}</p>
              <p>{item.description}</p>
            </div>
          ))}
        </div>

        <nav className="main-nav">
          <NavLink
            to="/"
            end
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Overview
          </NavLink>
          <NavLink
            to="/build"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Build proof
          </NavLink>
          <NavLink
            to="/workbench"
            className={({ isActive }) => (isActive ? 'nav-link nav-link-active' : 'nav-link')}
          >
            Proof console
          </NavLink>
        </nav>
      </header>

      <Routes>
        <Route
          path="/"
          element={(
            <>
              <section className="card concepts">
                <header>
                  <p className="eyebrow">Core concepts</p>
                  <h2>Zero-knowledge proof-of-funds</h2>
                </header>
                <p className="muted">
                  Zero-Knowledge Proof-of-Funds is a cryptographic technique that allows you to prove you have a certain amount of assets, without revealing the underlying raw data such as exact balances or wallet addresses.
                </p>
                <ul>
                  <li>
                    <strong>Zero-knowledge proofs</strong>: a cryptographic way to prove a statement is true (for
                    example, “our total balance is at least a given threshold”) without revealing the underlying raw
                    data such as exact balances or wallet addresses.
                  </li>
                  <li>
                    <strong>Proof-of-funds</strong>: evidence that you control at least a certain amount of assets at a
                    given point in time, often requested by banks, exchanges, or lenders before onboarding, extending
                    credit, or settling large trades.
                  </li>
                  <li>
                    <strong>Zero-knowledge proof-of-funds</strong>: combines the two so you can mathematically prove
                    you meet a requested minimum balance, while keeping individual wallets, positions, and account
                    details private. This console helps you build that proof and share it in a standard, verifiable
                    format.
                  </li>
                </ul>
              </section>

              <FinanceContext
                params={paramsQuery.data}
                connectionState={connectionState}
                verifierUrl={client.baseUrl}
              />

              <section className="info-grid">
                <VerifierEndpointCard
                  endpoint={client.baseUrl}
                  connectionState={connectionState}
                />
              </section>

              <UsageGuide />
            </>
          )}
        />

        <Route
          path="/build"
          element={(
            <ProofBuilder
              client={client}
              connectionState={connectionState}
              onBundleReady={handleBundleReady}
            />
          )}
        />

        <Route
          path="/workbench"
          element={(
            <ProofWorkbench
              client={client}
              connectionState={connectionState}
              prefillBundle={prefillBundle}
              onPrefillConsumed={() => setPrefillBundle(null)}
            />
          )}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <footer>
        <p>
          Made by Numan Thabit
        </p>
      </footer>

      <Analytics />
    </div>
  );
}

export default App;
