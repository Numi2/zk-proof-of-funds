/**
 * Intents SDK Service Wrapper
 * 
 * Wraps @defuse-protocol/intents-sdk with NEAR wallet integration
 * and provides typed methods for intent execution and withdrawals.
 */

import {
  IntentsSDK,
  type IIntentSigner,
  type WithdrawalParams,
  type FeeEstimation,
  type RouteConfig,
  type NearTxInfo,
  FeeExceedsAmountError,
  MinWithdrawalAmountError,
  TrustlineNotFoundError,
  TokenNotFoundInDestinationChainError,
} from '@defuse-protocol/intents-sdk';
import type { Intent } from '@defuse-protocol/contract-types';
import { createIntentSignerFromNearContext, createIntentSignerFromService } from './intents-signer-adapter';
import { chainTokenToAssetId, assetIdToChainToken } from './asset-id-mapper';
import { getIntentsSdkConfig } from './swap/config';
import type { NearContextValue } from '../components/dex/context/NearContext';
import type { NearOrderlyService } from './near-orderly';
import type { ChainToken } from './near-intents-quotes';

// Re-export Intent type for convenience
export type { Intent };

/**
 * Configuration for IntentsSDKService
 */
export interface IntentsSDKServiceConfig {
  /** NEAR context for wallet connection */
  nearContext?: NearContextValue;
  /** NEAR service instance (alternative to nearContext) */
  nearService?: NearOrderlyService;
  /** Account ID */
  accountId: string;
  /** Referral code (optional) */
  referral?: string;
}

/**
 * Intent execution result
 */
export interface IntentExecutionResult {
  intentHash: string;
  intentTx?: {
    hash: string;
    status: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID';
  };
}

/**
 * Withdrawal execution result
 */
export interface WithdrawalExecutionResult {
  intentHash: string;
  intentTx: {
    hash: string;
    status: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID';
  };
  destinationTx?: {
    hash: string;
  } | {
    notTrackable: true;
  };
}

/**
 * Service wrapper for Intents SDK
 */
export class IntentsSDKService {
  private sdk: IntentsSDK;
  private signer: IIntentSigner | null = null;
  private accountId: string;
  private nearContext?: NearContextValue;
  private nearService?: NearOrderlyService;

  constructor(config: IntentsSDKServiceConfig) {
    this.accountId = config.accountId;
    this.nearContext = config.nearContext;
    this.nearService = config.nearService;

    const sdkConfig = getIntentsSdkConfig();
    
    // Initialize SDK without signer (will be set later)
    this.sdk = new IntentsSDK({
      referral: config.referral || sdkConfig.referral,
      rpc: sdkConfig.rpc,
    });
  }

  /**
   * Initialize the service with an intent signer.
   * Must be called before executing intents or withdrawals.
   */
  async initialize(): Promise<void> {
    if (this.signer) {
      return; // Already initialized
    }

    if (this.nearContext) {
      this.signer = await createIntentSignerFromNearContext(
        this.nearContext,
        this.accountId
      );
    } else if (this.nearService) {
      this.signer = await createIntentSignerFromService(
        this.nearService,
        this.accountId
      );
    } else {
      throw new Error('No NEAR context or service provided');
    }

    this.sdk.setIntentSigner(this.signer);
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.signer !== null;
  }

  /**
   * Execute a swap intent
   */
  async executeSwapIntent(params: {
    sourceToken: ChainToken;
    targetToken: ChainToken;
    sourceAmount: string;
    minTargetAmount: string;
    recipient?: string;
    deadline?: Date;
  }): Promise<IntentExecutionResult> {
    if (!this.signer) {
      await this.initialize();
    }

    const sourceAssetId = chainTokenToAssetId(params.sourceToken);
    const targetAssetId = chainTokenToAssetId(params.targetToken);
    
    // Convert amounts to smallest units
    const sourceAmount = BigInt(
      Math.floor(parseFloat(params.sourceAmount) * Math.pow(10, params.sourceToken.decimals))
    );
    const minTargetAmount = BigInt(
      Math.floor(parseFloat(params.minTargetAmount) * Math.pow(10, params.targetToken.decimals))
    );

    // Create swap intent
    const intents = [
      {
        intent: 'transfer' as const,
        receiver_id: params.recipient || this.accountId,
        tokens: {
          [sourceAssetId]: sourceAmount.toString(),
        },
      },
    ];

    const result = await this.sdk.signAndSendIntent({
      intents,
    });

    return {
      intentHash: result.intentHash,
    };
  }

