// Shareable Proof Utilities
// Create, encode, decode, and verify shareable proof links

import type { ZKPassportPolicyDefinition, ZKPassportPolicyQuery } from '../types/zkpassport';

/**
 * A shareable proof bundle containing all data needed for independent verification
 */
export interface ShareableProofBundle {
  /** Version for forward compatibility */
  version: 1;
  /** Unique identifier for this proof */
  proofId: string;
  /** Timestamp when the proof was generated */
  timestamp: number;
  /** The policy that was verified against */
  policy: {
    id: number | null;
    label: string;
    purpose: string;
    scope?: string;
    validity?: number;
    devMode?: boolean;
    query: ZKPassportPolicyQuery;
  };
  /** The ZKPassport proofs */
  proofs: ProofData[];
  /** Query result from ZKPassport verification */
  queryResult: any;
  /** Unique identifier from ZKPassport SDK */
  uniqueIdentifier?: string;
  /** Request ID for reference */
  requestId: string;
  /** Duration of the verification process in ms */
  duration?: number;
  /** Optional metadata */
  metadata?: {
    domain?: string;
    userAgent?: string;
    note?: string;
  };
}

export interface ProofData {
  name: string;
  version: string;
  proof: any;
  publicInputs?: any;
  vkeyHash?: string;
  index?: number;
  total?: number;
}

/**
 * Summary of what was verified in the proof
 */
export interface ProofVerificationSummary {
  verified: boolean;
  policyLabel: string;
  timestamp: number;
  expiresAt?: number;
  checks: {
    name: string;
    passed: boolean;
    details?: string;
  }[];
  disclosedData?: Record<string, any>;
}

// Storage key for locally saved proofs
const PROOFS_STORAGE_KEY = 'zkpassport_shareable_proofs';

/**
 * Create a shareable proof bundle from verification state
 */
export function createShareableProof(params: {
  policy: ZKPassportPolicyDefinition | null;
  proofs: any[];
  queryResult: any;
  uniqueIdentifier?: string;
  requestId: string;
  duration?: number;
  note?: string;
}): ShareableProofBundle {
  const { policy, proofs, queryResult, uniqueIdentifier, requestId, duration, note } = params;
  
  return {
    version: 1,
    proofId: generateProofId(),
    timestamp: Date.now(),
    policy: {
      id: policy?.policy_id ?? null,
      label: policy?.label ?? 'Custom Verification',
      purpose: policy?.purpose ?? 'Identity verification',
      scope: policy?.scope,
      validity: policy?.validity,
      devMode: policy?.devMode,
      query: policy?.query ?? {},
    },
    proofs: proofs.map(p => ({
      name: p.name,
      version: p.version,
      proof: p.proof,
      publicInputs: p.publicInputs,
      vkeyHash: p.vkeyHash,
      index: p.index,
      total: p.total,
    })),
    queryResult,
    uniqueIdentifier,
    requestId,
    duration,
    metadata: {
      domain: typeof window !== 'undefined' ? window.location.origin : undefined,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      note,
    },
  };
}

/**
 * Encode a shareable proof bundle to a URL-safe string
 */
