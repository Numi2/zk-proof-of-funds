/**
 * Asset ID Mapper for NEAR Intents SDK
 * 
 * Converts between ChainToken (UI format) and SDK asset identifiers.
 * 
 * SDK Asset ID Formats:
 * - NEP-141 tokens: `nep141:contract.near`
 * - NEP-245 multi-tokens: `nep245:contract.near:tokenId`
 * - Cross-chain assets: Various bridge formats
 */

import type { ChainToken } from './near-intents-quotes';

/**
 * Common NEAR token contract addresses
 */
const NEAR_TOKEN_CONTRACTS: Record<string, string> = {
  'NEAR': 'wrap.near', // Native NEAR wrapped
  'USDC': 'usdc.fakes.testnet', // Testnet - update for mainnet
  'USDT': 'usdt.tether-token.near',
  'DAI': 'dai.fakes.testnet',
  'ETH': 'aurora', // Aurora bridge
};

/**
 * Map chain identifiers to SDK-compatible chain names
 */
const CHAIN_ID_TO_SDK_CHAIN: Record<string, string> = {
  'near': 'near',
  'ethereum': 'ethereum',
  'arbitrum': 'arbitrum',
  'optimism': 'optimism',
  'base': 'base',
  'polygon': 'polygon',
  'solana': 'solana',
  'bitcoin': 'bitcoin',
  'zcash': 'zcash',
  'aurora': 'aurora',
  'gnosis': 'gnosis',
  'zksync': 'zksync',
};

/**
 * Convert ChainToken to SDK asset identifier.
 * 
 * @param token - ChainToken from UI
 * @param contractAddress - Optional contract address override
 * @returns SDK asset ID (e.g., "nep141:usdt.tether-token.near")
 */
export function chainTokenToAssetId(
  token: ChainToken,
  contractAddress?: string
): string {
  // For NEAR chain tokens, use NEP-141 format
  if (token.chainId === 'near') {
    const contract = contractAddress || NEAR_TOKEN_CONTRACTS[token.token] || `${token.token.toLowerCase()}.near`;
    
    // Handle native NEAR
    if (token.token === 'NEAR' && !contractAddress) {
      return 'nep141:wrap.near';
    }
    
    return `nep141:${contract}`;
  }

  // For multi-tokens (NEP-245), use that format
  // This would need tokenId parameter - for now, assume NEP-141
  if (contractAddress && contractAddress.includes(':')) {
    // Already in format like "nep245:contract.near:tokenId"
    return contractAddress;
  }

  // For cross-chain assets, construct based on bridge
  // Hot Bridge format: nep245:v2_1.omni.hot.tg:chainId_tokenId
  // PoA Bridge format: nep141:token-0xAddress.omft.near
  // Omni Bridge format: nep141:token.omdep.near

  // Default: try to construct NEP-141 format
  const chainName = token.chainId.toLowerCase();
  const tokenLower = token.token.toLowerCase();
  
  // For known cross-chain tokens, use appropriate format
  // This is simplified - in production, you'd have a registry
  if (contractAddress) {
    if (contractAddress.endsWith('.omft.near')) {
      // PoA Bridge
      return `nep141:${contractAddress}`;
    }
    if (contractAddress.endsWith('.omdep.near')) {
      // Omni Bridge
      return `nep141:${contractAddress}`;
    }
    if (contractAddress.includes('omni.hot.tg')) {
      // Hot Bridge - already in correct format
      return contractAddress;
    }
  }

  // Fallback: construct basic asset ID
  // For non-NEAR chains, we'd need bridge-specific handling
  // For now, return a placeholder that would need to be resolved
  return `nep141:${tokenLower}.${chainName}.near`;
}

/**
 * Parse SDK asset ID back to ChainToken format.
 * 
 * @param assetId - SDK asset ID (e.g., "nep141:usdt.tether-token.near")
 * @returns ChainToken object or null if parsing fails
 */
