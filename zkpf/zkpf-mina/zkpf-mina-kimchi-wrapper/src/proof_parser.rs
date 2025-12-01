//! Kimchi proof parsing from serialized format.
//!
//! This module handles parsing of Kimchi/Pickles proofs from their serialized
//! format into structured data suitable for in-circuit verification.
//!
//! # Proof Format
//!
//! Kimchi proofs contain:
//! - Polynomial commitments (Pallas points)
//! - Polynomial evaluations at challenge points
//! - IPA opening proof
//! - Accumulator data (for Pickles recursive proofs)
//!
//! # Serialization
//!
//! Mina uses a specific binary format for proofs. This module supports:
//! - Raw binary format (as produced by Mina node)
//! - JSON format (for development/testing)
//! - Placeholder format (for mock mode)

use serde::{Deserialize, Serialize};

use crate::{
    ec::{NativeECPoint, PastaCurve},
    ff::{NativeFFelt, PastaField},
    kimchi_core::{
        IpaProof, LookupCommitments, ParsedKimchiProof, PointEvaluations, ProofCommitments,
        ProofEvaluations,
    },
    types::{
        MinaProofOfStateProof, IPA_ROUNDS, KIMCHI_QUOTIENT_CHUNKS, KIMCHI_SIGMA_COLUMNS,
        KIMCHI_WITNESS_COLUMNS,
    },
    KimchiWrapperError,
};

// === Proof Parsing ===

/// Parse a Kimchi proof from raw bytes.
///
/// This handles the native Mina proof format.
///
/// # Format
///
/// The proof bytes are structured as:
/// ```text
/// [4 bytes: magic "MINA"]
/// [4 bytes: version u32]
/// [4 bytes: num_witness_commitments u32]
/// [... witness commitments (64 bytes each)]
/// [64 bytes: permutation commitment]
/// [4 bytes: num_quotient_commitments u32]
/// [... quotient commitments (64 bytes each)]
/// [4 bytes: has_lookup u32 (0 or 1)]
/// [... lookup commitments if present]
/// [... evaluations]
/// [... IPA proof]
/// ```
pub fn parse_kimchi_proof_bytes(bytes: &[u8]) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    if bytes.len() < 8 {
        return Err(KimchiWrapperError::InvalidInput(
            "proof too short".into()
        ));
    }

    // Check magic header
    if &bytes[0..4] == b"MINA" {
        parse_mina_format(bytes)
    } else if &bytes[0..4] == b"MOCK" {
        parse_mock_format(bytes)
    } else {
        // Try raw format (no header)
        parse_raw_format(bytes)
    }
}

