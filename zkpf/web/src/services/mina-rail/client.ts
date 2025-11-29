/**
 * Mina Rail API Client
 *
 * Client for interacting with the Mina Recursive Rail backend.
 */

import type {
  MinaRailStatus,
  MinaRailEpochState,
  MinaRailEpochProof,
  SubmitTachystampRequest,
  SubmitTachystampResponse,
  GetEpochProofResponse,
  HolderTachystampHistory,
  EpochVerificationResult,
  Tachystamp,
} from '../../types/mina-rail';

// Mina Rail is now integrated into the main zkpf-backend, so use the same port
const DEFAULT_MINA_RAIL_URL = 
  import.meta.env.VITE_ZKPF_BACKEND_URL || 
  import.meta.env.VITE_MINA_RAIL_URL || 
  'http://localhost:3000';

export class MinaRailApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MinaRailApiError';
    this.status = status;
  }
}

/**
 * Client for the Mina Rail API.
 */
export class MinaRailClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? DEFAULT_MINA_RAIL_URL).replace(/\/$/, '');
  }

  /**
   * Get the current Mina Rail status.
   */
  async getStatus(): Promise<MinaRailStatus> {
    return this.request<MinaRailStatus>('/mina-rail/status');
  }

  /**
   * Get epoch state.
   */
  async getEpochState(epoch?: number): Promise<MinaRailEpochState> {
    const path = epoch !== undefined 
      ? `/mina-rail/epoch/${epoch}/state`
      : '/mina-rail/epoch/current/state';
    return this.request<MinaRailEpochState>(path);
  }

  /**
   * Get epoch proof.
   */
  async getEpochProof(epoch: number): Promise<GetEpochProofResponse> {
    return this.request<GetEpochProofResponse>(`/mina-rail/epoch/${epoch}/proof`);
  }

  /**
   * Submit a tachystamp for aggregation.
   */
  async submitTachystamp(request: SubmitTachystampRequest): Promise<SubmitTachystampResponse> {
    return this.request<SubmitTachystampResponse>('/mina-rail/tachystamp/submit', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  /**
   * Get holder's tachystamp history.
   */
  async getHolderHistory(holderCommitment: string): Promise<HolderTachystampHistory> {
    return this.request<HolderTachystampHistory>(
      `/mina-rail/holder/${encodeURIComponent(holderCommitment)}/history`
    );
  }

  /**
   * Verify an epoch proof.
   */
  async verifyEpochProof(epoch: number, proof: MinaRailEpochProof): Promise<EpochVerificationResult> {
    return this.request<EpochVerificationResult>(`/mina-rail/epoch/${epoch}/verify`, {
      method: 'POST',
      body: JSON.stringify({ proof }),
    });
  }

  /**
   * Get tachystamp by ID.
   */
  async getTachystamp(tachystampId: string): Promise<Tachystamp | null> {
    try {
      return await this.request<Tachystamp>(
        `/mina-rail/tachystamp/${encodeURIComponent(tachystampId)}`
      );
    } catch (err) {
      if (err instanceof MinaRailApiError && err.status === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Check if a nullifier has been used.
   */
  async isNullifierUsed(nullifier: string): Promise<boolean> {
    const response = await this.request<{ used: boolean }>(
      `/mina-rail/nullifier/${encodeURIComponent(nullifier)}/check`
    );
    return response.used;
  }

  /**
   * Get finalized epochs since a given epoch.
   */
  async getFinalizedEpochsSince(startEpoch: number): Promise<MinaRailEpochProof[]> {
    return this.request<MinaRailEpochProof[]>(
      `/mina-rail/epochs/finalized?since=${startEpoch}`
    );
  }

  /**
   * Subscribe to epoch finalization events (WebSocket).
   */
  subscribeToEpochEvents(
    onEpochFinalized: (proof: MinaRailEpochProof) => void,
    onError?: (error: Error) => void
  ): () => void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/mina-rail/ws/epochs';
    
    let ws: WebSocket | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let shouldReconnect = true;

    const connect = () => {
      if (!shouldReconnect) return;

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          console.log('[MinaRail] WebSocket connected');
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'epoch_finalized' && data.proof) {
              onEpochFinalized(data.proof);
            }
          } catch (err) {
            console.error('[MinaRail] Failed to parse WebSocket message:', err);
          }
        };

        ws.onerror = (event) => {
          console.error('[MinaRail] WebSocket error:', event);
          onError?.(new Error('WebSocket error'));
        };

        ws.onclose = () => {
          console.log('[MinaRail] WebSocket closed');
          if (shouldReconnect) {
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };
      } catch (err) {
        console.error('[MinaRail] Failed to create WebSocket:', err);
        if (shouldReconnect) {
          reconnectTimeout = setTimeout(connect, 5000);
        }
      }
    };

    connect();

    // Return unsubscribe function
    return () => {
      shouldReconnect = false;
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.close();
      }
    };
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...init.headers,
    };

    try {
      const response = await fetch(url, { ...init, headers });

      if (!response.ok) {
        const errorMessage = await this.parseErrorMessage(response);
        throw new MinaRailApiError(errorMessage, response.status);
      }

      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof MinaRailApiError) {
        throw err;
      }
      throw new MinaRailApiError(
        `Request to ${path} failed: ${(err as Error).message ?? 'unknown error'}`
      );
    }
  }

  private async parseErrorMessage(response: Response): Promise<string> {
    try {
      const payload = await response.json();
      if (typeof payload.error === 'string') return payload.error;
      if (typeof payload.message === 'string') return payload.message;
    } catch {
      // Ignore JSON parse errors
    }
    return `HTTP ${response.status}`;
  }
}

// Default singleton instance
let defaultClient: MinaRailClient | null = null;

export function getMinaRailClient(baseUrl?: string): MinaRailClient {
  if (!defaultClient || baseUrl) {
    defaultClient = new MinaRailClient(baseUrl);
  }
  return defaultClient;
}

