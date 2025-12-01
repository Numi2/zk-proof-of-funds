//! Proof generation for bridged assets.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::types::{BridgeAddress, BridgeAsset, BridgeChainId};

/// Proof of bridged assets on a chain.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BridgedAssetProof {
    /// Chain where assets are held.
    pub chain: BridgeChainId,
    /// Address holding the assets.
    pub holder_address: BridgeAddress,
    /// Assets and their balances.
    pub assets: Vec<(BridgeAsset, u128)>,
    /// Total value in USD (if available).
    pub total_value_usd: Option<u128>,
    /// Block/slot number at proof time.
    pub block_number: u64,
    /// Timestamp of the proof.
    pub timestamp: u64,
    /// Proof hash for verification.
    pub proof_hash: [u8; 32],
    /// Optional Merkle proof for on-chain verification.
    pub merkle_proof: Option<Vec<[u8; 32]>>,
}

impl BridgedAssetProof {
    /// Create a new bridged asset proof.
    pub fn new(
        chain: BridgeChainId,
        holder_address: BridgeAddress,
        assets: Vec<(BridgeAsset, u128)>,
    ) -> Self {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        // Estimate block number (simplified)
        let block_number = timestamp / 12; // ~12s blocks average

        let mut proof = Self {
            chain,
            holder_address,
            assets,
            total_value_usd: None,
            block_number,
            timestamp,
            proof_hash: [0u8; 32],
            merkle_proof: None,
        };

        proof.proof_hash = proof.compute_hash();
        proof
    }

    /// Compute the proof hash.
    pub fn compute_hash(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"bridged_asset_proof_v1");
        hasher.update(self.chain.as_u64().to_be_bytes());
        hasher.update(self.holder_address.as_str().as_bytes());

        for (asset, balance) in &self.assets {
            hasher.update(asset.symbol().as_bytes());
            hasher.update(balance.to_be_bytes());
        }

        hasher.update(self.block_number.to_be_bytes());
        hasher.update(self.timestamp.to_be_bytes());

        let result = hasher.finalize();
        let mut hash = [0u8; 32];
        hash.copy_from_slice(&result);
        hash
    }

    /// Get total balance for a specific asset.
    pub fn balance_for(&self, symbol: &str) -> u128 {
        self.assets
            .iter()
            .filter(|(asset, _)| asset.symbol() == symbol)
            .map(|(_, balance)| *balance)
            .sum()
    }

    /// Get total balance across all assets (in smallest units).
    pub fn total_balance(&self) -> u128 {
        self.assets.iter().map(|(_, balance)| *balance).sum()
    }

    /// Check if the proof contains a specific asset.
    pub fn has_asset(&self, symbol: &str) -> bool {
        self.assets.iter().any(|(asset, _)| asset.symbol() == symbol)
    }

    /// Verify the proof hash.
    pub fn verify_hash(&self) -> bool {
        self.proof_hash == self.compute_hash()
    }

    /// Add USD valuation.
    pub fn with_usd_value(mut self, value: u128) -> Self {
        self.total_value_usd = Some(value);
        self
    }

    /// Add Merkle proof.
    pub fn with_merkle_proof(mut self, proof: Vec<[u8; 32]>) -> Self {
        self.merkle_proof = Some(proof);
        self
    }
}

/// Cross-chain attestation for bridged assets.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CrossChainAttestation {
    /// Unique attestation ID.
    pub attestation_id: [u8; 32],
    /// Holder identity binding.
    pub holder_binding: [u8; 32],
    /// Source chain of the attestation.
    pub source_chain: BridgeChainId,
    /// Target chain for the attestation.
    pub target_chain: BridgeChainId,
    /// The underlying asset proof.
    pub asset_proof: BridgedAssetProof,
    /// Attestation timestamp.
    pub attested_at: u64,
    /// Expiration timestamp.
    pub expires_at: u64,
    /// Signature (if signed by authority).
    pub signature: Option<Vec<u8>>,
    /// Wormhole VAA (if applicable).
    pub wormhole_vaa: Option<Vec<u8>>,
}

impl CrossChainAttestation {
    /// Create a new cross-chain attestation.
    pub fn create(
        holder_id: &[u8; 32],
        source_chain: BridgeChainId,
        target_chain: BridgeChainId,
        asset_proof: BridgedAssetProof,
    ) -> Self {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        let mut attestation = Self {
            attestation_id: [0u8; 32],
            holder_binding: Self::compute_holder_binding(holder_id),
            source_chain,
            target_chain,
            asset_proof,
            attested_at: now,
            expires_at: now + 86400, // 24 hours validity
            signature: None,
            wormhole_vaa: None,
        };

        attestation.attestation_id = attestation.compute_id();
        attestation
    }

