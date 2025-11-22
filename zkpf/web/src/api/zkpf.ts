import type {
  AttestRequest,
  AttestResponse,
  EpochResponse,
  ParamsResponse,
  PoliciesResponse,
  PolicyDefinition,
  ProofBundle,
  VerifyRequest,
  VerifyResponse,
  ByteArray,
} from '../types/zkpf';

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
  private readonly artifactCache = new Map<string, { params: ByteArray; vk: ByteArray; pk: ByteArray }>();

  constructor(baseUrl: string) {
    this.base = sanitizeBaseUrl(baseUrl);
  }

  get baseUrl() {
    return this.base;
  }

  async getParams(): Promise<ParamsResponse> {
    const payload = await this.request<
      ParamsResponse & {
        params?: ByteArray;
        vk?: ByteArray;
        pk?: ByteArray;
        artifact_urls?: {
          params: string;
          vk: string;
          pk: string;
        };
      }
    >('/zkpf/params');

    if (payload.params && payload.vk && payload.pk) {
      return payload;
    }

    if (!payload.artifact_urls) {
      throw new Error('Params response missing artifact URLs and inline bytes.');
    }

    const cacheKey = `${payload.params_hash}:${payload.pk_hash}:${payload.vk_hash}`;
    if (this.artifactCache.has(cacheKey)) {
      const cached = this.artifactCache.get(cacheKey)!;
      return {
        ...payload,
        params: cached.params,
        vk: cached.vk,
        pk: cached.pk,
      };
    }

    const [paramsBytes, vkBytes, pkBytes] = await Promise.all([
      this.downloadArtifact(payload.artifact_urls.params),
      this.downloadArtifact(payload.artifact_urls.vk),
      this.downloadArtifact(payload.artifact_urls.pk),
    ]);

    const hydrated = {
      ...payload,
      params: paramsBytes,
      vk: vkBytes,
      pk: pkBytes,
    };
    this.artifactCache.set(cacheKey, {
      params: paramsBytes,
      vk: vkBytes,
      pk: pkBytes,
    });
    return hydrated;
  }

  private async downloadArtifact(pathOrUrl: string): Promise<Uint8Array> {
    const url =
      pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://')
        ? pathOrUrl
        : `${this.base}${pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`}`;
    const response = await fetch(url);
    if (!response.ok) {
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
