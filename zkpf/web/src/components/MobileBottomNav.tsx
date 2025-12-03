/**
 * Mobile Bottom Navigation
 * 
 * iOS/Android-style bottom tab bar for wallet navigation.
 * Only visible on mobile viewports (< 640px).
 */

import { NavLink, useLocation } from 'react-router-dom';
import './mobile.css';

interface NavItem {
  path: string;
  label: string;
  icon: string;
  exact?: boolean;
}

const walletNavItems: NavItem[] = [
  { path: '/wallet', label: 'Home', icon: 'Home', exact: true },
  { path: '/zkpassport', label: 'Passport', icon: 'ID' },
  { path: '/wallet/receive', label: 'Receive', icon: '↓' },
  { path: '/p2p', label: 'Trade', icon: '↔' },
];

const p2pNavItems: NavItem[] = [
  { path: '/p2p', label: 'Browse', icon: 'Search', exact: true },
  { path: '/p2p/create', label: 'Create', icon: '+' },
  { path: '/wallet', label: 'Wallet', icon: '$', exact: true },
  { path: '/', label: 'Links', icon: 'Link' },
];

const zkpassportNavItems: NavItem[] = [
  { path: '/zkpassport', label: 'Home', icon: 'Home', exact: true },
  { path: '/zkpassport/verify', label: 'Verify', icon: '✓', exact: true },
  { path: '/zkpassport/policies', label: 'Policies', icon: 'List' },
  { path: '/bound-identity', label: 'Bond', icon: 'Link' },
];

export function MobileBottomNav() {
  const location = useLocation();
  
  // Determine which nav items to show based on current route
  const isInP2P = location.pathname.startsWith('/p2p');
  const isInZKPassport = location.pathname.startsWith('/zkpassport') || location.pathname.startsWith('/bound-identity');
  
  let navItems: NavItem[];
  if (isInZKPassport) {
    navItems = zkpassportNavItems;
  } else if (isInP2P) {
    navItems = p2pNavItems;
  } else {
    navItems = walletNavItems;
  }
  
  return (
    <nav className="mobile-bottom-nav" aria-label="Main navigation">
      <div className="mobile-bottom-nav-inner">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.exact}
            className={({ isActive }) => 
              `mobile-nav-item ${isActive ? 'active' : ''}`
            }
          >
            <span className="mobile-nav-icon" role="img" aria-hidden="true">
              {item.icon}
            </span>
            <span className="mobile-nav-label">{item.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

export default MobileBottomNav;

