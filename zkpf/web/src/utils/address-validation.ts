/**
 * Address Validation Utilities for Omni Bridge
 * 
 * Provides validation for addresses on all supported chains:
 * - NEAR Protocol
 * - Ethereum/EVM chains (Ethereum, Arbitrum, Base)
 * - Solana
 */

import type { ChainId } from '../contexts/BridgeContext';

// ============================================================================
// Types
// ============================================================================

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  normalized?: string;
}

export type AddressValidator = (address: string) => ValidationResult;

// ============================================================================
// NEAR Validation
// ============================================================================

const NEAR_ACCOUNT_REGEX = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const NEAR_IMPLICIT_REGEX = /^[0-9a-f]{64}$/;
const NEAR_MIN_LENGTH = 2;
const NEAR_MAX_LENGTH = 64;

export function validateNearAddress(address: string): ValidationResult {
  const trimmed = address.trim().toLowerCase();
  
  if (!trimmed) {
    return { isValid: false, error: 'Address is required' };
  }
  
  // Check implicit account (64 hex chars)
  if (NEAR_IMPLICIT_REGEX.test(trimmed)) {
    return { isValid: true, normalized: trimmed };
  }
  
  // Check length
  if (trimmed.length < NEAR_MIN_LENGTH) {
    return { isValid: false, error: `NEAR account must be at least ${NEAR_MIN_LENGTH} characters` };
  }
  
  if (trimmed.length > NEAR_MAX_LENGTH) {
    return { isValid: false, error: `NEAR account cannot exceed ${NEAR_MAX_LENGTH} characters` };
  }
  
  // Check format
  if (!NEAR_ACCOUNT_REGEX.test(trimmed)) {
    return { 
      isValid: false, 
      error: 'NEAR account can only contain lowercase letters, numbers, hyphens, and underscores' 
    };
  }
  
  // Must end with known TLDs for mainnet (.near) or testnet (.testnet)
  // Allow any valid format for flexibility
  return { isValid: true, normalized: trimmed };
}

// ============================================================================
// Ethereum/EVM Validation
// ============================================================================

const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function validateEthAddress(address: string): ValidationResult {
  const trimmed = address.trim();
  
  if (!trimmed) {
    return { isValid: false, error: 'Address is required' };
  }
  
  if (!ETH_ADDRESS_REGEX.test(trimmed)) {
    return { 
      isValid: false, 
      error: 'Invalid Ethereum address. Must be 0x followed by 40 hexadecimal characters' 
    };
  }
  
  // Normalize to checksummed address
  const normalized = toChecksumAddress(trimmed);
  
  return { isValid: true, normalized };
}

// EIP-55 checksum implementation
function toChecksumAddress(address: string): string {
  const addr = address.toLowerCase().replace('0x', '');
  // Simple hash - in production use keccak256
  const hash = simpleHash(addr);
  
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    const char = addr[i];
    const hashChar = parseInt(hash[i], 16);
    checksummed += hashChar >= 8 ? char.toUpperCase() : char;
  }
  
  return checksummed;
}

// Simple hash function for checksum (use keccak256 in production)
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  // Convert to hex and pad
  const hex = Math.abs(hash).toString(16);
  return hex.padStart(40, '0').slice(0, 40);
}

// ============================================================================
// Solana Validation
// ============================================================================

const SOLANA_ADDRESS_LENGTH = 44;
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // Base58 characters

export function validateSolanaAddress(address: string): ValidationResult {
  const trimmed = address.trim();
  
  if (!trimmed) {
    return { isValid: false, error: 'Address is required' };
  }
  
  // Check length (usually 32-44 characters)
  if (trimmed.length < 32 || trimmed.length > SOLANA_ADDRESS_LENGTH) {
    return { 
      isValid: false, 
      error: 'Invalid Solana address length. Must be 32-44 characters' 
    };
  }
  
  // Check Base58 format (no 0, O, I, l characters)
  if (!SOLANA_ADDRESS_REGEX.test(trimmed)) {
    return { 
      isValid: false, 
      error: 'Invalid Solana address. Must be a valid Base58 string' 
    };
  }
  
  return { isValid: true, normalized: trimmed };
}

// ============================================================================
// Chain-Specific Validation
// ============================================================================

