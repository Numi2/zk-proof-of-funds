import { useState, useCallback } from 'react';
import { URIPaymentCreate } from './URIPaymentCreate';
import { URIPaymentReceive } from './URIPaymentReceive';
import { URIPaymentHistory } from './URIPaymentHistory';
import { URIPaymentDeepLink } from './URIPaymentDeepLink';
import type { UriPayment } from './types';
import './URIPayment.css';

type ActiveView = 'send' | 'receive' | 'history';

/**
 * Main page for URI-Encapsulated Payments
 * 
 * This component provides a unified interface for:
 * - Creating payment URIs to send via messaging apps
 * - Receiving payments by pasting URIs
 * - Viewing payment history
 * - Handling incoming deep links
 */
export function URIPaymentPage() {
  const [activeView, setActiveView] = useState<ActiveView>('send');
  const [incomingPayment, setIncomingPayment] = useState<UriPayment | null>(null);

  const handlePaymentDetected = useCallback((payment: UriPayment) => {
    setIncomingPayment(payment);
    setActiveView('receive');
  }, []);

  return (
    <URIPaymentDeepLink onPaymentDetected={handlePaymentDetected}>
      <div className="uri-payment-page">
        <header className="uri-page-header">
          <h1>Send via Message</h1>
          <p className="uri-page-description muted">
            Send ZEC to anyone via Signal, WhatsApp, or any secure messaging app.
            No address needed — just share a link!
          </p>
        </header>

        <nav className="uri-page-nav">
          <button
            className={`uri-nav-button ${activeView === 'send' ? 'active' : ''}`}
            onClick={() => setActiveView('send')}
          >
            <span className="uri-nav-icon">📤</span>
            <span>Send</span>
          </button>
          <button
            className={`uri-nav-button ${activeView === 'receive' ? 'active' : ''}`}
            onClick={() => setActiveView('receive')}
          >
            <span className="uri-nav-icon">📥</span>
            <span>Receive</span>
            {incomingPayment && <span className="uri-nav-badge">1</span>}
          </button>
          <button
            className={`uri-nav-button ${activeView === 'history' ? 'active' : ''}`}
            onClick={() => setActiveView('history')}
          >
            <span className="uri-nav-icon">📋</span>
            <span>History</span>
          </button>
        </nav>

        <main className="uri-page-content">
          {activeView === 'send' && <URIPaymentCreate />}
          {activeView === 'receive' && <URIPaymentReceive />}
          {activeView === 'history' && <URIPaymentHistory />}
        </main>

        <footer className="uri-page-footer">
          <div className="uri-footer-info">
            <h4>How it works</h4>
            <ol className="uri-how-it-works">
              <li>
                <strong>Create:</strong> Enter the amount and generate a payment link
              </li>
              <li>
                <strong>Share:</strong> Send the link via Signal, WhatsApp, or any secure messenger
              </li>
              <li>
                <strong>Receive:</strong> The recipient clicks the link to claim the funds
              </li>
            </ol>
          </div>

          <div className="uri-security-note">
            <h4>🔐 Security</h4>
            <p className="muted small">
              Payment links contain the spending key. Only share via end-to-end encrypted 
              channels. The sender can cancel unclaimed payments at any time.
            </p>
          </div>
        </footer>
      </div>

      <style>{`
        .uri-payment-page {
          max-width: 800px;
          margin: 0 auto;
          padding: 2rem 1rem;
        }

        .uri-page-header {
          text-align: center;
          margin-bottom: 2rem;
        }

        .uri-page-header h1 {
          font-size: 2rem;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, #f4a261, #e76f51);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        .uri-page-description {
          max-width: 500px;
          margin: 0 auto;
          line-height: 1.5;
        }

        .uri-page-nav {
          display: flex;
          justify-content: center;
          gap: 0.5rem;
          margin-bottom: 2rem;
          padding: 0.5rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 12px;
        }

        .uri-nav-button {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          background: transparent;
          border: none;
          border-radius: 8px;
          color: var(--text-secondary, #888);
          cursor: pointer;
          transition: all 0.2s;
          position: relative;
        }

        .uri-nav-button:hover {
          color: var(--text-primary, #fff);
          background: rgba(255, 255, 255, 0.05);
        }

        .uri-nav-button.active {
          color: #f4a261;
          background: rgba(244, 162, 97, 0.15);
        }

        .uri-nav-icon {
          font-size: 1.25rem;
        }

        .uri-nav-badge {
          position: absolute;
          top: 4px;
          right: 4px;
          min-width: 18px;
          height: 18px;
          padding: 0 5px;
          background: #e76f51;
          color: white;
          border-radius: 9px;
          font-size: 0.7rem;
          font-weight: 600;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .uri-page-content {
          margin-bottom: 3rem;
        }

        .uri-page-footer {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 2rem;
          padding: 2rem;
          background: rgba(0, 0, 0, 0.2);
          border-radius: 12px;
        }

        .uri-footer-info h4,
        .uri-security-note h4 {
          font-size: 1rem;
          margin-bottom: 1rem;
          color: var(--text-primary, #fff);
        }

        .uri-how-it-works {
          padding-left: 1.5rem;
          margin: 0;
        }

        .uri-how-it-works li {
          margin-bottom: 0.75rem;
          color: var(--text-secondary, #aaa);
          line-height: 1.4;
        }

        .uri-how-it-works strong {
          color: #f4a261;
        }

        .uri-security-note p {
          line-height: 1.5;
        }

        @media (max-width: 600px) {
          .uri-page-nav {
            flex-wrap: wrap;
          }

          .uri-nav-button {
            flex: 1;
            min-width: 100px;
            justify-content: center;
          }

          .uri-page-footer {
            grid-template-columns: 1fr;
          }

          .uri-page-header h1 {
            font-size: 1.5rem;
          }
        }
      `}</style>
    </URIPaymentDeepLink>
  );
}

