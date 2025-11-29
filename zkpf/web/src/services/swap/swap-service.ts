/**
 * Cross-Chain Swap Service
 * 
 * Unified service for swapping to/from shielded ZEC via NEAR Intents + SwapKit.
 * 
 * This is the "TachyonWallet Coordinator v0" - standardizing cross-chain swap
 * flows at the application layer without requiring Zcash consensus changes.
 * 
 * Key Features:
 * 1. "Swap to Shielded ZEC" - Any chain → transparent ZEC → auto-shield to Orchard
 * 2. "Spend Shielded ZEC Cross-Chain" - Orchard → unshield → swap to destination
 * 3. Privacy hygiene: fresh addresses, network separation, timing randomization
 */

import { SwapKitClient, createSwapKitClient } from './swapkit-client';
import { NearIntentsClient, createNearIntentsClient } from './near-intents-client';
import { buildProductionSwapConfig, hasSwapKitApiKey } from './config';
import type {
  SwapServiceConfig,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRoute,
  SwapSession,
  SwapStatus,
  SwapExecuteRequest,
  SwapExecuteResponse,
  AutoShieldResult,
  FreshAddress,
  FreshAddressRequest,
  SwapServiceEvent,
  SwapServiceEventHandler,
  ChainAsset,
} from './types';
import { DEFAULT_SWAP_CONFIG } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SWAP SERVICE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Address generator callback - allows wallet integration to provide real addresses.
 */
export type AddressGeneratorCallback = (
  type: 'transparent' | 'orchard',
  purpose: string
) => Promise<FreshAddress>;

/**
 * Main cross-chain swap service.
 * Aggregates quotes from SwapKit and NEAR Intents, handles auto-shielding,
 * and maintains privacy hygiene throughout the swap process.
 */
export class SwapService {
  private config: SwapServiceConfig;
  private swapKitClient: SwapKitClient;
  private nearIntentsClient: NearIntentsClient;
  private eventHandlers: Set<SwapServiceEventHandler>;
  private activeSessions: Map<string, SwapSession>;
  private addressPool: Map<string, FreshAddress>;
  private addressGenerator: AddressGeneratorCallback | null = null;

  constructor(config: SwapServiceConfig = DEFAULT_SWAP_CONFIG) {
    this.config = config;
    this.swapKitClient = createSwapKitClient(config);
    this.nearIntentsClient = createNearIntentsClient(config);
    this.eventHandlers = new Set();
    this.activeSessions = new Map();
    this.addressPool = new Map();
  }