export function assetIdToChainToken(assetId: string): ChainToken | null {
  try {
    // Parse NEP-141 format: nep141:contract.near
    if (assetId.startsWith('nep141:')) {
      const contract = assetId.slice(7); // Remove "nep141:"
      
      // Extract token symbol from contract
      // Common patterns:
      // - wrap.near -> NEAR
      // - usdt.tether-token.near -> USDT
      // - token-0xAddress.omft.near -> Extract from bridge
      // - token.omdep.near -> Extract from bridge
      
      let token = 'UNKNOWN';
      let chainId = 'near';
      let chainName = 'NEAR';
      let decimals = 18;
      
      if (contract === 'wrap.near') {
        token = 'NEAR';
        decimals = 24;
      } else if (contract.includes('usdt') || contract.includes('tether')) {
        token = 'USDT';
        decimals = 6;
      } else if (contract.includes('usdc')) {
        token = 'USDC';
        decimals = 6;
      } else if (contract.includes('dai')) {
        token = 'DAI';
        decimals = 18;
      } else if (contract.endsWith('.omft.near')) {
        // PoA Bridge token - extract chain and token from contract
        // Format: token-0xAddress-chainId.omft.near
        const parts = contract.replace('.omft.near', '').split('-');
        if (parts.length >= 2) {
          token = parts[0].toUpperCase();
          // Try to determine chain from address format or other indicators
          chainId = 'near'; // PoA tokens are on NEAR
        }
      } else if (contract.endsWith('.omdep.near')) {
        // Omni Bridge token
        const parts = contract.replace('.omdep.near', '').split('.');
        token = parts[0].toUpperCase();
        chainId = 'near';
      } else {
        // Try to extract token from contract name
        const parts = contract.split('.');
        token = parts[0].toUpperCase();
      }
      
      return {
        chainId,
        chainName,
        token,
        icon: getTokenIcon(token),
        decimals,
      };
    }

    // Parse NEP-245 format: nep245:contract.near:tokenId
    if (assetId.startsWith('nep245:')) {
      const parts = assetId.slice(7).split(':');
      if (parts.length >= 2) {
        const contract = parts[0];
        const tokenId = parts[1];
        
        // Hot Bridge format: v2_1.omni.hot.tg:chainId_tokenId
        if (contract.includes('omni.hot.tg')) {
          const [chainIdPart, tokenIdPart] = tokenId.split('_');
          // Extract chain ID from format like "137_qiStmoQJDQPTebaPjgx5VBxZv6L"
          const chainIdNum = chainIdPart;
          const chainMapping: Record<string, { chainId: string; chainName: string }> = {
            '1': { chainId: 'ethereum', chainName: 'Ethereum' },
            '137': { chainId: 'polygon', chainName: 'Polygon' },
            '42161': { chainId: 'arbitrum', chainName: 'Arbitrum' },
            '8453': { chainId: 'base', chainName: 'Base' },
            '10': { chainId: 'optimism', chainName: 'Optimism' },
          };
          
          const chainInfo = chainMapping[chainIdNum] || { chainId: 'unknown', chainName: 'Unknown' };
          
          // Try to determine token from tokenId or contract
          let token = 'UNKNOWN';
          if (tokenIdPart) {
            // Token ID might contain token info
            token = 'TOKEN'; // Would need mapping
          }
          
          return {
            chainId: chainInfo.chainId,
            chainName: chainInfo.chainName,
            token,
            icon: getTokenIcon(token),
            decimals: 18, // Default
          };
        }
      }
    }

    return null;
  } catch (error) {
    console.error('Failed to parse asset ID:', assetId, error);
    return null;
  }
}

/**
 * Get token icon emoji/symbol
 */
function getTokenIcon(token: string): string {
  const icons: Record<string, string> = {
    'NEAR': '◈',
    'ETH': 'Ξ',
    'BTC': '₿',
    'SOL': '◎',
    'ZEC': 'ⓩ',
    'USDC': '$',
    'USDT': '₮',
    'DAI': '◊',
    'MATIC': '⬡',
  };
  return icons[token.toUpperCase()] || '●';
}

/**
 * Validate asset ID format
 */
export function isValidAssetId(assetId: string): boolean {
  return assetId.startsWith('nep141:') || assetId.startsWith('nep245:');
}

/**
 * Extract contract address from asset ID
 */
export function extractContractFromAssetId(assetId: string): string | null {
  if (assetId.startsWith('nep141:')) {
    return assetId.slice(7);
  }
  if (assetId.startsWith('nep245:')) {
    const parts = assetId.slice(7).split(':');
    return parts[0] || null;
  }
  return null;
}

/**
 * Get chain ID from asset ID (for cross-chain assets)
 */
export function getChainIdFromAssetId(assetId: string): string | null {
  // For Hot Bridge tokens, extract chain ID from tokenId
  if (assetId.startsWith('nep245:') && assetId.includes('omni.hot.tg')) {
    const parts = assetId.split(':');
    if (parts.length >= 2) {
      const tokenId = parts[1];
      const [chainIdNum] = tokenId.split('_');
      const chainMapping: Record<string, string> = {
        '1': 'ethereum',
        '137': 'polygon',
        '42161': 'arbitrum',
        '8453': 'base',
        '10': 'optimism',
      };
      return chainMapping[chainIdNum] || null;
    }
  }
  
  // For PoA Bridge tokens, they're on NEAR
  if (assetId.includes('.omft.near')) {
    return 'near';
  }
  
  // For Omni Bridge tokens, they're on NEAR
  if (assetId.includes('.omdep.near')) {
    return 'near';
  }
  
  // Default: NEAR chain
  if (assetId.startsWith('nep141:') || assetId.startsWith('nep245:')) {
    return 'near';
  }
  
  return null;
}

