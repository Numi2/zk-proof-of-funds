/**
 * Browser Compatibility Banner
 * 
 * Shows helpful information when the browser doesn't support full wallet mode.
 * Explains what features are available and guides users to solutions.
 */

import { useState, useEffect } from 'react';
import { detectBrowser, getWalletModeMessage, LITE_MODE_FEATURES, FULL_MODE_FEATURES, type BrowserInfo } from '../utils/browserCompat';
import './BrowserCompatBanner.css';

interface BrowserCompatBannerProps {
  /** Whether to show the banner even when browser is supported (for debugging) */
  forceShow?: boolean;
  /** Callback when user dismisses the banner */
  onDismiss?: () => void;
  /** Callback when user chooses to continue in lite mode */
  onContinueLiteMode?: () => void;
}

export function BrowserCompatBanner({ forceShow, onDismiss, onContinueLiteMode }: BrowserCompatBannerProps) {
  const [browserInfo, setBrowserInfo] = useState<BrowserInfo | null>(null);
  const [isDismissed, setIsDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    // Check if already dismissed in this session
    const dismissed = sessionStorage.getItem('browser-compat-dismissed');
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
    setBrowserInfo(detectBrowser());
  }, []);

  // Don't render if browser is supported (unless forceShow)
  if (!forceShow && (browserInfo?.isSupported || isDismissed)) {
    return null;
  }

  if (!browserInfo) {
    return null;
  }

  const modeInfo = getWalletModeMessage();
  const isMobile = browserInfo.isMobile;
  const isSafari = browserInfo.name === 'Safari';

  const handleDismiss = () => {
    sessionStorage.setItem('browser-compat-dismissed', 'true');
    setIsDismissed(true);
    onDismiss?.();
  };

  const handleContinueLiteMode = () => {
    handleDismiss();
    onContinueLiteMode?.();
  };

  const handleAction = (action: string) => {
    switch (action) {
      case 'lite-mode':
        handleContinueLiteMode();
        break;
      case 'refresh':
        window.location.reload();
        break;
      case 'clear-cache':
        // Can't programmatically clear cache, just show instructions
        alert('To clear cache in Safari:\n1. Press Cmd+Option+E\n2. Then press Cmd+Shift+R to hard refresh');
        break;
      case 'check-headers':
        alert('Open Developer Tools (F12 or Cmd+Option+I)\nGo to Network tab\nRefresh the page\nClick on the main document request\nLook for these response headers:\n- Cross-Origin-Opener-Policy: same-origin\n- Cross-Origin-Embedder-Policy: credentialless');
        break;
      case 'use-chrome':
      case 'use-firefox':
        window.open(action === 'use-chrome' ? 'https://www.google.com/chrome/' : 'https://www.mozilla.org/firefox/', '_blank');
        break;
      case 'use-desktop':
        // Just dismiss - user needs to switch devices
        handleContinueLiteMode();
        break;
      default:
        handleContinueLiteMode();
    }
  };

  return (
    <div className={`browser-compat-banner ${isMobile ? 'mobile' : ''}`}>
      <div className="banner-content">
        <div className="banner-icon">
          {isMobile ? '📱' : isSafari ? '🧭' : '⚠️'}
        </div>
        
        <div className="banner-main">
          <h3 className="banner-title">{modeInfo.title}</h3>
          <p className="banner-description">{modeInfo.description}</p>
          
          {browserInfo.recommendation && (
            <p className="banner-recommendation">{browserInfo.recommendation}</p>
          )}

          <button 
            className="banner-details-toggle"
            onClick={() => setShowDetails(!showDetails)}
          >
            {showDetails ? 'Hide details' : 'Show what works'} {showDetails ? '▲' : '▼'}
          </button>

          {showDetails && (
            <div className="banner-details">
              <div className="feature-columns">
                <div className="feature-column available">
                  <h4>✅ Available in Lite Mode</h4>
                  <ul>
                    {LITE_MODE_FEATURES.map((feature, i) => (
                      <li key={i}>{feature}</li>
                    ))}
                  </ul>
                </div>
                <div className="feature-column requires-full">
                  <h4>🔒 Requires Full Mode</h4>
                  <ul>
                    {FULL_MODE_FEATURES.map((feature, i) => (
                      <li key={i}>{feature}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {browserInfo.technicalReason && (
                <div className="technical-reason">
                  <strong>Technical details:</strong> {browserInfo.technicalReason}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="banner-actions">
          {browserInfo.suggestedActions.slice(0, 2).map((action, i) => (
            <button
              key={i}
              className={`banner-action ${i === 0 ? 'primary' : 'secondary'}`}
              onClick={() => handleAction(action.action)}
              title={action.description}
            >
              {action.label}
            </button>
          ))}
          <button 
            className="banner-dismiss" 
            onClick={handleDismiss}
            title="Dismiss this message"
          >
            ×
          </button>
        </div>
      </div>

      {/* Quick browser detection info */}
      <div className="banner-browser-info">
        {browserInfo.name} {browserInfo.version} • 
        {browserInfo.supportDetails.hasCrossOriginIsolation ? ' ✅ COI' : ' ❌ COI'} • 
        {browserInfo.supportDetails.hasSharedArrayBuffer ? ' ✅ SAB' : ' ❌ SAB'}
      </div>
    </div>
  );
}

export default BrowserCompatBanner;

