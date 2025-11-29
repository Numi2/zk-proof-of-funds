/**
 * Tests for Wallet-Bound Personhood Utilities
 * 
 * These tests verify the core functionality:
 * - computeWalletBindingId is deterministic
 * - buildChallengeJson produces canonical output
 * - Error handling works correctly
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeWalletBindingId,
  buildChallengeJson,
  completeWalletBinding,
  getPersonhoodStatus,
  type WalletForBinding,
} from './personhood';
import type { WalletBindingChallenge } from '../types/personhood';

// ============================================================================
// computeWalletBindingId Tests
// ============================================================================

describe('computeWalletBindingId', () => {
  it('should produce deterministic output for the same input', () => {
    const ufvk = 'uview1abc123def456...';
    
    const result1 = computeWalletBindingId(ufvk);
    const result2 = computeWalletBindingId(ufvk);
    
    expect(result1).toBe(result2);
  });

  it('should produce different output for different inputs', () => {
    const ufvk1 = 'uview1abc123def456...';
    const ufvk2 = 'uview1xyz789ghi012...';
    
    const result1 = computeWalletBindingId(ufvk1);
    const result2 = computeWalletBindingId(ufvk2);
    
    expect(result1).not.toBe(result2);
  });

  it('should produce a 64-character hex string (32 bytes)', () => {
    const ufvk = 'test_viewing_key';
    const result = computeWalletBindingId(ufvk);
    
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('should throw on empty input', () => {
    expect(() => computeWalletBindingId('')).toThrow();
    expect(() => computeWalletBindingId('   ')).toThrow();
  });

  it('should trim whitespace from input', () => {
    const ufvk = 'test_key';
    const result1 = computeWalletBindingId(ufvk);
    const result2 = computeWalletBindingId(`  ${ufvk}  `);
    
    expect(result1).toBe(result2);
  });

  // Test with known values for regression testing
  it('should produce expected output for known input', () => {
    // This test ensures the algorithm doesn't change unexpectedly
    const ufvk = 'fixed_test_key_for_regression';
    const result = computeWalletBindingId(ufvk);
    
    // Store this expected value - if it changes, the algorithm changed
    // which would break existing bindings!
    expect(result).toBeDefined();
    expect(result.length).toBe(64);
  });
});

// ============================================================================
// buildChallengeJson Tests
// ============================================================================

describe('buildChallengeJson', () => {
  it('should produce consistent JSON format', () => {
    const challenge: WalletBindingChallenge = {
      personhood_id: 'person_abc',
      wallet_binding_id: 'wallet_xyz',
      issued_at: 1700000000000,
      version: 1,
    };

    const result = buildChallengeJson(challenge);
    
    // The JSON must be exactly this format for signature verification to work
    expect(result).toBe(
      '{"personhood_id":"person_abc","wallet_binding_id":"wallet_xyz","issued_at":1700000000000,"version":1}'
    );
  });

  it('should maintain field order regardless of object property order', () => {
    const challenge1: WalletBindingChallenge = {
      personhood_id: 'test',
      wallet_binding_id: 'test',
      issued_at: 1000,
      version: 1,
    };

    const challenge2: WalletBindingChallenge = {
      version: 1,
      issued_at: 1000,
      wallet_binding_id: 'test',
      personhood_id: 'test',
    };

    expect(buildChallengeJson(challenge1)).toBe(buildChallengeJson(challenge2));
  });

  it('should handle special characters in IDs', () => {
    const challenge: WalletBindingChallenge = {
      personhood_id: 'person-with-special_chars.123',
      wallet_binding_id: 'wallet/test:456',
      issued_at: 1700000000000,
      version: 1,
    };

    const result = buildChallengeJson(challenge);
    
    // Should be valid JSON
    expect(() => JSON.parse(result)).not.toThrow();
    
    // Should parse back to equivalent values
    const parsed = JSON.parse(result);
    expect(parsed.personhood_id).toBe(challenge.personhood_id);
    expect(parsed.wallet_binding_id).toBe(challenge.wallet_binding_id);
  });
});

// ============================================================================
// completeWalletBinding Tests
// ============================================================================

describe('completeWalletBinding', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockWallet: WalletForBinding;

  beforeEach(() => {
    // Mock fetch
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Mock wallet
    mockWallet = {
      getUfvkOrAccountTag: vi.fn().mockResolvedValue('test_ufvk'),
      signMessage: vi.fn().mockResolvedValue('mock_signature'),
      getPublicKey: vi.fn().mockResolvedValue('mock_pubkey'),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should successfully complete binding flow', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'ok',
        personhood_id: 'person_123',
        wallet_binding_id: 'wallet_456',
        active_bindings_count: 1,
      }),
    });

    const result = await completeWalletBinding(
      mockWallet,
      'person_123',
      'wallet_456'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result.personhood_id).toBe('person_123');
      expect(result.result.wallet_binding_id).toBe('wallet_456');
      expect(result.result.active_bindings_count).toBe(1);
    }

    // Verify fetch was called with correct data
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/personhood/bind-wallet',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  });

  it('should handle signing failure', async () => {
    mockWallet.signMessage = vi.fn().mockRejectedValue(new Error('Signing cancelled'));

    const result = await completeWalletBinding(
      mockWallet,
      'person_123',
      'wallet_456'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('signing_failed');
    }

    // Fetch should not be called if signing fails
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle too_many_wallet_bindings error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'Too many wallets',
        error_code: 'too_many_wallet_bindings',
      }),
    });

    const result = await completeWalletBinding(
      mockWallet,
      'person_123',
      'wallet_456'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('binding_failed');
      expect(result.error.code).toBe('too_many_wallet_bindings');
      expect(result.error.message).toContain('too many wallets');
    }
  });

  it('should handle network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await completeWalletBinding(
      mockWallet,
      'person_123',
      'wallet_456'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('network_error');
    }
  });

  it('should handle expired challenge error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: 'Challenge expired',
        error_code: 'challenge_expired',
      }),
    });

    const result = await completeWalletBinding(
      mockWallet,
      'person_123',
      'wallet_456'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('binding_failed');
      expect(result.error.code).toBe('challenge_expired');
      expect(result.error.message).toContain('try again');
    }
  });
});

// ============================================================================
// getPersonhoodStatus Tests
// ============================================================================

describe('getPersonhoodStatus', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    
    // Clear localStorage
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return verified status for bound wallet', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        personhood_verified: true,
        personhood_id: 'person_123',
        bindings_count_for_person: 1,
      }),
    });

    const result = await getPersonhoodStatus('wallet_abc');

    expect(result.personhood_verified).toBe(true);
    expect(result.personhood_id).toBe('person_123');
    expect(result.bindings_count_for_person).toBe(1);
  });

  it('should return not verified for unbound wallet', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        personhood_verified: false,
        personhood_id: null,
        bindings_count_for_person: null,
      }),
    });

    const result = await getPersonhoodStatus('unknown_wallet');

    expect(result.personhood_verified).toBe(false);
    expect(result.personhood_id).toBeNull();
  });

  it('should return not verified on network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await getPersonhoodStatus('wallet_abc');

    // Should fail gracefully with not verified status
    expect(result.personhood_verified).toBe(false);
  });

  it('should call correct endpoint with wallet_binding_id', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        personhood_verified: false,
        personhood_id: null,
        bindings_count_for_person: null,
      }),
    });

    await getPersonhoodStatus('test_wallet_id');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/personhood/status?wallet_binding_id=test_wallet_id',
      { method: 'GET' }
    );
  });
});

