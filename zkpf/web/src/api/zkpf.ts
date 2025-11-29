import type {
  AttestRequest,
  AttestResponse,
  EpochResponse,
  ParamsResponse,
  PoliciesResponse,
  PolicyDefinition,
  PolicyComposeRequest,
  PolicyComposeResponse,
  ProofBundle,
  VerifyRequest,
  VerifyResponse,
  ByteArray,
  ProviderSessionSnapshot,
  ZashiSessionStartResponse,
} from '../types/zkpf';
import type {
  PcdInitRequest,
  PcdInitResponse,
  PcdUpdateRequest,
  PcdUpdateResponse,
  PcdVerifyRequest,
  PcdVerifyResponse,
} from '../types/pcd';
import { toUint8Array } from '../utils/bytes';

const LOCAL_FALLBACK_BASE = 'http://localhost:3000';

export class ApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class ZkpfClient {
  private readonly base: string;
  private readonly artifactCache = new Map<
    string,
    { params: ByteArray | Uint8Array; vk: ByteArray | Uint8Array; pk: ByteArray | Uint8Array }
  >();

  constructor(baseUrl: string) {
    this.base = sanitizeBaseUrl(baseUrl);
  }

  get baseUrl() {
    return this.base;
  }

  async getParams(): Promise<ParamsResponse> {
    const payload = await this.request<
      ParamsResponse & {
        params?: ByteArray | Uint8Array;
        vk?: ByteArray | Uint8Array;
        pk?: ByteArray | Uint8Array;
        artifact_urls?: {
          params: string;
          vk: string;
          pk: string;
        };
      }
    >('/zkpf/params');

    const cacheKey = `${payload.params_hash}:${payload.pk_hash}:${payload.vk_hash}`;
    const artifactUrls =
      payload.artifact_urls ?? {
        params: '/zkpf/artifacts/params',
        vk: '/zkpf/artifacts/vk',
        pk: '/zkpf/artifacts/pk',
      };

    if (payload.params && payload.pk) {
      // Persist inline artifacts in the cache so callers can hydrate the WASM
      // runtime once and release the JS copies immediately afterwards.
      this.artifactCache.set(cacheKey, {
        params: toUint8Array(payload.params),
        vk: payload.vk ? toUint8Array(payload.vk) : new Uint8Array(),
        pk: toUint8Array(payload.pk),
      });
    }

    return {
      circuit_version: payload.circuit_version,
      manifest_version: payload.manifest_version,
      params_hash: payload.params_hash,
      vk_hash: payload.vk_hash,
      pk_hash: payload.pk_hash,
      artifact_urls: artifactUrls,
    };
  }

  async loadArtifactsForKey(
    cacheKey: string,
    urls?: {
      params: string;
      vk: string;
      pk: string;
    },
  ): Promise<{ params: Uint8Array; pk: Uint8Array; vk?: Uint8Array }> {
    const cached = this.artifactCache.get(cacheKey);
    if (cached?.params && cached?.pk) {
      return {
        params: toUint8Array(cached.params),
        pk: toUint8Array(cached.pk),
        vk: cached.vk ? toUint8Array(cached.vk) : undefined,
      };
    }
    if (!urls) {
      throw new Error(
        'Client-side proof generation is not available on this deployment. ' +
        'The proving key (pk.bin) is not hosted. Please use the Zashi wallet flow or contact support.'
      );
    }
    const [paramsBytes, pkBytes] = await Promise.all([
      this.downloadArtifact(urls.params),
      this.downloadArtifact(urls.pk),
    ]);
    const vkBytes = urls.vk ? await this.downloadArtifact(urls.vk) : cached?.vk ? toUint8Array(cached.vk) : undefined;
    this.artifactCache.set(cacheKey, {
      params: paramsBytes,
      pk: pkBytes,
      vk: vkBytes ?? new Uint8Array(),
    });
    return { params: paramsBytes, pk: pkBytes, vk: vkBytes };
  }

  releaseArtifacts(cacheKey: string) {
    this.artifactCache.delete(cacheKey);
  }

