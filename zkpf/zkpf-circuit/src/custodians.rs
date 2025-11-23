//! Hard-coded registry of custodian public keys that are allowed to sign attestations.
//!
//! The registry is intentionally small and deterministic so the circuit can look up the
//! secp256k1 public key associated with a `custodian_id` without relying on prover-supplied
//! witness data.  Update this list whenever onboarding a new custodian and regenerate the
//! trusted setup artifacts to bake the change into the proving/verifying keys.

use crate::gadgets::attestation::Secp256k1Pubkey;

pub const CUSTODIAN_ID_ZASHI: u32 = 8001;

#[derive(Clone, Copy, Debug)]
pub struct CustodianEntry {
    pub id: u32,
    pub pubkey: Secp256k1Pubkey,
}

const ENTRIES: [CustodianEntry; 4] = [
    CustodianEntry {
        id: 42,
        pubkey: Secp256k1Pubkey {
            x: [
                0x98, 0x9c, 0x0b, 0x76, 0xcb, 0x56, 0x39, 0x71, 0xfd, 0xc9, 0xbe, 0xf3, 0x1e, 0xc0,
                0x6c, 0x35, 0x60, 0xf3, 0x24, 0x9d, 0x6e, 0xe9, 0xe5, 0xd8, 0x3c, 0x57, 0x62, 0x55,
                0x96, 0xe0, 0x5f, 0x6f,
            ],
            y: [
                0x63, 0x1f, 0x4d, 0x05, 0xb3, 0xae, 0x51, 0x87, 0x76, 0xee, 0x08, 0x75, 0x5a, 0x77,
                0x03, 0xe6, 0x4b, 0x2e, 0xbc, 0x32, 0x54, 0x75, 0x04, 0xde, 0x0b, 0x55, 0xa1, 0x42,
                0xd4, 0xec, 0xdf, 0x80,
            ],
        },
    },
    CustodianEntry {
        id: 77,
        pubkey: Secp256k1Pubkey {
            x: [
                0xc7, 0x6e, 0xcb, 0x7a, 0x97, 0x2f, 0x33, 0x66, 0xd9, 0x82, 0xaf, 0x35, 0x93, 0x70,
                0x15, 0xc5, 0x67, 0x8e, 0xd4, 0x4c, 0xd0, 0xb2, 0x83, 0x87, 0x8e, 0x25, 0xd7, 0x60,
                0xee, 0xdf, 0xe5, 0x9f,
            ],
            y: [
                0x38, 0x82, 0xb2, 0x72, 0x88, 0x21, 0x55, 0x2f, 0x39, 0xea, 0x0d, 0x53, 0xae, 0xff,
                0x57, 0xa6, 0xd6, 0x91, 0x1c, 0xfc, 0x95, 0x58, 0x65, 0x39, 0x97, 0xd2, 0x0d, 0x65,
                0x38, 0xec, 0x08, 0x1a,
            ],
        },
    },
    CustodianEntry {
        id: 1337,
        pubkey: Secp256k1Pubkey {
            x: [
                0x9b, 0xdf, 0x9e, 0x67, 0xa5, 0xd0, 0xc9, 0x95, 0x6a, 0x07, 0x5a, 0x01, 0x0f, 0xe7,
                0x62, 0xbe, 0xb6, 0x33, 0x50, 0x04, 0x31, 0xde, 0xe7, 0x8e, 0xfe, 0xbc, 0x52, 0x7e,
                0x53, 0x31, 0x3b, 0x33,
            ],
            y: [
                0x94, 0x26, 0x46, 0x21, 0xa5, 0x96, 0x0e, 0x0e, 0xe2, 0x4c, 0x27, 0x92, 0x6f, 0x16,
                0xca, 0xd2, 0x90, 0x7f, 0x26, 0x36, 0x76, 0x2e, 0x8d, 0x5a, 0x17, 0xe9, 0x4a, 0xfd,
                0x8e, 0x9d, 0x2b, 0xb0,
            ],
        },
    },
    CustodianEntry {
        id: CUSTODIAN_ID_ZASHI,
        pubkey: Secp256k1Pubkey {
            x: [
                0x79, 0xbe, 0x66, 0x7e, 0xf9, 0xdc, 0xbb, 0xac, 0x55, 0xa0, 0x62, 0x95, 0xce, 0x87,
                0x0b, 0x07, 0x02, 0x9b, 0xfc, 0xdb, 0x2d, 0xce, 0x28, 0xd9, 0x59, 0xf2, 0x81, 0x5b,
                0x16, 0xf8, 0x17, 0x98,
            ],
            y: [
                0x48, 0x3a, 0xda, 0x77, 0x26, 0xa3, 0xc4, 0x65, 0x5d, 0xa4, 0xfb, 0xfc, 0x0e, 0x11,
                0x08, 0xa8, 0xfd, 0x17, 0xb4, 0x48, 0xa6, 0x85, 0x54, 0x19, 0x9c, 0x47, 0xd0, 0x8f,
                0xfb, 0x10, 0xd4, 0xb8,
            ],
        },
    },
];

