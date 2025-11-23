import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZkpfClient } from '../api/zkpf';
import type {
  PolicyDefinition,
  ProofBundle,
  ProviderSessionSnapshot,
  ProviderSessionStatus,
  ZashiSessionStartResponse,
} from '../types/zkpf';
import { formatPolicyThreshold, policyDisplayName } from '../utils/policy';

interface Props {
  client: ZkpfClient;
  policy: PolicyDefinition | null;
  onBundleReady: (bundle: ProofBundle) => void;
  onShowToast: (message: string, type?: 'success' | 'error') => void;
}

const TERMINAL_STATUSES: ProviderSessionStatus[] = ['READY', 'INVALID', 'EXPIRED'];

function formatTimestamp(timestamp?: number | null): string {
  if (!timestamp) {
    return '—';
  }
  try {
    return new Date(timestamp * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

export function ZashiSessionConnector({ client, policy, onBundleReady, onShowToast }: Props) {
  const [session, setSession] = useState<ZashiSessionStartResponse | null>(null);
  const [snapshot, setSnapshot] = useState<ProviderSessionSnapshot | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [pollError, setPollError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const deliveredBundleSession = useRef<string | null>(null);

  const canStartSession = !!policy && !isStarting;
  const status = snapshot?.status ?? 'PENDING';
  const isTerminal = TERMINAL_STATUSES.includes(status);
  const canOpenDeepLink = !!session?.deep_link;

  const policyLabel = useMemo(() => {
    if (!policy) return 'No policy selected';
    const threshold = formatPolicyThreshold(policy).formatted;
    return `${policyDisplayName(policy)} • ${threshold}`;
  }, [policy]);

  const resetSession = useCallback(() => {
    setSession(null);
    setSnapshot(null);
    setPollError(null);
    setIsPolling(false);
    deliveredBundleSession.current = null;
  }, []);

  const handleStartSession = useCallback(async () => {
    if (!policy) {
      onShowToast('Select a Zashi policy before starting.', 'error');
      return;
    }
    setIsStarting(true);
    setPollError(null);
    try {
      const response = await client.startZashiSession(policy.policy_id);
      setSession(response);
      setSnapshot(null);
      deliveredBundleSession.current = null;
      onShowToast('Session started. Open Zashi to continue.', 'success');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to start session';
      setPollError(message);
      onShowToast(message, 'error');
    } finally {
      setIsStarting(false);
    }
  }, [client, onShowToast, policy]);

  const copyToClipboard = useCallback(
    async (value: string, label: string) => {
      try {
        await navigator.clipboard.writeText(value);
        onShowToast(`${label} copied to clipboard`, 'success');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unable to copy';
        onShowToast(message, 'error');
      }
    },
    [onShowToast],
  );

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      setPollError(null);
      setIsPolling(false);
      return;
    }

    let cancelled = false;
    let interval: number | null = null;

    const poll = async () => {
      try {
        setIsPolling(true);
        setPollError(null);
        const current = await client.getZashiSession(session.session_id);
        if (cancelled) return;
        setSnapshot(current);
        if (
          current.status === 'READY' &&
          current.bundle &&
          deliveredBundleSession.current !== current.session_id
        ) {
          deliveredBundleSession.current = current.session_id;
          onBundleReady(current.bundle);
          onShowToast('Received bundle from Zashi session', 'success');
        }
        if (TERMINAL_STATUSES.includes(current.status)) {
          if (interval) {
            window.clearInterval(interval);
            interval = null;
          }
          setIsPolling(false);
          if (current.status === 'INVALID' && current.error) {
            onShowToast(current.error, 'error');
          } else if (current.status === 'EXPIRED') {
            onShowToast('Session expired. Start a new one if needed.', 'error');
          }
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Session polling failed';
        setPollError(message);
        setIsPolling(false);
      }
    };

    void poll();
    interval = window.setInterval(poll, 3_000);

    return () => {
      cancelled = true;
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [client, onBundleReady, onShowToast, session]);

  const statusBadgeClass = useMemo(() => {
    switch (status) {
      case 'READY':
        return 'badge success';
      case 'INVALID':
      case 'EXPIRED':
        return 'badge error';
      case 'PROVING':
        return 'badge info';
      default:
        return 'badge muted';
    }
  }, [status]);

  return (
    <section className="card zashi-session-card">
      <header>
        <p className="eyebrow">Provider session</p>
        <h3>Zashi proof of funds</h3>
        <p className="muted small">
          Launch a provider-backed session. Zashi signs the attestation and calls zkpf to generate a proof bundle for the
          selected policy. When the bundle is ready it will appear here and in the Verify console automatically.
        </p>
      </header>

      <div className="zashi-policy-summary">
        <p className="muted small">Selected policy</p>
        <strong>{policyLabel}</strong>
      </div>

      {!policy && (
        <p className="error-message inline">
          <span className="error-icon">⚠️</span>
          <span>Choose a Zashi policy in the selector above to enable this flow.</span>
        </p>
      )}

      <div className="zashi-session-actions">
        <button type="button" className="primary" onClick={handleStartSession} disabled={!canStartSession}>
          {isStarting ? 'Starting session…' : 'Start provider session'}
        </button>
        {session && (
          <button type="button" className="ghost" onClick={resetSession}>
            Reset
          </button>
        )}
      </div>

      {session && (
        <div className="zashi-session-details">
          <div className="session-row">
            <span>Status</span>
            <span className={statusBadgeClass}>{status}</span>
          </div>
          <div className="session-row">
            <span>Expires</span>
            <strong>{formatTimestamp(session.expires_at)}</strong>
          </div>
          <div className="session-row">
            <span>Session ID</span>
            <code>{session.session_id}</code>
            <button
              type="button"
              className="tiny-button"
              onClick={() => copyToClipboard(session.session_id, 'Session ID')}
            >
              Copy
            </button>
          </div>
          <div className="session-row">
            <span>Deep link</span>
            {canOpenDeepLink ? (
              <div className="session-link-group">
                <a href={session.deep_link} className="tiny-button" target="_blank" rel="noreferrer">
                  Open Zashi
                </a>
                <button
                  type="button"
                  className="tiny-button ghost"
                  onClick={() => copyToClipboard(session.deep_link, 'Deep link')}
                >
                  Copy link
                </button>
              </div>
            ) : (
              <span className="muted small">Waiting for session link…</span>
            )}
          </div>
          {snapshot?.bundle && status === 'READY' && (
            <p className="success-message inline">
              <span className="success-icon">✔</span>
              <span>Bundle received and added to the prover workspace.</span>
            </p>
          )}
          {pollError && (
            <p className="error-message inline">
              <span className="error-icon">⚠️</span>
              <span>{pollError}</span>
            </p>
          )}
          {snapshot?.error && status === 'INVALID' && (
            <p className="error-message inline">
              <span className="error-icon">⚠️</span>
              <span>{snapshot.error}</span>
            </p>
          )}
          {!isTerminal && session && (
            <p className="muted small">
              {isPolling ? 'Polling Zashi session for updates…' : 'Waiting for Zashi to submit the proof bundle.'}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

