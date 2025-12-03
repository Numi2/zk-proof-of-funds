import { useMemo } from 'react';

export type VerificationStage = 
  | 'idle'
  | 'requesting'
  | 'request-received'
  | 'generating-proof'
  | 'proof-generated'
  | 'verifying'
  | 'verified'
  | 'rejected'
  | 'error';

interface Props {
  currentStage: VerificationStage;
  proofCount?: number;
  totalProofs?: number;
  error?: string | null;
}

interface StageDefinition {
  key: VerificationStage;
  label: string;
  description: string;
  icon: string;
}

const STAGES: StageDefinition[] = [
  {
    key: 'requesting',
    label: 'Initiating Request',
    description: 'Creating verification request and generating QR code',
    icon: '📡',
  },
  {
    key: 'request-received',
    label: 'Request Received',
    description: 'User scanned QR code and opened ZKPassport app',
    icon: '📱',
  },
  {
    key: 'generating-proof',
    label: 'Generating Proof',
    description: 'User is generating zero-knowledge proof on their device',
    icon: '⚙️',
  },
  {
    key: 'proof-generated',
    label: 'Proof Generated',
    description: 'ZK proof created successfully, verifying...',
    icon: '🔒',
  },
  {
    key: 'verified',
    label: 'Verified',
    description: 'Identity verification successful',
    icon: '✓',
  },
];

export function ZKPassportProgress({ currentStage, proofCount, totalProofs, error }: Props) {
  const currentStageIndex = useMemo(() => {
    const index = STAGES.findIndex(s => s.key === currentStage);
    // For verified/rejected/error, show as the last completed stage
    if (currentStage === 'verified') return STAGES.length - 1;
    if (currentStage === 'rejected' || currentStage === 'error') return STAGES.findIndex(s => s.key === 'proof-generated');
    return index;
  }, [currentStage]);

  const isError = currentStage === 'error' || currentStage === 'rejected';
  const isComplete = currentStage === 'verified';
  const isIdle = currentStage === 'idle';

  if (isIdle) {
    return null;
  }

  return (
    <div className={`verification-progress ${isError ? 'error' : ''} ${isComplete ? 'complete' : ''}`}>
      <div className="progress-header">
        <h4>Verification Progress</h4>
        {proofCount !== undefined && totalProofs !== undefined && (
          <span className="proof-counter">
            Proof {proofCount}/{totalProofs}
          </span>
        )}
      </div>

      <div className="progress-stages">
        {STAGES.map((stage, index) => {
          const isCurrentStage = currentStageIndex === index;
          const isCompletedStage = currentStageIndex > index;
          const isFutureStage = currentStageIndex < index;
          const isErrorOnThisStage = isError && isCurrentStage;

          return (
            <div
              key={stage.key}
              className={`progress-stage ${isCurrentStage ? 'current' : ''} ${isCompletedStage ? 'completed' : ''} ${isFutureStage ? 'future' : ''} ${isErrorOnThisStage ? 'error' : ''}`}
            >
              <div className="stage-indicator">
                <div className="stage-icon">
                  {isErrorOnThisStage ? '✗' : isCompletedStage || (isCurrentStage && isComplete) ? '✓' : stage.icon}
                </div>
                {index < STAGES.length - 1 && (
                  <div className={`stage-connector ${isCompletedStage ? 'completed' : ''}`} />
                )}
              </div>
              <div className="stage-content">
                <span className="stage-label">{stage.label}</span>
                {(isCurrentStage || isCompletedStage) && (
                  <span className="stage-description">
                    {isErrorOnThisStage && error ? error : stage.description}
                  </span>
                )}
              </div>
              {isCurrentStage && !isComplete && !isError && (
                <div className="stage-spinner">
                  <div className="spinner" />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {isComplete && (
        <div className="progress-success-banner">
          <span className="success-icon">🎉</span>
          <span>Verification completed successfully!</span>
        </div>
      )}

      {isError && (
        <div className="progress-error-banner">
          <span className="error-icon">⚠️</span>
          <span>{currentStage === 'rejected' ? 'Verification was rejected by the user' : error || 'Verification failed'}</span>
        </div>
      )}
    </div>
  );
}

// Compact inline progress indicator
export function ZKPassportProgressInline({ currentStage }: Pick<Props, 'currentStage'>) {
  const stages: { key: VerificationStage; label: string }[] = [
    { key: 'requesting', label: 'Request' },
    { key: 'request-received', label: 'Scan' },
    { key: 'generating-proof', label: 'Prove' },
    { key: 'verified', label: 'Verify' },
  ];

  const currentIndex = useMemo(() => {
    if (currentStage === 'idle') return -1;
    if (currentStage === 'verified') return 3;
    if (currentStage === 'proof-generated') return 3;
    if (currentStage === 'generating-proof') return 2;
    if (currentStage === 'request-received') return 1;
    return 0;
  }, [currentStage]);

  const isError = currentStage === 'error' || currentStage === 'rejected';

  if (currentStage === 'idle') return null;

  return (
    <div className={`progress-inline ${isError ? 'error' : ''}`}>
      {stages.map((stage, index) => (
        <div
          key={stage.key}
          className={`progress-inline-step ${index <= currentIndex ? 'active' : ''} ${index === currentIndex && !isError && currentStage !== 'verified' ? 'current' : ''}`}
        >
          <div className="inline-step-dot" />
          <span className="inline-step-label">{stage.label}</span>
          {index < stages.length - 1 && (
            <div className={`inline-step-line ${index < currentIndex ? 'completed' : ''}`} />
          )}
        </div>
      ))}
    </div>
  );
}