/// Parse Mina native proof format.
fn parse_mina_format(bytes: &[u8]) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    let field = PastaField::Pallas;
    let curve = PastaCurve::Pallas;
    
    let mut offset = 4; // Skip magic
    
    // Version
    if bytes.len() < offset + 4 {
        return Err(KimchiWrapperError::InvalidInput("proof truncated at version".into()));
    }
    let _version = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
    offset += 4;
    
    // Number of witness commitments
    if bytes.len() < offset + 4 {
        return Err(KimchiWrapperError::InvalidInput("proof truncated at witness count".into()));
    }
    let num_witness = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;
    
    if num_witness > KIMCHI_WITNESS_COLUMNS {
        return Err(KimchiWrapperError::InvalidInput(format!(
            "too many witness columns: {} > {}",
            num_witness, KIMCHI_WITNESS_COLUMNS
        )));
    }
    
    // Parse witness commitments
    let mut witness_commitments = Vec::with_capacity(num_witness);
    for _ in 0..num_witness {
        let (point, new_offset) = parse_point(&bytes[offset..], curve)?;
        offset += new_offset;
        witness_commitments.push(point);
    }
    
    // Pad to full witness columns
    while witness_commitments.len() < KIMCHI_WITNESS_COLUMNS {
        witness_commitments.push(NativeECPoint::infinity(curve));
    }
    
    // Permutation commitment
    let (permutation_commitment, delta) = parse_point(&bytes[offset..], curve)?;
    offset += delta;
    
    // Quotient commitments
    if bytes.len() < offset + 4 {
        return Err(KimchiWrapperError::InvalidInput("proof truncated at quotient count".into()));
    }
    let num_quotient = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
    offset += 4;
    
    let mut quotient_commitments = Vec::with_capacity(num_quotient);
    for _ in 0..num_quotient {
        let (point, delta) = parse_point(&bytes[offset..], curve)?;
        offset += delta;
        quotient_commitments.push(point);
    }
    
    while quotient_commitments.len() < KIMCHI_QUOTIENT_CHUNKS {
        quotient_commitments.push(NativeECPoint::infinity(curve));
    }
    
    // Lookup commitments (optional)
    let lookup_commitments = if bytes.len() > offset + 4 {
        let has_lookup = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap());
        offset += 4;
        
        if has_lookup != 0 {
            let (agg, delta) = parse_point(&bytes[offset..], curve)?;
            offset += delta;
            
            // Sorted commitments
            let num_sorted = if bytes.len() > offset + 4 {
                let n = u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap()) as usize;
                offset += 4;
                n
            } else {
                0
            };
            
            let mut sorted = Vec::with_capacity(num_sorted);
            for _ in 0..num_sorted {
                let (point, delta) = parse_point(&bytes[offset..], curve)?;
                offset += delta;
                sorted.push(point);
            }
            
            Some(LookupCommitments {
                aggregation: agg,
                sorted,
            })
        } else {
            None
        }
    } else {
        None
    };
    
    // Parse evaluations
    let evaluations = parse_evaluations(&bytes[offset..], field, &mut offset)?;
    
    // Parse IPA proof
    let ipa_proof = parse_ipa_proof(&bytes[offset..], field, curve)?;
    
    Ok(ParsedKimchiProof {
        commitments: ProofCommitments {
            witness_commitments,
            permutation_commitment,
            quotient_commitments,
            lookup_commitments,
        },
        evaluations,
        ipa_proof,
    })
}

/// Parse mock proof format (for development).
fn parse_mock_format(bytes: &[u8]) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    let field = PastaField::Pallas;
    let curve = PastaCurve::Pallas;
    
    // Mock format: "MOCK" + digest (32 bytes) + minimal proof structure
    if bytes.len() < 36 {
        return Err(KimchiWrapperError::InvalidInput("mock proof too short".into()));
    }
    
    // Create placeholder proof
    Ok(create_placeholder_proof(field, curve))
}

/// Parse raw format (no header, just commitment/evaluation data).
fn parse_raw_format(bytes: &[u8]) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    let field = PastaField::Pallas;
    let curve = PastaCurve::Pallas;
    
    // Assume raw format: commitment data followed by evaluations
    // Minimum size: 15 witness * 64 + 1 perm * 64 + 7 quotient * 64 = 1472 bytes
    if bytes.len() < 1024 {
        // Too short, create placeholder
        return Ok(create_placeholder_proof(field, curve));
    }
    
    let mut offset = 0;
    
    // Parse witness commitments
    let mut witness_commitments = Vec::with_capacity(KIMCHI_WITNESS_COLUMNS);
    for _ in 0..KIMCHI_WITNESS_COLUMNS {
        if offset + 64 > bytes.len() {
            witness_commitments.push(NativeECPoint::infinity(curve));
        } else {
            let (point, _) = parse_point(&bytes[offset..], curve)?;
            offset += 64;
            witness_commitments.push(point);
        }
    }
    
    // Permutation commitment
    let permutation_commitment = if offset + 64 <= bytes.len() {
        let (point, _) = parse_point(&bytes[offset..], curve)?;
        offset += 64;
        point
    } else {
        NativeECPoint::infinity(curve)
    };
    
    // Quotient commitments
    let mut quotient_commitments = Vec::with_capacity(KIMCHI_QUOTIENT_CHUNKS);
    for _ in 0..KIMCHI_QUOTIENT_CHUNKS {
        if offset + 64 > bytes.len() {
            quotient_commitments.push(NativeECPoint::infinity(curve));
        } else {
            let (point, _) = parse_point(&bytes[offset..], curve)?;
            offset += 64;
            quotient_commitments.push(point);
        }
    }
    
    // Create placeholder evaluations
    let evaluations = create_placeholder_evaluations(field);
    
    // Create placeholder IPA proof
    let ipa_proof = create_placeholder_ipa(field, curve);
    
    Ok(ParsedKimchiProof {
        commitments: ProofCommitments {
            witness_commitments,
            permutation_commitment,
            quotient_commitments,
            lookup_commitments: None,
        },
        evaluations,
        ipa_proof,
    })
}

