/**
 * NEAR Protocol Integration for Orderly Network
 * 
 * This service provides functions to interact with the Orderly asset manager
 * smart contract on NEAR Protocol for deposits, withdrawals, and account management.
 * 
 * Uses NEAR Connect (@hot-labs/near-connect) for modern wallet support.
 */

import * as nearAPI from 'near-api-js';
import { NearConnector } from '@hot-labs/near-connect';

const { connect, keyStores, Contract, utils } = nearAPI;

// Contract addresses
export const MAINNET_CONTRACT = 'asset-manager.orderly-network.near';
export const TESTNET_CONTRACT = 'asset-manager.orderly.testnet';
export const TESTNET_USDC_FAUCET = 'ft-faucet-usdc.orderly.testnet';

// Token contracts
export const TOKEN_CONTRACTS = {
  mainnet: {
    USDC: 'a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.factory.bridge.near',
    USDT: 'dac17f958d2ee523a2206206994597c13d831ec7.factory.bridge.near',
    NEAR: 'wrap.near',
  },
  testnet: {
    USDC: 'usdc.fakes.testnet',
    USDT: 'usdt.fakes.testnet',
    NEAR: 'wrap.testnet',
  },
};

// Network configuration
export type NetworkId = 'mainnet' | 'testnet';

export interface NearConfig {
  networkId: NetworkId;
  nodeUrl: string;
  walletUrl: string;
  helperUrl: string;
  explorerUrl: string;
}

export const NEAR_CONFIGS: Record<NetworkId, NearConfig> = {
  mainnet: {
    networkId: 'mainnet',
    nodeUrl: 'https://rpc.mainnet.near.org',
    walletUrl: 'https://wallet.near.org',
    helperUrl: 'https://helper.mainnet.near.org',
    explorerUrl: 'https://nearblocks.io',
  },
  testnet: {
    networkId: 'testnet',
    nodeUrl: 'https://rpc.testnet.near.org',
    walletUrl: 'https://wallet.testnet.near.org',
    helperUrl: 'https://helper.testnet.near.org',
    explorerUrl: 'https://testnet.nearblocks.io',
  },
};

export interface TokenBalance {
  balance: string;
  pending_transfer: string;
}

export interface StorageBalance {
  total: string;
  available: string;
}

export interface StorageBounds {
  min: string;
  max: string;
}

/**
 * NEAR Orderly Service
 * Manages connection to NEAR and interaction with Orderly contracts
 * Uses NEAR Connect for modern wallet support
 */
export class NearOrderlyService {
  private connector: NearConnector | null = null;
  private near: nearAPI.Near | null = null;
  private account: nearAPI.Account | null = null;
  private contract: any = null;
  private networkId: NetworkId;
  private config: NearConfig;
  private initialized: boolean = false;
  private connectedAccountId: string | null = null;
  private connectedWallet: any = null;

  constructor(networkId: NetworkId = 'testnet') {
    this.networkId = networkId;
    this.config = NEAR_CONFIGS[networkId];
  }

