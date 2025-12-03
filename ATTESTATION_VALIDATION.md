# Attestation Structure Validation

## Expected Structure (from `zkpf-common`)

Based on the backend artifacts in `zkpf/artifacts/default/`, the attestation must match the following structure:

```json
{
  "attestation": {
    "balance_raw": <u64>,
    "currency_code_int": <u32>,
    "custodian_id": <u32>,
    "attestation_id": <u64>,
    "issued_at": <u64>,
    "valid_until": <u64>,
    "account_id_hash": "<64-char hex string or 32-byte array>",
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
    "required_currency_code": <u32>,
    "current_epoch": <u64>,
    "verifier_scope_id": <u64>,
    "policy_id": <u64>,
    "nullifier": "<64-char hex string>",
    "custodian_pubkey_hash": "<64-char hex string>"
  }
}
```

## Your Attestation (Partial)

From what you provided:

```json
{
  "attestation": {
    "balance_raw": 0,                    ✓ (u64)
    "currency_code_int": 999001,         ⚠️  (unusual value, but valid u32)
    "custodian_id": 0,                   ✓ (u32)
    "attestation_id": 390559,            ✓ (u64)
    "issued_at": 1764726805,             ✓ (u64)
    "valid_until": 1764813205,           ✓ (u64)
    "account_id_hash": "8477baae...",     ✓ (hex string format)
    "custodian_pubkey": {
      "x": [170, 46, 31, 197, ...],      ⚠️  (need to verify 32 bytes)
      "y": [...]                         ⚠️  (truncated, need full 32 bytes)
    },
    "signature": {
      "r": [...],                        ⚠️  (truncated, need full 32 bytes)
      "s": [...]                         ⚠️  (truncated, need full 32 bytes)
    },
    "message_hash": [...]                ⚠️  (truncated, need full 32 bytes)
  }
}
```

## Validation Checklist

### ✅ Structure Requirements

1. **All fields present**: Your attestation appears to have all required fields
2. **Field types**: All visible fields have correct types
3. **Array lengths**: Need to verify:
   - `custodian_pubkey.x`: Must be exactly 32 bytes
   - `custodian_pubkey.y`: Must be exactly 32 bytes
   - `signature.r`: Must be exactly 32 bytes
   - `signature.s`: Must be exactly 32 bytes
   - `message_hash`: Must be exactly 32 bytes

### ⚠️ Potential Issues

1. **currency_code_int: 999001**
   - This is an unusual currency code (standard ISO 4217 codes are typically 3-digit)
   - Valid as u32, but verify this matches your policy's `required_currency_code`

2. **balance_raw: 0**
   - Zero balance - ensure your policy's `threshold_raw` allows this
   - Backend validates: `attestation.balance_raw >= policy.threshold_raw`

3. **Truncated arrays**
   - Your JSON appears truncated - ensure all arrays are complete:
     - `custodian_pubkey.x`: 32 bytes
     - `custodian_pubkey.y`: 32 bytes
     - `signature.r`: 32 bytes
     - `signature.s`: 32 bytes
     - `message_hash`: 32 bytes

### 🔍 Backend Validation (from `zkpf-backend`)

The backend performs these checks:

1. **JSON parsing**: Deserializes using `serde` with `serde_bytes32` for hash fields
2. **Message hash verification**: Validates `message_hash` matches canonical Poseidon digest
3. **ECDSA signature verification**: Verifies signature over `message_hash`
4. **Policy matching**: 
   - `currency_code_int` must match `policy.required_currency_code`
   - `balance_raw` must be >= `policy.threshold_raw`
5. **Epoch validation**: `current_epoch` must be within drift tolerance

## How to Validate

### Option 1: Use the validation script

```bash
# Save your complete attestation JSON to a file
python validate_attestation.py your_attestation.json
```

### Option 2: Check against sample

Compare your attestation structure with the sample:
```bash
cat zkpf/artifacts/default/attestation.sample.json
```

### Option 3: Test with backend

The backend will validate when you submit:
- `/zkpf/prove` endpoint validates structure and signature
- `/zkpf/verify` endpoint validates proof bundle

## Backend Artifacts Location

The backend loads artifacts from:
- Default: `zkpf/artifacts/manifest.json` (points to `default/` subdirectory)
- Override: Set `ZKPF_MANIFEST_PATH` environment variable

Current artifacts:
- **Circuit version**: 5
- **Manifest version**: 1
- **k (circuit size)**: 14
- **Created**: 2025-12-31 (1764594173 unix timestamp)

## Next Steps

1. **Complete your JSON**: Ensure all arrays have exactly 32 bytes
2. **Verify message_hash**: The `message_hash` must be computed as:
   ```
   Poseidon(balance_raw, attestation_id, currency_code_int, custodian_id, 
            issued_at, valid_until, account_id_hash)
   ```
3. **Verify signature**: ECDSA signature over `message_hash` using `custodian_pubkey`
4. **Check policy**: Ensure `currency_code_int` and `balance_raw` match your policy requirements

## References

- Attestation struct: `zkpf/zkpf-common/src/lib.rs` (lines 96-110)
- Message hash computation: `zkpf/zkpf-common/src/lib.rs` (lines 167-178)
- Backend validation: `zkpf/zkpf-backend/src/lib.rs` (lines 2208-2248)
- Sample attestation: `zkpf/artifacts/default/attestation.sample.json`