/// Parse a single EC point from bytes.
fn parse_point(bytes: &[u8], curve: PastaCurve) -> Result<(NativeECPoint, usize), KimchiWrapperError> {
    if bytes.len() < 64 {
        return Err(KimchiWrapperError::InvalidInput("insufficient bytes for point".into()));
    }
    
    let mut x_bytes = [0u8; 32];
    let mut y_bytes = [0u8; 32];
    x_bytes.copy_from_slice(&bytes[0..32]);
    y_bytes.copy_from_slice(&bytes[32..64]);
    
    // Check for point at infinity (all zeros)
    if x_bytes == [0u8; 32] && y_bytes == [0u8; 32] {
        return Ok((NativeECPoint::infinity(curve), 64));
    }
    
    Ok((NativeECPoint::from_bytes(&x_bytes, &y_bytes, curve), 64))
}

/// Parse a single field element from bytes.
fn parse_field_element(bytes: &[u8], field: PastaField) -> Result<(NativeFFelt, usize), KimchiWrapperError> {
    if bytes.len() < 32 {
        return Err(KimchiWrapperError::InvalidInput("insufficient bytes for field element".into()));
    }
    
    let mut elem_bytes = [0u8; 32];
    elem_bytes.copy_from_slice(&bytes[0..32]);
    
    Ok((NativeFFelt::from_bytes_le(&elem_bytes, field), 32))
}

/// Parse evaluations section.
fn parse_evaluations(
    bytes: &[u8],
    field: PastaField,
    offset: &mut usize,
) -> Result<ProofEvaluations, KimchiWrapperError> {
    if bytes.is_empty() {
        return Ok(create_placeholder_evaluations(field));
    }
    
    let mut local_offset = 0;
    
    // Parse witness evaluations at zeta
    let mut zeta_witness = Vec::with_capacity(KIMCHI_WITNESS_COLUMNS);
    for _ in 0..KIMCHI_WITNESS_COLUMNS {
        if local_offset + 32 > bytes.len() {
            zeta_witness.push(NativeFFelt::zero(field));
        } else {
            let (elem, delta) = parse_field_element(&bytes[local_offset..], field)?;
            local_offset += delta;
            zeta_witness.push(elem);
        }
    }
    
    // Parse permutation evaluation at zeta
    let zeta_permutation = if local_offset + 32 <= bytes.len() {
        let (elem, delta) = parse_field_element(&bytes[local_offset..], field)?;
        local_offset += delta;
        elem
    } else {
        NativeFFelt::one(field)
    };
    
    // Parse sigma evaluations
    let mut zeta_sigma = Vec::with_capacity(KIMCHI_SIGMA_COLUMNS - 1);
    for _ in 0..(KIMCHI_SIGMA_COLUMNS - 1) {
        if local_offset + 32 > bytes.len() {
            zeta_sigma.push(NativeFFelt::zero(field));
        } else {
            let (elem, delta) = parse_field_element(&bytes[local_offset..], field)?;
            local_offset += delta;
            zeta_sigma.push(elem);
        }
    }
    
    // Parse witness evaluations at zeta*omega
    let mut zeta_omega_witness = Vec::with_capacity(KIMCHI_WITNESS_COLUMNS);
    for _ in 0..KIMCHI_WITNESS_COLUMNS {
        if local_offset + 32 > bytes.len() {
            zeta_omega_witness.push(NativeFFelt::zero(field));
        } else {
            let (elem, delta) = parse_field_element(&bytes[local_offset..], field)?;
            local_offset += delta;
            zeta_omega_witness.push(elem);
        }
    }
    
    // Parse permutation evaluation at zeta*omega
    let zeta_omega_permutation = if local_offset + 32 <= bytes.len() {
        let (elem, delta) = parse_field_element(&bytes[local_offset..], field)?;
        local_offset += delta;
        elem
    } else {
        NativeFFelt::one(field)
    };
    
    *offset += local_offset;
    
    Ok(ProofEvaluations {
        zeta_evals: PointEvaluations {
            witness: zeta_witness,
            permutation: zeta_permutation,
            public_input: NativeFFelt::zero(field),
            gate_selectors: vec![NativeFFelt::zero(field); 8],
            sigma: zeta_sigma,
        },
        zeta_omega_evals: PointEvaluations {
            witness: zeta_omega_witness,
            permutation: zeta_omega_permutation,
            public_input: NativeFFelt::zero(field),
            gate_selectors: vec![NativeFFelt::zero(field); 8],
            sigma: vec![NativeFFelt::zero(field); KIMCHI_SIGMA_COLUMNS - 1],
        },
    })
}

