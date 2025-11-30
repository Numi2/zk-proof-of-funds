import React, { useEffect, useState } from 'react';
import './TransferProgress.css';

export type TransferStep = 
  | 'pending'
  | 'sourceSubmitted'
  | 'sourceConfirmed'
  | 'waitingFinality'
  | 'proofGenerated'
  | 'destinationSubmitted'
  | 'completed'
  | 'failed';

interface Transfer {
  transferId: string;
  status: TransferStep;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  token: string;
  estimatedCompletion?: number;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
  createdAt: number;
}

interface TransferProgressProps {
  transfer: Transfer;
  onCancel?: () => void;
  onRetry?: () => void;
  onClose?: () => void;
}

const STEPS: { key: TransferStep; label: string; description: string }[] = [
  { key: 'pending', label: 'Initiating', description: 'Preparing your transfer...' },
  { key: 'sourceSubmitted', label: 'Submitted', description: 'Transaction sent to source chain' },
  { key: 'sourceConfirmed', label: 'Confirmed', description: 'Source transaction confirmed' },
  { key: 'waitingFinality', label: 'Finalizing', description: 'Waiting for chain finality' },
  { key: 'proofGenerated', label: 'Proving', description: 'Generating cross-chain proof' },
  { key: 'destinationSubmitted', label: 'Delivering', description: 'Completing on destination' },
  { key: 'completed', label: 'Complete', description: 'Transfer successful!' },
];

const getExplorerUrl = (chain: string, txHash: string): string => {
  const explorers: Record<string, string> = {
    near: 'https://nearblocks.io/txns/',
    ethereum: 'https://etherscan.io/tx/',
    arbitrum: 'https://arbiscan.io/tx/',
    base: 'https://basescan.org/tx/',
    solana: 'https://solscan.io/tx/',
    'near-testnet': 'https://testnet.nearblocks.io/txns/',
    'ethereum-sepolia': 'https://sepolia.etherscan.io/tx/',
    'arbitrum-sepolia': 'https://sepolia.arbiscan.io/tx/',
    'base-sepolia': 'https://sepolia.basescan.org/tx/',
    'solana-devnet': 'https://solscan.io/tx/?cluster=devnet/',
  };
  return (explorers[chain] || '') + txHash;
};

export const TransferProgress: React.FC<TransferProgressProps> = ({
  transfer,
  onCancel,
  onRetry,
  onClose,
}) => {
  const [eta, setEta] = useState<string>('');

  // Calculate ETA countdown
  useEffect(() => {
    if (!transfer.estimatedCompletion || transfer.status === 'completed' || transfer.status === 'failed') {
      setEta('');
      return;
    }

    const updateEta = () => {
      const now = Math.floor(Date.now() / 1000);
      const remaining = transfer.estimatedCompletion! - now;
      
      if (remaining <= 0) {
        setEta('Any moment now...');
        return;
      }

      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      
      if (minutes > 0) {
        setEta(`~${minutes}m ${seconds}s remaining`);
      } else {
        setEta(`~${seconds}s remaining`);
      }
    };

    updateEta();
    const interval = setInterval(updateEta, 1000);
    return () => clearInterval(interval);
  }, [transfer.estimatedCompletion, transfer.status]);

  const currentStepIndex = STEPS.findIndex(s => s.key === transfer.status);
  const isFailed = transfer.status === 'failed';
  const isComplete = transfer.status === 'completed';

  return (
    <div className={`transfer-progress ${isFailed ? 'failed' : ''} ${isComplete ? 'complete' : ''}`}>
      {/* Header */}
      <div className="transfer-progress-header">
        <div className="transfer-progress-title">
          {isFailed ? (
            <>
              <FailedIcon />
              Transfer Failed
            </>
          ) : isComplete ? (
            <>
              <SuccessIcon />
              Transfer Complete
            </>
          ) : (
            <>
              <LoadingIcon />
              Transfer in Progress
            </>
          )}
        </div>
        {onClose && (
          <button className="close-button" onClick={onClose}>
            <CloseIcon />
          </button>
        )}
      </div>

      {/* Amount */}
      <div className="transfer-amount">
        <span className="amount-value">{transfer.amount}</span>
        <span className="amount-token">{transfer.token}</span>
      </div>

      {/* Route */}
      <div className="transfer-route">
        <span className="route-chain">{transfer.sourceChain}</span>
        <ArrowIcon />
        <span className="route-chain">{transfer.destinationChain}</span>
      </div>

      {/* Progress Steps */}
      {!isFailed && (
        <div className="progress-steps">
          {STEPS.filter(s => s.key !== 'failed').map((step, index) => {
            const isCompleted = index < currentStepIndex;
            const isCurrent = index === currentStepIndex;
            const isPending = index > currentStepIndex;

            return (
              <div
                key={step.key}
                className={`progress-step ${isCompleted ? 'completed' : ''} ${isCurrent ? 'current' : ''} ${isPending ? 'pending' : ''}`}
              >
                <div className="step-indicator">
                  {isCompleted ? (
                    <CheckIcon />
                  ) : isCurrent && !isComplete ? (
                    <div className="step-loading" />
                  ) : (
                    <div className="step-number">{index + 1}</div>
                  )}
                </div>
                <div className="step-content">
                  <span className="step-label">{step.label}</span>
                  {isCurrent && <span className="step-description">{step.description}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ETA */}
      {eta && !isFailed && !isComplete && (
        <div className="transfer-eta">
          <ClockIcon />
          {eta}
        </div>
      )}

      {/* Error Message */}
      {isFailed && transfer.error && (
        <div className="transfer-error">
          <span className="error-label">Error:</span>
          <span className="error-message">{transfer.error}</span>
        </div>
      )}

      {/* Transaction Links */}
      <div className="transfer-links">
        {transfer.sourceTxHash && (
          <a
            href={getExplorerUrl(transfer.sourceChain, transfer.sourceTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
          >
            <ExternalLinkIcon />
            Source TX
          </a>
        )}
        {transfer.destinationTxHash && (
          <a
            href={getExplorerUrl(transfer.destinationChain, transfer.destinationTxHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
          >
            <ExternalLinkIcon />
            Destination TX
          </a>
        )}
      </div>

      {/* Transfer ID */}
      <div className="transfer-id">
        <span className="id-label">Transfer ID:</span>
        <span className="id-value">{transfer.transferId.slice(0, 12)}...{transfer.transferId.slice(-8)}</span>
        <button className="copy-button" onClick={() => navigator.clipboard.writeText(transfer.transferId)}>
          <CopyIcon />
        </button>
      </div>

      {/* Actions */}
      <div className="transfer-actions">
        {isFailed && onRetry && (
          <button className="action-button retry" onClick={onRetry}>
            <RetryIcon />
            Retry Transfer
          </button>
        )}
        {!isComplete && !isFailed && onCancel && (
          <button className="action-button cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
        {isComplete && onClose && (
          <button className="action-button done" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  );
};

// Icons
const LoadingIcon = () => (
  <svg className="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 12a9 9 0 11-6.219-8.56" />
  </svg>
);

const SuccessIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3fb950" strokeWidth="2">
    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
    <path d="M22 4L12 14.01l-3-3" />
  </svg>
);

const FailedIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f85149" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M15 9l-6 6M9 9l6 6" />
  </svg>
);

const CloseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const ArrowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7" />
  </svg>
);

const CheckIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const ClockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10" />
    <path d="M12 6v6l4 2" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" />
  </svg>
);

const CopyIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
  </svg>
);

const RetryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 4v6h-6M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
  </svg>
);

export default TransferProgress;

