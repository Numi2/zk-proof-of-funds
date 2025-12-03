/**
 * USDC Faucet Component
 * 
 * Simplified one-click faucet for claiming 1,000 USDC on Arbitrum Sepolia
 */

import { useNetwork } from '../../context/NetworkContext';
import { useFaucetClaim } from '../../hooks/useFaucetClaim';
import './UsdcFaucet.css';

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-show');
  }, 10);
  setTimeout(() => {
    toast.classList.remove('toast-show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

export function UsdcFaucet() {
  const { isTestnet } = useNetwork();
  const { claim, loading, canClaim, remainingClaims, claimHistory, isRegistered, checkingRegistration } = useFaucetClaim();

  if (!isTestnet) {
    return null;
  }

  const handleClaim = async () => {
    const result = await claim();
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message, 'error');
    }
  };

  return (
    <div className="usdc-faucet">
      <div className="faucet-header">
        <h3 className="faucet-title">
          <span className="faucet-icon">💧</span>
          USDC Faucet
        </h3>
        <div className="faucet-badge testnet">Testnet</div>
      </div>

      <div className="faucet-description">
        <p>
          Get 1,000 test USDC on Arbitrum Sepolia to start trading.
          {remainingClaims > 0 && ` ${remainingClaims} ${remainingClaims === 1 ? 'claim' : 'claims'} remaining.`}
        </p>
      </div>

      {/* Registration Status */}
      {checkingRegistration && (
        <div className="faucet-message info">
          <span className="message-icon">🔍</span>
          Checking account registration...
        </div>
      )}

      {!checkingRegistration && isRegistered === false && (
        <div className="faucet-message warning">
          <span className="message-icon">⚠️</span>
          <div className="message-content">
            <p><strong>Account Not Registered</strong></p>
            <p className="message-hint">Please register your account first to claim USDC.</p>
          </div>
        </div>
      )}

      {/* Claim Button */}
      <button
        className="faucet-claim-button"
        onClick={handleClaim}
        disabled={!canClaim}
      >
        {loading ? (
          <>
            <span className="button-spinner">⏳</span>
            Claiming...
          </>
        ) : checkingRegistration ? (
          <>
            <span className="button-spinner">🔍</span>
            Checking Registration...
          </>
        ) : isRegistered === false ? (
          'Register Account First'
        ) : remainingClaims === 0 ? (
          'Maximum Claims Reached'
        ) : (
          <>
            <span className="button-icon">💧</span>
            Claim 1,000 USDC
          </>
        )}
      </button>

      {/* Last Claim Info */}
      {claimHistory.lastClaim && (
        <div className="last-claim-info">
          Last claimed: {new Date(claimHistory.lastClaim).toLocaleString()}
        </div>
      )}
    </div>
  );
}
