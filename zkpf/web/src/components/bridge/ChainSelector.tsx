import React from 'react';
import './ChainSelector.css';

export interface Chain {
  id: string;
  name: string;
  symbol: string;
  nativeCurrency: string;
  icon: string;
  color: string;
  isTestnet?: boolean;
}

export const SUPPORTED_CHAINS: Chain[] = [
  { id: 'near', name: 'NEAR Protocol', symbol: 'NEAR', nativeCurrency: 'NEAR', icon: 'N', color: '#00ec97' },
  { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', nativeCurrency: 'ETH', icon: 'Ξ', color: '#627eea' },
  { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', nativeCurrency: 'ETH', icon: 'A', color: '#28a0f0' },
  { id: 'base', name: 'Base', symbol: 'BASE', nativeCurrency: 'ETH', icon: 'B', color: '#0052ff' },
  { id: 'solana', name: 'Solana', symbol: 'SOL', nativeCurrency: 'SOL', icon: 'S', color: '#9945ff' },
];

export const TESTNET_CHAINS: Chain[] = [
  { id: 'near-testnet', name: 'NEAR Testnet', symbol: 'NEAR', nativeCurrency: 'NEAR', icon: 'N', color: '#00ec97', isTestnet: true },
  { id: 'ethereum-sepolia', name: 'Ethereum Sepolia', symbol: 'ETH', nativeCurrency: 'ETH', icon: 'Ξ', color: '#627eea', isTestnet: true },
  { id: 'arbitrum-sepolia', name: 'Arbitrum Sepolia', symbol: 'ARB', nativeCurrency: 'ETH', icon: 'A', color: '#28a0f0', isTestnet: true },
  { id: 'base-sepolia', name: 'Base Sepolia', symbol: 'BASE', nativeCurrency: 'ETH', icon: 'B', color: '#0052ff', isTestnet: true },
  { id: 'solana-devnet', name: 'Solana Devnet', symbol: 'SOL', nativeCurrency: 'SOL', icon: 'S', color: '#9945ff', isTestnet: true },
];

interface ChainSelectorProps {
  value: string;
  onChange: (chainId: string) => void;
  label?: string;
  excludeChains?: string[];
  showBalance?: boolean;
  balance?: string;
  disabled?: boolean;
  useTestnet?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const ChainSelector: React.FC<ChainSelectorProps> = ({
  value,
  onChange,
  label,
  excludeChains = [],
  showBalance = false,
  balance,
  disabled = false,
  useTestnet = false,
  size = 'md',
}) => {
  const chains = useTestnet ? TESTNET_CHAINS : SUPPORTED_CHAINS;
  const availableChains = chains.filter(c => !excludeChains.includes(c.id));
  const selectedChain = chains.find(c => c.id === value);

  return (
    <div className={`chain-selector-container size-${size}`}>
      {label && <label className="chain-selector-label">{label}</label>}
      
      <div className="chain-selector-dropdown">
        <button
          className={`chain-selector-button ${disabled ? 'disabled' : ''}`}
          disabled={disabled}
          onClick={() => {}} // Would open dropdown menu
        >
          {selectedChain ? (
            <>
              <span 
                className="chain-icon"
                style={{ background: selectedChain.color }}
              >
                {selectedChain.icon}
              </span>
              <span className="chain-name">{selectedChain.name}</span>
              {selectedChain.isTestnet && (
                <span className="testnet-badge">Testnet</span>
              )}
            </>
          ) : (
            <span className="chain-placeholder">Select chain</span>
          )}
          <ChevronDownIcon />
        </button>

        {/* Using native select for simplicity - could be replaced with custom dropdown */}
        <select
          className="chain-native-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        >
          <option value="" disabled>Select a chain</option>
          {availableChains.map((chain) => (
            <option key={chain.id} value={chain.id}>
              {chain.name}
            </option>
          ))}
        </select>
      </div>

      {showBalance && balance && (
        <div className="chain-balance">
          <span className="balance-label">Balance:</span>
          <span className="balance-value">{balance} {selectedChain?.nativeCurrency}</span>
        </div>
      )}
    </div>
  );
};

const ChevronDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export default ChainSelector;

