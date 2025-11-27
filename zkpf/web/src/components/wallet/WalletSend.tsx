import { useState, useCallback, useMemo } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { usePcdContext } from '../../context/PcdContext';
import { TachyonStatePanel } from '../TachyonStatePanel';
import type { TachyonMetadata } from '../../types/pcd';

type SendStep = 'input' | 'confirm' | 'result';

function zatsToZec(zats: number): string {
  return (zats / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

function zecToZats(zec: number): number {
  return Math.floor(zec * 100_000_000);
}

export function WalletSend() {
  const { state } = useWebZjsContext();
  const { state: pcdState, getTachyonMetadata, verifyPcd } = usePcdContext();
  
  const [step, setStep] = useState<SendStep>('input');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [txResult, setTxResult] = useState<{ success: boolean; txid?: string; error?: string; tachyonMetadata?: TachyonMetadata } | null>(null);
  const [showTachyonPanel, setShowTachyonPanel] = useState(false);
  const [isPcdValid, setIsPcdValid] = useState<boolean | null>(null);

  const activeBalanceReport = useMemo(() => {
    if (!state.summary || state.activeAccount == null) return null;
    return state.summary.account_balances.find(
      ([accountId]) => accountId === state.activeAccount
    );
  }, [state.summary, state.activeAccount]);

  const shieldedBalance = useMemo(() => {
    if (!activeBalanceReport) return 0;
    const balance = activeBalanceReport[1];
    return balance.sapling_balance + balance.orchard_balance;
  }, [activeBalanceReport]);

  const amountZats = useMemo(() => {
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) return 0;
    return zecToZats(parsed);
  }, [amount]);

  const isValidAddress = useMemo(() => {
    // Basic validation: Zcash addresses start with specific prefixes
    const trimmed = recipient.trim();
    return (
      trimmed.startsWith('u1') || // Unified
      trimmed.startsWith('zs1') || // Sapling
      trimmed.startsWith('t1') || // Transparent mainnet
      trimmed.startsWith('t3') // Transparent mainnet P2SH
    );
  }, [recipient]);

  const canSend = useMemo(() => {
    return (
      isValidAddress &&
      amountZats > 0 &&
      amountZats <= shieldedBalance &&
      !isSending
    );
  }, [isValidAddress, amountZats, shieldedBalance, isSending]);

  const handleContinue = useCallback(async () => {
    if (canSend) {
      // Verify PCD state before proceeding if initialized
      if (pcdState.isInitialized) {
        const isValid = await verifyPcd();
        setIsPcdValid(isValid);
        if (!isValid) {
          console.warn('PCD verification failed, proceeding with warning');
        }
      }
      setStep('confirm');
    }
  }, [canSend, pcdState.isInitialized, verifyPcd]);

  const handleBack = useCallback(() => {
    setStep('input');
  }, []);

  const handleSend = useCallback(async () => {
    setIsSending(true);
    try {
      // Get Tachyon metadata for the transaction
      const tachyonMetadata = getTachyonMetadata();
      
      // Note: This is a placeholder. The actual send implementation would use
      // the WebZjs wallet APIs. For now, we'll show a message that this feature
      // requires additional setup.
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      setTxResult({
        success: false,
        error: 'Send functionality requires full wallet integration. Use the standalone webwallet for transactions.',
        tachyonMetadata: tachyonMetadata ?? undefined,
      });
      setStep('result');
    } catch (err) {
      setTxResult({
        success: false,
        error: err instanceof Error ? err.message : 'Transaction failed',
      });
      setStep('result');
    } finally {
      setIsSending(false);
    }
  }, [getTachyonMetadata]);

  const handleReset = useCallback(() => {
    setStep('input');
    setRecipient('');
    setAmount('');
    setMemo('');
    setTxResult(null);
  }, []);

  if (!state.webWallet) {
    return (
      <div className="card wallet-send-card">
        <p className="eyebrow">Send ZEC</p>
        <h3>Connect wallet to send</h3>
        <p className="muted">
          Connect your Zcash wallet first to send transactions.
        </p>
      </div>
    );
  }

  return (
    <div className="wallet-send">
      <div className="card wallet-send-card">
        <header>
          <p className="eyebrow">Send ZEC</p>
          <h3>Transfer Funds</h3>
          <div className="wallet-send-balance">
            <span className="muted small">Available shielded balance:</span>
            <span className="wallet-send-balance-value">
              {zatsToZec(shieldedBalance)} ZEC
            </span>
          </div>
        </header>

        {step === 'input' && (
          <div className="wallet-send-form">
            <div className="field">
              <label>Recipient Address</label>
              <textarea
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Enter a Zcash address (u1..., zs1..., t1...)"
                rows={3}
                className={recipient && !isValidAddress ? 'error-input' : ''}
              />
              {recipient && !isValidAddress && (
                <p className="error small">Invalid Zcash address format</p>
              )}
            </div>

            <div className="field">
              <label>Amount (ZEC)</label>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                step="0.00000001"
                min="0"
              />
              {amountZats > shieldedBalance && (
                <p className="error small">Insufficient balance</p>
              )}
              <div className="wallet-amount-presets">
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount((shieldedBalance / 100_000_000 * 0.25).toFixed(8))}
                >
                  25%
                </button>
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount((shieldedBalance / 100_000_000 * 0.5).toFixed(8))}
                >
                  50%
                </button>
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount((shieldedBalance / 100_000_000 * 0.75).toFixed(8))}
                >
                  75%
                </button>
                <button 
                  type="button" 
                  className="tiny-button ghost"
                  onClick={() => setAmount(((shieldedBalance - 10000) / 100_000_000).toFixed(8))}
                >
                  Max
                </button>
              </div>
            </div>

            <div className="field">
              <label>Memo (optional)</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="Add an encrypted memo to shielded transactions"
                rows={2}
              />
              <p className="muted small">Memos are encrypted and only visible to the recipient.</p>
            </div>

            <div className="wallet-send-actions">
              <button 
                onClick={handleContinue}
                disabled={!canSend}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'confirm' && (
          <div className="wallet-send-confirm">
            <div className="wallet-confirm-summary">
              <h4>Confirm Transaction</h4>
              
              <div className="wallet-confirm-row">
                <span className="wallet-confirm-label">Sending</span>
                <span className="wallet-confirm-value large">
                  {zatsToZec(amountZats)} ZEC
                </span>
              </div>
              
              <div className="wallet-confirm-row">
                <span className="wallet-confirm-label">To</span>
                <code className="wallet-confirm-address">
                  {recipient.slice(0, 20)}...{recipient.slice(-10)}
                </code>
              </div>
              
              {memo && (
                <div className="wallet-confirm-row">
                  <span className="wallet-confirm-label">Memo</span>
                  <span className="wallet-confirm-value">{memo}</span>
                </div>
              )}
              
              <div className="wallet-confirm-row">
                <span className="wallet-confirm-label">Network Fee</span>
                <span className="wallet-confirm-value">~0.00001 ZEC</span>
              </div>
            </div>

            {/* Tachyon (PCD) Status */}
            {pcdState.isInitialized && (
              <div className="wallet-tachyon-status" style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: isPcdValid === true ? 'rgba(34, 197, 94, 0.1)' : isPcdValid === false ? 'rgba(251, 191, 36, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                borderRadius: '0.5rem',
                border: `1px solid ${isPcdValid === true ? 'rgba(34, 197, 94, 0.3)' : isPcdValid === false ? 'rgba(251, 191, 36, 0.3)' : 'rgba(96, 165, 250, 0.3)'}`,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {isPcdValid === true ? '✓ Tachyon Verified' : isPcdValid === false ? '⚠️ Tachyon Warning' : '⏳ Tachyon State'}
                  </span>
                  <button 
                    type="button"
                    className="tiny-button ghost"
                    onClick={() => setShowTachyonPanel(!showTachyonPanel)}
                    style={{ fontSize: '0.75rem' }}
                  >
                    {showTachyonPanel ? 'Hide' : 'Details'}
                  </button>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: '0.25rem' }}>
                  Height: {pcdState.pcdState?.wallet_state.height ?? 'N/A'} | Chain: {pcdState.pcdState?.chain_length ?? 0}
                </div>
                {showTachyonPanel && (
                  <div style={{ marginTop: '0.75rem' }}>
                    <TachyonStatePanel compact />
                  </div>
                )}
              </div>
            )}

            <div className="wallet-send-actions">
              <button className="ghost" onClick={handleBack}>
                Back
              </button>
              <button onClick={handleSend} disabled={isSending}>
                {isSending ? 'Sending...' : 'Confirm & Send'}
              </button>
            </div>
          </div>
        )}

        {step === 'result' && txResult && (
          <div className="wallet-send-result">
            {txResult.success ? (
              <div className="wallet-result-success">
                <div className="wallet-result-icon success">✓</div>
                <h4>Transaction Sent!</h4>
                <p className="muted">
                  Your transaction has been broadcast to the network.
                </p>
                {txResult.txid && (
                  <div className="wallet-result-txid">
                    <span className="muted small">Transaction ID:</span>
                    <code>{txResult.txid}</code>
                  </div>
                )}
              </div>
            ) : (
              <div className="wallet-result-error">
                <div className="wallet-result-icon error">✕</div>
                <h4>Transaction Failed</h4>
                <p className="error">{txResult.error}</p>
              </div>
            )}

            {/* Tachyon Metadata for the transaction */}
            {txResult.tachyonMetadata && (
              <div className="wallet-tachyon-metadata" style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                borderRadius: '0.5rem',
                border: '1px solid rgba(96, 165, 250, 0.3)',
              }}>
                <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  Tachyon Metadata (for verification)
                </h5>
                <div style={{ fontSize: '0.75rem', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  <div><strong>S:</strong> {txResult.tachyonMetadata.s_current.slice(0, 20)}...{txResult.tachyonMetadata.s_current.slice(-10)}</div>
                  <div><strong>Height:</strong> {txResult.tachyonMetadata.height}</div>
                  <div><strong>Chain:</strong> {txResult.tachyonMetadata.chain_length}</div>
                </div>
                <button
                  type="button"
                  className="tiny-button"
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(txResult.tachyonMetadata, null, 2));
                  }}
                  style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}
                >
                  📋 Copy Tachyon Metadata
                </button>
              </div>
            )}

            <div className="wallet-send-actions">
              <button onClick={handleReset}>
                {txResult.success ? 'Send Another' : 'Try Again'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

