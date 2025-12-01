import { useState, useCallback, useMemo } from 'react';
import { useWebZjsContext } from '../../context/WebzjsContext';
import { usePcdContext } from '../../context/usePcdContext';
import { useMinaRailStatus } from '../../services/mina-rail/hooks';
import type { TachyonMetadata } from '../../types/pcd';
import type { SubmitTachystampResponse } from '../../types/mina-rail';

type SendStep = 'input' | 'confirm' | 'signing' | 'result';
type SigningPhase = 'idle' | 'proposing' | 'proving' | 'broadcasting';

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
  const { state: pcdState, getTachyonMetadata, verifyPcd, submitToMinaRail } = usePcdContext();
  const { status: minaRailStatus } = useMinaRailStatus(30000); // Poll every 30s
  
  const [step, setStep] = useState<SendStep>('input');
  const [minaRailSubmission, setMinaRailSubmission] = useState<SubmitTachystampResponse | null>(null);
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [seedPhrase, setSeedPhrase] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [signingPhase, setSigningPhase] = useState<SigningPhase>('idle');
  const [txResult, setTxResult] = useState<{ success: boolean; txid?: string; error?: string; tachyonMetadata?: TachyonMetadata } | null>(null);

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

  const handleProceedToSign = useCallback(() => {
    setStep('signing');
  }, []);

  const handleSend = useCallback(async () => {
    if (!state.webWallet || state.activeAccount == null) {
      setTxResult({
        success: false,
        error: 'Wallet not connected',
      });
      setStep('result');
      return;
    }

    // Validate seed phrase
    const phrase = seedPhrase.trim();
    if (!phrase) {
      setTxResult({
        success: false,
        error: 'Seed phrase is required to sign the transaction',
      });
      setStep('result');
      return;
    }

    const wordCount = phrase.split(/\s+/).length;
    if (wordCount !== 24) {
      setTxResult({
        success: false,
        error: `Seed phrase must be exactly 24 words (you entered ${wordCount})`,
      });
      setStep('result');
      return;
    }

    setIsSending(true);
    setSigningPhase('proposing');
    
    try {
      // Get Tachyon metadata for the transaction
      const tachyonMetadata = getTachyonMetadata();
      
      console.log('[Send] Creating transaction proposal...');
      console.log(`[Send] Recipient: ${recipient.slice(0, 15)}...`);
      console.log(`[Send] Amount: ${amountZats} zats`);

      // Step 1: Create transaction proposal
      const proposal = await state.webWallet.propose_transfer(
        state.activeAccount,
        recipient.trim(),
        amountZats
      );
      console.log('[Send] Proposal created successfully');

      // Step 2: Sign and prove the transaction
      setSigningPhase('proving');
      console.log('[Send] Signing and proving transaction (this may take a while)...');
      
      const txidBytes = await state.webWallet.create_proposed_transactions(
        proposal,
        phrase,
        0 // account_hd_index - using 0 as default
      );
      console.log('[Send] Transaction signed and proved');

      // Step 3: Broadcast to network
      setSigningPhase('broadcasting');
      console.log('[Send] Broadcasting transaction to network...');
      
      await state.webWallet.send_authorized_transactions(txidBytes);
      
      // Extract first txid for display (each txid is 32 bytes)
      const txidHex = Array.from(txidBytes.slice(0, 32))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      console.log(`[Send] Transaction broadcast successfully: ${txidHex}`);

      // Clear sensitive data
      setSeedPhrase('');

      // Submit tachystamp to Mina Rail for aggregation (non-blocking)
      if (pcdState.isInitialized && pcdState.pcdState) {
        // Derive nullifier from transaction.
        // NOTE: This uses the txid as a stand-in. Real nullifiers come from
        // the Orchard circuit's nullifier derivation in zkpf-zcash-orchard-wallet.
        // The Mina Rail will detect and flag transactions using txid-derived nullifiers.
        const nullifier = {
          nullifier: '0x' + txidHex,
          note_commitment: pcdState.pcdState.s_current,
        };
        
        // Submit to Mina Rail (don't block on this)
        submitToMinaRail(
          nullifier,
          100, // Default policy ID
          amountZats, // Threshold is the amount sent
          pcdState.pcdState.wallet_state.height,
          txidHex
        ).then((response) => {
          setMinaRailSubmission(response);
          if (response.success) {
            console.log('[Send] Tachystamp submitted to Mina Rail:', response.tachystampId);
          } else {
            console.warn('[Send] Mina Rail submission failed:', response.error);
          }
        }).catch((err) => {
          console.warn('[Send] Mina Rail submission error (non-fatal):', err);
        });
      }

      setTxResult({
        success: true,
        txid: txidHex,
        tachyonMetadata: tachyonMetadata ?? undefined,
      });
      setStep('result');
    } catch (err) {
      console.error('[Send] Transaction failed:', err);
      
      // Parse error message for user-friendly display
      let errorMessage = err instanceof Error ? err.message : 'Transaction failed';
      
      // Common error patterns
      if (errorMessage.includes('insufficient')) {
        errorMessage = 'Insufficient balance to cover transaction and fees';
      } else if (errorMessage.includes('seed') || errorMessage.includes('mnemonic')) {
        errorMessage = 'Invalid seed phrase. Please check and try again.';
      } else if (errorMessage.includes('address')) {
        errorMessage = 'Invalid recipient address format';
      }

      setTxResult({
        success: false,
        error: errorMessage,
      });
      setStep('result');
    } finally {
      setIsSending(false);
      setSigningPhase('idle');
    }
  }, [state.webWallet, state.activeAccount, recipient, amountZats, seedPhrase, getTachyonMetadata, pcdState.isInitialized, pcdState.pcdState, submitToMinaRail]);

  const handleReset = useCallback(() => {
    setStep('input');
    setRecipient('');
    setAmount('');
    setMemo('');
    setSeedPhrase('');
    setTxResult(null);
    setSigningPhase('idle');
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

            <div className="wallet-send-actions">
              <button className="ghost" onClick={handleBack}>
                Back
              </button>
              <button onClick={handleProceedToSign}>
                Continue to Sign
              </button>
            </div>
          </div>
        )}

        {step === 'signing' && (
          <div className="wallet-send-signing">
            <h4>Sign Transaction</h4>
            <p className="muted small" style={{ marginBottom: '1rem' }}>
              Enter your 24-word seed phrase to sign this transaction. 
              Your seed phrase is never stored and is only used for signing.
            </p>

            <div className="wallet-confirm-summary" style={{ marginBottom: '1.5rem', opacity: 0.8 }}>
              <div className="wallet-confirm-row">
                <span className="wallet-confirm-label">Sending</span>
                <span className="wallet-confirm-value">{zatsToZec(amountZats)} ZEC</span>
              </div>
              <div className="wallet-confirm-row">
                <span className="wallet-confirm-label">To</span>
                <code className="wallet-confirm-address" style={{ fontSize: '0.75rem' }}>
                  {recipient.slice(0, 12)}...{recipient.slice(-8)}
                </code>
              </div>
            </div>

            <div className="field">
              <label>Seed Phrase</label>
              <textarea
                value={seedPhrase}
                onChange={(e) => setSeedPhrase(e.target.value)}
                placeholder="Enter your 24-word seed phrase..."
                rows={4}
                disabled={isSending}
                style={{ 
                  fontFamily: 'monospace', 
                  fontSize: '0.875rem',
                  backgroundColor: isSending ? 'rgba(100,100,100,0.1)' : undefined,
                }}
              />
              <p className="muted small" style={{ marginTop: '0.5rem' }}>
                ⚠️ Never share your seed phrase. This is required to sign your transaction.
              </p>
            </div>

            {isSending && (
              <div className="wallet-signing-progress" style={{
                marginTop: '1rem',
                padding: '1rem',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                borderRadius: '0.5rem',
                border: '1px solid rgba(96, 165, 250, 0.3)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <div className="spinner" style={{
                    width: '1.25rem',
                    height: '1.25rem',
                    border: '2px solid rgba(96, 165, 250, 0.3)',
                    borderTopColor: 'rgba(96, 165, 250, 1)',
                    borderRadius: '50%',
                    animation: 'spin 1s linear infinite',
                  }} />
                  <span style={{ fontWeight: 500 }}>
                    {signingPhase === 'proposing' && 'Creating transaction proposal...'}
                    {signingPhase === 'proving' && 'Signing & generating proofs (this may take 30-60s)...'}
                    {signingPhase === 'broadcasting' && 'Broadcasting to network...'}
                  </span>
                </div>
                {signingPhase === 'proving' && (
                  <p className="muted small" style={{ marginTop: '0.5rem', marginLeft: '2rem' }}>
                    Zero-knowledge proof generation is computationally intensive. Please wait...
                  </p>
                )}
              </div>
            )}

            <div className="wallet-send-actions">
              <button 
                className="ghost" 
                onClick={() => { setSeedPhrase(''); setStep('confirm'); }}
                disabled={isSending}
              >
                Back
              </button>
              <button 
                onClick={handleSend} 
                disabled={isSending || !seedPhrase.trim()}
              >
                {isSending ? 'Processing...' : 'Sign & Send'}
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

            {/* Mina Rail Submission Status */}
            {txResult.success && (
              <div className="wallet-mina-rail-status" style={{
                marginTop: '1rem',
                padding: '0.75rem',
                backgroundColor: minaRailSubmission?.success 
                  ? 'rgba(34, 197, 94, 0.1)' 
                  : minaRailSubmission?.error 
                    ? 'rgba(239, 68, 68, 0.1)'
                    : 'rgba(139, 92, 246, 0.1)',
                borderRadius: '0.5rem',
                border: `1px solid ${
                  minaRailSubmission?.success 
                    ? 'rgba(34, 197, 94, 0.3)' 
                    : minaRailSubmission?.error 
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'rgba(139, 92, 246, 0.3)'
                }`,
              }}>
                <h5 style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 500 }}>
                  🚂 Mina Recursive Rail
                </h5>
                {minaRailSubmission ? (
                  minaRailSubmission.success ? (
                    <div style={{ fontSize: '0.75rem' }}>
                      <div style={{ color: '#22c55e', marginBottom: '0.25rem' }}>
                        ✓ Tachystamp submitted for aggregation
                      </div>
                      <div style={{ fontFamily: 'monospace', color: '#9ca3af' }}>
                        <div>ID: {minaRailSubmission.tachystampId.slice(0, 16)}...</div>
                        <div>Epoch: {minaRailSubmission.epoch} | Shard: {minaRailSubmission.shardId}</div>
                        <div>Queue Position: #{minaRailSubmission.queuePosition}</div>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: '#f87171' }}>
                      ⚠️ Submission failed: {minaRailSubmission.error}
                      <p style={{ color: '#9ca3af', marginTop: '0.25rem' }}>
                        Transaction was successful, but proof aggregation is unavailable.
                      </p>
                    </div>
                  )
                ) : (
                  <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
                    <span className="spinner-inline" style={{
                      display: 'inline-block',
                      width: '12px',
                      height: '12px',
                      border: '2px solid rgba(139, 92, 246, 0.3)',
                      borderTopColor: 'rgba(139, 92, 246, 1)',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite',
                      marginRight: '0.5rem',
                    }} />
                    Submitting to Mina Rail...
                  </div>
                )}
                {minaRailStatus && (
                  <div style={{ 
                    marginTop: '0.5rem', 
                    paddingTop: '0.5rem', 
                    borderTop: '1px solid rgba(255,255,255,0.1)',
                    fontSize: '0.7rem',
                    color: '#6b7280',
                  }}>
                    Rail Status: Epoch {minaRailStatus.currentEpoch} | {minaRailStatus.totalTachystamps} stamps
                  </div>
                )}
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