const ALLOWED_IDS: [u32; 4] = [42, 77, 1337, CUSTODIAN_ID_ZASHI];

pub fn lookup_custodian(id: u32) -> Option<&'static CustodianEntry> {
    ENTRIES.iter().find(|entry| entry.id == id)
}

pub fn lookup_pubkey(id: u32) -> Option<&'static Secp256k1Pubkey> {
    lookup_custodian(id).map(|entry| &entry.pubkey)
}

pub fn allowed_custodian_ids() -> &'static [u32] {
    &ALLOWED_IDS
}

#[cfg(test)]
mod tests {
    use super::*;
    use k256::{
        ecdsa::{SigningKey, VerifyingKey},
        EncodedPoint,
    };

    #[test]
    fn allowed_ids_match_entries() {
        let mut ids_from_entries: Vec<u32> = ENTRIES.iter().map(|entry| entry.id).collect();
        ids_from_entries.sort_unstable();
        let mut ids = ALLOWED_IDS.to_vec();
        ids.sort_unstable();
        assert_eq!(ids_from_entries, ids, "ALLOWED_IDS must match ENTRIES");
    }

    #[test]
    fn registry_points_are_on_curve() {
        for entry in ENTRIES.iter() {
            let mut encoded = [0u8; 65];
            encoded[0] = 0x04;
            encoded[1..33].copy_from_slice(&entry.pubkey.x);
            encoded[33..65].copy_from_slice(&entry.pubkey.y);
            let point =
                EncodedPoint::from_bytes(encoded).expect("encoded point must use valid bytes");
            assert!(
                VerifyingKey::from_encoded_point(&point).is_ok(),
                "custodian {} point is not on curve",
                entry.id
            );
        }
    }

    #[test]
    fn registry_entries_match_expected_pubkeys() {
        const SK_42: [u8; 32] = [7u8; 32];
        const SK_77: [u8; 32] =
            hex_literal::hex!("2ec8d8d86fe5a4f4c5db0f826bea4722b8d2535d991a8f8a27c4b31c6d6cf3ce");
        const SK_1337: [u8; 32] = [
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x01, 0x23,
        ];
        const SK_ZASHI: [u8; 32] =
            hex_literal::hex!("0000000000000000000000000000000000000000000000000000000000000001");

        let fixtures: &[(u32, &[u8; 32])] = &[
            (42, &SK_42),
            (77, &SK_77),
            (1337, &SK_1337),
            (CUSTODIAN_ID_ZASHI, &SK_ZASHI),
        ];

        for &(custodian_id, sk_bytes) in fixtures {
            let entry = lookup_custodian(custodian_id)
                .unwrap_or_else(|| panic!("missing registry entry for {}", custodian_id));
            let signing_key =
                SigningKey::from_bytes(sk_bytes.as_slice()).expect("valid signing key bytes");
            let encoded = signing_key.verifying_key().to_encoded_point(false);
            let x = encoded
                .x()
                .expect("uncompressed points should include x-coordinate");
            let y = encoded
                .y()
                .expect("uncompressed points should include y-coordinate");
            assert_eq!(
                entry.pubkey.x.as_slice(),
                x.as_slice(),
                "custodian {} x-coordinate mismatch",
                custodian_id
            );
            assert_eq!(
                entry.pubkey.y.as_slice(),
                y.as_slice(),
                "custodian {} y-coordinate mismatch",
                custodian_id
            );
        }
    }
}
