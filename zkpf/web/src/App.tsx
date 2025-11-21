import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import './App.css';
import { ZkpfClient, detectDefaultBase } from './api/zkpf';
import { EpochCard, ParamsCard } from './components/StatusCards';
import { ProofWorkbench, type ConnectionState } from './components/ProofWorkbench';
import { FinanceContext } from './components/FinanceContext';
import { UsageGuide } from './components/UsageGuide';

const DEFAULT_BASE = detectDefaultBase();
const HERO_HIGHLIGHTS = [
  {
    title: 'Prime brokerage onboarding',
    description: 'Share aggregated balances with credit committees without exposing wallet inventories.',
  },
  {
    title: 'OTC settlement guardrails',
    description: 'Match proofs to threshold policies before releasing fiat or stablecoins to counterparties.',
  },
  {
    title: 'Regulator-ready audit trail',
    description: 'Archive bundle JSON plus verifier responses to drop into SOC, ISAE, or bespoke audits.',
  },
];

function App() {
  const client = useMemo(() => new ZkpfClient(DEFAULT_BASE), []);

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
  const paramsError = paramsQuery.error
    ? (paramsQuery.error as Error).message ?? 'Unable to load manifest'
    : undefined;
  const epochError = epochQuery.error
    ? (epochQuery.error as Error).message ?? 'Unable to load epoch'
    : undefined;

  const isConnected = !paramsQuery.isLoading && !paramsQuery.error && paramsQuery.data !== undefined;
  const isConnecting = paramsQuery.isLoading || epochQuery.isLoading;
  const connectionState: ConnectionState = paramsQuery.error || epochQuery.error
    ? 'error'
    : isConnecting
      ? 'connecting'
      : isConnected
        ? 'connected'
        : 'idle';

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="header-top">
          <div className="brand">
            <div className="logo">
              <img src="/zkpf.png" alt="zkpf - zero-knowledge proof of funds" />
            </div>
            <div>
              <p className="eyebrow">Institutional zk stack</p>
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
          Counterparties expect proof-of-funds before onboarding, extending credit, or releasing assets. This console
          packages the exact bundle, policy metadata, and verifier receipts they review in a real diligence process.
        </p>
        <div className="hero-highlights">
          {HERO_HIGHLIGHTS.map((item) => (
            <div key={item.title} className="hero-highlight">
              <p className="hero-highlight-title">{item.title}</p>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </header>

      <FinanceContext
        params={paramsQuery.data}
        epoch={epochQuery.data}
        connectionState={connectionState}
        verifierUrl={client.baseUrl}
      />

      <section className="info-grid">
        <ParamsCard
          data={paramsQuery.data}
          isLoading={paramsQuery.isLoading}
          error={paramsError}
          onRefresh={() => paramsQuery.refetch()}
        />
        <EpochCard
          data={epochQuery.data}
          isLoading={epochQuery.isLoading}
          error={epochError}
          onRefresh={() => epochQuery.refetch()}
        />
      </section>

      <UsageGuide />

      <ProofWorkbench client={client} connectionState={connectionState} />

      <footer>
        <p>
          Made by Numan Thabit
        </p>
      </footer>
    </div>
  );
}

export default App;