    /// Compute the holder binding from holder ID.
    fn compute_holder_binding(holder_id: &[u8; 32]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"omni_holder_binding_v1");
        hasher.update(holder_id);
        let result = hasher.finalize();
        let mut binding = [0u8; 32];
        binding.copy_from_slice(&result);
        binding
    }

    /// Compute the attestation ID.
    pub fn compute_id(&self) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(b"omni_attestation_v1");
        hasher.update(&self.holder_binding);
        hasher.update(self.source_chain.as_u64().to_be_bytes());
        hasher.update(self.target_chain.as_u64().to_be_bytes());
        hasher.update(&self.asset_proof.proof_hash);
        hasher.update(self.attested_at.to_be_bytes());

        let result = hasher.finalize();
        let mut id = [0u8; 32];
        id.copy_from_slice(&result);
        id
    }

    /// Check if the attestation is still valid.
    pub fn is_valid(&self) -> bool {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs();

        now < self.expires_at
    }

    /// Verify the attestation ID.
    pub fn verify_id(&self) -> bool {
        self.attestation_id == self.compute_id()
    }

    /// Set the expiration time.
    pub fn with_expiration(mut self, expires_at: u64) -> Self {
        self.expires_at = expires_at;
        self.attestation_id = self.compute_id();
        self
    }

    /// Add a signature.
    pub fn with_signature(mut self, signature: Vec<u8>) -> Self {
        self.signature = Some(signature);
        self
    }

    /// Add a Wormhole VAA.
    pub fn with_wormhole_vaa(mut self, vaa: Vec<u8>) -> Self {
        self.wormhole_vaa = Some(vaa);
        self
    }

    /// Encode the attestation for cross-chain transmission.
    pub fn encode(&self) -> Vec<u8> {
        // Use a simple encoding format
        let mut encoded = Vec::new();

        // Version byte
        encoded.push(1u8);

        // Attestation ID
        encoded.extend_from_slice(&self.attestation_id);

        // Holder binding
        encoded.extend_from_slice(&self.holder_binding);

        // Chain IDs
        encoded.extend_from_slice(&self.source_chain.as_u64().to_be_bytes());
        encoded.extend_from_slice(&self.target_chain.as_u64().to_be_bytes());

        // Proof hash
        encoded.extend_from_slice(&self.asset_proof.proof_hash);

        // Timestamps
        encoded.extend_from_slice(&self.attested_at.to_be_bytes());
        encoded.extend_from_slice(&self.expires_at.to_be_bytes());

        // Total balance
        encoded.extend_from_slice(&self.asset_proof.total_balance().to_be_bytes());

        encoded
    }

    /// Decode an attestation from bytes.
    pub fn decode(bytes: &[u8]) -> Result<Self, &'static str> {
        if bytes.len() < 1 + 32 + 32 + 8 + 8 + 32 + 8 + 8 + 16 {
            return Err("Invalid attestation length");
        }

        let version = bytes[0];
        if version != 1 {
            return Err("Unsupported attestation version");
        }

        let mut attestation_id = [0u8; 32];
        attestation_id.copy_from_slice(&bytes[1..33]);

        let mut holder_binding = [0u8; 32];
        holder_binding.copy_from_slice(&bytes[33..65]);

        let source_chain_id = u64::from_be_bytes(bytes[65..73].try_into().unwrap());
        let target_chain_id = u64::from_be_bytes(bytes[73..81].try_into().unwrap());

        let mut proof_hash = [0u8; 32];
        proof_hash.copy_from_slice(&bytes[81..113]);

        let attested_at = u64::from_be_bytes(bytes[113..121].try_into().unwrap());
        let expires_at = u64::from_be_bytes(bytes[121..129].try_into().unwrap());

        let _total_balance = u128::from_be_bytes(bytes[129..145].try_into().unwrap());

        // Create a minimal attestation from decoded data
        Ok(Self {
            attestation_id,
            holder_binding,
            source_chain: BridgeChainId::Custom(source_chain_id),
            target_chain: BridgeChainId::Custom(target_chain_id),
            asset_proof: BridgedAssetProof {
                chain: BridgeChainId::Custom(source_chain_id),
                holder_address: BridgeAddress::Near("decoded".to_string()),
                assets: vec![],
                total_value_usd: None,
                block_number: 0,
                timestamp: attested_at,
                proof_hash,
                merkle_proof: None,
            },
            attested_at,
            expires_at,
            signature: None,
            wormhole_vaa: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bridged_asset_proof() {
        let proof = BridgedAssetProof::new(
            BridgeChainId::NearMainnet,
            BridgeAddress::near("test.near"),
            vec![
                (
                    BridgeAsset::Nep141 {
                        account_id: "usdc.near".to_string(),
                        symbol: "USDC".to_string(),
                        decimals: 6,
                    },
                    1_000_000_000, // 1000 USDC
                ),
            ],
        );

        assert!(proof.verify_hash());
        assert_eq!(proof.balance_for("USDC"), 1_000_000_000);
        assert!(proof.has_asset("USDC"));
        assert!(!proof.has_asset("ETH"));
    }

    #[test]
    fn test_cross_chain_attestation() {
        let holder_id = [1u8; 32];
        let proof = BridgedAssetProof::new(
            BridgeChainId::EthereumMainnet,
            BridgeAddress::evm("0x1234567890abcdef1234567890abcdef12345678"),
            vec![
                (
                    BridgeAsset::Erc20 {
                        address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48".to_string(),
                        symbol: "USDC".to_string(),
                        decimals: 6,
                    },
                    500_000_000, // 500 USDC
                ),
            ],
        );

        let attestation = CrossChainAttestation::create(
            &holder_id,
            BridgeChainId::EthereumMainnet,
            BridgeChainId::NearMainnet,
            proof,
        );

        assert!(attestation.verify_id());
        assert!(attestation.is_valid());

        // Test encoding/decoding
        let encoded = attestation.encode();
        let decoded = CrossChainAttestation::decode(&encoded).unwrap();
        assert_eq!(decoded.attestation_id, attestation.attestation_id);
        assert_eq!(decoded.holder_binding, attestation.holder_binding);
    }
}