const validators: Record<ChainId, AddressValidator> = {
  near: validateNearAddress,
  ethereum: validateEthAddress,
  arbitrum: validateEthAddress,
  base: validateEthAddress,
  solana: validateSolanaAddress,
};

export function validateAddress(chainId: ChainId, address: string): ValidationResult {
  const validator = validators[chainId];
  if (!validator) {
    return { isValid: false, error: `Unknown chain: ${chainId}` };
  }
  return validator(address);
}

// ============================================================================
// OmniAddress Utilities
// ============================================================================

const CHAIN_PREFIXES: Record<ChainId, string> = {
  near: 'near',
  ethereum: 'eth',
  arbitrum: 'arb',
  base: 'base',
  solana: 'sol',
};

const PREFIX_TO_CHAIN: Record<string, ChainId> = {
  near: 'near',
  eth: 'ethereum',
  arb: 'arbitrum',
  base: 'base',
  sol: 'solana',
};

/**
 * Create an OmniAddress from chain ID and address
 * Format: `chain:address` (e.g., "eth:0x1234...", "near:alice.near")
 */
export function createOmniAddress(chainId: ChainId, address: string): string {
  const validation = validateAddress(chainId, address);
  if (!validation.isValid) {
    throw new Error(validation.error || 'Invalid address');
  }
  
  const prefix = CHAIN_PREFIXES[chainId];
  return `${prefix}:${validation.normalized || address}`;
}

/**
 * Parse an OmniAddress into chain ID and address
 */
export function parseOmniAddress(omniAddress: string): { chainId: ChainId; address: string } | null {
  const match = omniAddress.match(/^([a-z]+):(.+)$/);
  if (!match) {
    return null;
  }
  
  const [, prefix, address] = match;
  const chainId = PREFIX_TO_CHAIN[prefix];
  
  if (!chainId) {
    return null;
  }
  
  return { chainId, address };
}

/**
 * Validate an OmniAddress
 */
export function validateOmniAddress(omniAddress: string): ValidationResult {
  const parsed = parseOmniAddress(omniAddress);
  
  if (!parsed) {
    return { isValid: false, error: 'Invalid OmniAddress format. Expected: chain:address' };
  }
  
  return validateAddress(parsed.chainId, parsed.address);
}

// ============================================================================
// Address Formatting
// ============================================================================

/**
 * Truncate an address for display
 */
export function truncateAddress(address: string, startChars = 6, endChars = 4): string {
  if (address.length <= startChars + endChars + 3) {
    return address;
  }
  return `${address.slice(0, startChars)}...${address.slice(-endChars)}`;
}

/**
 * Get placeholder text for address input
 */
export function getAddressPlaceholder(chainId: ChainId): string {
  const placeholders: Record<ChainId, string> = {
    near: 'e.g., alice.near or 64 hex chars',
    ethereum: 'e.g., 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    arbitrum: 'e.g., 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    base: 'e.g., 0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
    solana: 'e.g., 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  };
  return placeholders[chainId] || 'Enter address';
}

/**
 * Get explorer URL for an address
 */
export function getAddressExplorerUrl(
  chainId: ChainId, 
  address: string, 
  network: 'mainnet' | 'testnet' = 'mainnet'
): string {
  const explorers: Record<string, Record<string, string>> = {
    mainnet: {
      near: 'https://nearblocks.io/address/',
      ethereum: 'https://etherscan.io/address/',
      arbitrum: 'https://arbiscan.io/address/',
      base: 'https://basescan.org/address/',
      solana: 'https://solscan.io/account/',
    },
    testnet: {
      near: 'https://testnet.nearblocks.io/address/',
      ethereum: 'https://sepolia.etherscan.io/address/',
      arbitrum: 'https://sepolia.arbiscan.io/address/',
      base: 'https://sepolia.basescan.org/address/',
      solana: 'https://solscan.io/account/?cluster=devnet/',
    },
  };
  
  const baseUrl = explorers[network][chainId];
  return baseUrl ? `${baseUrl}${address}` : '#';
}

export default {
  validateAddress,
  validateNearAddress,
  validateEthAddress,
  validateSolanaAddress,
  createOmniAddress,
  parseOmniAddress,
  validateOmniAddress,
  truncateAddress,
  getAddressPlaceholder,
  getAddressExplorerUrl,
};

