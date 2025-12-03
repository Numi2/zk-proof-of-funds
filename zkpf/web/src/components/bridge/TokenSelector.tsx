/**
 * TokenSelector - Select tokens for bridging with balance display
 */

import React, { useState, useRef, useEffect } from 'react';
import { useBridge, type ChainId } from '../../contexts/BridgeContext';
import './TokenSelector.css';

export interface Token {
  symbol: string;
  name: string;
  decimals: number;
  isStablecoin: boolean;
  logoUrl?: string;
  balance?: string;
  balanceUsd?: string;
}

interface TokenSelectorProps {
  chainId: ChainId;
  value: string;
  onChange: (token: Token) => void;
  showBalance?: boolean;
  filterBridgeable?: boolean;
  disabled?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

// Token logos (simplified - in production use actual logos)
const TOKEN_LOGOS: Record<string, { bg: string; icon: string }> = {
  USDC: { bg: '#2775ca', icon: '$' },
  USDT: { bg: '#26a17b', icon: '₮' },
  WETH: { bg: '#627eea', icon: 'Ξ' },
  NEAR: { bg: '#00ec97', icon: 'N' },
  DAI: { bg: '#f4b731', icon: '◈' },
  SOL: { bg: '#9945ff', icon: 'S' },
  ETH: { bg: '#627eea', icon: 'Ξ' },
};

export const TokenSelector: React.FC<TokenSelectorProps> = ({
  chainId,
  value,
  onChange,
  showBalance = true,
  filterBridgeable = true,
  disabled = false,
  size = 'md',
}) => {
  const { state, getBalance } = useBridge();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Filter tokens based on chain and search
  const availableTokens = state.supportedTokens
    .filter(token => {
      if (filterBridgeable && token.availableChains && !token.availableChains.includes(chainId)) {
        return false;
      }
      if (search) {
        const searchLower = search.toLowerCase();
        return (
          token.symbol.toLowerCase().includes(searchLower) ||
          token.name.toLowerCase().includes(searchLower)
        );
      }
      return true;
    })
    .map(token => {
      const balance = getBalance(chainId, token.symbol);
      return {
        ...token,
        balance: balance?.balance || '0.00',
        balanceUsd: balance?.balanceUsd,
      };
    });

  const selectedToken = availableTokens.find(t => t.symbol === value) || availableTokens[0];

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (token: Token) => {
    onChange(token);
    setIsOpen(false);
    setSearch('');
  };

  const formatBalance = (balance: string): string => {
    const num = parseFloat(balance.replace(/,/g, ''));
    if (isNaN(num)) return '0.00';
    if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
    if (num < 0.01 && num > 0) return '< 0.01';
    return num.toFixed(2);
  };

  const getTokenLogo = (symbol: string) => {
    const logo = TOKEN_LOGOS[symbol] || { bg: '#8b949e', icon: symbol[0] };
    return (
      <div className="token-logo" style={{ background: logo.bg }}>
        {logo.icon}
      </div>
    );
  };

  return (
    <div 
      className={`token-selector size-${size} ${disabled ? 'disabled' : ''}`} 
      ref={containerRef}
    >
      <button
        type="button"
        className={`token-selector-button ${isOpen ? 'open' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        disabled={disabled}
      >
        {selectedToken ? (
          <>
            {getTokenLogo(selectedToken.symbol)}
            <div className="token-button-info">
              <span className="token-button-symbol">{selectedToken.symbol}</span>
              {showBalance && (
                <span className="token-button-balance">
                  {formatBalance(selectedToken.balance || '0')}
                </span>
              )}
            </div>
          </>
        ) : (
          <span className="token-button-placeholder">Select token</span>
        )}
        <ChevronIcon className={isOpen ? 'open' : ''} />
      </button>

      {isOpen && (
        <div className="token-dropdown">
          <div className="token-search">
            <SearchIcon />
            <input
              type="text"
              placeholder="Search tokens..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoFocus
            />
          </div>

          <div className="token-list">
            {availableTokens.length === 0 ? (
              <div className="token-list-empty">
                No tokens found
              </div>
            ) : (
              availableTokens.map(token => (
                <button
                  key={token.symbol}
                  type="button"
                  className={`token-item ${token.symbol === value ? 'selected' : ''}`}
                  onClick={() => handleSelect(token)}
                >
                  {getTokenLogo(token.symbol)}
                  <div className="token-item-info">
                    <span className="token-item-symbol">{token.symbol}</span>
                    <span className="token-item-name">{token.name}</span>
                  </div>
                  {showBalance && (
                    <div className="token-item-balance">
                      <span className="balance-amount">{formatBalance(token.balance || '0')}</span>
                      {token.balanceUsd && (
                        <span className="balance-usd">${token.balanceUsd}</span>
                      )}
                    </div>
                  )}
                  {token.isStablecoin && (
                    <span className="stablecoin-badge">Stable</span>
                  )}
                </button>
              ))
            )}
          </div>

          {filterBridgeable && (
            <div className="token-dropdown-footer">
              <span className="footer-note">
                Showing tokens available for {chainId.toUpperCase()}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Icons
function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg 
      width="16" 
      height="16" 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2"
      className={`chevron-icon ${className}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  );
}

export default TokenSelector;

