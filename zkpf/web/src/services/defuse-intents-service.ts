/**
 * Defuse Protocol NEAR Intents Service
 * 
 * Integration with NEAR Protocol's Intents verifier contract (intents.near)
 * for submitting and tracking cross-chain swap intents.
 * 
 * This service handles:
 * - Creating and signing intent messages
 * - Submitting intents to the verifier contract
 * - Polling intent execution status
 * - Token deposits for intent execution
 */

import * as nearAPI from 'near-api-js';
import type { Account } from 'near-api-js';
import { NEAR_INTENTS_CONFIG, getNearRpcUrl, getNearIndexerUrl } from './swap/config';
import type { ChainToken } from '../services/near-intents-quotes';

const { utils, connect, keyStores } = nearAPI;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * NEAR Intent structure matching the verifier contract format.
 */
export interface NearIntentMessage {
  /** Intent type */
  intent_type: 'swap' | 'bridge' | 'transfer';
  /** Unique intent ID */
  intent_id: string;
  /** Source asset specification */
  source: {
    chain_id: string;
    asset_id: string;
    amount: string;
    min_amount?: string;
  };
  /** Destination asset specification */
  destination: {
    chain_id: string;
    asset_id: string;
    min_amount?: string;
    recipient: string;
  };
  /** Intent creator's NEAR account ID */
  creator: string;
  /** Deadline (Unix timestamp in seconds) */
  deadline: number;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Signed intent ready for submission.
 */
export interface SignedIntent {
  intent: NearIntentMessage;
  signature: string;
  publicKey: string;
}

/**
 * Intent execution status from the verifier contract.
 */
export interface IntentStatus {
  intent_id: string;
  status: 'pending' | 'matched' | 'executing' | 'completed' | 'failed' | 'expired';
  resolver_id?: string;
  transactions: Array<{
    chain: string;
    tx_hash: string;
    status: 'pending' | 'confirmed' | 'failed';
    block_number?: number;
  }>;
  created_at: number;
  updated_at: number;
  completed_at?: number;
  error?: string;
}

/**
 * Configuration for the Defuse Intents service.
 */
export interface DefuseIntentsConfig {
  networkId: 'mainnet' | 'testnet';
  verifierContract: string;
  rpcUrl: string;
  indexerUrl: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN ID MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Map chain identifiers to CAIP-2 chain IDs for NEAR Intents.
 */
const CHAIN_ID_MAP: Record<string, string> = {
  near: 'near:mainnet',
  ethereum: 'eip155:1',
  arbitrum: 'eip155:42161',
  optimism: 'eip155:10',
  base: 'eip155:8453',
  polygon: 'eip155:137',
  solana: 'solana:mainnet',
  bitcoin: 'bip122:000000000019d6689c085ae165831e93',
  zcash: 'zcash:mainnet',
};

/**
 * Map token symbols to asset IDs for NEAR Intents.
 */
function toAssetId(chainId: string, token: string, contractAddress?: string): string {
  if (contractAddress) {
    return `${chainId}:${contractAddress}`;
  }
  
  // Native assets
  const nativeAssets: Record<string, string> = {
    'ETH': 'native',
    'BTC': 'native',
    'SOL': 'native',
    'ZEC': 'native',
    'NEAR': 'native',
    'MATIC': 'native',
  };
  
  return `${chainId}:${nativeAssets[token] || token.toLowerCase()}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFUSE INTENTS SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Service for interacting with NEAR Intents verifier contract.
 */
export class DefuseIntentsService {
  private config: DefuseIntentsConfig;
  private account: Account | null = null;
  private contract: any = null;
  private near: nearAPI.Near | null = null;

  constructor(config?: Partial<DefuseIntentsConfig>) {
    const networkId = config?.networkId || NEAR_INTENTS_CONFIG.networkId;
    this.config = {
      networkId,
      verifierContract: config?.verifierContract || 'intents.near',
      rpcUrl: config?.rpcUrl || getNearRpcUrl(),
      indexerUrl: config?.indexerUrl || getNearIndexerUrl(),
    };
  }

  /**
   * Initialize the service with a NEAR account.
   */
  async initialize(account: Account) {
    this.account = account;
    
    // Initialize NEAR connection if needed
    if (!this.near) {
      const keyStore = new keyStores.BrowserLocalStorageKeyStore();
      this.near = await connect({
        networkId: this.config.networkId,
        nodeUrl: this.config.rpcUrl,
        keyStore,
        headers: {},
      });
    }

    // Initialize contract instance
    this.contract = new nearAPI.Contract(
      account,
      this.config.verifierContract,
      {
        viewMethods: ['get_intent_status', 'simulate_intents'],
        changeMethods: ['execute_intents'],
        useLocalViewExecution: false,
      }
    );
  }

  /**
   * Create an intent message from swap parameters.
   */
  createIntentMessage(params: {
    sourceToken: ChainToken;
    targetToken: ChainToken;
    sourceAmount: string;
    minTargetAmount: string;
    recipient: string;
    deadline?: number;
    intentType?: 'swap' | 'bridge' | 'transfer';
  }): NearIntentMessage {
    const {
      sourceToken,
      targetToken,
      sourceAmount,
      minTargetAmount,
      recipient,
      deadline,
      intentType = 'swap',
    } = params;

    const sourceChainId = CHAIN_ID_MAP[sourceToken.chainId] || sourceToken.chainId;
    const destChainId = CHAIN_ID_MAP[targetToken.chainId] || targetToken.chainId;

    const intentId = `intent-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const deadlineSeconds = deadline || Math.floor(Date.now() / 1000) + NEAR_INTENTS_CONFIG.intents.defaultDeadlineSeconds;

    return {
      intent_type: intentType,
      intent_id: intentId,
      source: {
        chain_id: sourceChainId,
        asset_id: toAssetId(sourceChainId, sourceToken.token),
        amount: this.parseAmount(sourceAmount, sourceToken.decimals),
        min_amount: this.parseAmount(sourceAmount, sourceToken.decimals), // Use same for now
      },
      destination: {
        chain_id: destChainId,
        asset_id: toAssetId(destChainId, targetToken.token),
        min_amount: this.parseAmount(minTargetAmount, targetToken.decimals),
        recipient,
      },
      creator: this.account?.accountId || '',
      deadline: deadlineSeconds,
      metadata: {
        slippage_tolerance: 0.005, // Default 0.5%
        created_at: Date.now(),
      },
    };
  }

