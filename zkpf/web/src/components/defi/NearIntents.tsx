import React, { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react';
import {
  getQuotes as fetchRealTimeQuotes,
  fetchPrices,
  formatTime,
  formatUsd,
  type ChainToken,
  type Solver,
  type IntentQuote,
} from '../../services/near-intents-quotes';
import { useCredentialsStore } from '../credentials/useCredentialsStore';
import type { Credential } from '../credentials/CredentialCard';
import { NearContext, type NearContextValue } from '../dex/context/NearContext';
import {
  IntentsSDKService,
  FeeExceedsAmountError,
  MinWithdrawalAmountError,
  TrustlineNotFoundError,
  TokenNotFoundInDestinationChainError,
} from '../../services/intents-sdk-service';
import { chainTokenToAssetId } from '../../services/asset-id-mapper';
import { NEAR_INTENTS_CONFIG } from '../../services/swap/config';
import './NearIntents.css';

/**
 * Safe hook to get NEAR context without throwing if provider is not available
 */
function useNearSafe(): NearContextValue | null {
  const context = useContext(NearContext);
  return context;
}

// Intent types
type IntentStatus = 'pending' | 'matching' | 'executing' | 'completed' | 'failed' | 'expired';
type IntentType = 'swap' | 'bridge' | 'zkpof' | 'defi';

interface Intent {
  id: string;
  type: IntentType;
  status: IntentStatus;
  sourceToken: ChainToken;
  targetToken: ChainToken;
  sourceAmount: string;
  minTargetAmount: string;
  receivedAmount?: string;
  solver?: Solver;
  createdAt: number;
  expiresAt: number;
  settledAt?: number;
  txHash?: string;
  zkProofRequired: boolean;
  proofCommitment?: string;
  credentialId?: string;
  policyId?: number;
  inputUsd?: string;
  outputUsd?: string;
}

// Supported chains and tokens with CoinGecko mappings
const SUPPORTED_CHAINS: ChainToken[] = [
  { chainId: 'near', chainName: 'NEAR', token: 'NEAR', icon: '◈', decimals: 24, coingeckoId: 'near' },
  { chainId: 'near', chainName: 'NEAR', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'near', chainName: 'NEAR', token: 'USDT', icon: '₮', decimals: 6, coingeckoId: 'tether' },
  { chainId: 'ethereum', chainName: 'Ethereum', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'ethereum', chainName: 'Ethereum', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'arbitrum', chainName: 'Arbitrum', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'arbitrum', chainName: 'Arbitrum', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'base', chainName: 'Base', token: 'ETH', icon: 'Ξ', decimals: 18, coingeckoId: 'ethereum' },
  { chainId: 'base', chainName: 'Base', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'zcash', chainName: 'Zcash', token: 'ZEC', icon: 'ⓩ', decimals: 8, coingeckoId: 'zcash' },
  { chainId: 'solana', chainName: 'Solana', token: 'SOL', icon: '◎', decimals: 9, coingeckoId: 'solana' },
  { chainId: 'solana', chainName: 'Solana', token: 'USDC', icon: '$', decimals: 6, coingeckoId: 'usd-coin' },
  { chainId: 'bitcoin', chainName: 'Bitcoin', token: 'BTC', icon: '₿', decimals: 8, coingeckoId: 'bitcoin' },
];

export const NearIntents: React.FC = () => {
  // Mode state
  const [mode, setMode] = useState<'swap' | 'withdrawal'>('swap');
  
  // Form state
  const [sourceToken, setSourceToken] = useState<ChainToken>(SUPPORTED_CHAINS[1]); // USDC on NEAR
  const [targetToken, setTargetToken] = useState<ChainToken>(SUPPORTED_CHAINS[9]); // ZEC
  const [sourceAmount, setSourceAmount] = useState('');
  const [slippageTolerance, setSlippageTolerance] = useState(0.5);
  const [requireZkProof, setRequireZkProof] = useState(false);
  
  // Withdrawal state
  const [withdrawalAsset, setWithdrawalAsset] = useState<ChainToken>(SUPPORTED_CHAINS[1]); // USDC on NEAR
  const [withdrawalAmount, setWithdrawalAmount] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [withdrawalFeeEstimation, setWithdrawalFeeEstimation] = useState<{ amount: bigint; formatted: string } | null>(null);
  const [isEstimatingFee, setIsEstimatingFee] = useState(false);
  
  // UI state
  const [quotes, setQuotes] = useState<IntentQuote[]>([]);
  const [selectedQuote, setSelectedQuote] = useState<IntentQuote | null>(null);
  const [intents, setIntents] = useState<Intent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isQuoting, setIsQuoting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [intentType, setIntentType] = useState<IntentType>('swap');
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);

  // Token prices state
  const [prices, setPrices] = useState<Record<string, { usd: number; usd_24h_change?: number }>>({});
  const [lastPriceUpdate, setLastPriceUpdate] = useState<number>(0);

  // NEAR wallet connection - safely handle if provider is not available
  const nearContext = useNearSafe();
  const isConnected = nearContext?.isConnected ?? false;
  const accountId = nearContext?.accountId ?? null;
  const nearService = nearContext?.service ?? null;
  const connectWallet = nearContext?.connect ?? (async () => {
    throw new Error('NEAR wallet connection not available. Please ensure NearProvider is set up.');
  });
  
  // Intents SDK service instance
  const intentsServiceRef = useRef<IntentsSDKService | null>(null);
  
  // Initialize Intents SDK service when wallet is connected
  useEffect(() => {
    if (isConnected && accountId && nearContext) {
      const initializeService = async () => {
        try {
          // Initialize Intents SDK service
          const intentsService = new IntentsSDKService({
            nearContext,
            accountId,
          });
          await intentsService.initialize();
          intentsServiceRef.current = intentsService;
        } catch (err) {
          console.error('Failed to initialize Intents SDK service:', err);
          intentsServiceRef.current = null;
        }
      };
      
      initializeService();
    } else {
      intentsServiceRef.current = null;
    }
  }, [isConnected, accountId, nearContext]);

  // ZKPF credentials (already verified via zkpf-backend)
  const { getActiveCredentials } = useCredentialsStore();
  const activeCredentials = useMemo<Credential[]>(() => getActiveCredentials(), [getActiveCredentials]);
  const selectedCredential = useMemo<Credential | null>(
    () =>
      activeCredentials.length === 0
        ? null
        : activeCredentials.find(c => c.id === selectedCredentialId) ?? activeCredentials[0],
    [activeCredentials, selectedCredentialId],
  );

  // Fetch prices on mount and periodically
  useEffect(() => {
    const loadPrices = async () => {
      try {
        const tokenList = ['NEAR', 'ETH', 'BTC', 'SOL', 'ZEC', 'USDC', 'USDT'];
        const newPrices = await fetchPrices(tokenList);
        setPrices(newPrices);
        setLastPriceUpdate(Date.now());
      } catch (err) {
        console.warn('Failed to fetch prices:', err);
      }
    };

    loadPrices();
    const interval = setInterval(loadPrices, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  // Poll intent status for active intents
  useEffect(() => {
    if (!intentsServiceRef.current || intents.length === 0) {
      return;
    }

    const pollIntentStatus = async () => {
      const intentsService = intentsServiceRef.current;
      if (!intentsService) return;

      // Poll status for intents that are still active
      const activeIntents = intents.filter(
        intent => ['pending', 'matching', 'executing'].includes(intent.status)
      );

      if (activeIntents.length === 0) return;

      for (const intent of activeIntents) {
        try {
          const status = await intentsService.getIntentStatus({
            intentHash: intent.id,
          });
          
          // Map SDK status to our UI status
          let newStatus: IntentStatus;
          switch (status.status) {
            case 'PENDING':
            case 'TX_BROADCASTED':
              newStatus = 'matching';
              break;
            case 'SETTLED':
              newStatus = 'completed';
              break;
            case 'NOT_FOUND_OR_NOT_VALID':
              newStatus = 'failed';
              break;
            default:
              newStatus = intent.status;
          }

          // Update intent with new status
          setIntents(prev => prev.map(i => {
            if (i.id === intent.id) {
              const updated: Intent = {
                ...i,
                status: newStatus,
                settledAt: status.status === 'SETTLED' ? Date.now() : i.settledAt,
                txHash: status.txHash || i.txHash,
              };

              // If completed, use the expected amount as received amount
              if (status.status === 'SETTLED') {
                updated.receivedAmount = intent.minTargetAmount;
              }

              return updated;
            }
            return i;
          }));
        } catch (err) {
          console.error(`Failed to poll status for intent ${intent.id}:`, err);
        }
      }
    };

    // Poll every 5 seconds for active intents
    const interval = setInterval(pollIntentStatus, 5000);
    
    // Initial poll
    pollIntentStatus();

    return () => clearInterval(interval);
  }, [intents, intentsServiceRef.current]);

  // Fetch quotes when amount changes - using real-time data
  const fetchQuotes = useCallback(async () => {
    if (!sourceAmount || parseFloat(sourceAmount) <= 0) {
      setQuotes([]);
      setSelectedQuote(null);
      return;
    }

    setIsQuoting(true);
    setError(null);

    try {
      // Use the real-time quote service
      const newQuotes = await fetchRealTimeQuotes({
        sourceToken,
        targetToken,
        sourceAmount,
        slippageTolerance,
      });

      setQuotes(newQuotes);
      setSelectedQuote(newQuotes[0] || null);
    } catch (err) {
      console.error('Failed to fetch quotes:', err);
      setError('Failed to fetch quotes. Please try again.');
    } finally {
      setIsQuoting(false);
    }
  }, [sourceAmount, sourceToken, targetToken, slippageTolerance]);

  useEffect(() => {
    const debounce = setTimeout(fetchQuotes, 500);
    return () => clearTimeout(debounce);
  }, [fetchQuotes]);

  // Auto-refresh quotes every 15 seconds when amount is entered
  useEffect(() => {
    if (!sourceAmount || parseFloat(sourceAmount) <= 0) return;

    const interval = setInterval(fetchQuotes, 15000);
    return () => clearInterval(interval);
  }, [sourceAmount, fetchQuotes]);

  // Submit intent
  const handleSubmitIntent = async () => {
    if (!selectedQuote || !sourceAmount) {
      setError('Please enter an amount and select a quote');
      return;
    }

    if (!isConnected || !accountId) {
      setError('Please connect your NEAR wallet to submit an intent');
      try {
        await connectWallet();
      } catch (err) {
        setError('Failed to connect wallet. Please try again.');
      }
      return;
    }

    if (requireZkProof && !selectedCredential) {
      setError('ZK proof-of-funds is required but no active credential was found. Generate one in the Credentials Hub.');
      return;
    }

    if (!intentsServiceRef.current) {
      setError('Intent service not initialized. Please wait a moment and try again.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const intentsService = intentsServiceRef.current;
      const minAmount = parseFloat(selectedQuote.expectedAmount) * (1 - slippageTolerance / 100);
      
      // Execute swap intent using SDK
      const result = await intentsService.executeSwapIntent({
        sourceToken,
        targetToken,
        sourceAmount,
        minTargetAmount: minAmount.toFixed(6),
        recipient: accountId,
      });

      // Wait for intent settlement to get transaction hash
      let intentTx;
      try {
        intentTx = await intentsService.waitForIntentSettlement({
          intentHash: result.intentHash,
        });
      } catch (err) {
        console.warn('Failed to wait for intent settlement:', err);
        // Continue anyway - we have the intent hash
      }

      // Create local intent record
      const newIntent: Intent = {
        id: result.intentHash,
        type: intentType,
        status: 'matching',
        sourceToken,
        targetToken,
        sourceAmount,
        minTargetAmount: minAmount.toFixed(6),
        createdAt: Date.now(),
        expiresAt: Date.now() + NEAR_INTENTS_CONFIG.intents.defaultDeadlineSeconds * 1000,
        zkProofRequired: requireZkProof,
        proofCommitment: requireZkProof && selectedCredential ? selectedCredential.proofHash : undefined,
        credentialId: selectedCredential?.id,
        policyId: selectedCredential?.policyId,
        inputUsd: selectedQuote.inputUsd,
        outputUsd: selectedQuote.outputUsd,
        solver: selectedQuote.solver,
        txHash: intentTx?.hash,
      };

      setIntents(prev => [newIntent, ...prev]);
      setSourceAmount('');
      setQuotes([]);
      setSelectedQuote(null);
    } catch (err) {
      console.error('Failed to submit intent:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit intent');
    } finally {
      setIsLoading(false);
    }
  };

  // Cancel intent
  const handleCancelIntent = (intentId: string) => {
    setIntents(prev => prev.map(i => 
      i.id === intentId && ['pending', 'matching'].includes(i.status) 
        ? { ...i, status: 'expired' as IntentStatus } 
        : i
    ));
  };

  // Estimate withdrawal fee
  const handleEstimateWithdrawalFee = async () => {
    if (!intentsServiceRef.current || !withdrawalAmount || !destinationAddress) {
      return;
    }

    setIsEstimatingFee(true);
    setError(null);

    try {
      const intentsService = intentsServiceRef.current;
      
      const assetId = chainTokenToAssetId(withdrawalAsset);
      const amount = BigInt(
        Math.floor(parseFloat(withdrawalAmount) * Math.pow(10, withdrawalAsset.decimals))
      );

      const feeEstimation = await intentsService.estimateWithdrawalFee({
        assetId,
        amount,
        destinationAddress,
        feeInclusive: false,
      });

      // Format fee for display
      const feeAmount = feeEstimation.amount;
      const feeFormatted = (Number(feeAmount) / Math.pow(10, withdrawalAsset.decimals)).toFixed(6);

      setWithdrawalFeeEstimation({
        amount: feeAmount,
        formatted: `${feeFormatted} ${withdrawalAsset.token}`,
      });
    } catch (err) {
      console.error('Failed to estimate withdrawal fee:', err);
      
      // Handle SDK-specific errors
      if (err instanceof FeeExceedsAmountError) {
        setError(`Fee (${err.feeEstimation.amount}) exceeds withdrawal amount (${err.amount}). Please increase the withdrawal amount.`);
      } else if (err instanceof MinWithdrawalAmountError) {
        setError(`Amount below minimum withdrawal limit. Minimum: ${err.minAmount}, Requested: ${err.requestedAmount}`);
      } else if (err instanceof TrustlineNotFoundError) {
        setError(`Trustline not found for token ${err.assetId} on Stellar. The destination address must have a trustline for this token before withdrawal.`);
      } else if (err instanceof TokenNotFoundInDestinationChainError) {
        setError(`Token ${err.token} was not found on ${err.destinationChain}.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to estimate withdrawal fee');
      }
    } finally {
      setIsEstimatingFee(false);
    }
  };

  // Process withdrawal
  const handleProcessWithdrawal = async () => {
    if (!intentsServiceRef.current || !withdrawalAmount || !destinationAddress) {
      setError('Please fill in all withdrawal fields');
      return;
    }

    if (!isConnected || !accountId) {
      setError('Please connect your NEAR wallet to process withdrawal');
      try {
        await connectWallet();
      } catch (err) {
        setError('Failed to connect wallet. Please try again.');
      }
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const intentsService = intentsServiceRef.current;
      
      const assetId = chainTokenToAssetId(withdrawalAsset);
      const amount = BigInt(
        Math.floor(parseFloat(withdrawalAmount) * Math.pow(10, withdrawalAsset.decimals))
      );

      const result = await intentsService.processWithdrawal({
        assetId,
        amount,
        destinationAddress,
        feeInclusive: false,
      });

      // Create local intent record for withdrawal
      const newIntent: Intent = {
        id: result.intentHash,
        type: 'bridge',
        status: 'matching',
        sourceToken: withdrawalAsset,
        targetToken: withdrawalAsset, // Same token, different chain
        sourceAmount: withdrawalAmount,
        minTargetAmount: withdrawalAmount, // Will be adjusted by fee
        createdAt: Date.now(),
        expiresAt: Date.now() + NEAR_INTENTS_CONFIG.intents.defaultDeadlineSeconds * 1000,
        zkProofRequired: false,
        txHash: result.intentTx.hash,
      };

      setIntents(prev => [newIntent, ...prev]);
      setWithdrawalAmount('');
      setDestinationAddress('');
      setWithdrawalFeeEstimation(null);
    } catch (err) {
      console.error('Failed to process withdrawal:', err);
      
      // Handle SDK-specific errors
      if (err instanceof FeeExceedsAmountError) {
        setError(`Fee exceeds withdrawal amount. Please increase the withdrawal amount or use feeInclusive mode.`);
      } else if (err instanceof MinWithdrawalAmountError) {
        setError(`Amount below minimum withdrawal limit. Minimum: ${err.minAmount}, Requested: ${err.requestedAmount}`);
      } else if (err instanceof TrustlineNotFoundError) {
        setError(`Trustline not found for token ${err.assetId} on Stellar. The destination address must have a trustline for this token before withdrawal.`);
      } else if (err instanceof TokenNotFoundInDestinationChainError) {
        setError(`Token ${err.token} was not found on ${err.destinationChain}.`);
      } else {
        setError(err instanceof Error ? err.message : 'Failed to process withdrawal');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Get current price for display
  const getTokenPriceDisplay = (token: string): string => {
    const price = prices[token]?.usd;
    if (!price) return '';
    return formatUsd(price);
  };

  // Format time for display (uses imported formatTime for quotes)
  const formatTimeDisplay = (seconds: number) => {
    return formatTime(seconds);
  };

  const getStatusIcon = (status: IntentStatus) => {
    switch (status) {
      case 'pending': return '⏳';
      case 'matching': return '🔍';
      case 'executing': return '⚡';
      case 'completed': return '✓';
      case 'failed': return '✗';
      case 'expired': return '⏰';
    }
  };

  const getStatusClass = (status: IntentStatus) => {
    switch (status) {
      case 'pending':
      case 'matching': return 'status-pending';
      case 'executing': return 'status-executing';
      case 'completed': return 'status-completed';
      case 'failed':
      case 'expired': return 'status-failed';
    }
  };

  return (
    <div className="near-intents">
      {/* Intent Builder */}
      <div className="intent-builder">
        <div className="builder-header">
          <div className="mode-tabs">
            <button 
              className={`mode-tab ${mode === 'swap' ? 'active' : ''}`}
              onClick={() => setMode('swap')}
            >
              <span className="tab-icon">⇄</span>
              Swap
            </button>
            <button 
              className={`mode-tab ${mode === 'withdrawal' ? 'active' : ''}`}
              onClick={() => setMode('withdrawal')}
            >
              <span className="tab-icon">↓</span>
              Withdraw
            </button>
          </div>
          {mode === 'swap' && (
            <div className="intent-type-tabs">
              <button 
                className={`type-tab ${intentType === 'swap' ? 'active' : ''}`}
                onClick={() => setIntentType('swap')}
              >
                <span className="tab-icon">⇄</span>
                Swap
              </button>
              <button 
                className={`type-tab ${intentType === 'bridge' ? 'active' : ''}`}
                onClick={() => setIntentType('bridge')}
              >
                Bridge
              </button>
              <button 
                className={`type-tab ${intentType === 'zkpof' ? 'active' : ''}`}
                onClick={() => setIntentType('zkpof')}
              >
                <span className="tab-icon">ZK</span>
                ZK Transfer
              </button>
            </div>
          )}
        </div>

        {/* Swap Form */}
        {mode === 'swap' && (
          <>
        {/* Source Input */}
        <div className="token-input-container source">
          <div className="input-label">
            <span>You send</span>
            <span className="balance">
              {selectedQuote ? `≈ ${formatUsd(parseFloat(selectedQuote.inputUsd || '0'))}` : getTokenPriceDisplay(sourceToken.token) && `1 ${sourceToken.token} = ${getTokenPriceDisplay(sourceToken.token)}`}
            </span>
          </div>
          <div className="token-input">
            <input
              type="text"
              value={sourceAmount}
              onChange={(e) => setSourceAmount(e.target.value.replace(/[^0-9.]/g, ''))}
              placeholder="0.00"
              className="amount-input"
            />
            <button className="token-selector">
              <span className="token-icon">{sourceToken.icon}</span>
              <span className="token-name">{sourceToken.token}</span>
              <span className="chain-tag">{sourceToken.chainName}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div className="token-dropdown">
              {SUPPORTED_CHAINS.map((chain, idx) => (
                <button
                  key={idx}
                  className={`dropdown-item ${chain.chainId === sourceToken.chainId && chain.token === sourceToken.token ? 'selected' : ''}`}
                  onClick={() => setSourceToken(chain)}
                >
                  <span className="token-icon">{chain.icon}</span>
                  <span className="token-name">{chain.token}</span>
                  <span className="chain-tag">{chain.chainName}</span>
                  {prices[chain.token]?.usd && (
                    <span className="token-price">{formatUsd(prices[chain.token].usd)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Swap Direction */}
        <div className="swap-direction">
          <button 
            className="swap-button"
            onClick={() => {
              const temp = sourceToken;
              setSourceToken(targetToken);
              setTargetToken(temp);
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/>
            </svg>
          </button>
        </div>

        {/* Target Input */}
        <div className="token-input-container target">
          <div className="input-label">
            <span>You receive</span>
            {selectedQuote && (
              <span className="estimated">
                ≈ {formatUsd(parseFloat(selectedQuote.outputUsd || '0'))}
              </span>
            )}
          </div>
          <div className="token-input">
            <input
              type="text"
              value={selectedQuote?.expectedAmount || ''}
              placeholder="0.00"
              className="amount-input"
              readOnly
            />
            <button className="token-selector">
              <span className="token-icon">{targetToken.icon}</span>
              <span className="token-name">{targetToken.token}</span>
              <span className="chain-tag">{targetToken.chainName}</span>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>
            <div className="token-dropdown">
              {SUPPORTED_CHAINS.filter(c => !(c.chainId === sourceToken.chainId && c.token === sourceToken.token)).map((chain, idx) => (
                <button
                  key={idx}
                  className={`dropdown-item ${chain.chainId === targetToken.chainId && chain.token === targetToken.token ? 'selected' : ''}`}
                  onClick={() => setTargetToken(chain)}
                >
                  <span className="token-icon">{chain.icon}</span>
                  <span className="token-name">{chain.token}</span>
                  <span className="chain-tag">{chain.chainName}</span>
                  {prices[chain.token]?.usd && (
                    <span className="token-price">{formatUsd(prices[chain.token].usd)}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Route Preview */}
        {selectedQuote && (
          <div className="route-preview">
            <div className="route-header">
              <span className="route-label">Route via {selectedQuote.solver.name}</span>
              <span className="route-time">~{formatTimeDisplay(selectedQuote.estimatedTime)}</span>
            </div>
            <div className="route-path">
              {selectedQuote.route.map((step, idx) => (
                <React.Fragment key={idx}>
                  <span className="route-step">{step}</span>
                  {idx < selectedQuote.route.length - 1 && (
                    <span className="route-arrow">→</span>
                  )}
                </React.Fragment>
              ))}
            </div>
            <div className="route-details">
              <span className="route-detail">
                <span className="detail-label">Fee:</span>
                <span className="detail-value">{formatUsd(parseFloat(selectedQuote.feeUsd || '0'))}</span>
              </span>
              {selectedQuote.priceImpact > 0 && (
                <span className="route-detail">
                  <span className="detail-label">Impact:</span>
                  <span className="detail-value impact">{selectedQuote.priceImpact.toFixed(2)}%</span>
                </span>
              )}
            </div>
          </div>
        )}

            {/* Advanced Options (Swap Mode Only) */}
            <button 
              className="advanced-toggle"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              <span>Advanced Options</span>
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 24 24" 
                fill="currentColor"
                style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none' }}
              >
                <path d="M7 10l5 5 5-5z"/>
              </svg>
            </button>

            {showAdvanced && (
              <div className="advanced-options">
            <div className="option-row">
              <label>Slippage Tolerance</label>
              <div className="slippage-buttons">
                {[0.1, 0.5, 1.0, 3.0].map(val => (
                  <button
                    key={val}
                    className={`slippage-btn ${slippageTolerance === val ? 'active' : ''}`}
                    onClick={() => setSlippageTolerance(val)}
                  >
                    {val}%
                  </button>
                ))}
              </div>
            </div>
            <div className="option-row">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={requireZkProof}
                  onChange={(e) => setRequireZkProof(e.target.checked)}
                />
                <span className="checkbox-custom" />
                <span>Require ZK Proof-of-Funds</span>
              </label>
              {requireZkProof && (
                <span className="zk-badge">ZK Privacy-preserving</span>
              )}
            </div>
            {requireZkProof && (
              <div className="option-row zkpf-credential-row">
                {activeCredentials.length === 0 ? (
                  <p className="zkpf-credential-warning">
                    No active credentials detected.{' '}
                    <a href="/credentials" target="_blank" rel="noopener noreferrer">
                      Open Credentials Hub
                    </a>{' '}
                    to generate a proof-of-funds credential.
                  </p>
                ) : (
                  <>
                    <label>Backed by credential</label>
                    <select
                      className="zkpf-credential-select"
                      value={selectedCredential?.id ?? activeCredentials[0].id}
                      onChange={(e) => setSelectedCredentialId(e.target.value)}
                    >
                      {activeCredentials.map(cred => (
                        <option key={cred.id} value={cred.id}>
                          ≥ {cred.provenValue.toLocaleString()} {cred.currency} ({cred.chain})
                        </option>
                      ))}
                    </select>
                    {selectedCredential && (
                      <p className="zkpf-credential-hint">
                        Using policy #{selectedCredential.policyId} with threshold ≥{' '}
                        {selectedCredential.threshold.toLocaleString()} {selectedCredential.currency}.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
            )}

        {/* Wallet Connection Prompt */}
        {!isConnected && (
          <div className="wallet-connection-prompt">
            <div className="prompt-content">
              <span className="prompt-icon">🔐</span>
              <div className="prompt-text">
                <strong>Connect your NEAR wallet</strong>
                <p>You need to connect your NEAR wallet to submit intents</p>
              </div>
              <button
                onClick={async () => {
                  try {
                    await connectWallet();
                  } catch (err) {
                    setError('Failed to connect wallet. Please try again.');
                  }
                }}
                className="connect-wallet-btn"
              >
                Connect Wallet
              </button>
            </div>
          </div>
        )}

        {/* Withdrawal Form */}
        {(mode as string) === 'withdrawal' && (
          <>
            {/* Withdrawal Asset Input */}
            <div className="token-input-container source">
              <div className="input-label">
                <span>Asset to withdraw</span>
              </div>
              <div className="token-input">
                <input
                  type="text"
                  value={withdrawalAmount}
                  onChange={(e) => {
                    const value = e.target.value.replace(/[^0-9.]/g, '');
                    setWithdrawalAmount(value);
                    setWithdrawalFeeEstimation(null);
                  }}
                  placeholder="0.00"
                  className="amount-input"
                />
                <button className="token-selector">
                  <span className="token-icon">{withdrawalAsset.icon}</span>
                  <span className="token-name">{withdrawalAsset.token}</span>
                  <span className="chain-tag">{withdrawalAsset.chainName}</span>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 10l5 5 5-5z"/>
                  </svg>
                </button>
                <div className="token-dropdown">
                  {SUPPORTED_CHAINS.filter(c => c.chainId === 'near').map((chain, idx) => (
                    <button
                      key={idx}
                      className={`dropdown-item ${chain.chainId === withdrawalAsset.chainId && chain.token === withdrawalAsset.token ? 'selected' : ''}`}
                      onClick={() => setWithdrawalAsset(chain)}
                    >
                      <span className="token-icon">{chain.icon}</span>
                      <span className="token-name">{chain.token}</span>
                      <span className="chain-tag">{chain.chainName}</span>
                      {prices[chain.token]?.usd && (
                        <span className="token-price">{formatUsd(prices[chain.token].usd)}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Destination Address Input */}
            <div className="token-input-container dest">
              <div className="input-label">
                <span>Destination address</span>
              </div>
              <div className="token-input">
                <input
                  type="text"
                  value={destinationAddress}
                  onChange={(e) => setDestinationAddress(e.target.value)}
                  placeholder="0x... or bc1... or other chain address"
                  className="amount-input"
                />
              </div>
            </div>

            {/* Fee Estimation */}
            {withdrawalFeeEstimation && (
              <div className="quote-details">
                <div className="quote-row">
                  <span className="quote-label">Withdrawal Fee</span>
                  <span className="quote-value fee">{withdrawalFeeEstimation.formatted}</span>
                </div>
              </div>
            )}

            {/* Estimate Fee Button */}
            {withdrawalAmount && parseFloat(withdrawalAmount) > 0 && destinationAddress && (
              <button
                onClick={handleEstimateWithdrawalFee}
                disabled={isEstimatingFee || !isConnected}
                className="secondary-btn"
              >
                {isEstimatingFee ? 'Estimating...' : 'Estimate Fee'}
              </button>
            )}
          </>
        )}

        {/* Error */}
        {error && (
          <div className="intent-error">
            <span className="error-icon">⚠</span>
            {error}
          </div>
        )}

            {/* Submit Button */}
            <button
              onClick={handleSubmitIntent}
              disabled={isLoading || !sourceAmount || !selectedQuote || !isConnected}
              className="submit-intent-btn"
              title={!isConnected ? 'Connect your NEAR wallet to submit intents' : undefined}
            >
              {isLoading ? (
                <span className="loading-spinner" />
              ) : (
                <>
                  <span>Submit Intent</span>
                  {selectedQuote && (
                    <span className="btn-sub">
                      via {selectedQuote.solver.name}
                    </span>
                  )}
                </>
              )}
            </button>
          </>
        )}

        {(mode as string) === 'withdrawal' && (
          <button
            onClick={handleProcessWithdrawal}
            disabled={isLoading || !withdrawalAmount || !destinationAddress || !isConnected || !withdrawalFeeEstimation}
            className="submit-intent-btn"
            title={!isConnected ? 'Connect your NEAR wallet to process withdrawal' : undefined}
          >
            {isLoading ? (
              <span className="loading-spinner" />
            ) : (
              <span>Process Withdrawal</span>
            )}
          </button>
        )}
      </div>

      {/* Solver Quotes */}
      {quotes.length > 0 && (
        <div className="solver-quotes">
          <h3 className="quotes-title">
            <span className="quotes-icon">⚡</span>
            Competing Solvers
            {isQuoting && <span className="refreshing">Live quotes</span>}
            {lastPriceUpdate > 0 && (
              <span className="price-update">
                Prices: {new Date(lastPriceUpdate).toLocaleTimeString()}
              </span>
            )}
          </h3>
          <div className="quotes-list">
            {quotes.map((quote, idx) => (
              <button
                key={quote.solver.id}
                className={`quote-card ${selectedQuote?.solver.id === quote.solver.id ? 'selected' : ''}`}
                onClick={() => setSelectedQuote(quote)}
              >
                {idx === 0 && <span className="best-badge">Best Rate</span>}
                <div className="quote-header">
                  <span className="solver-name">{quote.solver.name}</span>
                  <span className="solver-reputation">
                    ⭐ {quote.solver.reputation}
                  </span>
                </div>
                <div className="quote-amount">
                  {parseFloat(quote.expectedAmount).toFixed(6)} <span className="token">{targetToken.token}</span>
                </div>
                <div className="quote-usd">
                  ≈ {formatUsd(parseFloat(quote.outputUsd || '0'))}
                </div>
                <div className="quote-details">
                  <span className="detail">
                    <span className="detail-label">Fee:</span>
                    <span className="detail-value">{formatUsd(parseFloat(quote.feeUsd || '0'))}</span>
                  </span>
                  <span className="detail">
                    <span className="detail-label">Time:</span>
                    <span className="detail-value">~{formatTimeDisplay(quote.estimatedTime)}</span>
                  </span>
                </div>
                <div className="solver-stats">
                  <span>{quote.solver.successRate}% success</span>
                  <span>•</span>
                  <span>{quote.solver.totalVolume} volume</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Active Intents */}
      {intents.length > 0 && (
        <div className="active-intents">
          <h3 className="intents-title">
            <span className="intents-icon">📋</span>
            Your Intents
          </h3>
          <div className="intents-list">
            {intents.map(intent => (
              <div key={intent.id} className={`intent-card ${intent.status}`}>
                <div className="intent-header">
                  <span className="intent-id">{intent.id.slice(0, 20)}...</span>
                  <span className={`intent-status ${getStatusClass(intent.status)}`}>
                    {getStatusIcon(intent.status)} {intent.status}
                  </span>
                </div>
                <div className="intent-swap">
                  <div className="swap-from">
                    <span className="amount">{intent.sourceAmount}</span>
                    <span className="token">
                      {intent.sourceToken.icon} {intent.sourceToken.token}
                    </span>
                    <span className="chain">{intent.sourceToken.chainName}</span>
                  </div>
                  <span className="swap-arrow">→</span>
                  <div className="swap-to">
                    <span className="amount">
                      {intent.receivedAmount || intent.minTargetAmount}
                    </span>
                    <span className="token">
                      {intent.targetToken.icon} {intent.targetToken.token}
                    </span>
                    <span className="chain">{intent.targetToken.chainName}</span>
                  </div>
                </div>
                {intent.solver && (
                  <div className="intent-solver">
                    <span className="solver-label">Solver:</span>
                    <span className="solver-name">{intent.solver.name}</span>
                  </div>
                )}
                {intent.zkProofRequired && (
                  <div className="zk-indicator">
                    <span className="zk-icon">ZK</span>
                    ZK Proof Required
                    {intent.proofCommitment && (
                      <span className="commitment">{intent.proofCommitment.slice(0, 10)}...</span>
                    )}
                  </div>
                )}
                <div className="intent-footer">
                  <span className="intent-time">
                    Created {new Date(intent.createdAt).toLocaleTimeString()}
                  </span>
                  {['pending', 'matching'].includes(intent.status) && (
                    <button 
                      className="cancel-btn"
                      onClick={() => handleCancelIntent(intent.id)}
                    >
                      Cancel
                    </button>
                  )}
                  {intent.txHash && (
                    <a 
                      href={`https://${NEAR_INTENTS_CONFIG.networkId === 'mainnet' ? '' : 'testnet.'}nearblocks.io/txns/${intent.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="tx-link"
                    >
                      View Tx →
                    </a>
                  )}
                  <a
                    href={`https://explorer.near-intents.org/intents/${intent.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="intent-link"
                  >
                    View Intent →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Hero Section */}
      <div className="intents-hero">
        <div className="hero-glow" />
        <div className="hero-content">
          <h2 className="hero-title">
            Express Your <span className="gradient-text">Intent</span>
          </h2>
          <p className="hero-subtitle">
            what you want, not how to do it
            
             Solvers compete to find the optimal cross-chain route.
          </p>
        </div>
      </div>

      {/* Info Section */}
      <div className="intents-info">
        <div className="info-card">
          <div className="info-icon">🧠</div>
          <h4>Intent-Based Architecture</h4>
          <p>
            Instead of constructing complex cross-chain transactions, simply express what you want. 
            NEAR's solver network competes to fulfill your intent at the best rate.
          </p>
        </div>
        <div className="info-card">
          <div className="info-icon">ℹ</div>
          <h4>ZK-Enhanced Privacy</h4>
          <p>
            Optionally require ZK proof-of-funds to verify your assets without revealing exact balances. 
            Perfect for privacy-conscious cross-chain operations.
          </p>
        </div>
        <div className="info-card">
          <div className="info-icon">⚡</div>
          <h4>Solver Competition</h4>
          <p>
            Multiple solvers compete in real-time to offer you the best rates and fastest settlement. 
            No single point of failure, no MEV extraction.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NearIntents;