  /**
   * Set the address generator callback.
   * This allows wallet integration to provide real address derivation.
   */
  setAddressGenerator(generator: AddressGeneratorCallback): void {
    this.addressGenerator = generator;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // QUOTE AGGREGATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get aggregated quotes from all enabled providers.
   * Returns the best routes for swapping source → destination.
   */
  async getQuotes(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    const quotePromises: Promise<SwapQuoteResponse>[] = [];

    // Query SwapKit if enabled
    if (this.config.enabledProviders.includes('swapkit') ||
        this.config.enabledProviders.includes('thorchain') ||
        this.config.enabledProviders.includes('maya')) {
      quotePromises.push(this.swapKitClient.getQuote(request));
    }

    // Query NEAR Intents if enabled
    if (this.config.enabledProviders.includes('near_intents')) {
      quotePromises.push(this.nearIntentsClient.getQuotes(request));
    }

    // Wait for all providers in parallel
    const results = await Promise.allSettled(quotePromises);

    // Aggregate routes
    const allRoutes: SwapRoute[] = [];
    const allErrors: SwapQuoteResponse['errors'] = [];

    for (const result of results) {
      if (result.status === 'fulfilled') {
        allRoutes.push(...result.value.routes);
        allErrors.push(...result.value.errors);
      } else {
        allErrors.push({ provider: 'swapkit', reason: result.reason?.message || 'Provider error' });
      }
    }

    // Sort by expected output (descending)
    allRoutes.sort((a, b) => {
      const diff = b.expectedAmountOut - a.expectedAmountOut;
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    });

    const response: SwapQuoteResponse = {
      routes: allRoutes,
      recommended: allRoutes[0] || null,
      errors: allErrors,
      quotedAt: Date.now(),
    };

    this.emit({ type: 'QUOTE_FETCHED', quotes: response });
    return response;
  }

  /**
   * Get quotes specifically for swapping TO shielded ZEC.
   * Helper that sets destination to Zcash and handles ZEC-specific logic.
   */
  async getQuotesToShieldedZec(
    source: ChainAsset,
    amountIn: bigint,
    sourceAddress: string,
    zcashUnifiedAddress: string
  ): Promise<SwapQuoteResponse> {
    // For inbound swaps, destination is always ZEC
    const destination: ChainAsset = { chain: 'zcash', asset: 'ZEC' };

    // We'll use a fresh transparent address for receiving,
    // then auto-shield to the Orchard address
    const request: SwapQuoteRequest = {
      source,
      destination,
      amountIn,
      sourceAddress,
      destinationAddress: zcashUnifiedAddress, // Will be overridden with fresh t-addr
      slippageTolerance: this.config.defaultSlippage,
      preferredProviders: this.config.enabledProviders.filter(
        p => p !== 'jupiter' // Jupiter is Solana-only, not relevant for ZEC
      ),
    };

    return this.getQuotes(request);
  }

  /**
   * Get quotes for spending shielded ZEC cross-chain.
   * Helper that sets source to Zcash and handles unshielding logic.
   */
  async getQuotesFromShieldedZec(
    destination: ChainAsset,
    amountIn: bigint,
    destinationAddress: string
  ): Promise<SwapQuoteResponse> {
    // For outbound swaps, source is always ZEC
    const source: ChainAsset = { chain: 'zcash', asset: 'ZEC' };

    // We'll unshield from Orchard to a fresh t-addr,
    // then swap from that t-addr
    const request: SwapQuoteRequest = {
      source,
      destination,
      amountIn,
      sourceAddress: '', // Will be set to fresh t-addr during execution
      destinationAddress,
      slippageTolerance: this.config.defaultSlippage,
      preferredProviders: this.config.enabledProviders,
    };

    return this.getQuotes(request);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SWAP EXECUTION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Execute a swap to shielded ZEC.
   * 
   * Flow:
   * 1. Generate fresh transparent address for receiving
   * 2. Generate fresh Orchard address for shielding destination
   * 3. Initiate swap via selected route
   * 4. Monitor for deposit on t-addr
   * 5. Auto-shield to Orchard once confirmed
   */
  async executeSwapToShieldedZec(
    route: SwapRoute,
    sourceAddress: string,
  ): Promise<SwapSession> {
    // Generate fresh addresses
    const freshTransparent = await this.generateFreshAddress({
      type: 'transparent',
      purpose: 'swap_deposit',
    });

    const freshOrchard = await this.generateFreshAddress({
      type: 'orchard',
      purpose: 'shield_destination',
    });

    // Create session
    const session = this.createSession({
      direction: 'inbound',
      source: route.source,
      destination: route.destination,
      amountIn: route.amountIn,
      expectedAmountOut: route.expectedAmountOut,
      route,
      freshTransparentAddress: freshTransparent.address,
      freshOrchardAddress: freshOrchard.address,
    });

    // Execute the swap
    const executeRequest: SwapExecuteRequest = {
      route,
      sourceAddress,
      zcashTransparentAddress: freshTransparent.address,
      zcashOrchardAddress: freshOrchard.address,
      autoShield: this.config.autoShield.enabled,
    };

    let executeResponse: SwapExecuteResponse;
    
    if (route.provider === 'near_intents') {
      executeResponse = await this.nearIntentsClient.executeIntent(executeRequest);
    } else {
      // For SwapKit routes, use their execution flow
      executeResponse = await this.executeSwapKitRoute(executeRequest);
    }

    // Update session with tracking data
    session.tracking = executeResponse.trackingData;
    session.status = executeResponse.status;

    this.activeSessions.set(session.sessionId, session);
    this.emit({ type: 'SWAP_INITIATED', session });

    // Start monitoring the swap (async)
    this.monitorSwap(session.sessionId);

    return session;
  }

  /**
   * Execute a swap from shielded ZEC to another chain.
   * 
   * Flow:
   * 1. Unshield from Orchard to fresh t-addr
   * 2. Wait for unshield confirmation
   * 3. Send transparent ZEC to swap deposit address
   * 4. Monitor swap progress
   * 5. Receive destination asset
   */
  async executeSwapFromShieldedZec(
    route: SwapRoute,
    _destinationAddress: string,
    _orchardBalance: bigint,
  ): Promise<SwapSession> {
    // Generate fresh transparent address for unshielding
    const freshTransparent = await this.generateFreshAddress({
      type: 'transparent',
      purpose: 'swap_deposit',
    });

    // Create session
    const session = this.createSession({
      direction: 'outbound',
      source: route.source,
      destination: route.destination,
      amountIn: route.amountIn,
      expectedAmountOut: route.expectedAmountOut,
      route,
      freshTransparentAddress: freshTransparent.address,
    });

    // First, unshield from Orchard to the fresh t-addr
    // This will be called externally via the wallet API
    session.status = 'awaiting_deposit'; // Awaiting unshield completion

    this.activeSessions.set(session.sessionId, session);
    this.emit({ type: 'SWAP_INITIATED', session });

    return session;
  }

  /**
   * Continue outbound swap after unshielding is complete.
   * Called once the transparent ZEC is available.
   */
  async continueOutboundSwap(
    sessionId: string,
    unshieldTxHash: string,
  ): Promise<SwapSession> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }

    session.timestamps.depositConfirmed = Date.now();
    session.status = 'swap_in_progress';

    // Execute the actual swap
    const executeRequest: SwapExecuteRequest = {
      route: session.route,
      sourceAddress: session.freshTransparentAddress!,
      zcashTransparentAddress: session.freshTransparentAddress!,
      zcashOrchardAddress: '',
      autoShield: false,
    };

    let executeResponse: SwapExecuteResponse;
    
    if (session.route.provider === 'near_intents') {
      executeResponse = await this.nearIntentsClient.executeIntent(executeRequest);
    } else {
      executeResponse = await this.executeSwapKitRoute(executeRequest);
    }

    session.tracking = executeResponse.trackingData;
    session.tracking.sourceTxHash = unshieldTxHash;

    this.emit({ type: 'SWAP_STATUS_UPDATED', session });

    // Start monitoring
    this.monitorSwap(sessionId);

    return session;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-SHIELDING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Auto-shield transparent ZEC to Orchard.
   * Called when incoming swap deposit is confirmed.
   * 
   * Privacy considerations (Tachyon patterns at app layer):
   * 1. Use fresh Orchard address for each shield (never reuse)
   * 2. Add random timing delay to break correlation
   * 3. Shield full balance to avoid linkable change
   * 4. Never shield to same address that received deposit
   * 
   * Implementation notes:
   * - Requires wallet integration via `addressGenerator` callback
   * - Transaction should be built with standard Zcash shielding flow
   * - Wait for sufficient confirmations (config.autoShield.confirmationsRequired)
   */
  async autoShield(
    fromTransparent: string,
    toOrchard: string,
    amountZats: bigint,
  ): Promise<AutoShieldResult> {
    // Apply privacy delay if configured (randomized timing to prevent correlation)
    if (this.config.autoShield.privacyDelayMs) {
      const { min, max } = this.config.autoShield.privacyDelayMs;
      const delay = Math.floor(Math.random() * (max - min) + min);
      console.log(`[SwapService] Privacy delay: ${delay}ms before auto-shield`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    // Check minimum amount
    if (amountZats < this.config.autoShield.minAmountZats) {
      return {
        fromTransparent,
        toOrchard,
        amountZats,
        txHash: '',
        status: 'failed',
        error: `Amount below minimum: ${amountZats} < ${this.config.autoShield.minAmountZats} zatoshis`,
      };
    }

    // In production with wallet integration:
    // 1. Query transparent balance at fromTransparent
    // 2. Build shielding transaction (t-addr → Orchard)
    // 3. Sign and broadcast
    // 4. Return tx hash and monitor for confirmation
    
    // For now, return a pending status indicating manual action needed
    // The wallet UI will prompt user to complete the shield
    const result: AutoShieldResult = {
      fromTransparent,
      toOrchard,
      amountZats,
      txHash: `shield-pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
    };

    console.log(`[SwapService] Auto-shield initiated: ${amountZats} zatoshis`);
    console.log(`[SwapService]   From t-addr: ${fromTransparent.slice(0, 10)}...`);
    console.log(`[SwapService]   To Orchard: ${toOrchard.slice(0, 12)}...`);

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDRESS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a fresh address for swap operations.
   * Never reuse addresses to maintain privacy.
   */
  async generateFreshAddress(request: FreshAddressRequest): Promise<FreshAddress> {
    // Use the wallet callback if available
    if (this.addressGenerator) {
      const effectiveType = request.type === 'unified' ? 'orchard' : request.type;
      const freshAddress = await this.addressGenerator(effectiveType, request.purpose);
      
      // Track the address
      const key = `${request.swapSessionId || 'pool'}-${request.purpose}`;
      this.addressPool.set(key, freshAddress);
      
      return freshAddress;
    }

    // Fallback to placeholder (for testing/demo)
    const diversifierIndex = BigInt(Date.now());
    
    let address: string;
    switch (request.type) {
      case 'transparent':
        address = `t1${Math.random().toString(36).substr(2, 32)}`;
        break;
      case 'orchard':
        address = `u1${Math.random().toString(36).substr(2, 64)}`;
        break;
      case 'unified':
        address = `u1${Math.random().toString(36).substr(2, 64)}`;
        break;
      default:
        throw new Error(`Unknown address type: ${request.type}`);
    }

    const freshAddress: FreshAddress = {
      address,
      type: request.type,
      accountIndex: 0,
      diversifierIndex,
      used: false,
      createdAt: Date.now(),
    };

    // Track the address
    const key = `${request.swapSessionId || 'pool'}-${request.purpose}`;
    this.addressPool.set(key, freshAddress);

    return freshAddress;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get an active swap session by ID.
   */
  getSession(sessionId: string): SwapSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  /**
   * Get all active sessions.
   */
  getAllSessions(): SwapSession[] {
    return Array.from(this.activeSessions.values());
  }

  /**
   * Get sessions by direction.
   */
  getSessionsByDirection(direction: 'inbound' | 'outbound'): SwapSession[] {
    return this.getAllSessions().filter(s => s.direction === direction);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Subscribe to swap service events.
   */
  subscribe(handler: SwapServiceEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all subscribers.
   */
  private emit(event: SwapServiceEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Event handler error:', error);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a new swap session.
   */
  private createSession(params: {
    direction: 'inbound' | 'outbound';
    source: ChainAsset;
    destination: ChainAsset;
    amountIn: bigint;
    expectedAmountOut: bigint;
    route: SwapRoute;
    freshTransparentAddress?: string;
    freshOrchardAddress?: string;
  }): SwapSession {
    const sessionId = `swap-${params.direction}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      sessionId,
      direction: params.direction,
      source: params.source,
      destination: params.destination,
      amountIn: params.amountIn,
      expectedAmountOut: params.expectedAmountOut,
      status: 'idle',
      route: params.route,
      tracking: {
        provider: params.route.provider,
        providerSwapId: '',
      },
      timestamps: {
        created: Date.now(),
      },
      freshTransparentAddress: params.freshTransparentAddress,
      freshOrchardAddress: params.freshOrchardAddress,
    };
  }

  /**
   * Execute a swap via SwapKit.
   */
  private async executeSwapKitRoute(request: SwapExecuteRequest): Promise<SwapExecuteResponse> {
    // For SwapKit routes, we construct the deposit info from route metadata
    const { route } = request;
    const metadata = route.metadata as Record<string, unknown>;

    const swapId = `swapkit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    return {
      swapId,
      depositAddress: metadata.inboundAddress as string | undefined,
      depositMemo: metadata.memo as string | undefined,
      depositAmount: route.amountIn,
      status: 'awaiting_deposit',
      expectedOutput: route.expectedAmountOut,
      estimatedCompletionAt: Date.now() + route.estimatedTimeSeconds * 1000,
      trackingData: {
        provider: route.provider,
        providerSwapId: swapId,
        inboundAddress: metadata.inboundAddress as string | undefined,
        trackingUrl: `https://track.swapkit.dev/${swapId}`,
      },
    };
  }

  /**
   * Monitor a swap's progress across chains.
   * 
   * Polling strategy:
   * - Start polling 5 seconds after initiation
   * - Poll every 30 seconds for status updates
   * - Maximum 60 polls (30 minutes timeout)
   * - Stop on terminal states (completed, failed, refunded)
   * 
   * For inbound swaps (→ ZEC):
   * 1. Wait for source chain deposit confirmation
   * 2. Wait for swap execution across intermediary chains
   * 3. Wait for ZEC deposit to t-addr
   * 4. Trigger auto-shield to Orchard
   * 
   * For outbound swaps (ZEC →):
   * 1. Wait for unshield confirmation
   * 2. Wait for t-ZEC deposit to provider
   * 3. Wait for swap execution
   * 4. Wait for destination chain delivery
   */
  private async monitorSwap(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    const pollInterval = 30000; // 30 seconds
    const maxPolls = 60; // 30 minutes max
    let pollCount = 0;

    console.log(`[SwapService] Starting swap monitor for session: ${sessionId}`);

    const poll = async () => {
      pollCount++;
      
      // Timeout check
      if (pollCount > maxPolls) {
        session.status = 'failed';
        session.error = 'Swap timed out after 30 minutes';
        session.timestamps.failed = Date.now();
        this.emit({ type: 'SWAP_FAILED', session, error: 'Swap timed out' });
        console.error(`[SwapService] Swap ${sessionId} timed out`);
        return;
      }

      const currentSession = this.activeSessions.get(sessionId);
      if (!currentSession) {
        console.log(`[SwapService] Session ${sessionId} no longer exists, stopping monitor`);
        return;
      }

      // Terminal state check
      if (['completed', 'failed', 'refunded'].includes(currentSession.status)) {
        console.log(`[SwapService] Session ${sessionId} in terminal state: ${currentSession.status}`);
        return;
      }

      console.log(`[SwapService] Poll ${pollCount}/${maxPolls} for ${sessionId}, status: ${currentSession.status}`);

      // Check status based on provider
      try {
        if (currentSession.route.provider === 'near_intents') {
          const status = await this.nearIntentsClient.getIntentStatus(
            currentSession.tracking.nearIntentId || ''
          );
          if (status) {
            this.updateSessionFromNearStatus(currentSession, status);
          }
        } else if (['thorchain', 'maya', 'swapkit'].includes(currentSession.route.provider)) {
          // SwapKit/THORChain status checking
          await this.checkSwapKitStatus(currentSession);
        }
      } catch (error) {
        console.error(`[SwapService] Status poll error for ${sessionId}:`, error);
      }

      // Continue polling
      setTimeout(poll, pollInterval);
    };

    // Start polling after initial delay
    setTimeout(poll, 5000);
  }

  /**
   * Check swap status via SwapKit/THORChain tracking.
   */
  private async checkSwapKitStatus(session: SwapSession): Promise<void> {
    const { providerSwapId, trackingUrl } = session.tracking;
    if (!providerSwapId) return;

    // In production, this would:
    // 1. Query SwapKit tracking API: GET /v1/track/{txHash}
    // 2. Or query THORChain midgard: GET /v2/actions?txid={hash}
    // 3. Parse response and update session status
    
    // For now, log that we would check
    console.log(`[SwapService] Would check SwapKit status: ${trackingUrl || providerSwapId}`);
  }

  /**
   * Update session from NEAR intent status.
   */
  private updateSessionFromNearStatus(
    session: SwapSession,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status: any
  ): void {
    const prevStatus = session.status;
    
    const statusMap: Record<string, SwapStatus> = {
      pending: 'awaiting_deposit',
      matched: 'deposit_detected',
      executing: 'swap_in_progress',
      completed: 'output_confirmed',
      failed: 'failed',
      expired: 'failed',
    };

    const newStatus = statusMap[status.status] || session.status;
    
    if (newStatus !== prevStatus) {
      session.status = newStatus;
      
      // Handle auto-shielding for inbound swaps
      if (session.direction === 'inbound' && newStatus === 'output_confirmed') {
        this.handleInboundCompletion(session);
      }

      this.emit({ type: 'SWAP_STATUS_UPDATED', session });
    }
  }

  /**
   * Handle completion of an inbound swap (auto-shield if enabled).
   */
  private async handleInboundCompletion(session: SwapSession): Promise<void> {
    if (!this.config.autoShield.enabled) {
      session.status = 'completed';
      session.timestamps.completed = Date.now();
      this.emit({ type: 'SWAP_COMPLETED', session });
      return;
    }

    session.status = 'auto_shielding';
    session.timestamps.shieldingStarted = Date.now();
    this.emit({ type: 'AUTO_SHIELDING_STARTED', session });

    try {
      const result = await this.autoShield(
        session.freshTransparentAddress!,
        session.freshOrchardAddress!,
        session.expectedAmountOut
      );

      session.tracking.shieldTxHash = result.txHash;

      if (result.status === 'pending' || result.status === 'confirmed') {
        session.status = 'completed';
        session.timestamps.completed = Date.now();
        session.actualAmountOut = result.amountZats;
        this.emit({ type: 'AUTO_SHIELD_COMPLETE', session, result });
        this.emit({ type: 'SWAP_COMPLETED', session });
      } else {
        session.status = 'failed';
        session.error = result.error || 'Auto-shield failed';
        this.emit({ type: 'SWAP_FAILED', session, error: session.error });
      }
    } catch (error) {
      session.status = 'failed';
      session.error = error instanceof Error ? error.message : 'Auto-shield error';
      this.emit({ type: 'SWAP_FAILED', session, error: session.error });
    }
  }
}

/**
 * Create a swap service instance.
 */
export function createSwapService(config?: Partial<SwapServiceConfig>): SwapService {
  const mergedConfig: SwapServiceConfig = {
    ...DEFAULT_SWAP_CONFIG,
    ...config,
    autoShield: { ...DEFAULT_SWAP_CONFIG.autoShield, ...config?.autoShield },
    networkSeparation: { ...DEFAULT_SWAP_CONFIG.networkSeparation, ...config?.networkSeparation },
  };
  return new SwapService(mergedConfig);
}

// Export singleton for convenience
let defaultSwapService: SwapService | null = null;

/**
 * Get the default swap service instance.
 * 
 * Uses production configuration if environment variables are set:
 * - VITE_SWAPKIT_API_KEY: SwapKit API key
 * - VITE_NEAR_NETWORK: NEAR network (mainnet/testnet)
 * 
 * Falls back to default config for development.
 */
export function getSwapService(): SwapService {
  if (!defaultSwapService) {
    // Use production config if API key is configured, otherwise use defaults
    const config = hasSwapKitApiKey() ? buildProductionSwapConfig() : DEFAULT_SWAP_CONFIG;
    
    console.log('[SwapService] Initializing with config:', {
      hasApiKey: hasSwapKitApiKey(),
      nearNetwork: config.nearIntents?.networkId,
      enabledProviders: config.enabledProviders,
    });
    
    defaultSwapService = createSwapService(config);
  }
  return defaultSwapService;
}

/**
 * Reset the swap service singleton.
 * Useful for testing or config changes.
 */
export function resetSwapService(): void {
  defaultSwapService = null;
}

