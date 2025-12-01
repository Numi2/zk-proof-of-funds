/**
 * Axelar Cross-Chain Private Credit Rail SDK
 *
 * This SDK enables wallets and frontends to interact with the zkpf Axelar GMP
 * rail for cross-chain proof-of-funds credentials. It provides a clean interface
 * for issuing, broadcasting, and querying ZEC credentials across chains.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/** ZEC balance threshold tiers */
export const ZecTier = {
  /** ≥ 0.1 ZEC */
  TIER_01: 0,
  /** ≥ 1 ZEC */
  TIER_1: 1,
  /** ≥ 10 ZEC */
  TIER_10: 2,
  /** ≥ 100 ZEC */
  TIER_100: 3,
  /** ≥ 1000 ZEC */
  TIER_1000: 4,
  /** ≥ 10000 ZEC */
  TIER_10000: 5,
} as const;

export type ZecTier = typeof ZecTier[keyof typeof ZecTier];

/** Tier metadata */
export interface TierInfo {
  value: ZecTier;
  name: string;
  thresholdZec: number;
  thresholdZatoshis: bigint;
}

/** Revocation reasons */
export const RevocationReason = {
  USER_REQUESTED: 0,
  BALANCE_DROPPED: 1,
  FRAUD_ATTEMPT: 2,
  EXPIRED: 3,
  POLICY_UPDATE: 4,
} as const;

export type RevocationReason = typeof RevocationReason[keyof typeof RevocationReason];

/** Broadcast status */
export const BroadcastStatus = {
  QUEUED: 'Queued',
  SENT: 'Sent',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
} as const;

export type BroadcastStatus = typeof BroadcastStatus[keyof typeof BroadcastStatus];

/** ZEC credential data */
export interface ZecCredential {
  credentialId: string;
  accountTag: string;
  tier: ZecTier;
  tierName: string;
  policyId: number;
  stateRoot: string;
  blockHeight: number;
  issuedAt: number;
  expiresAt: number;
  proofCommitment: string;
  attestationHash: string;
  revoked: boolean;
  isValid: boolean;
}

/** Credential issuance request */
export interface IssueCredentialRequest {
  accountTag: string;
  tier: ZecTier;
  stateRoot: string;
  blockHeight: number;
  proofCommitment: string;
  attestationHash: string;
  validityWindow?: number;
}

/** Credential issuance response */
export interface IssueCredentialResponse {
  success: boolean;
  credentialId?: string;
  tier?: string;
  expiresAt?: number;
  error?: string;
}

/** Broadcast request */
export interface BroadcastRequest {
  credentialId: string;
  targetChains?: string[];
}

/** Broadcast response */
export interface BroadcastResponse {
  success: boolean;
  broadcastId?: string;
  chainsBroadcast: string[];
  error?: string;
}

/** Revocation request */
export interface RevokeRequest {
  credentialId: string;
  reason: RevocationReason;
  broadcast?: boolean;
}

/** Revocation response */
export interface RevokeResponse {
  success: boolean;
  chainsNotified: string[];
  error?: string;
}

/** Credential check request */
export interface CheckCredentialRequest {
  accountTag: string;
  minTier: ZecTier;
}

/** Credential check response */
export interface CheckCredentialResponse {
  hasCredential: boolean;
  credentialId?: string;
  tier?: string;
  tierValue?: ZecTier;
  expiresAt?: number;
  timeRemaining?: number;
  reason?: string;
}

/** Supported chain info */
export interface ChainInfo {
  name: string;
  displayName: string;
  chainId?: number;
  type: 'evm' | 'cosmos' | 'other';
  productionReady: boolean;
  defaultGas: number;
}

/** Chain subscription */
export interface ChainSubscription {
  chainName: string;
  receiverContract: string;
  active: boolean;
  defaultGas: number;
}

/** Bridge statistics */
export interface BridgeStats {
  totalBroadcast: number;
  successful: number;
  failed: number;
  totalGasSpent: number;
  chainStats: Record<string, { broadcasts: number; successful: number }>;
}

/** Pending broadcast */
export interface PendingBroadcast {
  broadcastId: string;
  accountTag: string;
  tier: string;
  targetChains: string[];
  queuedAt: number;
  chainStatus: { chain: string; status: BroadcastStatus }[];
}

