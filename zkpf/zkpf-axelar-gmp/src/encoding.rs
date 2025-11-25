//! ABI encoding/decoding for Axelar GMP messages
//!
//! This module provides encoding/decoding logic compatible with Solidity ABI
//! encoding for cross-chain message passing.

use crate::{AxelarGmpError, PoFQuery, PoFReceipt, PoFRevocation};

/// Encode a PoF receipt for GMP transmission
pub fn encode_receipt(receipt: &PoFReceipt) -> Result<Vec<u8>, AxelarGmpError> {
    // ABI-encode the receipt fields
    // Layout: holder_id (32) + policy_id (32) + snapshot_id (32) + chain_id_origin (32)
    //       + attestation_hash (32) + validity_window (32) + issued_at (32)
    let mut encoded = Vec::with_capacity(7 * 32);

    // bytes32 holder_id
    encoded.extend_from_slice(&receipt.holder_id);

    // uint256 policy_id (right-padded to 32 bytes)
    let mut policy_bytes = [0u8; 32];
    policy_bytes[24..].copy_from_slice(&receipt.policy_id.to_be_bytes());
    encoded.extend_from_slice(&policy_bytes);

    // bytes32 snapshot_id
    encoded.extend_from_slice(&receipt.snapshot_id);

    // uint64 chain_id_origin (right-padded to 32 bytes)
    let mut chain_bytes = [0u8; 32];
    chain_bytes[24..].copy_from_slice(&receipt.chain_id_origin.to_be_bytes());
    encoded.extend_from_slice(&chain_bytes);

    // bytes32 attestation_hash
    encoded.extend_from_slice(&receipt.attestation_hash);

    // uint64 validity_window (right-padded to 32 bytes)
    let mut validity_bytes = [0u8; 32];
    validity_bytes[24..].copy_from_slice(&receipt.validity_window.to_be_bytes());
    encoded.extend_from_slice(&validity_bytes);

    // uint64 issued_at (right-padded to 32 bytes)
    let mut issued_bytes = [0u8; 32];
    issued_bytes[24..].copy_from_slice(&receipt.issued_at.to_be_bytes());
    encoded.extend_from_slice(&issued_bytes);

    Ok(encoded)
}

/// Decode a PoF receipt from ABI-encoded bytes
pub fn decode_receipt(bytes: &[u8]) -> Result<PoFReceipt, AxelarGmpError> {
    if bytes.len() < 7 * 32 {
        return Err(AxelarGmpError::Decoding(format!(
            "receipt payload too short: {} < {}",
            bytes.len(),
            7 * 32
        )));
    }

    let mut offset = 0;

    // bytes32 holder_id
    let mut holder_id = [0u8; 32];
    holder_id.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    // uint256 policy_id
    let policy_id = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());
    offset += 32;

    // bytes32 snapshot_id
    let mut snapshot_id = [0u8; 32];
    snapshot_id.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    // uint64 chain_id_origin
    let chain_id_origin = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());
    offset += 32;

    // bytes32 attestation_hash
    let mut attestation_hash = [0u8; 32];
    attestation_hash.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    // uint64 validity_window
    let validity_window = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());
    offset += 32;

    // uint64 issued_at
    let issued_at = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());

    Ok(PoFReceipt {
        holder_id,
        policy_id,
        snapshot_id,
        chain_id_origin,
        attestation_hash,
        validity_window,
        issued_at,
    })
}

/// Encode a PoF revocation for GMP transmission
pub fn encode_revocation(revocation: &PoFRevocation) -> Result<Vec<u8>, AxelarGmpError> {
    // Layout: holder_id (32) + policy_id (32) + snapshot_id (32)
    let mut encoded = Vec::with_capacity(3 * 32);

    // bytes32 holder_id
    encoded.extend_from_slice(&revocation.holder_id);

    // uint256 policy_id
    let mut policy_bytes = [0u8; 32];
    policy_bytes[24..].copy_from_slice(&revocation.policy_id.to_be_bytes());
    encoded.extend_from_slice(&policy_bytes);

    // bytes32 snapshot_id
    encoded.extend_from_slice(&revocation.snapshot_id);

    Ok(encoded)
}

