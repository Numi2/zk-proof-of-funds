import type { ConnectionState } from './ProofWorkbench';
import type { EpochResponse, ParamsResponse } from '../types/zkpf';
import { formatEpoch } from '../utils/bytes';

type Intent = 'ready' | 'pending' | 'blocked' | 'info';

interface FinanceContextProps {
  params?: ParamsResponse;
  epoch?: EpochResponse;
  connectionState: ConnectionState;
  verifierUrl: string;
}

interface FinanceUseCase {
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
}

type JourneyStage = 'aggregate' | 'policy' | 'verification' | 'delivery';

interface JourneyTemplate {
  id: JourneyStage;
  title: string;
  description: string;
}

interface JourneyStep extends JourneyTemplate {
  detail: string;
  intent: Intent;
  statusLabel: string;
}

const financeUseCases: FinanceUseCase[] = [
  {
    eyebrow: 'Credit committees',
    title: 'Prime brokerage onboarding',
    description:
      'Supply daily proof-of-funds that shows coverage for leverage lines without disclosing wallet addresses or counterparties.',
    bullets: [
      'Map verifier policies to credit memo thresholds before settlement.',
      'Keep cold + hot wallet granularity private while proving aggregate balances.',
      'Attach the verifier response banner to the lender data room as an immutable receipt.',
    ],
  },
  {
    eyebrow: 'Listings & compliance',
    title: 'Exchange treasury attestations',
    description:
      'Demonstrate exchange reserves and custody scope IDs when a regulator or listing venue asks for updated proof.',
    bullets: [
      'Rotate manifests in sync with circuit upgrades to keep attestations current.',
      'Use policy IDs to separate client funds, corporate treasury, and omnibus wallets.',
      'Export normalized JSON to plug into existing SOC / ISAE audit workflows.',
    ],
  },
  {
    eyebrow: 'Trading operations',
    title: 'OTC settlement guardrails',
    description:
      'Give OTC desks confidence that incoming capital meets the requested threshold before they release assets or credit.',
    bullets: [
      'Tie proofs to verifier scope IDs per counterparty or liquidity program.',
      'Share `/zkpf/verify` responses so both sides archive the same settlement artifact.',
      'Trigger re-verification automatically when the epoch guardrail drifts beyond the SLA.',
    ],
  },
];

const journeyTemplate: JourneyTemplate[] = [
  {
    id: 'aggregate',
    title: 'Aggregate holdings',
    description: 'Custody teams run the prover over internal ledgers and produce a signed bundle JSON.',
  },
  {
    id: 'policy',
    title: 'Bind to a policy',
    description: 'Match balances to a verifier scope + threshold before the desk approves settlement.',
  },
  {
    id: 'verification',
    title: 'Verifier handshake',
    description: 'Submit the bundle or raw proof to the verifier endpoint and archive the response.',
  },
  {
    id: 'delivery',
    title: 'Counterparty delivery',
    description: 'Share the proof package, policy metadata, and verifier receipt with the requesting desk.',
  },
];

