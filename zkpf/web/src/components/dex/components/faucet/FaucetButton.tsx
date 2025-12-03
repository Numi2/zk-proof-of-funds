/**
 * Compact Faucet Button Component
 * 
 * One-click faucet button that instantly claims 1,000 USDC on Arbitrum Sepolia
 */

import { useNetwork } from '../../context/NetworkContext';
import { useFaucetClaim } from '../../hooks/useFaucetClaim';
import './FaucetButton.css';

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

export function FaucetButton() {
  const { isTestnet } = useNetwork();
  const { claim, loading, canClaim, isRegistered, checkingRegistration } = useFaucetClaim();

  // Don't show on mainnet
  if (!isTestnet) {
    return null;
  }

  const handleClick = async () => {
    if (!canClaim) {
      if (isRegistered === false) {
        showToast('Please register your account first', 'error');
      } else {
        showToast('Unable to claim at this time', 'error');
      }
      return;
    }

    const result = await claim();
    if (result.success) {
      showToast(result.message, 'success');
    } else {
      showToast(result.message, 'error');
    }
  };

  const getButtonText = () => {
    if (loading) {
      return 'Claiming...';
    }
    if (checkingRegistration) {
      return 'Checking...';
    }
    if (isRegistered === false) {
      return 'Register';
    }
    return 'Get 1,000 USDC';
  };

  return (
    <button
      className="faucet-button"
      onClick={handleClick}
      disabled={loading || checkingRegistration}
      title="Claim 1,000 Test USDC"
    >
      {loading ? (
        <span className="faucet-button-spinner">⏳</span>
      ) : (
        <span className="faucet-button-icon">💧</span>
      )}
      <span className="faucet-button-text">{getButtonText()}</span>
    </button>
  );
}

