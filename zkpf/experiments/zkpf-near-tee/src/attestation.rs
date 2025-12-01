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
        // Check if SGX device exists (simulation possible)
        if !is_sgx_available() {
            return Err(NearTeeError::TeeNotAvailable(
                "Intel SGX not available on this platform".into(),
            ));
        }

        // In production, this would:
        // 1. Get MRENCLAVE and MRSIGNER from the enclave report
        // 2. Generate a quote via DCAP or EPID
        // 3. Return the signed attestation
        Err(NearTeeError::TeeNotAvailable(
            "SGX attestation requires running inside an SGX enclave".into(),
        ))
    }

    async fn generate_tdx() -> Result<Self, NearTeeError> {
        // TDX uses /dev/tdx-guest for attestation
        let tdx_available = std::path::Path::new("/dev/tdx-guest").exists()
            || std::path::Path::new("/dev/tdx_guest").exists();
            
        if !tdx_available {
            return Err(NearTeeError::TeeNotAvailable(
                "Intel TDX guest device not available".into(),
            ));
        }
        
        // In production, we would:
        // 1. Open /dev/tdx-guest
        // 2. Request TDX_CMD_GET_REPORT
        // 3. Generate a TDX quote
        Err(NearTeeError::TeeNotAvailable(
            "TDX quote generation requires TDX-enabled VM".into(),
        ))
    }

    async fn generate_sev() -> Result<Self, NearTeeError> {
        // SEV uses /dev/sev-guest for attestation
        let sev_available = std::path::Path::new("/dev/sev-guest").exists()
            || std::path::Path::new("/dev/sev").exists();
            
        if !sev_available {
            return Err(NearTeeError::TeeNotAvailable(
                "AMD SEV guest device not available".into(),
            ));
        }
        
        // In production, we would:
        // 1. Open /dev/sev-guest
        // 2. Request SNP_GET_REPORT ioctl
        // 3. Verify with AMD key server
        Err(NearTeeError::TeeNotAvailable(
            "SEV attestation report generation requires SEV-SNP enabled VM".into(),
        ))
    }

    async fn generate_trustzone() -> Result<Self, NearTeeError> {
        // TrustZone availability varies by platform
        // On Linux, check for OP-TEE
        let optee_available = std::path::Path::new("/dev/tee0").exists()
            || std::path::Path::new("/dev/teepriv0").exists();
            
        if !optee_available {
            return Err(NearTeeError::TeeNotAvailable(
                "ARM TrustZone/OP-TEE not available".into(),
            ));
        }
        
        Err(NearTeeError::TeeNotAvailable(
            "TrustZone attestation requires TA (Trusted Application) setup".into(),
        ))
    }

    async fn generate_mock() -> Result<Self, NearTeeError> {
        Self::generate_mock_with_user_data([0u8; 64]).await
    }

    /// Generate a mock attestation with specific user data.
    /// Useful for testing with deterministic values.
    pub async fn generate_mock_with_user_data(user_data: [u8; 64]) -> Result<Self, NearTeeError> {
        // Generate deterministic measurement from user_data
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"mock_enclave_measurement");
        hasher.update(&user_data);
        let measurement = *hasher.finalize().as_bytes();
        
        // Generate deterministic signer
        let mut hasher = blake3::Hasher::new();
        hasher.update(b"mock_enclave_signer");
        let signer = *hasher.finalize().as_bytes();

        // Generate mock quote structure
        let quote = build_mock_quote(&measurement, &signer, &user_data);

        Ok(Self {
            provider: TeeProvider::Mock,
            quote,
            measurement,
            signer,
            product_id: 1,
            svn: 1,
            user_data,
            generated_at: current_timestamp(),
            validity_secs: crate::DEFAULT_ATTESTATION_VALIDITY_SECS,
        })
    }

    /// Bind user data to the attestation.
    /// Returns a new attestation with the user data included in the quote.
    pub async fn bind_user_data(&self, user_data: [u8; 64]) -> Result<Self, NearTeeError> {
        if self.provider == TeeProvider::Mock {
            return Self::generate_mock_with_user_data(user_data).await;
        }
        
        // For real TEEs, we'd need to regenerate the attestation
        Err(NearTeeError::TeeNotAvailable(
            "Re-attestation with new user data requires TEE support".into(),
        ))
    }
}

/// Check if SGX is available on the platform.
fn is_sgx_available() -> bool {
    // Check for SGX device files
    std::path::Path::new("/dev/sgx_enclave").exists()
        || std::path::Path::new("/dev/isgx").exists()
        || std::path::Path::new("/dev/sgx/enclave").exists()
}