export function encodeShareableProof(bundle: ShareableProofBundle): string {
  const json = JSON.stringify(bundle);
  // Use base64url encoding (URL-safe base64)
  const base64 = btoa(unescape(encodeURIComponent(json)));
  // Make it URL-safe
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a URL-safe string back to a shareable proof bundle
 */
export function decodeShareableProof(encoded: string): ShareableProofBundle {
  // Restore base64 from URL-safe encoding
  let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  // Add back padding if needed
  while (base64.length % 4) {
    base64 += '=';
  }
  
  const json = decodeURIComponent(escape(atob(base64)));
  const bundle = JSON.parse(json) as ShareableProofBundle;
  
  // Validate version
  if (bundle.version !== 1) {
    throw new Error(`Unsupported proof bundle version: ${bundle.version}`);
  }
  
  // Validate required fields
  if (!bundle.proofId || !bundle.timestamp || !bundle.proofs || !bundle.queryResult) {
    throw new Error('Invalid proof bundle: missing required fields');
  }
  
  return bundle;
}

/**
 * Create a shareable URL for a proof bundle
 */
export function createShareableUrl(bundle: ShareableProofBundle, baseUrl?: string): string {
  const encoded = encodeShareableProof(bundle);
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/zkpassport/verify/shared?proof=${encoded}`;
}

/**
 * Create a short shareable URL using a proof ID (requires storing the proof)
 */
export function createShortShareableUrl(bundle: ShareableProofBundle, baseUrl?: string): string {
  // Store the proof for later retrieval
  saveProofToStorage(bundle);
  const base = baseUrl ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/zkpassport/verify/shared?id=${bundle.proofId}`;
}

/**
 * Extract proof data from a URL (either encoded proof or proof ID)
 */
export function extractProofFromUrl(url: string): { type: 'encoded' | 'id'; value: string } | null {
  try {
    const urlObj = new URL(url);
    const proof = urlObj.searchParams.get('proof');
    const id = urlObj.searchParams.get('id');
    
    if (proof) {
      return { type: 'encoded', value: proof };
    }
    if (id) {
      return { type: 'id', value: id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Parse URL search params for proof data
 */
export function parseProofFromSearchParams(searchParams: URLSearchParams): ShareableProofBundle | null {
  const encoded = searchParams.get('proof');
  const id = searchParams.get('id');
  
  if (encoded) {
    try {
      return decodeShareableProof(encoded);
    } catch (e) {
      console.error('Failed to decode proof:', e);
      return null;
    }
  }
  
  if (id) {
    return getProofFromStorage(id);
  }
  
  return null;
}

/**
 * Generate a unique proof ID
 */
function generateProofId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `zkp-${timestamp}-${random}`;
}

// Local storage utilities for short URLs

/**
 * Save a proof bundle to local storage
 */
export function saveProofToStorage(bundle: ShareableProofBundle): void {
  try {
    const stored = getStoredProofs();
    stored[bundle.proofId] = bundle;
    
    // Limit storage to 50 most recent proofs
    const proofIds = Object.keys(stored);
    if (proofIds.length > 50) {
      const sorted = proofIds
        .map(id => ({ id, timestamp: stored[id].timestamp }))
        .sort((a, b) => b.timestamp - a.timestamp);
      
      const toRemove = sorted.slice(50);
      for (const { id } of toRemove) {
        delete stored[id];
      }
    }
    
    localStorage.setItem(PROOFS_STORAGE_KEY, JSON.stringify(stored));
  } catch (e) {
    console.error('Failed to save proof to storage:', e);
  }
}

/**
 * Get a proof bundle from local storage by ID
 */
export function getProofFromStorage(proofId: string): ShareableProofBundle | null {
  const stored = getStoredProofs();
  return stored[proofId] || null;
}

/**
 * Get all stored proofs
 */
export function getStoredProofs(): Record<string, ShareableProofBundle> {
  try {
    const stored = localStorage.getItem(PROOFS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

/**
 * Delete a proof from storage
 */
export function deleteProofFromStorage(proofId: string): boolean {
  try {
    const stored = getStoredProofs();
    if (proofId in stored) {
      delete stored[proofId];
      localStorage.setItem(PROOFS_STORAGE_KEY, JSON.stringify(stored));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Generate a summary of the proof verification
 */
export function generateProofSummary(bundle: ShareableProofBundle): ProofVerificationSummary {
  const checks: ProofVerificationSummary['checks'] = [];
  const disclosedData: Record<string, any> = {};
  const result = bundle.queryResult;
  
  // Check age verification
  if (result.age) {
    if (result.age.gte) {
      checks.push({
        name: 'Age ≥ ' + result.age.gte.expected,
        passed: result.age.gte.result === true,
        details: `Age verification: ${result.age.gte.result ? 'passed' : 'failed'}`,
      });
    }
    if (result.age.lte) {
      checks.push({
        name: 'Age ≤ ' + result.age.lte.expected,
        passed: result.age.lte.result === true,
        details: `Age verification: ${result.age.lte.result ? 'passed' : 'failed'}`,
      });
    }
    if (result.age.range) {
      checks.push({
        name: `Age in range ${result.age.range.expected}`,
        passed: result.age.range.result === true,
      });
    }
  }
  
  // Check nationality
  if (result.nationality) {
    if (result.nationality.in) {
      checks.push({
        name: 'Nationality allowed',
        passed: result.nationality.in.result === true,
        details: `Must be from: ${result.nationality.in.expected?.join(', ') || 'specified countries'}`,
      });
    }
    if (result.nationality.out) {
      checks.push({
        name: 'Nationality not restricted',
        passed: result.nationality.out.result === true,
        details: `Must not be from: ${result.nationality.out.expected?.join(', ') || 'restricted countries'}`,
      });
    }
    if (result.nationality.disclose?.result !== undefined) {
      disclosedData.nationality = result.nationality.disclose.result;
    }
  }
  
  // Check document expiry
  if (result.expiry_date?.gte) {
    checks.push({
      name: 'Document valid',
      passed: result.expiry_date.gte.result === true,
      details: 'Document has not expired',
    });
  }
  
  // Collect disclosed data
  const disclosureFields = [
    'firstname', 'lastname', 'fullname', 'birthdate',
    'document_number', 'document_type', 'issuing_country', 'gender'
  ];
  
  for (const field of disclosureFields) {
    if (result[field]?.disclose?.result !== undefined) {
      disclosedData[field] = result[field].disclose.result;
    }
  }
  
  // Calculate expiry
  const expiresAt = bundle.policy.validity 
    ? bundle.timestamp + (bundle.policy.validity * 1000)
    : undefined;
  
  const allPassed = checks.every(c => c.passed);
  
  return {
    verified: allPassed && bundle.proofs.length > 0,
    policyLabel: bundle.policy.label,
    timestamp: bundle.timestamp,
    expiresAt,
    checks,
    disclosedData: Object.keys(disclosedData).length > 0 ? disclosedData : undefined,
  };
}

/**
 * Check if a proof bundle has expired based on policy validity
 */
export function isProofExpired(bundle: ShareableProofBundle): boolean {
  if (!bundle.policy.validity) {
    return false; // No expiry set
  }
  const expiresAt = bundle.timestamp + (bundle.policy.validity * 1000);
  return Date.now() > expiresAt;
}

/**
 * Format proof bundle as a downloadable JSON file
 */
export function formatProofAsJson(bundle: ShareableProofBundle): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Copy proof URL to clipboard
 */
export async function copyProofUrlToClipboard(bundle: ShareableProofBundle, useShortUrl: boolean = false): Promise<boolean> {
  try {
    const url = useShortUrl 
      ? createShortShareableUrl(bundle) 
      : createShareableUrl(bundle);
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    return false;
  }
}

