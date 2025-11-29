# Guide: Generating Orchard Fixed-Base Window Tables

## Objective

Generate precomputed window tables for fixed-base scalar multiplication over the Pallas curve, compatible with `halo2_gadgets::ecc::chip::FixedPoints` trait. These tables enable efficient in-circuit scalar multiplication for the Orchard protocol's fixed bases.

---

## Background

### What Are Fixed-Base Window Tables?

Fixed-base scalar multiplication computes `[k]B` where `B` is a known fixed point and `k` is a scalar. Instead of computing this directly (expensive in-circuit), we precompute tables of multiples of `B` at specific "windows" of the scalar.

For a scalar `k` decomposed into `w`-bit windows:
```
k = k_0 + k_1 * 2^w + k_2 * 2^(2w) + ... + k_n * 2^(nw)
```

We precompute `[0]B, [1]B, [2]B, ..., [2^w - 1]B` for each window position, shifted appropriately.

### Orchard's Window Parameters

From `halo2_gadgets/src/ecc/chip/constants.rs`:
```rust
/// Number of bits in each window for fixed-base scalar multiplication
pub const FIXED_BASE_WINDOW_SIZE: usize = 3;

/// Number of windows for a full-width scalar (255 bits / 3 = 85 windows)
pub const NUM_WINDOWS: usize = 85;

/// Number of windows for a short scalar (used for value commitment)
pub const NUM_WINDOWS_SHORT: usize = 22;
```

---

## Step 1: Identify the Fixed Bases

The Orchard protocol uses these fixed base points (from Orchard spec):

### 1. NullifierK
Used for nullifier derivation: `nf = Extract([PRF_nk(rho) + psi]NullifierK + cm)`

Generator derivation:
```
NullifierK = GroupHash("z.cash:Orchard-NullifierK", "")
```

### 2. ValueCommitV  
Used for value commitment: `cv = [v]ValueCommitV + [rcv]ValueCommitR`

Generator derivation:
```
ValueCommitV = GroupHash("z.cash:Orchard-cv", "v")
```

### 3. ValueCommitR (same as NoteCommitR for Orchard)
The randomness base for value commitments.

Generator derivation:
```
ValueCommitR = GroupHash("z.cash:Orchard-cv", "r")
```

### 4. SpendAuthG
Used for spend authorization signatures.

Generator derivation:
```
SpendAuthG = GroupHash("z.cash:Orchard-SpendAuthG", "")
```

### 5. NoteCommitR
Randomness base for note commitments.

Generator derivation:
```
NoteCommitR = GroupHash("z.cash:Orchard-NoteCommit-r", "")
```

### 6. CommitIvkR
Randomness base for IVK commitment.

Generator derivation:
```
CommitIvkR = GroupHash("z.cash:Orchard-CommitIvk-r", "")
```

---

## Step 2: Implement GroupHash for Pallas

GroupHash maps a personalization string and message to a curve point using the Simplified SWU (SSWU) hash-to-curve method.

```rust
use pasta_curves::pallas;
use blake2b_simd::Params;

/// GroupHash as specified in the Zcash protocol
pub fn group_hash(personalization: &[u8], message: &[u8]) -> Option<pallas::Point> {
    // Domain separator for Pallas
    const GH_FIRST_BLOCK: &[u8] = b"z.cash:Zcash_GH_";
    
    // Hash personalization || GH_FIRST_BLOCK || message
    let mut state = Params::new()
        .hash_length(64)
        .personal(personalization)
        .to_state();
    state.update(GH_FIRST_BLOCK);
    state.update(message);
    
    let hash = state.finalize();
    
    // Use hash output to derive curve point via SSWU
    hash_to_curve_sswu(hash.as_bytes())
}

/// Simplified SWU hash-to-curve for Pallas
fn hash_to_curve_sswu(input: &[u8]) -> Option<pallas::Point> {
    // Implementation follows draft-irtf-cfrg-hash-to-curve
    // Section: Simplified SWU for AB == 0
    //
    // Pallas parameters:
    // - A = 0, B = 5
    // - p = 0x40000000000000000000000000000000224698fc094cf91b992d30ed00000001
    // - Z = -13 (the SSWU constant)
    
    // ... (implement SSWU algorithm)
    todo!("Implement SSWU hash-to-curve")
}
```

---

## Step 3: Generate Window Tables

For each fixed base `B`, generate the window table:

```rust
use pasta_curves::{pallas, group::Group};
use ff::PrimeField;

/// Window table for fixed-base scalar multiplication
pub struct FixedBaseWindowTable {
    /// For each window i, contains [0]B_i, [1]B_i, ..., [7]B_i
    /// where B_i = [2^(3i)]B
    pub windows: Vec<[(pallas::Base, pallas::Base); 8]>,
}

/// Generate window table for a fixed base point
pub fn generate_window_table(base: pallas::Point) -> FixedBaseWindowTable {
    const WINDOW_SIZE: usize = 3;  // 3-bit windows
    const NUM_WINDOWS: usize = 85; // ceil(255 / 3)
    const WINDOW_ELEMENTS: usize = 1 << WINDOW_SIZE; // 8 elements per window
    
    let mut windows = Vec::with_capacity(NUM_WINDOWS);
    let mut base_power = base; // B_i = [2^(3i)]B
    
    for window_idx in 0..NUM_WINDOWS {
        let mut window = [(pallas::Base::zero(), pallas::Base::zero()); WINDOW_ELEMENTS];
        
        // Identity point (0 * B_i) - use special encoding
        window[0] = encode_identity();
        
        // Compute [1]B_i, [2]B_i, ..., [7]B_i
        let mut current = base_power;
        for k in 1..WINDOW_ELEMENTS {
            let affine = current.to_affine();
            window[k] = (affine.x, affine.y);
            current = current + base_power;
        }
        
        windows.push(window);
        
        // B_{i+1} = [2^3]B_i = [8]B_i
        base_power = base_power.double().double().double();
    }
    
    FixedBaseWindowTable { windows }
}

fn encode_identity() -> (pallas::Base, pallas::Base) {
    // Special encoding for identity - use y = 0 which is not on curve
    (pallas::Base::zero(), pallas::Base::zero())
}
```

---

## Step 4: Generate Lagrange Coefficients (for x-coordinate interpolation)

The ECC chip uses Lagrange interpolation to compute x-coordinates from window indices:

```rust
/// Compute Lagrange basis coefficients for a window
pub fn compute_lagrange_coeffs(
    window_points: &[(pallas::Base, pallas::Base); 8],
) -> [pallas::Base; 8] {
    // For indices 0..7, compute Lagrange basis polynomials
    // L_j(x) = Π_{i≠j} (x - x_i) / (x_j - x_i)
    
    let mut coeffs = [pallas::Base::zero(); 8];
    
    for j in 0..8 {
        let mut num = pallas::Base::one();
        let mut den = pallas::Base::one();
        
        for i in 0..8 {
            if i != j {
                // num *= (X - i) evaluated at the window index
                // den *= (j - i)
                let i_fe = pallas::Base::from(i as u64);
                let j_fe = pallas::Base::from(j as u64);
                den *= j_fe - i_fe;
            }
        }
        
        coeffs[j] = num * den.invert().unwrap();
    }
    
    coeffs
}
```

---

## Step 5: Implement the FixedPoints Trait

```rust
use halo2_gadgets::ecc::{
    chip::{FixedPoint, FixedPoints, H, NUM_WINDOWS, NUM_WINDOWS_SHORT},
};

/// Orchard-compatible fixed bases for the PoF circuit
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PofFixedBases {
    NullifierK,
    ValueCommitV,
    SpendAuthG,
    NoteCommitR,
    CommitIvkR,
}

/// Full-width fixed bases (255-bit scalar)
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PofFixedBasesFull {
    NullifierK,
    ValueCommitV,
    SpendAuthG,
    NoteCommitR,
    CommitIvkR,
}

impl FixedPoints<pallas::Affine> for PofFixedBases {
    type FullScalar = PofFixedBasesFull;
    type ShortScalar = PofValueCommitV;  // Only ValueCommitV uses short scalar
    type Base = PofNullifierK;           // Base type for non-scalar operations
}

impl FixedPoint<pallas::Affine> for PofFixedBasesFull {
    type FixedScalarKind = FullScalar;

    fn generator(&self) -> pallas::Affine {
        match self {
            Self::NullifierK => NULLIFIER_K_GENERATOR,
            Self::ValueCommitV => VALUE_COMMIT_V_GENERATOR,
            Self::SpendAuthG => SPEND_AUTH_G_GENERATOR,
            Self::NoteCommitR => NOTE_COMMIT_R_GENERATOR,
            Self::CommitIvkR => COMMIT_IVK_R_GENERATOR,
        }
    }

    fn u(&self) -> Vec<[[u8; 32]; H]> {
        // Return the precomputed window table for this base
        match self {
            Self::NullifierK => NULLIFIER_K_U.to_vec(),
            Self::ValueCommitV => VALUE_COMMIT_V_U.to_vec(),
            // ... etc
        }
    }

    fn z(&self) -> Vec<u64> {
        // Return the z-values for incomplete addition handling
        match self {
            Self::NullifierK => NULLIFIER_K_Z.to_vec(),
            // ... etc
        }
    }
}
```

---

## Step 6: Precompute and Serialize Tables

Create a build script or xtask to generate and serialize the tables:

```rust
// xtask/src/gen_fixed_bases.rs

use std::fs::File;
use std::io::Write;

fn main() {
    // 1. Compute each fixed base via GroupHash
    let nullifier_k = group_hash(b"z.cash:Orchard-NullifierK", b"").unwrap();
    let value_commit_v = group_hash(b"z.cash:Orchard-cv", b"v").unwrap();
    let value_commit_r = group_hash(b"z.cash:Orchard-cv", b"r").unwrap();
    let spend_auth_g = group_hash(b"z.cash:Orchard-SpendAuthG", b"").unwrap();
    let note_commit_r = group_hash(b"z.cash:Orchard-NoteCommit-r", b"").unwrap();
    let commit_ivk_r = group_hash(b"z.cash:Orchard-CommitIvk-r", b"").unwrap();

    // 2. Generate window tables for each
    let bases = [
        ("NULLIFIER_K", nullifier_k),
        ("VALUE_COMMIT_V", value_commit_v),
        ("VALUE_COMMIT_R", value_commit_r),
        ("SPEND_AUTH_G", spend_auth_g),
        ("NOTE_COMMIT_R", note_commit_r),
        ("COMMIT_IVK_R", commit_ivk_r),
    ];

    let mut output = String::new();
    output.push_str("//! Auto-generated fixed base window tables\n\n");
    output.push_str("use pasta_curves::pallas;\n\n");

    for (name, base) in bases {
        let table = generate_window_table(base);
        
        // Output generator point
        let gen_affine = base.to_affine();
        output.push_str(&format!(
            "pub const {}_GENERATOR: pallas::Affine = /* {:?} */;\n\n",
            name, gen_affine
        ));
        
        // Output window table (U coordinates)
        output.push_str(&format!(
            "pub const {}_U: [[([u8; 32], [u8; 32]); 8]; {}] = [\n",
            name, table.windows.len()
        ));
        for window in &table.windows {
            output.push_str("    [\n");
            for (x, y) in window {
                output.push_str(&format!(
                    "        ({:?}, {:?}),\n",
                    x.to_repr(), y.to_repr()
                ));
            }
            output.push_str("    ],\n");
        }
        output.push_str("];\n\n");
    }

    // Write to file
    let mut file = File::create("src/generated_tables.rs").unwrap();
    file.write_all(output.as_bytes()).unwrap();
}
```

---

## Step 7: Verification

Verify generated tables match the Orchard reference:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use orchard::constants::{OrchardFixedBases, NullifierK};
    
    #[test]
    fn verify_nullifier_k_matches_orchard() {
        // Our generated NullifierK
        let our_nullifier_k = group_hash(b"z.cash:Orchard-NullifierK", b"").unwrap();
        
        // Compare with orchard crate's value (if accessible)
        // This validates our GroupHash implementation is correct
        assert_eq!(
            our_nullifier_k.to_affine(),
            expected_nullifier_k_affine()
        );
    }
    
    #[test]
    fn verify_window_table_scalar_mul() {
        // Verify that using window table produces correct result
        let base = group_hash(b"z.cash:Orchard-NullifierK", b"").unwrap();
        let table = generate_window_table(base);
        
        // Random scalar
        let scalar = pallas::Scalar::from(12345u64);
        
        // Direct computation
        let expected = base * scalar;
        
        // Window table computation
        let actual = fixed_base_mul_with_table(&table, scalar);
        
        assert_eq!(expected, actual);
    }
}
```

---

## File Structure

After implementation, your crate should have:

```
zkpf-orchard-pof-circuit/
├── src/
│   ├── lib.rs
│   ├── circuit.rs
│   ├── domains.rs           # Sinsemilla hash domains (already done)
│   ├── fixed_bases/
│   │   ├── mod.rs           # FixedPoints trait implementations
│   │   ├── nullifier_k.rs   # NullifierK tables
│   │   ├── value_commit.rs  # ValueCommitV/R tables
│   │   ├── spend_auth.rs    # SpendAuthG tables
│   │   └── note_commit.rs   # NoteCommitR, CommitIvkR tables
│   └── gadgets.rs
├── build.rs                  # Optional: generate tables at build time
└── Cargo.toml
```

---

## References

1. **Zcash Protocol Spec** - Section 5.4.9.7 (Group Hash)
2. **draft-irtf-cfrg-hash-to-curve** - Simplified SWU algorithm
3. **halo2_gadgets source** - `ecc/chip/constants.rs`, `ecc/chip/mul_fixed/`
4. **Orchard source** - `constants/` module (for reference values)

---

## Estimated Effort

| Task | Complexity | Time Estimate |
|------|------------|---------------|
| GroupHash/SSWU implementation | Medium | 4-8 hours |
| Window table generation | Medium | 4-6 hours |
| Lagrange coefficient computation | Low | 2-4 hours |
| FixedPoints trait implementation | High | 8-12 hours |
| Testing & verification | Medium | 4-8 hours |
| **Total** | | **22-38 hours** |

The primary complexity is in correctly implementing the hash-to-curve (SSWU) algorithm and ensuring the window table format exactly matches what `halo2_gadgets::ecc::chip` expects.