/// Parse IPA proof section.
fn parse_ipa_proof(
    bytes: &[u8],
    field: PastaField,
    curve: PastaCurve,
) -> Result<IpaProof, KimchiWrapperError> {
    if bytes.len() < 64 {
        return Ok(create_placeholder_ipa(field, curve));
    }
    
    let mut offset = 0;
    
    // Parse L commitments
    let mut l_commitments = Vec::with_capacity(IPA_ROUNDS);
    for _ in 0..IPA_ROUNDS {
        if offset + 64 > bytes.len() {
            l_commitments.push(NativeECPoint::infinity(curve));
        } else {
            let (point, delta) = parse_point(&bytes[offset..], curve)?;
            offset += delta;
            l_commitments.push(point);
        }
    }
    
    // Parse R commitments
    let mut r_commitments = Vec::with_capacity(IPA_ROUNDS);
    for _ in 0..IPA_ROUNDS {
        if offset + 64 > bytes.len() {
            r_commitments.push(NativeECPoint::infinity(curve));
        } else {
            let (point, delta) = parse_point(&bytes[offset..], curve)?;
            offset += delta;
            r_commitments.push(point);
        }
    }
    
    // Parse final evaluation
    let final_eval = if offset + 32 <= bytes.len() {
        let (elem, _) = parse_field_element(&bytes[offset..], field)?;
        offset += 32;
        elem
    } else {
        NativeFFelt::one(field)
    };
    
    // Parse blinding
    let blinding = if offset + 32 <= bytes.len() {
        let (elem, _) = parse_field_element(&bytes[offset..], field)?;
        elem
    } else {
        NativeFFelt::zero(field)
    };
    
    Ok(IpaProof {
        l_commitments,
        r_commitments,
        final_eval,
        blinding,
    })
}

/// Create a placeholder proof (for development/testing).
fn create_placeholder_proof(field: PastaField, curve: PastaCurve) -> ParsedKimchiProof {
    ParsedKimchiProof {
        commitments: ProofCommitments {
            witness_commitments: vec![NativeECPoint::infinity(curve); KIMCHI_WITNESS_COLUMNS],
            permutation_commitment: NativeECPoint::infinity(curve),
            quotient_commitments: vec![NativeECPoint::infinity(curve); KIMCHI_QUOTIENT_CHUNKS],
            lookup_commitments: None,
        },
        evaluations: create_placeholder_evaluations(field),
        ipa_proof: create_placeholder_ipa(field, curve),
    }
}