  /**
   * Initialize NEAR connection with NEAR Connect
   */
  async initialize() {
    if (this.initialized) {
      return this;
    }

    try {
      // Initialize NEAR Connect
      this.connector = new NearConnector({
        network: this.networkId === 'mainnet' ? 'mainnet' : 'testnet',
      });

      // Wait for manifest to load
      await this.connector.whenManifestLoaded;

      // Initialize near-api-js for contract interactions
      const keyStore = new keyStores.BrowserLocalStorageKeyStore();
      this.near = await connect({
        ...this.config,
        keyStore,
        headers: {},
      });

      // Check if there's a stored account ID (from previous session)
      // NEAR Connect doesn't persist connection, so we check localStorage
      const storedAccountId = localStorage.getItem(`near_account_${this.networkId}`);
      if (storedAccountId) {
        try {
          this.account = await this.near.account(storedAccountId);
          this.connectedAccountId = storedAccountId;
          await this.initializeContract();
        } catch (err) {
          // Account might not exist anymore, clear it
          localStorage.removeItem(`near_account_${this.networkId}`);
        }
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize NEAR service:', error);
      throw error;
    }

    return this;
  }

  /**
   * Initialize contract instance
   */
  private async initializeContract() {
    if (!this.account) {
      return;
    }

    const contractId = this.networkId === 'mainnet' ? MAINNET_CONTRACT : TESTNET_CONTRACT;
    
    this.contract = new Contract(
      this.account,
      contractId,
      {
        viewMethods: [
          'get_user_token_balances',
          'storage_balance_of',
          'storage_balance_bounds',
          'storage_cost_of_announce_key',
          'storage_cost_of_token_balance',
        ],
        changeMethods: [
          'user_request_withdraw',
          'storage_deposit',
          'storage_withdraw',
          'storage_unregister',
        ],
        useLocalViewExecution: false,
      }
    );
  }

  /**
   * Check if wallet is connected
   */
  isConnected(): boolean {
    return this.connectedAccountId !== null && this.account !== null;
  }

  /**
   * Get connected account ID
   */
  getAccountId(): string | null {
    return this.connectedAccountId;
  }

  /**
   * Get NEAR Connect connector instance
   */
  getConnector(): NearConnector | null {
    return this.connector;
  }

  /**
   * Request wallet connection via NEAR Connect
   * @param walletId Optional wallet ID to connect to specific wallet
   */
  async requestSignIn(walletId?: string) {
    if (!this.connector) {
      await this.initialize();
    }

    if (!this.connector) {
      throw new Error('NEAR Connect not initialized');
    }

    try {
      // Connect to wallet (opens wallet selection UI if no walletId provided)
      const wallet = await this.connector.connect(walletId);
      this.connectedWallet = wallet;
      
      // Sign in with the wallet
      const accounts = await wallet.signIn();
      
      if (accounts && accounts.length > 0) {
        const accountId = accounts[0].accountId;
        this.connectedAccountId = accountId;
        
        // Store account ID for persistence
        localStorage.setItem(`near_account_${this.networkId}`, accountId);
        
        // Initialize account and contract
        if (this.near) {
          this.account = await this.near.account(accountId);
          await this.initializeContract();
        }
      }
    } catch (error) {
      console.error('Failed to sign in:', error);
      throw error;
    }
  }

  /**
   * Sign out from wallet
   */
  signOut() {
    if (this.connectedWallet) {
      try {
        this.connectedWallet.signOut();
      } catch (err) {
        console.warn('Error signing out wallet:', err);
      }
    }
    this.account = null;
    this.contract = null;
    this.connectedAccountId = null;
    this.connectedWallet = null;
    localStorage.removeItem(`near_account_${this.networkId}`);
  }

  /**
   * Get user token balances from Orderly contract
   */
  async getUserTokenBalances(accountId?: string): Promise<Record<string, TokenBalance>> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    const user = accountId || this.getAccountId();
    if (!user) {
      throw new Error('No account ID provided');
    }

    try {
      const balances = await this.contract.get_user_token_balances({ user });
      
      // Convert array of [tokenId, balance] to object
      const balanceMap: Record<string, TokenBalance> = {};
      for (const [tokenId, balance] of balances) {
        balanceMap[tokenId] = balance;
      }
      
      return balanceMap;
    } catch (error) {
      console.error('Failed to get user token balances:', error);
      throw error;
    }
  }

