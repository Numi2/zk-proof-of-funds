/**
 * 1-Click Swap Component
 * 
 * Cross-chain token swaps using NEAR Intents and the 1-Click SDK.
 * Uses the connected NEAR wallet from NearContext.
 */

import React, { useState, useEffect, useCallback, useContext, useMemo } from 'react';
import {
  OpenAPI,
  OneClickService,
  QuoteRequest,
  TokenResponse,
  QuoteResponse,
} from '@defuse-protocol/one-click-sdk-typescript';
import { NearContext, type NearContextValue } from '../dex/context/NearContext';
import './OneClickSwap.css';

// 1-Click API configuration
const ONE_CLICK_API_BASE = 'https://1click.chaindefuser.com';

// Initialize the API client
OpenAPI.BASE = ONE_CLICK_API_BASE;
// No JWT for now - 0.1% fee applies

/**
 * Safe hook to get NEAR context without throwing if provider is not available
 */
function useNearSafe(): NearContextValue | null {
  const context = useContext(NearContext);
  return context;
}

// Swap status types
type SwapStatus = 
  | 'idle' 
  | 'quoting' 
  | 'quoted' 
  | 'depositing' 
  | 'submitted' 
  | 'pending' 
  | 'processing' 
  | 'success' 
  | 'refunded' 
  | 'failed';

interface SwapState {
  status: SwapStatus;
  depositAddress?: string;
  txHash?: string;
  quote?: QuoteResponse;
  error?: string;
}

// Chain display configuration
const CHAIN_CONFIG: Record<string, { name: string; icon: string; color: string }> = {
  near: { name: 'NEAR', icon: '◈', color: '#00C08B' },
  ethereum: { name: 'Ethereum', icon: 'Ξ', color: '#627EEA' },
  arbitrum: { name: 'Arbitrum', icon: '⟁', color: '#28A0F0' },
  base: { name: 'Base', icon: '◆', color: '#0052FF' },
  polygon: { name: 'Polygon', icon: '⬡', color: '#8247E5' },
  optimism: { name: 'Optimism', icon: '⊙', color: '#FF0420' },
  avalanche: { name: 'Avalanche', icon: '▲', color: '#E84142' },
  bsc: { name: 'BSC', icon: '◐', color: '#F0B90B' },
  solana: { name: 'Solana', icon: '◎', color: '#14F195' },
  bitcoin: { name: 'Bitcoin', icon: '₿', color: '#F7931A' },
  aurora: { name: 'Aurora', icon: '✦', color: '#70D44B' },
  gnosis: { name: 'Gnosis', icon: '⦿', color: '#04795B' },
  zksync: { name: 'zkSync', icon: 'Ƶ', color: '#8C8DFC' },
  turbochain: { name: 'TurboChain', icon: '●', color: '#00D4FF' },
  xrpledger: { name: 'XRP Ledger', icon: 'Ⓧ', color: '#23292F' },
  dogecoin: { name: 'Dogecoin', icon: 'Ð', color: '#C2A633' },
};

// Format token amount with decimals
function formatAmount(amount: string, decimals: number): string {
  const num = BigInt(amount);
  const divisor = BigInt(10 ** decimals);
  const wholePart = num / divisor;
  const fractionalPart = num % divisor;
  const fractionalStr = fractionalPart.toString().padStart(decimals, '0');
  const trimmedFractional = fractionalStr.replace(/0+$/, '') || '0';
  
  if (trimmedFractional === '0') {
    return wholePart.toString();
  }
  return `${wholePart}.${trimmedFractional.slice(0, 6)}`;
}

// Parse amount string to smallest unit
function parseAmount(amount: string, decimals: number): string {
  const [whole, fractional = ''] = amount.split('.');
  const paddedFractional = fractional.padEnd(decimals, '0').slice(0, decimals);
  const combined = whole + paddedFractional;
  return BigInt(combined).toString();
}