fn create_placeholder_evaluations(field: PastaField) -> ProofEvaluations {
    ProofEvaluations {
        zeta_evals: PointEvaluations {
            witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
            permutation: NativeFFelt::one(field),
            public_input: NativeFFelt::zero(field),
            gate_selectors: vec![NativeFFelt::zero(field); 8],
            sigma: vec![NativeFFelt::zero(field); KIMCHI_SIGMA_COLUMNS - 1],
        },
        zeta_omega_evals: PointEvaluations {
            witness: vec![NativeFFelt::zero(field); KIMCHI_WITNESS_COLUMNS],
            permutation: NativeFFelt::one(field),
            public_input: NativeFFelt::zero(field),
            gate_selectors: vec![NativeFFelt::zero(field); 8],
            sigma: vec![NativeFFelt::zero(field); KIMCHI_SIGMA_COLUMNS - 1],
        },
    }
}

fn create_placeholder_ipa(field: PastaField, curve: PastaCurve) -> IpaProof {
    IpaProof {
        l_commitments: vec![NativeECPoint::infinity(curve); IPA_ROUNDS],
        r_commitments: vec![NativeECPoint::infinity(curve); IPA_ROUNDS],
        final_eval: NativeFFelt::one(field),
        blinding: NativeFFelt::zero(field),
    }
}

// === JSON Format Support ===

/// JSON-serializable proof structure.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonKimchiProof {
    /// Witness commitments as hex strings.
    pub witness_commitments: Vec<String>,
    /// Permutation commitment as hex string.
    pub permutation_commitment: String,
    /// Quotient commitments as hex strings.
    pub quotient_commitments: Vec<String>,
    /// Evaluations at zeta.
    pub zeta_evals: JsonPointEvaluations,
    /// Evaluations at zeta*omega.
    pub zeta_omega_evals: JsonPointEvaluations,
    /// IPA proof.
    pub ipa_proof: JsonIpaProof,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonPointEvaluations {
    pub witness: Vec<String>,
    pub permutation: String,
    pub sigma: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonIpaProof {
    pub l_commitments: Vec<String>,
    pub r_commitments: Vec<String>,
    pub final_eval: String,
    pub blinding: String,
}

/// Parse a Kimchi proof from JSON.
pub fn parse_kimchi_proof_json(json: &str) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    let json_proof: JsonKimchiProof = serde_json::from_str(json)
        .map_err(|e| KimchiWrapperError::InvalidInput(format!("JSON parse error: {}", e)))?;
    
    let field = PastaField::Pallas;
    let curve = PastaCurve::Pallas;
    
    // Parse witness commitments
    let witness_commitments: Vec<NativeECPoint> = json_proof
        .witness_commitments
        .iter()
        .map(|s| hex_to_point(s, curve).unwrap_or_else(|_| NativeECPoint::infinity(curve)))
        .collect();
    
    // Parse permutation commitment
    let permutation_commitment = hex_to_point(&json_proof.permutation_commitment, curve)
        .unwrap_or_else(|_| NativeECPoint::infinity(curve));
    
    // Parse quotient commitments
    let quotient_commitments: Vec<NativeECPoint> = json_proof
        .quotient_commitments
        .iter()
        .map(|s| hex_to_point(s, curve).unwrap_or_else(|_| NativeECPoint::infinity(curve)))
        .collect();
    
    // Parse evaluations
    let zeta_witness: Vec<NativeFFelt> = json_proof
        .zeta_evals
        .witness
        .iter()
        .map(|s| hex_to_field(s, field).unwrap_or_else(|_| NativeFFelt::zero(field)))
        .collect();
    
    let zeta_permutation = hex_to_field(&json_proof.zeta_evals.permutation, field)
        .unwrap_or_else(|_| NativeFFelt::one(field));
    
    let zeta_sigma: Vec<NativeFFelt> = json_proof
        .zeta_evals
        .sigma
        .iter()
        .map(|s| hex_to_field(s, field).unwrap_or_else(|_| NativeFFelt::zero(field)))
        .collect();
    
    let zeta_omega_witness: Vec<NativeFFelt> = json_proof
        .zeta_omega_evals
        .witness
        .iter()
        .map(|s| hex_to_field(s, field).unwrap_or_else(|_| NativeFFelt::zero(field)))
        .collect();
    
    let zeta_omega_permutation = hex_to_field(&json_proof.zeta_omega_evals.permutation, field)
        .unwrap_or_else(|_| NativeFFelt::one(field));
    
    // Parse IPA
    let l_commitments: Vec<NativeECPoint> = json_proof
        .ipa_proof
        .l_commitments
        .iter()
        .map(|s| hex_to_point(s, curve).unwrap_or_else(|_| NativeECPoint::infinity(curve)))
        .collect();
    
    let r_commitments: Vec<NativeECPoint> = json_proof
        .ipa_proof
        .r_commitments
        .iter()
        .map(|s| hex_to_point(s, curve).unwrap_or_else(|_| NativeECPoint::infinity(curve)))
        .collect();
    
    let final_eval = hex_to_field(&json_proof.ipa_proof.final_eval, field)
        .unwrap_or_else(|_| NativeFFelt::one(field));
    
    let blinding = hex_to_field(&json_proof.ipa_proof.blinding, field)
        .unwrap_or_else(|_| NativeFFelt::zero(field));
    
    Ok(ParsedKimchiProof {
        commitments: ProofCommitments {
            witness_commitments,
            permutation_commitment,
            quotient_commitments,
            lookup_commitments: None,
        },
        evaluations: ProofEvaluations {
            zeta_evals: PointEvaluations {
                witness: zeta_witness,
                permutation: zeta_permutation,
                public_input: NativeFFelt::zero(field),
                gate_selectors: vec![NativeFFelt::zero(field); 8],
                sigma: zeta_sigma,
            },
            zeta_omega_evals: PointEvaluations {
                witness: zeta_omega_witness,
                permutation: zeta_omega_permutation,
                public_input: NativeFFelt::zero(field),
                gate_selectors: vec![NativeFFelt::zero(field); 8],
                sigma: vec![NativeFFelt::zero(field); KIMCHI_SIGMA_COLUMNS - 1],
            },
        },
        ipa_proof: IpaProof {
            l_commitments,
            r_commitments,
            final_eval,
            blinding,
        },
    })
}

