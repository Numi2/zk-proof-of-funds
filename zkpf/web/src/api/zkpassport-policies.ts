import type {
  ZKPassportPolicyDefinition,
  ZKPassportPolicyComposeRequest,
  ZKPassportPolicyComposeResponse,
  ZKPassportPoliciesResponse,
} from '../types/zkpassport';

const STORAGE_KEY = 'zkpassport_policies';
const DEFAULT_BASE = 'http://localhost:3000';

export class ZKPassportPolicyError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class ZKPassportPolicyClient {
  private readonly base: string;
  private useLocalStorage: boolean;

  constructor(baseUrl?: string, useLocalStorage: boolean = true) {
    this.base = baseUrl ? sanitizeBaseUrl(baseUrl) : DEFAULT_BASE;
    this.useLocalStorage = useLocalStorage;
  }

  get baseUrl() {
    return this.base;
  }

  // Get all policies
  async getPolicies(): Promise<ZKPassportPolicyDefinition[]> {
    if (this.useLocalStorage) {
      return this.getPoliciesFromStorage();
    }

    try {
      const response = await fetch(`${this.base}/zkpassport/policies`);
      if (!response.ok) {
        throw new ZKPassportPolicyError(`Failed to fetch policies: ${response.statusText}`, response.status);
      }
      const data: ZKPassportPoliciesResponse = await response.json();
      return data.policies;
    } catch (error) {
      // Fallback to localStorage if API fails
      if (error instanceof TypeError) {
        return this.getPoliciesFromStorage();
      }
      throw error;
    }
  }

  // Get a single policy by ID
  async getPolicy(policyId: number): Promise<ZKPassportPolicyDefinition | null> {
    const policies = await this.getPolicies();
    return policies.find(p => p.policy_id === policyId) || null;
  }

  // Compose/create a policy
  async composePolicy(request: ZKPassportPolicyComposeRequest): Promise<ZKPassportPolicyComposeResponse> {
    if (this.useLocalStorage) {
      return this.composePolicyInStorage(request);
    }

    try {
      const response = await fetch(`${this.base}/zkpassport/policies`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ZKPassportPolicyError(`Failed to create policy: ${errorText}`, response.status);
      }

      return await response.json();
    } catch (error) {
      // Fallback to localStorage if API fails
      if (error instanceof TypeError) {
        return this.composePolicyInStorage(request);
      }
      throw error;
    }
  }

  // Delete a policy
  async deletePolicy(policyId: number): Promise<void> {
    if (this.useLocalStorage) {
      this.deletePolicyFromStorage(policyId);
      return;
    }

    try {
      const response = await fetch(`${this.base}/zkpassport/policies/${policyId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new ZKPassportPolicyError(`Failed to delete policy: ${response.statusText}`, response.status);
      }
    } catch (error) {
      if (error instanceof TypeError) {
        this.deletePolicyFromStorage(policyId);
        return;
      }
      throw error;
    }
  }

  // LocalStorage methods
  private getPoliciesFromStorage(): ZKPassportPolicyDefinition[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return [];
      }
      return JSON.parse(stored);
    } catch {
      return [];
    }
  }

  private composePolicyInStorage(request: ZKPassportPolicyComposeRequest): ZKPassportPolicyComposeResponse {
    const policies = this.getPoliciesFromStorage();
    const maxId = policies.length > 0 ? Math.max(...policies.map(p => p.policy_id)) : 0;
    const newPolicyId = maxId + 1;

    // Check if a similar policy already exists
    const existing = policies.find(p => 
      p.label === request.label &&
      JSON.stringify(p.query) === JSON.stringify(request.query)
    );

    if (existing) {
      return {
        policy: existing,
        summary: `Policy "${existing.label}" already exists (ID: ${existing.policy_id})`,
        created: false,
      };
    }

    const newPolicy: ZKPassportPolicyDefinition = {
      policy_id: newPolicyId,
      label: request.label,
      description: request.description,
      purpose: request.purpose,
      scope: request.scope,
      validity: request.validity,
      devMode: request.devMode ?? false,
      query: request.query,
      useCases: request.useCases || [],
      created_at: Date.now(),
      updated_at: Date.now(),
    };

    policies.push(newPolicy);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));

    return {
      policy: newPolicy,
      summary: `Policy "${newPolicy.label}" created with ID ${newPolicyId}`,
      created: true,
    };
  }

  private deletePolicyFromStorage(policyId: number): void {
    const policies = this.getPoliciesFromStorage();
    const filtered = policies.filter(p => p.policy_id !== policyId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  }
}

function sanitizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, '');
}