/// Decode a PoF revocation from ABI-encoded bytes
pub fn decode_revocation(bytes: &[u8]) -> Result<PoFRevocation, AxelarGmpError> {
    if bytes.len() < 3 * 32 {
        return Err(AxelarGmpError::Decoding(format!(
            "revocation payload too short: {} < {}",
            bytes.len(),
            3 * 32
        )));
    }

    let mut offset = 0;

    // bytes32 holder_id
    let mut holder_id = [0u8; 32];
    holder_id.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    // uint256 policy_id
    let policy_id = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());
    offset += 32;

    // bytes32 snapshot_id
    let mut snapshot_id = [0u8; 32];
    snapshot_id.copy_from_slice(&bytes[offset..offset + 32]);

    Ok(PoFRevocation {
        holder_id,
        policy_id,
        snapshot_id,
    })
}

/// Encode a PoF query for GMP transmission
pub fn encode_query(query: &PoFQuery) -> Result<Vec<u8>, AxelarGmpError> {
    // Layout: holder_id (32) + policy_id (32) + has_snapshot (32) + snapshot_id (32)
    //       + callback_chain_len (32) + callback_chain (padded) + callback_address_len (32) + callback_address (padded)
    let mut encoded = Vec::new();

    // bytes32 holder_id
    encoded.extend_from_slice(&query.holder_id);

    // uint256 policy_id
    let mut policy_bytes = [0u8; 32];
    policy_bytes[24..].copy_from_slice(&query.policy_id.to_be_bytes());
    encoded.extend_from_slice(&policy_bytes);

    // bool has_snapshot (as uint8 in 32 bytes)
    let mut has_snapshot_bytes = [0u8; 32];
    has_snapshot_bytes[31] = if query.snapshot_id.is_some() { 1 } else { 0 };
    encoded.extend_from_slice(&has_snapshot_bytes);

    // bytes32 snapshot_id (or zeroes)
    if let Some(snapshot_id) = &query.snapshot_id {
        encoded.extend_from_slice(snapshot_id);
    } else {
        encoded.extend_from_slice(&[0u8; 32]);
    }

    // string callback_chain (ABI dynamic encoding)
    let callback_chain_bytes = query.callback_chain.as_bytes();
    let mut len_bytes = [0u8; 32];
    len_bytes[24..].copy_from_slice(&(callback_chain_bytes.len() as u64).to_be_bytes());
    encoded.extend_from_slice(&len_bytes);

    // Pad to 32-byte boundary
    let padded_len = ((callback_chain_bytes.len() + 31) / 32) * 32;
    let mut padded = vec![0u8; padded_len];
    padded[..callback_chain_bytes.len()].copy_from_slice(callback_chain_bytes);
    encoded.extend_from_slice(&padded);

    // string callback_address
    let callback_address_bytes = query.callback_address.as_bytes();
    let mut len_bytes = [0u8; 32];
    len_bytes[24..].copy_from_slice(&(callback_address_bytes.len() as u64).to_be_bytes());
    encoded.extend_from_slice(&len_bytes);

    let padded_len = ((callback_address_bytes.len() + 31) / 32) * 32;
    let mut padded = vec![0u8; padded_len];
    padded[..callback_address_bytes.len()].copy_from_slice(callback_address_bytes);
    encoded.extend_from_slice(&padded);

    Ok(encoded)
}