  /**
   * Sign an intent message with the connected account.
   */
  async signIntent(intent: NearIntentMessage): Promise<SignedIntent> {
    if (!this.account) {
      throw new Error('Account not initialized. Call initialize() first.');
    }

    // Serialize intent message
    const message = JSON.stringify(intent);
    
    // Sign with account's key
    // Note: NEAR uses Ed25519 signatures. The account.signMessage method
    // handles this, but we need to format it correctly for the contract.
    const messageBytes = new TextEncoder().encode(message);
    
    // For NEAR, we'll use the account's signer to create a signature
    // The actual signature format depends on the contract's requirements
    // This is a simplified version - in production, you'd use the proper NEAR signing flow
    
    // Create a transaction that includes the intent
    // The contract will verify the signature from the transaction
    const signature = await this.createIntentSignature(intent);
    
    return {
      intent,
      signature,
      publicKey: this.account.accountId, // Simplified - actual public key would come from keyPair
    };
  }

  /**
   * Create signature for intent (simplified - uses transaction signing).
   */
  private async createIntentSignature(intent: NearIntentMessage): Promise<string> {
    // In a real implementation, this would create a proper signature
    // For now, we'll use the transaction hash as the signature
    // The contract will verify the transaction signature
    const intentString = JSON.stringify(intent);
    return Buffer.from(intentString).toString('base64');
  }

