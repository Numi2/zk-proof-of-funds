/**
 * PersonhoodSettings Component
 * 
 * Wallet settings panel for "Proof you are a real person" verification.
 * 
 * Design principles:
 * - Non-technical language for anxious users
 * - No dead ends - always provide a way forward
 * - Clear progress indicators
 * - Real operations only (no demo mode)
 */

import { useState, useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { usePersonhood, type PersonhoodFlowStatus, type PersonhoodFlowError } from '../../hooks/usePersonhood';
import './PersonhoodSettings.css';

// ============================================================================
// Helper Functions
// ============================================================================

function getStatusDisplay(status: PersonhoodFlowStatus): {
  label: string;
  icon: string;
  className: string;
} {
  switch (status) {
    case 'loading_status':
      return { label: 'Checking status...', icon: '⏳', className: 'status-loading' };
    case 'not_verified':
      return { label: 'Not verified', icon: '○', className: 'status-unverified' };
    case 'awaiting_passport':
      return { label: 'Waiting for passport scan...', icon: '📱', className: 'status-pending' };
    case 'signing':
      return { label: 'Confirming your wallet...', icon: '🔐', className: 'status-pending' };
    case 'submitting':
      return { label: 'Saving verification...', icon: '💾', className: 'status-pending' };
    case 'verified':
      return { label: 'Verified as unique person', icon: '✓', className: 'status-verified' };
    case 'error':
      return { label: 'Verification failed', icon: '⚠', className: 'status-error' };
    default:
      return { label: 'Unknown status', icon: '?', className: 'status-unknown' };
  }
}

function getErrorMessage(error: PersonhoodFlowError | null): string {
  if (!error) return 'Something went wrong. Please try again.';
  return error.message;
}

function getActionButtonLabel(status: PersonhoodFlowStatus, isWalletReady: boolean): string {
  if (!isWalletReady) {
    return 'Set up wallet first';
  }

  switch (status) {
    case 'not_verified':
    case 'error':
      return 'Verify with your passport';
    case 'awaiting_passport':
    case 'signing':
    case 'submitting':
      return 'Verifying...';
    case 'verified':
      return 'Verified ✓';
    default:
      return 'Verify with your passport';
  }
}

// ============================================================================
// Sub-components
// ============================================================================

interface QRCodeModalProps {
  url: string;
  onCancel: () => void;
}

function QRCodeModal({ url, onCancel }: QRCodeModalProps) {
  const [showManualLink, setShowManualLink] = useState(false);

  return (
    <div className="personhood-modal-overlay" onClick={onCancel}>
      <div className="personhood-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Scan with ZKPassport</h3>
          <button 
            className="modal-close-button" 
            onClick={onCancel}
            aria-label="Cancel"
          >
            ✕
          </button>
        </header>
        
        <div className="modal-content">
          <div className="qr-container">
            <QRCodeSVG
              value={url}
              size={240}
              level="M"
              includeMargin={true}
              bgColor="#ffffff"
              fgColor="#000000"
            />
          </div>
          
          <p className="qr-instructions">
            Scan this QR code with the ZKPassport app on your phone.
          </p>
          
          <div className="qr-help">
            <button 
              className="link-button"
              onClick={() => setShowManualLink(!showManualLink)}
            >
              Having trouble? {showManualLink ? 'Hide link' : 'Show link'}
            </button>
            
            {showManualLink && (
              <div className="manual-link-container">
                <input 
                  type="text" 
                  value={url} 
                  readOnly 
                  className="manual-link-input"
                  onClick={e => (e.target as HTMLInputElement).select()}
                />
                <a 
                  href={url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="open-link-button"
                >
                  Open in new tab
                </a>
              </div>
            )}
          </div>
        </div>

        <footer className="modal-footer">
          <button 
            className="secondary-button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}

interface ProcessingModalProps {
  status: PersonhoodFlowStatus;
  onCancel: () => void;
}

function ProcessingModal({ status, onCancel }: ProcessingModalProps) {
  const statusInfo = getStatusDisplay(status);
  
  const canCancel = status === 'signing' || status === 'submitting';

  return (
    <div className="personhood-modal-overlay">
      <div className="personhood-modal processing-modal">
        <div className="modal-content">
          <div className="processing-indicator">
            <div className="spinner" />
          </div>
          
          <p className="processing-message">{statusInfo.label}</p>
          
          {status === 'signing' && (
            <p className="processing-submessage">
              Proving you own this wallet...
            </p>
          )}
          
          {status === 'submitting' && (
            <p className="processing-submessage">
              Almost done...
            </p>
          )}
        </div>

        {canCancel && (
          <footer className="modal-footer">
            <button 
              className="secondary-button"
              onClick={onCancel}
            >
              Cancel
            </button>
          </footer>
        )}
      </div>
    </div>
  );
}

interface ErrorModalProps {
  error: PersonhoodFlowError | null;
  onRetry: () => void;
  onDismiss: () => void;
}

function ErrorModal({ error, onRetry, onDismiss }: ErrorModalProps) {
  const message = getErrorMessage(error);
  const canRetry = error?.type !== 'wallet_unavailable';
  
  // Check for too_many_wallet_bindings error code
  const isTooManyWallets = error?.type === 'binding_failed' && 
    'code' in error && 
    error.code === 'too_many_wallet_bindings';

  return (
    <div className="personhood-modal-overlay" onClick={onDismiss}>
      <div className="personhood-modal error-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <h3>Couldn't complete verification</h3>
        </header>
        
        <div className="modal-content">
          <p className="error-message">{message}</p>
          
          {isTooManyWallets && (
            <p className="error-help">
              Each person can verify up to 3 wallets. If you need help, please contact support.
            </p>
          )}
        </div>

        <footer className="modal-footer">
          {canRetry && !isTooManyWallets && (
            <button 
              className="primary-button"
              onClick={onRetry}
            >
              Try again
            </button>
          )}
          <button 
            className="secondary-button"
            onClick={onDismiss}
          >
            {canRetry && !isTooManyWallets ? 'Close' : 'OK'}
          </button>
        </footer>
      </div>
    </div>
  );
}

interface SuccessModalProps {
  personhoodId: string | null;
  bindingsCount: number | null;
  onDismiss: () => void;
}

function SuccessModal({ personhoodId, bindingsCount, onDismiss }: SuccessModalProps) {
  return (
    <div className="personhood-modal-overlay" onClick={onDismiss}>
      <div className="personhood-modal success-modal" onClick={e => e.stopPropagation()}>
        <header className="modal-header">
          <span className="success-icon">✓</span>
          <h3>You're verified!</h3>
        </header>
        
        <div className="modal-content">
          <p className="success-message">
            You've proven you're a unique person without sharing any personal details.
          </p>
          
          {bindingsCount !== null && bindingsCount > 1 && (
            <p className="binding-info">
              You have {bindingsCount} wallet{bindingsCount > 1 ? 's' : ''} linked to your identity.
            </p>
          )}
          
          {personhoodId && (
            <p className="personhood-id-display">
              <span className="label">Verification ID:</span>
              <code className="id-value">{personhoodId.slice(0, 16)}...</code>
            </p>
          )}
        </div>

        <footer className="modal-footer">
          <button 
            className="primary-button"
            onClick={onDismiss}
          >
            Done
          </button>
        </footer>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function PersonhoodSettings() {
  const {
    status,
    personhoodId,
    bindingsCount,
    error,
    zkPassportUrl,
    isWalletReady,
    isLoading,
    activeWalletType,
    startVerification,
    cancelVerification,
    refreshStatus,
  } = usePersonhood();

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const prevStatusRef = useRef<PersonhoodFlowStatus | null>(null);

  // Show success modal when transitioning to verified
  useEffect(() => {
    if (prevStatusRef.current && 
        prevStatusRef.current !== 'verified' && 
        prevStatusRef.current !== 'loading_status' &&
        status === 'verified') {
      setShowSuccessModal(true);
    }
    prevStatusRef.current = status;
  }, [status]);

  const handleStartVerification = async () => {
    await startVerification();
  };

  const handleCancelFlow = () => {
    cancelVerification();
  };

  const handleDismissError = () => {
    void refreshStatus();
  };

  const handleRetry = async () => {
    await startVerification();
  };

  const handleDismissSuccess = () => {
    setShowSuccessModal(false);
  };

  const statusDisplay = getStatusDisplay(status);
  const buttonLabel = getActionButtonLabel(status, isWalletReady);
  const isButtonDisabled = !isWalletReady || isLoading || status === 'verified';

  return (
    <section className="personhood-settings">
      <header className="settings-header">
        <h3>Proof you are a real person</h3>
      </header>

      <div className="settings-content">
        <div className={`status-badge ${statusDisplay.className}`}>
          <span className="status-icon">{statusDisplay.icon}</span>
          <span className="status-label">{statusDisplay.label}</span>
        </div>

        <p className="explanation">
          Prove you're a real, unique person without revealing any personal details. 

        </p>

        {status === 'verified' && personhoodId && (
          <div className="verified-details">
            <p className="verified-id">
              <span className="label">ID:</span>
              <code>{personhoodId.slice(0, 12)}...</code>
            </p>
            {bindingsCount !== null && (
              <p className="bindings-count">
                {bindingsCount} wallet{bindingsCount !== 1 ? 's' : ''} linked
              </p>
            )}
          </div>
        )}

        <button
          className={`action-button ${status === 'verified' ? 'verified' : 'primary'}`}
          onClick={handleStartVerification}
          disabled={isButtonDisabled}
        >
          {buttonLabel}
        </button>

        {!isWalletReady && (
          <p className="wallet-hint">
            Connect a wallet (Zcash, Solana, NEAR, or Passkey) to enable verification.
          </p>
        )}
        
        {isWalletReady && activeWalletType && status !== 'verified' && (
          <p className="wallet-type-indicator">
            Using {activeWalletType === 'zcash' ? 'Zcash' : 
                   activeWalletType === 'solana' ? 'Solana' :
                   activeWalletType === 'near' ? 'NEAR' : 'Passkey'} wallet
          </p>
        )}
      </div>

      {/* QR Code Modal */}
      {status === 'awaiting_passport' && zkPassportUrl && (
        <QRCodeModal 
          url={zkPassportUrl} 
          onCancel={handleCancelFlow}
        />
      )}

      {/* Processing Modal (signing/submitting) */}
      {(status === 'signing' || status === 'submitting') && (
        <ProcessingModal 
          status={status}
          onCancel={handleCancelFlow}
        />
      )}

      {/* Error Modal */}
      {status === 'error' && (
        <ErrorModal
          error={error}
          onRetry={handleRetry}
          onDismiss={handleDismissError}
        />
      )}

      {/* Success Modal */}
      {showSuccessModal && status === 'verified' && (
        <SuccessModal
          personhoodId={personhoodId}
          bindingsCount={bindingsCount}
          onDismiss={handleDismissSuccess}
        />
      )}
    </section>
  );
}

export default PersonhoodSettings;
