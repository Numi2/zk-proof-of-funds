import { NavLink, Outlet } from 'react-router-dom';
import { useWebZjsContext } from '../../context/WebzjsContext';

export function WalletLayout() {
  const { state } = useWebZjsContext();
  
  const isConnected = state.webWallet !== null;
  const isSyncing = state.syncInProgress;

  return (
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
          <div className={`connection-status ${isConnected ? (isSyncing ? 'connecting' : 'connected') : 'disconnected'}`}>
            <span className="status-dot"></span>
            <span className="status-text">
              {isConnected ? (isSyncing ? 'Syncing...' : 'Connected') : 'Not Connected'}
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
            to="/wallet/buy"
            className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active wallet-nav-link-buy' : 'wallet-nav-link wallet-nav-link-buy')}
          >
            💵 Buy
          </NavLink>
          <NavLink
            to="/wallet/receive"
            className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active' : 'wallet-nav-link')}
          >
            Receive
          </NavLink>
          <NavLink
            to="/wallet/send"
            className={({ isActive }) => (isActive ? 'wallet-nav-link wallet-nav-link-active' : 'wallet-nav-link')}
          >
            Send
          </NavLink>
          <NavLink
            to="/build"
            className="wallet-nav-link wallet-nav-link-proof"
          >
            Build Proof →
          </NavLink>
        </nav>
      </header>
      
      <Outlet />
    </div>
  );
}