  /**
   * Execute a custom intent
   */
  async executeIntent(params: {
    intents: Intent[];
    onBeforePublishIntent?: (data: {
      intentHash: string;
      intentPayload: unknown;
      multiPayload: unknown;
      relayParams?: unknown;
    }) => Promise<void>;
  }): Promise<IntentExecutionResult> {
    if (!this.signer) {
      await this.initialize();
    }

    const result = await this.sdk.signAndSendIntent({
      intents: params.intents,
      onBeforePublishIntent: params.onBeforePublishIntent,
    });

    return {
      intentHash: result.intentHash,
    };
  }

  /**
   * Process a withdrawal (complete end-to-end)
   */
  async processWithdrawal(params: {
    assetId: string;
    amount: bigint;
    destinationAddress: string;
    feeInclusive?: boolean;
    routeConfig?: RouteConfig;
  }): Promise<WithdrawalExecutionResult> {
    if (!this.signer) {
      await this.initialize();
    }

    const withdrawalParams: WithdrawalParams = {
      assetId: params.assetId,
      amount: params.amount,
      destinationAddress: params.destinationAddress,
      feeInclusive: params.feeInclusive ?? false,
      routeConfig: params.routeConfig,
    };

    const result = await this.sdk.processWithdrawal({
      withdrawalParams,
    });

    const statusType: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID' = 
      (result.intentTx as { status?: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID' }).status || 'PENDING';
    
    return {
      intentHash: result.intentHash,
      intentTx: {
        hash: result.intentTx.hash,
        status: statusType,
      },
      destinationTx: result.destinationTx,
    };
  }

  /**
   * Estimate withdrawal fee
   */
  async estimateWithdrawalFee(params: {
    assetId: string;
    amount: bigint;
    destinationAddress: string;
    feeInclusive?: boolean;
  }): Promise<FeeEstimation> {
    if (!this.signer) {
      await this.initialize();
    }

    const withdrawalParams: WithdrawalParams = {
      assetId: params.assetId,
      amount: params.amount,
      destinationAddress: params.destinationAddress,
      feeInclusive: params.feeInclusive ?? false,
    };

    return await this.sdk.estimateWithdrawalFee({
      withdrawalParams,
    });
  }

  /**
   * Wait for intent settlement
   */
  async waitForIntentSettlement(params: {
    intentHash: string;
  }): Promise<{
    hash: string;
    status: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID';
    accountId?: string;
  }> {
    const result = await this.sdk.waitForIntentSettlement({
      intentHash: params.intentHash,
    });
    const statusType: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID' = 
      (result as { status?: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID' }).status || 'PENDING';
    
    return {
      hash: result.hash,
      status: statusType,
      accountId: (result as { accountId?: string }).accountId,
    };
  }

  /**
   * Get intent status
   */
  async getIntentStatus(params: {
    intentHash: string;
  }): Promise<{
    status: 'PENDING' | 'TX_BROADCASTED' | 'SETTLED' | 'NOT_FOUND_OR_NOT_VALID';
    txHash?: string;
  }> {
    return await this.sdk.getIntentStatus({
      intentHash: params.intentHash,
    });
  }

  /**
   * Wait for withdrawal completion
   */
  async waitForWithdrawalCompletion(params: {
    withdrawalParams: WithdrawalParams;
    intentTx: NearTxInfo;
  }): Promise<{
    hash: string;
  } | {
    notTrackable: true;
  }> {
    return await this.sdk.waitForWithdrawalCompletion({
      withdrawalParams: params.withdrawalParams,
      intentTx: params.intentTx,
    });
  }

  /**
   * Parse asset ID to get information
   */
  parseAssetId(assetId: string) {
    return this.sdk.parseAssetId(assetId);
  }

  /**
   * Get the underlying SDK instance (for advanced usage)
   */
  getSDK(): IntentsSDK {
    return this.sdk;
  }
}

/**
 * Export SDK error types for error handling
 */
export {
  FeeExceedsAmountError,
  MinWithdrawalAmountError,
  TrustlineNotFoundError,
  TokenNotFoundInDestinationChainError,
};

