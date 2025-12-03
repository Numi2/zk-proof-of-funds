/**
 * MultiChainWalletConnect - Connect wallets across multiple chains
 * 
 * Supports MetaMask (EVM), NEAR Wallet, and Phantom (Solana)
 */

import React, { useState } from 'react';
import { useBridge, type ChainId } from '../../contexts/BridgeContext';
import './MultiChainWalletConnect.css';

interface ChainWalletInfo {
  chainId: ChainId;
  name: string;
  icon: React.ReactNode;
  color: string;
  walletName: string;
  walletIcon: React.ReactNode;
}

const CHAIN_WALLETS: ChainWalletInfo[] = [
  {
    chainId: 'near',
    name: 'NEAR',
    icon: <NearIcon />,
    color: '#00ec97',
    walletName: 'NEAR Wallet',
    walletIcon: <NearIcon />,
  },
  {
    chainId: 'ethereum',
    name: 'Ethereum',
    icon: <EthereumIcon />,
    color: '#627eea',
    walletName: 'MetaMask',
    walletIcon: <MetaMaskIcon />,
  },
  {
    chainId: 'arbitrum',
    name: 'Arbitrum',
    icon: <ArbitrumIcon />,
    color: '#28a0f0',
    walletName: 'MetaMask',
    walletIcon: <MetaMaskIcon />,
  },
  {
    chainId: 'base',
    name: 'Base',
    icon: <BaseIcon />,
    color: '#0052ff',
    walletName: 'MetaMask',
    walletIcon: <MetaMaskIcon />,
  },
  {
    chainId: 'solana',
    name: 'Solana',
    icon: <SolanaIcon />,
    color: '#9945ff',
    walletName: 'Phantom',
    walletIcon: <PhantomIcon />,
  },
];

interface MultiChainWalletConnectProps {
  requiredChains?: ChainId[];
  onAllConnected?: () => void;
  compact?: boolean;
}

