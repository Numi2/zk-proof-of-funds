//! TEE attestation for the NEAR agent.

use serde::{Deserialize, Serialize};

use crate::error::NearTeeError;

// ═══════════════════════════════════════════════════════════════════════════════
// TEE PROVIDER
// ═══════════════════════════════════════════════════════════════════════════════

/// Supported TEE providers.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TeeProvider {
    /// Intel SGX (Software Guard Extensions).
    IntelSgx,
    /// Intel TDX (Trust Domain Extensions).
    IntelTdx,
    /// AMD SEV (Secure Encrypted Virtualization).
    AmdSev,
    /// ARM TrustZone.
    ArmTrustZone,
    /// Mock TEE for testing.
    Mock,
}

impl TeeProvider {
    pub fn is_hardware(&self) -> bool {
        !matches!(self, Self::Mock)
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEE ATTESTATION
// ═══════════════════════════════════════════════════════════════════════════════

/// TEE attestation proving the agent runs in a genuine enclave.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TeeAttestation {
    /// TEE provider.
    pub provider: TeeProvider,
    /// Attestation quote/report.
    pub quote: Vec<u8>,
    /// Enclave measurement (MRENCLAVE for SGX).
    pub measurement: [u8; 32],
    /// Signer measurement (MRSIGNER for SGX).
    pub signer: [u8; 32],
    /// Product ID.
    pub product_id: u16,
    /// Security version number.
    pub svn: u16,
    /// User data included in attestation.
    #[serde(with = "serde_bytes_64")]
    pub user_data: [u8; 64],
    /// Timestamp when attestation was generated.
    pub generated_at: u64,
    /// Validity period in seconds.
    pub validity_secs: u64,
}

// Custom serde for [u8; 64]
mod serde_bytes_64 {
    use serde::{Deserialize, Deserializer, Serialize, Serializer};
    
    pub fn serialize<S>(data: &[u8; 64], serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        data.as_slice().serialize(serializer)
    }
    
    pub fn deserialize<'de, D>(deserializer: D) -> Result<[u8; 64], D::Error>
    where
        D: Deserializer<'de>,
    {
        let vec = Vec::<u8>::deserialize(deserializer)?;
        vec.try_into()
            .map_err(|_| serde::de::Error::custom("expected 64 bytes"))
    }
}

impl TeeAttestation {
    /// Generate a new attestation from the TEE.
    pub async fn generate(provider: &TeeProvider) -> Result<Self, NearTeeError> {
        match provider {
            TeeProvider::IntelSgx => Self::generate_sgx().await,
            TeeProvider::IntelTdx => Self::generate_tdx().await,
            TeeProvider::AmdSev => Self::generate_sev().await,
            TeeProvider::ArmTrustZone => Self::generate_trustzone().await,
            TeeProvider::Mock => Self::generate_mock().await,
        }
    }

    /// Check if the attestation is expired.
    pub fn is_expired(&self) -> bool {
        let now = current_timestamp();
        now > self.generated_at + self.validity_secs
    }

    /// Compute the attestation hash.
    pub fn hash(&self) -> [u8; 32] {
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"tee_attestation_v1");
        hasher.update(&[self.provider as u8]);
        hasher.update(&self.measurement);
        hasher.update(&self.signer);
        hasher.update(&self.user_data);
        hasher.update(&self.generated_at.to_be_bytes());
        *hasher.finalize().as_bytes()
    }

    /// Get remaining validity in seconds.
    pub fn remaining_validity(&self) -> u64 {
        let now = current_timestamp();
        let expires_at = self.generated_at + self.validity_secs;
        if now >= expires_at {
            0
        } else {
            expires_at - now
        }
    }

    // Provider-specific generation

    async fn generate_sgx() -> Result<Self, NearTeeError> {
        // In production, this would call the SGX attestation API
        Err(NearTeeError::TeeNotAvailable(
            "Intel SGX attestation not implemented".into(),
        ))
    }

    async fn generate_tdx() -> Result<Self, NearTeeError> {
        Err(NearTeeError::TeeNotAvailable(
            "Intel TDX attestation not implemented".into(),
        ))
    }

    async fn generate_sev() -> Result<Self, NearTeeError> {
        Err(NearTeeError::TeeNotAvailable(
            "AMD SEV attestation not implemented".into(),
        ))
    }

    async fn generate_trustzone() -> Result<Self, NearTeeError> {
        Err(NearTeeError::TeeNotAvailable(
            "ARM TrustZone attestation not implemented".into(),
        ))
    }

    async fn generate_mock() -> Result<Self, NearTeeError> {
        use rand::Rng;

        let mut rng = rand::thread_rng();
        let mut measurement = [0u8; 32];
        let mut signer = [0u8; 32];
        let mut user_data = [0u8; 64];

        rng.fill(&mut measurement);
        rng.fill(&mut signer);
        rng.fill(&mut user_data);

        Ok(Self {
            provider: TeeProvider::Mock,
            quote: vec![0u8; 64], // Mock quote
            measurement,
            signer,
            product_id: 1,
            svn: 1,
            user_data,
            generated_at: current_timestamp(),
            validity_secs: crate::DEFAULT_ATTESTATION_VALIDITY_SECS,
        })
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════════

/// Verify a TEE attestation.
pub fn verify_attestation(attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    // Check expiration
    if attestation.is_expired() {
        return Ok(AttestationResult {
            valid: false,
            reason: Some("Attestation expired".to_string()),
            verified_at: current_timestamp(),
        });
    }

    // Provider-specific verification
    match attestation.provider {
        TeeProvider::IntelSgx => verify_sgx_attestation(attestation),
        TeeProvider::IntelTdx => verify_tdx_attestation(attestation),
        TeeProvider::AmdSev => verify_sev_attestation(attestation),
        TeeProvider::ArmTrustZone => verify_trustzone_attestation(attestation),
        TeeProvider::Mock => Ok(AttestationResult {
            valid: true,
            reason: Some("Mock attestation - not cryptographically verified".to_string()),
            verified_at: current_timestamp(),
        }),
    }
}

/// Result of attestation verification.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationResult {
    /// Whether the attestation is valid.
    pub valid: bool,
    /// Reason for validation result.
    pub reason: Option<String>,
    /// Timestamp of verification.
    pub verified_at: u64,
}

fn verify_sgx_attestation(_attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    // In production, this would verify the SGX quote via IAS or DCAP
    Err(NearTeeError::AttestationInvalid(
        "SGX attestation verification not implemented".into(),
    ))
}

fn verify_tdx_attestation(_attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    Err(NearTeeError::AttestationInvalid(
        "TDX attestation verification not implemented".into(),
    ))
}

fn verify_sev_attestation(_attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    Err(NearTeeError::AttestationInvalid(
        "SEV attestation verification not implemented".into(),
    ))
}

fn verify_trustzone_attestation(
    _attestation: &TeeAttestation,
) -> Result<AttestationResult, NearTeeError> {
    Err(NearTeeError::AttestationInvalid(
        "TrustZone attestation verification not implemented".into(),
    ))
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

fn current_timestamp() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs()
}

