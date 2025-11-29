/**
 * TeeAgentChat - Natural Language Interface for TachyonWallet
 *
 * This component provides a chat interface to the NEAR TEE agent,
 * enabling natural language commands for:
 * - Cross-chain swaps: "Swap 0.5 ETH to ZEC"
 * - Proof generation: "Prove I have at least 1 ZEC"
 * - Wallet intelligence: "What's my best privacy strategy?"
 * - Portfolio analysis: "Show my balance across chains"
 *
 * All interactions run in a Trusted Execution Environment (TEE) for privacy.
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSwap } from '../../hooks/useSwap';
import { useSwapWalletActions, zatsToZec } from '../../hooks/useSwapWalletActions';
import type { ChainAsset, SwapChain, SwapAsset } from '../../services/swap';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface ChatMessage {
  id: string;
  role: 'user' | 'agent' | 'system';
  content: string;
  timestamp: number;
  metadata?: {
    intent?: ParsedIntent;
    action?: AgentAction;
    status?: 'pending' | 'completed' | 'error';
  };
}

interface ParsedIntent {
  type: 'swap' | 'proof' | 'balance' | 'help' | 'unknown';
  confidence: number;
  entities: Record<string, string | number>;
  originalText: string;
}

interface AgentAction {
  type: string;
  params: Record<string, unknown>;
  status: 'pending' | 'executing' | 'completed' | 'failed';
  result?: unknown;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTML SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Escape HTML special characters to prevent XSS attacks.
 * Must be called BEFORE any markdown-like transformations.
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char]);
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Parse natural language into structured intent.
 *
 * In production, this would call the TEE agent for secure intent parsing.
 * This is a local approximation for demo purposes.
 */
function parseIntent(text: string): ParsedIntent {
  const lowerText = text.toLowerCase().trim();

  // Swap patterns
  const swapPatterns = [
    /(?:swap|convert|exchange|buy|sell)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for|into)\s+(\w+)/i,
    /(?:get|buy)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:with|using)\s+(\w+)/i,
    /(?:send|spend)\s+(\d+(?:\.\d+)?)\s*(\w+)\s+(?:to|for)\s+(\w+)/i,
  ];

  for (const pattern of swapPatterns) {
    const match = lowerText.match(pattern);
    if (match) {
      return {
        type: 'swap',
        confidence: 0.9,
        entities: {
          amount: parseFloat(match[1]),
          sourceAsset: normalizeAsset(match[2]),
          destinationAsset: normalizeAsset(match[3]),
        },
        originalText: text,
      };
    }
  }

  // Proof patterns
  if (lowerText.includes('prove') || lowerText.includes('proof') || lowerText.includes('attest')) {
    const amountMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(\w+)/);
    return {
      type: 'proof',
      confidence: 0.85,
      entities: {
        threshold: amountMatch ? parseFloat(amountMatch[1]) : 1,
        asset: amountMatch ? normalizeAsset(amountMatch[2]) : 'ZEC',
      },
      originalText: text,
    };
  }

  // Balance patterns
  if (lowerText.includes('balance') || lowerText.includes('how much') || lowerText.includes('portfolio')) {
    return {
      type: 'balance',
      confidence: 0.9,
      entities: {},
      originalText: text,
    };
  }

  // Help patterns
  if (lowerText.includes('help') || lowerText.includes('what can') || lowerText.includes('how to')) {
    return {
      type: 'help',
      confidence: 0.95,
      entities: {},
      originalText: text,
    };
  }

  return {
    type: 'unknown',
    confidence: 0.3,
    entities: {},
    originalText: text,
  };
}

/**
 * Normalize asset names to standard symbols.
 */