export const MultiChainWalletConnect: React.FC<MultiChainWalletConnectProps> = ({
  requiredChains,
  onAllConnected,
  compact = false,
}) => {
  const { state, connectWallet, disconnectWallet, isChainConnected, getConnectedAddress } = useBridge();
  const [connectingChain, setConnectingChain] = useState<ChainId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chainsToShow = requiredChains 
    ? CHAIN_WALLETS.filter(c => requiredChains.includes(c.chainId))
    : CHAIN_WALLETS;

  const handleConnect = async (chainId: ChainId) => {
    setConnectingChain(chainId);
    setError(null);
    
    try {
      await connectWallet(chainId);
      
      // Check if all required chains are connected
      if (requiredChains && onAllConnected) {
        const allConnected = requiredChains.every(c => 
          c === chainId || isChainConnected(c)
        );
        if (allConnected) {
          onAllConnected();
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection failed');
    } finally {
      setConnectingChain(null);
    }
  };

  const handleDisconnect = (chainId: ChainId) => {
    disconnectWallet(chainId);
  };

  const formatAddress = (address: string): string => {
    if (address.length > 16) {
      return `${address.slice(0, 6)}...${address.slice(-4)}`;
    }
    return address;
  };

  if (compact) {
    return (
      <div className="wallet-connect-compact">
        {chainsToShow.map(chain => {
          const connected = isChainConnected(chain.chainId);
          const address = getConnectedAddress(chain.chainId);
          
          return (
            <button
              key={chain.chainId}
              className={`wallet-chip ${connected ? 'connected' : ''}`}
              onClick={() => connected ? handleDisconnect(chain.chainId) : handleConnect(chain.chainId)}
              disabled={connectingChain === chain.chainId}
              style={{ '--chain-color': chain.color } as React.CSSProperties}
            >
              <span className="chip-icon">{chain.icon}</span>
              {connected ? (
                <span className="chip-address">{formatAddress(address || '')}</span>
              ) : connectingChain === chain.chainId ? (
                <span className="chip-loading">
                  <LoadingSpinner />
                </span>
              ) : (
                <span className="chip-label">Connect</span>
              )}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="multi-chain-wallet-connect">
      <div className="wallet-connect-header">
        <h3 className="wallet-connect-title">
          <WalletIcon />
          Connect Wallets
        </h3>
        <p className="wallet-connect-subtitle">
          Connect your wallets to bridge assets
        </p>
      </div>

      <div className="wallet-list">
        {chainsToShow.map(chain => {
          const connected = isChainConnected(chain.chainId);
          const address = getConnectedAddress(chain.chainId);
          const isConnecting = connectingChain === chain.chainId;
          
          return (
            <div 
              key={chain.chainId}
              className={`wallet-item ${connected ? 'connected' : ''}`}
              style={{ '--chain-color': chain.color } as React.CSSProperties}
            >
              <div className="wallet-item-chain">
                <span className="chain-icon-wrapper">
                  {chain.icon}
                </span>
                <div className="chain-info">
                  <span className="chain-name">{chain.name}</span>
                  {connected && address && (
                    <span className="connected-address">{formatAddress(address)}</span>
                  )}
                </div>
              </div>
              
              <div className="wallet-item-actions">
                {connected ? (
                  <>
                    <span className="connected-badge">
                      <CheckIcon />
                      Connected
                    </span>
                    <button
                      className="disconnect-btn"
                      onClick={() => handleDisconnect(chain.chainId)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="connect-btn"
                    onClick={() => handleConnect(chain.chainId)}
                    disabled={isConnecting || state.isLoading}
                  >
                    {isConnecting ? (
                      <>
                        <LoadingSpinner />
                        Connecting...
                      </>
                    ) : (
                      <>
                        {chain.walletIcon}
                        Connect {chain.walletName}
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="wallet-error">
          <AlertIcon />
          {error}
        </div>
      )}

      {state.isLoading && !connectingChain && (
        <div className="wallet-loading">
          <LoadingSpinner />
          Loading...
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Icons
// ============================================================================

function WalletIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12V7H5a2 2 0 010-4h14v4" />
      <path d="M3 5v14a2 2 0 002 2h16v-5" />
      <path d="M18 12a2 2 0 100 4 2 2 0 000-4z" />
    </svg>
  );
}

function LoadingSpinner() {
  return (
    <svg className="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 12a9 9 0 11-6.219-8.56" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function NearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M16.5 3.5L12 12l4.5 8.5h-3L9 12l4.5-8.5h3zM7.5 3.5v17h-3v-17h3z" />
    </svg>
  );
}

function EthereumIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 1.5l-7.5 11L12 17l7.5-4.5L12 1.5z" opacity="0.6" />
      <path d="M12 17l-7.5-4.5L12 22.5l7.5-10L12 17z" />
    </svg>
  );
}

function ArbitrumIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L3 7v10l9 5 9-5V7l-9-5zm0 2.18l6.63 3.68L12 11.54 5.37 7.86 12 4.18zM5 9.18l6 3.32v6.32l-6-3.32V9.18zm14 0v6.32l-6 3.32V12.5l6-3.32z" />
    </svg>
  );
}

function BaseIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12h8M12 8v8" stroke="white" strokeWidth="2" />
    </svg>
  );
}

function SolanaIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M4.5 17.5l3-3h12l-3 3h-12zM4.5 6.5l3 3h12l-3-3h-12zM4.5 12l3-3h12l-3 3h-12z" />
    </svg>
  );
}

function MetaMaskIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.5 3l-7.5 5.5 1.5-3.5-6 1z" fill="#E2761B" />
      <path d="M3.5 3l7.5 5.5-1.5-3.5 6 1z" fill="#E2761B" />
      <path d="M12 21l-4-6 4-3 4 3-4 6z" fill="#E2761B" />
    </svg>
  );
}

function PhantomIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="12" r="10" fill="#AB9FF2" />
      <circle cx="9" cy="10" r="2" fill="white" />
      <circle cx="15" cy="10" r="2" fill="white" />
    </svg>
  );
}

export default MultiChainWalletConnect;

