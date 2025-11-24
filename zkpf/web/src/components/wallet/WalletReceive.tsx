import { useState, useCallback, useEffect } from 'react';
import { useWebzjsActions } from '../../hooks/useWebzjsActions';
import { useWebZjsContext } from '../../context/WebzjsContext';

type AddressType = 'unified' | 'transparent';

export function WalletReceive() {
  const { state } = useWebZjsContext();
  const { getAccountData } = useWebzjsActions();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<AddressType>('unified');
  const [addresses, setAddresses] = useState({
    unified: '',
    transparent: '',
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const fetchAddresses = async () => {
      try {
        const data = await getAccountData();
        if (data) {
          setAddresses({
            unified: data.unifiedAddress || '',
            transparent: data.transparentAddress || '',
          });
        }
      } catch (err) {
        console.error('Failed to fetch addresses:', err);
      } finally {
        setLoading(false);
      }
    };
    
    if (state.webWallet !== null) {
      fetchAddresses();
    } else {
      setLoading(false);
    }
  }, [getAccountData, state.webWallet]);

  const currentAddress = activeTab === 'unified' ? addresses.unified : addresses.transparent;

  const copyToClipboard = useCallback(async () => {
    if (!currentAddress) return;
    try {
      await navigator.clipboard.writeText(currentAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [currentAddress]);

  if (!state.webWallet) {
    return (
      <div className="card wallet-receive-card">
        <p className="eyebrow">Receive ZEC</p>
        <h3>Connect wallet to receive</h3>
        <p className="muted">
          Connect your Zcash wallet first to view your receiving addresses.
        </p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card wallet-receive-card">
        <p className="eyebrow">Receive ZEC</p>
        <div className="wallet-loading">
          <span className="spinner"></span>
          <p className="muted">Loading addresses...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="wallet-receive">
      <div className="card wallet-receive-card">
        <header>
          <p className="eyebrow">Receive ZEC</p>
          <h3>Your Zcash Address</h3>
          <p className="muted small">
            Share your address to receive ZEC. Unified addresses provide the best privacy.
          </p>
        </header>

        {/* Address Type Tabs */}
        <div className="wallet-address-tabs">
          <button
            className={`wallet-address-tab ${activeTab === 'unified' ? 'active' : ''}`}
            onClick={() => setActiveTab('unified')}
          >
            <span className="wallet-tab-icon">🛡️</span>
            <span>Unified Address</span>
            <span className="wallet-tab-badge recommended">Recommended</span>
          </button>
          <button
            className={`wallet-address-tab ${activeTab === 'transparent' ? 'active' : ''}`}
            onClick={() => setActiveTab('transparent')}
          >
            <span className="wallet-tab-icon">📊</span>
            <span>Transparent Address</span>
          </button>
        </div>

        {/* QR Code */}
        <div className="wallet-qr-container">
          {currentAddress ? (
            <div className="wallet-qr-wrapper">
              <QRCode value={currentAddress} size={200} />
            </div>
          ) : (
            <div className="wallet-qr-placeholder">
              <p className="muted">No address available</p>
            </div>
          )}
        </div>

        {/* Address Display */}
        <div className="wallet-address-display">
          <div className="wallet-address-box">
            <code className="wallet-address-text">
              {currentAddress || 'No address available'}
            </code>
          </div>
          <button 
            className="tiny-button wallet-copy-button"
            onClick={copyToClipboard}
            disabled={!currentAddress}
          >
            {copied ? '✓ Copied!' : 'Copy'}
          </button>
        </div>

        {/* Info Box */}
        <div className="wallet-info-box">
          {activeTab === 'unified' ? (
            <>
              <p className="wallet-info-title">🛡️ Unified Address</p>
              <p className="muted small">
                This is your unified address that supports both shielded (Orchard/Sapling) and transparent pools. 
                Senders will automatically use the most private option their wallet supports.
              </p>
            </>
          ) : (
            <>
              <p className="wallet-info-title">📊 Transparent Address</p>
              <p className="muted small">
                Transparent addresses are fully visible on the blockchain. Use this only when required 
                for compatibility. Consider shielding funds received here for privacy.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Simple QR Code component using canvas
function QRCode({ value, size = 200 }: { value: string; size?: number }) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    // Dynamically import QR code library
    import('qrcode').then((QRCodeLib) => {
      QRCodeLib.toDataURL(value, {
        width: size,
        margin: 2,
        color: {
          dark: '#020617',
          light: '#ffffff',
        },
      }).then(setQrDataUrl).catch(console.error);
    }).catch(() => {
      // Fallback: create a simple placeholder
      setQrDataUrl(null);
    });
  }, [value, size]);

  if (!qrDataUrl) {
    return (
      <div 
        className="wallet-qr-fallback"
        style={{ width: size, height: size }}
      >
        <p className="muted small">QR Code</p>
        <p className="mono small" style={{ fontSize: '0.6rem', wordBreak: 'break-all' }}>
          {value.slice(0, 20)}...
        </p>
      </div>
    );
  }

  return (
    <img 
      src={qrDataUrl} 
      alt="QR Code" 
      width={size} 
      height={size}
      className="wallet-qr-image"
    />
  );
}

