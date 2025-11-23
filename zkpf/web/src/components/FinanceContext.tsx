import type { ConnectionState } from './ProofWorkbench';
import type { ParamsResponse } from '../types/zkpf';

type Intent = 'ready' | 'pending' | 'blocked' | 'info';

interface FinanceContextProps {
  params?: ParamsResponse;
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
      'Send daily proof-of-funds that shows you meet credit limits, without revealing individual wallets or trading partners.',
    bullets: [
      'Match verifier policies to the credit limits in your memos before settlement.',
      'Prove your total balance while keeping the split between hot and cold wallets private.',
      'Save the verifier result in your data room as a permanent record.',
    ],
  },
  {
    eyebrow: 'Listings & compliance',
    title: 'Exchange treasury attestations',
    description:
      'Show exchange reserves and which accounts are included when a regulator or listing venue asks for updated proof.',
    bullets: [
      'Refresh the manifest whenever the circuit is upgraded so your attestations stay current.',
      'Use separate policy IDs for client funds, corporate treasury, and omnibus wallets.',
      'Export clean JSON that plugs into existing SOC / ISAE audit workflows.',
    ],
  },
  {
    eyebrow: 'Trading operations',
    title: 'OTC settlement guardrails',
    description:
      'Let OTC desks quickly check that incoming funds meet the agreed minimum before they release assets or credit.',
    bullets: [
      'Tie proofs to clear scope IDs for each counterparty or liquidity program.',
      'Share verifier responses so both sides save the same settlement record.',
      'Use epoch limits to know when you need a fresh proof.',
    ],
  },
];

const journeyTemplate: JourneyTemplate[] = [
  {
    id: 'aggregate',
    title: 'Aggregate holdings',
    description: 'Ops or custody teams run the prover on internal records and generate a signed proof file (bundle JSON).',
  },
  {
    id: 'policy',
    title: 'Bind to a policy',
    description: 'Check that balances meet the policy’s scope and minimum threshold before the desk approves settlement.',
  },
  {
    id: 'verification',
    title: 'Verifier handshake',
    description: 'Send the bundle or raw proof to the verifier and save the response.',
  },
  {
    id: 'delivery',
    title: 'Counterparty delivery',
    description: 'Send the proof, policy details, and verifier result to the team that requested it.',
  },
];

export function FinanceContext({ params, connectionState, verifierUrl }: FinanceContextProps) {
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
          <h2>Show counterparties you have the funds, without exposing your privacy</h2>
        </header>
        <p className="muted">
          Capital markets teams use proof-of-funds to open accounts, unlock credit lines, satisfy exchange listings, and
          close OTC deals. 
        </p>
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
            See the key steps a finance or risk team expects to see before approving real money movement.
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