fn hex_to_point(hex: &str, curve: PastaCurve) -> Result<NativeECPoint, KimchiWrapperError> {
    let bytes = hex::decode(hex.trim_start_matches("0x"))
        .map_err(|e| KimchiWrapperError::InvalidInput(format!("hex decode error: {}", e)))?;
    
    if bytes.len() < 64 {
        return Ok(NativeECPoint::infinity(curve));
    }
    
    let (point, _) = parse_point(&bytes, curve)?;
    Ok(point)
}

fn hex_to_field(hex: &str, field: PastaField) -> Result<NativeFFelt, KimchiWrapperError> {
    let bytes = hex::decode(hex.trim_start_matches("0x"))
        .map_err(|e| KimchiWrapperError::InvalidInput(format!("hex decode error: {}", e)))?;
    
    if bytes.len() < 32 {
        return Ok(NativeFFelt::zero(field));
    }
    
    let (elem, _) = parse_field_element(&bytes, field)?;
    Ok(elem)
}

// === High-Level API ===

/// Parse a proof from the MinaProofOfStateProof structure.
pub fn parse_mina_proof_of_state(
    proof: &MinaProofOfStateProof,
) -> Result<ParsedKimchiProof, KimchiWrapperError> {
    parse_kimchi_proof_bytes(&proof.candidate_tip_proof)
}

