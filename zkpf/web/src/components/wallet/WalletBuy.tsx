/**
 * WalletBuy - Fiat on-ramp page for the wallet
 * 
 * Wraps the ZkpfRamp component to provide a seamless buying experience
 * directly within the wallet interface.
 */

import { useState, useEffect, useCallback } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';
import { ZkpfRamp } from '../ZkpfRamp';

export function WalletBuy() {
  const { state } = useWebZjsContext();
  const { getAccountData } = useWebzjsActions();
  const [addresses, setAddresses] = useState<{
    unifiedAddress: string;
    transparentAddress: string;
  }>({
    unifiedAddress: '',
    transparentAddress: '',
  });
  
  const isConnected = state.activeAccount != null;
  
  // Fetch wallet addresses when connected
  useEffect(() => {
    if (!isConnected) return;
    
    const fetchAddresses = async () => {
      const data = await getAccountData();
      if (data) {
        setAddresses({
          unifiedAddress: data.unifiedAddress,
          transparentAddress: data.transparentAddress,
        });
      }
    };
    
    fetchAddresses();
  }, [isConnected, getAccountData]);
  
  const handleSuccess = useCallback((txHash: string, amount: string, asset: string) => {
    console.log(`Purchase complete: ${amount} ${asset}, tx: ${txHash}`);
  }, []);
  
  const handleError = useCallback((error: Error) => {
    console.error('Purchase error:', error);
  }, []);
  
  if (!isConnected) {
    return (
      <div className="wallet-buy-prompt">
        <div className="card">
          <div className="wallet-connect-icon">💵</div>
          <h3>Connect Wallet to Buy ZEC</h3>
          <p className="muted">
            Connect or create your wallet first to enable fiat on-ramp purchases.
            Your ZEC will be delivered directly to your shielded address.
          </p>
          <div className="wallet-buy-features">
            <div className="wallet-feature">
              <span className="wallet-feature-icon">🔒</span>
              <span>No KYC Required</span>
            </div>
            <div className="wallet-feature">
              <span className="wallet-feature-icon">⚡</span>
              <span>Fast Delivery</span>
            </div>
            <div className="wallet-feature">
              <span className="wallet-feature-icon">🛡️</span>
              <span>Direct to Shielded</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-buy-page">
      <ZkpfRamp
        destinationAddress={addresses.unifiedAddress}
        defaultAsset="ZEC"
        onSuccess={handleSuccess}
        onError={handleError}
      />
    </div>
  );
}