  /**
   * Withdraw tokens from Orderly to NEAR wallet
   */
  async withdrawToken(tokenAccountId: string, amount: string): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      await this.contract.user_request_withdraw(
        {
          token: tokenAccountId,
          amount: amount,
        },
        '120000000000000', // 120 Tgas
        '1' // 1 yoctoNEAR deposit
      );
    } catch (error) {
      console.error('Failed to withdraw token:', error);
      throw error;
    }
  }

  /**
   * Get storage balance for account
   */
  async getStorageBalance(accountId?: string): Promise<StorageBalance | null> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    const account_id = accountId || this.getAccountId();
    if (!account_id) {
      throw new Error('No account ID provided');
    }

    try {
      return await this.contract.storage_balance_of({ account_id });
    } catch (error) {
      console.error('Failed to get storage balance:', error);
      return null;
    }
  }

  /**
   * Get storage balance bounds (min/max deposit required)
   */
  async getStorageBalanceBounds(): Promise<StorageBounds> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      return await this.contract.storage_balance_bounds();
    } catch (error) {
      console.error('Failed to get storage bounds:', error);
      throw error;
    }
  }

  /**
   * Get storage cost for announcing a key
   */
  async getStorageCostOfAnnounceKey(): Promise<string> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      return await this.contract.storage_cost_of_announce_key();
    } catch (error) {
      console.error('Failed to get storage cost:', error);
      throw error;
    }
  }

  /**
   * Get storage cost for each token balance
   */
  async getStorageCostOfTokenBalance(): Promise<string> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      return await this.contract.storage_cost_of_token_balance();
    } catch (error) {
      console.error('Failed to get token balance storage cost:', error);
      throw error;
    }
  }

  /**
   * Deposit NEAR for storage staking
   */
  async depositStorage(amount: string, registrationOnly: boolean = false): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    const accountId = this.getAccountId();
    
    try {
      await this.contract.storage_deposit(
        {
          account_id: accountId,
          registration_only: registrationOnly,
        },
        '30000000000000', // 30 Tgas
        amount // Attached NEAR deposit
      );
    } catch (error) {
      console.error('Failed to deposit storage:', error);
      throw error;
    }
  }

  /**
   * Withdraw NEAR from storage staking
   */
  async withdrawStorage(amount?: string): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      await this.contract.storage_withdraw(
        {
          amount: amount || null, // null = withdraw all available
        },
        '30000000000000', // 30 Tgas
        '1' // 1 yoctoNEAR deposit required
      );
    } catch (error) {
      console.error('Failed to withdraw storage:', error);
      throw error;
    }
  }

  /**
   * Close account and unregister from Orderly
   */
  async unregisterAccount(force: boolean = false): Promise<void> {
    if (!this.contract) {
      throw new Error('Contract not initialized');
    }

    try {
      await this.contract.storage_unregister(
        {
          force,
        },
        '30000000000000', // 30 Tgas
        '1' // 1 yoctoNEAR deposit required
      );
    } catch (error) {
      console.error('Failed to unregister account:', error);
      throw error;
    }
  }

  /**
   * Get NEAR account balance
   */
  async getAccountBalance(): Promise<any | null> {
    if (!this.account) {
      return null;
    }

    try {
      return await this.account.getAccountBalance();
    } catch (error) {
      console.error('Failed to get account balance:', error);
      return null;
    }
  }

  /**
   * Format NEAR amount from yoctoNEAR
   */
  static formatNearAmount(amount: string, decimals: number = 2): string {
    return utils.format.formatNearAmount(amount, decimals);
  }

  /**
   * Parse NEAR amount to yoctoNEAR
   */
  static parseNearAmount(amount: string): string | null {
    return utils.format.parseNearAmount(amount);
  }

  /**
   * Get explorer URL for transaction
   */
  getExplorerUrl(txHash: string): string {
    return `${this.config.explorerUrl}/txns/${txHash}`;
  }

  /**
   * Get explorer URL for account
   */
  getAccountExplorerUrl(accountId: string): string {
    return `${this.config.explorerUrl}/address/${accountId}`;
  }

  /**
   * Deposit tokens to Orderly via ft_transfer_call
   * This calls the NEP-141 standard ft_transfer_call method on the token contract
   */
  async depositToken(
    tokenContractId: string,
    amount: string,
    decimals: number = 6
  ): Promise<string> {
    if (!this.account) {
      throw new Error('Wallet not connected');
    }

    const assetManagerContract = this.networkId === 'mainnet' 
      ? MAINNET_CONTRACT 
      : TESTNET_CONTRACT;

    // Convert amount to token's smallest unit (e.g., for USDC with 6 decimals)
    const amountInSmallestUnit = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, decimals))).toString();

    try {
      // Call ft_transfer_call on the token contract
      // This is the NEP-141 standard method for transferring tokens with a callback
      const result = await this.account.functionCall({
        contractId: tokenContractId,
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: assetManagerContract,
          amount: amountInSmallestUnit,
          msg: '', // Optional message for the callback
        },
        gas: BigInt('300000000000000'), // 300 Tgas
        attachedDeposit: BigInt('1'), // 1 yoctoNEAR required for callback
      });

      return result.transaction.hash;
    } catch (error) {
      console.error('Failed to deposit token:', error);
      throw error;
    }
  }

  /**
   * Send NEAR to any address
   * Used for 1-Click swap deposits
   */
  async sendNear(
    receiverId: string,
    amount: string
  ): Promise<{ transaction: { hash: string } }> {
    if (!this.account) {
      throw new Error('Wallet not connected');
    }

    try {
      // Amount should already be in yoctoNEAR
      const result = await this.account.sendMoney(receiverId, BigInt(amount));
      return { transaction: { hash: result.transaction.hash } };
    } catch (error) {
      console.error('Failed to send NEAR:', error);
      throw error;
    }
  }

  /**
   * Transfer fungible tokens to any address using ft_transfer_call
   * Used for 1-Click swap deposits
   */
  async transferToken(
    tokenContractId: string,
    receiverId: string,
    amount: string,
    memo?: string
  ): Promise<{ transaction: { hash: string } }> {
    if (!this.account) {
      throw new Error('Wallet not connected');
    }

    try {
      // Call ft_transfer_call on the token contract
      const result = await this.account.functionCall({
        contractId: tokenContractId,
        methodName: 'ft_transfer_call',
        args: {
          receiver_id: receiverId,
          amount: amount,
          msg: memo || '',
        },
        gas: BigInt('300000000000000'), // 300 Tgas
        attachedDeposit: BigInt('1'), // 1 yoctoNEAR required for callback
      });

      return { transaction: { hash: result.transaction.hash } };
    } catch (error) {
      console.error('Failed to transfer token:', error);
      throw error;
    }
  }
}

/**
 * Global service instance
 */
let nearServiceInstance: NearOrderlyService | null = null;

/**
 * Get or create NEAR service instance
 */
export async function getNearOrderlyService(networkId: NetworkId = 'testnet'): Promise<NearOrderlyService> {
  if (!nearServiceInstance || nearServiceInstance['networkId'] !== networkId) {
    nearServiceInstance = new NearOrderlyService(networkId);
    await nearServiceInstance.initialize();
  }
  return nearServiceInstance;
}

/**
 * Reset service instance (useful for network switching)
 */
export function resetNearOrderlyService() {
  nearServiceInstance = null;
}

