import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { PcdProvider } from '../../context/PcdContext';
import { AuthButton } from '../auth/AuthButton';
import { PasskeyPrompt } from './PasskeyPrompt';

export function WalletLayout() {
  const { state } = useWebZjsContext();
  
  const isConnected = state.webWallet !== null;
  const isLoading = state.loading;
  const isSyncing = state.syncInProgress;

  // Determine connection status: loading > syncing > connected > disconnected
  const getConnectionStatus = () => {
    if (isLoading) return { className: 'connecting', text: 'Connecting...' };
    if (isConnected && isSyncing) return { className: 'connecting', text: 'Syncing...' };
    if (isConnected) return { className: 'connected', text: 'Connected' };
    return { className: 'disconnected', text: 'Not Connected' };
  };

  const connectionStatus = getConnectionStatus();

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
                <div className="wallet-logo">🛡️</div>
                <div>
                  <p className="eyebrow">Zcash Privacy Wallet</p>
                  <h1>Shielded WebWallet</h1>
                </div>
              </div>
            </div>
            <div className={`connection-status wallet-connection-status ${connectionStatus.className}`}>
              <span className="status-dot"></span>
              <span className="status-text">
                {connectionStatus.text}
              </span>
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

