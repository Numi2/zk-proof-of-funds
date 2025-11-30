/**
 * Omni Bridge API Client
 * 
 * Provides typed API calls to the Omni Bridge backend service.
 */

const API_BASE = import.meta.env.VITE_OMNI_BRIDGE_API || '/api/rails/omni';

// ============================================================================
// Types
// ============================================================================

export interface ChainInfo {
  chainId: string;
  name: string;
  symbol: string;
  nativeCurrency: string;
  productionReady: boolean;
  finalitySecs: number;
  blockTimeSecs?: number;
  capabilities?: string[];
}

export interface TokenInfo {
  symbol: string;
  name: string;
  decimals: number;
  isStablecoin: boolean;
  logoUrl?: string;
  coingeckoId?: string;
  chainAddresses?: Record<string, string>;
  availableChains?: string[];
}

export interface TransferRequest {
  sourceChain: string;
  destinationChain: string;
  sender: string;
  recipient: string;
  token: string;
  amount: string;
  memo?: string;
  fastMode?: boolean;
}

export interface TransferResponse {
  transferId: string;
  status: string;
  estimatedCompletion?: number;
  estimatedFee?: {
    amount: string;
    currency: string;
  };
}

export interface TransferStatus {
  transferId: string;
  status: string;
  sourceChain: string;
  destinationChain: string;
  amount: string;
  asset: string;
  createdAt: number;
  completedAt?: number;
  sourceTxHash?: string;
  destinationTxHash?: string;
  error?: string;
}

export interface FeeEstimateRequest {
  sourceChain: string;
  destinationChain: string;
  token: string;
  amount: string;
  fastMode?: boolean;
}

export interface FeeEstimate {
  amount: string;
  currency: string;
  recipient?: string;
}

export interface ProveAssetsRequest {
  chain: string;
  address: string;
  tokens: string[];
}

export interface AssetProof {
  chain: string;
  holderAddress: string;
  proofHash: string;
  blockNumber: number;
  timestamp: number;
  assets: { symbol: string; balance: string }[];
}

export interface AttestationRequest {
  holderId: string;
  sourceChain: string;
  destinationChain: string;
  address: string;
  tokens: string[];
}

export interface Attestation {
  attestationId: string;
  holderBinding: string;
  sourceChain: string;
  targetChain: string;
  attestedAt: number;
  expiresAt: number;
  isValid: boolean;
  encoded: string;
}

export interface BridgeInfo {
  railId: string;
  version: number;
  network: string;
  enabled: boolean;
  capabilities: string[];
  supportedChains: string[];
}

// ============================================================================
// API Client
// ============================================================================

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `API error: ${response.status}`);
  }
  return response.json();
}

export const omniBridgeApi = {
  // Info
  async getInfo(): Promise<BridgeInfo> {
    const response = await fetch(`${API_BASE}/info`);
    return handleResponse(response);
  },

  // Chains
  async getChains(): Promise<{ chains: ChainInfo[] }> {
    const response = await fetch(`${API_BASE}/chains`);
    return handleResponse(response);
  },

  async getChain(chainId: string): Promise<ChainInfo> {
    const response = await fetch(`${API_BASE}/chains/${chainId}`);
    return handleResponse(response);
  },

  // Tokens
  async getTokens(): Promise<{ tokens: TokenInfo[] }> {
    const response = await fetch(`${API_BASE}/tokens`);
    return handleResponse(response);
  },

  async getToken(symbol: string): Promise<TokenInfo> {
    const response = await fetch(`${API_BASE}/tokens/${symbol}`);
    return handleResponse(response);
  },

  // Transfers
  async initiateTransfer(request: TransferRequest): Promise<TransferResponse> {
    const response = await fetch(`${API_BASE}/transfer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_chain: request.sourceChain,
        destination_chain: request.destinationChain,
        sender: request.sender,
        recipient: request.recipient,
        token: request.token,
        amount: request.amount,
        memo: request.memo,
        fast_mode: request.fastMode,
      }),
    });
    return handleResponse(response);
  },

  async getTransfer(transferId: string): Promise<TransferStatus> {
    const response = await fetch(`${API_BASE}/transfer/${transferId}`);
    return handleResponse(response);
  },

  async getTransfers(): Promise<{ transfers: TransferStatus[] }> {
    const response = await fetch(`${API_BASE}/transfers`);
    return handleResponse(response);
  },

  // Fee Estimation
  async estimateFee(request: FeeEstimateRequest): Promise<FeeEstimate> {
    const response = await fetch(`${API_BASE}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source_chain: request.sourceChain,
        destination_chain: request.destinationChain,
        token: request.token,
        amount: request.amount,
        fast_mode: request.fastMode,
      }),
    });
    return handleResponse(response);
  },

  // Proofs
  async proveAssets(request: ProveAssetsRequest): Promise<AssetProof> {
    const response = await fetch(`${API_BASE}/prove-assets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chain: request.chain,
        address: request.address,
        tokens: request.tokens,
      }),
    });
    return handleResponse(response);
  },

  async createAttestation(request: AttestationRequest): Promise<Attestation> {
    const response = await fetch(`${API_BASE}/attestation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        holder_id: request.holderId,
        source_chain: request.sourceChain,
        destination_chain: request.destinationChain,
        address: request.address,
        tokens: request.tokens,
      }),
    });
    return handleResponse(response);
  },
};

export default omniBridgeApi;

