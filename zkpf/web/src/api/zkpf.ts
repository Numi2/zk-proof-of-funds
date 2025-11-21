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

  constructor(baseUrl: string) {
    this.base = sanitizeBaseUrl(baseUrl);
  }

  get baseUrl() {
    return this.base;
  }

  async getParams(): Promise<ParamsResponse> {
    return this.request<ParamsResponse>('/zkpf/params');
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

