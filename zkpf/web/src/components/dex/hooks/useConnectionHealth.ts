import { useState, useEffect, useCallback } from 'react';

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

interface ConnectionHealth {
  status: ConnectionStatus;
  latency: number | null;
  reconnect: () => void;
}

export function useConnectionHealth(): ConnectionHealth {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [latency, setLatency] = useState<number | null>(null);

  const checkConnection = useCallback(async () => {
    try {
      const start = performance.now();
      // Check Orderly API endpoint availability and latency
      const response = await fetch('https://api.orderly.network/v1/public/info', {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
      
      if (response.ok) {
        const end = performance.now();
        setLatency(Math.round(end - start));
        setStatus('connected');
      } else {
        setStatus('disconnected');
      }
    } catch (error) {
      setStatus('disconnected');
      setLatency(null);
    }
  }, []);

  const reconnect = useCallback(() => {
    setStatus('connecting');
    checkConnection();
  }, [checkConnection]);

  useEffect(() => {
    checkConnection();
    const interval = setInterval(checkConnection, 30000); // Check every 30 seconds
    return () => clearInterval(interval);
  }, [checkConnection]);

  return {
    status,
    latency,
    reconnect,
  };
}