/// Decode a PoF query from ABI-encoded bytes
pub fn decode_query(bytes: &[u8]) -> Result<PoFQuery, AxelarGmpError> {
    if bytes.len() < 4 * 32 {
        return Err(AxelarGmpError::Decoding(format!(
            "query payload too short: {} < {}",
            bytes.len(),
            4 * 32
        )));
    }

    let mut offset = 0;

    // bytes32 holder_id
    let mut holder_id = [0u8; 32];
    holder_id.copy_from_slice(&bytes[offset..offset + 32]);
    offset += 32;

    // uint256 policy_id
    let policy_id = u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap());
    offset += 32;

    // bool has_snapshot
    let has_snapshot = bytes[offset + 31] != 0;
    offset += 32;

    // bytes32 snapshot_id
    let snapshot_id = if has_snapshot {
        let mut id = [0u8; 32];
        id.copy_from_slice(&bytes[offset..offset + 32]);
        Some(id)
    } else {
        None
    };
    offset += 32;

    // string callback_chain
    let callback_chain_len =
        u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap()) as usize;
    offset += 32;
    let callback_chain = String::from_utf8(bytes[offset..offset + callback_chain_len].to_vec())
        .map_err(|e| AxelarGmpError::Decoding(e.to_string()))?;
    let padded_len = ((callback_chain_len + 31) / 32) * 32;
    offset += padded_len;

    // string callback_address
    let callback_address_len =
        u64::from_be_bytes(bytes[offset + 24..offset + 32].try_into().unwrap()) as usize;
    offset += 32;
    let callback_address =
        String::from_utf8(bytes[offset..offset + callback_address_len].to_vec())
            .map_err(|e| AxelarGmpError::Decoding(e.to_string()))?;

    Ok(PoFQuery {
        holder_id,
        policy_id,
        snapshot_id,
        callback_chain,
        callback_address,
    })
}

/// Helper to convert a hex string to bytes32
pub fn hex_to_bytes32(hex: &str) -> Result<[u8; 32], AxelarGmpError> {
    let hex = hex.strip_prefix("0x").unwrap_or(hex);
    let bytes = hex::decode(hex).map_err(|e| AxelarGmpError::Decoding(e.to_string()))?;

    if bytes.len() != 32 {
        return Err(AxelarGmpError::Decoding(format!(
            "expected 32 bytes, got {}",
            bytes.len()
        )));
    }

    let mut result = [0u8; 32];
    result.copy_from_slice(&bytes);
    Ok(result)
}

/// Helper to convert bytes32 to hex string
pub fn bytes32_to_hex(bytes: &[u8; 32]) -> String {
    format!("0x{}", hex::encode(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_receipt_roundtrip() {
        let receipt = PoFReceipt {
            holder_id: [1u8; 32],
            policy_id: 271828,
            snapshot_id: [2u8; 32],
            chain_id_origin: 1,
            attestation_hash: [3u8; 32],
            validity_window: 86400,
            issued_at: 1700000000,
        };

        let encoded = encode_receipt(&receipt).unwrap();
        assert_eq!(encoded.len(), 7 * 32);

        let decoded = decode_receipt(&encoded).unwrap();
        assert_eq!(decoded.holder_id, receipt.holder_id);
        assert_eq!(decoded.policy_id, receipt.policy_id);
        assert_eq!(decoded.snapshot_id, receipt.snapshot_id);
        assert_eq!(decoded.chain_id_origin, receipt.chain_id_origin);
        assert_eq!(decoded.attestation_hash, receipt.attestation_hash);
        assert_eq!(decoded.validity_window, receipt.validity_window);
        assert_eq!(decoded.issued_at, receipt.issued_at);
    }

    #[test]
    fn test_revocation_roundtrip() {
        let revocation = PoFRevocation {
            holder_id: [4u8; 32],
            policy_id: 314159,
            snapshot_id: [5u8; 32],
        };

        let encoded = encode_revocation(&revocation).unwrap();
        assert_eq!(encoded.len(), 3 * 32);

        let decoded = decode_revocation(&encoded).unwrap();
        assert_eq!(decoded.holder_id, revocation.holder_id);
        assert_eq!(decoded.policy_id, revocation.policy_id);
        assert_eq!(decoded.snapshot_id, revocation.snapshot_id);
    }

    #[test]
    fn test_hex_conversion() {
        let bytes = [0xab; 32];
        let hex = bytes32_to_hex(&bytes);
        assert_eq!(hex, "0xabababababababababababababababababababababababababababababababab");

        let decoded = hex_to_bytes32(&hex).unwrap();
        assert_eq!(decoded, bytes);
    }
}

