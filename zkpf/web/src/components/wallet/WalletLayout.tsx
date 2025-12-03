import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { PcdProvider } from '../../context/PcdContext';
import { AuthButton } from '../auth/AuthButton';
import { PasskeyPrompt } from './PasskeyPrompt';
import { WalletIcon } from '../icons/WalletIcon';

export function WalletLayout() {

  return (
    <PcdProvider>
      <PasskeyPrompt />
      <div className="wallet-layout">
        <header className="wallet-page-header">
          <div className="wallet-header-top">
            <div className="wallet-brand">
              <NavLink to="/" className="wallet-back-link">
                ← Back to ZKPF
              </NavLink>
              <div className="wallet-title-block">
                <div className="wallet-logo"><WalletIcon size={24} /></div>
                <div>
                  <p className="eyebrow">Zcash Privacy Wallet</p>
                  <h1>Shielded WebWallet</h1>
                </div>
              </div>
            </div>
          </div>
          
          <p className="wallet-tagline">
            Manage your funds.
          </p>
          
          <nav className="wallet-nav">
            <NavLink
              to="/wallet"
              end
              className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active' : 'wallet-nav-link')}
            >
              Dashboard
            </NavLink>
            <NavLink
              to="/wallet/receive"
              className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active' : 'wallet-nav-link')}
            >
              Receive
            </NavLink>
            <NavLink
              to="/wallet/send-to-shielded"
              className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active wallet-nav-link-pczt' : 'wallet-nav-link wallet-nav-link-pczt')}
            >
              PCZT
            </NavLink>
            {/* Hidden navigation links
            <NavLink
              to="/wallet/send"
              className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active' : 'wallet-nav-link')}
            >
              Send
            </NavLink>
            <NavLink
              to="/wallet/uri-payment"
              className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active wallet-nav-link-uri' : 'wallet-nav-link wallet-nav-link-uri')}
            >
              Links
            </NavLink>
            */}
          </nav>
        </header>
        
        <Suspense fallback={<div className="wallet-loading">Loading...</div>}>
          <Outlet />
        </Suspense>
        
        <div className="wallet-footer-auth">
          <AuthButton />
        </div>
      </div>
    </PcdProvider>
  );
}