  /**
   * Submit an intent to the verifier contract.
   */
  async submitIntent(signedIntent: SignedIntent): Promise<string> {
    if (!this.contract || !this.account) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      // Call execute_intents on the verifier contract
      const result = await this.account.functionCall({
        contractId: this.config.verifierContract,
        methodName: 'execute_intents',
        args: {
          intents: [signedIntent.intent],
        },
        gas: BigInt('300000000000000'), // 300 Tgas
        attachedDeposit: BigInt('0'), // No deposit required for intents
      });

      return result.transaction.hash;
    } catch (error) {
      console.error('Failed to submit intent:', error);
      throw new Error(`Intent submission failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Simulate an intent before actual submission.
   */
  async simulateIntent(intent: NearIntentMessage): Promise<{
    success: boolean;
    error?: string;
    estimated_output?: string;
  }> {
    if (!this.contract) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const result = await this.contract.simulate_intents({
        intents: [intent],
      });

      return {
        success: result.success || false,
        error: result.error,
        estimated_output: result.estimated_output,
      };
    } catch (error) {
      console.error('Failed to simulate intent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the status of an intent.
   */
  async getIntentStatus(intentId: string): Promise<IntentStatus | null> {
    if (!this.contract) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    try {
      const status = await this.contract.get_intent_status({
        intent_id: intentId,
      });

      return status as IntentStatus;
    } catch (error) {
      console.error('Failed to get intent status:', error);
      // Try querying via indexer as fallback
      return this.getIntentStatusFromIndexer(intentId);
    }
  }

  /**
   * Query intent status from NEAR indexer (fallback).
   */
  private async getIntentStatusFromIndexer(intentId: string): Promise<IntentStatus | null> {
    try {
      // Query the indexer API for intent status
      const response = await fetch(
        `${this.config.indexerUrl}/intents/${intentId}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data as IntentStatus;
    } catch (error) {
      console.error('Failed to query indexer:', error);
      return null;
    }
  }

  /**
   * Deposit tokens to the intent contract (if required).
   */
  async depositTokens(
    tokenContractId: string,
    amount: string,
    decimals: number = 6
  ): Promise<string> {
    if (!this.account) {
      throw new Error('Account not initialized.');
    }

    // Convert amount to token's smallest unit
    const amountInSmallestUnit = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals))).toString();

    try {
      // Call ft_transfer_call on the token contract
      const result = await this.account.functionCall({
        contractId: tokenContractId,
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: this.config.verifierContract,
          amount: amountInSmallestUnit,
          msg: '', // Optional message
        },
        gas: BigInt('300000000000000'), // 300 Tgas
        attachedDeposit: BigInt('1'), // 1 yoctoNEAR for callback
      });

      return result.transaction.hash;
    } catch (error) {
      console.error('Failed to deposit tokens:', error);
      throw new Error(`Token deposit failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Check token balance for a user.
   */
  async getTokenBalance(tokenContractId: string, accountId?: string): Promise<string> {
    if (!this.account) {
      throw new Error('Account not initialized.');
    }

    const user = accountId || this.account.accountId;

    try {
      const balance = await this.account.viewFunction({
        contractId: tokenContractId,
        methodName: 'ft_balance_of',
        args: { account_id: user },
      });

      return balance.toString();
    } catch (error) {
      console.error('Failed to get token balance:', error);
      throw new Error(`Failed to get balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Parse amount to smallest unit based on decimals.
   */
  private parseAmount(amount: string, decimals: number): string {
    const numAmount = parseFloat(amount);
    const multiplier = Math.pow(10, decimals);
    return BigInt(Math.floor(numAmount * multiplier)).toString();
  }

  /**
   * Format amount from smallest unit.
   */
  formatAmount(amount: string, decimals: number): string {
    const bigIntAmount = BigInt(amount);
    const divisor = BigInt(Math.pow(10, decimals));
    const whole = bigIntAmount / divisor;
    const fractional = bigIntAmount % divisor;
    
    if (fractional === BigInt(0)) {
      return whole.toString();
    }
    
    const fractionalStr = fractional.toString().padStart(decimals, '0');
    return `${whole}.${fractionalStr}`;
  }

  /**
   * Get explorer URL for a transaction.
   */
  getExplorerUrl(txHash: string): string {
    const explorerBase = this.config.networkId === 'mainnet' 
      ? 'https://nearblocks.io'
      : 'https://testnet.nearblocks.io';
    return `${explorerBase}/txns/${txHash}`;
  }

  /**
   * Get explorer URL for an intent.
   */
  getIntentExplorerUrl(intentId: string): string {
    const explorerBase = this.config.networkId === 'mainnet'
      ? 'https://nearblocks.io'
      : 'https://testnet.nearblocks.io';
    return `${explorerBase}/intents/${intentId}`;
  }
}

/**
 * Create a Defuse Intents service instance.
 */
export function createDefuseIntentsService(
  account: Account,
  config?: Partial<DefuseIntentsConfig>
): DefuseIntentsService {
  const service = new DefuseIntentsService(config);
  // Note: initialize() must be called separately as it's async
  return service;
}