/// Build a mock SGX-like quote structure for testing.
fn build_mock_quote(measurement: &[u8; 32], signer: &[u8; 32], user_data: &[u8; 64]) -> Vec<u8> {
    let mut quote = Vec::with_capacity(436); // Approximate SGX quote size
    
    // Quote header (mock)
    quote.extend_from_slice(&[0x03, 0x00]); // Version
    quote.extend_from_slice(&[0x02, 0x00]); // Sign type (EPID)
    quote.extend_from_slice(&[0x00; 4]); // Reserved
    
    // EPID group ID (mock)
    quote.extend_from_slice(&[0x00; 4]);
    
    // SVN
    quote.extend_from_slice(&[0x01, 0x00]);
    
    // Reserved
    quote.extend_from_slice(&[0x00; 4]);
    
    // Basename
    quote.extend_from_slice(&[0x00; 32]);
    
    // Report body
    quote.extend_from_slice(measurement); // MRENCLAVE
    quote.extend_from_slice(&[0x00; 32]); // Reserved
    quote.extend_from_slice(signer); // MRSIGNER
    quote.extend_from_slice(&[0x00; 96]); // Reserved
    quote.extend_from_slice(&[0x00; 16]); // ISV Prod ID + SVN + Reserved
    quote.extend_from_slice(user_data); // Report data (64 bytes)
    
    // Signature (mock - would be EPID signature in real quote)
    quote.extend_from_slice(&[0x00; 64]);
    
    quote
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

fn verify_sgx_attestation(attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    // Basic structural validation
    if attestation.quote.len() < 100 {
        return Ok(AttestationResult {
            valid: false,
            reason: Some("Quote too short for valid SGX attestation".to_string()),
            verified_at: current_timestamp(),
        });
    }
    
    // Check quote header
    if attestation.quote.len() >= 2 {
        let version = u16::from_le_bytes([attestation.quote[0], attestation.quote[1]]);
        if version != 3 {
            return Ok(AttestationResult {
                valid: false,
                reason: Some(format!("Unsupported SGX quote version: {}", version)),
                verified_at: current_timestamp(),
            });
        }
    }
    
    // In production, we would:
    // 1. Extract the signature from the quote
    // 2. Verify against Intel Attestation Service (IAS) or use DCAP
    // 3. Check the MRENCLAVE/MRSIGNER against known-good values
    // 4. Verify the SVN meets minimum requirements
    
    // For now, return a placeholder that indicates verification is needed
    Err(NearTeeError::AttestationInvalid(
        "SGX DCAP/EPID verification requires Intel attestation service".into(),
    ))
}

fn verify_tdx_attestation(attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    // Basic structural validation
    if attestation.quote.len() < 100 {
        return Ok(AttestationResult {
            valid: false,
            reason: Some("Quote too short for valid TDX attestation".to_string()),
            verified_at: current_timestamp(),
        });
    }
    
    // In production, we would:
    // 1. Parse the TDX quote structure
    // 2. Verify the TD report using PCK certificate chain
    // 3. Check TD measurement against expected values
    
    Err(NearTeeError::AttestationInvalid(
        "TDX DCAP verification requires Intel attestation service".into(),
    ))
}

fn verify_sev_attestation(attestation: &TeeAttestation) -> Result<AttestationResult, NearTeeError> {
    // Basic structural validation
    if attestation.quote.len() < 100 {
        return Ok(AttestationResult {
            valid: false,
            reason: Some("Report too short for valid SEV attestation".to_string()),
            verified_at: current_timestamp(),
        });
    }
    
    // In production, we would:
    // 1. Parse the SEV-SNP attestation report
    // 2. Verify the signature using AMD Root Key (ARK) chain
    // 3. Check launch measurement against expected values
    // 4. Verify guest policy and platform info
    
    Err(NearTeeError::AttestationInvalid(
        "SEV-SNP verification requires AMD key server".into(),
    ))
}

fn verify_trustzone_attestation(
    attestation: &TeeAttestation,
) -> Result<AttestationResult, NearTeeError> {
    // Basic structural validation
    if attestation.quote.is_empty() {
        return Ok(AttestationResult {
            valid: false,
            reason: Some("Empty TrustZone attestation".to_string()),
            verified_at: current_timestamp(),
        });
    }
    
    // TrustZone verification varies by vendor/implementation
    // Would typically verify against a vendor-specific root of trust
    
    Err(NearTeeError::AttestationInvalid(
        "TrustZone verification requires vendor-specific attestation service".into(),
    ))
}

// ═══════════════════════════════════════════════════════════════════════════════
// ATTESTATION POLICY
// ═══════════════════════════════════════════════════════════════════════════════

/// Policy for validating attestations.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AttestationPolicy {
    /// Minimum accepted SVN (Security Version Number).
    pub min_svn: u16,
    /// Accepted MRENCLAVE values (empty = any).
    pub accepted_measurements: Vec<[u8; 32]>,
    /// Accepted MRSIGNER values (empty = any).
    pub accepted_signers: Vec<[u8; 32]>,
    /// Maximum attestation age in seconds.
    pub max_age_secs: u64,
    /// Required TEE provider(s).
    pub required_providers: Vec<TeeProvider>,
}

impl Default for AttestationPolicy {
    fn default() -> Self {
        Self {
            min_svn: 0,
            accepted_measurements: vec![],
            accepted_signers: vec![],
            max_age_secs: 86400, // 24 hours
            required_providers: vec![
                TeeProvider::IntelSgx,
                TeeProvider::IntelTdx,
                TeeProvider::AmdSev,
            ],
        }
    }
}

impl AttestationPolicy {
    /// Validate an attestation against this policy.
    pub fn validate(&self, attestation: &TeeAttestation) -> Result<bool, String> {
        // Check provider
        if !self.required_providers.is_empty() 
            && !self.required_providers.contains(&attestation.provider) 
        {
            return Err(format!(
                "Provider {:?} not in allowed list",
                attestation.provider
            ));
        }
        
        // Check SVN
        if attestation.svn < self.min_svn {
            return Err(format!(
                "SVN {} below minimum {}",
                attestation.svn, self.min_svn
            ));
        }
        
        // Check measurement
        if !self.accepted_measurements.is_empty()
            && !self.accepted_measurements.contains(&attestation.measurement)
        {
            return Err("Enclave measurement not in allowed list".into());
        }
        
        // Check signer
        if !self.accepted_signers.is_empty()
            && !self.accepted_signers.contains(&attestation.signer)
        {
            return Err("Enclave signer not in allowed list".into());
        }
        
        // Check age
        let age = current_timestamp() - attestation.generated_at;
        if age > self.max_age_secs {
            return Err(format!(
                "Attestation too old: {} seconds > {} max",
                age, self.max_age_secs
            ));
        }
        
        Ok(true)
    }
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