  private async downloadArtifact(pathOrUrl: string): Promise<Uint8Array> {
    const url =
      pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
        ? pathOrUrl
        : `${this.base}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(
          `Artifact not available: ${pathOrUrl}. ` +
          'The proving key may not be hosted on this deployment. ' +
          'Please use the Zashi wallet flow for proof generation.'
        );
      }
      throw new Error(`Failed to download artifact from ${url} (HTTP ${response.status})`);
    }
    const buffer = await response.arrayBuffer();
    // Return a Uint8Array view directly instead of materializing a gigantic
    // `number[]`. The proving key is hundreds of MB; converting it to a JS
    // array would blow the heap and is unnecessary for callers that only need
    // a byte view to feed into WASM or download helpers.
    return new Uint8Array(buffer);
  }

  async getEpoch(): Promise<EpochResponse> {
    return this.request<EpochResponse>('/zkpf/epoch');
  }

  async getPolicies(): Promise<PolicyDefinition[]> {
    const response = await this.request<PoliciesResponse>('/zkpf/policies');
    return response.policies;
  }

  async composePolicy(payload: PolicyComposeRequest): Promise<PolicyComposeResponse> {
    return this.request<PolicyComposeResponse>('/zkpf/policies/compose', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async verifyProof(payload: VerifyRequest): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('/zkpf/verify', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async verifyBundle(policyId: number, bundle: ProofBundle): Promise<VerifyResponse> {
    return this.request<VerifyResponse>('/zkpf/verify-bundle', {
      method: 'POST',
      body: JSON.stringify({ policy_id: policyId, bundle }),
    });
  }

  async attestOnChain(payload: AttestRequest): Promise<AttestResponse> {
    return this.request<AttestResponse>('/zkpf/attest', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async startZashiSession(policyId: number, deepLinkScheme?: string): Promise<ZashiSessionStartResponse> {
    const body: Record<string, unknown> = { policy_id: policyId };
    if (deepLinkScheme?.trim()) {
      body.deep_link_scheme = deepLinkScheme.trim();
    }
    return this.request<ZashiSessionStartResponse>('/zkpf/zashi/session/start', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getZashiSession(sessionId: string): Promise<ProviderSessionSnapshot> {
    return this.request<ProviderSessionSnapshot>(`/zkpf/zashi/session/${encodeURIComponent(sessionId)}`);
  }

  // ============================================================
  // PCD (Proof-Carrying Data) Methods
  // ============================================================

  /**
   * Initialize a new PCD chain from genesis.
   * This creates the first proof in the chain.
   */
  async pcdInit(initialNotes: PcdInitRequest['initial_notes'] = []): Promise<PcdInitResponse> {
    return this.request<PcdInitResponse>('/zkpf/pcd/init', {
      method: 'POST',
      body: JSON.stringify({ initial_notes: initialNotes }),
    });
  }

  /**
   * Update PCD state with new block data.
   * This implements the two-step recursive approach:
   * 1. Verifies the previous proof off-chain
   * 2. Generates a new proof referencing S_prev as trusted
   */
  async pcdUpdate(payload: PcdUpdateRequest): Promise<PcdUpdateResponse> {
    return this.request<PcdUpdateResponse>('/zkpf/pcd/update', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Verify a PCD state and its proof chain.
   */
  async pcdVerify(pcdState: PcdVerifyRequest['pcd_state']): Promise<PcdVerifyResponse> {
    return this.request<PcdVerifyResponse>('/zkpf/pcd/verify', {
      method: 'POST',
      body: JSON.stringify({ pcd_state: pcdState }),
    });
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.base}${path}`;
    const headers: HeadersInit = {
      'content-type': 'application/json',
      ...init.headers,
    };
    try {
      const response = await fetch(url, { ...init, headers });
      if (!response.ok) {
        const message = await safeParseError(response);
        throw new ApiError(message, response.status);
      }
      return (await response.json()) as T;
    } catch (err) {
      if (err instanceof ApiError) {
        throw err;
      }
      throw new ApiError(
        `Request to ${path} failed: ${(err as Error).message ?? 'unknown error'}`,
      );
    }
  }
}

async function safeParseError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload.error === 'string') {
      return payload.error;
    }
    if (typeof payload.message === 'string') {
      return payload.message;
    }
  } catch {
    // ignore JSON parse errors
  }
  return `HTTP ${response.status}`;
}

export function detectDefaultBase(): string {
  const envBase = import.meta.env.VITE_ZKPF_API_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    return sanitizeBaseUrl(envBase);
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return sanitizeBaseUrl(window.location.origin);
  }
  return LOCAL_FALLBACK_BASE;
}

export function sanitizeBaseUrl(url: string): string {
  if (!url) {
    return LOCAL_FALLBACK_BASE;
  }
  const trimmed = url.trim();
  if (!trimmed) {
    return LOCAL_FALLBACK_BASE;
  }
  return trimmed.endsWith('/') ? trimmed.slice(0, -1) : trimmed;
}