function normalizeAsset(asset: string): SwapAsset {
  const lower = asset.toLowerCase();
  const mapping: Record<string, SwapAsset> = {
    'zec': 'ZEC',
    'zcash': 'ZEC',
    'eth': 'ETH',
    'ethereum': 'ETH',
    'ether': 'ETH',
    'btc': 'BTC',
    'bitcoin': 'BTC',
    'usdc': 'USDC',
    'usd': 'USDC',
    'usdt': 'USDT',
    'sol': 'SOL',
    'solana': 'SOL',
    'near': 'NEAR',
    'arb': 'ARB',
    'arbitrum': 'ARB',
    'op': 'OP',
    'optimism': 'OP',
  };
  return mapping[lower] || 'ZEC';
}

/**
 * Infer chain from asset.
 */
function inferChain(asset: SwapAsset): SwapChain {
  const mapping: Record<string, SwapChain> = {
    'ZEC': 'zcash',
    'ETH': 'ethereum',
    'BTC': 'bitcoin',
    'SOL': 'solana',
    'NEAR': 'near',
    'ARB': 'arbitrum',
    'OP': 'optimism',
    'USDC': 'ethereum', // Default USDC to Ethereum
    'USDT': 'ethereum',
  };
  return mapping[asset] || 'ethereum';
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

interface TeeAgentChatProps {
  className?: string;
}

export const TeeAgentChat: React.FC<TeeAgentChatProps> = ({ className = '' }) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { getQuotesToZec, getQuotesFromZec } = useSwap();
  const { walletState, getFreshTransparentAddress, getFreshOrchardAddress } = useSwapWalletActions();

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [
      ...prev,
      {
        ...msg,
        id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        timestamp: Date.now(),
      },
    ]);
  }, []);

  // Add initial welcome message
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        role: 'agent',
        content: `🛡️ **TachyonPay TEE Agent**

I'm your private AI assistant running in a Trusted Execution Environment. I can help you with:

• **Swap assets privately**: "Swap 0.5 ETH to ZEC"
• **Prove your funds**: "Prove I have at least 1 ZEC"
• **Check balances**: "Show my balance"
• **Cross-chain operations**: "Send 100 USDC worth of ZEC to Arbitrum"

All operations happen in a secure enclave. Your data never leaves the TEE.

What would you like to do?`,
      });
    }
  }, [messages.length, addMessage]);


  /**
   * Handle swap intent.
   */
  const handleSwapIntent = useCallback(async (intent: ParsedIntent): Promise<string> => {
    const { amount, sourceAsset, destinationAsset } = intent.entities as {
      amount: number;
      sourceAsset: SwapAsset;
      destinationAsset: SwapAsset;
    };

    const isToZec = destinationAsset === 'ZEC';
    const isFromZec = sourceAsset === 'ZEC';

    // Ensure exactly one side is ZEC (not both, not neither)
    if (isToZec === isFromZec) {
      if (isToZec) {
        return `Cannot swap ZEC to ZEC. Try swapping to a different asset like "Swap ${amount} ZEC to ETH".`;
      }
      return `I can only help with swaps involving ZEC. Try "Swap ${amount} ${sourceAsset} to ZEC" or "Swap ${amount} ZEC to ${destinationAsset}".`;
    }

    try {
      const sourceChain = inferChain(sourceAsset);
      const destChain = inferChain(destinationAsset);

      // Get fresh addresses
      const freshTaddr = await getFreshTransparentAddress('swap');
      const freshOrchard = await getFreshOrchardAddress('swap');

      if (isToZec) {
        // Swap TO shielded ZEC
        const source: ChainAsset = { chain: sourceChain, asset: sourceAsset };
        const amountWei = BigInt(Math.floor(amount * 1e18)); // Approximate conversion

        addMessage({
          role: 'system',
          content: `🔍 Fetching quotes for ${amount} ${sourceAsset} → ZEC...`,
        });

        const quotesResponse = await getQuotesToZec(
          source,
          amountWei,
          '0x...', // Would need actual source address
          freshTaddr.address
        );

        if (!quotesResponse.recommended) {
          return `No swap routes available for ${sourceAsset} → ZEC right now. Try again later.`;
        }

        const route = quotesResponse.recommended;
        const expectedZec = Number(route.expectedAmountOut) / 1e8;

        return `📊 **Swap Quote Found**

**From:** ${amount} ${sourceAsset} on ${sourceChain}
**To:** ~${expectedZec.toFixed(4)} ZEC (shielded)
**Provider:** ${route.provider}
**Estimated time:** ${Math.ceil(route.estimatedTimeSeconds / 60)} minutes
**Fees:** ${route.fees.feePercentage.toFixed(2)}%

Fresh t-addr: \`${freshTaddr.address.slice(0, 10)}...\`
Shield to: \`${freshOrchard.address.slice(0, 12)}...\`

Reply **"confirm"** to proceed, or **"cancel"** to abort.`;
      } else {
        // Swap FROM shielded ZEC
        const dest: ChainAsset = { chain: destChain, asset: destinationAsset };
        const amountZats = BigInt(Math.floor(amount * 1e8));

        // Check balance
        if (amountZats > walletState.totalShieldedZats) {
          return `Insufficient shielded balance. You have ${zatsToZec(walletState.totalShieldedZats)} ZEC available.`;
        }

        addMessage({
          role: 'system',
          content: `🔍 Fetching quotes for ${amount} ZEC → ${destinationAsset}...`,
        });

        const quotesResponse = await getQuotesFromZec(
          dest,
          amountZats,
          '0x...' // Would need actual destination address
        );

        if (!quotesResponse.recommended) {
          return `No swap routes available for ZEC → ${destinationAsset} right now. Try again later.`;
        }

        const route = quotesResponse.recommended;
        const expectedOutput = Number(route.expectedAmountOut) / 1e18;

        return `📊 **Swap Quote Found**

**From:** ${amount} ZEC (shielded)
**To:** ~${expectedOutput.toFixed(4)} ${destinationAsset} on ${destChain}
**Provider:** ${route.provider}
**Estimated time:** ${Math.ceil(route.estimatedTimeSeconds / 60)} minutes
**Fees:** ${route.fees.feePercentage.toFixed(2)}%

Unshield from: Orchard pool
Deliver to: Your ${destChain} address

Reply **"confirm"** to proceed, or **"cancel"** to abort.`;
      }
    } catch (error) {
      console.error('Swap error:', error);
      return `Sorry, I encountered an error while processing your swap request. Please try again.`;
    }
  }, [getQuotesToZec, getQuotesFromZec, getFreshTransparentAddress, getFreshOrchardAddress, walletState.totalShieldedZats, addMessage]);

  /**
   * Handle proof intent.
   */
  const handleProofIntent = useCallback(async (intent: ParsedIntent): Promise<string> => {
    const { threshold, asset } = intent.entities as { threshold: number; asset: string };

    if (asset !== 'ZEC') {
      return `I can currently only generate proofs for ZEC holdings. Try "Prove I have at least ${threshold} ZEC".`;
    }

    const thresholdZats = BigInt(Math.floor(threshold * 1e8));

    if (walletState.totalShieldedZats >= thresholdZats) {
      return `✅ **Proof Ready**

You have sufficient shielded ZEC to prove ≥${threshold} ZEC.

**Your balance:** ${zatsToZec(walletState.totalShieldedZats)} ZEC (shielded)
**Threshold:** ${threshold} ZEC

To generate the proof:
1. Navigate to the Proof Workbench
2. Select policy "≥${threshold} ZEC"
3. Click "Generate Proof"

The proof will be zero-knowledge - the verifier will only learn that you meet the threshold, not your actual balance.`;
    } else {
      return `❌ **Insufficient Balance**

Your shielded balance (${zatsToZec(walletState.totalShieldedZats)} ZEC) is below the threshold (${threshold} ZEC).

Options:
1. Shield more funds from your transparent balance
2. Swap assets to ZEC: "Swap 0.5 ETH to ZEC"
3. Lower the threshold: "Prove I have at least ${zatsToZec(walletState.totalShieldedZats)} ZEC"`;
    }
  }, [walletState.totalShieldedZats]);

  /**
   * Handle balance intent.
   */
  const handleBalanceIntent = useCallback(async (): Promise<string> => {
    const orchardZec = zatsToZec(walletState.orchardBalanceZats);
    const saplingZec = zatsToZec(walletState.saplingBalanceZats);
    const transparentZec = zatsToZec(walletState.transparentBalanceZats);
    const totalShielded = zatsToZec(walletState.totalShieldedZats);

    return `📊 **Wallet Balance**

**Shielded (Private)**
• Orchard: ${orchardZec} ZEC
• Sapling: ${saplingZec} ZEC
• Total: ${totalShielded} ZEC

**Transparent (Public)**
• ${transparentZec} ZEC

**Privacy Recommendation:** ${
      walletState.transparentBalanceZats > BigInt(0)
        ? '⚠️ You have transparent funds. Consider shielding them for privacy.'
        : '✅ All funds are shielded. Good privacy hygiene!'
    }

Cross-chain balances require connecting external wallets. Say "connect Ethereum" or "connect Arbitrum" to see more.`;
  }, [walletState]);

  /**
   * Handle help intent.
   */
  const handleHelpIntent = useCallback(async (): Promise<string> => {
    return `🆘 **TachyonPay Agent Help**

**Swap Commands:**
• "Swap 0.5 ETH to ZEC" - Swap Ethereum to shielded Zcash
• "Buy ZEC with 100 USDC" - Buy ZEC using stablecoins
• "Sell 1 ZEC for SOL" - Swap ZEC to Solana

**Proof Commands:**
• "Prove I have 1 ZEC" - Generate proof of funds
• "Prove my balance is above 0.5 ZEC" - Threshold proof

**Balance Commands:**
• "Show my balance" - View all balances
• "What's my Orchard balance?" - View shielded balance

**Privacy Commands:**
• "Shield my funds" - Move transparent to Orchard
• "What's my best privacy strategy?" - Get recommendations

**Cross-Chain:**
• "Connect to Arbitrum" - Link external wallet
• "Show cross-chain positions" - View DeFi positions

All operations are processed in a Trusted Execution Environment (TEE) for maximum privacy.`;
  }, []);

  /**
   * Process user message.
   */
  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;

    const userMessage = input.trim();
    setInput('');
    setIsProcessing(true);

    // Add user message
    addMessage({
      role: 'user',
      content: userMessage,
    });

    try {
      // Parse intent
      const intent = parseIntent(userMessage);

      // Handle confirmation/cancellation of pending actions
      if (userMessage.toLowerCase() === 'confirm') {
        addMessage({
          role: 'agent',
          content: '⏳ Executing swap... This will create the necessary transactions.',
          metadata: { status: 'pending' },
        });
        // In production: execute the pending swap
        await new Promise((r) => setTimeout(r, 2000));
        addMessage({
          role: 'agent',
          content: '✅ Swap initiated! Check the Swap History for tracking.',
        });
        setIsProcessing(false);
        return;
      }

      if (userMessage.toLowerCase() === 'cancel') {
        addMessage({
          role: 'agent',
          content: '❌ Action cancelled. Let me know if you need anything else.',
        });
        setIsProcessing(false);
        return;
      }

      // Process based on intent
      let response: string;

      switch (intent.type) {
        case 'swap':
          response = await handleSwapIntent(intent);
          break;
        case 'proof':
          response = await handleProofIntent(intent);
          break;
        case 'balance':
          response = await handleBalanceIntent();
          break;
        case 'help':
          response = await handleHelpIntent();
          break;
        default:
          response = `I'm not sure how to help with that. Try:
• "Swap 0.5 ETH to ZEC"
• "Show my balance"
• "Prove I have 1 ZEC"
• "Help"`;
      }

      addMessage({
        role: 'agent',
        content: response,
        metadata: { intent },
      });
    } catch (error) {
      console.error('Chat error:', error);
      addMessage({
        role: 'agent',
        content: 'Sorry, I encountered an error. Please try again.',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [input, isProcessing, addMessage, handleSwapIntent, handleProofIntent, handleBalanceIntent, handleHelpIntent]);

  return (
    <div className={`tee-agent-chat ${className}`} style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <span style={styles.headerIcon}>🛡️</span>
          <span>TachyonPay Agent</span>
        </div>
        <div style={styles.headerStatus}>
          <span style={styles.teeIndicator}>TEE Active</span>
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messagesContainer}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              ...styles.message,
              ...(msg.role === 'user' ? styles.userMessage : {}),
              ...(msg.role === 'system' ? styles.systemMessage : {}),
            }}
          >
            <div style={styles.messageContent}>
              {msg.role === 'agent' && <span style={styles.agentAvatar}>🤖</span>}
              <div
                style={styles.messageText}
                dangerouslySetInnerHTML={{
                  __html: escapeHtml(msg.content)
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/`(.*?)`/g, '<code style="background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:0.9em;">$1</code>')
                    .replace(/\n/g, '<br/>'),
                }}
              />
            </div>
          </div>
        ))}
        {isProcessing && (
          <div style={styles.message}>
            <div style={styles.messageContent}>
              <span style={styles.agentAvatar}>🤖</span>
              <div style={styles.typing}>
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} style={styles.inputContainer}>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a command... (e.g., 'Swap 0.5 ETH to ZEC')"
          style={styles.input}
          disabled={isProcessing}
        />
        <button
          type="submit"
          style={{
            ...styles.submitButton,
            ...(isProcessing ? styles.submitButtonDisabled : {}),
          }}
          disabled={isProcessing}
        >
          {isProcessing ? '...' : '→'}
        </button>
      </form>
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════════

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    maxHeight: '600px',
    backgroundColor: '#0d0d1a',
    borderRadius: '12px',
    border: '1px solid #2a2a4a',
    overflow: 'hidden',
    fontFamily: "'Space Grotesk', -apple-system, sans-serif",
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '16px 20px',
    backgroundColor: '#12122a',
    borderBottom: '1px solid #2a2a4a',
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    fontSize: '16px',
    fontWeight: 600,
    color: '#e0e0ff',
  },
  headerIcon: {
    fontSize: '20px',
  },
  headerStatus: {
    display: 'flex',
    alignItems: 'center',
  },
  teeIndicator: {
    fontSize: '11px',
    padding: '4px 10px',
    backgroundColor: 'rgba(0, 255, 136, 0.15)',
    color: '#00ff88',
    borderRadius: '12px',
    fontWeight: 500,
    letterSpacing: '0.5px',
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  message: {
    display: 'flex',
    flexDirection: 'column',
  },
  userMessage: {
    alignItems: 'flex-end',
  },
  systemMessage: {
    alignItems: 'center',
  },
  messageContent: {
    display: 'flex',
    gap: '10px',
    maxWidth: '85%',
  },
  agentAvatar: {
    fontSize: '18px',
    flexShrink: 0,
  },
  messageText: {
    padding: '12px 16px',
    backgroundColor: '#1a1a3a',
    borderRadius: '12px',
    color: '#c0c0e0',
    fontSize: '14px',
    lineHeight: 1.6,
  },
  typing: {
    display: 'flex',
    gap: '4px',
    padding: '12px 16px',
    backgroundColor: '#1a1a3a',
    borderRadius: '12px',
  },
  inputContainer: {
    display: 'flex',
    gap: '12px',
    padding: '16px 20px',
    backgroundColor: '#12122a',
    borderTop: '1px solid #2a2a4a',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    backgroundColor: '#1a1a3a',
    border: '1px solid #2a2a4a',
    borderRadius: '8px',
    color: '#e0e0ff',
    fontSize: '14px',
    outline: 'none',
  },
  submitButton: {
    padding: '12px 20px',
    backgroundColor: '#6366f1',
    border: 'none',
    borderRadius: '8px',
    color: 'white',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
  },
  submitButtonDisabled: {
    backgroundColor: '#3a3a5a',
    cursor: 'not-allowed',
  },
};

export default TeeAgentChat;

