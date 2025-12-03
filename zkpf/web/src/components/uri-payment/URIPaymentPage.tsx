import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { URIPaymentCreate } from './URIPaymentCreate';
import { URIPaymentReceive } from './URIPaymentReceive';
import { URIPaymentHistory } from './URIPaymentHistory';
import { URIPaymentDeepLink } from './URIPaymentDeepLink';
import type { UriPayment } from './types';
import './URIPayment.css';

type ActiveView = 'create' | 'redeem' | 'history';

/**
 * Payment Links - Create and redeem ZEC payment links
 */
export function URIPaymentPage() {
  const navigate = useNavigate();
  const [activeView, setActiveView] = useState<ActiveView>('create');
  const [incomingPayment, setIncomingPayment] = useState<UriPayment | null>(null);

  const handlePaymentDetected = useCallback((payment: UriPayment) => {
    setIncomingPayment(payment);
    setActiveView('redeem');
  }, []);

  return (
    <URIPaymentDeepLink onPaymentDetected={handlePaymentDetected}>
      <div className="link-pay-page">
        <header className="link-pay-header">
          <div className="link-icon-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </div>
          <h1>Payment Links</h1>
          <p className="link-pay-subtitle">
            Generate a link. Share it however you want. Done.
          </p>
        </header>

        <nav className="link-pay-tabs">
          <button
            className={`link-tab ${activeView === 'create' ? 'active' : ''}`}
            onClick={() => setActiveView('create')}
          >
            Create
          </button>
          <button
            className={`link-tab ${activeView === 'redeem' ? 'active' : ''}`}
            onClick={() => setActiveView('redeem')}
          >
            Redeem
            {incomingPayment && <span className="link-tab-dot" />}
          </button>
          <button
            className={`link-tab ${activeView === 'history' ? 'active' : ''}`}
            onClick={() => setActiveView('history')}
          >
            History
          </button>
        </nav>

        <main className="link-pay-content">
          {activeView === 'create' && <URIPaymentCreate />}
          {activeView === 'redeem' && <URIPaymentReceive />}
          {activeView === 'history' && <URIPaymentHistory />}
        </main>
        
        {/* P2P Trade Link */}
        <div className="link-p2p-promo">
          <div className="p2p-promo-content">
            <span className="p2p-promo-icon">↔</span>
            <div className="p2p-promo-text">
              <strong>Want to trade ZEC for cash?</strong>
              <span>Visit the P2P marketplace to buy or sell ZEC with other people.</span>
            </div>
          </div>
          <button className="p2p-promo-btn" onClick={() => navigate('/p2p')}>
            Go to P2P →
          </button>
        </div>
      </div>

      <style>{`
        .link-pay-page {
          max-width: 520px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        .link-pay-header {
          text-align: center;
          margin-bottom: 2.5rem;
        }

        .link-icon-wrap {
          width: 56px;
          height: 56px;
          margin: 0 auto 1.25rem;
          background: linear-gradient(135deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15));
          border: 1px solid rgba(99, 102, 241, 0.25);
          border-radius: 16px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #a78bfa;
        }

        .link-icon-wrap svg {
          width: 26px;
          height: 26px;
        }

        .link-pay-header h1 {
          font-size: 1.75rem;
          font-weight: 600;
          margin: 0 0 0.5rem 0;
          color: #fff;
          letter-spacing: -0.02em;
        }

        .link-pay-subtitle {
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.95rem;
          margin: 0;
        }

        .link-pay-tabs {
          display: flex;
          gap: 4px;
          padding: 4px;
          background: rgba(255, 255, 255, 0.03);
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 10px;
          margin-bottom: 2rem;
        }

        .link-tab {
          flex: 1;
          padding: 0.65rem 1rem;
          background: transparent;
          border: none;
          border-radius: 7px;
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.875rem;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.15s ease;
          position: relative;
        }

        .link-tab:hover {
          color: rgba(255, 255, 255, 0.8);
        }

        .link-tab.active {
          background: rgba(99, 102, 241, 0.15);
          color: #a78bfa;
        }

        .link-tab-dot {
          position: absolute;
          top: 8px;
          right: 8px;
          width: 6px;
          height: 6px;
          background: #f472b6;
          border-radius: 50%;
        }

        .link-pay-content {
          min-height: 300px;
        }

        /* P2P Promo */
        .link-p2p-promo {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1rem;
          padding: 1rem 1.25rem;
          background: linear-gradient(135deg, rgba(56, 189, 248, 0.08), rgba(129, 140, 248, 0.08));
          border: 1px solid rgba(56, 189, 248, 0.15);
          border-radius: 12px;
          margin-top: 2rem;
        }

        .p2p-promo-content {
          display: flex;
          align-items: center;
          gap: 1rem;
        }

        .p2p-promo-icon {
          font-size: 1.75rem;
        }

        .p2p-promo-text {
          display: flex;
          flex-direction: column;
          gap: 0.15rem;
        }

        .p2p-promo-text strong {
          color: #fff;
          font-size: 0.95rem;
        }

        .p2p-promo-text span {
          color: rgba(255, 255, 255, 0.5);
          font-size: 0.8rem;
        }

        .p2p-promo-btn {
          padding: 0.6rem 1.25rem;
          background: rgba(56, 189, 248, 0.15);
          border: 1px solid rgba(56, 189, 248, 0.3);
          border-radius: 8px;
          color: #38bdf8;
          font-size: 0.85rem;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.15s ease;
        }

        .p2p-promo-btn:hover {
          background: rgba(56, 189, 248, 0.25);
          transform: translateY(-1px);
        }

        @media (max-width: 480px) {
          .link-pay-page {
            padding: 1.5rem 1rem;
          }

          .link-pay-header h1 {
            font-size: 1.5rem;
          }

          .link-tab {
            padding: 0.6rem 0.75rem;
            font-size: 0.8rem;
          }
          
          .link-p2p-promo {
            flex-direction: column;
            text-align: center;
          }
          
          .p2p-promo-content {
            flex-direction: column;
          }
          
          .p2p-promo-btn {
            width: 100%;
          }
        }
      `}</style>
    </URIPaymentDeepLink>
  );
}