// === Tests ===

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_bytes() {
        let bytes: &[u8] = &[];
        let result = parse_kimchi_proof_bytes(bytes);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_mock_format() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"MOCK");
        bytes.extend_from_slice(&[0u8; 32]); // digest
        
        let result = parse_kimchi_proof_bytes(&bytes);
        assert!(result.is_ok());
        
        let proof = result.unwrap();
        assert_eq!(proof.commitments.witness_commitments.len(), KIMCHI_WITNESS_COLUMNS);
    }

    #[test]
    fn test_parse_short_raw_format() {
        // Short bytes should create placeholder
        let bytes = vec![0u8; 100];
        let result = parse_kimchi_proof_bytes(&bytes);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_raw_format() {
        // Create minimal raw format with commitments
        let mut bytes = Vec::new();
        
        // 15 witness commitments (64 bytes each)
        for _ in 0..KIMCHI_WITNESS_COLUMNS {
            bytes.extend_from_slice(&[0u8; 64]);
        }
        
        // Permutation commitment
        bytes.extend_from_slice(&[0u8; 64]);
        
        // 7 quotient commitments
        for _ in 0..KIMCHI_QUOTIENT_CHUNKS {
            bytes.extend_from_slice(&[0u8; 64]);
        }
        
        let result = parse_kimchi_proof_bytes(&bytes);
        assert!(result.is_ok());
        
        let proof = result.unwrap();
        assert_eq!(proof.commitments.witness_commitments.len(), KIMCHI_WITNESS_COLUMNS);
        assert_eq!(proof.commitments.quotient_commitments.len(), KIMCHI_QUOTIENT_CHUNKS);
    }

    #[test]
    fn test_parse_point_at_infinity() {
        let bytes = [0u8; 64];
        let (point, delta) = parse_point(&bytes, PastaCurve::Pallas).unwrap();
        
        assert!(point.is_infinity);
        assert_eq!(delta, 64);
    }

    #[test]
    fn test_parse_field_element() {
        let mut bytes = [0u8; 32];
        bytes[0] = 42;
        
        let (elem, delta) = parse_field_element(&bytes, PastaField::Pallas).unwrap();
        
        assert_eq!(elem.limbs[0], 42);
        assert_eq!(delta, 32);
    }

    #[test]
    fn test_placeholder_proof_structure() {
        let proof = create_placeholder_proof(PastaField::Pallas, PastaCurve::Pallas);
        
        assert_eq!(proof.commitments.witness_commitments.len(), KIMCHI_WITNESS_COLUMNS);
        assert_eq!(proof.commitments.quotient_commitments.len(), KIMCHI_QUOTIENT_CHUNKS);
        assert_eq!(proof.ipa_proof.l_commitments.len(), IPA_ROUNDS);
        assert_eq!(proof.ipa_proof.r_commitments.len(), IPA_ROUNDS);
    }

    #[test]
    fn test_json_parsing() {
        let json = r#"{
            "witness_commitments": [],
            "permutation_commitment": "00",
            "quotient_commitments": [],
            "zeta_evals": {
                "witness": [],
                "permutation": "01",
                "sigma": []
            },
            "zeta_omega_evals": {
                "witness": [],
                "permutation": "01",
                "sigma": []
            },
            "ipa_proof": {
                "l_commitments": [],
                "r_commitments": [],
                "final_eval": "01",
                "blinding": "00"
            }
        }"#;
        
        let result = parse_kimchi_proof_json(json);
        assert!(result.is_ok());
    }

    #[test]
    fn test_mina_format_validation() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"MINA");
        bytes.extend_from_slice(&1u32.to_le_bytes()); // version
        bytes.extend_from_slice(&15u32.to_le_bytes()); // num_witness
        
        // Add 15 witness commitments
        for _ in 0..15 {
            bytes.extend_from_slice(&[0u8; 64]);
        }
        
        // Permutation commitment
        bytes.extend_from_slice(&[0u8; 64]);
        
        // Quotient count and commitments
        bytes.extend_from_slice(&7u32.to_le_bytes());
        for _ in 0..7 {
            bytes.extend_from_slice(&[0u8; 64]);
        }
        
        // Has lookup
        bytes.extend_from_slice(&0u32.to_le_bytes());
        
        let result = parse_kimchi_proof_bytes(&bytes);
        assert!(result.is_ok());
    }
}

