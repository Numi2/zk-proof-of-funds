#!/usr/bin/env python3
"""
Validate an attestation JSON against the expected structure from zkpf-common.

This script checks:
1. All required fields are present
2. Field types and formats match expectations
3. Array lengths are correct (32 bytes for x, y, r, s, message_hash)
4. account_id_hash format (hex string or byte array)
"""

import json
import sys
from typing import Any, Dict, List, Optional


def validate_attestation(attestation_data: Dict[str, Any]) -> List[str]:
    """Validate attestation structure and return list of errors."""
    errors = []
    
    # Check top-level structure
    if "attestation" not in attestation_data:
        return ["Missing top-level 'attestation' field"]
    
    att = attestation_data["attestation"]
    
    # Required fields
    required_fields = {
        "balance_raw": (int, "u64"),
        "currency_code_int": (int, "u32"),
        "custodian_id": (int, "u32"),
        "attestation_id": (int, "u64"),
        "issued_at": (int, "u64"),
        "valid_until": (int, "u64"),
        "account_id_hash": (str, "32-byte hex or array"),
        "custodian_pubkey": (dict, "object with x, y"),
        "signature": (dict, "object with r, s"),
        "message_hash": (list, "32-byte array"),
    }
    
    # Check all required fields exist
    for field, (expected_type, description) in required_fields.items():
        if field not in att:
            errors.append(f"Missing required field: {field} ({description})")
            continue
        
        value = att[field]
        if not isinstance(value, expected_type):
            errors.append(
                f"Field '{field}' has wrong type: expected {expected_type.__name__}, got {type(value).__name__}"
            )
    
    # Validate custodian_pubkey structure
    if "custodian_pubkey" in att and isinstance(att["custodian_pubkey"], dict):
        pubkey = att["custodian_pubkey"]
        if "x" not in pubkey:
            errors.append("custodian_pubkey missing 'x' field")
        elif not isinstance(pubkey["x"], list) or len(pubkey["x"]) != 32:
            errors.append(f"custodian_pubkey.x must be array of 32 bytes, got {len(pubkey.get('x', []))} bytes")
        
        if "y" not in pubkey:
            errors.append("custodian_pubkey missing 'y' field")
        elif not isinstance(pubkey["y"], list) or len(pubkey["y"]) != 32:
            errors.append(f"custodian_pubkey.y must be array of 32 bytes, got {len(pubkey.get('y', []))} bytes")
    
    # Validate signature structure
    if "signature" in att and isinstance(att["signature"], dict):
        sig = att["signature"]
        if "r" not in sig:
            errors.append("signature missing 'r' field")
        elif not isinstance(sig["r"], list) or len(sig["r"]) != 32:
            errors.append(f"signature.r must be array of 32 bytes, got {len(sig.get('r', []))} bytes")
        
        if "s" not in sig:
            errors.append("signature missing 's' field")
        elif not isinstance(sig["s"], list) or len(sig["s"]) != 32:
            errors.append(f"signature.s must be array of 32 bytes, got {len(sig.get('s', []))} bytes")
    
    # Validate message_hash
    if "message_hash" in att:
        mh = att["message_hash"]
        if not isinstance(mh, list) or len(mh) != 32:
            errors.append(f"message_hash must be array of 32 bytes, got {len(mh) if isinstance(mh, list) else 'non-array'}")
        elif isinstance(mh, list):
            for i, byte in enumerate(mh):
                if not isinstance(byte, int) or not (0 <= byte <= 255):
                    errors.append(f"message_hash[{i}] must be byte (0-255), got {byte}")
                    break
    
    # Validate account_id_hash format
    if "account_id_hash" in att:
        aih = att["account_id_hash"]
        if isinstance(aih, str):
            # Hex string format
            hex_str = aih.removeprefix("0x").removeprefix("0X")
            if len(hex_str) != 64:
                errors.append(f"account_id_hash hex string must be 64 chars (32 bytes), got {len(hex_str)}")
            try:
                bytes.fromhex(hex_str)
            except ValueError:
                errors.append(f"account_id_hash is not valid hex: {aih}")
        elif isinstance(aih, list):
            if len(aih) != 32:
                errors.append(f"account_id_hash array must be 32 bytes, got {len(aih)}")
        else:
            errors.append(f"account_id_hash must be hex string or byte array, got {type(aih).__name__}")
    
    # Validate numeric ranges
    if "balance_raw" in att and isinstance(att["balance_raw"], int):
        if att["balance_raw"] < 0:
            errors.append("balance_raw must be non-negative")
    
    if "currency_code_int" in att and isinstance(att["currency_code_int"], int):
        if att["currency_code_int"] < 0 or att["currency_code_int"] > 0xFFFFFFFF:
            errors.append("currency_code_int must fit in u32")
    
    if "custodian_id" in att and isinstance(att["custodian_id"], int):
        if att["custodian_id"] < 0 or att["custodian_id"] > 0xFFFFFFFF:
            errors.append("custodian_id must fit in u32")
    
    return errors


def main():
    if len(sys.argv) < 2:
        print("Usage: python validate_attestation.py <attestation.json>")
        print("\nExample:")
        print('  python validate_attestation.py attestation.json')
        print('  echo \'{"attestation": {...}}\' | python validate_attestation.py -')
        sys.exit(1)
    
    input_file = sys.argv[1]
    
    try:
        if input_file == "-":
            data = json.load(sys.stdin)
        else:
            with open(input_file, "r") as f:
                data = json.load(f)
    except json.JSONDecodeError as e:
        print(f"❌ Invalid JSON: {e}")
        sys.exit(1)
    except FileNotFoundError:
        print(f"❌ File not found: {input_file}")
        sys.exit(1)
    
    errors = validate_attestation(data)
    
    if errors:
        print("❌ Validation failed with the following errors:\n")
        for i, error in enumerate(errors, 1):
            print(f"  {i}. {error}")
        sys.exit(1)
    else:
        print("✅ Attestation structure is valid!")
        print("\nStructure matches expected format:")
        print("  ✓ All required fields present")
        print("  ✓ Field types correct")
        print("  ✓ Array lengths correct (32 bytes for x, y, r, s, message_hash)")
        print("  ✓ account_id_hash format valid")
        sys.exit(0)


if __name__ == "__main__":
    main()

