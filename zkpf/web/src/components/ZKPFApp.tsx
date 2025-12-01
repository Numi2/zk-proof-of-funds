import { lazy, Suspense, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Link, Route, Routes, Navigate, useNavigate, useLocation } from 'react-router-dom';
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

const P2PMarketplace = lazy(() => import('./p2p/P2PMarketplace'));

const P2POfferCreate = lazy(() => import('./p2p/P2POfferCreate'));

const P2POfferDetail = lazy(() => import('./p2p/P2POfferDetail'));

const SwapPage = lazy(() =>
  import('./swap/SwapPage').then((module) => ({ default: module.SwapPage })),
);

const TransparentToShielded = lazy(() =>
  import('./wallet/TransparentToShielded').then((module) => ({ default: module.TransparentToShielded })),
);

const DeFiPage = lazy(() =>
  import('./defi/DeFiPage').then((module) => ({ default: module.DeFiPage })),
);

const CredentialsHub = lazy(() =>
  import('./credentials/CredentialsHub').then((module) => ({ default: module.CredentialsHub })),
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

const PRODUCT_SUITE = [
  {
    id: 'credentials',
    icon: '🔐',
    title: 'Cross-chain Credentials Hub',
    subtitle: 'Zcash • Mina • Starknet • NEAR',
    description: 'Generate, manage, and share proof-of-funds credentials across multiple chains. Prove your funds exist without moving assets or revealing balances.',
    features: ['Multi-chain proofs', 'One-click verification', 'Shareable credentials'],
    gradient: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
    link: '/credentials',
  },
  {
    id: 'wallet',
    icon: '🛡️',
    title: 'Privacy-First Web Wallet',
    subtitle: 'Zcash Orchard • Shielded by default',
    description: 'Full-featured Zcash wallet with shielded transactions, transparent-to-shielded conversion, and native ZKPassport integration. Your keys, your coins, your privacy.',
    features: ['Orchard shielded pool', 'Unified addresses', 'In-browser key derivation'],
    gradient: 'linear-gradient(135deg, #22c55e 0%, #10b981 100%)',
    link: '/wallet',
  },
  {
    id: 'zkpassport',
    icon: '🛂',
    title: 'ZKPassport Integration',
    subtitle: 'Prove identity • Preserve privacy',
    description: 'Verify you\'re a unique real person using your passport, without revealing any personal data. ZKPassport uses zero-knowledge proofs to create a privacy-preserving identity layer.',
    features: ['No PII stored', 'One-time passport scan'],
    gradient: 'linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)',
    link: '/zkpassport',
  },
  {
    id: 'personhood',
    icon: '🔗',
    title: 'Personhood-Wallet Binding',
    subtitle: 'Bond funds to verified identity',
    description: 'Cryptographically bind your wallet to your verified personhood. Prove you control funds as a verified individual without revealing wallet addresses or balances.',
    features: ['Ed25519 signatures', 'Challenge-response auth', 'Multi-wallet support'],
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
    link: '/bound-identity',
  },
  {
    id: 'p2p',
    icon: '🤝',
    title: 'P2P Marketplace',
    subtitle: 'Trade with verified counterparties',
    description: 'Peer-to-peer trading with proof-of-funds escrow. Both parties can verify each other\'s balances before committing, without revealing exact amounts.',
    features: ['ZK-verified escrow', 'Reputation system', 'Multi-asset support'],
    gradient: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    link: '/p2p',
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
    
    // Check if we should return to bound-identity instead of going to workbench
    const returnToBoundIdentity = sessionStorage.getItem('bound-identity-return-pending');
    if (returnToBoundIdentity === 'true') {
      // Store the bundle so BoundIdentityBuilder can pick it up
      sessionStorage.setItem('bound-identity-returned-bundle', JSON.stringify(bundle));
      sessionStorage.removeItem('bound-identity-return-pending');
      navigate('/bound-identity');
      return;
    }
    
    navigate('/workbench');
  };

  const checklistSteps: ChecklistStep[] = useMemo(() => {
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
  const isDeFiRoute = location.pathname.startsWith('/defi');
  const isCredentialsRoute = location.pathname.startsWith('/credentials');

  return (
    <div className="app-shell">
      {!isWalletRoute && !isBoundIdentityRoute && !isCredentialsRoute && (
        <div className="top-bar">
          <Link to="/wallet" className="top-nav-link">Wallet</Link>
          <Link to="/credentials" className="top-nav-link">Credentials</Link>
          <Link to="/p2p" className="top-nav-link">P2P</Link>
          <Link to="/defi" className="top-nav-link">CrossChain</Link>
          <Link to="/zkpassport" className="top-nav-link">ZKPassport</Link>
        </div>
      )}
      
      {!isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isCredentialsRoute && !isDeFiRoute && (
        <header className="hero">
          <div className="header-top">
            <div className="brand">
              <div className={`connection-status ${isConnected ? 'connected' : isConnecting ? 'connecting' : 'disconnected'}`}>
                <span className="status-dot"></span>
                <span className="status-text">
                  {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
                </span>
              </div>
              <div>
                <p className="eyebrow">ZK Stack</p>
                <h1>Zero-knowledge proof-of-funds</h1>
              </div>
            </div>
            <div className="hero-subtitle"></div>
          </div>
          <p>
            Prove funds, without exposing privacy.
          </p>

          <div className="hero-cta">
            <Link to="/build" className="hero-cta-button">
              Try it now →
            </Link>
          </div>

          {!isDeFiRoute && (
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
          )}
        </header>
      )}

      {!isWorkbenchRoute && !isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isDeFiRoute && !isCredentialsRoute && (
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
              {/* Product Suite Section */}
              <section className="product-suite">
                <header className="product-suite-header">
                  <p className="eyebrow">Product Suite</p>
                  <h2>Privacy infrastructure for the next era of finance</h2>
                  <p className="muted">
                    A complete toolkit for proving ownership, identity, and creditworthiness—without sacrificing privacy.
                  </p>
                </header>
                <div className="product-grid">
                  {PRODUCT_SUITE.map((product) => (
                    <Link 
                      key={product.id} 
                      to={product.link} 
                      className="product-card"
                      style={{ '--card-gradient': product.gradient } as React.CSSProperties}
                    >
                      <div className="product-card-icon">{product.icon}</div>
                      <div className="product-card-content">
                        <h3 className="product-card-title">{product.title}</h3>
                        <p className="product-card-subtitle">{product.subtitle}</p>
                        <p className="product-card-description">{product.description}</p>
                        <ul className="product-card-features">
                          {product.features.map((feature, idx) => (
                            <li key={idx}>{feature}</li>
                          ))}
                        </ul>
                      </div>
                      <div className="product-card-arrow">→</div>
                    </Link>
                  ))}
                </div>
              </section>

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
          <Route path="swap" element={<SwapPage />} />
          <Route path="buy" element={<WalletBuy />} />
          <Route path="receive" element={<WalletReceive />} />
          <Route path="send" element={<WalletSend />} />
          <Route path="send-to-shielded" element={<TransparentToShielded />} />
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

        {/* DeFi Bridge Hub Routes */}
        <Route
          path="/defi"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading</p>
                    <p className="muted small">Preparing Cross Chain Credentials…</p>
                  </section>
                )}
              >
                <DeFiPage />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />

        {/* Cross-chain Proof-of-Funds Credentials Hub */}
        <Route
          path="/credentials"
          element={(
            <RouteErrorBoundary>
              <Suspense
                fallback={(
                  <section className="card">
                    <p className="eyebrow">Loading</p>
                    <p className="muted small">Preparing Cross-chain Credentials Hub…</p>
                  </section>
                )}
              >
                <CredentialsHub />
              </Suspense>
            </RouteErrorBoundary>
          )}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      {!isWalletRoute && !isBoundIdentityRoute && !isP2PRoute && !isCredentialsRoute && (
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
          Github : <a href="https://github.com/Numi2/zk-proof-of-funds" target="_blank" rel="noopener noreferrer">
            https://github.com/Numi2/zk-proof-of-funds
          </a>
        </p>
      </footer>

      {/* Mobile bottom navigation - only show on wallet and P2P routes */}
      {(isWalletRoute || isP2PRoute) && <MobileBottomNav />}

      <Analytics />
    </div>
  );
}