/** Rail info */
export interface RailInfo {
  railId: string;
  originChainId: number;
  originChainName: string;
  gatewayConfigured: boolean;
  gasServiceConfigured: boolean;
  validityWindowSecs: number;
  activeSubscriptions: number;
  features: {
    gmpBroadcast: boolean;
    interchainActions: boolean;
    cosmosSupport: boolean;
    evmSupport: boolean;
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TIER UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Tier threshold information */
export const TIER_INFO: TierInfo[] = [
  { value: ZecTier.TIER_01, name: '0.1+ ZEC', thresholdZec: 0.1, thresholdZatoshis: 10_000_000n },
  { value: ZecTier.TIER_1, name: '1+ ZEC', thresholdZec: 1, thresholdZatoshis: 100_000_000n },
  { value: ZecTier.TIER_10, name: '10+ ZEC', thresholdZec: 10, thresholdZatoshis: 1_000_000_000n },
  { value: ZecTier.TIER_100, name: '100+ ZEC', thresholdZec: 100, thresholdZatoshis: 10_000_000_000n },
  { value: ZecTier.TIER_1000, name: '1000+ ZEC', thresholdZec: 1000, thresholdZatoshis: 100_000_000_000n },
  { value: ZecTier.TIER_10000, name: '10000+ ZEC', thresholdZec: 10000, thresholdZatoshis: 1_000_000_000_000n },
];

/** Get tier from balance in zatoshis */
export function getTierFromBalance(zatoshis: bigint): ZecTier | null {
  for (let i = TIER_INFO.length - 1; i >= 0; i--) {
    if (zatoshis >= TIER_INFO[i].thresholdZatoshis) {
      return TIER_INFO[i].value;
    }
  }
  return null;
}

/** Get tier info by value */
export function getTierInfo(tier: ZecTier): TierInfo {
  return TIER_INFO[tier];
}

/** Convert ZEC to zatoshis */
export function zecToZatoshis(zec: number): bigint {
  return BigInt(Math.floor(zec * 100_000_000));
}

/** Convert zatoshis to ZEC */
export function zatoshisToZec(zatoshis: bigint): number {
  return Number(zatoshis) / 100_000_000;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/** Configuration for the Axelar Credit Rail client */
export interface AxelarCreditRailConfig {
  /** Base URL for the rails service */
  baseUrl: string;
  /** Request timeout in ms (default: 30000) */
  timeout?: number;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
}

/**
 * Client for interacting with the Axelar Cross-Chain Private Credit Rail
 *
 * @example
 * ```typescript
 * const client = new AxelarCreditRailClient({
 *   baseUrl: 'http://localhost:3002',
 * });
 *
 * // Issue a credential
 * const result = await client.issueCredential({
 *   accountTag: '0x...',
 *   tier: ZecTier.TIER_100,
 *   stateRoot: '0x...',
 *   blockHeight: 1000000,
 *   proofCommitment: '0x...',
 *   attestationHash: '0x...',
 * });
 *
 * // Broadcast to all chains
 * await client.broadcastCredential({
 *   credentialId: result.credentialId!,
 * });
 * ```
 */
export class AxelarCreditRailClient {
  private baseUrl: string;
  private timeout: number;
  private fetchFn: typeof fetch;

  constructor(config: AxelarCreditRailConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeout = config.timeout ?? 30000;
    this.fetchFn = config.fetch ?? fetch;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HEALTH & INFO
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if the rail service is healthy */
  async health(): Promise<{ status: string; railId: string }> {
    return this.get('/health');
  }

  /** Get rail information */
  async info(): Promise<RailInfo> {
    const data = await this.get<any>('/rails/axelar/info');
    return {
      railId: data.rail_id,
      originChainId: data.origin_chain_id,
      originChainName: data.origin_chain_name,
      gatewayConfigured: data.gateway_configured,
      gasServiceConfigured: data.gas_service_configured,
      validityWindowSecs: data.validity_window_secs,
      activeSubscriptions: data.active_subscriptions,
      features: {
        gmpBroadcast: data.features?.gmp_broadcast,
        interchainActions: data.features?.interchain_actions,
        cosmosSupport: data.features?.cosmos_support,
        evmSupport: data.features?.evm_support,
      },
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CHAIN MANAGEMENT
  // ─────────────────────────────────────────────────────────────────────────────

  /** List supported chains */
  async getSupportedChains(): Promise<{
    evmChains: ChainInfo[];
    cosmosChains: ChainInfo[];
  }> {
    const data = await this.get<any>('/rails/axelar/chains/supported');
    return {
      evmChains: data.evm_chains.map((c: any) => ({
        name: c.name,
        displayName: c.display_name,
        chainId: c.chain_id,
        type: 'evm' as const,
        productionReady: c.production_ready,
        defaultGas: c.default_gas,
      })),
      cosmosChains: data.cosmos_chains.map((c: any) => ({
        name: c.name,
        displayName: c.display_name,
        type: 'cosmos' as const,
        productionReady: c.production_ready,
        defaultGas: c.default_gas,
      })),
    };
  }

  /** Get current chain subscriptions */
  async getSubscriptions(): Promise<{
    total: number;
    active: number;
    subscriptions: ChainSubscription[];
  }> {
    const data = await this.get<any>('/rails/axelar/subscriptions');
    return {
      total: data.total,
      active: data.active,
      subscriptions: data.subscriptions.map((s: any) => ({
        chainName: s.chain_name,
        receiverContract: s.receiver_contract,
        active: s.active,
        defaultGas: s.default_gas,
      })),
    };
  }

  /** Subscribe to a chain */
  async subscribeChain(
    chainName: string,
    receiverContract: string,
    defaultGas?: number
  ): Promise<{ success: boolean; chainName: string; receiverContract: string }> {
    return this.post('/rails/axelar/subscribe', {
      chain_name: chainName,
      receiver_contract: receiverContract,
      default_gas: defaultGas,
    });
  }

  /** Unsubscribe from a chain */
  async unsubscribeChain(chainName: string): Promise<{ success: boolean; chainName: string }> {
    return this.post('/rails/axelar/unsubscribe', { chain_name: chainName });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // ZEC CREDENTIALS
  // ─────────────────────────────────────────────────────────────────────────────

  /** Issue a new ZEC credential */
  async issueCredential(request: IssueCredentialRequest): Promise<IssueCredentialResponse> {
    const data = await this.post<any>('/rails/axelar/zec/issue', {
      account_tag: request.accountTag,
      tier: request.tier,
      state_root: request.stateRoot,
      block_height: request.blockHeight,
      proof_commitment: request.proofCommitment,
      attestation_hash: request.attestationHash,
      validity_window: request.validityWindow,
    });

    return {
      success: data.success,
      credentialId: data.credential_id,
      tier: data.tier,
      expiresAt: data.expires_at,
      error: data.error,
    };
  }

  /** Broadcast a credential to all subscribed chains */
  async broadcastCredential(request: BroadcastRequest): Promise<BroadcastResponse> {
    const data = await this.post<any>('/rails/axelar/zec/broadcast', {
      credential_id: request.credentialId,
      target_chains: request.targetChains,
    });

    return {
      success: data.success,
      broadcastId: data.broadcast_id,
      chainsBroadcast: data.chains_broadcast,
      error: data.error,
    };
  }

  /** Broadcast a credential to a specific chain */
  async broadcastCredentialToChain(
    credentialId: string,
    chain: string
  ): Promise<BroadcastResponse> {
    const data = await this.post<any>(`/rails/axelar/zec/broadcast/${chain}`, {
      credential_id: credentialId,
    });

    return {
      success: data.success,
      broadcastId: data.broadcast_id,
      chainsBroadcast: data.chains_broadcast,
      error: data.error,
    };
  }

  /** Revoke a credential */
  async revokeCredential(request: RevokeRequest): Promise<RevokeResponse> {
    const data = await this.post<any>('/rails/axelar/zec/revoke', {
      credential_id: request.credentialId,
      reason: request.reason,
      broadcast: request.broadcast,
    });

    return {
      success: data.success,
      chainsNotified: data.chains_notified,
      error: data.error,
    };
  }

  /** Get a credential by ID */
  async getCredential(credentialId: string): Promise<ZecCredential> {
    const data = await this.get<any>(`/rails/axelar/zec/credential/${credentialId}`);

    return {
      credentialId: data.credential_id,
      accountTag: data.account_tag,
      tier: data.tier_value,
      tierName: data.tier,
      policyId: data.policy_id,
      stateRoot: data.state_root,
      blockHeight: data.block_height,
      issuedAt: data.issued_at,
      expiresAt: data.expires_at,
      proofCommitment: data.proof_commitment,
      attestationHash: data.attestation_hash,
      revoked: data.revoked,
      isValid: data.is_valid,
    };
  }

  /** Get all credentials for an account */
  async getAccountCredentials(accountTag: string): Promise<{
    accountTag: string;
    credentials: Partial<ZecCredential>[];
    count: number;
  }> {
    const data = await this.get<any>(`/rails/axelar/zec/credentials/${accountTag}`);

    return {
      accountTag: data.account_tag,
      credentials: data.credentials.map((c: any) => ({
        credentialId: c.credential_id,
        tier: c.tier_value,
        tierName: c.tier,
        issuedAt: c.issued_at,
        expiresAt: c.expires_at,
        revoked: c.revoked,
        isValid: c.is_valid,
      })),
      count: data.count,
    };
  }

  /** Check if an account has a valid credential meeting tier requirements */
  async checkCredential(request: CheckCredentialRequest): Promise<CheckCredentialResponse> {
    const data = await this.post<any>('/rails/axelar/zec/check', {
      account_tag: request.accountTag,
      min_tier: request.minTier,
    });

    return {
      hasCredential: data.has_credential,
      credentialId: data.credential_id,
      tier: data.tier,
      tierValue: data.tier_value,
      expiresAt: data.expires_at,
      timeRemaining: data.time_remaining,
      reason: data.reason,
    };
  }

  /** Get all available tiers */
  async getTiers(): Promise<TierInfo[]> {
    const data = await this.get<any>('/rails/axelar/zec/tiers');
    return data.tiers.map((t: any) => ({
      value: t.value,
      name: t.name,
      thresholdZec: t.threshold_zec,
      thresholdZatoshis: BigInt(t.threshold_zatoshis),
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // BRIDGE OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get bridge statistics */
  async getBridgeStats(): Promise<BridgeStats> {
    const data = await this.get<any>('/rails/axelar/zec/bridge/stats');

    return {
      totalBroadcast: data.total_broadcast,
      successful: data.successful,
      failed: data.failed,
      totalGasSpent: data.total_gas_spent,
      chainStats: data.chain_stats,
    };
  }

  /** Get pending broadcasts */
  async getPendingBroadcasts(): Promise<{ count: number; pending: PendingBroadcast[] }> {
    const data = await this.get<any>('/rails/axelar/zec/bridge/pending');

    return {
      count: data.count,
      pending: data.pending.map((p: any) => ({
        broadcastId: p.broadcast_id,
        accountTag: p.account_tag,
        tier: p.tier,
        targetChains: p.target_chains,
        queuedAt: p.queued_at,
        chainStatus: p.chain_status,
      })),
    };
  }

  /** Estimate gas for broadcasting to chains */
  async estimateGas(destinationChains?: string[]): Promise<{
    estimates: Record<string, number>;
    total: number;
  }> {
    const data = await this.post<any>('/rails/axelar/estimate-gas', {
      destination_chains: destinationChains,
    });

    return {
      estimates: data.estimates,
      total: data.total,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // LEGACY RECEIPT API (for backwards compatibility)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Broadcast a PoF receipt (legacy) */
  async broadcastReceipt(params: {
    holderId: string;
    policyId: number;
    snapshotId: string;
    attestationHash: string;
    validityWindow?: number;
  }): Promise<BroadcastResponse> {
    const data = await this.post<any>('/rails/axelar/broadcast', {
      holder_id: params.holderId,
      policy_id: params.policyId,
      snapshot_id: params.snapshotId,
      attestation_hash: params.attestationHash,
      validity_window: params.validityWindow,
    });

    return {
      success: data.success,
      broadcastId: data.receipt_hash,
      chainsBroadcast: data.chains_broadcast,
      error: data.error,
    };
  }

  /** Check PoF status (legacy) */
  async checkPoF(holderId: string, policyId: number): Promise<{
    hasPoF: boolean;
    receipt: any;
    expired: boolean;
  }> {
    const data = await this.post<any>('/rails/axelar/check-pof', {
      holder_id: holderId,
      policy_id: policyId,
    });

    return {
      hasPoF: data.has_pof,
      receipt: data.receipt,
      expired: data.expired,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP HELPERS
  // ─────────────────────────────────────────────────────────────────────────────

  private async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new AxelarCreditRailError(
          error.error || `Request failed: ${response.statusText}`,
          error.error_code || 'REQUEST_FAILED',
          response.status
        );
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async post<T>(path: string, body: any): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.fetchFn(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new AxelarCreditRailError(
          error.error || `Request failed: ${response.statusText}`,
          error.error_code || 'REQUEST_FAILED',
          response.status
        );
      }

      return response.json();
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ERROR HANDLING
// ═══════════════════════════════════════════════════════════════════════════════

/** Error from the Axelar Credit Rail service */
export class AxelarCreditRailError extends Error {
  public readonly code: string;
  public readonly status?: number;

  constructor(
    message: string,
    code: string,
    status?: number
  ) {
    super(message);
    this.name = 'AxelarCreditRailError';
    this.code = code;
    this.status = status;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONVENIENCE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

/** Create a client with default configuration */
export function createAxelarCreditRailClient(baseUrl: string): AxelarCreditRailClient {
  return new AxelarCreditRailClient({ baseUrl });
}

/** Default export */
export default AxelarCreditRailClient;

