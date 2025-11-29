/**
 * Auth Button Component
 * 
 * Compact button that shows connection status and opens the login modal.
 * When connected, shows account info with disconnect option.
 */

import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import './AuthButton.css';

const WALLET_ICONS: Record<string, string> = {
  solana: '◎',
  near: 'Ⓝ',
  'near-connect': 'Ⓝ',
  passkey: '🔐',
  ethereum: '⟠',
};

const WALLET_COLORS: Record<string, string> = {
  solana: '#9945FF',
  near: '#00C08B',
  'near-connect': '#00C08B',
  passkey: '#10b981',
  ethereum: '#627EEA',
};

export function AuthButton() {
  const {
    status,
    account,
    openLoginModal,
    disconnect,
  } = useAuth();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on escape
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  const handleDisconnect = async () => {
    setIsDropdownOpen(false);
    await disconnect();
  };

  if (status === 'connecting') {
    return (
      <button className="auth-button auth-button-connecting" disabled>
        <span className="auth-button-spinner" />
        <span>Connecting...</span>
      </button>
    );
  }

  if (status === 'connected' && account) {
    const icon = WALLET_ICONS[account.type] || '🔗';
    const color = WALLET_COLORS[account.type] || '#38bdf8';

    return (
      <div className="auth-button-container">
        <button
          ref={buttonRef}
          className="auth-button auth-button-connected"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          style={{ '--accent-color': color } as React.CSSProperties}
        >
          <span className="auth-button-icon">{icon}</span>
          <span className="auth-button-address">{account.displayName}</span>
          <svg
            className={`auth-button-chevron ${isDropdownOpen ? 'open' : ''}`}
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
          >
            <path
              d="M3 4.5L6 7.5L9 4.5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {isDropdownOpen && (
          <div ref={dropdownRef} className="auth-dropdown">
            <div className="auth-dropdown-header">
              <span className="auth-dropdown-icon" style={{ color }}>{icon}</span>
              <div className="auth-dropdown-info">
                <span className="auth-dropdown-name">{account.displayName}</span>
                <span className="auth-dropdown-type">
                  {account.type === 'solana' && 'Solana Wallet'}
                  {account.type === 'near' && 'NEAR Wallet'}
                  {account.type === 'near-connect' && 'NEAR Wallet'}
                  {account.type === 'passkey' && 'Passkey'}
                  {account.type === 'ethereum' && 'Ethereum Wallet'}
                </span>
              </div>
            </div>
            
            {account.type !== 'passkey' && (
              <div className="auth-dropdown-address">
                <code>{account.address}</code>
                <button
                  className="auth-dropdown-copy"
                  onClick={() => {
                    navigator.clipboard.writeText(account.address);
                  }}
                  title="Copy address"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <rect x="4" y="4" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M2 10V2.5C2 2.22386 2.22386 2 2.5 2H10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            )}

            <div className="auth-dropdown-actions">
              <button 
                className="auth-dropdown-action auth-dropdown-disconnect"
                onClick={handleDisconnect}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 14H3.5C2.67157 14 2 13.3284 2 12.5V3.5C2 2.67157 2.67157 2 3.5 2H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  <path d="M11 11L14 8L11 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 8H14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <button className="auth-button auth-button-connect" onClick={openLoginModal}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <circle cx="9" cy="9" r="7.5" stroke="currentColor" strokeWidth="1.5" />
        <path d="M9 6v6M6 9h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <span>Connect other wallets</span>
    </button>
  );
}

