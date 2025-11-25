//! Starknet state reading utilities.
//!
//! This module provides functions for reading account state from Starknet,
//! including balances, DeFi positions, and vault shares.

use crate::{
    error::StarknetRailError,
    types::{known_tokens, TokenMetadata, WalletType},
    DefiPosition, PositionType, StarknetAccountSnapshot, StarknetSnapshot, TokenBalance,
};

/// Build a snapshot for a single account address.
///
/// This is a simplified implementation that would need to be connected
/// to actual Starknet RPC calls in production.
pub fn build_account_snapshot(
    address: &str,
    class_hash: &str,
    native_balance: u128,
) -> StarknetAccountSnapshot {
    StarknetAccountSnapshot {
        address: address.to_string(),
        class_hash: class_hash.to_string(),
        native_balance,
        token_balances: vec![],
        defi_positions: vec![],
    }
}

/// Parse a Starknet address from various formats.
pub fn parse_address(address: &str) -> Result<String, StarknetRailError> {
    let trimmed = address.trim();
    
    // Handle 0x prefix
    let without_prefix = trimmed.strip_prefix("0x").unwrap_or(trimmed);
    
    // Validate hex
    if !without_prefix.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(StarknetRailError::InvalidInput(format!(
            "invalid address format: {}",
            address
        )));
    }
    
    // Pad to 64 characters (felt252 is 252 bits)
    let padded = format!("0x{:0>64}", without_prefix);
    Ok(padded)
}

/// Convert a felt252 string to bytes.
pub fn felt_to_bytes(felt: &str) -> Result<[u8; 32], StarknetRailError> {
    let parsed = parse_address(felt)?;
    let without_prefix = parsed.strip_prefix("0x").unwrap_or(&parsed);
    
    let bytes = hex::decode(without_prefix).map_err(|e| {
        StarknetRailError::InvalidInput(format!("invalid felt hex: {}", e))
    })?;
    
    if bytes.len() != 32 {
        return Err(StarknetRailError::InvalidInput(format!(
            "felt must be 32 bytes, got {}",
            bytes.len()
        )));
    }
    
    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

/// Get standard token metadata.
pub fn get_token_metadata(address: &str) -> Option<TokenMetadata> {
    let normalized = parse_address(address).ok()?;
    let normalized_lower = normalized.to_lowercase();
    
    // Match known tokens
    if normalized_lower == parse_address(known_tokens::ETH).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::ETH.to_string(),
            symbol: "ETH".to_string(),
            decimals: 18,
            usd_price_cents: None, // Would be fetched from oracle
        })
    } else if normalized_lower == parse_address(known_tokens::STRK).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::STRK.to_string(),
            symbol: "STRK".to_string(),
            decimals: 18,
            usd_price_cents: None,
        })
    } else if normalized_lower == parse_address(known_tokens::USDC).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::USDC.to_string(),
            symbol: "USDC".to_string(),
            decimals: 6,
            usd_price_cents: Some(100), // $1.00
        })
    } else if normalized_lower == parse_address(known_tokens::USDT).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::USDT.to_string(),
            symbol: "USDT".to_string(),
            decimals: 6,
            usd_price_cents: Some(100),
        })
    } else if normalized_lower == parse_address(known_tokens::DAI).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::DAI.to_string(),
            symbol: "DAI".to_string(),
            decimals: 18,
            usd_price_cents: Some(100),
        })
    } else if normalized_lower == parse_address(known_tokens::WBTC).ok()?.to_lowercase() {
        Some(TokenMetadata {
            address: known_tokens::WBTC.to_string(),
            symbol: "WBTC".to_string(),
            decimals: 8,
            usd_price_cents: None,
        })
    } else {
        None
    }
}

/// Merge multiple account snapshots into a single snapshot.
pub fn merge_snapshots(
    chain_id: &str,
    block_number: u64,
    block_hash: &str,
    timestamp: u64,
    accounts: Vec<StarknetAccountSnapshot>,
) -> StarknetSnapshot {
    StarknetSnapshot {
        chain_id: chain_id.to_string(),
        block_number,
        block_hash: block_hash.to_string(),
        timestamp,
        accounts,
    }
}