// Group tokens by blockchain
function groupTokensByChain(tokens: TokenResponse[]): Map<string, TokenResponse[]> {
  const groups = new Map<string, TokenResponse[]>();
  for (const token of tokens) {
    const chain = token.blockchain || 'unknown';
    if (!groups.has(chain)) {
      groups.set(chain, []);
    }
    groups.get(chain)!.push(token);
  }
  // Sort tokens within each chain by symbol
  for (const [, chainTokens] of groups) {
    chainTokens.sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  return groups;
}

export const OneClickSwap: React.FC = () => {
  // NEAR wallet connection
  const nearContext = useNearSafe();
  const isConnected = nearContext?.isConnected ?? false;
  const accountId = nearContext?.accountId ?? null;
  const connectWallet = nearContext?.connect ?? (async () => {
    throw new Error('NEAR wallet connection not available');
  });

  // Token list state
  const [tokens, setTokens] = useState<TokenResponse[]>([]);
  const [tokensLoading, setTokensLoading] = useState(true);
  const [tokensError, setTokensError] = useState<string | null>(null);

  // Form state
  const [sourceToken, setSourceToken] = useState<TokenResponse | null>(null);
  const [destToken, setDestToken] = useState<TokenResponse | null>(null);
  const [sourceAmount, setSourceAmount] = useState('');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [slippage, setSlippage] = useState(1); // 1%
  const [useCustomRecipient, setUseCustomRecipient] = useState(false);

  // Swap state
  const [swapState, setSwapState] = useState<SwapState>({ status: 'idle' });

  // Token selector state
  const [showSourceSelector, setShowSourceSelector] = useState(false);
  const [showDestSelector, setShowDestSelector] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');

  // Grouped tokens
  const tokensByChain = useMemo(() => groupTokensByChain(tokens), [tokens]);

  // Filtered tokens for search
  const filteredTokens = useMemo(() => {
    if (!tokenSearch) return tokens;
    const search = tokenSearch.toLowerCase();
    return tokens.filter(t => 
      t.symbol.toLowerCase().includes(search) ||
      t.blockchain?.toLowerCase().includes(search) ||
      t.contractAddress?.toLowerCase().includes(search)
    );
  }, [tokens, tokenSearch]);

  // Fetch available tokens on mount
  useEffect(() => {
    const fetchTokens = async () => {
      try {
        setTokensLoading(true);
        setTokensError(null);
        const tokenList = await OneClickService.getTokens();
        setTokens(tokenList);
        
        // Set default tokens (NEAR -> USDC on Arbitrum)
        const nearToken = tokenList.find(t => t.symbol === 'NEAR' && t.blockchain === 'near');
        const arbUsdc = tokenList.find(t => t.symbol === 'USDC' && String(t.blockchain) === 'arbitrum');
        if (nearToken) setSourceToken(nearToken);
        if (arbUsdc) setDestToken(arbUsdc);
      } catch (err) {
        console.error('Failed to fetch tokens:', err);
        setTokensError(err instanceof Error ? err.message : 'Failed to load tokens');
      } finally {
        setTokensLoading(false);
      }
    };

    fetchTokens();
  }, []);

  // Get quote
  const getQuote = useCallback(async () => {
    if (!sourceToken || !destToken || !sourceAmount || !accountId) {
      return;
    }

    setSwapState({ status: 'quoting' });

    try {
      const decimals = sourceToken.decimals ?? 18;
      const amountInSmallestUnit = parseAmount(sourceAmount, decimals);
      
      // Determine recipient - use connected account or custom address
      const recipient = useCustomRecipient && recipientAddress 
        ? recipientAddress 
        : accountId;

      const quoteRequest: QuoteRequest = {
        dry: false, // Get real quote with deposit address
        swapType: QuoteRequest.swapType.EXACT_INPUT,
        slippageTolerance: slippage * 100, // Convert to basis points
        originAsset: sourceToken.assetId || `nep141:${sourceToken.contractAddress}`,
        depositType: QuoteRequest.depositType.ORIGIN_CHAIN,
        destinationAsset: destToken.assetId || `nep141:${destToken.contractAddress}`,
        amount: amountInSmallestUnit,
        refundTo: accountId,
        refundType: QuoteRequest.refundType.ORIGIN_CHAIN,
        recipient,
        recipientType: QuoteRequest.recipientType.DESTINATION_CHAIN,
        deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // 5 min deadline
        quoteWaitingTimeMs: 5000,
      };

      const quote = await OneClickService.getQuote(quoteRequest);
      
      setSwapState({
        status: 'quoted',
        quote,
        depositAddress: quote.quote?.depositAddress,
      });
    } catch (err) {
      console.error('Failed to get quote:', err);
      setSwapState({
        status: 'failed',
        error: err instanceof Error ? err.message : 'Failed to get quote',
      });
    }
  }, [sourceToken, destToken, sourceAmount, accountId, slippage, useCustomRecipient, recipientAddress]);

  // Poll swap status
  const pollStatus = useCallback(async (depositAddr: string) => {
    try {
      const statusResponse = await OneClickService.getExecutionStatus(depositAddr);
      const status = statusResponse.status;

      if (status === 'SUCCESS') {
        setSwapState(prev => ({ ...prev, status: 'success' }));
        return true;
      } else if (status === 'REFUNDED') {
        setSwapState(prev => ({ ...prev, status: 'refunded' }));
        return true;
      } else if (status === 'PROCESSING') {
        setSwapState(prev => ({ ...prev, status: 'processing' }));
      } else if (status === 'KNOWN_DEPOSIT_TX') {
        setSwapState(prev => ({ ...prev, status: 'submitted' }));
      }
      return false;
    } catch (err) {
      console.error('Error polling status:', err);
      return false;
    }
  }, []);

  // Start polling when we have a deposit address
  useEffect(() => {
    const { status, depositAddress } = swapState;
    if (!depositAddress || !['submitted', 'pending', 'processing'].includes(status)) {
      return;
    }

    const interval = setInterval(async () => {
      const done = await pollStatus(depositAddress);
      if (done) {
        clearInterval(interval);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [swapState.status, swapState.depositAddress, pollStatus]);

  // Execute swap (send deposit via NEAR wallet)
  const executeSwap = useCallback(async () => {
    if (!swapState.depositAddress || !swapState.quote || !accountId || !nearContext?.service) {
      return;
    }

    setSwapState(prev => ({ ...prev, status: 'depositing' }));

    try {
      const service = nearContext.service;
      const depositAddress = swapState.depositAddress;
      const amount = swapState.quote.quote?.amountIn || sourceAmount;

      // For NEAR native token, use transfer
      // For other tokens, need to use ft_transfer_call
      if (sourceToken?.symbol === 'NEAR' && sourceToken?.blockchain === 'near') {
        // Send NEAR to deposit address
        const result = await service.sendNear(depositAddress, amount);
        
        setSwapState(prev => ({
          ...prev,
          status: 'submitted',
          txHash: result.transaction?.hash,
        }));

        // Submit tx hash to 1-Click for faster processing
        if (result.transaction?.hash) {
          try {
            await OneClickService.submitDepositTx({
              txHash: result.transaction.hash,
              depositAddress,
            });
          } catch (err) {
            console.warn('Failed to submit tx hash:', err);
          }
        }
      } else {
        // For tokens, use ft_transfer_call
        const tokenContract = sourceToken?.contractAddress;
        if (!tokenContract) {
          throw new Error('Token contract address not found');
        }

        const result = await service.transferToken(
          tokenContract,
          depositAddress,
          amount,
          '' // No memo needed
        );

        setSwapState(prev => ({
          ...prev,
          status: 'submitted',
          txHash: result.transaction?.hash,
        }));

        // Submit tx hash
        if (result.transaction?.hash) {
          try {
            await OneClickService.submitDepositTx({
              txHash: result.transaction.hash,
              depositAddress,
            });
          } catch (err) {
            console.warn('Failed to submit tx hash:', err);
          }
        }
      }
    } catch (err) {
      console.error('Failed to execute swap:', err);
      setSwapState(prev => ({
        ...prev,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Failed to send deposit',
      }));
    }
  }, [swapState, accountId, nearContext?.service, sourceToken, sourceAmount]);

  // Reset swap state
  const resetSwap = () => {
    setSwapState({ status: 'idle' });
    setSourceAmount('');
  };

  // Swap source and dest tokens
  const swapTokens = () => {
    const temp = sourceToken;
    setSourceToken(destToken);
    setDestToken(temp);
    setSourceAmount('');
    setSwapState({ status: 'idle' });
  };

  // Get chain config
  const getChainConfig = (chain: string) => {
    return CHAIN_CONFIG[chain.toLowerCase()] || { name: chain, icon: '●', color: '#888' };
  };

  // Render token selector dropdown
  const renderTokenSelector = (
    isSource: boolean,
    selectedToken: TokenResponse | null,
    onSelect: (token: TokenResponse) => void,
    show: boolean,
    setShow: (show: boolean) => void
  ) => {
    const chainConfig = selectedToken ? getChainConfig(selectedToken.blockchain || '') : null;

    return (
      <div className="token-selector-container">
        <button
          className="token-selector-btn"
          onClick={() => {
            setShow(!show);
            setTokenSearch('');
          }}
        >
          {selectedToken ? (
            <>
              <span 
                className="token-chain-icon" 
                style={{ backgroundColor: chainConfig?.color }}
              >
                {chainConfig?.icon}
              </span>
              <span className="token-symbol">{selectedToken.symbol}</span>
              <span className="token-chain-name">{chainConfig?.name}</span>
            </>
          ) : (
            <span className="token-placeholder">Select token</span>
          )}
          <svg className="dropdown-arrow" width="12" height="12" viewBox="0 0 24 24">
            <path fill="currentColor" d="M7 10l5 5 5-5z"/>
          </svg>
        </button>

        {show && (
          <div className="token-dropdown">
            <div className="token-search">
              <input
                type="text"
                placeholder="Search by name or chain..."
                value={tokenSearch}
                onChange={(e) => setTokenSearch(e.target.value)}
                autoFocus
              />
            </div>
            <div className="token-list">
              {tokenSearch ? (
                // Show flat filtered list when searching
                filteredTokens.map((token, idx) => {
                  const config = getChainConfig(token.blockchain || '');
                  return (
                    <button
                      key={`${token.assetId}-${idx}`}
                      className="token-option"
                      onClick={() => {
                        onSelect(token);
                        setShow(false);
                        setTokenSearch('');
                      }}
                    >
                      <span 
                        className="token-chain-icon" 
                        style={{ backgroundColor: config.color }}
                      >
                        {config.icon}
                      </span>
                      <span className="token-info">
                        <span className="token-symbol">{token.symbol}</span>
                        <span className="token-chain">{config.name}</span>
                      </span>
                      {token.price && (
                        <span className="token-price">${Number(typeof token.price === 'string' ? parseFloat(token.price) : token.price).toFixed(2)}</span>
                      )}
                    </button>
                  );
                })
              ) : (
                // Show grouped by chain
                Array.from(tokensByChain.entries()).map(([chain, chainTokens]) => {
                  const config = getChainConfig(chain);
                  return (
                    <div key={chain} className="token-chain-group">
                      <div className="chain-header">
                        <span 
                          className="chain-icon" 
                          style={{ backgroundColor: config.color }}
                        >
                          {config.icon}
                        </span>
                        <span className="chain-name">{config.name}</span>
                        <span className="chain-count">{chainTokens.length}</span>
                      </div>
                      <div className="chain-tokens">
                        {chainTokens.slice(0, 10).map((token, idx) => (
                          <button
                            key={`${token.assetId}-${idx}`}
                            className="token-option compact"
                            onClick={() => {
                              onSelect(token);
                              setShow(false);
                            }}
                          >
                            <span className="token-symbol">{token.symbol}</span>
                            {token.price && (
                              <span className="token-price">${(typeof token.price === 'string' ? parseFloat(token.price) : token.price).toFixed(2)}</span>
                            )}
                          </button>
                        ))}
                        {chainTokens.length > 10 && (
                          <span className="more-tokens">+{chainTokens.length - 10} more</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render status indicator
  const renderStatus = () => {
    const { status, error, txHash, depositAddress } = swapState;

    const statusConfig: Record<SwapStatus, { icon: string; text: string; class: string }> = {
      idle: { icon: '', text: '', class: '' },
      quoting: { icon: '', text: 'Getting quote...', class: 'loading' },
      quoted: { icon: '', text: 'Quote ready', class: 'success' },
      depositing: { icon: '', text: 'Sending deposit...', class: 'loading' },
      submitted: { icon: '', text: 'Deposit submitted', class: 'pending' },
      pending: { icon: '', text: 'Waiting for confirmation...', class: 'pending' },
      processing: { icon: '', text: 'Swap processing...', class: 'processing' },
      success: { icon: '', text: 'Swap completed!', class: 'success' },
      refunded: { icon: '', text: 'Swap refunded', class: 'warning' },
      failed: { icon: '', text: 'Swap failed', class: 'error' },
    };

    const config = statusConfig[status];
    if (!config.text) return null;

    return (
      <div className={`swap-status ${config.class}`}>
        <span className="status-icon">{config.icon}</span>
        <span className="status-text">{config.text}</span>
        {error && <p className="status-error">{error}</p>}
        {txHash && (
          <a
            href={`https://nearblocks.io/txns/${txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="tx-link"
          >
            View transaction →
          </a>
        )}
        {depositAddress && status === 'success' && (
          <a
            href={`https://explorer.near-intents.org/transactions/${depositAddress}`}
            target="_blank"
            rel="noopener noreferrer"
            className="intent-link"
          >
            View on NEAR Intents Explorer →
          </a>
        )}
      </div>
    );
  };

  // Loading state
  if (tokensLoading) {
    return (
      <div className="one-click-swap loading-state">
        <div className="loading-spinner" />
        <p>Loading available tokens...</p>
      </div>
    );
  }

  // Error state
  if (tokensError) {
    return (
      <div className="one-click-swap error-state">
        <p className="error-icon"></p>
        <p>{tokensError}</p>
        <button onClick={() => window.location.reload()} className="retry-btn">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="one-click-swap">
      {/* Header */}
      <div className="swap-header">
        <h2>1-Click Swap</h2>
        <p className="swap-subtitle">Cross-chain token swaps powered by NEAR Intents</p>
        <div className="swap-badges">
          <span className="badge">No KYC</span>
          <span className="badge">No Bridge</span>
          <span className="badge fee-badge">0.1% Fee</span>
        </div>
      </div>

      {/* Wallet Connection */}
      {!isConnected && (
        <div className="wallet-prompt">
          <div className="prompt-icon"></div>
          <div className="prompt-content">
            <h3>Connect your NEAR wallet</h3>
            <p>Connect your wallet to start swapping tokens across chains</p>
            <button onClick={() => connectWallet()} className="connect-btn">
              Connect Wallet
            </button>
          </div>
        </div>
      )}

      {/* Swap Form */}
      {isConnected && (
        <div className="swap-form">
          {/* Source Token */}
          <div className="token-input-group source">
            <label>You send</label>
            <div className="token-input-row">
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={sourceAmount}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  setSourceAmount(value);
                  setSwapState({ status: 'idle' });
                }}
                disabled={['depositing', 'submitted', 'pending', 'processing'].includes(swapState.status)}
              />
              {renderTokenSelector(
                true,
                sourceToken,
                (token) => {
                  setSourceToken(token);
                  setSwapState({ status: 'idle' });
                },
                showSourceSelector,
                setShowSourceSelector
              )}
            </div>
            {sourceToken?.price && sourceAmount && (
              <span className="usd-value">
                ≈ ${(parseFloat(sourceAmount) * (typeof sourceToken.price === 'string' ? parseFloat(sourceToken.price) : sourceToken.price)).toFixed(2)}
              </span>
            )}
          </div>

          {/* Swap Direction Button */}
          <div className="swap-direction">
            <button onClick={swapTokens} className="swap-btn" title="Swap tokens">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7 16V4M7 4L3 8M7 4L11 8M17 8V20M17 20L21 16M17 20L13 16"/>
              </svg>
            </button>
          </div>

          {/* Destination Token */}
          <div className="token-input-group dest">
            <label>You receive</label>
            <div className="token-input-row">
              <input
                type="text"
                placeholder="0.00"
                value={swapState.quote?.quote?.amountOutFormatted || ''}
                readOnly
              />
              {renderTokenSelector(
                false,
                destToken,
                (token) => {
                  setDestToken(token);
                  setSwapState({ status: 'idle' });
                },
                showDestSelector,
                setShowDestSelector
              )}
            </div>
            {swapState.quote?.quote?.amountOutUsd && (
              <span className="usd-value">
                ≈ ${parseFloat(swapState.quote.quote.amountOutUsd).toFixed(2)}
              </span>
            )}
          </div>

          {/* Quote Details */}
          {swapState.quote && swapState.status === 'quoted' && (
            <div className="quote-details">
              <div className="quote-row">
                <span className="quote-label">Rate</span>
                <span className="quote-value">
                  1 {sourceToken?.symbol} ≈ {
                    (parseFloat(swapState.quote.quote?.amountOutFormatted || '0') / 
                     parseFloat(swapState.quote.quote?.amountInFormatted || '1')).toFixed(6)
                  } {destToken?.symbol}
                </span>
              </div>
              <div className="quote-row">
                <span className="quote-label">Slippage</span>
                <span className="quote-value">{slippage}%</span>
              </div>
              {swapState.quote.quote?.timeEstimate && (
                <div className="quote-row">
                  <span className="quote-label">Est. time</span>
                  <span className="quote-value">~{swapState.quote.quote.timeEstimate}s</span>
                </div>
              )}
              <div className="quote-row">
                <span className="quote-label">Fee</span>
                <span className="quote-value fee">0.1%</span>
              </div>
            </div>
          )}

          {/* Advanced Options */}
          <details className="advanced-options">
            <summary>Advanced</summary>
            <div className="options-content">
              <div className="option-row">
                <label>Slippage tolerance</label>
                <div className="slippage-buttons">
                  {[0.5, 1, 2, 3].map((val) => (
                    <button
                      key={val}
                      className={`slippage-btn ${slippage === val ? 'active' : ''}`}
                      onClick={() => setSlippage(val)}
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
                    checked={useCustomRecipient}
                    onChange={(e) => setUseCustomRecipient(e.target.checked)}
                  />
                  <span>Custom recipient address</span>
                </label>
              </div>
              {useCustomRecipient && (
                <div className="option-row">
                  <input
                    type="text"
                    placeholder="Enter recipient address..."
                    value={recipientAddress}
                    onChange={(e) => setRecipientAddress(e.target.value)}
                    className="recipient-input"
                  />
                </div>
              )}
            </div>
          </details>

          {/* Status */}
          {renderStatus()}

          {/* Action Buttons */}
          <div className="swap-actions">
            {swapState.status === 'idle' && (
              <button
                onClick={getQuote}
                disabled={!sourceAmount || !sourceToken || !destToken || parseFloat(sourceAmount) <= 0}
                className="primary-btn"
              >
                Get Quote
              </button>
            )}
            
            {swapState.status === 'quoted' && (
              <>
                <button onClick={executeSwap} className="primary-btn execute">
                  Execute Swap
                </button>
                <button onClick={resetSwap} className="secondary-btn">
                  Cancel
                </button>
              </>
            )}

            {['success', 'refunded', 'failed'].includes(swapState.status) && (
              <button onClick={resetSwap} className="primary-btn">
                New Swap
              </button>
            )}

            {['depositing', 'submitted', 'pending', 'processing'].includes(swapState.status) && (
              <button disabled className="primary-btn loading">
                <span className="loading-spinner small" />
                Processing...
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Section */}
      <div className="swap-info">
        <div className="info-card">
          <span className="info-icon"></span>
          <h4>Intent-Based</h4>
          <p>Express what you want, solvers compete for best rate</p>
        </div>
        <div className="info-card">
          <span className="info-icon"></span>
          <h4>Cross-Chain</h4>
          <p>Swap between any supported chains seamlessly</p>
        </div>
        <div className="info-card">
          <span className="info-icon"></span>
          <h4>Non-Custodial</h4>
          <p>Your keys, your coins - always in control</p>
        </div>
      </div>

      {/* Supported Chains */}
      {/* <div className="supported-chains">
        <h4>Supported Chains</h4>
        <div className="chain-grid">
          {Array.from(new Set(tokens.map(t => t.blockchain))).filter(Boolean).slice(0, 12).map((chain) => {
            const config = getChainConfig(chain!);
            return (
              <div key={chain} className="chain-badge" style={{ borderColor: config.color }}>
                <span className="chain-icon" style={{ color: config.color }}>{config.icon}</span>
                <span>{config.name}</span>
              </div>
            );
          })}
        </div>
      </div> */}
    </div>
  );
};

export default OneClickSwap;