export function FinanceContext({ params, epoch, connectionState, verifierUrl }: FinanceContextProps) {
  const metrics = [
    {
      id: 'circuit',
      label: 'Circuit manifest',
      value: params ? `v${params.circuit_version}` : 'Awaiting manifest',
      detail: params ? `Manifest v${params.manifest_version}` : 'Call /zkpf/params to sync artifacts',
      intent: params ? ('ready' as Intent) : ('pending' as Intent),
    },
    {
      id: 'epoch',
      label: 'Epoch guardrail',
      value: epoch ? `${epoch.max_drift_secs}s drift window` : 'Not synced',
      detail: epoch ? `Epoch ${formatEpoch(epoch.current_epoch)}` : 'Call /zkpf/epoch to align clocks',
      intent: epoch ? ('ready' as Intent) : ('pending' as Intent),
    },
    {
      id: 'verifier',
      label: 'Verifier endpoint',
      value: formatVerifierHost(verifierUrl),
      detail:
        connectionState === 'connected'
          ? 'Online for counterparties'
          : connectionState === 'error'
            ? 'Backend unreachable'
            : 'Negotiating connection',
      intent:
        connectionState === 'connected'
          ? ('ready' as Intent)
          : connectionState === 'error'
            ? ('blocked' as Intent)
            : ('pending' as Intent),
    },
  ];

  const journeySteps: JourneyStep[] = journeyTemplate.map((step) => {
    switch (step.id) {
      case 'aggregate':
        return {
          ...step,
          intent: params ? 'ready' : 'pending',
          statusLabel: params ? 'Manifest aligned' : 'Waiting on params',
          detail: params
            ? `Circuit v${params.circuit_version} • Manifest v${params.manifest_version}`
            : 'Load /zkpf/params before exporting bundles.',
        };
      case 'policy': {
        const intent =
          connectionState === 'connected' ? 'ready' : connectionState === 'error' ? 'blocked' : 'pending';
        return {
          ...step,
          intent,
          statusLabel:
            connectionState === 'connected'
              ? 'Policies reachable'
              : connectionState === 'error'
                ? 'Connection failed'
                : 'Fetching policies',
          detail:
            connectionState === 'connected'
              ? 'Use /zkpf/policies to map verifier_scope_id + threshold.'
              : 'Make the verifier reachable to load policies.',
        };
      }
      case 'verification': {
        const intent =
          connectionState === 'connected' ? 'ready' : connectionState === 'error' ? 'blocked' : 'pending';
        return {
          ...step,
          intent,
          statusLabel:
            connectionState === 'connected'
              ? 'Endpoint online'
              : connectionState === 'error'
                ? 'Verifier offline'
                : 'Standing by',
          detail: 'POST to /zkpf/verify or /zkpf/verify-bundle and retain the JSON response.',
        };
      }
      case 'delivery':
        return {
          ...step,
          intent: 'info',
          statusLabel: 'Counterparty share-out',
          detail: `Package bundle + response + policy metadata for ${formatVerifierHost(verifierUrl)} counterparties.`,
        };
      default:
        return {
          ...step,
          intent: 'info',
          statusLabel: 'Info',
          detail: '',
        };
    }
  });

  return (
    <section className="finance-context">
      <div className="card finance-narrative">
        <header>
          <p className="eyebrow">Institutional workflows</p>
          <h2>Show counterparties the proof they need, nothing more</h2>
        </header>
        <p className="muted">
          Capital markets use proof-of-funds to unlock credit lines, satisfy exchange listings, and close OTC deals.
          This console keeps the verifier, custody policies, and audit artifacts aligned.
        </p>
        <div className="finance-metrics">
          {metrics.map((metric) => (
            <div key={metric.id} className={`metric-card ${metric.intent}`}>
              <p className="metric-label">{metric.label}</p>
              <p className="metric-value">{metric.value}</p>
              <p className="metric-detail">{metric.detail}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="finance-use-case-grid">
        {financeUseCases.map((useCase) => (
          <article key={useCase.title} className="use-case-card">
            <p className="use-case-meta">{useCase.eyebrow}</p>
            <h3>{useCase.title}</h3>
            <p className="muted">{useCase.description}</p>
            <ul className="use-case-bullets">
              {useCase.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <div className="journey-panel card">
        <header>
          <p className="eyebrow">Counterparty journey</p>
          <h2>From custody proof to settlement artifact</h2>
          <p className="muted small">
            Track each step the finance org cares about before approving real money movement.
          </p>
        </header>
        <div className="journey-steps">
          {journeySteps.map((step, index) => (
            <div key={step.id} className="journey-step">
              <div className="journey-step-index">{String(index + 1).padStart(2, '0')}</div>
              <div className="journey-step-body">
                <p className="journey-step-title">{step.title}</p>
                <p className="journey-step-description">{step.description}</p>
                <p className="journey-step-detail">{step.detail}</p>
              </div>
              <span className={`journey-status ${step.intent}`}>{step.statusLabel}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function formatVerifierHost(url: string): string {
  if (!url) {
    return 'n/a';
  }
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url.replace(/^https?:\/\//, '');
  }
}

