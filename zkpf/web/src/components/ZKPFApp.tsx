import { lazy, Suspense, useMemo, useState, useMemo as useReactMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { ZkpfClient, detectDefaultBase } from '../api/zkpf';
import { VerifierEndpointCard } from './StatusCards';
import type { ConnectionState } from './ProofWorkbench';
import { FinanceContext } from './FinanceContext';
import { UsageGuide } from './UsageGuide';
import type { PolicyDefinition, ProofBundle } from '../types/zkpf';
import { ProgressChecklist, type ChecklistStep, type ChecklistStatus } from './ProgressChecklist';
import { RouteErrorBoundary } from './ErrorBoundary';
import { MobileBottomNav } from './MobileBottomNav';
import { BrowserCompatBanner } from './BrowserCompatBanner';
import './mobile.css';

const ProofBuilder = lazy(() =>
  import('./ProofBuilder').then((module) => ({ default: module.ProofBuilder })),
);

const ProofWorkbench = lazy(() =>
  import('./ProofWorkbench').then((module) => ({ default: module.ProofWorkbench })),
);

const PolicyConsole = lazy(() =>
  import('./PolicyConsole').then((module) => ({ default: module.PolicyConsole })),
);

const WalletLayout = lazy(() =>
  import('./wallet/WalletLayout').then((module) => ({ default: module.WalletLayout })),
);

const WalletDashboard = lazy(() =>
  import('./wallet/WalletDashboard').then((module) => ({ default: module.WalletDashboard })),
);

const WalletReceive = lazy(() =>
  import('./wallet/WalletReceive').then((module) => ({ default: module.WalletReceive })),
);

const WalletSend = lazy(() =>
  import('./wallet/WalletSend').then((module) => ({ default: module.WalletSend })),
);

const WalletBuy = lazy(() =>
  import('./wallet/WalletBuy').then((module) => ({ default: module.WalletBuy })),
);

const URIPaymentPage = lazy(() =>
  import('./uri-payment/URIPaymentPage').then((module) => ({ default: module.URIPaymentPage })),
);

const P2PMarketplace = lazy(() =>
  import('./p2p/P2PMarketplace').then((module) => ({ default: module.P2PMarketplace })),
);

const P2POfferCreate = lazy(() =>
  import('./p2p/P2POfferCreate').then((module) => ({ default: module.P2POfferCreate })),
);

const P2POfferDetail = lazy(() =>
  import('./p2p/P2POfferDetail').then((module) => ({ default: module.P2POfferDetail })),
);

const TachyonWallet = lazy(() =>
  import('./tachyon/TachyonWallet').then((module) => ({ default: module.TachyonWallet })),
);

const DEFAULT_BASE = detectDefaultBase();
const HERO_HIGHLIGHTS = [
  {
    title: 'Prime brokerage onboarding',
    description: 'Prove total balances to credit teams, without exposing individual wallets.',
  },
  {
    title: 'OTC settlement guardrails',
    description: 'Verify proofs meet minimum balance rules before releasing funds.',
  },
  {
    title: 'Regulator-ready audit trail',
    description: 'Save proof files and verifier responses for audit reuse.',
  },
];

export function ZKPFApp() {
  const client = useMemo(() => new ZkpfClient(DEFAULT_BASE), []);
  const [prefillBundle, setPrefillBundle] = useState<string | null>(null);
  const [prefillCustomPolicy, setPrefillCustomPolicy] = useState<PolicyDefinition | null>(null);
  const [hasBuiltBundle, setHasBuiltBundle] = useState(false);
  const [verificationOutcome, setVerificationOutcome] = useState<'idle' | 'accepted' | 'rejected' | 'error'>('idle');
  const navigate = useNavigate();
  const location = useLocation();

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

  const handleBundleReady = (bundle: ProofBundle, customPolicy?: PolicyDefinition | null) => {
    setHasBuiltBundle(true);
    setPrefillBundle(JSON.stringify(bundle, null, 2));
    setPrefillCustomPolicy(customPolicy ?? null);
    navigate('/workbench');
  };

  const checklistSteps: ChecklistStep[] = useReactMemo(() => {
    const path = location.pathname;

    const syncStatus: ChecklistStatus =
      connectionState === 'error'
        ? 'error'
        : connectionState === 'connected'
          ? 'complete'
          : connectionState === 'connecting'
            ? 'active'
            : 'pending';

    const buildStatus: ChecklistStatus =
      hasBuiltBundle
        ? 'complete'
        : path === '/build'
          ? 'active'
          : 'pending';

    let verifyStatus: ChecklistStatus;
    if (verificationOutcome === 'accepted') {
      verifyStatus = 'complete';
    } else if (verificationOutcome === 'rejected' || verificationOutcome === 'error') {
      verifyStatus = 'error';
    } else if (path === '/workbench') {
      verifyStatus = 'active';
    } else {
      verifyStatus = 'pending';
    }

    const shareStatus: ChecklistStatus =
      verificationOutcome === 'accepted'
        ? 'active'
        : 'pending';

    const syncDescription =
      connectionState === 'connected'
        ? 'Ready to build proof'
        : connectionState === 'connecting'
          ? (
              <div className="connection-status connecting small">
                <span className="status-dot"></span>
                <span className="status-text">Connecting...</span>
              </div>
            )
          : connectionState === 'error'
            ? 'Fix the backend connection before sending proofs.'
            : 'Start here to make sure params and epoch are aligned.';

    const verifyDescription =
      verificationOutcome === 'accepted'
        ? 'Last proof was accepted by the verifier.'
        : verificationOutcome === 'rejected' || verificationOutcome === 'error'
          ? 'Last verification failed—adjust the bundle or policy and retry.'
          : 'Send a bundle or raw proof to the verifier and review the result.';

    const steps: ChecklistStep[] = [
      {
        id: 'sync',
        title: 'Sync with verifier',
        description: syncDescription,
        status: syncStatus,
        disabled: false,
      },
      {
        id: 'build',
        title: 'Build proof bundle',
        description:
          'Create a proof bundle from your wallet or custody data.',
        status: buildStatus,
        hint: 'Go to Build proof to create or regenerate a bundle.',
        disabled: false,
      },
      {
        id: 'verify',
        title: 'Verify proof',
        description: verifyDescription,
        status: verifyStatus,
        hint: 'Use Verify console to submit the bundle and see the verifier response.',
        disabled: connectionState === 'error',
      },
      {
        id: 'share',
        title: 'Share & record',
        description:
          'Download the bundle and save the verifier response (and optional on-chain attestation) to your records.',
        status: shareStatus,
        hint: 'Attach artifacts to credit memos, deal rooms, or audit trails.',
        disabled: verificationOutcome !== 'accepted',
      },
    ];

    return steps;
  }, [connectionState, hasBuiltBundle, location.pathname, verificationOutcome]);

  const isWorkbenchRoute = location.pathname === '/workbench';
  const isWalletRoute = location.pathname.startsWith('/wallet');
  const isBoundIdentityRoute = location.pathname.startsWith('/bound-identity');
  const isP2PRoute = location.pathname.startsWith('/p2p');
  const isTachyonRoute = location.pathname.startsWith('/tachyon');

  return (
    <div className="app-shell">
      {/* Browser compatibility banner - shows on unsupported browsers */}
      <BrowserCompatBanner />
      
      <div className="wallet-entry">
        <NavLink to="/wallet" className="wallet-button">
          <span>Wallet</span>
        </NavLink>
      </div>
      <div className="zkpassport-entry">
        <NavLink to="/zkpassport" className="zkpassport-button">
          <span>ZKPassport</span>
        </NavLink>
      </div>
      <div className="p2p-entry">
        <NavLink to="/p2p" className="p2p-button">
          <span>P2P Trade</span>
        </NavLink>
      </div>
      <div className="tachyon-entry">
        <NavLink to="/tachyon" className="tachyon-button">
          <span>Tachyon</span>
        </NavLink>
      </div>
      
      {!isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isTachyonRoute && (
        <header className="hero">
          <div className="header-top">
            <div className="brand">
              <div className="logo">
                <img src="/zkpf.png" alt="zkpf - zero-knowledge proof of funds" />
              </div>
              <div>
                <p className="eyebrow">ZK Stack</p>
                <h1>Zero-knowledge proof-of-funds</h1>
              </div>
            </div>
            <div className={`connection-status ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
              <span className="status-dot"></span>
              <span className="status-text">
                {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
            <div className="hero-subtitle"></div>
          </div>
          <p>
            Prove funds, without exposing privacy.
          </p>

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
              Verify console
            </NavLink>
            <NavLink
              to="/policies"
              className={({ isActive }) => (isActive ? 'nav-link nav-link-active policy-nav-link' : 'nav-link policy-nav-link')}
            >
              Policy composer
            </NavLink>
          </nav>
        </header>
      )}

      {!isWorkbenchRoute && !isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isTachyonRoute && (
        <ProgressChecklist
          steps={checklistSteps}
          onStepClick={(id) => {
            if (id === 'sync') {
              navigate('/');
            } else if (id === 'build') {
              navigate('/build');
            } else if (id === 'verify') {
              navigate('/workbench');
            }
          }}
        />
      )}

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
                    example, "our total balance is at least a given threshold") without revealing the underlying raw
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
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading prover</p>
                  <p className="muted small">Preparing in-browser proving key and WASM runtime…</p>
                </section>
              )}
            >
              <ProofBuilder
                client={client}
                connectionState={connectionState}
                onBundleReady={handleBundleReady}
              />
            </Suspense>
          )}
        />

        <Route
          path="/workbench"
          element={(
            <>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading verifier</p>
                    <p className="muted small">Preparing verification console…</p>
                  </section>
                )}
              >
                <ProofWorkbench
                  client={client}
                  connectionState={connectionState}
                  prefillBundle={prefillBundle}
                  prefillCustomPolicy={prefillCustomPolicy}
                  onPrefillConsumed={() => {
                    setPrefillBundle(null);
                    setPrefillCustomPolicy(null);
                  }}
                  onVerificationOutcome={(outcome) => {
                    if (outcome === 'accepted') {
                      setVerificationOutcome('accepted');
                    } else if (outcome === 'rejected') {
                      setVerificationOutcome('rejected');
                    } else if (outcome === 'error') {
                      setVerificationOutcome('error');
                    } else {
                      setVerificationOutcome('idle');
                    }
                  }}
                />
              </Suspense>
              <ProgressChecklist
                steps={checklistSteps}
                onStepClick={(id) => {
                  if (id === 'sync') {
                    navigate('/');
                  } else if (id === 'build') {
                    navigate('/build');
                  } else if (id === 'verify') {
                    navigate('/workbench');
                  }
                }}
              />
            </>
          )}
        />

        <Route
          path="/policies"
          element={(
            <Suspense
              fallback={(
                <section className="card">
                  <p className="eyebrow">Loading policies</p>
                  <p className="muted small">Fetching policy catalog…</p>
                </section>
              )}
            >
              <PolicyConsole client={client} />
            </Suspense>
          )}
        />

        <Route
          path="/wallet"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading wallet</p>
                    <p className="muted small">Preparing Zcash WebWallet…</p>
                  </section>
                )}
              >
                <WalletLayout />
              </Suspense>
            </RouteErrorBoundary>
          )}
        >
          <Route index element={<WalletDashboard />} />
          <Route path="buy" element={<WalletBuy />} />
          <Route path="receive" element={<WalletReceive />} />
          <Route path="send" element={<WalletSend />} />
          <Route path="uri-payment" element={<URIPaymentPage />} />
          <Route path="*" element={<Navigate to="/wallet" replace />} />
        </Route>

        {/* P2P Marketplace Routes */}
        <Route
          path="/p2p"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading marketplace</p>
                    <p className="muted small">Preparing P2P trading platform…</p>
                  </section>
                )}
              >
                <P2PMarketplace />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />
        <Route
          path="/p2p/create"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading</p>
                    <p className="muted small">Preparing offer creation…</p>
                  </section>
                )}
              >
                <P2POfferCreate />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />
        <Route
          path="/p2p/offer/:offerId"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading</p>
                    <p className="muted small">Preparing trade view…</p>
                  </section>
                )}
              >
                <P2POfferDetail />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />

        {/* Tachyon Multi-Chain Wallet */}
        <Route
          path="/tachyon"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading Tachyon</p>
                    <p className="muted small">Preparing multi-chain wallet...</p>
                  </section>
                )}
              >
                <TachyonWallet />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isTachyonRoute && (
        <div className="hero-highlights">
          {HERO_HIGHLIGHTS.map((item) => (
            <div key={item.title} className="hero-highlight">
              <p className="hero-highlight-title">{item.title}</p>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      )}

      <footer>
        <p>
          Made by Numan Thabit.
        </p>
      </footer>

      {/* Mobile bottom navigation - only show on wallet, P2P, and Tachyon routes */}
      {(isWalletRoute || isP2PRoute || isTachyonRoute) && <MobileBottomNav />}

      <Analytics />
    </div>
  );
}