/// Aggregate values by token symbol.
pub fn aggregate_by_token(snapshot: &StarknetSnapshot) -> Vec<(String, u128)> {
    use std::collections::HashMap;
    
    let mut totals: HashMap<String, u128> = HashMap::new();
    
    for account in &snapshot.accounts {
        // Add native balance
        *totals.entry("ETH".to_string()).or_insert(0) += account.native_balance;
        
        // Add token balances
        for token in &account.token_balances {
            *totals.entry(token.symbol.clone()).or_insert(0) += token.balance;
        }
    }
    
    let mut result: Vec<_> = totals.into_iter().collect();
    result.sort_by(|a, b| b.1.cmp(&a.1)); // Sort by value descending
    result
}

/// Calculate USD value of a snapshot.
pub fn calculate_usd_value(
    snapshot: &StarknetSnapshot,
    eth_price_cents: u64,
    strk_price_cents: u64,
) -> u64 {
    let mut total_cents: u128 = 0;
    
    for account in &snapshot.accounts {
        // Native balance (assuming ETH)
        let eth_value = (account.native_balance / 10u128.pow(18)) * eth_price_cents as u128;
        total_cents += eth_value;
        
        // Token balances
        for token in &account.token_balances {
            if let Some(usd) = token.usd_value {
                total_cents += usd as u128;
            } else if token.symbol == "STRK" {
                let strk_value = (token.balance / 10u128.pow(18)) * strk_price_cents as u128;
                total_cents += strk_value;
            }
        }
        
        // DeFi positions
        for position in &account.defi_positions {
            if let Some(usd) = position.usd_value {
                total_cents += usd as u128;
            }
        }
    }
    
    // Cap at u64::MAX
    total_cents.min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_address() {
        let addr = "0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7";
        let parsed = parse_address(addr).expect("should parse");
        assert!(parsed.starts_with("0x"));
        assert_eq!(parsed.len(), 66); // 0x + 64 hex chars
    }

    #[test]
    fn test_felt_to_bytes() {
        let felt = "0x0000000000000000000000000000000000000000000000000000000000000001";
        let bytes = felt_to_bytes(felt).expect("should convert");
        assert_eq!(bytes[31], 1);
        assert!(bytes[..31].iter().all(|&b| b == 0));
    }

    #[test]
    fn test_get_token_metadata() {
        let eth_meta = get_token_metadata(known_tokens::ETH).expect("should find ETH");
        assert_eq!(eth_meta.symbol, "ETH");
        assert_eq!(eth_meta.decimals, 18);
    }

    #[test]
    fn test_aggregate_by_token() {
        let snapshot = StarknetSnapshot {
            chain_id: "SN_SEPOLIA".to_string(),
            block_number: 100,
            block_hash: "0x123".to_string(),
            timestamp: 1700000000,
            accounts: vec![
                StarknetAccountSnapshot {
                    address: "0x1".to_string(),
                    class_hash: "0x0".to_string(),
                    native_balance: 10_000_000_000_000_000_000,
                    token_balances: vec![TokenBalance {
                        token_address: known_tokens::USDC.to_string(),
                        symbol: "USDC".to_string(),
                        balance: 5_000_000_000,
                        usd_value: Some(5_000_000_000),
                    }],
                    defi_positions: vec![],
                },
                StarknetAccountSnapshot {
                    address: "0x2".to_string(),
                    class_hash: "0x0".to_string(),
                    native_balance: 5_000_000_000_000_000_000,
                    token_balances: vec![],
                    defi_positions: vec![],
                },
            ],
        };
        
        let aggregated = aggregate_by_token(&snapshot);
        let eth_total = aggregated.iter().find(|(s, _)| s == "ETH").map(|(_, v)| *v);
        assert_eq!(eth_total, Some(15_000_000_000_000_000_000));
    }
}

