import React, { useState, useEffect } from 'react';

interface Transfer {
  transferId: string;
  status: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  asset: string;
  createdAt: number;
  completedAt?: number;
}

const API_BASE = import.meta.env.VITE_OMNI_BRIDGE_API || '/api/rails/omni';

export const BridgeHistory: React.FC = () => {
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchTransfers();
  }, []);

  const fetchTransfers = async () => {
    try {
      const response = await fetch(`${API_BASE}/transfers`);
      if (response.ok) {
        const data = await response.json();
        setTransfers(data.transfers);
      }
    } catch (err) {
      console.error('Failed to fetch transfers:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleString();
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'completed':
        return '#3fb950';
      case 'failed':
        return '#f85149';
      case 'pending':
        return '#d29922';
      default:
        return '#8b949e';
    }
  };

  if (isLoading) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e' }}>
        Loading transfer history...
      </div>
    );
  }

  if (transfers.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '2rem', color: '#8b949e' }}>
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: '1rem', opacity: 0.5 }}>
          <path d="M8 3L4 7l4 4" />
          <path d="M4 7h16" />
          <path d="M16 21l4-4-4-4" />
          <path d="M20 17H4" />
        </svg>
        <p>No transfers yet</p>
        <p style={{ fontSize: '0.875rem' }}>Your bridge transfer history will appear here</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h3 style={{ color: '#fff', margin: 0 }}>Transfer History</h3>
      
      {transfers.map((transfer) => (
        <div
          key={transfer.transferId}
          style={{
            background: 'rgba(22, 27, 34, 0.8)',
            borderRadius: '12px',
            padding: '1rem',
            border: '1px solid rgba(88, 166, 255, 0.1)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff' }}>
                {transfer.amount} {transfer.asset}
              </span>
              <span style={{ color: '#8b949e', fontSize: '0.875rem' }}>
                {transfer.sourceChain} → {transfer.destinationChain}
              </span>
            </div>
            <span
              style={{
                padding: '0.25rem 0.75rem',
                borderRadius: '20px',
                fontSize: '0.75rem',
                fontWeight: 500,
                textTransform: 'uppercase',
                background: `${getStatusColor(transfer.status)}20`,
                color: getStatusColor(transfer.status),
              }}
            >
              {transfer.status}
            </span>
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', color: '#8b949e' }}>
            <span>ID: {transfer.transferId.slice(0, 12)}...</span>
            <span>{formatDate(transfer.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

export default BridgeHistory;

