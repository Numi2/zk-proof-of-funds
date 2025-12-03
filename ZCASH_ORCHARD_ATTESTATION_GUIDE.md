# Zcash Orchard Attestation JSON Guide

This guide explains how to create a proper JSON attestation for the **ZCASH_ORCHARD** rail using the zcash-orchard artifacts.

## Key Differences from Default Custodial Attestation

The Zcash Orchard rail uses the **V2_ORCHARD** public-input layout, which includes three additional fields beyond the standard V1 layout:

1. **`snapshot_block_height`** (u64): The Zcash block height at which the Orchard anchor was taken
2. **`snapshot_anchor_orchard`** ([u8; 32]): The Orchard Merkle root/anchor at that block height
3. **`holder_binding`** ([u8; 32]): A binding hash between the holder identity and their Orchard UFVK (Unified Full Viewing Key)

## Artifact Configuration

- **Rail ID**: `"ZCASH_ORCHARD"`
- **Circuit Version**: `5`
- **Circuit Size (k)**: `19` (much larger than default k=14)
- **Public Input Layout**: `V2_ORCHARD` (10 columns vs 7 for V1)
- **Manifest Path**: `artifacts/zcash-orchard/manifest.json`
- **Currency Code**: `999001` (Zcash)

## Input Format (for `/zkpf/prove-bundle`)

When submitting to the backend for proof generation, use this structure:

```json
{
  "attestation": {
    "balance_raw": <u64>,
    "currency_code_int": 999001,
    "custodian_id": <u32>,
    "attestation_id": <u64>,
    "issued_at": <u64>,
    "valid_until": <u64>,
    "account_id_hash": "<64-char hex string>",
    "custodian_pubkey": {
      "x": [32 bytes as integers 0-255],
      "y": [32 bytes as integers 0-255]
    },
    "signature": {
      "r": [32 bytes as integers 0-255],
      "s": [32 bytes as integers 0-255]
    },
    "message_hash": [32 bytes as integers 0-255]
  },
  "public": {
    "threshold_raw": <u64>,
    "required_currency_code": 999001,
    "current_epoch": <u64>,
    "verifier_scope_id": <u64>,
    "policy_id": <u64>,
    "nullifier": "<64-char hex string>",
    "custodian_pubkey_hash": "<64-char hex string>",
    "snapshot_block_height": <u64>,
    "snapshot_anchor_orchard": "<64-char hex string>",
    "holder_binding": "<64-char hex string>"
  }
}
```

## Output Format (ProofBundle)

The generated proof bundle will have this structure:

```json
{
  "rail_id": "ZCASH_ORCHARD",
  "circuit_version": 5,
  "proof": [/* binary proof bytes */],
  "public_inputs": {
    "threshold_raw": <u64>,
    "required_currency_code": 999001,
    "current_epoch": <u64>,
    "verifier_scope_id": <u64>,
    "policy_id": <u64>,
    "nullifier": [32 bytes],
    "custodian_pubkey_hash": [32 bytes],
    "snapshot_block_height": <u64>,
    "snapshot_anchor_orchard": [32 bytes],
    "holder_binding": [32 bytes]
  }
}
```

## Complete Example

See `zkpf/artifacts/zcash-orchard/attestation.sample.json` for a complete example.

### Field Descriptions

#### Standard Fields (V1 Layout)
- **`threshold_raw`**: Minimum balance in zatoshi (1 ZEC = 100,000,000 zatoshi)
- **`required_currency_code`**: Must be `999001` for Zcash
- **`current_epoch`**: Unix timestamp for epoch validation
- **`verifier_scope_id`**: Scope identifier for the verifier
- **`policy_id`**: Policy identifier
- **`nullifier`**: Privacy-preserving nullifier (32 bytes)
- **`custodian_pubkey_hash`**: Hash of custodian public key (32 bytes)

#### Orchard-Specific Fields (V2_ORCHARD Layout)
- **`snapshot_block_height`**: Zcash block height where the Orchard anchor was captured
  - Example: `2500000` (mainnet block height)
  - This should match the actual block height of your Orchard notes

- **`snapshot_anchor_orchard`**: Orchard Merkle root/anchor at `snapshot_block_height`
  - 32-byte value representing the root of the Orchard note commitment tree
  - This proves your notes exist in the canonical Orchard Merkle tree
  - Format: hex string (64 chars) or byte array (32 bytes)

- **`holder_binding`**: Binding between holder identity and Orchard UFVK
  - 32-byte hash that binds:
    - Holder identifier (e.g., user ID or KYC hash)
    - Orchard UFVK (Unified Full Viewing Key)
    - Policy/domain context
  - Format: hex string (64 chars) or byte array (32 bytes)
  - Typically computed as: `Poseidon(holder_id_bytes || ufvk_bytes || domain_bytes)`

## Validation Checklist

✅ **Required Fields**:
- [ ] All standard V1 fields present
- [ ] `snapshot_block_height` is set (not null)
- [ ] `snapshot_anchor_orchard` is set (not null, 32 bytes)
- [ ] `holder_binding` is set (not null, 32 bytes)

✅ **Format Validation**:
- [ ] `rail_id` is `"ZCASH_ORCHARD"` (in proof bundle output)
- [ ] `circuit_version` is `5`
- [ ] `required_currency_code` is `999001`
- [ ] All 32-byte arrays have exactly 32 elements
- [ ] Hex strings are 64 characters (without "0x" prefix) or 66 with "0x"

✅ **Value Validation**:
- [ ] `snapshot_block_height` > 0 (valid Zcash block height)
- [ ] `balance_raw` >= `threshold_raw` (meets policy requirement)
- [ ] `current_epoch` is within drift tolerance of server epoch

## Backend Validation

The backend performs these checks for ZCASH_ORCHARD bundles:

1. **Rail Detection**: Checks if `rail_id == "ZCASH_ORCHARD"`
2. **Field Presence**: Verifies `snapshot_block_height` and `snapshot_anchor_orchard` are present
3. **Layout Matching**: Uses V2_ORCHARD layout (10 public input columns)
4. **Artifact Loading**: Loads artifacts from `artifacts/zcash-orchard/manifest.json`
5. **Circuit Verification**: Verifies proof using k=19 circuit

## Notes

- **Circuit Size**: The Orchard circuit uses k=19 (much larger than default k=14), requiring ~750MB proving key
- **Proving Key**: The `pk.bin` file is ~788MB (vs ~21MB for default circuit)
- **Public Inputs**: V2_ORCHARD layout has 10 columns vs 7 for V1:
  - Columns 0-6: Standard V1 fields
  - Column 7: `snapshot_block_height`
  - Column 8: `snapshot_anchor_orchard`
  - Column 9: `holder_binding`

## Example Values

```json
{
  "snapshot_block_height": 2500000,
  "snapshot_anchor_orchard": "a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456",
  "holder_binding": "f1e2d3c4b5a697887766554433221100ffeeddccbbaa99887766554433221100"
}
```

## References

- Sample attestation: `zkpf/artifacts/zcash-orchard/attestation.sample.json`
- Sample proof bundle: `zkpf/artifacts/zcash-orchard/proof-bundle.sample.json`
- Manifest: `zkpf/artifacts/zcash-orchard/manifest.json`
- Multi-rail config: `zkpf/config/multi-rail-manifest.json`
- Circuit code: `zkpf/zkpf-zcash-orchard-circuit/src/lib.rs`
- Common types: `zkpf/zkpf-common/src/lib.rs` (VerifierPublicInputs)

